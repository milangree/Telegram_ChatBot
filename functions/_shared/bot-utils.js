// functions/_shared/bot-utils.js
// Bot 共享工具函数

const MESSAGE_REACTION_EMOJI = '✅';

const VERIFY_OPTION_COUNT = 6;
const VERIFY_OPTION_COLUMNS = 3;

const ADMIN_NUMERIC_INPUT_FIELDS = {
  VERIFICATION_TIMEOUT: { min: 60, max: 900, unit: 's', labelKey: 'panel.timeout', defaultValue: 300 },
  MAX_VERIFICATION_ATTEMPTS: { min: 1, max: 10, unit: '', labelKey: 'panel.attempts', defaultValue: 3 },
  INLINE_KB_MSG_DELETE_SECONDS: { min: 0, max: 25, unit: 's', labelKey: 'panel.inlineKbDelete', defaultValue: 15 },
};

function rowsN(items, cols, mk) {
  const rows = [];
  const width = Math.max(1, cols || 1);
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width).map(mk));
  return rows;
}

/** CSPRNG 整数 [0, max) */
function secureRandomInt(max) {
  const n = Math.max(1, Math.floor(max));
  if (n <= 1) return 0;
  const maxUnbiased = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= maxUnbiased);
  return x % n;
}

/** Fisher–Yates 洗牌（CSPRNG） */
function secureShuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randId() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseBoundedInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getUserMsgDeleteSeconds(settings) {
  return parseBoundedInt(settings?.USER_MSG_DELETE_SECONDS || '30', 30, 0, 600);
}

function getInlineKbMsgDeleteSeconds(settings) {
  if (settings?.INLINE_KB_MSG_DELETE_ENABLED === 'false') return 0;
  return parseBoundedInt(settings?.INLINE_KB_MSG_DELETE_SECONDS || settings?.USER_MSG_DELETE_SECONDS || '15', 15, 0, 25);
}

function getAdminNumericFieldConfig(field) {
  return ADMIN_NUMERIC_INPUT_FIELDS[field] || null;
}

function getAdminNumericInputKey(adminId) {
  return `pending:admin_numeric:${adminId}`;
}

async function setAdminNumericInput(kv, adminId, field) {
  if (!kv) return;
  await kv.put(getAdminNumericInputKey(adminId), JSON.stringify({ field }), { expirationTtl: 300 });
}

async function getAdminNumericInput(kv, adminId) {
  if (!kv) return null;
  const raw = await kv.get(getAdminNumericInputKey(adminId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.field ? parsed : null;
  } catch {
    return null;
  }
}

async function clearAdminNumericInput(kv, adminId) {
  if (!kv) return;
  await kv.delete(getAdminNumericInputKey(adminId)).catch(() => {});
}

function parseStrictInt(raw) {
  const v = String(raw || '').trim();
  if (!/^-?\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseAdminIds(str) {
  return (str || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
}

function isProtectedAdminUid(uid, settings) {
  const n = Number(uid);
  if (!Number.isFinite(n)) return false;
  return parseAdminIds(settings?.ADMIN_IDS).includes(n);
}

function canUserAppeal(blockedUser, settings) {
  return Boolean(blockedUser?.is_blocked) &&
    !blockedUser?.is_permanent_block &&
    settings?.AUTO_UNBLOCK_ENABLED === 'true';
}

function isPrivateChatId(chatId) {
  const n = Number(chatId);
  return Number.isFinite(n) && n > 0;
}

function hasInlineKeyboard(kb) {
  return Array.isArray(kb) && kb.some(row => Array.isArray(row) && row.length > 0);
}

function hasActionableInlineKeyboard(kb) {
  return Array.isArray(kb) && kb.some(row => Array.isArray(row) && row.some(btn =>
    btn && (
      btn.callback_data ||
      btn.url ||
      btn.web_app ||
      btn.login_url ||
      btn.switch_inline_query ||
      btn.switch_inline_query_current_chat ||
      btn.switch_inline_query_chosen_chat ||
      btn.callback_game ||
      btn.pay
    ),
  ));
}

function scheduleUserMsgDelete({ tg, settings, waitUntil, chatId, msgId }) {
  const seconds = getUserMsgDeleteSeconds(settings);
  if (!seconds || !msgId || !isPrivateChatId(chatId)) return;
  const task = (async () => {
    await new Promise(r => setTimeout(r, seconds * 1000));
    await tg.deleteMsg({ chatId, msgId }).catch(() => {});
  })();
  if (waitUntil) waitUntil(task);
  else task.catch(() => {});
}

function scheduleInlineKbMsgDelete({ tg, settings, waitUntil, chatId, msgId }) {
  const seconds = getInlineKbMsgDeleteSeconds(settings);
  if (!seconds || !msgId || !isPrivateChatId(chatId)) return;
  const task = (async () => {
    await new Promise(r => setTimeout(r, seconds * 1000));
    await tg.deleteMsg({ chatId, msgId }).catch(() => {});
  })();
  if (waitUntil) waitUntil(task);
  else task.catch(() => {});
}

async function sendUserMsg({ tg, settings, waitUntil, chatId, text, kb, parseMode = 'HTML', replyToMsgId, threadId }) {
  return tg.sendMsg({ chatId, text, kb, parseMode, replyToMsgId, threadId });
}

async function sendUserPhoto({ tg, settings, waitUntil, chatId, fileId, url, caption, kb, parseMode = 'HTML', threadId }) {
  return tg.sendPhoto({ chatId, fileId, url, caption, kb, parseMode, threadId });
}

async function reactSentOk({ tg, chatId, msgId, emoji = MESSAGE_REACTION_EMOJI }) {
  if (!chatId || !msgId) return;
  await tg.setMessageReaction({ chatId, msgId, emoji }).catch(() => {});
}

function scheduleEditedUserMsgDelete({ tg, settings, waitUntil, chatId, msgId, kb }) {
  if (hasActionableInlineKeyboard(kb)) return;
  scheduleInlineKbMsgDelete({ tg, settings, waitUntil, chatId, msgId });
}

async function editUserText({ tg, settings, waitUntil, chatId, msgId, text, kb, parseMode = 'HTML' }) {
  const r = await tg.editText({ chatId, msgId, text, kb, parseMode });
  if (r?.ok) scheduleEditedUserMsgDelete({ tg, settings, waitUntil, chatId, msgId, kb });
  return r;
}

async function editUserCaption({ tg, settings, waitUntil, chatId, msgId, caption, kb, parseMode = 'HTML' }) {
  const r = await tg.editCaption({ chatId, msgId, caption, kb, parseMode });
  if (r?.ok) scheduleEditedUserMsgDelete({ tg, settings, waitUntil, chatId, msgId, kb });
  return r;
}

async function editUserKb({ tg, settings, waitUntil, chatId, msgId, kb }) {
  const r = await tg.editKb({ chatId, msgId, kb });
  if (r?.ok) scheduleEditedUserMsgDelete({ tg, settings, waitUntil, chatId, msgId, kb });
  return r;
}

async function shouldProcessMessageOnce(kv, scope, chatId, msgId, ttlSeconds = 21600) {
  if (!kv || !chatId || !msgId) return true;
  const dedupeKey = `dedupe:${scope}:${chatId}:${msgId}`;

  const lock = await withUserLock(
    kv,
    `dedupe:${scope}:${chatId}:${msgId}`,
    async () => {
      const seen = await kv.get(dedupeKey);
      if (seen) return false;
      await kv.put(dedupeKey, '1', { expirationTtl: Math.max(60, ttlSeconds) });
      return true;
    },
    { ttlSeconds: 60, retries: 2, waitMs: 40 },
  );

  if (!lock.acquired) return false;
  return lock.value !== false;
}

async function withUserLock(kv, userLockId, fn, { ttlSeconds = 60, retries = 8, waitMs = 120 } = {}) {
  const lockKey = `lock:user:${userLockId}`;
  const ttl = Math.max(60, ttlSeconds);
  let token = null;

  for (let i = 0; i < retries; i++) {
    const existing = await kv.get(lockKey);
    if (!existing) {
      const candidate = randId();
      await kv.put(lockKey, candidate, { expirationTtl: ttl });
      const holder = await kv.get(lockKey);
      if (holder === candidate) {
        token = candidate;
        break;
      }
    }
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, waitMs + secureRandomInt(80)));
    }
  }

  if (!token) return { acquired: false, value: null };

  try {
    return { acquired: true, value: await fn() };
  } finally {
    const holder = await kv.get(lockKey);
    if (holder === token) {
      await kv.delete(lockKey).catch(() => {});
    }
  }
}

function fmtUtc8(ts, t = null) {
  if (!ts) return t ? t('list.none') : '';
  const d = new Date(new Date(ts).getTime() + 8 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function fmtMsgTime(ts) {
  if (!ts) return '--';
  const d = new Date(new Date(ts).getTime() + 8 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export {
  MESSAGE_REACTION_EMOJI,
  VERIFY_OPTION_COUNT,
  VERIFY_OPTION_COLUMNS,
  ADMIN_NUMERIC_INPUT_FIELDS,
  rowsN,
  secureRandomInt,
  secureShuffle,
  randId,
  parseBoundedInt,
  getUserMsgDeleteSeconds,
  getInlineKbMsgDeleteSeconds,
  getAdminNumericFieldConfig,
  getAdminNumericInputKey,
  setAdminNumericInput,
  getAdminNumericInput,
  clearAdminNumericInput,
  parseStrictInt,
  parseAdminIds,
  isProtectedAdminUid,
  canUserAppeal,
  isPrivateChatId,
  hasInlineKeyboard,
  hasActionableInlineKeyboard,
  scheduleUserMsgDelete,
  scheduleInlineKbMsgDelete,
  sendUserMsg,
  sendUserPhoto,
  reactSentOk,
  scheduleEditedUserMsgDelete,
  editUserText,
  editUserCaption,
  editUserKb,
  shouldProcessMessageOnce,
  withUserLock,
  fmtUtc8,
  fmtMsgTime,
};
