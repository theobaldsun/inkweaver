import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolSchemaCompileError, ToolSchemaValidator } from './tool-schema-validator';

import type { ToolDefinition, ToolSchema } from './tool-definition';

function definition(): Pick<ToolDefinition, 'inputSchema' | 'outputSchema'> {
  return {
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['query'], additionalProperties: false,
    },
    outputSchema: {
      type: 'object', properties: { count: { type: 'integer', minimum: 0 } },
      required: ['count'], additionalProperties: false,
    },
  };
}

test('合法输入和输出通过，两个方向使用独立 Schema', () => {
  const validator = new ToolSchemaValidator(definition());
  assert.deepEqual(validator.validateInput({ query: '同步', limit: 2 }), { ok: true });
  assert.deepEqual(validator.validateOutput({ count: 2 }), { ok: true });
  assert.deepEqual(validator.validateOutput({ query: '同步' }), { ok: false, code: 'INVALID_TOOL_OUTPUT' });
  assert.deepEqual(validator.validateInput({ count: 2 }), { ok: false, code: 'INVALID_TOOL_INPUT' });
});

test('必填、类型、整数范围、长度、额外字段均受约束，不修改参数', () => {
  const validator = new ToolSchemaValidator(definition());
  for (const input of [{}, { query: '' }, { query: 1 }, { query: 'x', limit: '2' }, { query: 'x', limit: 0 }, { query: 'x', limit: 11 }, { query: 'x', limit: 1.5 }, { query: 'x', secret: 'private' }, null, []]) {
    const before = structuredClone(input);
    assert.deepEqual(validator.validateInput(input), { ok: false, code: 'INVALID_TOOL_INPUT' });
    assert.deepEqual(input, before);
  }
  const withoutDefault = { query: 'x' };
  assert.equal(validator.validateInput(withoutDefault).ok, true);
  assert.deepEqual(withoutDefault, { query: 'x' });
});

test('2020-12 支持嵌套数组、枚举和本地 $defs 引用', () => {
  const validator = new ToolSchemaValidator({
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      $defs: { source: { type: 'string', enum: ['notes', 'files'] } },
      properties: { sources: { type: 'array', minItems: 1, uniqueItems: true, items: { $ref: '#/$defs/source' } } },
      required: ['sources'], additionalProperties: false,
    }, outputSchema: true,
  });
  assert.equal(validator.validateInput({ sources: ['notes', 'files'] }).ok, true);
  for (const sources of [[], ['web'], ['notes', 'notes'], [1]]) assert.equal(validator.validateInput({ sources }).ok, false);
});

test('oneOf 与 false Schema 不会被忽略', () => {
  const validator = new ToolSchemaValidator({ ...definition(), outputSchema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } });
  assert.equal(validator.validateOutput('结果').ok, true);
  assert.equal(validator.validateOutput(2).ok, true);
  assert.equal(validator.validateOutput(false).ok, false);
  const deny = new ToolSchemaValidator({ ...definition(), outputSchema: false });
  assert.deepEqual(deny.validateOutput(null), { ok: false, code: 'INVALID_TOOL_OUTPUT' });
});

test('额外字段按 Schema 规则处理，不强制改变工具契约', () => {
  const validator = new ToolSchemaValidator({ inputSchema: { type: 'object' }, outputSchema: true });
  const input = { custom: { value: '原值' } };
  assert.equal(validator.validateInput(input).ok, true);
  assert.deepEqual(input, { custom: { value: '原值' } });
});

test('非法 Schema、未知关键字或格式、异步及未支持方言全部编译失败', () => {
  const invalidSchemas: ToolSchema[] = [
    { type: 'invalid' }, { type: 'string', minLength: -1 },
    { type: 'string', misspelledKeyword: true }, { type: 'string', format: 'unknown-format' },
    { $async: true, type: 'string' },
    { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' },
    { $ref: 'https://example.invalid/remote-schema' },
  ];
  for (const outputSchema of invalidSchemas) {
    assert.throws(() => new ToolSchemaValidator({ ...definition(), outputSchema }), (error) =>
      error instanceof ToolSchemaCompileError && error.code === 'INVALID_TOOL_SCHEMA' && error.direction === 'output' && error.message === 'INVALID_TOOL_SCHEMA');
  }
  assert.throws(() => new ToolSchemaValidator({ ...definition(), inputSchema: { type: 'object', properties: 'invalid' } }), (error) =>
    error instanceof ToolSchemaCompileError && error.direction === 'input');
});

test('修改原始定义不改变已编译快照，新实例使用新规则', () => {
  const original = definition();
  const validator = new ToolSchemaValidator(original);
  original.inputSchema.required = ['query', 'limit'];
  original.outputSchema = false;
  assert.equal(validator.validateInput({ query: 'x' }).ok, true);
  assert.equal(validator.validateOutput({ count: 1 }).ok, true);
  const next = new ToolSchemaValidator(original);
  assert.equal(next.validateInput({ query: 'x' }).ok, false);
  assert.equal(next.validateOutput({ count: 1 }).ok, false);
});

test('相同 $id 的输入输出和不同实例互不污染', () => {
  const sharedId = 'urn:inkweaver:test';
  const validator = new ToolSchemaValidator({
    inputSchema: { ...definition().inputSchema, $id: sharedId },
    outputSchema: { $id: sharedId, type: 'string' },
  });
  const another = new ToolSchemaValidator({ inputSchema: { type: 'object', $id: sharedId }, outputSchema: false });
  assert.equal(validator.validateOutput('text').ok, true);
  assert.equal(another.validateOutput('text').ok, false);
});

test('错误结果不暴露提交内容、字段名或 Schema，后续成功不残留错误', () => {
  const validator = new ToolSchemaValidator(definition());
  assert.deepEqual(validator.validateInput({ private_field: 'credential-placeholder' }), { ok: false, code: 'INVALID_TOOL_INPUT' });
  assert.deepEqual(validator.validateInput({ query: '正常' }), { ok: true });
});
