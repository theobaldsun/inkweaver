/**
 * JWT 配置单元测试：默认 TTL 与时长解析。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAccessTokenTtl,
  getJwtModuleOptions,
  JWT_ACCESS_EXPIRES_IN,
  JWT_ACCESS_EXPIRES_SECONDS,
  parseJwtExpiresInToSeconds,
} from './jwt.config';

test('parseJwtExpiresInToSeconds 解析常见时长', () => {
  assert.equal(parseJwtExpiresInToSeconds('15m'), 15 * 60);
  assert.equal(parseJwtExpiresInToSeconds('1h'), 3600);
  assert.equal(parseJwtExpiresInToSeconds('7d'), 7 * 24 * 3600);
  assert.equal(parseJwtExpiresInToSeconds('bogus'), JWT_ACCESS_EXPIRES_SECONDS);
});

test('默认 access TTL 为 1h', () => {
  const prevExpires = process.env.JWT_EXPIRES_IN;
  const prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET ??= 'test-secret-for-jwt';
  delete process.env.JWT_EXPIRES_IN;
  try {
    const ttl = getAccessTokenTtl();
    assert.equal(ttl.expiresIn, JWT_ACCESS_EXPIRES_IN);
    assert.equal(ttl.expiresSeconds, 3600);

    const options = getJwtModuleOptions();
    assert.equal(options.signOptions?.expiresIn, '1h');
  } finally {
    if (prevExpires === undefined) {
      delete process.env.JWT_EXPIRES_IN;
    } else {
      process.env.JWT_EXPIRES_IN = prevExpires;
    }
    if (prevSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = prevSecret;
    }
  }
});

test('JWT_SECRET 未配置时抛错', () => {
  const prevSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(
      () => getJwtModuleOptions(),
      /JWT_SECRET 未配置/,
    );
  } finally {
    if (prevSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = prevSecret;
    }
  }
});
