import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { hashPassword } from '../modules/auth/auth.service';
import { buildSeedCatalogIncludingDisabled } from '@modatu/catalog';
import { makeDbOptions } from '../db/database.module';
import { loadConfig } from '../config/config';
import {
  CompatibilityEntity,
  ConnectorEntity,
  PanelMaterialEntity,
  ProfileSpecEntity,
  SafetyRuleEntity,
} from '../db/entities/catalog.entity';
import { UserEntity } from '../db/entities/user.entity';
import { seedMaterials } from './materials';

/**
 * 初始化种子：首个管理员 + 初始知识库（spec-01 初始录入清单）。
 * 幂等：已存在的 code/username/id 跳过。
 * 用法：`npm run seed -w @modatu/server`
 * 环境变量：ADMIN_USERNAME（默认 admin）、ADMIN_PASSWORD（默认 admin12345，务必修改）。
 */
async function run(): Promise<void> {
  const config = loadConfig();
  const dataSource = new DataSource({
    ...(makeDbOptions(config) as DataSourceOptions),
    synchronize: true,
  });
  await dataSource.initialize();
  try {
    await seedAdmin(dataSource);
    await seedCatalog(dataSource);
    await seedMaterials(dataSource);
    console.log('Seed 完成。');
  } finally {
    await dataSource.destroy();
  }
}

async function seedAdmin(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(UserEntity);
  const username = process.env['ADMIN_USERNAME'] ?? 'admin';
  const password = process.env['ADMIN_PASSWORD'] ?? 'admin12345';
  const existing = await repo.findOne({ where: { username } });
  if (existing) {
    console.log(`管理员 ${username} 已存在，跳过。`);
    return;
  }
  await repo.save({
    id: randomUUID(),
    username,
    nickname: '管理员',
    passwordHash: await hashPassword(password),
    role: 'admin',
    status: 'active',
    wechatUnionid: null,
    aiConfig: null,
  } satisfies Partial<UserEntity> as UserEntity);
  console.log(`已创建管理员 ${username}（密码来自 ADMIN_PASSWORD 环境变量）。`);
}

async function seedCatalog(dataSource: DataSource): Promise<void> {
  const seed = buildSeedCatalogIncludingDisabled();

  const profileRepo = dataSource.getRepository(ProfileSpecEntity);
  for (const p of seed.profiles) {
    const existing = await profileRepo.findOne({ where: { code: p.code } });
    if (existing) {
      // 回填：旧库已存在的规格若无截面数据，补上种子截面（不动其他字段）
      if (!existing.crossSection && p.crossSection) {
        existing.crossSection = p.crossSection;
        await profileRepo.save(existing);
      }
      continue;
    }
    await profileRepo.save(profileRepo.create({ ...p, id: p.id || randomUUID() }));
  }

  const connectorRepo = dataSource.getRepository(ConnectorEntity);
  for (const c of seed.connectors) {
    if (await connectorRepo.findOne({ where: { id: c.id } })) continue;
    await connectorRepo.save(connectorRepo.create(c));
  }

  const compatRepo = dataSource.getRepository(CompatibilityEntity);
  for (const c of seed.compatibilities) {
    if (await compatRepo.findOne({ where: { id: c.id } })) continue;
    await compatRepo.save(compatRepo.create(c));
  }

  const materialRepo = dataSource.getRepository(PanelMaterialEntity);
  for (const m of seed.panelMaterials) {
    if (await materialRepo.findOne({ where: { id: m.id } })) continue;
    await materialRepo.save(materialRepo.create(m));
  }

  const ruleRepo = dataSource.getRepository(SafetyRuleEntity);
  for (const r of seed.safetyRules) {
    if (await ruleRepo.findOne({ where: { id: r.id } })) continue;
    await ruleRepo.save(ruleRepo.create(r));
  }

  console.log(
    `知识库种子完成：型材 ${seed.profiles.length}、连接件 ${seed.connectors.length}、兼容行 ${seed.compatibilities.length}、材质 ${seed.panelMaterials.length}、规则 ${seed.safetyRules.length}（已存在条目自动跳过）`,
  );
}

void run().catch((err) => {
  console.error('Seed 失败:', err);
  process.exitCode = 1;
});
