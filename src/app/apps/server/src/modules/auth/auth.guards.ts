import { ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { ApiException } from '../../common/errors';
import { AuthService } from './auth.service';
import type { UserEntity } from '../../db/entities/user.entity';

/* ---------------------------- Cookie 解析/写入 ---------------------------- */

export const SESSION_COOKIE = 'modatu_session';
const THIRTY_DAYS_SECONDS = 30 * 24 * 3600;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** httpOnly Cookie 会话（不用 localStorage token，spec-03 决策）。 */
export function buildSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS_SECONDS}${
    secure ? '; Secure' : ''
  }`;
}

export function buildClearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/* ------------------------------ 请求上下文 ------------------------------ */

export interface AuthedRequest extends Request {
  user?: UserEntity;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserEntity => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw ApiException.authRequired();
    return req.user;
  },
);

/* --------------------------------- 守卫 --------------------------------- */

@Injectable()
export class SessionGuard implements CanActivateCompat {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) throw ApiException.authRequired();
    return Promise.resolve(this.auth.resolveSession(token)).then((user) => {
      req.user = user;
      return true;
    });
  }
}

// NestJS v10 的 CanActivate 接口在 strict 模式下与返回值协变冲突时使用本兼容类型
interface CanActivateCompat {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean>;
}

export const IS_ADMIN_KEY = 'modatu:isAdmin';

/** 标记该路由需要 admin 角色（一期无 RBAC 细分）。 */
export const AdminOnly = () => SetMetadata(IS_ADMIN_KEY, true);

@Injectable()
export class AdminGuard implements CanActivateCompat {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw ApiException.authRequired();
    if (req.user.role !== 'admin') throw ApiException.forbidden('需要管理员权限');
    return true;
  }
}
