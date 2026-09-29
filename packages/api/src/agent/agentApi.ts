/** Agent 客户端协议；认证沿用共享 API Client，不将 token 放入 URL。 */
import { apiClient } from '../client';

export interface AgentThreadView {
  /** 会话 UUID。 */
  id: string;
  /** 用户可见标题。 */
  title: string | null;
}
export interface AgentRunView {
  /** 运行 UUID。 */
  id: string;
  /** 用户目标。 */
  goal: string;
  /** 整体运行状态。 */
  status: string;
  /** 是否因错误暂停调度。 */
  executionPaused: boolean;
  /** 已请求取消，尚不代表停止完成。 */
  cancelRequested: boolean;
  /** 稳定错误代码。 */
  lastErrorCode: string | null;
}
export interface AgentMessageView {
  /** 消息 UUID。 */
  id: string;
  /** 可见角色。 */
  role: 'user' | 'assistant';
  /** 首版文本块。 */
  content: Array<{ type: 'text'; text: string }>;
  /** 关联运行。 */
  runId: string;
}
export interface AgentArtifactView {
  /** 固定版本 UUID。 */
  id: string;
  /** 稳定成果 UUID。 */
  artifactId: string;
  /** 不可变版本序号。 */
  version: number;
  /** 提纲或草稿。 */
  kind: 'outline' | 'draft';
  /** 成果标题。 */
  title: string;
  /** Markdown 正文。 */
  content: string;
  /** 证据分析结果；null 表示未分析，不代表没有冲突。 */
  evidence: { items: Array<{ type: string; description: string; sourceLabels: string[] }> } | null;
}
export interface AgentRunDetail {
  /** 当前运行事实。 */
  run: AgentRunView;
  /** 运行来源快照。 */
  sources: Array<{ id: string; docId: string; title: string; excerpt: string; citationLabel: string | null }>;
  /** 本次运行发布的成果版本。 */
  artifacts: AgentArtifactView[];
  /** 固定参数对应的确认。 */
  confirmations: Array<{ id: string; callId: string; status: string; expiresAt: string }>;
  /** 保存绑定及批准前预览。 */
  saves: Array<{ id: string; status: string; documentId: string; folderId: string | null; artifactVersionId: string; title: string; content: string }>;
  /** 真实用量；未知为 null，预占额度单独展示。 */
  modelCalls: Array<{ id: string; model: string; status: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; reservedTokens: number | null }>;
}
export interface AgentSubmitInput {
  /** 同次请求的网络重试复用同一键。 */
  requestKey: string;
  /** 本次目标正文。 */
  text: string;
  /** 统一 Agent 的交互模式。 */
  mode: 'dialogue' | 'task';
  /** 可选固定成果与版本；范围按 UTF-16 半开区间。 */
  revisionTarget?: { artifactId: string; baseVersion: number; range?: { start: number; end: number } };
}

export const agentApi = {
  /** 查询配置，不会发起模型健康请求。 */
  status: (): Promise<{ ready: boolean; modelConfigured: boolean; model: string | null }> => apiClient.get('/agent/status'),
  /** 最近 100 个会话。 */
  threads: (): Promise<AgentThreadView[]> => apiClient.get('/agent/threads'),
  /** 创建会话。 */
  createThread: (title?: string): Promise<AgentThreadView> => apiClient.post('/agent/threads', { title }),
  /** 读取最近 100 条消息和运行。 */
  thread: (id: string): Promise<{ thread: AgentThreadView; messages: AgentMessageView[]; runs: AgentRunView[] }> => apiClient.get(`/agent/threads/${id}`),
  /** 幂等提交请求。 */
  submit: (threadId: string, input: AgentSubmitInput): Promise<{ run: AgentRunView }> => apiClient.post(`/agent/threads/${threadId}/messages`, input),
  /** 读取当前事实快照。 */
  run: (id: string): Promise<AgentRunDetail> => apiClient.get(`/agent/runs/${id}`),
  /** 准备保存固定版本。 */
  save: (threadId: string, input: { requestKey: string; artifactVersionId: string; folderId: string | null }): Promise<{ run: AgentRunView }> => apiClient.post(`/agent/threads/${threadId}/saves`, input),
  /** 批准或拒绝固定确认。 */
  decide: (runId: string, id: string, callId: string, accept: boolean): Promise<unknown> => apiClient.post(`/agent/runs/${runId}/confirmations/${id}`, { callId, accept }),
  /** 请求取消；后续仍需读取运行终态。 */
  cancel: (id: string): Promise<unknown> => apiClient.post(`/agent/runs/${id}/cancel`),
  /** 原操作恢复，不克隆 Run 或重置预算。 */
  resume: (id: string): Promise<unknown> => apiClient.post(`/agent/runs/${id}/resume`),
  /** 带序号读取事件补页。 */
  events: (id: string, after = 0): Promise<{ events: Array<{ sequence: number; body: { type: string } }>; nextAfter: number; hasMore: boolean }> =>
    apiClient.get(`/agent/runs/${id}/events`, { params: { after } }),
  /** 浏览器 SSE：共享认证拦截器负责鉴权和刷新，增量解析完整帧，取消时终止连接。 */
  async stream(id: string, after: number, signal: AbortSignal, onEvent: (sequence: number) => void): Promise<void> {
    let consumed = 0;
    let last = after;
    let lastRefresh = 0;
    const consume = (text: string) => {
      let end: number;
      while ((end = text.indexOf('\n\n', consumed)) >= 0) {
        const frame = text.slice(consumed, end);
        consumed = end + 2;
        if (/^event:\s*heartbeat\s*$/m.test(frame) && Date.now() - lastRefresh > 5000) { lastRefresh = Date.now(); onEvent(last); }
        const match = /^id:\s*(\d+)\s*$/m.exec(frame);
        if (match && /^event:\s*agent\s*$/m.test(frame)) {
          const sequence = Number(match[1]);
          if (Number.isSafeInteger(sequence) && sequence > last) { last = sequence; onEvent(sequence); }
        }
      }
    };
    const result = await apiClient.get<string, string>(`/agent/runs/${id}/stream`, {
      params: { after }, responseType: 'text', timeout: 70000, signal, adapter: 'xhr',
      onDownloadProgress: (progress) => {
        const xhr = progress.event?.target as { responseText?: string } | undefined;
        if (typeof xhr?.responseText === 'string') consume(xhr.responseText);
      },
    });
    if (typeof result === 'string') consume(result);
  },
};
