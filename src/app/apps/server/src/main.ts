import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  type ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import type { Request, Response } from 'express';

/** 兜底异常过滤器：未知错误统一 500 { code: 'INTERNAL_ERROR' }。 */
@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(body);
      return;
    }
    console.error(`[unhandled] ${req.method} ${req.url}`, exception);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forConfig(config), {
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors({
    origin: config.corsOrigin.split(','),
    credentials: true, // 会话 Cookie 跨域携带（dev: 5173 → 3001 经 Vite 代理同源，仍保留）
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api');

  await app.listen(config.port);
  console.log(`Modatu server listening on http://127.0.0.1:${config.port}/api`);
  console.log(
    `dev 账密登录: ${config.devPasswordLogin ? '开启' : '关闭'}（隐藏登录页始终可用: /login/hidden）`,
  );
}

void bootstrap();
