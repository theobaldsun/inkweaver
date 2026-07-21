/**
 * 登录 / 注册页
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginRequest, RegisterRequest } from '@inkweaver/shared';
import { MIN_PASSWORD_LENGTH, isPasswordLengthValid } from '@inkweaver/shared';
import { authApi, getApiErrorMessage } from '@inkweaver/api';
import { authService } from '@inkweaver/services';
import { platformAdapter } from '../adapters/platformAdapter';
import { PlatformAdapterProvider } from '@inkweaver/ui';
import { FileText, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { showAlert } from '../components/CustomModal';
import '../styles/auth.css';

export const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loginData, setLoginData] = useState<LoginRequest>({
    email: '',
    password: '',
  });

  const [registerData, setRegisterData] = useState<RegisterRequest>({
    email: '',
    password: '',
    name: '',
  });

  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setError('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await authService.login(loginData);
      await authService.saveTokens(response, response.user.id);
      await authService.saveRememberMe(rememberMe);
      navigate('/');
    } catch (err) {
      setError(getApiErrorMessage(err, '登录失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (registerData.password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authService.register(registerData);
      await authService.saveTokens(response, response.user.id);
      navigate('/');
    } catch (err) {
      setError(getApiErrorMessage(err, '注册失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword(forgotEmail.trim());
      setForgotSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, '发送失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const isLoginValid = Boolean(loginData.email && isPasswordLengthValid(loginData.password));
  const isRegisterValid =
    Boolean(
      registerData.email &&
        isPasswordLengthValid(registerData.password) &&
        registerData.name.trim(),
    ) &&
    isPasswordLengthValid(confirmPassword) &&
    registerData.password === confirmPassword;

  const renderPasswordToggle = (visible: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="auth-field__toggle"
      onClick={onToggle}
      tabIndex={-1}
      aria-label={visible ? '隐藏密码' : '显示密码'}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <PlatformAdapterProvider adapter={platformAdapter}>
      <div className="auth-page">
        <aside className="auth-page__brand" aria-hidden="true">
          <div className="auth-page__brand-glow" />
          <div className="auth-page__brand-glow auth-page__brand-glow--2" />
          <div className="auth-page__brand-inner">
            <div className="auth-page__brand-logo">
              <FileText size={28} strokeWidth={2.2} />
            </div>
            <h1 className="auth-page__brand-title">InkWeaver</h1>
            <p className="auth-page__brand-tagline">记录灵感 · 编织智慧</p>
            <ul className="auth-page__features">
              <li>多端同步，随时续写笔记</li>
              <li>文件夹与回收站，管理更安心</li>
              <li>协作编辑，团队共创文档</li>
            </ul>
          </div>
        </aside>

        <main className="auth-page__panel">
          <div className="auth-card">
            <div className="auth-card--mobile-header">
              <div className="auth-logo">
                <FileText size={24} />
              </div>
              <h1 className="auth-title">InkWeaver</h1>
              <p className="auth-subtitle">记录灵感 · 编织智慧</p>
            </div>

            <div className="auth-header">
              <h2 className="auth-title">{isLogin ? '欢迎回来' : '创建账号'}</h2>
              <p className="auth-subtitle">
                {isLogin ? '登录以继续使用你的笔记与文档' : '注册后即可开始使用 InkWeaver'}
              </p>
            </div>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={isLogin}
                className={`auth-tab ${isLogin ? 'active' : ''}`}
                onClick={() => switchMode(true)}
                disabled={loading}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isLogin}
                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                onClick={() => switchMode(false)}
                disabled={loading}
              >
                注册
              </button>
            </div>

            {error && (
              <div className="auth-alert" role="alert">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {showForgot ? (
              <form onSubmit={handleForgotPassword} className="auth-form">
                <p className="auth-subtitle">输入注册邮箱，我们将发送重置链接。</p>
                {forgotSent && (
                  <div className="auth-alert auth-alert--success" role="status">
                    <CheckCircle size={18} style={{ flexShrink: 0 }} />
                    <span>若该邮箱已注册，您将收到重置密码邮件，请查收。</span>
                  </div>
                )}
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="forgot-email">
                    邮箱
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Mail size={18} />
                    </span>
                    <input
                      id="forgot-email"
                      type="email"
                      className="auth-field__input"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@example.com"
                      required
                      disabled={loading || forgotSent}
                    />
                  </div>
                </div>
                <button type="submit" className="auth-submit" disabled={loading || forgotSent || !forgotEmail}>
                  {forgotSent ? '邮件已发送' : loading ? '发送中…' : '发送重置邮件'}
                </button>
                <button
                  type="button"
                  className="auth-link-btn auth-forgot-back"
                  onClick={() => {
                    setShowForgot(false);
                    setForgotSent(false);
                    setError('');
                  }}
                >
                  返回登录
                </button>
              </form>
            ) : isLogin ? (
              <form onSubmit={handleLogin} className="auth-form">
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="login-email">
                    邮箱
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Mail size={18} />
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      className="auth-field__input"
                      value={loginData.email}
                      onChange={(e) => setLoginData((p) => ({ ...p, email: e.target.value }))}
                      placeholder="name@example.com"
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="login-password">
                    密码
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Lock size={18} />
                    </span>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      className="auth-field__input"
                      value={loginData.password}
                      onChange={(e) => setLoginData((p) => ({ ...p, password: e.target.value }))}
                      placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
                      autoComplete="current-password"
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      disabled={loading}
                    />
                    {renderPasswordToggle(showPassword, () => setShowPassword((v) => !v))}
                  </div>
                </div>

                <div className="auth-row">
                  <label className="auth-checkbox">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={loading}
                    />
                    <span>记住我</span>
                  </label>
                  <button
                    type="button"
                    className="auth-link-btn"
                    disabled={loading}
                    onClick={() => {
                      setForgotEmail(loginData.email);
                      setShowForgot(true);
                      setError('');
                    }}
                  >
                    忘记密码？
                  </button>
                </div>

                <button type="submit" className="auth-submit" disabled={loading || !isLoginValid}>
                  {loading && <span className="auth-submit__spinner" />}
                  {loading ? '登录中…' : '登录'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="auth-form">
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="register-name">
                    用户名
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <User size={18} />
                    </span>
                    <input
                      id="register-name"
                      type="text"
                      className="auth-field__input"
                      value={registerData.name}
                      onChange={(e) => setRegisterData((p) => ({ ...p, name: e.target.value }))}
                      placeholder="如何称呼你"
                      autoComplete="name"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="register-email">
                    邮箱
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Mail size={18} />
                    </span>
                    <input
                      id="register-email"
                      type="email"
                      className="auth-field__input"
                      value={registerData.email}
                      onChange={(e) => setRegisterData((p) => ({ ...p, email: e.target.value }))}
                      placeholder="name@example.com"
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="register-password">
                    密码
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Lock size={18} />
                    </span>
                    <input
                      id="register-password"
                      type={showPassword ? 'text' : 'password'}
                      className="auth-field__input"
                      value={registerData.password}
                      onChange={(e) => setRegisterData((p) => ({ ...p, password: e.target.value }))}
                      placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
                      autoComplete="new-password"
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      disabled={loading}
                    />
                    {renderPasswordToggle(showPassword, () => setShowPassword((v) => !v))}
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="register-confirm">
                    确认密码
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon">
                      <Lock size={18} />
                    </span>
                    <input
                      id="register-confirm"
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="auth-field__input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="再次输入密码"
                      autoComplete="new-password"
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      disabled={loading}
                    />
                    {renderPasswordToggle(showConfirmPassword, () => setShowConfirmPassword((v) => !v))}
                  </div>
                </div>

                <button type="submit" className="auth-submit" disabled={loading || !isRegisterValid}>
                  {loading && <span className="auth-submit__spinner" />}
                  {loading ? '注册中…' : '注册并登录'}
                </button>
              </form>
            )}

            <div className="auth-divider">
              <div className="auth-divider-line" />
              <span className="auth-divider-text">第三方登录即将开放</span>
              <div className="auth-divider-line" />
            </div>

            <div className="social-buttons">
              <button type="button" className="social-btn" disabled title="即将开放">
                微信
              </button>
              <button type="button" className="social-btn" disabled title="即将开放">
                Google
              </button>
              <button type="button" className="social-btn" disabled title="即将开放">
                QQ
              </button>
            </div>

            <div className="auth-footer">
              <p>
                {isLogin ? '还没有账号？' : '已有账号？'}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => switchMode(!isLogin)}
                  disabled={loading}
                >
                  {isLogin ? '立即注册' : '立即登录'}
                </button>
              </p>
            </div>
          </div>
        </main>
      </div>
    </PlatformAdapterProvider>
  );
};
