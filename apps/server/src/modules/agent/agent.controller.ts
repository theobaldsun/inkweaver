/** 认证后的 Agent API；用户归属只取认证上下文，工作流、模型及工具权限均由服务端选择。 */
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpException, Param, ParseUUIDPipe, Post, Query, Req, Sse, UseFilters, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';

import { AgentConversationStore } from './agent-conversation.store';
import { AgentEventReader } from './agent-event.reader';
import { AgentRunReader } from './agent-run.reader';
import { AgentService } from './agent.service';
import { getUserId } from '../../common/get-user-id';
import { AuthGuard } from '../auth/guard/auth.guard';

import type { CreateAgentRequest } from './agent-conversation.store';
import type { PrepareAgentDocumentSave } from './agent-document-save.store';
import type { MessageEvent } from '@nestjs/common';
import type { Request, Response } from 'express';

/** 对外只返回稳定领域码；不将 SQL、供应商异常或正文暴露为错误消息。 */
@Catch()
export class AgentApiErrorFilter implements ExceptionFilter {
  /** HTTP 异常保留原状态；未知异常隐藏细节。 */
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) { response.end(); return; }
    if (error instanceof HttpException) { response.status(error.getStatus()).json(error.getResponse()); return; }
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'AGENT_REQUEST_FAILED';
    response.status(code.startsWith('INVALID_') ? 400 : 409).json({ message: code });
  }
}

@Controller('/api/agent')
@UseGuards(AuthGuard)
@UseFilters(AgentApiErrorFilter)
export class AgentController {
  /** 同一进程每用户最多四条 SSE 连接；防止浏览器重连堆积。 */
  private readonly streams = new Map<string, number>();
  /** 只读查询入口；使用服务已初始化的数据源，不自行建立连接。 */
  private readonly reader: AgentRunReader;

  constructor(private readonly agent: AgentService) {
    this.reader = new AgentRunReader(agent.dataSource.manager);
  }

  /** 就绪状态只检查配置与表结构，不执行健康探测或模型调用。 */
  @Get('status')
  status() { return this.agent.status(); }

  /** 会话列表按最近活跃倒序；首版最多返回 100 个。 */
  @Get('threads')
  async threads(@Req() req: Request) {
    await this.agent.ensureReady();
    return this.reader.listThreads(getUserId(req.user));
  }

  /** 新建空会话，不触发运行。 */
  @Post('threads')
  async createThread(@Req() req: Request, @Body() body: {
    /** 会话展示标题；具体长度与空值归一化由持久化入口校验。 */
    title?: string;
  }) {
    await this.agent.ensureReady();
    return new AgentConversationStore(this.agent.dataSource.manager).createThread(getUserId(req.user), body?.title);
  }

  /** 会话最近消息和运行列表；所有查询都带用户归属，客户端不能指定 owner。 */
  @Get('threads/:id')
  async thread(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.agent.ensureReady();
    return this.reader.threadDetail(getUserId(req.user), id);
  }

  /** 文本请求只接收产品参数，忽略任何客户端提供的工具权限、模型地址或 workflowVersion。 */
  @Post('threads/:id/messages')
  submit(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: {
      /** 客户端逻辑请求幂等键；不能代替用户归属或授权检查。 */
      requestKey: string;
      /** 单条用户文本；结构化内容由服务端构造，避免客户端伪造角色或工具消息。 */
      text: string;
      /** 对话或任务工作流选择；具体工作流版本由服务端固定。 */
      mode: 'dialogue' | 'task';
      /** 可选的成果修订目标；服务端仍需检查版本归属与范围。 */
      revisionTarget?: CreateAgentRequest['revisionTarget'];
    }) {
    return this.agent.submit(getUserId(req.user), { threadId: id, requestKey: body?.requestKey, mode: body?.mode,
      content: [{ type: 'text', text: body?.text }], revisionTarget: body?.revisionTarget });
  }

  /** 为所选版本准备保存确认；不接受直接文档内容。 */
  @Post('threads/:id/saves')
  save(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: PrepareAgentDocumentSave) {
    return this.agent.prepareSave(getUserId(req.user), id, { requestKey: body?.requestKey, artifactVersionId: body?.artifactVersionId, folderId: body?.folderId });
  }

  /** 运行快照用于刷新/重连；包含已持久化成果、来源与待确认请求，不包含隐藏推理。 */
  @Get('runs/:id')
  async run(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.agent.ensureReady();
    return this.reader.snapshot(getUserId(req.user), id);
  }

  /** 显式恢复被错误暂停的运行；不重置额度。 */
  @Post('runs/:id/resume')
  async resume(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.agent.resume(getUserId(req.user), id); return { accepted: true };
  }

  /** 取消结果异步落终态；客户端继续读事件/快照确认停止。 */
  @Post('runs/:id/cancel')
  async cancel(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.agent.cancel(getUserId(req.user), id); return { accepted: true };
  }

  /** 处理明确的批准或拒绝；字符串、缺失值不能转换成批准。 */
  @Post('runs/:id/confirmations/:confirmationId')
  decide(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string,
    @Param('confirmationId', new ParseUUIDPipe()) confirmationId: string, @Body() body: {
      /** 确认对应的工具调用；服务端校验它与 Run、确认记录的绑定。 */
      callId: string;
      /** 必须是显式 boolean；仅 true 才表示批准。 */
      accept: boolean;
    }) {
    return this.agent.decide(getUserId(req.user), id, body?.callId, confirmationId, body?.accept);
  }

  /** 事件历史按 Run 内序号分页；用于 SSE 断线补齐。 */
  @Get('runs/:id/events')
  async events(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Query('after') after?: string) {
    await this.agent.ensureReady();
    return new AgentEventReader(this.agent.dataSource.manager).list(getUserId(req.user), id, after === undefined ? 0 : Number(after));
  }

  /** 带 Authorization 头订阅；最多持续 60 秒且不超过 token 有效期，重连使用 Last-Event-ID。 */
  @Sse('runs/:id/stream')
  async stream(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Query('after') after?: string): Promise<Observable<MessageEvent>> {
    await this.agent.ensureReady();
    const userId = getUserId(req.user);
    await this.reader.ownedRun(userId, id);
    const cursor = Number(req.headers['last-event-id'] ?? after ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2147483647) throw new Error('INVALID_AGENT_EVENT_QUERY');
    return new Observable((subscriber) => {
      const count = this.streams.get(userId) ?? 0;
      if (count >= 4) { subscriber.error(new Error('AGENT_STREAM_LIMIT')); return; }
      this.streams.set(userId, count + 1);
      let next = cursor;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const exp = (req as Request & { user?: { exp?: number } }).user?.exp;
      const deadline = Math.min(Date.now() + 60000, exp ? exp * 1000 : Date.now() + 60000);
      const poll = async () => {
        try {
          if (stopped) return;
          if (Date.now() >= deadline) { subscriber.complete(); return; }
          const page = await new AgentEventReader(this.agent.dataSource.manager).list(userId, id, next, 100);
          if (stopped) return;
          for (const event of page.events) subscriber.next({ id: String(event.sequence), type: 'agent', data: event });
          next = page.nextAfter;
          if (!page.events.length) subscriber.next({ type: 'heartbeat', data: {} });
          timer = setTimeout(() => { void poll(); }, page.hasMore ? 0 : 1000);
        } catch { subscriber.error(new Error('AGENT_STREAM_UNAVAILABLE')); }
      };
      void poll();
      return () => { stopped = true; if (timer) clearTimeout(timer); const remaining = (this.streams.get(userId) ?? 1) - 1;
        if (remaining) this.streams.set(userId, remaining); else this.streams.delete(userId); };
    });
  }
}
