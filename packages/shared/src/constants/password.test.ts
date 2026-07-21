/**
 * 密码长度约定单测。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_PASSWORD_LENGTH, isPasswordLengthValid } from './password';

test('MIN_PASSWORD_LENGTH 为 8', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test('isPasswordLengthValid 按最小长度判断', () => {
  assert.equal(isPasswordLengthValid('1234567'), false);
  assert.equal(isPasswordLengthValid('12345678'), true);
});
