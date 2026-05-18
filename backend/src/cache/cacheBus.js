import { EventEmitter } from "events";

export const CACHE_EVENTS = {
  INVALIDATE: "cache.invalidate",
};

/**
 * 增强版 cacheBus：
 * - 保留 EventEmitter 接口兼容性
 * - 追踪异步监听器产生的 Promise，供 Workers ctx.waitUntil() 使用
 * - 防止异步缓存失效操作在 Workers 响应返回后被运行时终止
 */
class CacheBus extends EventEmitter {
  constructor() {
    super();
    /** @type {Promise<any>[]} 待完成的异步操作 */
    this._pending = [];
  }

  /**
   * 覆盖 emit：捕获异步监听器返回的 Promise 并追踪
   */
  emit(event, ...args) {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      try {
        const result = listener(...args);
        // 如果监听器返回 Promise（async 函数），追踪它
        if (result && typeof result.then === "function") {
          this._pending.push(
            result.catch((err) => {
              console.error(`[cacheBus] 异步监听器执行失败 (event=${event}):`, err);
            })
          );
        }
      } catch (err) {
        console.error(`[cacheBus] 同步监听器执行失败 (event=${event}):`, err);
      }
    }
    return listeners.length > 0;
  }

  /**
   * 获取并清空所有待处理的异步操作 Promise
   * 调用方应将返回的 Promise 传给 ctx.waitUntil() 确保执行完成
   * @returns {Promise<void>}
   */
  flush() {
    if (this._pending.length === 0) {
      return Promise.resolve();
    }
    const pending = this._pending.splice(0);
    return Promise.allSettled(pending).then(() => {});
  }

  /**
   * 获取待处理操作数量（用于调试/监控）
   * @returns {number}
   */
  get pendingCount() {
    return this._pending.length;
  }
}

const cacheBus = new CacheBus();
cacheBus.setMaxListeners(50);

export default cacheBus;
