/**
 * 移动端认证页面 (React Native)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input, Checkbox, Card, PlatformAdapterProvider } from '@inkweaver/ui';
import { authService } from '../services/authService';
import { platformAdapter } from '../adapters/platformAdapter';
import type { LoginRequest, RegisterRequest, LoginResponse } from '@inkweaver/shared';
import type { RootStackParamList } from '../App';

// 直接导入logo图片
const logo = require('../assets/logo.png');

export const AuthScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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

  const handleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await authService.login(loginData);
      console.log('登录成功:', response);
      
      // 保存认证信息
      await authService.saveTokens(response, response.user.id);
      await authService.saveRememberMe(rememberMe);
      
      Alert.alert('成功', '登录成功！');
      
      // 跳转到主页面
      navigation.navigate('Main');
      
    } catch (err) {
      setError((err as Error).message);
      Alert.alert('错误', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (registerData.password !== confirmPassword) {
      setError('两次输入的密码不一致');
      Alert.alert('错误', '两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authService.register(registerData);
      console.log('注册成功:', response);
      
      // 保存认证信息
      await authService.saveTokens(response, response.user.id);
      
      Alert.alert('成功', '注册成功！');
      
      // 跳转到主页面
      navigation.navigate('Main');
      
    } catch (err) {
      setError((err as Error).message);
      Alert.alert('错误', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginChange = (field: keyof LoginRequest) => (value: string) => {
    setLoginData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleRegisterChange = (field: keyof RegisterRequest) => (value: string) => {
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
      <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {/* Logo 和品牌名称 */}
          <View style={styles.logoContainer}>
              <Image source={logo} style={{
                height: 40,           // 宽度占满父容器
                // aspectRatio: 559 / 109, // 高度自动根据宽高比计算
                width: 40 * (559 / 109),
              }} resizeMode="contain" />
            {/* <Text style={styles.brandName}>InkWeaver</Text> */}
            <Text style={styles.brandSlogan}>记录灵感 · 编织智慧</Text>
          </View>

          {/* 标签页切换 */}
          <View style={styles.tabContainer}>
            <Button
              variant={isLogin ? 'primary' : 'secondary'}
              onPress={() => setIsLogin(true)}
              disabled={loading}
              style={[
                styles.tab,
                isLogin && styles.activeTab
              ] as any}
            >
              <Text style={[styles.tabText, isLogin && styles.activeTabText]}>登录</Text>
            </Button>
            <Button
              variant={!isLogin ? 'primary' : 'secondary'}
              onPress={() => setIsLogin(false)}
              disabled={loading}
              style={[
                styles.tab,
                !isLogin && styles.activeTab
              ] as any}
            >
              <Text style={[styles.tabText, !isLogin && styles.activeTabText]}>注册</Text>
            </Button>
          </View>

          {/* 错误信息 */}
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* 登录表单 */}
          {isLogin ? (
            <Card style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>邮箱</Text>
                <Input
                  type="email"
                  value={loginData.email}
                  onChange={handleLoginChange('email')}
                  placeholder="your@email.com"
                  disabled={loading}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>密码</Text>
                <Input
                  type="password"
                  value={loginData.password}
                  onChange={handleLoginChange('password')}
                  placeholder="********"
                  disabled={loading}
                />
              </View>

              <View style={styles.rememberContainer}>
                <Checkbox
                  checked={rememberMe}
                  onChange={setRememberMe}
                  label="记住我"
                  disabled={loading}
                />
                <Button
                  variant="secondary"
                  onPress={() => console.log('忘记密码')}
                  disabled={loading}
                >
                  <Text style={styles.forgotPassword}>忘记密码？</Text>
                </Button>
              </View>

              <Button
                variant="primary"
                onPress={handleLogin}
                disabled={loading || !isLoginValid}
                style={[
                  styles.button,
                  (loading || !isLoginValid) && styles.buttonDisabled
                ] as any}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>登录</Text>
                )}
              </Button>
            </Card>
          ) : (
            <Card style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>用户名（可选）</Text>
                <Input
                  type="text"
                  value={registerData.name}
                  onChange={handleRegisterChange('name')}
                  placeholder="如何称呼你"
                  disabled={loading}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>邮箱</Text>
                <Input
                  type="email"
                  value={registerData.email}
                  onChange={handleRegisterChange('email')}
                  placeholder="your@email.com"
                  disabled={loading}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>密码</Text>
                <Input
                  type="password"
                  value={registerData.password}
                  onChange={handleRegisterChange('password')}
                  placeholder="至少6位"
                  disabled={loading}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>确认密码</Text>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="再次输入"
                  disabled={loading}
                />
              </View>

              <Button
                variant="primary"
                onPress={handleRegister}
                disabled={loading || !isRegisterValid}
                style={[
                  styles.button,
                  (loading || !isRegisterValid) && styles.buttonDisabled
                ] as any}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>注册新账号</Text>
                )}
              </Button>
            </Card>
          )}

          {/* 第三方登录 */}
          <View style={styles.thirdPartyContainer}>
            <View style={styles.divider}>
              <View style={styles.dividerLine}></View>
              <Text style={styles.dividerText}>或使用第三方账号</Text>
              <View style={styles.dividerLine}></View>
            </View>
            <View style={styles.thirdPartyButtons}>
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('wechat')}
                disabled={loading}
                style={styles.thirdPartyButton}
              >
                <Text style={styles.thirdPartyIcon}>X</Text>
              </Button>
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('google')}
                disabled={loading}
                style={styles.thirdPartyButton}
              >
                <Text style={styles.thirdPartyIcon}>G</Text>
              </Button>
              <Button
                variant="secondary"
                onPress={() => handleThirdPartyLogin('qq')}
                disabled={loading}
                style={styles.thirdPartyButton}
              >
                <Text style={styles.thirdPartyIcon}>Q</Text>
              </Button>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PlatformAdapterProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 64,
    marginBottom: 48,
  },
  logoIcon: {
    fontSize: 32,
  },
  brandName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6a1b9a',
    marginBottom: 8,
  },
  brandSlogan: {
    fontSize: 14,
    color: '#666',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#4a90e2',
  },
  tabText: {
    fontSize: 16,
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#ffe6e6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  errorText: {
    color: '#d63031',
    fontSize: 14,
    textAlign: 'center',
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
  },
  rememberContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#4a90e2',
    borderColor: '#4a90e2',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  rememberText: {
    fontSize: 14,
    color: '#666',
  },
  forgotPassword: {
    fontSize: 14,
    color: '#4a90e2',
  },
  button: {
    backgroundColor: '#4a90e2',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  thirdPartyContainer: {
    marginTop: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: '#999',
  },
  thirdPartyButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
  },
  thirdPartyButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thirdPartyIcon: {
    fontSize: 24,
  },
});