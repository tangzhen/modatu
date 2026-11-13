import { z } from 'zod';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, SessionGuard, AdminOnly } from '../auth/auth.guards';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { CatalogService } from './catalog.service';

/* --------------------------------- schemas --------------------------------- */

const loadRatingSchema = z.object({ span: z.number().positive(), load: z.number().nonnegative() });

const profileUpsertSchema = z.object({
  id: z.string().optional(),
  code: z.string().regex(/^[0-9]{3,5}$/, '规格代号须为数字（如 3030）'),
  series: z.string().min(1).max(40),
  width: z.number().positive(),
  height: z.number().positive(),
  slotWidth: z.number().positive(),
  slotDepth: z.number().positive(),
  massPerMeter: z.number().nonnegative(),
  minCutLength: z.number().positive(),
  maxCutLength: z.number().positive(),
  loadRatings: z.array(loadRatingSchema).default([]),
  enabled: z.boolean().default(true),
});

const connectorUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  category: z.enum(['corner-bracket', 't-bolt', 'other']),
  enabled: z.boolean().default(true),
});

const compatibilityUpsertSchema = z.object({
  id: z.string().optional(),
  connectorId: z.string().min(1),
  profileCodeA: z.string().min(1),
  profileCodeB: z.string().min(1),
  quantityPerJoint: z.number().positive(),
});

const panelMaterialUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  thicknesses: z.array(z.number().positive()).min(1),
  density: z.number().positive(),
  enabled: z.boolean().default(true),
});

const safetyRuleUpsertSchema = z.object({
  id: z.string().optional(),
  ruleType: z.enum(['max-unsupported-span', 'panel-span-load']),
  params: z.record(z.union([z.number(), z.string()])),
  messageTemplate: z.string().min(1),
  enabled: z.boolean().default(true),
});

/* ------------------------------ 公共只读接口 ------------------------------ */

/**
 * 只读目录接口（spec-01：稳定对外读取、仅启用条目、可缓存）。
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** 聚合快照（编辑器/AI 一次取全量启用条目）。 */
  @Get()
  async all() {
    return this.catalog.snapshot();
  }

  @Get('profiles')
  async profiles() {
    return (await this.catalog.snapshot()).profiles;
  }

  @Get('connectors')
  async connectors() {
    const snap = await this.catalog.snapshot();
    return { connectors: snap.connectors, compatibilities: snap.compatibilities };
  }

  @Get('panel-materials')
  async panelMaterials() {
    return (await this.catalog.snapshot()).panelMaterials;
  }

  @Get('safety-rules')
  async safetyRules() {
    return (await this.catalog.snapshot()).safetyRules;
  }
}

/* ------------------------------- 后台管理接口 ------------------------------- */

@Controller('admin/catalog')
@UseGuards(SessionGuard, AdminGuard)
@AdminOnly()
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('profiles')
  listProfiles(@Query('q') q?: string) {
    return this.catalog.adminListProfiles(q);
  }

  @Put('profiles')
  saveProfile(@Body(new ZodValidationPipe(profileUpsertSchema)) dto: unknown) {
    return this.catalog.saveProfile(dto as never);
  }

  @Put('profiles/:id/enabled')
  async setProfileEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.catalog.setEnabled('profiles', id, body.enabled === true);
    return { ok: true };
  }

  @Get('connectors')
  listConnectors(@Query('q') q?: string) {
    return this.catalog.adminListConnectors(q);
  }

  @Put('connectors')
  saveConnector(@Body(new ZodValidationPipe(connectorUpsertSchema)) dto: unknown) {
    return this.catalog.saveConnector(dto as never);
  }

  @Put('connectors/:id/enabled')
  async setConnectorEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.catalog.setEnabled('connectors', id, body.enabled === true);
    return { ok: true };
  }

  @Get('compatibilities')
  listCompatibilities() {
    return this.catalog.adminListCompatibilities();
  }

  @Put('compatibilities')
  saveCompatibility(@Body(new ZodValidationPipe(compatibilityUpsertSchema)) dto: unknown) {
    return this.catalog.saveCompatibility(dto as never);
  }

  @Delete('compatibilities/:id')
  deleteCompatibility(@Param('id') id: string) {
    return this.catalog.deleteCompatibility(id);
  }

  @Get('panel-materials')
  listPanelMaterials(@Query('q') q?: string) {
    return this.catalog.adminListPanelMaterials(q);
  }

  @Put('panel-materials')
  savePanelMaterial(@Body(new ZodValidationPipe(panelMaterialUpsertSchema)) dto: unknown) {
    return this.catalog.savePanelMaterial(dto as never);
  }

  @Put('panel-materials/:id/enabled')
  async setPanelMaterialEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.catalog.setEnabled('panel-materials', id, body.enabled === true);
    return { ok: true };
  }

  @Get('safety-rules')
  listSafetyRules() {
    return this.catalog.adminListSafetyRules();
  }

  @Put('safety-rules')
  saveSafetyRule(@Body(new ZodValidationPipe(safetyRuleUpsertSchema)) dto: unknown) {
    return this.catalog.saveSafetyRule(dto as never);
  }

  @Put('safety-rules/:id/enabled')
  async setSafetyRuleEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.catalog.setEnabled('safety-rules', id, body.enabled === true);
    return { ok: true };
  }
}
