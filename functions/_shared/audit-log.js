// functions/_shared/audit-log.js
// 管理员操作审计日志

const AUDIT_LOG_PREFIX = 'audit:log:';
const AUDIT_LOG_MAX_ENTRIES = 1000; // 最多保留 1000 条

/**
 * 记录管理员操作
 * @param {object} db 数据库实例
 * @param {object} kv KV 存储实例
 * @param {string} action 操作类型（如 'user.block', 'settings.save'）
 * @param {number} adminId 管理员用户 ID
 * @param {object} details 操作详情
 */
export async function logAuditAction(db, kv, action, adminId, details = {}) {
  if (!kv) return;

  const entry = {
    action,
    adminId: Number(adminId),
    details,
    timestamp: new Date().toISOString(),
  };

  try {
    // 使用时间戳 + 随机数作为 key，确保唯一性
    const key = `${AUDIT_LOG_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await kv.put(key, JSON.stringify(entry), { expirationTtl: 86400 * 30 }); // 保留 30 天

    // 清理旧日志（保留最近 AUDIT_LOG_MAX_ENTRIES 条）
    await cleanupOldLogs(kv);
  } catch (e) {
    // 审计日志失败不应影响主流程
    console.error('[AuditLog] Failed to log action:', e?.message || e);
  }
}

/**
 * 获取审计日志
 * @param {object} kv KV 存储实例
 * @param {number} limit 返回条数
 * @returns {Promise<Array>}
 */
export async function getAuditLogs(kv, limit = 100) {
  if (!kv) return [];

  try {
    const logs = [];
    let cursor;

    do {
      const page = await kv.list({ prefix: AUDIT_LOG_PREFIX, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of page?.keys || []) {
        const raw = await kv.get(item.name);
        if (raw) {
          try {
            logs.push(JSON.parse(raw));
          } catch {
            // 忽略无效条目
          }
        }
      }
      cursor = page?.list_complete === false ? page.cursor : null;
    } while (cursor && logs.length < limit);

    // 按时间倒序排列
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return logs.slice(0, limit);
  } catch (e) {
    console.error('[AuditLog] Failed to get logs:', e?.message || e);
    return [];
  }
}

/**
 * 清理旧日志，保留最近 AUDIT_LOG_MAX_ENTRIES 条
 */
async function cleanupOldLogs(kv) {
  try {
    const allKeys = [];
    let cursor;

    do {
      const page = await kv.list({ prefix: AUDIT_LOG_PREFIX, limit: 200, ...(cursor ? { cursor } : {}) });
      for (const item of page?.keys || []) {
        allKeys.push(item.name);
      }
      cursor = page?.list_complete === false ? page.cursor : null;
    } while (cursor);

    // 如果超过最大条数，删除最旧的
    if (allKeys.length > AUDIT_LOG_MAX_ENTRIES) {
      // 按 key 排序（时间戳在前，所以按 key 排序即可）
      allKeys.sort();
      const toDelete = allKeys.slice(0, allKeys.length - AUDIT_LOG_MAX_ENTRIES);
      for (const key of toDelete) {
        await kv.delete(key).catch(() => {});
      }
    }
  } catch (e) {
    // 清理失败不应影响主流程
    console.error('[AuditLog] Failed to cleanup old logs:', e?.message || e);
  }
}
