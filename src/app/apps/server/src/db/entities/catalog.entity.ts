import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
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
