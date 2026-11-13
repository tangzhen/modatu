import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DesignsModule } from '../designs/designs.module';
import { ExportController } from './export.controller';

@Module({
  imports: [DesignsModule, AuthModule],
  controllers: [ExportController],
})
export class ExportModule {}
