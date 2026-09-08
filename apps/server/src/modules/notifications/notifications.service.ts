/**
 * 用户通知服务。
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Notification } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }): Promise<Notification> {
    const row = this.repo.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? null,
      readAt: null,
    });
    return this.repo.save(row);
  }

  async list(userId: string, limit = 50): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.repo.update({ id, userId }, { readAt: new Date() });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }
}
