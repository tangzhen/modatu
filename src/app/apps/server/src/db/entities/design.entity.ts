import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { DesignModel } from '@modatu/design-model';

@Entity('designs')
@Index(['userId'])
export class DesignEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @Column('text')
  name!: string;

  /** 当前设计模型（结构化 JSON，spec-02 核心接缝） */
  @Column('simple-json')
  model!: DesignModel;

  /** 乐观锁版本号；保存时客户端须携带 baseVersion，不一致返回 409 */
  @Column('integer')
  version!: number;

  /** 软删除（默认保留 30 天以便恢复） */
  @Column('datetime', { nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('design_versions')
@Index(['designId', 'seq'], { unique: true })
export class DesignVersionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  @Index()
  designId!: string;

  /** 从 1 递增；回退 = 以历史快照前向追加新版本 */
  @Column('integer')
  seq!: number;

  @Column('simple-json')
  model!: DesignModel;

  /** 版本摘要：人工编辑 / AI 修改及来源 */
  @Column('text')
  summary!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
