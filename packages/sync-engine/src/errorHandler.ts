/**
 * 错误处理和监控服务
 * 
 * 用途：
 * - 统一处理同步过程中的错误
 * - 提供错误分类和恢复策略
 * - 监控同步状态和性能
 * 
 * 输入：错误对象、上下文信息
 * 输出：错误处理结果、监控数据
 */

import { createLogger } from "@inkweaver/shared";

interface ErrorContext {
  docId?: string;
  operation: 'push' | 'pull' | 'websocket' | 'conflict' | 'cache';
  clientId?: string;
  retryCount?: number;
  timestamp: number;
}

interface ErrorMetrics {
  totalErrors: number;
  errorByType: Map<string, number>;
  errorByOperation: Map<string, number>;
  lastErrorTime: number;
  recoverySuccessRate: number;
}

interface RecoveryStrategy {
  maxRetries: number;
  retryDelay: number;
  fallbackOperation?: string;
  shouldRetry: (error: Error, context: ErrorContext) => boolean;
}

export class ErrorHandler {
  private metrics: ErrorMetrics = {
    totalErrors: 0,
    errorByType: new Map(),
    errorByOperation: new Map(),
    lastErrorTime: 0,
    recoverySuccessRate: 0,
  };
  
  private recoveryStrategies = new Map<string, RecoveryStrategy>();
  private logger = createLogger({ scope: "error-handler" });

  constructor() {
    this.setupDefaultStrategies();
  }

  /**
   * 设置默认恢复策略
   */
  private setupDefaultStrategies(): void {
    // 网络错误策略
    this.recoveryStrategies.set('network', {
      maxRetries: 3,
      retryDelay: 2000,
      fallbackOperation: 'offline-mode',
      shouldRetry: (error, context) => {
        return context.retryCount! < 3 && 
               (error.message.includes('network') || 
                error.message.includes('timeout') ||
                error.message.includes('ECONN'));
      }
    });

    // 冲突错误策略
    this.recoveryStrategies.set('conflict', {
      maxRetries: 1,
      retryDelay: 0,
      fallbackOperation: 'merge-resolution',
      shouldRetry: (error, context) => {
        return error.message.includes('conflict') || 
               error.message.includes('409');
      }
    });

    // 认证错误策略
    this.recoveryStrategies.set('authentication', {
      maxRetries: 1,
      retryDelay: 0,
      fallbackOperation: 're-authenticate',
      shouldRetry: (error, context) => {
        return error.message.includes('401') || 
               error.message.includes('403') ||
               error.message.includes('auth');
      }
    });

    // 服务器错误策略
    this.recoveryStrategies.set('server', {
      maxRetries: 2,
      retryDelay: 5000,
      fallbackOperation: 'wait-and-retry',
      shouldRetry: (error, context) => {
        return error.message.includes('500') || 
               error.message.includes('503') ||
               error.message.includes('server');
      }
    });
  }

  /**
   * 处理错误
   */
  async handleError(error: Error, context: ErrorContext): Promise<{ 
    shouldRetry: boolean; 
    retryDelay?: number;
    fallbackOperation?: string;
    recoveryStrategy?: string;
  }> {
    // 更新监控指标
    this.updateMetrics(error, context);

    // 记录错误日志
    this.logError(error, context);

    // 确定错误类型和恢复策略
    const errorType = this.classifyError(error);
    const strategy = this.recoveryStrategies.get(errorType);

    if (!strategy) {
      this.logger.warn(`No recovery strategy found for error type: ${errorType}`);
      return { shouldRetry: false };
    }

    // 检查是否应该重试
    const shouldRetry = strategy.shouldRetry(error, context);
    
    if (shouldRetry && context.retryCount! < strategy.maxRetries) {
      this.logger.info(`Retrying operation (attempt ${context.retryCount! + 1}/${strategy.maxRetries})`);
      
      return {
        shouldRetry: true,
        retryDelay: strategy.retryDelay,
        fallbackOperation: strategy.fallbackOperation,
        recoveryStrategy: errorType
      };
    }

    // 超过重试次数或不应该重试
    this.logger.error(`Operation failed after ${context.retryCount} attempts:`, error.message);
    
    return {
      shouldRetry: false,
      fallbackOperation: strategy.fallbackOperation,
      recoveryStrategy: errorType
    };
  }

  /**
   * 错误分类
   */
  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('timeout') || message.includes('econn')) {
      return 'network';
    }
    
    if (message.includes('conflict') || message.includes('409')) {
      return 'conflict';
    }
    
    if (message.includes('401') || message.includes('403') || message.includes('auth')) {
      return 'authentication';
    }
    
    if (message.includes('500') || message.includes('503') || message.includes('server')) {
      return 'server';
    }
    
    if (message.includes('quota') || message.includes('storage') || message.includes('full')) {
      return 'storage';
    }
    
    return 'unknown';
  }

  /**
   * 更新监控指标
   */
  private updateMetrics(error: Error, context: ErrorContext): void {
    this.metrics.totalErrors++;
    this.metrics.lastErrorTime = context.timestamp;

    // 按错误类型统计
    const errorType = this.classifyError(error);
    const typeCount = this.metrics.errorByType.get(errorType) || 0;
    this.metrics.errorByType.set(errorType, typeCount + 1);

    // 按操作类型统计
    const opCount = this.metrics.errorByOperation.get(context.operation) || 0;
    this.metrics.errorByOperation.set(context.operation, opCount + 1);
  }

  /**
   * 记录错误日志
   */
  private logError(error: Error, context: ErrorContext): void {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      docId: context.docId,
      operation: context.operation,
      clientId: context.clientId,
      retryCount: context.retryCount,
      timestamp: new Date(context.timestamp).toISOString()
    };

    if (this.isCriticalError(error)) {
      this.logger.error('Critical sync error:', errorInfo);
    } else if (this.isRecoverableError(error)) {
      this.logger.warn('Recoverable sync error:', errorInfo);
    } else {
      this.logger.info('Sync error:', errorInfo);
    }
  }

  /**
   * 判断是否为严重错误
   */
  private isCriticalError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('corrupt') || 
           message.includes('fatal') || 
           message.includes('integrity');
  }

  /**
   * 判断是否为可恢复错误
   */
  private isRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('network') || 
           message.includes('timeout') || 
           message.includes('conflict');
  }

  /**
   * 获取监控指标
   */
  getMetrics(): ErrorMetrics {
    return { ...this.metrics };
  }

  /**
   * 重置监控指标
   */
  resetMetrics(): void {
    this.metrics = {
      totalErrors: 0,
      errorByType: new Map(),
      errorByOperation: new Map(),
      lastErrorTime: 0,
      recoverySuccessRate: 0,
    };
  }

  /**
   * 添加自定义恢复策略
   */
  addRecoveryStrategy(name: string, strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(name, strategy);
    this.logger.info(`Added custom recovery strategy: ${name}`);
  }

  /**
   * 记录恢复成功
   */
  recordRecoverySuccess(strategy: string): void {
    // 这里可以记录恢复成功率等指标
    this.logger.info(`Recovery successful with strategy: ${strategy}`);
  }

  /**
   * 生成错误报告
   */
  generateErrorReport(): any {
    return {
      metrics: this.metrics,
      strategies: Array.from(this.recoveryStrategies.keys()),
      timestamp: Date.now(),
      summary: {
        totalErrors: this.metrics.totalErrors,
        mostCommonError: this.getMostCommonError(),
        mostCommonOperation: this.getMostCommonOperation(),
        errorRate: this.calculateErrorRate()
      }
    };
  }

  /**
   * 获取最常见的错误类型
   */
  private getMostCommonError(): string {
    let maxCount = 0;
    let mostCommon = 'none';
    
    this.metrics.errorByType.forEach((count, type) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = type;
      }
    });
    
    return mostCommon;
  }

  /**
   * 获取最常见的操作类型
   */
  private getMostCommonOperation(): string {
    let maxCount = 0;
    let mostCommon = 'none';
    
    this.metrics.errorByOperation.forEach((count, operation) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = operation;
      }
    });
    
    return mostCommon;
  }

  /**
   * 计算错误率（基于时间窗口）
   */
  private calculateErrorRate(): number {
    const timeWindow = 60 * 60 * 1000; // 1小时
    const recentErrors = Array.from(this.metrics.errorByType.values())
      .reduce((sum, count) => sum + count, 0);
    
    // 这里可以基于实际的操作次数来计算错误率
    // 目前简化实现
    return recentErrors / 100; // 假设100次操作
  }
}