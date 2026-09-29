/**
 * 服务端工具装配目录：描述结构、Schema 编译、适配器匹配全部成功后才发布。
 * 仅接受可信适配器，不加载插件、不调用工具。真实调用仍须经过执行层的授权、
 * 确认、资源校验和预算控制；目录中的可调用条件不等于用户已获执行许可。
 */
import { assertToolDefinition, ToolRegistryError } from './tool-definition-validator';
import { ToolSchemaValidator } from './tool-schema-validator';

import type { ToolDefinition, ToolJsonValue, ToolOrigin } from './tool-definition';
import type { ToolResource, ToolResourceSnapshot } from './tool-resources';
import type { ToolSchemaValidationResult } from './tool-schema-validator';

/** 执行时由可信服务端构造，不能从工具参数中提取身份。 */
export interface ToolAdapterContext {
  /** 当前已认证用户。 */
  userId: string;
  /** 当前运行 ID，供资源与审计关联。 */
  runId: string;
  /** 执行层控制的取消信号；适配器仍需遵循 supportsCancellation 描述。 */
  signal: AbortSignal;
  /** 执行器构造的固定身份与资源条件；旧适配器装配兼容可省略，真实文档工具要求存在。 */
  execution?: {
    /** 逻辑调用 UUID。 */
    callId: string;
    /** 本轮执行 UUID。 */
    attemptId: string;
    /** 从 1 开始的执行代次。 */
    attemptNumber: number;
    /** 逻辑操作幂等键，重试不变；不等于授权。 */
    idempotencyKey: string;
    /** 本轮复核取得的目标版本快照。 */
    resources: readonly ToolResourceSnapshot[];
  };
}

/** 内置或 MCP 的可信执行适配器，来源与版本须与定义精确匹配。 */
export interface ToolAdapter {
  /** 对应工具调用名称。 */
  name: string;
  /** 对应实现版本。 */
  version: string;
  /** 来源身份，不包含连接凭据。 */
  origin: ToolOrigin;
  /** 真正执行入口，本单元仅绑定，不调用；参数及结果须通过 JSON 数据边界。 */
  execute(input: ToolJsonValue, context: ToolAdapterContext): Promise<ToolJsonValue>;
  /** 可信资源需求解析；缺失时不能进入授权流程，显式空数组表示确实无外部资源。 */
  resources?(input: ToolJsonValue, userId: string): readonly ToolResource[];
}

/** 装配句柄供服务端准备、授权及执行层使用，不向用户或模型返回。 */
export interface AssembledTool {
  /** 定义副本，修改它不会影响目录或已编译规则。 */
  readonly definition: ToolDefinition;
  /** 使用装配时固定 Schema 检查参数。 */
  readonly validateInput: (input: unknown) => ToolSchemaValidationResult;
  /** 使用装配时固定 Schema 检查结果。 */
  readonly validateOutput: (output: unknown) => ToolSchemaValidationResult;
  /** 已绑定适配器入口，不是包含授权检查的完整执行器。 */
  readonly execute: ToolAdapter['execute'];
  /** 装配时固定的资源解析器，不授予权限。 */
  readonly resources?: ToolAdapter['resources'];
}

/** 不附带工具描述、连接配置或外部错误内容。 */
export class ToolAssemblyError extends Error {
  /** 适配器不匹配、未装配，或调用版本与当前装配不符。 */
  readonly code: 'ADAPTER_MISMATCH' | 'TOOL_NOT_ASSEMBLED' | 'VERSION_MISMATCH';

  constructor(code: ToolAssemblyError['code']) {
    super(code);
    this.name = 'ToolAssemblyError';
    this.code = code;
  }
}

/**
 * 工具装配目录：结构校验、Schema 编译与适配器匹配全部成功后才发布。
 * 定义与已编译函数保存在同一张装配表，避免同名工具描述在两处各自维护；
 * 结构校验复用 tool-definition-validator 的共享断言，不借助临时注册表间接校验。
 */
export class ToolCatalog {
  /** 只收录装配成功的工具；定义与函数绑定同处一份，撤销即同时失效。 */
  private readonly tools = new Map<string, AssembledTool>();

  /**
   * 先装配、后发布：结构校验、冲突检查、适配器匹配或 Schema 编译失败时，
   * 不向当前目录写入该工具；编译在注册时完成，后续调用复用已编译函数。
   * @param definition 可信、经过审查的工具定义。
   * @param adapter 对应同一名称、版本与来源的可信适配器。
   */
  register(definition: ToolDefinition, adapter: ToolAdapter): void {
    // 结构与字段约束使用共享断言；不转换字段、不补默认值，因此不是“规范化”。
    assertToolDefinition(definition);

    // 同名工具不得静默覆盖，即使版本不同也须先显式撤销。
    if (this.tools.has(definition.name)) throw new ToolRegistryError('DUPLICATE_TOOL');

    // 定义与实现必须指向同一工具版本和来源；MCP 还需匹配具体连接。
    if (!adapter || adapter.name !== definition.name || adapter.version !== definition.version ||
      typeof adapter.execute !== 'function' || (adapter.resources !== undefined && typeof adapter.resources !== 'function') || !adapter.origin || adapter.origin.kind !== definition.origin.kind ||
      (definition.origin.kind === 'mcp' && (adapter.origin.kind !== 'mcp' || adapter.origin.connectionId !== definition.origin.connectionId))) {
      throw new ToolAssemblyError('ADAPTER_MISMATCH');
    }

    // 取得已校验定义的独立副本；不转换字段、不补默认值，因此不是“规范化”。
    const snapshot = structuredClone(definition);

    // 输入、输出 Schema 均编译成功才继续；失败直接抛出，不发布半成品。
    const validator = new ToolSchemaValidator(snapshot);

    // 固定函数入口及其 this；此对象不会执行工具，也不会因调用方改动而变形。
    // freeze 只冻结入口对象，bind 不冻结适配器内部状态；后者仍由适配器实现负责。
    // 当前是一次性同步写入，中间无 await 或外部回调，普通调用不会观察到中间状态；
    // 这是同步进程内发布，不是事务。未来引入异步或持久化时须重新设计一致性。
    this.tools.set(snapshot.name, Object.freeze({
      definition: snapshot,
      validateInput: validator.validateInput.bind(validator),
      validateOutput: validator.validateOutput.bind(validator),
      execute: adapter.execute.bind(adapter),
      resources: adapter.resources?.bind(adapter),
    }));
  }

  /** 查询已装配定义副本，供策略预检查使用；未装配返回 undefined。 */
  get(name: string): ToolDefinition | undefined {
    const tool = this.tools.get(name);
    return tool ? structuredClone(tool.definition) : undefined;
  }

  /** 返回排序后的已装配描述副本；向用户或模型发布前仍需权限过滤。 */
  list(): ToolDefinition[] {
    return [...this.tools.keys()].sort().map((name) => structuredClone(this.tools.get(name)!.definition));
  }

  /**
   * 按运行固定版本取得装配句柄；不重新编译，不查找或执行外部插件。
   * 每次返回新的冻结对象且定义是副本，调用方修改不会污染目录；函数引用保持同一份，
   * 执行层据此可在领取后复核适配器是否被替换。
   * 执行层不得长久缓存此句柄；撤销不能收回已取得的函数引用，执行前需重新解析与授权。
   */
  resolve(name: string, expectedVersion: string): AssembledTool {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolAssemblyError('TOOL_NOT_ASSEMBLED');
    if (tool.definition.version !== expectedVersion) throw new ToolAssemblyError('VERSION_MISMATCH');
    return Object.freeze({ ...tool, definition: structuredClone(tool.definition) });
  }

  /** 撤销后续发现和解析；不撤销已经发生的工具副作用。 */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}
