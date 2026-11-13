import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../db/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DesignsModule } from '../designs/designs.module';
import { AiService, defaultAdapterFactory, LLM_ADAPTER_FACTORY } from './ai.service';
import { AiController } from './ai.controller';

/** 字符串别名令牌：规避打包器双实例下的 class 身份问题（测试取服务用）。 */
export const AI_SERVICE = 'AI_SERVICE';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), CatalogModule, DesignsModule, AuthModule],
  controllers: [AiController],
  providers: [
    AiService,
    { provide: AI_SERVICE, useExisting: AiService },
    { provide: LLM_ADAPTER_FACTORY, useValue: defaultAdapterFactory },
  ],
  exports: [AiService, AI_SERVICE],
})
export class AiModule {}
