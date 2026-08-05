/**
 * AI 笔记问答页（第一期 RAG）。
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { getApiErrorMessage } from '@inkweaver/api';
import { aiService } from '@inkweaver/services';
import type { AiCitation, AiPingResponse } from '@inkweaver/api';

export const AiAskPage: React.FC = () => {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AiCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AiPingResponse | null>(null);

  useEffect(() => {
    aiService
      .ping()
      .then(setStatus)
      .catch(() =>
        setStatus({
          ok: false,
          chatConfigured: false,
          embedConfigured: false,
          embedHealthy: false,
        }),
      );
  }, []);

  const handleAsk = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError('');
    setAnswer('');
    setCitations([]);

    try {
      const result = await aiService.ask(trimmed);
      setAnswer(result.answer);
      setCitations(result.citations ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, '问答失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Sparkles size={22} />
        笔记问答
      </h2>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        基于你的笔记做检索增强回答。需本机嵌入服务与云端生成模型可用。
      </p>

      {status && !status.ok && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            background: '#fff7ed',
            color: '#9a3412',
            fontSize: 14,
          }}
        >
          AI 依赖未就绪：chat=
          {status.chatConfigured ? '已配置' : '未配置'}，embed=
          {status.embedConfigured ? '已配置' : '未配置'}，健康=
          {status.embedHealthy ? '正常' : '异常'}。请检查嵌入服务 / FRP 与
          AI_CHAT_* 环境变量。
        </div>
      )}

      <form onSubmit={handleAsk} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label htmlFor="ai-question" style={{ fontWeight: 500 }}>
          问题
        </label>
        <textarea
          id="ai-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={4}
          placeholder="例如：我上周关于同步架构的结论是什么？"
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            resize: 'vertical',
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="primary-btn"
          style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        >
          {loading ? '思考中…' : '提问'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: '#dc2626', marginTop: 16 }}>
          {error}
        </p>
      )}

      {answer && (
        <section style={{ marginTop: 24 }}>
          <h3>回答</h3>
          <div
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
              padding: 16,
              background: '#f8fafc',
              borderRadius: 8,
            }}
          >
            {answer}
          </div>
        </section>
      )}

      {citations.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3>引用来源</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {citations.map((citation, index) => (
              <li
                key={`${citation.docId}-${citation.chunkIndex}-${index}`}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/documents/${citation.docId}`)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: 600,
                  }}
                >
                  [{index + 1}] {citation.title}
                </button>
                <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 13 }}>
                  {citation.excerpt}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
