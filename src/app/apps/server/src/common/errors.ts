import { HttpException, HttpStatus } from '@nestjs/common';

/** 统一 API 错误码（spec-03：登录态问题返回明确错误码，前端据此引导）。 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'USER_BANNED'
  | 'USERNAME_TAKEN'
  | 'BAD_CREDENTIALS'
  | 'DEV_LOGIN_DISABLED'
  | 'WECHAT_NOT_AVAILABLE'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DESIGN_INVALID'
  | 'AI_NOT_CONFIGURED'
  | 'AI_OUTPUT_INVALID'
  | 'CONFLICT';

/** 统一错误响应体：{ code, message, [extra] }。 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    status: HttpStatus,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super({ code, message, ...extra }, status);
  }

  static validation(message: string, issues?: unknown): ApiException {
    return new ApiException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message, { issues });
  }
  static authRequired(message = '未登录或登录已过期'): ApiException {
    return new ApiException('AUTH_REQUIRED', HttpStatus.UNAUTHORIZED, message);
  }
  static forbidden(message = '无权访问'): ApiException {
    return new ApiException('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }
  static notFound(message = '资源不存在'): ApiException {
    return new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, message);
  }
}
