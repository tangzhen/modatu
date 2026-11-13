import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { DesignEntity, DesignVersionEntity } from '../../db/entities/design.entity';
import type { UserEntity } from '../../db/entities/user.entity';
import { CatalogService } from '../catalog/catalog.service';
import { validateFull } from '@modatu/design-model';
import { generateBom } from '@modatu/bom';
import type { DesignModel } from '@modatu/design-model';
import { ApiException } from '../../common/errors';

const SOFT_DELETE_RETENTION_DAYS = 30;

export interface SaveModelResult {
  saved: boolean;
  version: number;
  /** 本次实际产生的版本 seq（无实质变更时为 null） */
  newSeq: number | null;
}

@Injectable()
export class DesignsService {
  constructor(
    @InjectRepository(DesignEntity) private readonly designs: Repository<DesignEntity>,
    @InjectRepository(DesignVersionEntity)
    private readonly versions: Repository<DesignVersionEntity>,
    private readonly catalogService: CatalogService,
  ) {}

  /* --------------------------------- 查询 --------------------------------- */

  async listMine(user: UserEntity): Promise<
    Array<{
      id: string;
      name: string;
      version: number;
      updatedAt: string;
      createdAt: string;
    }>
  > {
    const rows = await this.designs.find({
      where: { userId: user.id, deletedAt: IsNull() },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      version: d.version,
      updatedAt: d.updatedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /** 归属校验统一在这里（跨用户访问返回 404，不泄露存在性；软删除不可见）。 */
  async getOwned(user: UserEntity, id: string): Promise<DesignEntity> {
    const design = await this.designs.findOne({ where: { id, deletedAt: IsNull() } });
    if (!design || design.userId !== user.id) throw ApiException.notFound('设计不存在');
    return design;
  }

  /* --------------------------------- 写入 --------------------------------- */

  /** 校验模型（Schema + 知识库引用）。 */
  async validateModel(model: unknown): Promise<DesignModel> {
    const catalog = await this.catalogService.snapshot();
    const result = validateFull(model, catalog);
    if (!result.schema.ok) {
      throw new ApiException(
        'DESIGN_INVALID',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '设计模型未通过 Schema 校验',
        { issues: result.schema.issues.slice(0, 20) },
      );
    }
    if (!result.catalog.ok) {
      throw new ApiException(
        'DESIGN_INVALID',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '设计模型引用了无效的知识库条目（规格/连接件/材质须存在且启用）',
        { issues: result.catalog.issues.slice(0, 20) },
      );
    }
    return result.design!;
  }

  async create(user: UserEntity, name: string, model?: DesignModel): Promise<DesignEntity> {
    const validated = model ? await this.validateModel(model) : null;
    const design = this.designs.create({
      id: crypto.randomUUID(),
      userId: user.id,
      name: validated?.meta.name ?? name,
      model: validated ?? { meta: { name, unit: 'mm', precision: 0.5 }, profiles: [], panels: [] },
      version: 1,
      deletedAt: null,
    });
    const saved = await this.designs.save(design);
    await this.appendVersion(saved, 1, saved.model, validated ? '初始保存' : '创建空项目');
    return saved;
  }

  async rename(user: UserEntity, id: string, name: string): Promise<DesignEntity> {
    const design = await this.getOwned(user, id);
    design.name = name;
    return this.designs.save(design);
  }

  /** 软删除（默认保留 30 天）。 */
  async softDelete(user: UserEntity, id: string): Promise<void> {
    const design = await this.getOwned(user, id);
    design.deletedAt = new Date();
    await this.designs.save(design);
  }

  /**
   * 自动保存（spec-02）：乐观锁 + 实质变更检测。
   * - baseVersion 与当前不符 → 409（后写入者得到明确提示，不做自动合并）
   * - 模型无实质差异（canonical JSON 相等）→ 不追加版本
   */
  async saveModel(
    user: UserEntity,
    id: string,
    input: { model: DesignModel; baseVersion: number; summary?: string },
  ): Promise<SaveModelResult> {
    const design = await this.getOwned(user, id);
    if (design.version !== input.baseVersion) {
      throw new ApiException(
        'VERSION_CONFLICT',
        HttpStatus.CONFLICT,
        '设计已被其他标签页/操作更新，请刷新后合并',
        {
          currentVersion: design.version,
          currentModel: design.model,
          currentName: design.name,
        },
      );
    }

    const validated = await this.validateModel(input.model);
    if (input.model.meta.name !== design.name) {
      design.name = validated.meta.name;
    }

    const changed = JSON.stringify(validated) !== JSON.stringify(design.model);
    if (!changed && validated.meta.name === design.name) {
      return { saved: false, version: design.version, newSeq: null };
    }

    design.model = validated;
    design.version += 1;
    await this.designs.save(design);
    await this.appendVersion(design, design.version, validated, input.summary ?? '手动编辑');
    return { saved: true, version: design.version, newSeq: design.version };
  }

  /* -------------------------------- 版本历史 -------------------------------- */

  async listVersions(
    user: UserEntity,
    id: string,
  ): Promise<Array<{ seq: number; summary: string; createdAt: string }>> {
    const design = await this.getOwned(user, id);
    const rows = await this.versions.find({
      where: { designId: design.id },
      order: { seq: 'DESC' },
    });
    return rows.map((v) => ({
      seq: v.seq,
      summary: v.summary,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  /** 一键回退：以历史快照前向追加新版本，不改写历史（spec-02）。 */
  async restore(
    user: UserEntity,
    id: string,
    seq: number,
    baseVersion: number,
  ): Promise<SaveModelResult> {
    const design = await this.getOwned(user, id);
    if (design.version !== baseVersion) {
      throw new ApiException(
        'VERSION_CONFLICT',
        HttpStatus.CONFLICT,
        '设计已被更新，请刷新后重试',
        { currentVersion: design.version },
      );
    }
    const snapshot = await this.versions.findOne({
      where: { designId: design.id, seq },
    });
    if (!snapshot) throw ApiException.notFound('版本不存在');

    design.model = snapshot.model;
    design.name = snapshot.model.meta.name;
    design.version += 1;
    await this.designs.save(design);
    await this.appendVersion(design, design.version, snapshot.model, `回退到版本 ${seq}`);
    return { saved: true, version: design.version, newSeq: design.version };
  }

  /* ---------------------------------- BOM ---------------------------------- */

  async bom(user: UserEntity, id: string, modelOverride?: DesignModel) {
    const design = await this.getOwned(user, id);
    const model = modelOverride ?? design.model;
    const catalog = await this.catalogService.snapshot();
    return { designName: design.name, bom: generateBom(model, catalog) };
  }

  getModel(user: UserEntity, id: string): Promise<DesignEntity> {
    return this.getOwned(user, id);
  }

  private async appendVersion(
    design: DesignEntity,
    seq: number,
    model: DesignModel,
    summary: string,
  ): Promise<void> {
    await this.versions.save(
      this.versions.create({
        id: crypto.randomUUID(),
        designId: design.id,
        seq,
        model,
        summary,
      }),
    );
  }
}

export { SOFT_DELETE_RETENTION_DAYS };
