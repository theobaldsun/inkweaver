/**
 * SSE 并发配额：按用户计数，申请成功才交出归还函数。
 *
 * 之所以让 acquire 返回归还函数而不是暴露 dec/inc 接口，是为了把"申请—归还"变成
 * 一次配对操作：调用方不可能归还一个从未申请成功的槽位，也不会因重复退订重复归还。
 */
export class AgentStreamRegistry {
  /** 每用户当前持有的连接数；计数归零即删键，避免 Map 随用户数单调增长。 */
  private readonly counts = new Map<string, number>();

  /**
   * 默认单用户上限。取 4 而非 1 的理由：
   * - EventSource 断线重连与旧连接的 complete 之间存在窗口，刷新页面时新旧连接也会重叠；
   * - 多标签页各看各的 Run 本就该同时存在；
   * - 设成 1 需要"踢掉旧连接"的抢占协议，且异常客户端能把正常连接踢掉，故障不隔离。
   * 4 是容错额度而非业务配额：对正常用户透明，同时把每用户最坏轮询量压在 4 次/秒。
   */
  static readonly defaultLimit = 4;

  /** 申请一个连接槽。超限返回 null；成功返回幂等的归还函数。 */
  acquire(userId: string, limit: number = AgentStreamRegistry.defaultLimit): (() => void) | null {
    const count = this.counts.get(userId) ?? 0;
    if (count >= limit) return null;
    this.counts.set(userId, count + 1);
    let released = false;
    return () => {
      // RxJS 已保证 teardown 只调用一次，这里是防未来改动引入二次调用的双保险。
      if (released) return;
      released = true;
      // 条目缺失时按 0 计：正常路径下 acquire 必然先 set，这里只可能在异常路径命中，
      // 减完的结果不会写回 Map，因此不会出现负计数。
      const remaining = (this.counts.get(userId) ?? 0) - 1;
      if (remaining > 0) this.counts.set(userId, remaining);
      else this.counts.delete(userId);
    };
  }

  /** 当前持有连接数；仅供诊断与测试断言使用，业务逻辑不依赖它。 */
  count(userId: string): number {
    return this.counts.get(userId) ?? 0;
  }
}
