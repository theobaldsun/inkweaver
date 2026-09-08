/**
 * 公开分享文档只读页（无需登录）。
 */

import { documentApi, getApiErrorMessage } from '@inkweaver/api';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { sanitizeDocumentHtml } from '../utils/sanitizeDocumentHtml';

export const SharedDocumentPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('链接无效');
      setLoading(false);
      return;
    }
    documentApi
      .getSharedDocument(token)
      .then((doc) => {
        setTitle(doc.title);
        setContent(doc.content);
      })
      .catch((err) => setError(getApiErrorMessage(err, '无法加载分享文档')))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="shared-doc-page">
        <p>加载中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-doc-page">
        <p>{error}</p>
        <Link to="/login">前往登录</Link>
      </div>
    );
  }

  return (
    <div className="shared-doc-page">
      <header className="shared-doc-page__header">
        <h1>{title || '无标题'}</h1>
        <Link to="/login">登录 InkWeaver</Link>
      </header>
      <article
        className="shared-doc-page__body"
        dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(content || '<p>暂无内容</p>') }}
      />
    </div>
  );
};
