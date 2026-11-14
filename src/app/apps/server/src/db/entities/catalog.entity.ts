import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { CrossSectionSource, ProfileCrossSection } from '@modatu/catalog';
import type { LoadRating } from '@modatu/catalog';

@Entity('profile_specs')
export class ProfileSpecEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  @Index({ unique: true })
  code!: string;

  @Column('text')
  series!: string;

  @Column('float')
  width!: number;

  @Column('float')
  height!: number;

  @Column('float')
  slotWidth!: number;

  @Column('float')
  slotDepth!: number;

  @Column('float')
  massPerMeter!: number;

  @Column('float')
  minCutLength!: number;

  @Column('float')
  maxCutLength!: number;

  @Column('simple-json')
  loadRatings!: LoadRating[];

  /** 基准米价（元/米，未税；对应本色），seed 从 materials folder 采集导入，可空 */
  @Column('float', { nullable: true })
  pricePerMeter!: number | null;

  /** 各颜色米价（元/米，未税），key = ProfileFinishEntity.id，seed 导入，可空 */
  @Column('simple-json', { nullable: true })
  finishPrices!: Record<string, number> | null;

  /** 精确截面（归一化多边形环，mm/中心原点），可空 = 用参数化近似 */
  @Column('simple-json', { nullable: true })
  crossSection!: ProfileCrossSection | null;

  /** 截面来源存档（后台导入原文件文本；公共接口不下发） */
  @Column('simple-json', { nullable: true })
  crossSectionSource!: CrossSectionSource | null;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

/** 型材颜色（表面处理）条目：seed 从 materials folder 导入；finishId 在设计模型中引用其 id。 */
@Entity('profile_finishes')
export class ProfileFinishEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  @Index({ unique: true })
  code!: string;

  @Column('text')
  name!: string;

  /** Modatu 自选的代表性渲染色（hex），非厂家贴图 */
  @Column('text')
  colorHex!: string;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('connectors')
export class ConnectorEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  name!: string;

  @Column('text')
  category!: 'corner-bracket' | 't-bolt' | 'other';

  @Column('boolean', { default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

/** 连接兼容矩阵行：规格 A × 规格 B 可用某连接件，每个连接点需 quantityPerJoint 件。 */
@Entity('compatibilities')
@Index(['profileCodeA', 'profileCodeB'])
export class CompatibilityEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  connectorId!: string;

  @Column('text')
  profileCodeA!: string;

  @Column('text')
  profileCodeB!: string;

  @Column('float')
  quantityPerJoint!: number;
}

@Entity('panel_materials')
export class PanelMaterialEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  @Index({ unique: true })
  name!: string;

  @Column('simple-json')
  thicknesses!: number[];

  /** g/cm³ */
  @Column('float')
  density!: number;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('safety_rules')
export class SafetyRuleEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  ruleType!: 'max-unsupported-span' | 'panel-span-load';

  @Column('simple-json')
  params!: Record<string, number | string>;

  @Column('text')
  messageTemplate!: string;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
