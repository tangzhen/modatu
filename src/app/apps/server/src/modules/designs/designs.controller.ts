import { z } from 'zod';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, SessionGuard } from '../auth/auth.guards';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { ApiException } from '../../common/errors';
import type { UserEntity } from '../../db/entities/user.entity';
import { DesignsService } from './designs.service';
import { designModelSchema } from '@modatu/design-model';

const createDesignSchema = z.object({
  name: z.string().min(1).max(80),
  model: designModelSchema.optional(),
});

const saveModelSchema = z.object({
  model: designModelSchema,
  baseVersion: z.number().int().positive(),
  summary: z.string().max(120).optional(),
});

const renameSchema = z.object({ name: z.string().min(1).max(80) });

const restoreSchema = z.object({ baseVersion: z.number().int().positive() });

const bomSchema = z.object({ model: designModelSchema.optional() });

@Controller('designs')
@UseGuards(SessionGuard)
export class DesignsController {
  constructor(private readonly designs: DesignsService) {}

  @Post()
  create(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(createDesignSchema)) body: z.infer<typeof createDesignSchema>,
  ) {
    return this.designs.create(user, body.name, body.model);
  }

  @Get()
  list(@CurrentUser() user: UserEntity) {
    return this.designs.listMine(user);
  }

  @Get(':id')
  get(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.designs.getOwned(user, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameSchema)) body: z.infer<typeof renameSchema>,
  ) {
    return this.designs.rename(user, id, body.name);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    await this.designs.softDelete(user, id);
    return { ok: true };
  }

  /** 自动保存：乐观锁（spec-02）。 */
  @Put(':id/model')
  saveModel(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveModelSchema)) body: z.infer<typeof saveModelSchema>,
  ) {
    return this.designs.saveModel(user, id, body);
  }

  @Get(':id/versions')
  versions(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.designs.listVersions(user, id);
  }

  @Post(':id/versions/:seq/restore')
  restore(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Param('seq') seq: string,
    @Body(new ZodValidationPipe(restoreSchema)) body: z.infer<typeof restoreSchema>,
  ) {
    const parsedSeq = Number(seq);
    if (!Number.isInteger(parsedSeq) || parsedSeq < 1) {
      throw ApiException.validation('版本号非法');
    }
    return this.designs.restore(user, id, parsedSeq, body.baseVersion);
  }

  /** BOM 预览/生成（spec-05：清单不是存储快照，始终由当前模型生成）。 */
  @Post(':id/bom')
  bom(
    @CurrentUser() user: UserEntity,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bomSchema)) body: z.infer<typeof bomSchema>,
  ) {
    return this.designs.bom(user, id, body.model);
  }
}
