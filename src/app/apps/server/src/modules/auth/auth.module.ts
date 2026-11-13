import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEntity, UserEntity } from '../../db/entities/user.entity';
import { AuthService, DevPasswordLoginAdapter, WechatQrLoginAdapter } from './auth.service';
import { AdminGuard, SessionGuard } from './auth.guards';
import { AuthController, ConfigController } from './auth.controller';

/** 字符串别名令牌：规避打包器双实例下的 class 身份问题（测试取服务用）。 */
export const AUTH_SERVICE = 'AUTH_SERVICE';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SessionEntity])],
  controllers: [AuthController, ConfigController],
  providers: [
    AuthService,
    { provide: AUTH_SERVICE, useExisting: AuthService },
    DevPasswordLoginAdapter,
    WechatQrLoginAdapter,
    SessionGuard,
    AdminGuard,
  ],
  exports: [AuthService, AUTH_SERVICE, SessionGuard, AdminGuard],
})
export class AuthModule {}
