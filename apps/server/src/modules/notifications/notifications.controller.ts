/**
 * 通知 HTTP 接口。
 */

import { Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guard/auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('/api/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@Request() req: { user?: { sub: string } }) {
    const userId = req.user!.sub;
    const [items, unreadCount] = await Promise.all([
      this.notificationsService.list(userId, 50),
      this.notificationsService.unreadCount(userId),
    ]);
    return { items, unreadCount };
  }

  @Patch('/:id/read')
  async markRead(@Request() req: { user?: { sub: string } }, @Param('id') id: string) {
    await this.notificationsService.markRead(req.user!.sub, id);
    return { success: true };
  }

  @Post('/read-all')
  async markAllRead(@Request() req: { user?: { sub: string } }) {
    await this.notificationsService.markAllRead(req.user!.sub);
    return { success: true };
  }
}
