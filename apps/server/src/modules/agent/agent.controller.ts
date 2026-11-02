/** 认证后的 Agent API；用户归属只取认证上下文，工作流、模型及工具权限均由服务端选择。 */
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpException, Param, ParseUUIDPipe, Post, Query, Req, Sse, UseFilters, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';

import { AgentConversationStore } from './agent-conversation.store';
import { AgentEventReader } from './agent-event.reader';
import { AgentRunReader } from './agent-run.reader';
import { AgentRunStreamPoller } from './agent-run-stream.poller';
import { AgentService } from './agent.service';
import { AgentStreamRegistry } from './agent-stream.registry';
import { getUserId } from '../../common/get-user-id';
import { AuthGuard } from '../auth/guard/auth.guard';

import type { CreateAgentRequest } from './agent-conversation.store';
import type { PrepareAgentDocumentSave } from './agent-document-save.store';
import type { MessageEvent } from '@nestjs/common';
import type { Request, Response } from 'express';

/** 对外只返回稳定领域码；不将 SQL、供应商异常或正文暴露为错误消息。 */
@Catch()
export class AgentApiErrorFilter implements ExceptionFilter {
  /**
   * 统一异常出口：把任意异常收敛成"稳定领域码 + 最小 HTTP 状态"，绝不下钻内部细节。
   *
   * 设计要点：
   * 1. 对外只暴露项目约定的稳定码（如 INVALID_AGENT_CONVERSATION_INPUT、AGENT_REQUEST_KEY_CONFLICT），
   *    SQL 报错、供应商异常、模型正文等一律不进入响应体，避免信息泄露。
   * 2. SSE 等已发送响应头的场景只能中断连接，不能再写 JSON。
   * 3. 内部领域错误约定把码放在 error.message（如 AgentConversationStoreError 的 super(code)），
   *    所以这里用大写下划线正则提取；非约定异常一律回退为 AGENT_REQUEST_FAILED。
   * 4. HTTP 语义：INVALID_* 归为 400（客户端输入问题），其余稳定码归为 409（状态/冲突，可重试语义）。
   */
  catch(error: unknown, host: ArgumentsHost): void {
    // 拿到本请求的 HTTP 响应对象（该过滤器仅作用于 HTTP 上下文）。
    const response = host.switchToHttp().getResponse<Response>();
    // 响应头已发出（典型如 SSE 流式推送中途抛错）：已无法再设状态/写 JSON，只能尽快结束连接，否则会抛 "headers already sent"。
    if (response.headersSent) { response.end(); return; }
    // Nest 标准 HTTP 异常：保留它原有的状态码与响应体，原样透传（如 404、401 等）。
    if (error instanceof HttpException) { response.status(error.getStatus()).json(error.getResponse()); return; }
    // 其余异常：提取稳定领域码。约定——内部领域错误的 message 即稳定码（全大写下划线、长度受限），
    // 命中则直接用；否则回退为 AGENT_REQUEST_FAILED，避免把任意异常文本暴露给客户端。
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'AGENT_REQUEST_FAILED';
    // 400 = 客户端输入非法；其余稳定码（冲突/状态不一致等）归 409，便于前端区分"重发"还是"改参数"。
    response.status(code.startsWith('INVALID_') ? 400 : 409).json({ message: code });
  }
}

@Controller('/api/agent')
@UseGuards(AuthGuard)
@UseFilters(AgentApiErrorFilter)
export class AgentController {
  /** 同一进程每用户最多四条 SSE 连接；防止浏览器重连堆积。 */
  private readonly streams = new AgentStreamRegistry();
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
    return this.reader.listThreads(getUserId(req.user));
  }

  /** 新建空会话，不触发运行。 */
  @Post('threads')
  async createThread(@Req() req: Request, @Body() body: {
    /** 会话展示标题；具体长度与空值归一化由持久化入口校验。 */
    title?: string;
  }) {
    return new AgentConversationStore(this.agent.dataSource.manager).createThread(getUserId(req.user), body?.title);
  }

  /** 会话最近消息和运行列表；所有查询都带用户归属，客户端不能指定 owner。 */
  @Get('threads/:id')
  async thread(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
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

  /** 运行的结构化快照：含已持久化成果、来源与待确认请求，不含隐藏推理。它是 SSE 流之前/断线重连时的"基准全量状态"——SSE 只推增量，打开 Run 或重连时须先读它再续传。 */
  @Get('runs/:id')
  async run(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
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
    return new AgentEventReader(this.agent.dataSource.manager).list(getUserId(req.user), id, after === undefined ? 0 : Number(after));
  }

  /**
   * 订阅单个 Run 的实时事件流（SSE）。它不是"真推送"，而是 SSE 封装的服务端轮询：
   * 每 1 秒（本页还有更多事件则 0 秒）去读事件表并增量推给客户端，最长存活 60 秒或不超过 token 有效期。
   *
   * 与 GET runs/:id（一次性结构化快照）的关系：本接口只推"游标之后的增量事件"，不给全量当前状态；
   * 客户端打开 Run、或 SSE 60 秒到期/断线重连时，仍要先 GET runs/:id 拿到结构化快照做基准，
   * 再用本接口的 after / Last-Event-ID 续传增量。即"快照 = 现在是什么样，流 = 之后发生了什么"，二者互补，不能互相替代。
   *
   * 约束：必须带 Authorization；每用户最多 4 条并发 SSE（防重连/多标签堆积）；游标非法直接拒。
   */
  @Sse('runs/:id/stream')
  async stream(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Query('after') after?: string): Promise<Observable<MessageEvent>> {
    const userId = getUserId(req.user);
    // 先校验该 Run 归属当前用户，避免越权订阅他人事件流。
    await this.reader.ownedRun(userId, id);
    // 游标优先取 SSE 规范的 Last-Event-ID（断线重连用），否则取 after 查询参数，缺省从 0 开始。
    const cursor = Number(req.headers['last-event-id'] ?? after ?? 0);
    // 游标必须是 32 位有符号整数范围内的安全整数，否则拒绝（防 NaN / 异常大值探测）。
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2147483647) throw new Error('INVALID_AGENT_EVENT_QUERY');
    return new Observable((subscriber) => {
      // 并发配额：申请成功才拿得到归还函数；超限直接以流错误拒绝（此时响应头未发，走 HTTP 异常过滤）。
      const release = this.streams.acquire(userId);
      if (!release) { subscriber.error(new Error('AGENT_STREAM_LIMIT')); return; }
      // 单条连接最长存活：min(60 秒, token 剩余有效期)，到期主动 complete 由客户端重连；不为长生连接。
      const exp = (req as Request & { user?: { exp?: number } }).user?.exp;
      const deadline = Math.min(Date.now() + 60000, exp ? exp * 1000 : Date.now() + 60000);
      const poller = new AgentRunStreamPoller({
        sink: subscriber, reader: new AgentEventReader(this.agent.dataSource.manager), userId, runId: id, cursor, deadline,
      });
      poller.start();
      // RxJS 在退订 / complete / error 时调用；stop() 与 release() 均幂等，重复调用无副作用。
      return () => { poller.stop(); release(); };
    });
  }
}
