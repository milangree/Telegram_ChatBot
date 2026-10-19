// functions/_shared/error-handler.js
// 统一错误处理工具

/**
 * 错误级别
 * - 'warn'  — 可预期的错误（验证失败、用户输入错误）
 * - 'error' — 系统错误（数据库失败、外部 API 失败）
 */
const LOG_LEVELS = { warn: 'WARN', error: 'ERROR' };

/**
 * 统一错误日志
 * @param {string} module 模块名（如 'API', 'BOT', 'DB'）
 * @param {string} operation 操作描述（如 'auth.login', 'settings.save'）
 * @param {Error|string} err 错误对象或消息
 * @param {object} context 上下文信息（如 userId, requestId）
 * @param {'warn'|'error'} level 错误级别
 */
export function logError(module, operation, err, context = {}, level = 'error') {
  const tag = `[${module}] ${operation}`;
  const message = err?.message || String(err);
  const stack = err?.stack ? `\n${err.stack}` : '';
  const ctx = Object.keys(context).length ? ` | ${JSON.stringify(context)}` : '';
  const prefix = LOG_LEVELS[level] || 'ERROR';
  console.error(`[${prefix}] ${tag}: ${message}${ctx}${stack}`);
}

/**
 * 包装 async 函数，统一捕获和记录错误
 * @param {Function} fn 要包装的函数
 * @param {string} module 模块名
 * @param {string} operation 操作描述
 * @param {object} context 上下文信息
 * @returns {Function} 包装后的函数
 */
export function withErrorHandling(fn, module, operation, context = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logError(module, operation, err, context);
      throw err;
    }
  };
}

/**
 * 创建 API 错误响应
 * @param {string} message 错误消息
 * @param {number} status HTTP 状态码
 * @param {object} extra 额外字段
 * @returns {Response}
 */
export function apiError(message, status = 500, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 安全执行 — 捕获错误并返回默认值
 * @param {Function} fn 要执行的函数
 * @param {*} defaultValue 出错时的默认值
 * @param {string} module 模块名
 * @param {string} operation 操作描述
 * @returns {Promise<*>}
 */
export async function safeExecute(fn, defaultValue, module, operation) {
  try {
    return await fn();
  } catch (err) {
    logError(module, operation, err);
    return defaultValue;
  }
}

/**
 * 静默执行 — 用于 fire-and-forget 场景，只记录不抛出
 * @param {Promise} promise Promise 对象
 * @param {string} module 模块名
 * @param {string} operation 操作描述
 */
export function silentCatch(promise, module, operation) {
  if (promise && typeof promise.catch === 'function') {
    promise.catch(err => logError(module, operation, err));
  }
}
