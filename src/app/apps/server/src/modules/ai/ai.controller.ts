import { z } from 'zod';
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser, SessionGuard } from '../auth/auth.guards';
import { ZodValidationPipe } from '../../common/zod-pipe';
import type { UserEntity } from '../../db/entities/user.entity';
import { DesignsService } from '../designs/designs.service';
import { designModelSchema, type DesignModel } from '@modatu/design-model';
import { AiService } from './ai.service';

const settingsSchema = z.object({
  baseUrl: z.string().url({ message: 'API 地址必须是合法 URL' }),
  apiKey: z.string().min(4).max(200).optional(),
  model: z.string().min(1).max(80),
});

const generateSchema = z.object({ prompt: z.string().min(2).max(2000) });

const modifySchema = z
  .object({
    designId: z.string().uuid().optional(),
    model: designModelSchema.optional(),
    instruction: z.string().min(2).max(2000),
  })
  .refine((v) => v.designId !== undefined || v.model !== undefined, {
    message: '必须提供 designId 或 model',
  });

const validateSchemaDto = z.object({ model: z.unknown() });

@Controller('ai')
@UseGuards(SessionGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly designs: DesignsService,
  ) {}

  /* ------------------------------ BYOK 设置 ------------------------------ */

  @Get('settings')
  settings(@CurrentUser() user: UserEntity) {
    return this.ai.getSettings(user);
  }

  @Put('settings')
  async saveSettings(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    await this.ai.saveSettings(user, body);
    return { ok: true };
  }

  @Delete('settings')
  async clearSettings(@CurrentUser() user: UserEntity) {
    await this.ai.clearSettings(user);
    return { ok: true };
  }

  /* ---------------------------- 生成 / 修改 ---------------------------- */

  /** 生成初始设计提案（不落库；前端 diff 预览确认后走保存管道）。 */
  @Post('generate')
  generate(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
  ) {
    return this.ai.generate(user, body.prompt);
  }

  /** 修改提案：返回系统侧 diff + 未满足项（spec-06）。 */
  @Post('modify')
  async modify(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(modifySchema)) body: z.infer<typeof modifySchema>,
  ) {
    let current = body.model as DesignModel | undefined;
    if (body.designId) {
      const design = await this.designs.getOwned(user, body.designId);
      current = design.model;
    }
    const result = await this.ai.modify(user, current as DesignModel, body.instruction);
    return result;
  }

  /** 最终守门校验（应用前调用，与保存管道同一校验器）。 */
  @Post('validate')
  validate(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(validateSchemaDto)) body: z.infer<typeof validateSchemaDto>,
  ) {
    return this.ai.validateModel(body.model);
  }
}
