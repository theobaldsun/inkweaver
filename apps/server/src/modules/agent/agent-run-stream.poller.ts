import { Logger } from '@nestjs/common';

import type { MessageEvent } from '@nestjs/common';
import type { Subscriber } from 'rxjs';

import type { AgentEventReader } from './agent-event.reader';

/**
 * 只声明轮询器真正用到的三个下行动作。
 *
 * 收窄依赖的好处：一是调用方一眼看出这个类对外部世界的全部要求；
 * 二是测试可以直接传一个记录调用的普通对象，不必构造真实 Subscriber 或做类型断言。
 */
export type AgentEventSink = Pick<Subscriber<MessageEvent>, 'next' | 'error' | 'complete'>;

/** 轮询器依赖；reader 由调用方以 manager 构造（无状态 Helper 约定，不在此建立连接）。 */
export interface AgentRunStreamPollerOptions {
  sink: AgentEventSink;
  reader: AgentEventReader;
  userId: string;
  runId: string;
  /** 起始游标（排他）：只推 sequence 更大的事件。 */
  cursor: number;
  /** 最长存活截止时间戳（毫秒）；到点主动 complete，交由客户端重连。 */
  deadline: number;
  /** 每批最多拉取多少条；缺省 100。 */
  batchSize?: number;
}

/**
 * 把一次 SSE 订阅的生命周期收拢成一个对象：
 * `start()` 点火、`stop()` 取消，中间只有"取一批 → 推 → 排下一轮"这一条自持链。
 *
 * 职责切分（刻意不让轮询函数同时做编排）：
 * - `pollOnce` 只做一件事：取一批、推给订阅者、推进游标，返回"是否还有更多"；
 * - `runPoll`  只做编排：前置守卫 → 调 pollOnce → 决定下一轮节奏；
 * - `scheduleNext` 只做调度，把"追平快拉、空闲慢拉"的策略显式命名出来。
 *
 * `stopped` 之所以是实例字段而不是 `runPoll` 的局部变量：`stop()` 与轮询之间必须
 * 存在一条通信通道，而 JS 的 async 函数无法被外部抢占式中断——取消只能"置标志位 +
 * 恢复执行时自查"。写成局部变量则 stop() 拿不到引用，取消会整体失效。
 */
export class AgentRunStreamPoller {
  private readonly logger = new Logger(AgentRunStreamPoller.name);
  private readonly batchSize: number;
  /** 排他游标：已推到的最大 sequence。 */
  private next: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private started = false;

  constructor(private readonly options: AgentRunStreamPollerOptions) {
    this.next = options.cursor;
    this.batchSize = options.batchSize ?? 100;
  }

  /** 唯一入口：启动轮询链。重复调用无效。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.runPoll();
  }

  /** 取消：置标志阻止后续轮询，并清掉尚未触发的定时器。幂等。 */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 取一批、推给订阅者、推进游标；只回答"还有没有更多"，不决定何时再来。 */
  private pollOnce = async (): Promise<boolean> => {
    const page = await this.options.reader.list(this.options.userId, this.options.runId, this.next, this.batchSize);
    // 每条的 id = 事件序号：客户端 EventSource 靠它自动带回 Last-Event-ID 续传，保证不漏事件。
    for (const event of page.events) {
      this.options.sink.next({ id: String(event.sequence), type: 'agent', data: event });
    }
    this.next = page.nextAfter;
    // 本批为空说明已追平：发心跳保活，让客户端确认连接仍在线；刻意不带 id，否则会推进客户端游标。
    if (!page.events.length) this.options.sink.next({ type: 'heartbeat', data: {} });
    return page.hasMore;
  };

  /** 编排层：前置守卫 → pollOnce → 排下一轮。这是整条链上唯一的自持点。 */
  private runPoll = async (): Promise<void> => {
    if (this.stopped) return;
    if (Date.now() >= this.options.deadline) {
      this.options.sink.complete();
      return;
    }
    let hasMore = false;
    try {
      hasMore = await this.pollOnce();
    } catch (error) {
      this.fail(error);
      return;
    }
    // pollOnce 内部的 await 期间连接可能已被取消，必须二次检查后再排下一轮；
    // 少了这一行，轮询链会为一个已经不存在的订阅持续查库。
    if (this.stopped) return;
    this.scheduleNext(hasMore);
  };

  /** 追平阶段 0 秒立即再拉（尽快把积压推完），空闲阶段 1 秒一轮；兼顾低延迟与不空转。 */
  private scheduleNext(hasMore: boolean): void {
    this.timer = setTimeout(() => { void this.runPoll(); }, hasMore ? 0 : 1000);
  }

  /** 读失败只发稳定码，原始错误进日志；重连由 EventSource 自动完成（带 Last-Event-ID）。 */
  private fail(error: unknown): void {
    // 已取消时 subscriber.error 是 no-op（RxJS 的 isStopped 保护），无需再发一次错误。
    if (this.stopped) return;
    this.logger.warn(`Agent 事件流读取失败 runId=${this.options.runId}：${String(error)}`);
    // cause 保留原始错误供日志与栈追踪使用，响应体里只暴露稳定领域码。
    this.options.sink.error(new Error('AGENT_STREAM_UNAVAILABLE', { cause: error }));
  }
}
