/**
 * 应用配置单测：弱密钥检测与生产 fail-fast。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStrongSecretsInProduction,
  isWeakSecret,
} from './app.config';

function configOf(values: Record<string, string | undefined>) {
  return {
    get<T = string>(key: string, defaultValue?: T) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key] as T;
      }
      return defaultValue as T;
    },
  };
}

test('isWeakSecret 识别空值与占位符', () => {
  assert.equal(isWeakSecret(undefined), true);
  assert.equal(isWeakSecret(''), true);
  assert.equal(isWeakSecret('change-me-please'), true);
  assert.equal(isWeakSecret('fallback-secret-key'), true);
  assert.equal(isWeakSecret('a-strong-random-secret-value'), false);
});

test('production 弱 JWT 时抛错', () => {
  assert.throws(
    () =>
      assertStrongSecretsInProduction(
        configOf({
          NODE_ENV: 'production',
          JWT_SECRET: 'change-me',
          DB_PASSWORD: 'strong-db-password',
        }) as never,
      ),
    /JWT_SECRET/,
  );
});

test('development 弱密钥不抛错', () => {
  assert.doesNotThrow(() =>
    assertStrongSecretsInProduction(
      configOf({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-me',
        DB_PASSWORD: 'change-me',
      }) as never,
    ),
  );
});
