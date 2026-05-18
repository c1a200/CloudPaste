/**
 * BoundedMap - 带有最大容量和可选 TTL 限制的 Map
 * 用于替代无限增长的全局 Map，防止 Workers isolate 长时间复用时内存泄漏
 *
 * 特性：
 * - 超过 maxSize 时淘汰最旧条目（FIFO）
 * - 可选 TTL：读取时自动过期
 * - 轻量：无定时器，依靠读/写时懒清理
 */
export class BoundedMap {
  /**
   * @param {{ maxSize?: number, ttlMs?: number, name?: string }} [options]
   */
  constructor(options = {}) {
    this._map = new Map();
    this.maxSize = options.maxSize || 200;
    this.ttlMs = options.ttlMs || 0; // 0 表示无 TTL
    this.name = options.name || "BoundedMap";
  }

  /**
   * 获取值（自动检查 TTL）
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() - entry._createdAt > this.ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * 设置值
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    // 如果 key 已存在，先删除以维持插入顺序
    if (this._map.has(key)) {
      this._map.delete(key);
    }
    this._map.set(key, { value, _createdAt: Date.now() });
    this._evict();
  }

  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (this.ttlMs > 0 && Date.now() - entry._createdAt > this.ttlMs) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    return this._map.delete(key);
  }

  clear() {
    this._map.clear();
  }

  get size() {
    return this._map.size;
  }

  /**
   * 淘汰超出容量的最旧条目
   * @private
   */
  _evict() {
    while (this._map.size > this.maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey === undefined) break;
      this._map.delete(oldestKey);
    }
  }

  /**
   * 清理所有过期条目（可选，用于周期性维护）
   * @returns {number} 清理的条目数
   */
  prune() {
    if (this.ttlMs <= 0) return 0;
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this._map) {
      if (now - entry._createdAt > this.ttlMs) {
        this._map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

/**
 * BoundedSet - 带有最大容量和 TTL 限制的 Set
 * 用于替代无限增长的全局 Set（如 miniRedirTried302）
 */
export class BoundedSet {
  /**
   * @param {{ maxSize?: number, ttlMs?: number }} [options]
   */
  constructor(options = {}) {
    this._map = new Map(); // key -> createdAt timestamp
    this.maxSize = options.maxSize || 200;
    this.ttlMs = options.ttlMs || 0;
  }

  add(value) {
    if (this._map.has(value)) {
      this._map.delete(value);
    }
    this._map.set(value, Date.now());
    this._evict();
  }

  has(value) {
    const createdAt = this._map.get(value);
    if (createdAt === undefined) return false;
    if (this.ttlMs > 0 && Date.now() - createdAt > this.ttlMs) {
      this._map.delete(value);
      return false;
    }
    return true;
  }

  delete(value) {
    return this._map.delete(value);
  }

  clear() {
    this._map.clear();
  }

  get size() {
    return this._map.size;
  }

  /** @private */
  _evict() {
    while (this._map.size > this.maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey === undefined) break;
      this._map.delete(oldestKey);
    }
  }
}
