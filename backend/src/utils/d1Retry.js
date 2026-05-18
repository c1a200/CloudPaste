/**
 * D1 数据库操作重试工具
 *
 * Cloudflare D1 在高并发时可能返回临时性错误（连接中断、超时等）。
 * 对关键操作（如调度锁获取、状态写入）提供快速重试，避免单次抖动导致业务失败。
 *
 * 设计原则：
 * - 仅对幂等/可重试的写操作使用
 * - 快速重试（不做长时间退避，Workers 有执行时间限制）
 * - 最多 1-2 次重试，避免在 Workers 中浪费 CPU 时间
 */

/**
 * 判断错误是否为 D1 临时性可重试错误
 * @param {Error} error
 * @returns {boolean}
 */
function isRetryableD1Error(error) {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  const code = (error.code || "").toLowerCase();

  // D1 内部错误 / 连接问题
  if (msg.includes("d1_error") || msg.includes("d1_restart")) return true;
  // 数据库繁忙/锁定
  if (msg.includes("database is locked") || msg.includes("sqlite_busy")) return true;
  // 网络超时
  if (msg.includes("network") || msg.includes("timeout") || msg.includes("timed out")) return true;
  // 连接被重置
  if (msg.includes("connection") && (msg.includes("reset") || msg.includes("closed"))) return true;
  // 服务内部错误（500 类）
  if (code === "internal_error" || code === "server_error") return true;

  return false;
}

/**
 * 带重试的 D1 操作执行器
 * @param {() => Promise<T>} operation - 要执行的异步操作
 * @param {{ maxRetries?: number, delayMs?: number, label?: string }} [options]
 * @returns {Promise<T>}
 * @template T
 */
export async function withD1Retry(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 1;
  const baseDelayMs = options.delayMs ?? 50;
  const label = options.label || "D1 operation";

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableD1Error(error)) {
        const delay = baseDelayMs * (attempt + 1); // 50ms, 100ms
        console.warn(
          `[d1Retry] ${label} 第${attempt + 1}次尝试失败，${delay}ms 后重试:`,
          error?.message || error
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastError;
}
