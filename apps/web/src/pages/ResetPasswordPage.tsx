/**
 * 通过邮件链接重置密码。
 */

import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MIN_PASSWORD_LENGTH, isPasswordLengthValid } from '@inkweaver/shared';
import { authApi, getApiErrorMessage } from '@inkweaver/api';
import { Lock, Eye, EyeOff } from 'lucide-react';
import '../styles/auth.css';

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('链接无效或已过期');
      return;
    }
    if (!isPasswordLengthValid(password)) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (password !== confirm) {
      setError('两次密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(getApiErrorMessage(err, '重置失败，请重新申请链接'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>无效链接</h1>
          <p>请从邮件中打开完整重置链接，或重新申请忘记密码。</p>
          <Link to="/login">返回登录</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{done ? '密码已更新' : '设置新密码'}</h1>
        {done ? (
          <p>即将跳转到登录页…</p>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            {error && <div className="auth-error">{error}</div>}
            <label className="auth-field">
              <Lock size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-field__toggle"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </label>
            <label className="auth-field">
              <Lock size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="确认新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? '提交中…' : '重置密码'}
            </button>
          </form>
        )}
        <p className="auth-switch">
          <Link to="/login">返回登录</Link>
        </p>
      </div>
    </div>
  );
};
