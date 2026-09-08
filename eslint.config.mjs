/**
 * SyncBox-AI ESLint 配置（Flat Config）。
 *
 * 用途：
 * - 为 monorepo 内的 TS/TSX 文件提供统一 lint 规则
 * - 约束 import 顺序与常见错误
 *
 * 说明：
 * - 输入：各 workspace 包内的源码文件
 * - 输出：lint 报告（命令行输出）
 */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.{ts,tsx,cts,mts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "object",
            "type",
          ],
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    settings: {
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
  },
  {
    files: ["apps/server/scripts/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    /**
     * NestJS 场景说明：
     * - DTO/Controller 的类引用会参与运行时的装饰器元数据（emitDecoratorMetadata）
     * - 仅靠语法静态分析，ESLint 可能误判为“只用作类型”
     */
    files: ["apps/server/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/.next/**",
      "**/node_modules/**",
    ],
  },
);
