import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { SessionEntity, UserEntity } from '../../db/entities/user.entity';
import { ApiException } from '../../common/errors';
import { APP_CONFIG_TOKEN, type AppConfig } from '../../config/config';

/**
 * 登录策略/适配器（spec-03 决策 12）：
 * - `dev-password`：账密登录。dev 登录入口由 flag 控制可见性；隐藏登录页走同一账密逻辑但不受 flag 限制。
 * - `wechat-qr`：微信扫码适配器，一期预留接口，返回"暂未开通"。
 */
export interface LoginAdapter {
  readonly method: string;
  login(credentials: Record<string, string>): Promise<UserEntity>;
}

function badCredentials(): ApiException {
  return new ApiException('BAD_CREDENTIALS', HttpStatus.UNAUTHORIZED, '用户名或密码错误');
}

export async function loginWithPassword(
  userRepo: Repository<UserEntity>,
  credentials: { username: string; password: string },
): Promise<UserEntity> {
  const user = await userRepo.findOne({ where: { username: credentials.username } });
  if (!user || !user.passwordHash) throw badCredentials();
  const ok = await compare(credentials.password, user.passwordHash);
  if (!ok) throw badCredentials();
  if (user.status === 'banned') {
    throw new ApiException('USER_BANNED', HttpStatus.FORBIDDEN, '账号已被封禁');
  }
  return user;
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, 10);
}

@Injectable()
export class DevPasswordLoginAdapter implements LoginAdapter {
  readonly method = 'dev-password';

  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async login(credentials: Record<string, string>): Promise<UserEntity> {
    return loginWithPassword(this.userRepo, credentials as { username: string; password: string });
  }

  /** flag 关闭时 dev 登录接口整体不可用（隐藏登录页不受影响）。 */
  isFlagEnabled(): boolean {
    return this.config.devPasswordLogin;
  }
}

@Injectable()
export class WechatQrLoginAdapter implements LoginAdapter {
  readonly method = 'wechat-qr';

  /** 一期预留：微信开放平台资质就绪后在此对接 OAuth 扫码流程。 */
  async login(): Promise<UserEntity> {
    throw new ApiException(
      'WECHAT_NOT_AVAILABLE',
      HttpStatus.NOT_IMPLEMENTED,
      '微信扫码登录暂未开通',
    );
  }
}

/* -------------------------------- 服务 -------------------------------- */

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(SessionEntity) private readonly sessionRepo: Repository<SessionEntity>,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async register(input: {
    username: string;
    password: string;
    nickname?: string;
  }): Promise<UserEntity> {
    const existing = await this.userRepo.findOne({ where: { username: input.username } });
    if (existing) {
      throw new ApiException('USERNAME_TAKEN', HttpStatus.CONFLICT, '用户名已被占用');
    }
    const user = this.userRepo.create({
      id: crypto.randomUUID(),
      username: input.username,
      nickname: input.nickname?.trim() || `用户_${randomBytes(2).toString('hex')}`,
      passwordHash: await hashPassword(input.password),
      role: 'user',
      status: 'active',
      wechatUnionid: null,
      aiConfig: null,
    });
    return this.userRepo.save(user);
  }

  async createSession(user: UserEntity): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const session = this.sessionRepo.create({
      id: token,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await this.sessionRepo.save(session);
    return token;
  }

  /** 会话解析：过期/不存在/用户被封禁返回明确错误（spec-03：登录过期不再静默失败）。 */
  async resolveSession(token: string): Promise<UserEntity> {
    const session = await this.sessionRepo.findOne({ where: { id: token } });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw ApiException.authRequired('登录已过期，请重新登录');
    }
    const user = await this.userRepo.findOne({ where: { id: session.userId } });
    if (!user) throw ApiException.authRequired();
    if (user.status === 'banned') {
      throw new ApiException('USER_BANNED', HttpStatus.FORBIDDEN, '账号已被封禁');
    }
    return user;
  }

  async logout(token: string): Promise<void> {
    await this.sessionRepo.delete({ id: token });
  }

  /** 懒清理过期会话。 */
  async pruneExpiredSessions(): Promise<void> {
    await this.sessionRepo.delete({ expiresAt: LessThan(new Date()) });
  }

  getUserRepository(): Repository<UserEntity> {
    return this.userRepo;
  }

  isDevLoginEnabled(): boolean {
    return this.config.devPasswordLogin;
  }

  isSecureCookie(): boolean {
    return this.config.nodeEnv === 'production';
  }
}
