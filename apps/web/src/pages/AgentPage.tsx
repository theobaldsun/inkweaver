/** 统一 Agent 工作台：对话与任务共用会话、运行、来源和成果；保存必须展示固定草稿后明确确认。 */
import { agentApi, folderApi, getApiErrorMessage } from '@inkweaver/api';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { AgentArtifactView, AgentMessageView, AgentRunDetail, AgentRunView, AgentSubmitInput, AgentThreadView } from '@inkweaver/api';
import type { Folder } from '@inkweaver/shared';

import '../styles/agent.css';

/** 判断 Run 是否已进入终态（不再变化，订阅循环可停止）。 */
const terminal = (status: string) => ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status); // 终止状态
/** 后端 Run.status 枚举 → 用户可见中文标签，统一在右栏与下拉框复用。 */
const statusLabel: Record<string, string> = { CREATED: '准备中', QUEUED: '排队中', RUNNING: '进行中', WAITING_CONFIRMATION: '等待确认', COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', TIMED_OUT: '已超时' };

/**
 * 把嵌套文件夹树展平为一维列表，并在名称前加上父级路径前缀，便于保存时选择目标文件夹。
 * 递归实现：每层把自己的 name 拼到 prefix 后，再继续深入 children。
 */
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
  // 本组件是 Agent 工作台唯一页面，三栏布局：
  //   左：会话历史（thread 列表）；中：对话/任务输入与消息流；右：选中 Run 的运行与成果。
  // 所有数据刷新都依赖下方 subscribe 的 SSE 流 + 断线 2s 轮询，组件本身不轮询业务接口。
  // URL 搜索参数承载当前选中的 thread / run，作为组件唯一身份来源（刷新/分享链接可还原视图）。
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread') ?? '';
  const runId = params.get('run') ?? '';
  // 服务端能力状态：ready=数据准备完成可创建/提交；modelConfigured=模型已开启可生成新回答（仅查看历史时为 false）。
  const [status, setStatus] = useState<{ ready: boolean; modelConfigured: boolean } | null>(null);
  const [threads, setThreads] = useState<AgentThreadView[]>([]); // 左栏：当前用户会话列表
  const [messages, setMessages] = useState<AgentMessageView[]>([]); // 中栏：当前会话的消息流
  const [runs, setRuns] = useState<AgentRunView[]>([]); // 中栏：当前会话的运行历史（供右栏下拉选择）
  const [detail, setDetail] = useState<AgentRunDetail | null>(null); // 右栏：选中 Run 的完整快照（来源/成果/保存/确认）
  const [mode, setMode] = useState<'dialogue' | 'task'>('dialogue'); // 交互模式：对话（检索追问）/ 任务（生成草稿）
  const [text, setText] = useState(''); // 输入框正文
  const [error, setError] = useState(''); // 全局错误提示（写入/订阅失败兜底）
  const [busy, setBusy] = useState(false); // 写操作锁：防止提交/保存/确认等并发点击
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]); // 保存时可选择的文件夹树（已展平）
  const [folderId, setFolderId] = useState(''); // 当前选中的保存目标文件夹（''=根目录）
  // 局部修订选区：用户在草稿正文里划选的文字区间（UTF-16 起止偏移），供"修订选中部分"使用。
  const [selection, setSelection] = useState<{ versionId: string; start: number; end: number } | null>(null);
  // 幂等请求键缓存：记录上一次请求的序列化签名与对应 UUID；网络重试复用同键，改参数换新键，防止重复提交。
  const request = useRef<{ signature: string; key: string } | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {}); // 指向当前会话的快照刷新函数，写操作后统一调用拉最新状态

  // 挂载初始化：查询能力状态（是否迁移完成 / 模型是否开启），就绪后再拉会话列表与文件夹树。
  // status.ready 决定页面能否创建/提交；modelConfigured 决定能否生成新回答。
  // 依赖数组为空：只在组件首次挂载执行一次。
  useEffect(() => {
    let stopped = false; // 卸载守卫：异步回调返回前若组件已卸载则丢弃结果，避免 setState 警告
    void agentApi.status().then(async (value) => {
      if (stopped) return;
      setStatus(value);
      if (value.ready) {
        // 能力与就绪都 OK 才拉会话与文件夹；Promise.all 并发两个独立请求
        const [list, tree] = await Promise.all([agentApi.threads(), folderApi.getFolderTree()]);
        if (!stopped) { setThreads(list); setFolders(flattenFolders(tree)); }
      }
    }).catch((reason) => { if (!stopped) setError(getApiErrorMessage(reason)); });
    return () => { stopped = true; };
  }, []);

  // 订阅选中会话/运行：首次快照（load）+ SSE 增量流（stream）。
  // 只要 Run 未终态（done=false）就持续订阅；断线后复用 after 序号 2s 后重订阅，避免漏事件。
  // 任何状态变化都通过 load() 拉最新快照补齐，因此订阅失败不影响最终一致性。
  // 依赖 [threadId, runId, status?.ready]：切换会话/运行或能力就绪后重新建立订阅。
  useEffect(() => {
    // 切换会话/运行时清空旧数据，避免旧会话内容在加载间隙闪现
    setMessages([]); setRuns([]); setDetail(null); setSelection(null);
    if (!threadId || !status?.ready) return;
    let stopped = false; // 卸载守卫
    let loading = false; // load 并发保护：避免 SSE 高频事件触发多次 load 互相覆盖
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController(); // 取消 SSE 连接（切换/卸载时）
    let after = 0; // SSE 断点续传序号：记录已消费的事件 sequence，断线后从此处续传
    let done = false; // 选中 Run 是否已进入终态，终态后不再重连
    const load = async () => {
      if (stopped || loading) return;
      loading = true;
      try {
        // 并发拉会话消息与（可选）运行详情；无 runId 时只拉会话
        const [thread, run] = await Promise.all([agentApi.thread(threadId), runId ? agentApi.run(runId) : Promise.resolve(null)]);
        if (!stopped) {
          setMessages(thread.messages); setRuns(thread.runs); setDetail(run);
          done = !!run && terminal(run.run.status); // 更新终态标记，决定是否继续订阅
        }
      } catch (reason) { if (!stopped) setError(getApiErrorMessage(reason)); }
      finally { loading = false; }
    };
    refresh.current = load; // 暴露给 act() 在写操作后统一刷新
    const subscribe = async () => {
      await load(); // 先拉一次完整快照，保证 UI 立即有数据
      if (!runId || stopped || done) return;
      try {
        // 订阅 SSE：每收到一个事件（sequence）就更新 after 并触发 load 拉最新快照
        await agentApi.stream(runId, after, abort.signal, (sequence) => { after = sequence; void load(); });
      } catch { /* 状态快照负责补齐；断线后复用序号重新订阅，不改变运行状态。 */ }
      // 连接断开且未终态：2s 后用最新 after 重订阅（续传，不重复已收事件）
      if (!stopped && !done) timer = setTimeout(() => { void subscribe(); }, 2000);
    };
    void subscribe();
    // 清理：停止加载、中止 SSE、清除定时器、使 refresh 失效
    return () => { stopped = true; abort.abort(); if (timer) clearTimeout(timer); refresh.current = async () => {}; };
  }, [threadId, runId, status?.ready]);

  // 通用写操作包装：串行化所有会改变服务端事实的操作（提交/保存/重试/取消/确认），
  // 用 busy 锁防重复点击，结束后统一刷新当前会话快照并兜底报错。
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await refresh.current(); }
    catch (reason) { setError(getApiErrorMessage(reason, '操作失败，请重试')); }
    finally { setBusy(false); }
  };
  // 幂等请求键：把一次逻辑提交的所有参数序列化为 signature；
  // 参数未变（如网络重试）复用同一 requestKey，让服务端按同键重放而非新建；
  // 参数变了（用户改了文本/模式/修订目标）则换新 UUID，避免把"改内容"误当成"重试"。
  const keyFor = (value: unknown) => {
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  };
  // 提交一次用户消息并触发一个 Run：
  // 1) 无 thread 时先建会话；2) 有 revisionTarget 强制走 task 模式（修订本质是任务）；
  // 3) 用 keyFor 生成 requestKey 随请求发出；4) 提交成功后清空输入框并跳转查看该 Run。
  const submit = async (revisionTarget?: AgentSubmitInput['revisionTarget']) => {
    if (!text.trim() || !status?.modelConfigured) return; // 空文本或未开启模型时禁止提交
    await act(async () => {
      let current = threadId;
      if (!current) {
        // 首次提交先创建会话：标题取正文前 80 字；创建后写入本地列表并切换 URL 参数
        const thread = await agentApi.createThread(text.trim().slice(0, 80));
        current = thread.id; setThreads((previous) => [thread, ...previous]); setParams({ thread: current });
      }
      // 修订请求强制走 task 模式；其余沿用当前 mode
      const input = { text: text.trim(), mode: revisionTarget ? 'task' as const : mode, revisionTarget };
      // 关键：requestKey 由参数签名生成，网络重试复用同键（服务端幂等重放），改内容换新键
      const result = await agentApi.submit(current, { ...input, requestKey: keyFor({ thread: current, ...input }) });
      request.current = null; setText(''); setParams({ thread: current, run: result.run.id }); // 清空输入并跳转查看新建的 Run
    });
  };
  // 准备保存：把某一 draft 版本按所选文件夹登记为待确认保存（不直接落库为文档，需后续用户在确认卡片批准）。
  const save = (artifact: AgentArtifactView) => act(async () => {
    const input = { artifactVersionId: artifact.id, folderId: folderId || null }; // 空 folderId 表示根目录
    const result = await agentApi.save(threadId, { ...input, requestKey: keyFor({ threadId, ...input }) });
    request.current = null; setParams({ thread: threadId, run: result.run.id }); // 跳转到该保存 Run 查看预览与确认
  });

  return <main className="agent-page">
    <header className="agent-header"><div><h1>知识助手</h1><p>与资料对话，将思考整理为成果。</p></div>
      {/* 新会话：清空 URL 参数回到无选中状态，触发 useEffect 重置并等待用户重新提交 */}
      <button type="button" disabled={busy || !status?.ready} onClick={() => setParams({})}>新会话</button></header>
    {error && <p role="alert" className="agent-notice">{error}</p>}
    {status && !status.ready && <p role="status" className="agent-notice">功能尚未启用，服务端需要完成数据准备。</p>}
    {status?.ready && !status.modelConfigured && <p role="status" className="agent-notice">模型调用已关闭。可以查看历史和处理已有成果，暂时不能生成新回答。</p>}
    <div className="agent-layout">
      {/* 左栏：会话历史，点击切换选中 thread（改变 URL 参数驱动订阅 effect） */}
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
            {/* 首版消息内容块只含文本；多块拼接为纯文本展示（模型夹带 HTML 不会执行） */}
            <div className="agent-prose">{message.content.map((block) => block.text).join('\n')}</div>
            <button type="button" className="agent-link" onClick={() => setParams({ thread: threadId, run: message.runId })}>查看本次运行</button>
          </article>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="agent-goal">{mode === 'task' ? '任务目标或修订要求' : '你的问题'}</label>
          <textarea id="agent-goal" value={text} maxLength={8000} rows={4} onChange={(event) => setText(event.target.value)} placeholder="例如：综合相关资料，整理主要结论与证据缺口" />
          {/* 提交按钮：未开启模型或空文本或正在操作时禁用 */}
          <button type="submit" className="agent-primary" disabled={busy || !status?.modelConfigured || !text.trim()}>{busy ? '处理中…' : '开始'}</button>
        </form>
      </section>
      <aside className="agent-results" aria-label="运行与成果">
        <h2>运行与成果</h2>
        <label htmlFor="agent-run">运行历史</label>
        {/* 从当前会话的 runs 下拉选择要查看的 Run；改变 run 参数会触发订阅 effect 重新拉取 */}
        <select id="agent-run" value={runId} onChange={(event) => setParams({ thread: threadId, ...(event.target.value ? { run: event.target.value } : {}) })}>
          <option value="">选择运行</option>{runs.map((run) => <option key={run.id} value={run.id}>{statusLabel[run.status] ?? run.status} · {run.goal.slice(0, 30)}</option>)}
        </select>
        {detail && <>
          {/* 状态行：取消中显示"正在取消…"；否则显示枚举对应的中文标签 */}
          <p role="status">{detail.run.cancelRequested && !terminal(detail.run.status) ? '正在取消…' : statusLabel[detail.run.status] ?? detail.run.status}</p>
          {detail.run.lastErrorCode && <p className="agent-notice">本次运行已暂停：{detail.run.lastErrorCode}</p>}
          {/* 未终态时提供取消/恢复操作；executionPaused 表示因错误暂停，可重试原操作 */}
          {!terminal(detail.run.status) && <div className="agent-actions">
            {detail.run.executionPaused && <button type="button" disabled={busy || detail.run.cancelRequested} onClick={() => void act(async () => { await agentApi.resume(runId); })}>重试原操作</button>}
            <button type="button" disabled={busy || detail.run.cancelRequested} onClick={() => void act(async () => { await agentApi.cancel(runId); })}>取消运行</button>
          </div>}
          {/* 成果列表：每个 artifact 对应一个提纲/草稿版本 */}
          {detail.artifacts.map((artifact) => <section key={artifact.id} className="agent-artifact">
            <h3>{artifact.title} · v{artifact.version}</h3>
            {/* 正文中的 [S1] 等引用标签在此渲染为可点击来源链接（citedText 已做服务端校验映射） */}
            <div className="agent-prose">{citedText(artifact.content, detail)}</div>
            {artifact.evidence ? <details><summary>证据检查（仍需人工审阅）</summary>
              {!artifact.evidence.items.length && <p>本次分析未列出问题，不代表内容已经核实。</p>}
              {artifact.evidence.items.map((item, index) => <p key={index}>{item.type === 'conflict' ? '冲突' : '缺口'}：{item.description} {item.sourceLabels.join('、')}</p>)}
            </details> : <p className="agent-hint">本版本尚未进行结构化证据检查。</p>}
            {/* 仅草稿（draft）支持修订与保存；提纲（outline）只读 */}
            {artifact.kind === 'draft' && <>
              <details><summary>修订草稿</summary><p>在左侧填写修订要求。局部修订请在下方选择原文。</p>
                {/* 只读文本框：用户划选文字时记录选区起止偏移，供"修订选中部分"使用 */}
                <textarea aria-label="选择需要修订的原文" readOnly value={artifact.content} rows={6} onSelect={(event) => {
                  const node = event.currentTarget;
                  setSelection({ versionId: artifact.id, start: node.selectionStart, end: node.selectionEnd });
                }} />
                <div className="agent-actions"><button type="button" disabled={busy || !text.trim() || !status?.modelConfigured}
                  onClick={() => void submit({ artifactId: artifact.artifactId, baseVersion: artifact.version })}>整稿修订</button>
                  {/* 局部修订：选区必须来自当前 artifact 且非空，否则禁用 */}
                  <button type="button" disabled={busy || !text.trim() || !status?.modelConfigured || selection?.versionId !== artifact.id || selection.start === selection.end}
                    onClick={() => { if (selection) void submit({ artifactId: artifact.artifactId, baseVersion: artifact.version, range: { start: selection.start, end: selection.end } }); }}>修订选中部分</button></div>
              </details>
              <label htmlFor={`folder-${artifact.id}`}>保存位置</label><select id={`folder-${artifact.id}`} value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                <option value="">根目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
              {/* 准备保存：仅登记待确认保存，不落库；后续由确认卡片批准 */}
              <button type="button" disabled={busy} onClick={() => void save(artifact)}>准备保存此版本</button>
            </>}
          </section>)}
          {/* 保存预览：展示将被创建为文档的内容，SAVED 后提供打开链接 */}
          {detail.saves.map((saved) => <section key={saved.id} className="agent-artifact"><h3>保存预览：{saved.title}</h3>
            <p>位置：{saved.folderId ? folders.find((folder) => folder.id === saved.folderId)?.name ?? '指定文件夹' : '根目录'}</p>
            <details><summary>查看即将保存的完整内容</summary><div className="agent-prose">{saved.content}</div></details>
            {saved.status === 'SAVED' && <Link to={`/documents/${saved.documentId}`}>打开已保存文档</Link>}
          </section>)}
          {/* 待确认卡片：用户在截止时间前批准/拒绝，过期后确认按钮禁用 */}
          {detail.confirmations.filter((item) => item.status === 'PENDING').map((confirmation) => <section key={confirmation.id} className="agent-notice">
            <p>是否将上方预览内容保存为新文档？确认截止：{new Date(confirmation.expiresAt).toLocaleString()}</p>
            <div className="agent-actions"><button type="button" disabled={busy || Date.now() >= Date.parse(confirmation.expiresAt)} onClick={() => void act(async () => { await agentApi.decide(runId, confirmation.id, confirmation.callId, true); })}>确认保存</button>
              <button type="button" disabled={busy} onClick={() => void act(async () => { await agentApi.decide(runId, confirmation.id, confirmation.callId, false); })}>拒绝</button></div>
          </section>)}
          {/* 来源区：列出本 Run 引用的资料，带标签与摘要，可打开原文 */}
          {!!detail.sources.length && <section><h3>来源</h3>{detail.sources.map((source) => <details key={source.id}>
            <summary>{source.citationLabel ? `[${source.citationLabel}] ` : ''}{source.title}</summary><p>{source.excerpt}</p><Link to={`/documents/${source.docId}`}>打开原文</Link>
          </details>)}</section>}
          {/* 模型用量：实际 token 与预占额度分开展示（预留≠实际消耗） */}
          {!!detail.modelCalls.length && <details><summary>模型用量</summary>{detail.modelCalls.map((call) => <p key={call.id}>{call.model} · 实际 Token：{call.totalTokens ?? '未返回'} · 预占额度：{call.reservedTokens ?? '未知'}</p>)}</details>}
        </>}
      </aside>
    </div>
  </main>;
};
