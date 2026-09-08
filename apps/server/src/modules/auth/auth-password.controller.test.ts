/** 密码重置申请与消费边界测试。 */
import assert from "node:assert/strict";
import test from "node:test";

import { AuthPasswordController } from "./auth-password.controller";
import { PasswordResetToken } from "../users/entity/password-reset-token.entity";

test("新申请密码重置链接会在同一事务废止旧链接再保存新 Token", async () => {
  const events: string[] = [];
  let createdToken: Partial<PasswordResetToken> | undefined;
  let mailedTokenHash = "";
  const manager = {
    async update(target: unknown, criteria: { userId?: string }, values: { usedAt?: Date }) {
      assert.equal(target, PasswordResetToken);
      assert.equal(criteria.userId, "user-id");
      assert.ok(values.usedAt instanceof Date);
      events.push("invalidate-old");
    },
    create(target: unknown, data: Partial<PasswordResetToken>) {
      assert.equal(target, PasswordResetToken);
      createdToken = data;
      events.push("create-new");
      return data;
    },
    async save(target: unknown, data: Partial<PasswordResetToken>) {
      assert.equal(target, PasswordResetToken);
      assert.equal(data, createdToken);
      events.push("save-new");
      return data;
    },
  };
  const resetRepository = {
    manager: {
      async transaction<T>(work: (transactionManager: typeof manager) => Promise<T>): Promise<T> {
        events.push("transaction-start");
        const result = await work(manager);
        events.push("transaction-commit");
        return result;
      },
    },
  };
  const controller = new AuthPasswordController(
    {
      async findByEmail() {
        return { id: "user-id", email: "user@example.test" };
      },
    } as never,
    {
      async enqueuePasswordReset(_email: string, _resetUrl: string, tokenHash: string) {
        mailedTokenHash = tokenHash;
        events.push("enqueue-mail");
      },
    } as never,
    resetRepository as never,
  );

  await controller.forgotPassword({ email: "user@example.test" });

  assert.deepEqual(events, [
    "transaction-start",
    "invalidate-old",
    "create-new",
    "save-new",
    "transaction-commit",
    "enqueue-mail",
  ]);
  assert.equal(createdToken?.userId, "user-id");
  assert.equal(createdToken?.usedAt, null);
  assert.equal(createdToken?.tokenHash, mailedTokenHash);
});
