import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** 用户名（dev 账密 / 隐藏页账密登录）；微信登录用户可为空 */
  @Column('text', { nullable: true })
  @Index({ unique: true })
  username!: string | null;

  @Column('text')
  nickname!: string;

  /** bcrypt 慢哈希；微信登录用户为空 */
  @Column('text', { nullable: true })
  passwordHash!: string | null;

  /** user | admin（一期无 RBAC 细分） */
  @Column('text')
  role!: 'user' | 'admin';

  /** active | banned */
  @Column('text')
  status!: 'active' | 'banned';

  /** 微信 unionid（预留） */
  @Column('text', { nullable: true })
  wechatUnionid!: string | null;

  /** LLM 配置（敏感字段静态加密）：{baseUrlEnc, apiKeyEnc, model} */
  @Column('simple-json', { nullable: true })
  aiConfig!: {
    baseUrlEnc: string;
    apiKeyEnc: string;
    model: string;
  } | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('sessions')
export class SessionEntity {
  /** 随机 48 字节 hex 会话令牌，即 Cookie 值 */
  @PrimaryColumn('text')
  id!: string;

  @Column('uuid')
  @Index()
  userId!: string;

  @Column('datetime')
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
