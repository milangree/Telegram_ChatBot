// functions/_shared/op-lock.js
// 高风险运维操作的互斥锁（数据库切换 / 导入 / 清空）
//
// 两级保护：
// 1) 进程内：同一 Node 实例内的 Promise 串行化，避免并发重入。
// 2) KV 锁：跨实例（Cloudflare 多 isolate / 多副本）互斥，带 TTL 兜底防死锁。
//
// 注意：KV 非强一致，锁仅用于降低并发窗口，不能替代底层事务。

const inFlight = new Map();
const LOCK_PREFIX = 'oplock:';
const DEFAULT_TTL_SEC = 120;

/** 进程内串行化：同 key 的调用排队执行。 */
export function withProcessLock(key, fn) {
  const prev = inFlight.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // 记录尾链，无论成功失败都不阻塞后续
  const tail = run.catch(() => {});
  inFlight.set(key, tail);
  tail.finally(() => {
    if (inFlight.get(key) === tail) inFlight.delete(key);
  });
  return run;
}

/**
 * 获取 KV 锁；成功返回 token，失败返回 null。
 * @param {object} kv
 * @param {string} name 锁名（不含前缀）
 * @param {object} opts { ttlSec, owner }
 */
export async function acquireKvLock(kv, name, { ttlSec = DEFAULT_TTL_SEC, owner = '' } = {}) {
  if (!kv) return null;
  const key = `${LOCK_PREFIX}${name}`;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = JSON.stringify({ token, owner: String(owner), at: new Date().toISOString() });

  const existing = await kv.get(key).catch(() => null);
  if (existing) {
    // 只有锁内容损坏（无 token）时才允许抢占，避免正常持有者被顶掉
    let validLock;
    try {
      const data = JSON.parse(existing);
      validLock = Boolean(data?.token);
    } catch {
      validLock = false;
    }
    if (validLock) return null;
  }

  await kv.put(key, payload, { expirationTtl: Math.max(30, ttlSec) });
  // 二次读取校验，降低并发写入互相覆盖的窗口
  const confirm = await kv.get(key).catch(() => null);
  if (!confirm) return null;
  try {
    return JSON.parse(confirm).token === token ? token : null;
  } catch {
    return null;
  }
}

/** 释放 KV 锁：仅当锁仍属于自己时删除。 */
export async function releaseKvLock(kv, name, token) {
  if (!kv || !token) return;
  const key = `${LOCK_PREFIX}${name}`;
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data?.token === token) await kv.delete(key).catch(() => {});
  } catch { /* noop */ }
}

/**
 * 组合锁：进程内串行 + KV 互斥。
 * 拿不到 KV 锁时抛出可识别的错误（路由层转 409）。
 */
export async function withOperationLock({ kv, name, owner = '', ttlSec = DEFAULT_TTL_SEC }, fn) {
  return withProcessLock(name, async () => {
    const token = await acquireKvLock(kv, name, { ttlSec, owner });
    if (!token) {
      const err = new Error('operation_in_progress');
      err.code = 'OPERATION_IN_PROGRESS';
      err.status = 409;
      throw err;
    }
    try {
      return await fn();
    } finally {
      await releaseKvLock(kv, name, token);
    }
  });
}
