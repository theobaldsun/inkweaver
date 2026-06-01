/**
 * Base64转换工具包
 * 
 * 用途：
 * - 提供高性能的Base64与Uint8Array互转功能
 * - 统一所有项目的Base64转换逻辑
 * - 支持浏览器和Node.js环境
 */

/**
 * 检查当前运行环境
 */
function isNodeJS(): boolean {
  return typeof process !== 'undefined' && 
         process.versions != null && 
         process.versions.node != null;
}

/**
 * 高性能Base64转Uint8Array
 * 
 * 浏览器环境使用 charCodeAt 循环，Node.js 使用 Buffer
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (isNodeJS()) {
    // Node.js环境：使用Buffer性能最佳
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    // 浏览器环境：使用 charCodeAt 循环（正确处理 Latin1 字节）
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * 高性能Uint8Array转Base64
 * 
 * 浏览器环境使用 charCode 拼接，Node.js 使用 Buffer
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  if (isNodeJS()) {
    // Node.js环境：使用Buffer性能最佳
    return Buffer.from(uint8Array).toString('base64');
  } else {
    // 浏览器环境：拼接字符后使用 btoa
    let binary = '';
    const len = uint8Array.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i] as number);
    }
    return btoa(binary);
  }
}


/**
 * 批量转换Base64字符串数组为Uint8Array数组
 */
export function base64ArrayToUint8ArrayArray(base64Array: string[]): Uint8Array[] {
  return base64Array.map(base64ToUint8Array);
}

/**
 * 批量转换Uint8Array数组为Base64字符串数组
 */
export function uint8ArrayArrayToBase64Array(uint8ArrayArray: Uint8Array[]): string[] {
  return uint8ArrayArray.map(uint8ArrayToBase64);
}

/**
 * 检查字符串是否为有效的Base64格式
 */
export function isValidBase64(str: string): boolean {
  if (typeof str !== 'string') return false;
  
  try {
    // 尝试解码和重新编码来验证
    const decoded = atob(str);
    const reencoded = btoa(decoded);
    return reencoded === str;
  } catch {
    return false;
  }
}

/**
 * 获取Base64字符串的字节大小
 */
export function getBase64ByteSize(base64: string): number {
  if (!isValidBase64(base64)) return 0;
  
  // Base64编码后的字节数 = (字符串长度 * 3) / 4 - 填充字节
  const stringLength = base64.length;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (stringLength * 3) / 4 - padding;
}

/**
 * Base64转换工具配置选项
 */
export interface Base64Config {
  /**
   * 是否启用性能优化（默认启用）
   */
  optimizePerformance?: boolean;
  
  /**
   * 是否启用输入验证（默认启用）
   */
  validateInput?: boolean;
}

/**
 * 创建配置化的Base64转换器
 */
export function createBase64Converter(config: Base64Config = {}) {
  const {
    optimizePerformance = true,
    validateInput = true
  } = config;

  return {
    /**
     * 安全的Base64转Uint8Array
     */
    safeBase64ToUint8Array(base64: string): Uint8Array | null {
      if (validateInput && !isValidBase64(base64)) {
        console.warn('Invalid Base64 string provided');
        return null;
      }
      
      try {
        return base64ToUint8Array(base64);
      } catch (error) {
        console.error('Failed to convert Base64 to Uint8Array:', error);
        return null;
      }
    },

    /**
     * 安全的Uint8Array转Base64
     */
    safeUint8ArrayToBase64(uint8Array: Uint8Array): string | null {
      if (validateInput && (!uint8Array || !(uint8Array instanceof Uint8Array))) {
        console.warn('Invalid Uint8Array provided');
        return null;
      }
      
      try {
        return uint8ArrayToBase64(uint8Array);
      } catch (error) {
        console.error('Failed to convert Uint8Array to Base64:', error);
        return null;
      }
    },

    /**
     * 批量安全转换
     */
    safeBase64ArrayToUint8ArrayArray(base64Array: string[]): (Uint8Array | null)[] {
      return base64Array.map(base64 => this.safeBase64ToUint8Array(base64));
    },

    /**
     * 批量安全转换
     */
    safeUint8ArrayArrayToBase64Array(uint8ArrayArray: Uint8Array[]): (string | null)[] {
      return uint8ArrayArray.map(uint8Array => this.safeUint8ArrayToBase64(uint8Array));
    }
  };
}

/**
 * 默认的Base64转换器实例
 */
export const base64Converter = createBase64Converter();

/**
 * 导出所有功能
 */
export default {
  base64ToUint8Array,
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray,
  uint8ArrayArrayToBase64Array,
  isValidBase64,
  getBase64ByteSize,
  createBase64Converter,
  base64Converter
};