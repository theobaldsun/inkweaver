/** 个人中心上传、导出和删除入口真实 DOM 交互测试。 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DEFAULT_USER_SETTINGS } from "@inkweaver/shared";
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/profile",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  File: dom.window.File,
  Blob: dom.window.Blob,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ProfileAccountTab } = await import("../components/profile/ProfileAccountTab");
const { ProfilePrivacyTab } = await import("../components/profile/ProfilePrivacyTab");

afterEach(() => cleanup());

test("上传头像选择文件后把原始 File 交给上传处理器", async () => {
  let selected: File | undefined;
  const { container } = render(
    <ProfileAccountTab
      user={{ id: "user-id", name: "测试用户", email: "user@example.test" }}
      accountForm={{ name: "测试用户", email: "user@example.test" }}
      setAccountForm={() => undefined}
      passwordForm={{ oldPassword: "", newPassword: "", confirmPassword: "" }}
      setPasswordForm={() => undefined}
      saving={false}
      onSaveAccount={() => undefined}
      onChangePassword={() => undefined}
      onUploadAvatar={(file) => {
        selected = file;
      }}
      onLogout={() => undefined}
      onDeleteAccount={() => undefined}
    />,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input);
  const file = new File(["avatar"], "avatar.png", { type: "image/png" });
  await userEvent.setup().upload(input, file);

  assert.equal(selected, file);
});

test("导出与删除全部数据必须通过密码确认后调用对应处理器", async () => {
  const actions: string[] = [];
  render(
    <ProfilePrivacyTab
      settings={DEFAULT_USER_SETTINGS}
      sessions={[]}
      saving={false}
      onSave={() => undefined}
      onExport={(password) => actions.push(`export:${password}`)}
      onDeleteAllData={(password) => actions.push(`delete:${password}`)}
      onRevokeSession={() => undefined}
      onRevokeAllSessions={() => undefined}
    />,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: /导出所有数据/ }));
  await user.type(screen.getByPlaceholderText("登录密码"), "export-password");
  await user.click(screen.getByRole("button", { name: "确认" }));

  await user.click(screen.getByRole("button", { name: /删除所有数据/ }));
  await user.type(screen.getByPlaceholderText("登录密码"), "delete-password");
  await user.click(screen.getByRole("button", { name: "确认" }));

  assert.deepEqual(actions, ["export:export-password", "delete:delete-password"]);
});
