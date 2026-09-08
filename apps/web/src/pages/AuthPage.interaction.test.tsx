/** AuthPage 真实 DOM 登录与记住登录交互测试。 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/login",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { authService } = await import("@inkweaver/services");
const { AuthPage } = await import("./AuthPage");

afterEach(() => cleanup());

test("勾选记住我后登录会保存令牌、迁移持久化策略并进入应用", async () => {
  const calls: string[] = [];
  authService.login = async (data) => {
    calls.push(`login:${data.email}:${data.password}`);
    return {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      sessionId: "session-id",
      user: { id: "user-id", email: data.email, name: "测试用户" },
    };
  };
  authService.saveTokens = async (_tokens, userId) => {
    calls.push(`tokens:${userId}`);
  };
  authService.saveRememberMe = async (remember) => {
    calls.push(`remember:${remember}`);
  };

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<div>已进入应用</div>} />
      </Routes>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("邮箱"), "user@example.test");
  await user.type(screen.getByLabelText("密码"), "password123");
  await user.click(screen.getByRole("checkbox", { name: "记住我" }));
  await user.click(screen.getByRole("button", { name: "登录" }));

  assert.ok(await screen.findByText("已进入应用"));
  assert.deepEqual(calls, [
    "login:user@example.test:password123",
    "tokens:user-id",
    "remember:true",
  ]);
});

test("登录失败时保留在登录页并显示服务端错误", async () => {
  authService.login = async () => {
    throw new Error("401 密码错误");
  };

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("邮箱"), "user@example.test");
  await user.type(screen.getByLabelText("密码"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "登录" }));

  assert.ok(await screen.findByRole("alert"));
  assert.match(screen.getByRole("alert").textContent ?? "", /密码错误/);
});
