/**
 * 当前 Server 进程内的执行取消桥接。
 * 数据库 cancelRequested 才是持久事实；本表只负责把取消尽快传给本进程持有的 AbortController。
 */

interface ActiveExecution {
  /** 当前执行尝试，防止旧清理误删后续尝试。 */
  attemptId: string;
  /** 当前 Worker 身份，仅用于进程内诊断与精确注销。 */
  workerId: string;
  /** 执行器持有的协作式取消控制器。 */
  controller: AbortController;
}

function key(userId: string, runId: string, callId: string): string {
  return `${userId}:${runId}:${callId}`;
}

/** 进程内取消注册表；跨进程取消依赖数据库标记 + 执行器心跳轮询。 */
export class ToolExecutionRegistry {
  private readonly active = new Map<string, ActiveExecution>();

  /** 注册当前尝试；同一逻辑调用在一个进程中不能同时持有两个本地执行器。 */
  register(userId: string, runId: string, callId: string, attemptId: string, workerId: string, controller: AbortController): () => void {
    const identity = key(userId, runId, callId);
    const existing = this.active.get(identity);
    if (existing && existing.attemptId !== attemptId) throw new Error('LOCAL_EXECUTION_ALREADY_REGISTERED');
    this.active.set(identity, { attemptId, workerId, controller });
    return () => {
      const current = this.active.get(identity);
      if (current?.attemptId === attemptId && current.workerId === workerId) this.active.delete(identity);
    };
  }

  /** 尽快通知本进程当前尝试；返回 false 只表示执行器不在本进程，不能据此判断任务已停止。 */
  cancel(userId: string, runId: string, callId: string): boolean {
    const current = this.active.get(key(userId, runId, callId));
    if (!current) return false;
    current.controller.abort();
    return true;
  }
}

/** 默认进程级实例；未来 Nest 装配可显式注入独立实例，但 Executor 与 Control 必须共享。 */
export const defaultToolExecutionRegistry = new ToolExecutionRegistry();
