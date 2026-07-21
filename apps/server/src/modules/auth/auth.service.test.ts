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
      async validateRefreshToken() {
        return { id: 'session-1' };
      },
      async updateSessionDeviceInfo() {},
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
      async checkSessionValidity() {
        return { isValid: true, session: { id: 'session-1' } };
      },
      async updateSessionDeviceInfo() {},
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
