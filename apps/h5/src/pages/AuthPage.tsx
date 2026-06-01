/**
 * H5 客户端认证页面
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginRequest, RegisterRequest, LoginResponse } from '@inkweaver/shared';
import { Button, Input, Checkbox, Card, PlatformAdapterProvider } from '@inkweaver/ui';
import { authService } from '@inkweaver/services';
import { authApi, getApiErrorMessage } from '@inkweaver/api';
import { platformAdapter } from '../adapters/platformAdapter';
import { ImagePaths } from '@inkweaver/assets';
import { showAlert } from '../components/CustomModal';
import '../styles/auth.css';

export const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [rememberMe, setRememberMe] = useState(false);

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
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await authApi.forgotPassword(forgotEmail.trim());
      setForgotSent(true);
      await showAlert('已提交', res.message, 'success');
    } catch (err) {
      setError(getApiErrorMessage(err, '发送失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    setLoading(true);
    setError('');

    try {
      const response = await authService.login(loginData);
      console.log('登录成功:', response);
      
      // 保存认证信息（必须使用await等待保存完成）
      await authService.saveTokens(response, response.user.id);
      await authService.saveRememberMe(rememberMe);
      
      console.log('即将跳转');
      
      // 跳转到主页面
      navigate('/');
      
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    
    if (registerData.password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authService.register(registerData);
      console.log('注册成功:', response);
      
      // 保存认证信息（必须使用await等待保存完成）
      await authService.saveTokens(response, response.user.id);
      
      showAlert('成功', '注册成功！', 'success');
      
      // 自动切换到登录状态
      setIsLogin(true);
      
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginChange = (field: keyof LoginRequest) => (
    value: string
  ) => {
    setLoginData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleRegisterChange = (field: keyof RegisterRequest) => (
    value: string
  ) => {
    setRegisterData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleThirdPartyLogin = (provider: string) => {
    console.log(`第三方登录: ${provider}`);
    // 实现第三方登录逻辑
  };

  const isLoginValid = loginData.email && loginData.password && loginData.password.length >= 8;
  const isRegisterValid = registerData.email && 
                         registerData.password && 
                         registerData.name && 
                         confirmPassword &&
                         registerData.password === confirmPassword;

  return (
    <PlatformAdapterProvider adapter={platformAdapter}>
      <div className="auth-container">
        <Card className="auth-card">
          {/* Logo 和品牌名称 */}
          <div className="logo-container">
            <div className="logo-icon">
              <img src={ImagePaths.logo} alt="InkWeaver Logo" />
            </div>
            {/* <h1 className="logo-text">InkWeaver</h1> */}
            <p className="tagline">记录灵感 · 编织智慧</p>
          </div>

          {/* 标签页切换 */}
          <div className="tab-container">
            <Button
              variant={isLogin ? 'primary' : 'secondary'}
              onPress={() => setIsLogin(true)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: isLogin ?'#4a90e2' : '#f5f5f5' ,
                border: 'none',
                color: isLogin ? 'white' : '#666',
                fontSize: '16px',
                fontWeight: isLogin ? '600' : 'normal',
                cursor: 'pointer'
              }}
            >
              登录
            </Button>
            <Button
              variant={!isLogin ? 'primary' : 'secondary'}
              onPress={() => setIsLogin(false)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: !isLogin ?'#4a90e2' : '#f5f5f5' ,
                border: 'none',
                color: !isLogin ? 'white' : '#666',
                fontSize: '16px',
                fontWeight: !isLogin ? '600' : 'normal',
                cursor: 'pointer'
              }}
            >
              注册
            </Button>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {showForgot ? (
            <div className="auth-form">
              <p className="tagline">输入注册邮箱，我们将发送重置链接。</p>
              <div className="form-group">
                <label>邮箱</label>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(v) => setForgotEmail(v)}
                  placeholder="your@email.com"
                  disabled={loading || forgotSent}
                />
              </div>
              <Button
                variant="primary"
                onPress={handleForgotPassword}
                disabled={loading || forgotSent || !forgotEmail.trim()}
                style={{ width: '100%', marginTop: 12 }}
              >
                {forgotSent ? '邮件已发送' : loading ? '发送中…' : '发送重置邮件'}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setShowForgot(false);
                  setForgotSent(false);
                  setError('');
                }}
                style={{ width: '100%', marginTop: 8, background: 'transparent', border: 'none', color: '#4a90e2' }}
              >
                返回登录
              </Button>
            </div>
          ) : isLogin ? (
            <form onSubmit={handleLogin} className="auth-form">
              <div className="form-group">
                <label>
                  邮箱
                </label>
                <Input
                  type="email"
                  value={loginData.email}
                  onChange={handleLoginChange('email')}
                  placeholder="your@email.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>
                  密码
                </label>
                <Input
                  type="password"
                  value={loginData.password}
                  onChange={handleLoginChange('password')}
                  placeholder="********"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-row">
                <Checkbox
                  checked={rememberMe}
                  onChange={setRememberMe}
                  label="记住我"
                  disabled={loading}
                />
                <Button
                  variant="secondary"
                  onPress={() => {
                    setForgotEmail(loginData.email);
                    setShowForgot(true);
                    setError('');
                  }}
                  disabled={loading}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#4a90e2',
                    fontSize: '14px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    padding: 0
                  }}
                >
                  忘记密码？
                </Button>
              </div>

              <Button
                  variant="primary"
                  onPress={handleLogin}
                  disabled={loading || !isLoginValid}
                  style={{
                    width: '100%',
                    padding: '16px',
                    backgroundColor: loading || !isLoginValid ? '#ccc' : '#4a90e2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: loading || !isLoginValid ? 'not-allowed' : 'pointer',
                    marginBottom: '24px'
                  }}
                >
                {loading ? '登录中...' : '登录'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <div className="form-group">
                <label>
                  用户名（可选）
                </label>
                <Input
                  type="text"
                  value={registerData.name}
                  onChange={handleRegisterChange('name')}
                  placeholder="如何称呼你"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>
                  邮箱
                </label>
                <Input
                  type="email"
                  value={registerData.email}
                  onChange={handleRegisterChange('email')}
                  placeholder="your@email.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>
                  密码
                </label>
                <Input
                  type="password"
                  value={registerData.password}
                  onChange={handleRegisterChange('password')}
                  placeholder="至少6位"
                  minLength={6}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>
                  确认密码
                </label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(value) => setConfirmPassword(value)}
                  placeholder="再次输入"
                  minLength={6}
                  required
                  disabled={loading}
                />
              </div>

              <Button
                  variant="primary"
                  onPress={handleRegister}
                  disabled={loading || !isRegisterValid}
                  style={{
                    width: '100%',
                    padding: '16px',
                    backgroundColor: loading || !isRegisterValid ? '#ccc' : '#4a90e2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: loading || !isRegisterValid ? 'not-allowed' : 'pointer',
                    marginBottom: '24px'
                  }}
                >
                {loading ? '注册中...' : '注册新账号'}
              </Button>
            </form>
          )}

          {/* 第三方登录 */}
          <div className="social-login">
            <div className="divider">
              <div className="divider-line"></div>
              <span className="divider-text">
                或使用第三方账号
              </span>
              <div className="divider-line"></div>
            </div>

            <div className="social-buttons">
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('wechat')}
                disabled={loading}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                <span style={{ fontSize: '24px' }}>X</span>
              </Button>
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('google')}
                disabled={loading}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                <span style={{ fontSize: '24px' }}>G</span>
              </Button>
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('qq')}
                disabled={loading}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                <span style={{ fontSize: '24px' }}>Q</span>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </PlatformAdapterProvider>
  );
};