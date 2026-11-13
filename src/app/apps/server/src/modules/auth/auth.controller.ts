import { z } from 'zod';
import { Body, Controller, Get, Inject, Post, Res, Req, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { APP_CONFIG_TOKEN, type AppConfig } from '../../config/config';
import {
  AuthService,
  DevPasswordLoginAdapter,
  LoginAdapter,
  WechatQrLoginAdapter,
} from './auth.service';
import {
  AuthedRequest,
  CurrentUser,
  SESSION_COOKIE,
  buildClearSessionCookie,
  buildSessionCookie,
  parseCookies,
} from './auth.guards';
import type { UserEntity } from '../../db/entities/user.entity';
import { SessionGuard } from './auth.guards';

const credentialsSchema = z.object({
  username: z.string().min(2).max(32),
  password: z.string().min(6).max(64),
});

const registerSchema = credentialsSchema.extend({
  nickname: z.string().min(1).max(20).optional(),
});

function publicUser(user: UserEntity) {
  return { id: user.id, username: user.username, nickname: user.nickname, role: user.role };
}

/** 公开运行配置：前端据此决定 dev 登录页可见性（不暴露任何敏感信息）。 */
export interface PublicConfig {
  devPasswordLogin: boolean;
  wechatLoginAvailable: boolean;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly devAdapter: DevPasswordLoginAdapter,
    @Inject(WechatQrLoginAdapter) private readonly wechatAdapter: LoginAdapter,
  ) {}

  /** dev 账密登录（flag 关闭时接口不可用，spec-03 测试决策）。 */
  @Post('login/dev')
  async devLogin(
    @Body(new ZodValidationPipe(credentialsSchema)) body: z.infer<typeof credentialsSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUserDto> {
    if (!this.devAdapter.isFlagEnabled()) {
      throw new ApiException('DEV_LOGIN_DISABLED', 404, '开发环境登录已关闭');
    }
    return this.loginWithAdapter(this.devAdapter, body, res);
  }

  /** 账密登录（隐藏登录页固定通道，不受 dev flag 限制；spec-03 决策 7）。 */
  @Post('login/password')
  async passwordLogin(
    @Body(new ZodValidationPipe(credentialsSchema)) body: z.infer<typeof credentialsSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUserDto> {
    return this.loginWithAdapter(this.devAdapter, body, res);
  }

  /** 微信扫码登录：一期预留适配器接口，返回"暂未开通"。 */
  @Post('login/wechat')
  async wechatLogin(): Promise<PublicUserDto> {
    // 适配器内部抛 WECHAT_NOT_AVAILABLE（501）
    const user = await this.wechatAdapter.login({});
    return publicUser(user);
  }

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUserDto> {
    const user = await this.auth.register(body);
    return this.issueSession(user, res);
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.auth.logout(token);
    res.setHeader('Set-Cookie', buildClearSessionCookie(this.auth.isSecureCookie()));
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: UserEntity): PublicUserDto {
    return publicUser(user);
  }

  private async loginWithAdapter(
    adapter: LoginAdapter,
    credentials: Record<string, string>,
    res: Response,
  ): Promise<PublicUserDto> {
    const user = await adapter.login(credentials);
    return this.issueSession(user, res);
  }

  private async issueSession(user: UserEntity, res: Response): Promise<PublicUserDto> {
    const token = await this.auth.createSession(user);
    res.setHeader('Set-Cookie', buildSessionCookie(token, this.auth.isSecureCookie()));
    return publicUser(user);
  }
}

export interface PublicUserDto {
  id: string;
  username: string | null;
  nickname: string;
  role: 'user' | 'admin';
}

@Controller('config')
export class ConfigController {
  constructor(@Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig) {}

  @Get()
  getConfig(): PublicConfig {
    return {
      devPasswordLogin: this.config.devPasswordLogin,
      wechatLoginAvailable: false,
    };
  }
}
