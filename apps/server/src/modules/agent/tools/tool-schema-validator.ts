/**
 * 工具参数/结果的 JSON Schema 2020-12 校验，复用成熟的 Ajv 实现。
 * Schema 来自经过审查的工具定义，数据来自 JSON 反序列化边界。
 * 不在此处理 Proxy 隔离、资源授权、工具执行或调用预算。
 */
import { Ajv2020 } from 'ajv/dist/2020';

import type { ToolDefinition, ToolSchema } from './tool-definition';
import type { ValidateFunction } from 'ajv';

/** 区分工具参数与工具结果，不暴露输入值、Schema 内容或 Ajv 内部错误。 */
export type ToolSchemaValidationResult =
  | { /** 数据符合对应 Schema。 */ ok: true }
  | { /** 数据不符合 Schema。 */ ok: false; /** 稳定错误码。 */ code: 'INVALID_TOOL_INPUT' | 'INVALID_TOOL_OUTPUT' };

/** 编译失败必须阻止该工具进入执行链，不能降级为跳过 Schema 检查。 */
export class ToolSchemaCompileError extends Error {
  /** 稳定错误码，不保存 Ajv 的原始异常以免泄露定义内容。 */
  readonly code = 'INVALID_TOOL_SCHEMA';
  /** 出错的 Schema 方向，方便定位受审查工具配置。 */
  readonly direction: 'input' | 'output';

  constructor(direction: 'input' | 'output') {
    super('INVALID_TOOL_SCHEMA');
    this.name = 'ToolSchemaCompileError';
    this.direction = direction;
  }
}

/** 每个 Schema 独立编译，避免不同工具或输入输出的 $id 互相污染。 */
function compile(schema: ToolSchema, direction: 'input' | 'output'): ValidateFunction {
  try {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: false,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      ownProperties: true,
      // 不注册 loadSchema、异步关键词或格式扩展，不进行远程引用加载。
      logger: false,
    });
    const validator = ajv.compile(structuredClone(schema));
    if ('$async' in validator && validator.$async) throw new ToolSchemaCompileError(direction);
    return validator;
  } catch {
    throw new ToolSchemaCompileError(direction);
  }
}

/**
 * 一个实例对应一份固定的工具 Schema 快照，构造时编译，调用时复用。
 * 调用方在工具变更后必须创建新实例，禁止按名称复用旧版本校验器。
 * 此类不修改目录；准备层先检查策略，再使用 Catalog 中与固定版本匹配的校验器。
 */
export class ToolSchemaValidator {
  /** 输入的已编译校验器，不对外暴露 Ajv 的可变 errors 状态。 */
  private readonly inputValidator: ValidateFunction;
  /** 输出的已编译校验器，与输入使用隔离的 Schema 注册空间。 */
  private readonly outputValidator: ValidateFunction;

  constructor(definition: Pick<ToolDefinition, 'inputSchema' | 'outputSchema'>) {
    this.inputValidator = compile(definition.inputSchema, 'input');
    this.outputValidator = compile(definition.outputSchema, 'output');
  }

  /**
   * 校验 JSON 解码后的工具参数，不转换类型、不补默认值、不删除额外字段。
   * 是否允许额外字段由 Schema 显式控制，不擅自改写工具定义。
   * @param input 已通过序列化边界的参数；通过不代表资源可访问。
   */
  validateInput(input: unknown): ToolSchemaValidationResult {
    return this.inputValidator(input)
      ? { ok: true }
      : { ok: false, code: 'INVALID_TOOL_INPUT' };
  }

  /**
   * 校验 JSON 解码后的工具结果；失败结果不得进入模型或作为成功产物保存。
   * @param output 工具结果；调用大小限制及资源真实性由后续执行层处理。
   */
  validateOutput(output: unknown): ToolSchemaValidationResult {
    return this.outputValidator(output)
      ? { ok: true }
      : { ok: false, code: 'INVALID_TOOL_OUTPUT' };
  }
}
