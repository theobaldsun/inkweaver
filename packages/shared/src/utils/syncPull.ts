/**
 * 同步分页水位规则（平台无关）。
 *
 * 用途：统一 Web 等客户端 pull 分页时的游标推进与终止条件。
 * 输入：当前游标与服务端页元数据；输出：下一游标 / latestUpdateId / 是否继续
 */

export interface SyncPullPageProgress {
  updateCount: number;
  nextCursor?: number;
  hasMore?: boolean;
  latestUpdateId?: number;
}

export interface ResolvedSyncPullPage {
  nextCursor: number;
  latestUpdateId: number;
  shouldContinue: boolean;
}

/**
 * 统一同步分页水位推进规则。
 *
 * 即使当前页只返回快照、没有增量 updates，也必须采用服务端 nextCursor；
 * 同时要求游标严格前进才继续分页，避免服务端异常响应造成重复拉取。
 */
export function resolveSyncPullPage(
  currentCursor: number,
  page: SyncPullPageProgress,
): ResolvedSyncPullPage {
  const nextCursor =
    typeof page.nextCursor === 'number' && Number.isFinite(page.nextCursor) && page.nextCursor >= 0
      ? page.nextCursor
      : currentCursor;
  const latestUpdateId =
    typeof page.latestUpdateId === 'number' && Number.isFinite(page.latestUpdateId)
      ? page.latestUpdateId
      : nextCursor;
  const shouldContinue =
    page.hasMore === true && nextCursor > currentCursor;

  return { nextCursor, latestUpdateId, shouldContinue };
}
