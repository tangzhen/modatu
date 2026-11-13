import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { In, type Repository } from 'typeorm';
import { ApiException } from '../../common/errors';
import {
  CompatibilityEntity,
  ConnectorEntity,
  PanelMaterialEntity,
  ProfileSpecEntity,
  SafetyRuleEntity,
} from '../../db/entities/catalog.entity';
import type { CatalogSnapshot, LoadRating } from '@modatu/catalog';

/**
 * 知识库服务（spec-01）。
 * 停用 = enabled 标志软停用，无物理删除；只读接口仅返回启用条目。
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ProfileSpecEntity) private readonly profiles: Repository<ProfileSpecEntity>,
    @InjectRepository(ConnectorEntity) private readonly connectors: Repository<ConnectorEntity>,
    @InjectRepository(CompatibilityEntity)
    private readonly compatibilities: Repository<CompatibilityEntity>,
    @InjectRepository(PanelMaterialEntity)
    private readonly panelMaterials: Repository<PanelMaterialEntity>,
    @InjectRepository(SafetyRuleEntity) private readonly safetyRules: Repository<SafetyRuleEntity>,
  ) {}

  /** 启用条目快照：只读接口、引用校验、BOM、AI prompt 共用（spec-01 开发者故事 13）。 */
  async snapshot(): Promise<CatalogSnapshot> {
    const [profiles, connectors, compatibilities, panelMaterials, safetyRules] = await Promise.all([
      this.profiles.find({ where: { enabled: true }, order: { code: 'ASC' } }),
      this.connectors.find({ where: { enabled: true }, order: { name: 'ASC' } }),
      this.compatibilities.find({ order: { profileCodeA: 'ASC', profileCodeB: 'ASC' } }),
      this.panelMaterials.find({ where: { enabled: true }, order: { name: 'ASC' } }),
      this.safetyRules.find({ where: { enabled: true }, order: { id: 'ASC' } }),
    ]);
    return {
      profiles: profiles.map(toProfileSpec),
      connectors: connectors.map(toConnector),
      // 只保留两端规格与连接件都启用的兼容行
      compatibilities: compatibilities.filter(
        (c) =>
          profiles.some((p) => p.code === c.profileCodeA) &&
          profiles.some((p) => p.code === c.profileCodeB) &&
          connectors.some((cn) => cn.id === c.connectorId),
      ),
      panelMaterials: panelMaterials.map(toPanelMaterial),
      safetyRules: safetyRules.map(toSafetyRule),
    };
  }

  /* ------------------------------ 后台查询 ------------------------------ */

  adminListProfiles(q?: string) {
    const qb = this.profiles.createQueryBuilder('p').orderBy('p.code', 'ASC');
    if (q) qb.where('LOWER(p.code) LIKE LOWER(:q) OR LOWER(p.series) LIKE LOWER(:q)', { q: `%${q}%` });
    return qb.getMany();
  }

  adminListConnectors(q?: string) {
    const qb = this.connectors.createQueryBuilder('c').orderBy('c.name', 'ASC');
    if (q) qb.where('LOWER(c.name) LIKE LOWER(:q)', { q: `%${q}%` });
    return qb.getMany();
  }

  adminListCompatibilities() {
    return this.compatibilities.find({ order: { profileCodeA: 'ASC', profileCodeB: 'ASC' } });
  }

  adminListPanelMaterials(q?: string) {
    const qb = this.panelMaterials.createQueryBuilder('m').orderBy('m.name', 'ASC');
    if (q) qb.where('m.name ILIKE :q', { q: `%${q}%` });
    return qb.getMany();
  }

  adminListSafetyRules() {
    return this.safetyRules.find({ order: { id: 'ASC' } });
  }

  /* ------------------------------ 后台写入 ------------------------------ */

  async saveProfile(dto: ProfileUpsert): Promise<ProfileSpecEntity> {
    const entity =
      dto.id !== undefined
        ? ((await this.profiles.findOne({ where: { id: dto.id } })) ??
          (await this.profiles.create({ id: dto.id })))
        : this.profiles.create({ id: newId('ps') });
    Object.assign(entity, { ...dto, loadRatings: cleanLoadRatings(dto.loadRatings) });
    return this.profiles.save(entity);
  }

  async saveConnector(dto: ConnectorUpsert): Promise<ConnectorEntity> {
    const entity =
      dto.id !== undefined
        ? ((await this.connectors.findOne({ where: { id: dto.id } })) ??
          this.connectors.create({ id: dto.id }))
        : this.connectors.create({ id: newId('cn') });
    Object.assign(entity, dto);
    return this.connectors.save(entity);
  }

  /** 保存兼容行：校验引用的规格与连接件存在（矩阵是后台维护的核心写入）。 */
  async saveCompatibility(dto: CompatibilityUpsert): Promise<CompatibilityEntity> {
    const entity =
      dto.id !== undefined
        ? ((await this.compatibilities.findOne({ where: { id: dto.id } })) ??
          this.compatibilities.create({ id: dto.id }))
        : this.compatibilities.create({ id: newId('cm') });
    Object.assign(entity, dto);
    const [a, b, connector] = await Promise.all([
      this.profiles.findOne({ where: { code: dto.profileCodeA } }),
      this.profiles.findOne({ where: { code: dto.profileCodeB } }),
      this.connectors.findOne({ where: { id: dto.connectorId } }),
    ]);
    const missing: string[] = [];
    if (!a) missing.push(`规格 ${dto.profileCodeA}`);
    if (!b) missing.push(`规格 ${dto.profileCodeB}`);
    if (!connector) missing.push(`连接件 ${dto.connectorId}`);
    if (missing.length > 0) {
      throw ApiException.validation(`不存在的知识库条目: ${missing.join('、')}`);
    }
    return this.compatibilities.save(entity);
  }

  async savePanelMaterial(dto: PanelMaterialUpsert): Promise<PanelMaterialEntity> {
    const entity =
      dto.id !== undefined
        ? ((await this.panelMaterials.findOne({ where: { id: dto.id } })) ??
          this.panelMaterials.create({ id: dto.id }))
        : this.panelMaterials.create({ id: newId('pm') });
    Object.assign(entity, dto);
    return this.panelMaterials.save(entity);
  }

  async saveSafetyRule(dto: SafetyRuleUpsert): Promise<SafetyRuleEntity> {
    const entity =
      dto.id !== undefined
        ? ((await this.safetyRules.findOne({ where: { id: dto.id } })) ??
          this.safetyRules.create({ id: dto.id }))
        : this.safetyRules.create({ id: newId('sr') });
    Object.assign(entity, dto);
    return this.safetyRules.save(entity);
  }

  /** 批量导入兼容行（seed 用）。 */
  async bulkSaveCompatibilities(rows: Array<Omit<CompatibilityEntity, 'createdAt'>>): Promise<void> {
    await this.compatibilities.clear();
    if (rows.length > 0) await this.compatibilities.save(rows as CompatibilityEntity[]);
  }

  async setEnabled(kind: CatalogKind, id: string, enabled: boolean): Promise<void> {
    switch (kind) {
      case 'profiles': {
        const e = await this.profiles.findOne({ where: { id } });
        if (!e) throw notFound('型材规格');
        e.enabled = enabled;
        await this.profiles.save(e);
        return;
      }
      case 'connectors': {
        const e = await this.connectors.findOne({ where: { id } });
        if (!e) throw notFound('连接件');
        e.enabled = enabled;
        await this.connectors.save(e);
        return;
      }
      case 'panel-materials': {
        const e = await this.panelMaterials.findOne({ where: { id } });
        if (!e) throw notFound('板材材质');
        e.enabled = enabled;
        await this.panelMaterials.save(e);
        return;
      }
      case 'safety-rules': {
        const e = await this.safetyRules.findOne({ where: { id } });
        if (!e) throw notFound('安全规则');
        e.enabled = enabled;
        await this.safetyRules.save(e);
        return;
      }
      case 'compatibilities':
        throw notFound('兼容矩阵行（仅可删除）');
    }
  }

  async deleteCompatibility(id: string): Promise<void> {
    await this.compatibilities.delete({ id });
  }

  async profileCodes(codes: string[]): Promise<ProfileSpecEntity[]> {
    if (codes.length === 0) return [];
    return this.profiles.find({ where: { code: In(codes) } });
  }
}

export type CatalogKind = 'profiles' | 'connectors' | 'compatibilities' | 'panel-materials' | 'safety-rules';

export interface ProfileUpsert {
  id?: string;
  code: string;
  series: string;
  width: number;
  height: number;
  slotWidth: number;
  slotDepth: number;
  massPerMeter: number;
  minCutLength: number;
  maxCutLength: number;
  loadRatings: LoadRating[];
  enabled?: boolean;
}

export interface ConnectorUpsert {
  id?: string;
  name: string;
  category: 'corner-bracket' | 't-bolt' | 'other';
  enabled?: boolean;
}

export interface CompatibilityUpsert {
  id?: string;
  connectorId: string;
  profileCodeA: string;
  profileCodeB: string;
  quantityPerJoint: number;
}

export interface PanelMaterialUpsert {
  id?: string;
  name: string;
  thicknesses: number[];
  density: number;
  enabled?: boolean;
}

export interface SafetyRuleUpsert {
  id?: string;
  ruleType: 'max-unsupported-span' | 'panel-span-load';
  params: Record<string, number | string>;
  messageTemplate: string;
  enabled?: boolean;
}

function cleanLoadRatings(ratings: LoadRating[]): LoadRating[] {
  return (ratings ?? []).filter((r) => Number.isFinite(r.span) && Number.isFinite(r.load) && r.span > 0);
}

/* 实体 → 快照 DTO（updatedAt: Date → ISO 字符串） */
function toProfileSpec(e: ProfileSpecEntity): ProfileSpecSnapshot {
  return {
    id: e.id,
    code: e.code,
    series: e.series,
    width: e.width,
    height: e.height,
    slotWidth: e.slotWidth,
    slotDepth: e.slotDepth,
    massPerMeter: e.massPerMeter,
    minCutLength: e.minCutLength,
    maxCutLength: e.maxCutLength,
    loadRatings: e.loadRatings ?? [],
    enabled: e.enabled,
    updatedAt: e.updatedAt?.toISOString() ?? '',
  };
}

function toConnector(e: ConnectorEntity): ConnectorSnapshot {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    enabled: e.enabled,
    updatedAt: e.updatedAt?.toISOString() ?? '',
  };
}

function toPanelMaterial(e: PanelMaterialEntity): PanelMaterialSnapshot {
  return {
    id: e.id,
    name: e.name,
    thicknesses: e.thicknesses ?? [],
    density: e.density,
    enabled: e.enabled,
    updatedAt: e.updatedAt?.toISOString() ?? '',
  };
}

function toSafetyRule(e: SafetyRuleEntity): SafetyRuleSnapshot {
  return {
    id: e.id,
    ruleType: e.ruleType,
    params: e.params ?? {},
    messageTemplate: e.messageTemplate,
    enabled: e.enabled,
    updatedAt: e.updatedAt?.toISOString() ?? '',
  };
}

type ProfileSpecSnapshot = import('@modatu/catalog').ProfileSpec;
type ConnectorSnapshot = import('@modatu/catalog').Connector;
type PanelMaterialSnapshot = import('@modatu/catalog').PanelMaterial;
type SafetyRuleSnapshot = import('@modatu/catalog').SafetyRule;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function notFound(label: string): Error & { code: string } {
  return Object.assign(new Error(`${label}不存在`), { code: 'NOT_FOUND' }) as Error & { code: string };
}
