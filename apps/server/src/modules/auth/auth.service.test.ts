/**
 * AuthService 单测：refresh / check-session 必须读库。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

test('refreshToken 在用户不存在时抛出 401', async () => {
  const service = new AuthService(
    {
      async verify() {
        return { sub: 'missing-user', email: 'x@y.z', type: 'refresh' };
      },
      sign() {
        return 'token';
      },
    } as never,
    {
      async rotateRefreshToken() {},
    } as never,
    {
      async findOne() {
        return null;
      },
    } as never,
  );

  await assert.rejects(
    () => service.refreshToken('refresh-token'),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test('checkSessionAndRefresh 使用数据库中的 name/email', async () => {
  const signedPayloads: Array<{ email: string; sub: string; type: string }> = [];
  const service = new AuthService(
    {
      async verify() {
        return { sub: 'user-1', email: 'stale@example.com', type: 'refresh' };
      },
      sign(payload: { email: string; sub: string; type: string }) {
        signedPayloads.push(payload);
        return `signed:${payload.type}:${payload.email}`;
      },
    } as never,
    {
      async rotateRefreshToken() {},
    } as never,
    {
      async findOne() {
        return {
          id: 'user-1',
          email: 'fresh@example.com',
          name: 'Alice',
          password: 'hash',
        };
      },
    } as never,
  );

  const result = await service.checkSessionAndRefresh('user-1', 'refresh-token');

  assert.equal(result.isValid, true);
  assert.equal(result.user?.email, 'fresh@example.com');
  assert.equal(result.user?.name, 'Alice');
  assert.ok(signedPayloads.some((p) => p.email === 'fresh@example.com'));
});

test('refreshToken 可连续轮换且旧令牌立即失效', async () => {
  let currentRefreshToken = 'refresh-0';
  let refreshSequence = 0;
  const service = new AuthService(
    {
      async verify(token: string) {
        if (token !== currentRefreshToken) throw new Error('invalid token');
        return { sub: 'user-1', email: 'user@example.com', type: 'refresh' };
      },
      sign(payload: { type: string }) {
        return payload.type === 'refresh'
          ? `refresh-${++refreshSequence}`
          : `access-${refreshSequence}`;
      },
    } as never,
    {
      async rotateRefreshToken(oldToken: string, _userId: string, newToken: string) {
        assert.equal(oldToken, currentRefreshToken);
        currentRefreshToken = newToken;
      },
    } as never,
    {
      async findOne() {
        return { id: 'user-1', email: 'user@example.com', name: 'Alice' };
      },
    } as never,
  );

  const first = await service.refreshToken('refresh-0');
  const second = await service.refreshToken(first.refresh_token);

  assert.equal(first.refresh_token, 'refresh-1');
  assert.equal(second.refresh_token, 'refresh-2');
  await assert.rejects(() => service.refreshToken('refresh-0'));
});
