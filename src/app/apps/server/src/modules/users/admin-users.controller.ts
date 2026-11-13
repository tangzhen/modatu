import { z } from 'zod';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { UserEntity } from '../../db/entities/user.entity';
import { AdminGuard, SessionGuard } from '../auth/auth.guards';
import { AdminOnly } from '../auth/auth.guards';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { ApiException } from '../../common/errors';

const banSchema = z.object({});

/**
 * 后台用户管理（spec-03 一期范围：列表、搜索、封禁/解封）。
 */
@Controller('admin/users')
@UseGuards(SessionGuard, AdminGuard)
@AdminOnly()
export class AdminUsersController {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  @Get()
  async list(@Query('q') q?: string): Promise<
    Array<{
      id: string;
      username: string | null;
      nickname: string;
      role: string;
      status: string;
      createdAt: string;
    }>
  > {
    const qb = this.userRepo.createQueryBuilder('u').orderBy('u.createdAt', 'DESC').limit(200);
    if (q) {
      qb.andWhere('(LOWER(u.username) LIKE LOWER(:q) OR LOWER(u.nickname) LIKE LOWER(:q))', {
        q: `%${q}%`,
      });
    }
    const users = await qb.getMany();
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  @Post(':id/ban')
  async ban(@Param('id') id: string): Promise<{ id: string; status: string }> {
    return this.setStatus(id, 'banned');
  }

  @Post(':id/unban')
  async unban(@Param('id') id: string): Promise<{ id: string; status: string }> {
    return this.setStatus(id, 'active');
  }

  private async setStatus(id: string, status: 'banned' | 'active') {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw ApiException.notFound('用户不存在');
    user.status = status;
    await this.userRepo.save(user);
    return { id: user.id, status };
  }
}

// banSchema 保留给未来扩展（当前封禁无请求体）
void banSchema;
