/** 统一 Agent 工作台：对话与任务共用会话、运行、来源和成果；保存必须展示固定草稿后明确确认。 */
import { agentApi, folderApi, getApiErrorMessage } from '@inkweaver/api';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { AgentArtifactView, AgentMessageView, AgentRunDetail, AgentRunView, AgentSubmitInput, AgentThreadView } from '@inkweaver/api';
import type { Folder } from '@inkweaver/shared';

import '../styles/agent.css';

const terminal = (status: string) => ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status); // 终止状态
const statusLabel: Record<string, string> = { CREATED: '准备中', QUEUED: '排队中', RUNNING: '进行中', WAITING_CONFIRMATION: '等待确认', COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', TIMED_OUT: '已超时' };

function flattenFolders(folders: Folder[], prefix = ''): Array<{ id: string; name: string }> {
  return folders.flatMap((folder) => [{ id: folder.id, name: prefix + folder.name }, ...flattenFolders(folder.children ?? [], prefix + folder.name + ' / ')]);
} // 展平文件夹树，添加前缀

/**
 * 将模型正文中的引用标签渲染为指向本 Run 来源的链接；普通正文按纯文本显示。
 *
 * 策略：
 * 1. 用带捕获组的正则切分，让 [S1] 这类标签本身也成为独立片段，便于逐段判断。
 * 2. 标签命中本 Run 来源表 → 渲染为文档链接；未命中 → 退化为纯文本，不产生死链。
 * 3. 只返回字符串与 React 元素，不使用 dangerouslySetInnerHTML，模型夹带的 HTML 不会被执行。
 *
 * @param text 模型产出的正文；属于不可信数据，只按文本处理。
 * @param detail 当前 Run 快照；为 null（未加载或接口不可用）时全部按纯文本渲染。
 * @returns 可直接作为 children 渲染的片段数组。
 */
function citedText(text: string, detail: AgentRunDetail | null): React.ReactNode {
  return text.split(/(\[S[1-9]\d*\])/g).map((part, index) => {
    // 只对本 Run 的来源建链：服务端已校验标签与来源一一对应，避免指向未授权或不存在的文档。
    const source = detail?.sources.find((item) => part === `[${item.citationLabel}]`);
    return source ? <Link key={index} to={`/documents/${source.docId}`}>{part}</Link> : part;
  });
}

export const AgentPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread') ?? '';
  const runId = params.get('run') ?? '';
  const [status, setStatus] = useState<{ ready: boolean; modelConfigured: boolean } | null>(null);
  const [threads, setThreads] = useState<AgentThreadView[]>([]);
  const [messages, setMessages] = useState<AgentMessageView[]>([]);
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [mode, setMode] = useState<'dialogue' | 'task'>('dialogue');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [folderId, setFolderId] = useState('');
  const [selection, setSelection] = useState<{ versionId: string; start: number; end: number } | null>(null);
  // 网络失败后保留同一请求键；用户改参数时换键，防止“重试”生成重复操作。
  const request = useRef<{ signature: string; key: string } | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    void agentApi.status().then(async (value) => {
      if (stopped) return;
      setStatus(value);
      if (value.ready) {
        const [list, tree] = await Promise.all([agentApi.threads(), folderApi.getFolderTree()]);
        if (!stopped) { setThreads(list); setFolders(flattenFolders(tree)); }
      }
    }).catch((reason) => { if (!stopped) setError(getApiErrorMessage(reason)); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    setMessages([]); setRuns([]); setDetail(null); setSelection(null);
    if (!threadId || !status?.ready) return;
    let stopped = false;
    let loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    let after = 0;
    let done = false;
    const load = async () => {
      if (stopped || loading) return;
      loading = true;
      try {
        const [thread, run] = await Promise.all([agentApi.thread(threadId), runId ? agentApi.run(runId) : Promise.resolve(null)]);
        if (!stopped) {
          setMessages(thread.messages); setRuns(thread.runs); setDetail(run);
          done = !!run && terminal(run.run.status);
        }
      } catch (reason) { if (!stopped) setError(getApiErrorMessage(reason)); }
      finally { loading = false; }
    };
    refresh.current = load;
    const subscribe = async () => {
      await load();
      if (!runId || stopped || done) return;
      try {
        await agentApi.stream(runId, after, abort.signal, (sequence) => { after = sequence; void load(); });
      } catch { /* 状态快照负责补齐；断线后复用序号重新订阅，不改变运行状态。 */ }
      if (!stopped && !done) timer = setTimeout(() => { void subscribe(); }, 2000);
    };
    void subscribe();
    return () => { stopped = true; abort.abort(); if (timer) clearTimeout(timer); refresh.current = async () => {}; };
  }, [threadId, runId, status?.ready]);

  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await refresh.current(); }
    catch (reason) { setError(getApiErrorMessage(reason, '操作失败，请重试')); }
    finally { setBusy(false); }
  };
  const keyFor = (value: unknown) => {
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  };
  const submit = async (revisionTarget?: AgentSubmitInput['revisionTarget']) => {
    if (!text.trim() || !status?.modelConfigured) return;
    await act(async () => {
      let current = threadId;
      if (!current) {
        const thread = await agentApi.createThread(text.trim().slice(0, 80));
        current = thread.id; setThreads((previous) => [thread, ...previous]); setParams({ thread: current });
      }
      const input = { text: text.trim(), mode: revisionTarget ? 'task' as const : mode, revisionTarget };
      const result = await agentApi.submit(current, { ...input, requestKey: keyFor({ thread: current, ...input }) });
      request.current = null; setText(''); setParams({ thread: current, run: result.run.id });
    });
  };
  const save = (artifact: AgentArtifactView) => act(async () => {
    const input = { artifactVersionId: artifact.id, folderId: folderId || null };
    const result = await agentApi.save(threadId, { ...input, requestKey: keyFor({ threadId, ...input }) });
    request.current = null; setParams({ thread: threadId, run: result.run.id });
  });

  return <main className="agent-page">
    <header className="agent-header"><div><h1>知识助手</h1><p>与资料对话，将思考整理为成果。</p></div>
      <button type="button" disabled={busy || !status?.ready} onClick={() => setParams({})}>新会话</button></header>
    {error && <p role="alert" className="agent-notice">{error}</p>}
    {status && !status.ready && <p role="status" className="agent-notice">功能尚未启用，服务端需要完成数据准备。</p>}
    {status?.ready && !status.modelConfigured && <p role="status" className="agent-notice">模型调用已关闭。可以查看历史和处理已有成果，暂时不能生成新回答。</p>}
    <div className="agent-layout">
      <aside className="agent-history" aria-label="会话历史"><h2>会话</h2>
        {!threads.length && <p>还没有会话</p>}
        {threads.map((thread) => <button key={thread.id} type="button" aria-pressed={threadId === thread.id} disabled={busy}
          onClick={() => setParams({ thread: thread.id })}>{thread.title || '未命名会话'}</button>)}
      </aside>
      <section className="agent-conversation" aria-label="对话与任务">
        <div className="agent-modes" aria-label="运行模式">
          <button type="button" aria-pressed={mode === 'dialogue'} onClick={() => setMode('dialogue')}>对话</button>
          <button type="button" aria-pressed={mode === 'task'} onClick={() => setMode('task')}>任务</button>
        </div>
        <p className="agent-hint">{mode === 'dialogue' ? '检索、追问和综合解答。' : '生成提纲与草稿，审阅后决定是否保存。'} 当前资料范围：个人知识库。</p>
        <div className="agent-messages" aria-label="最近消息">
          {!messages.length && <p className="agent-empty">从一个问题，或一个想完成的目标开始。</p>}
          {messages.map((message) => <article key={message.id} className={`agent-message agent-message-${message.role}`}>
            <strong>{message.role === 'user' ? '你' : '助手'}</strong>
            <div className="agent-prose">{message.content.map((block) => block.text).join('\n')}</div>
            <button type="button" className="agent-link" onClick={() => setParams({ thread: threadId, run: message.runId })}>查看本次运行</button>
          </article>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="agent-goal">{mode === 'task' ? '任务目标或修订要求' : '你的问题'}</label>
          <textarea id="agent-goal" value={text} maxLength={8000} rows={4} onChange={(event) => setText(event.target.value)} placeholder="例如：综合相关资料，整理主要结论与证据缺口" />
          <button type="submit" className="agent-primary" disabled={busy || !status?.modelConfigured || !text.trim()}>{busy ? '处理中…' : '开始'}</button>
        </form>
      </section>
      <aside className="agent-results" aria-label="运行与成果">
        <h2>运行与成果</h2>
        <label htmlFor="agent-run">运行历史</label>
        <select id="agent-run" value={runId} onChange={(event) => setParams({ thread: threadId, ...(event.target.value ? { run: event.target.value } : {}) })}>
          <option value="">选择运行</option>{runs.map((run) => <option key={run.id} value={run.id}>{statusLabel[run.status] ?? run.status} · {run.goal.slice(0, 30)}</option>)}
        </select>
        {detail && <>
          <p role="status">{detail.run.cancelRequested && !terminal(detail.run.status) ? '正在取消…' : statusLabel[detail.run.status] ?? detail.run.status}</p>
          {detail.run.lastErrorCode && <p className="agent-notice">本次运行已暂停：{detail.run.lastErrorCode}</p>}
          {!terminal(detail.run.status) && <div className="agent-actions">
            {detail.run.executionPaused && <button type="button" disabled={busy || detail.run.cancelRequested} onClick={() => void act(async () => { await agentApi.resume(runId); })}>重试原操作</button>}
            <button type="button" disabled={busy || detail.run.cancelRequested} onClick={() => void act(async () => { await agentApi.cancel(runId); })}>取消运行</button>
          </div>}
          {detail.artifacts.map((artifact) => <section key={artifact.id} className="agent-artifact">
            <h3>{artifact.title} · v{artifact.version}</h3>
            <div className="agent-prose">{citedText(artifact.content, detail)}</div>
            {artifact.evidence ? <details><summary>证据检查（仍需人工审阅）</summary>
              {!artifact.evidence.items.length && <p>本次分析未列出问题，不代表内容已经核实。</p>}
              {artifact.evidence.items.map((item, index) => <p key={index}>{item.type === 'conflict' ? '冲突' : '缺口'}：{item.description} {item.sourceLabels.join('、')}</p>)}
            </details> : <p className="agent-hint">本版本尚未进行结构化证据检查。</p>}
            {artifact.kind === 'draft' && <>
              <details><summary>修订草稿</summary><p>在左侧填写修订要求。局部修订请在下方选择原文。</p>
                <textarea aria-label="选择需要修订的原文" readOnly value={artifact.content} rows={6} onSelect={(event) => {
                  const node = event.currentTarget;
                  setSelection({ versionId: artifact.id, start: node.selectionStart, end: node.selectionEnd });
                }} />
                <div className="agent-actions"><button type="button" disabled={busy || !text.trim() || !status?.modelConfigured}
                  onClick={() => void submit({ artifactId: artifact.artifactId, baseVersion: artifact.version })}>整稿修订</button>
                  <button type="button" disabled={busy || !text.trim() || !status?.modelConfigured || selection?.versionId !== artifact.id || selection.start === selection.end}
                    onClick={() => { if (selection) void submit({ artifactId: artifact.artifactId, baseVersion: artifact.version, range: { start: selection.start, end: selection.end } }); }}>修订选中部分</button></div>
              </details>
              <label htmlFor={`folder-${artifact.id}`}>保存位置</label><select id={`folder-${artifact.id}`} value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                <option value="">根目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
              <button type="button" disabled={busy} onClick={() => void save(artifact)}>准备保存此版本</button>
            </>}
          </section>)}
          {detail.saves.map((saved) => <section key={saved.id} className="agent-artifact"><h3>保存预览：{saved.title}</h3>
            <p>位置：{saved.folderId ? folders.find((folder) => folder.id === saved.folderId)?.name ?? '指定文件夹' : '根目录'}</p>
            <details><summary>查看即将保存的完整内容</summary><div className="agent-prose">{saved.content}</div></details>
            {saved.status === 'SAVED' && <Link to={`/documents/${saved.documentId}`}>打开已保存文档</Link>}
          </section>)}
          {detail.confirmations.filter((item) => item.status === 'PENDING').map((confirmation) => <section key={confirmation.id} className="agent-notice">
            <p>是否将上方预览内容保存为新文档？确认截止：{new Date(confirmation.expiresAt).toLocaleString()}</p>
            <div className="agent-actions"><button type="button" disabled={busy || Date.now() >= Date.parse(confirmation.expiresAt)} onClick={() => void act(async () => { await agentApi.decide(runId, confirmation.id, confirmation.callId, true); })}>确认保存</button>
              <button type="button" disabled={busy} onClick={() => void act(async () => { await agentApi.decide(runId, confirmation.id, confirmation.callId, false); })}>拒绝</button></div>
          </section>)}
          {!!detail.sources.length && <section><h3>来源</h3>{detail.sources.map((source) => <details key={source.id}>
            <summary>{source.citationLabel ? `[${source.citationLabel}] ` : ''}{source.title}</summary><p>{source.excerpt}</p><Link to={`/documents/${source.docId}`}>打开原文</Link>
          </details>)}</section>}
          {!!detail.modelCalls.length && <details><summary>模型用量</summary>{detail.modelCalls.map((call) => <p key={call.id}>{call.model} · 实际 Token：{call.totalTokens ?? '未返回'} · 预占额度：{call.reservedTokens ?? '未知'}</p>)}</details>}
        </>}
      </aside>
    </div>
  </main>;
};
