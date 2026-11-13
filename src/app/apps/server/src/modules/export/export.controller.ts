import { z } from 'zod';
import { Body, Controller, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, SessionGuard } from '../auth/auth.guards';
import { ZodValidationPipe } from '../../common/zod-pipe';
import type { UserEntity } from '../../db/entities/user.entity';
import { DesignsService } from '../designs/designs.service';
import { renderBomPdf } from './bom-pdf';
import { APP_CONFIG_TOKEN, type AppConfig } from '../../config/config';

const exportSchema = z.object({
  designId: z.string().uuid(),
  model: z.unknown().optional(),
});

/**
 * 带水印 PDF 导出（spec-05）：仅登录用户（水印需要身份）。
 * Buffer 必须经原生 res 发送，避免 Nest 将其 JSON 序列化。
 */
@Controller('export')
@UseGuards(SessionGuard)
export class ExportController {
  constructor(
    private readonly designs: DesignsService,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  @Post('bom-pdf')
  async bomPdf(
    @CurrentUser() user: UserEntity,
    @Body(new ZodValidationPipe(exportSchema)) body: z.infer<typeof exportSchema>,
    @Res() res: Response,
  ): Promise<void> {
    const design = await this.designs.getOwned(user, body.designId);
    const model = (body.model as never) ?? design.model;
    const { bom } = await this.designs.bom(user, design.id, model);
    const { bytes } = await renderBomPdf(
      bom,
      {
        userId: user.id,
        nickname: user.nickname,
        designName: design.name,
        generatedAt: new Date(),
      },
      { fontPath: this.config.fontPath },
    );
    res.status(200);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="modatu-bom-${design.id}.pdf"`);
    res.send(Buffer.from(bytes));
  }
}
