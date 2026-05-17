/**
 * 调度任务注册表
 * - 管理后台调度作业（scheduled_jobs）的 handler
 * - 每个 handler 通过 handler.id 进行绑定
 *   - handler.id：任务类型 ID（例如 'cleanup_upload_sessions'）
 *   - scheduled_jobs.task_id：作业实例 ID（例如 'cleanup_upload_sessions_default'）
 * - 支持存储和查询 handler 元数据（name、description、category、configSchema）
 */

export class ScheduledTaskRegistry {
  constructor() {
    /**
     * 存储完整的 handler 对象
     * @type {Map<string, {
     *   id: string,
     *   name: string,
     *   description: string,
     *   category: "maintenance" | "business",
     *   configSchema: Array<{
     *     name: string,
     *     label: string,
     *     type: "string" | "number" | "boolean" | "select" | "textarea",
     *     defaultValue: any,
     *     required: boolean,
     *     min?: number,
     *     max?: number,
     *     options?: Array<{ value: any, label: string }>,
     *     description?: string
     *   }>,
     *   run: (ctx: any) => Promise<void>
     * }>}
     */
    this.handlers = new Map();
  }

  /**
   * 注册调度任务处理器（含元数据）
   * @param {{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>,
   *   run: (ctx: any) => Promise<void>
   * }} handler
   */
  register(handler) {
    // 验证必需字段：id
    if (!handler || typeof handler.id !== "string" || handler.id.length === 0) {
      throw new Error("[ScheduledTaskRegistry] handler.id 必须是非空字符串");
    }
    // 验证必需字段：run
    if (typeof handler.run !== "function") {
      throw new Error(
        `[ScheduledTaskRegistry] handler.run 必须是可调用函数 (taskId=${handler.id})`,
      );
    }
    // 验证必需字段：name
    if (typeof handler.name !== "string" || handler.name.length === 0) {
      throw new Error(
        `[ScheduledTaskRegistry] handler.name 必须是非空字符串 (taskId=${handler.id})`,
      );
    }
    // 验证必需字段：category
    if (handler.category !== "maintenance" && handler.category !== "business") {
      throw new Error(
        `[ScheduledTaskRegistry] handler.category 必须是 "maintenance" 或 "business" (taskId=${handler.id})`,
      );
    }

    this.handlers.set(handler.id, handler);
  }

  /**
   * 获取所有 handler 的元数据
   * @returns {Array<{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>
   * }>}
   */
  getHandlerTypes() {
    return Array.from(this.handlers.values()).map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description || "",
      category: h.category,
      configSchema: h.configSchema || [],
    }));
  }

  /**
   * 获取单个 handler 的元数据
   * @param {string} taskId
   * @returns {{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>
   * } | null}
   */
  getHandlerType(taskId) {
    const h = this.handlers.get(taskId);
    if (!h) return null;
    return {
      id: h.id,
      name: h.name,
      description: h.description || "",
      category: h.category,
      configSchema: h.configSchema || [],
    };
  }

  /**
   * 获取完整的 handler 对象
   * @param {string} taskId
   * @returns {{ id: string, run: (ctx: any) => Promise<void>, ... } | null}
   */
  getHandler(taskId) {
    if (!this.handlers.size) {
      return null;
    }
    return this.handlers.get(taskId) || null;
  }

  /**
   * 列出所有已注册的任务 ID
   * @returns {string[]}
   */
  listIds() {
    return Array.from(this.handlers.keys());
  }
}

/**
 * 全局单例注册表
 */
export const scheduledTaskRegistry = new ScheduledTaskRegistry();

/**
 * 注册内建的维护任务处理器（返回 Promise，可 await 确保注册完成）
 * - 在应用启动阶段调用一次
 * - 返回 Promise 以便调用方等待所有 handler 注册完毕，
 *   避免 scheduled 事件在冷启动时因 handler 未就绪而跳过任务
 * @returns {Promise<void>}
 */
let _handlersReadyPromise = null;

export function registerScheduledHandlers() {
  if (_handlersReadyPromise) return _handlersReadyPromise;

  const taskImports = [
    { path: "./tasks/CleanupUploadSessionsTask.js", exportName: "CleanupUploadSessionsTask" },
    { path: "./tasks/ScheduledSyncCopyTask.js", exportName: "ScheduledSyncCopyTask" },
    { path: "./tasks/ScheduledFsIndexRebuildTask.js", exportName: "ScheduledFsIndexRebuildTask" },
    { path: "./tasks/ScheduledFsIndexApplyDirtyTask.js", exportName: "ScheduledFsIndexApplyDirtyTask" },
    { path: "./tasks/RefreshStorageUsageSnapshotsTask.js", exportName: "RefreshStorageUsageSnapshotsTask" },
  ];

  _handlersReadyPromise = Promise.allSettled(
    taskImports.map(async ({ path, exportName }) => {
      try {
        const mod = await import(path);
        const TaskCtor = mod[exportName];
        if (TaskCtor) {
          const taskInstance = new TaskCtor();
          scheduledTaskRegistry.register(taskInstance);
          console.log(`[ScheduledTaskRegistry] 成功注册调度任务: ${taskInstance.id}`);
        }
      } catch (err) {
        console.warn(`[ScheduledTaskRegistry] 注册 ${exportName} 失败:`, err);
      }
    })
  ).then(() => {
    console.log(`[ScheduledTaskRegistry] 所有调度任务注册完毕，共 ${scheduledTaskRegistry.handlers.size} 个`);
  });

  return _handlersReadyPromise;
}

/**
 * 等待所有调度任务处理器注册完毕
 * - 在 scheduled handler / runDueScheduledJobs 执行前调用
 * @returns {Promise<void>}
 */
export function waitForHandlersReady() {
  return _handlersReadyPromise || Promise.resolve();
}
