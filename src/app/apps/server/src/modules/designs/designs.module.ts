import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DesignEntity, DesignVersionEntity } from '../../db/entities/design.entity';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DesignsService } from './designs.service';
import { DesignsController } from './designs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DesignEntity, DesignVersionEntity]),
    CatalogModule,
    AuthModule,
  ],
  controllers: [DesignsController],
  providers: [DesignsService],
  exports: [DesignsService],
})
export class DesignsModule {}
