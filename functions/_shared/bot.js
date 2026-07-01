import { TG, esc, name, msgType } from './tg.js';
import { generateCode, generateWrongOptions } from './captcha.js';
import { createBotT, getBotCommands, normalizeBotLocale } from './bot-i18n.js';
import {
  findMatchedMessageFilterRule,
  getMessageFilterRuleLabel,
  normalizeMessageFilterRule,
  parseMessageFilterRules,
  serializeMessageFilterRules,
} from '../../shared/message-filters.js';

// ── 验证辅助方法 ─────────────────────────────────────────────────────────────
const VERIFY_OPTION_COUNT = 6;
const VERIFY_OPTION_COLUMNS = 3;

function rowsN(items, cols, mk) {
  const rows = [];
  const width = Math.max(1, cols || 1);
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width).map(mk));
  return rows;
}

/** 随机生成一道整数四则运算题（保证结果为正整数、除法整除） */
function generateMathQuestion() {
  const ops = ['+', '-', '×', '÷'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;

  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 20) + 1;   // 1-20
      b = Math.floor(Math.random() * 20) + 1;
      answer = a + b;
      break;
    case '-':
      answer = Math.floor(Math.random() * 20) + 1; // 保证结果为正
      b = Math.floor(Math.random() * 20) + 1;
      a = answer + b;
      break;
    case '×':
      a = Math.floor(Math.random() * 9) + 2;    // 2-10
      b = Math.floor(Math.random() * 9) + 2;
      answer = a * b;
      break;
    case '÷':
      b = Math.floor(Math.random() * 9) + 2;    // 2-10，除数不为 0
      answer = Math.floor(Math.random() * 9) + 2; // 2-10
      a = b * answer;                              // 保证整除
      break;
  }

  return { q: `${a} ${op} ${b}`, a: String(answer), answerNum: answer };
}

function mkMathVerify() {
  const { q, a, answerNum } = generateMathQuestion();
  const opts = new Set([answerNum]);
  while (opts.size < VERIFY_OPTION_COUNT) {
    // 生成相近的干扰选项
    const c = answerNum + Math.floor(Math.random() * 15) - 7;
    if (c > 0 && c !== answerNum) opts.add(c);
  }
  const arr = [...opts].sort(() => Math.random() - 0.5).map(String);
  return {
    question: `<b>${q} = ?</b>`,
    answer: a,
    kb: rowsN(arr, VERIFY_OPTION_COLUMNS, n => ({ text: n, callback_data: `v:${n}` })),
  };
}

function randId() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── 验证超时通知 ────────────────────────────────────────────────────────────
function scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId, timeout, verifyMsgId }) {
  let fired = false;
  const cleanup = async () => {
    if (fired) return; // setTimeout 和 waitUntil 去重
    fired = true;
    console.log('[verify_timeout] cleanup for user', userId, 'verifyMsgId:', verifyMsgId);
    const v = await db.getVerify(userId).catch(() => null);
    // 记录仍存在且未过期（含 5 秒容差），跳过
    if (v && v.expires_at > Date.now() + 5000) return;
    // 用户已验证，跳过
    const user = await db.getUser(userId).catch(() => null);
    if (user?.is_verified) return;
    // 清理 webverify KV
    if (v?.web_verify_id) await kv.delete(`webverify:${v.web_verify_id}`).catch(() => {});
    await db.delVerify(userId).catch(() => {});
    // 仅当 pending 仍指向原始消息时才删除，避免丢失用户后续消息
    const pendingRaw = await kv.get(`pending:${userId}`).catch(() => null);
    if (pendingRaw) {
      try {
        const p = JSON.parse(pendingRaw);
        if (!p.msgId || p.msgId === verifyMsgId) {
          await kv.delete(`pending:${userId}`).catch(() => {});
        }
      } catch { await kv.delete(`pending:${userId}`).catch(() => {}); }
    }
    // 编辑验证消息，优先用捕获的参数，回退用记录字段
    const msgId = verifyMsgId || v?.verify_msg_id;
    if (msgId) {
      console.log('[verify_timeout] editing message', msgId, 'for user', userId);
      await tg.editText({ chatId: userId, msgId, text: '⏳ 验证已超时，请重新发送消息以发起新的验证。', kb: [] }).catch(e => {
        console.error('[verify_timeout] editText failed:', e?.description || e);
      });
    } else {
      console.warn('[verify_timeout] no verifyMsgId for user', userId);
    }
  };
  // 主要方式：setTimeout（Docker 和 CF Workers 均可用）
  setTimeout(cleanup, timeout * 1000 + 2000);
  // 备份方式：waitUntil（CF Workers 可保持执行上下文存活）
  if (waitUntil) {
    const task = (async () => {
      await new Promise(r => setTimeout(r, timeout * 1000 + 2000));
      await cleanup();
    })();
    waitUntil(task);
  }
}

// ── 频率限制 ─────────────────────────────────────────────────────────────────
const rateMap = new Map();
function rateCheck(uid, max) {
  const now = Date.now();
  const ts  = (rateMap.get(uid) || []).filter(t => now - t < 60000);
  ts.push(now); rateMap.set(uid, ts);
  return ts.length > max;
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
  // Cloudflare Pages Functions 的后台任务生命周期较短，限制在 25 秒内更稳妥。
  return parseBoundedInt(settings?.INLINE_KB_MSG_DELETE_SECONDS || settings?.USER_MSG_DELETE_SECONDS || '15', 15, 0, 25);
}

const MESSAGE_REACTION_EMOJI = '✅';

const ADMIN_NUMERIC_INPUT_FIELDS = {
  VERIFICATION_TIMEOUT: { min: 60, max: 900, unit: 's', labelKey: 'panel.timeout', defaultValue: 300 },
  MAX_VERIFICATION_ATTEMPTS: { min: 1, max: 10, unit: '', labelKey: 'panel.attempts', defaultValue: 3 },
  INLINE_KB_MSG_DELETE_SECONDS: { min: 0, max: 25, unit: 's', labelKey: 'panel.inlineKbDelete', defaultValue: 15 },
};

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

function getAdminFilterInputKey(adminId) {
  return `pending:admin_filter:${adminId}`;
}

async function setAdminFilterInput(kv, adminId, payload) {
  if (!kv) return;
  await kv.put(getAdminFilterInputKey(adminId), JSON.stringify(payload || {}), { expirationTtl: 600 });
}

async function getAdminFilterInput(kv, adminId) {
  if (!kv) return null;
  const raw = await kv.get(getAdminFilterInputKey(adminId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.action ? parsed : null;
  } catch {
    return null;
  }
}

async function clearAdminFilterInput(kv, adminId) {
  if (!kv) return;
  await kv.delete(getAdminFilterInputKey(adminId)).catch(() => {});
}

function parseStrictInt(raw) {
  const v = String(raw || '').trim();
  if (!/^-?\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildAdminNumericPromptText(t, cfg) {
  const label = t(cfg.labelKey);
  const unit = cfg.unit || '';
  return t('admin.numericPrompt', { label, min: cfg.min, max: cfg.max, unit });
}

function getMessageFilterRules(settings) {
  return parseMessageFilterRules(settings?.MESSAGE_FILTER_RULES);
}

function findBlockedRuleForMessage(settings, message) {
  const rules = getMessageFilterRules(settings);
  if (!rules.length) return null;
  return findMatchedMessageFilterRule(rules, message);
}

function getMessageFilterTypeLabel(type, t) {
  return {
    text: t('filter.type.text'),
    regex: t('filter.type.regex'),
    json: 'JSON',
  }[type] || type;
}

function getLocalizedMessageFilterRuleLabel(rule, t) {
  const normalized = normalizeMessageFilterRule(rule);
  return `${getMessageFilterTypeLabel(normalized.type, t)}: ${normalized.value}`;
}

function buildMessageFilterListText(settings, t) {
  const rules = getMessageFilterRules(settings);
  if (!rules.length) return t('filter.empty');

  const lines = rules.map((rule, index) => {
    const normalized = normalizeMessageFilterRule(rule);
    return `${index + 1}. <b>${esc(getMessageFilterTypeLabel(normalized.type, t))}</b>\n<code>${esc(normalized.id)}</code>\n${esc(normalized.value)}`;
  });
  return `${t('filter.title')}\n\n${lines.join('\n\n')}`;
}

function buildMessageBlockedText(rule, t) {
  if (!rule) return t('filter.blocked');
  return t('filter.blockedWithRule', { rule: getLocalizedMessageFilterRuleLabel(rule, t) });
}

function buildMessageFilterManageKb(t) {
  return [
    [{ text: `📝 ${t('filter.type.text')}`, callback_data: 'adm:mf:add:text' }],
    [{ text: `🔣 ${t('filter.type.regex')}`, callback_data: 'adm:mf:add:regex' }],
    [{ text: `➖ ${t('filter.removeAction')}`, callback_data: 'adm:mf:remove' }],
    [{ text: t('kb.refresh'), callback_data: 'adm:mf' }],
    [{ text: t('cb.back'), callback_data: 'adm:bk' }],
  ];
}

function buildMessageFilterManageText(settings, t) {
  return `${buildMessageFilterListText(settings, t)}\n\n${t('filter.help')}\n${t('filter.manageHint')}`;
}

function buildMessageFilterInputPrompt(action, type, t) {
  if (action === 'remove') return t('filter.promptRemove');
  if (type === 'regex') return t('filter.promptRegex');
  return t('filter.promptText');
}

function parseMessageFilterInput(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  const firstSpace = input.indexOf(' ');
  if (firstSpace < 0) return { type: 'text', value: input };

  const type = input.slice(0, firstSpace).trim().toLowerCase();
  const value = input.slice(firstSpace + 1).trim();
  if (!value) return null;

  if (type === 'text' || type === 'regex') {
    return { type, value };
  }

  return { type: 'text', value: input };
}

async function saveMessageFilterRules(db, rules) {
  await db.setSetting('MESSAGE_FILTER_RULES', serializeMessageFilterRules(rules));
}

async function addMessageFilterRule(db, settings, input) {
  const rules = getMessageFilterRules(settings);
  const nextRule = normalizeMessageFilterRule(input);
  const nextRules = [...rules, nextRule];
  await saveMessageFilterRules(db, nextRules);
  return nextRules;
}

async function removeMessageFilterRule(db, settings, token) {
  const rawToken = String(token || '').trim();
  const rules = getMessageFilterRules(settings);
  if (!rawToken || !rules.length) return { removed: null, rules };

  let index = -1;
  if (/^\d+$/.test(rawToken)) {
    const n = parseInt(rawToken, 10);
    if (n >= 1 && n <= rules.length) index = n - 1;
  } else {
    index = rules.findIndex((rule) => String(rule.id) === rawToken);
  }

  if (index < 0) return { removed: null, rules };

  const [removed] = rules.splice(index, 1);
  await saveMessageFilterRules(db, rules);
  return { removed, rules };
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

function isPrivateChatId(chatId) {
  const n = Number(chatId);
  return Number.isFinite(n) && n > 0;
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
      await new Promise(r => setTimeout(r, waitMs + Math.floor(Math.random() * 80)));
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

// ── 话题管理 ─────────────────────────────────────────────────────────────────
export async function getOrCreateThread(tg, db, user, groupId, kv, t) {
  // 使用近似原子锁避免重复创建话题
  const lockKey = `lock:thread:${user.id}`;
  const existing = await db.getUser(user.id);
  if (existing?.thread_id) return existing.thread_id;

  const locked = await kv.get(lockKey);
  if (locked) {
    // 短暂等待后重试
    await new Promise(r => setTimeout(r, 350));
    const u2 = await db.getUser(user.id);
    if (u2?.thread_id) return u2.thread_id;
  }

  await kv.put(lockKey, '1', { expirationTtl: 60 }); // Cloudflare KV 的最小 TTL 为 60 秒
  try {
    const baseTopicName = name(user) || t('thread.userTopic', { id: user.id });
    const topicName = `${baseTopicName} [${user.id}]`.slice(0, 128);
    const res = await tg.createTopic({ chatId: groupId, name: topicName });
    if (!res.ok) { console.error('createTopic failed:', res); return null; }
    const tid = res.result.message_thread_id;
    await db.setUserThread(user.id, tid);
    await sendCard(tg, db, user, groupId, tid, t);
    return tid;
  } finally {
    await kv.delete(lockKey).catch(() => {});
  }
}

async function sendCard(tg, db, user, groupId, tid, t) {
  const u    = await db.getUser(user.id);
  const kb   = fullUserKb(user.id, u, t);
  const text = buildCardText(user, u, t);

  const pinCardMessage = async (msgId) => {
    if (!msgId) return;
    await tg.pinChatMessage({ chatId: groupId, msgId, disableNotification: true }).catch((e) => {
      console.error('pin topic card failed:', e);
    });
  };

  try {
    const photos = await tg.getUserProfilePhotos({ userId: user.id, limit: 1 });
    if (photos.ok && photos.result.total_count > 0) {
      const fileId = photos.result.photos[0][0].file_id;
      const r = await tg.sendPhoto({ chatId: groupId, fileId, caption: text, threadId: tid, kb });
      if (r.ok) {
        await pinCardMessage(r.result?.message_id);
        return;
      }
    }
  } catch {}

  const r = await tg.sendMsg({ chatId: groupId, text, threadId: tid, kb });
  if (r?.ok) await pinCardMessage(r.result?.message_id);
}

function buildCardText(user, u, t) {
  return `👤 <b>${t('card.userInfo')}</b>\n\n` +
    `${t('card.name')}：${esc(name(user))}\n` +
    `${t('card.username')}：${user.username ? '@' + esc(user.username) : t('list.none')}\n` +
    `${t('card.id')}：<code>${user.id ?? user.user_id}</code>\n` +
    `${t('card.language')}：${user.language_code || t('list.none')}\n` +
    `${t('card.firstContact')}：${fmtUtc8(u?.created_at, t)}\n` +
    `${t('card.status')}：${u?.is_blocked ? t('status.blocked') : (u?.is_verified ? t('status.verified') : t('status.unverified'))}`;
}

async function sendToUserThreadOrAdminDm({ tg, db, settings, waitUntil, groupId, adminIds, userId, text, kb }) {
  const u = await db.getUser(userId);
  const tid = u?.thread_id;

  if (groupId && !isNaN(groupId) && tid) {
    const r = await tg.sendMsg({ chatId: groupId, threadId: tid, text, kb }).catch(() => null);
    if (r?.ok) return { sent: true, via: 'thread' };
  }

  let dmCount = 0;
  for (const aid of adminIds) {
    const r = await sendUserMsg({ tg, settings, waitUntil, chatId: aid, text, kb }).catch(() => null);
    if (r?.ok) dmCount++;
  }
  return { sent: dmCount > 0, via: dmCount > 0 ? 'admin_dm' : 'none' };
}

// ── 键盘布局 ─────────────────────────────────────────────────────────────────
function fullUserKb(uid, u, t) {
  return [
    [
      { text: u?.is_blocked ? t('kb.unblock') : t('kb.block'), callback_data: u?.is_blocked ? `ub:${uid}` : `bl:${uid}` },
      { text: u?.is_blocked ? t('kb.permBan') : t('kb.detail'), callback_data: u?.is_blocked ? `pb:${uid}` : `ui:${uid}` },
    ],
    [
      { text: t('kb.whitelist'), callback_data: `wl:${uid}` },
      { text: t('kb.msgHistory'), callback_data: `ml:${uid}:1` },
    ],
    [
      { text: t('kb.refresh'), callback_data: `rf:${uid}` },
    ],
  ];
}

function adminFeatureMenuKb(s, t) {
  const capLabelMap = {
    image_numeric: t('panel.cap.imageNumeric'),
    image_alphanumeric: t('panel.cap.imageAlnum'),
    turnstile: t('panel.cap.turnstile'),
    recaptcha: t('panel.cap.recaptcha'),
    recaptcha_v3: t('panel.cap.recaptchaV3'),
    hcaptcha: t('panel.cap.hcaptcha'),
    slider: t('panel.cap.slider'),
  };
  const capLabel = capLabelMap[s.CAPTCHA_TYPE] || t('panel.cap.math');
  const inlineKbDeleteSec = getInlineKbMsgDeleteSeconds(s);
  const filterCount = getMessageFilterRules(s).length;
  const on = (v) => v === 'true' ? '✅' : '⬜';
  return [
    [
      { text: `${on(s.VERIFICATION_ENABLED)} ${t('panel.verify')}`, callback_data: 'adm:tv' },
      { text: `${on(s.AUTO_UNBLOCK_ENABLED)} ${t('panel.appeal')}`, callback_data: 'adm:ta' },
    ],
    [
      { text: `${on(s.WHITELIST_ENABLED)} ${t('panel.whitelist')}`, callback_data: 'adm:tw' },
      { text: `${on(s.BOT_COMMAND_FILTER)} ${t('panel.cmdFilter')}`, callback_data: 'adm:tf' },
    ],
    [
      { text: `🧩 ${t('panel.captchaType')}: ${capLabel}`, callback_data: 'adm:ct' },
      { text: `⏱ ${t('panel.timeout')}: ${s.VERIFICATION_TIMEOUT || '300'}s`, callback_data: 'adm:to' },
    ],
    [
      { text: `🔢 ${t('panel.attempts')}: ${s.MAX_VERIFICATION_ATTEMPTS || '3'}`, callback_data: 'adm:ma' },
      { text: `${on(s.ADMIN_NOTIFY_ENABLED)} ${t('panel.adminNotify')}`, callback_data: 'adm:tn' },
    ],
    [
      { text: `🧹 ${t('panel.inlineKbDelete')}: ${inlineKbDeleteSec}s`, callback_data: 'adm:ik' },
      { text: `🛡 ${t('panel.messageFilter')}: ${filterCount}`, callback_data: 'adm:mf' },
    ],
    [
      { text: t('cb.back'), callback_data: 'adm:menu' },
      { text: t('admin.close'), callback_data: 'adm:close' },
    ],
  ];
}

function adminListMenuKb(t) {
  return [
    [
      { text: t('kb.stats'), callback_data: 'adm:st' },
      { text: t('kb.blacklist'), callback_data: 'adm:bk:1' },
    ],
    [
      { text: t('kb.userList'), callback_data: 'adm:ul:1' },
    ],
    [
      { text: t('cb.back'), callback_data: 'adm:menu' },
      { text: t('admin.close'), callback_data: 'adm:close' },
    ],
  ];
}

function adminMainMenuKb(t) {
  return [
    [
      { text: t('admin.menu.features'), callback_data: 'adm:cfg' },
      { text: t('admin.menu.lists'), callback_data: 'adm:list' },
    ],
    [
      { text: t('admin.menu.filters'), callback_data: 'adm:mf' },
    ],
    [
      { text: t('admin.close'), callback_data: 'adm:close' },
    ],
  ];
}

function buildAdminHomeText(stats, t) {
  return `${t('admin.panelCompact', stats)}\n\n${t('admin.menuHint')}`;
}

function buildUserHomeText(settings, t) {
  const welcomeText = settings?.WELCOME_MESSAGE || t('defaultWelcome');
  return `${welcomeText}\n\n${t('user.menuHint')}`;
}

function buildUserStatusText(u, t) {
  return t('user.status', {
    verified: u?.is_verified ? t('user.statusVerified') : t('user.statusUnverified'),
    blocked: u?.is_blocked ? t('user.statusBlocked') : t('user.statusNotBlocked'),
  });
}

function userMenuNavRow(t, backCallback = 'user:menu') {
  return [
    { text: t('cb.back'), callback_data: backCallback },
    { text: t('user.close'), callback_data: 'user:close' },
  ];
}

function userMainMenuKb(t) {
  return [
    [
      { text: t('user.contact'), callback_data: 'user:contact' },
      { text: t('user.statusBtn'), callback_data: 'user:status' },
    ],
    [
      { text: t('user.help'), callback_data: 'user:help' },
    ],
    [
      { text: t('user.close'), callback_data: 'user:close' },
    ],
  ];
}

// ── 命令注册 ──────────────────────────────────────────────────────────────────
export async function setupCommands(tg, locale = 'zh-hans') {
  const normalized = normalizeBotLocale(locale)
  const { userCmds, adminCmds } = getBotCommands(normalized)
  await tg.setMyCommands({ commands: userCmds })
  await tg.setMyCommands({ commands: adminCmds, scope: { type: 'all_private_chats' } })
  await tg.setChatMenuButton({ menuButton: { type: 'commands' } })
}

// ── 入口函数 ──────────────────────────────────────────────────────────────────
export async function processUpdate(update, env) {
  if (!env?.KV) { console.error('KV not bound'); return; }
  const db  = env._db;
  try {
    const settings = await db.getAllSettings();
    if (!settings.BOT_TOKEN)      { console.error('BOT_TOKEN missing'); return; }
    if (!settings.FORUM_GROUP_ID) { console.error('FORUM_GROUP_ID missing'); return; }
    const locale = normalizeBotLocale(settings.BOT_LOCALE);
    const t = createBotT(locale);
    const tg  = new TG(settings.BOT_TOKEN);
    const ctx = { tg, db, kv: env.KV, settings, baseUrl: env.baseUrl || '', t, waitUntil: env.waitUntil };
    if (update.message)              await handleMsg(update.message, ctx);
    else if (update.callback_query)  await handleCb(update.callback_query, ctx);
  } catch (e) { console.error('processUpdate:', e); }
}

// ── 消息处理器 ────────────────────────────────────────────────────────────────
async function handleMsg(msg, { tg, db, kv, settings, baseUrl, t, waitUntil }) {
  if (!msg) return;
  const user = msg.from;
  if (!user || user.is_bot) return;

  // ── Web App 数据 — 必须在所有其他处理之前 ────────────────────────────────
  if (msg.web_app_data) {
    await handleWebAppVerify(msg, user, { tg, db, kv, settings, t, waitUntil });
    return;
  }

  const groupId  = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);

  // ── 群组话题：管理员 → 用户消息转发 ─────────────────────────────────────
  if (msg.chat.id === groupId && msg.is_topic_message) {
    if (!adminIds.includes(user.id)) return; // only admins' replies get forwarded
    if (msg.text?.startsWith('/')) return;   // avoid accidental command forwarding
    const target = await db.getUserByThread(msg.message_thread_id);
    if (!target) return;

    const blockedRule = findBlockedRuleForMessage(settings, msg);
    if (blockedRule) {
      await tg.sendMsg({
        chatId: msg.chat.id,
        threadId: msg.message_thread_id,
        text: buildMessageBlockedText(blockedRule, t),
      }).catch(() => {});
      return;
    }

    const shouldForward = await shouldProcessMessageOnce(kv, 'admin-topic-forward', msg.chat.id, msg.message_id);
    if (!shouldForward) return;

    // 使用 copyMessage 转发所有内容类型，保留完整格式
    const forwardRes = await tg.copyMsg({ chatId: target.user_id, fromChatId: msg.chat.id, msgId: msg.message_id });
    if (!forwardRes?.ok) {
      console.error('admin topic forward failed:', forwardRes);
      return;
    }

    await reactSentOk({ tg, chatId: msg.chat.id, msgId: msg.message_id });

    const recordTask = db.addMsg({
      userId: target.user_id,
      direction: 'outgoing',
      content: msg.text || msg.caption || t('content.media'),
      messageType: msgType(msg),
      telegramMessageId: msg.message_id,
    }).catch((e) => console.error('record admin topic msg failed:', e));
    if (waitUntil) waitUntil(recordTask);
    else await recordTask;
    return;
  }

  if (msg.chat.type !== 'private') return;

  // 更新用户信息
  await db.upsertUser({
    user_id: user.id, username: user.username,
    first_name: user.first_name, last_name: user.last_name, language_code: user.language_code,
  });

  // ── 管理员私聊：控制面板或命令处理 ──────────────────────────────────────
  if (adminIds.includes(user.id)) {
    await handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId, t, waitUntil });
    return;
  }

  // ── 指令过滤 ─────────────────────────────────────────────────────────────
  if (msg.text?.startsWith('/')) {
    const [cmdFull] = msg.text.split(' ');
    const cmd = cmdFull.split('@')[0].slice(1).toLowerCase();

    if (cmd === 'start') {
      await sendUserMsg({
        tg,
        settings,
        waitUntil,
        chatId: user.id,
        text: buildUserHomeText(settings, t),
        kb: userMainMenuKb(t),
      });
      return;
    }
    if (cmd === 'help') {
      await sendUserMsg({
        tg,
        settings,
        waitUntil,
        chatId: user.id,
        text: t('user.helpText'),
        kb: [userMenuNavRow(t)],
      });
      return;
    }
    if (cmd === 'status') {
      const u = await db.getUser(user.id);
      await sendUserMsg({
        tg,
        settings,
        waitUntil,
        chatId: user.id,
        text: buildUserStatusText(u, t),
        kb: [userMenuNavRow(t)],
      });
      return;
    }
    if (settings.BOT_COMMAND_FILTER === 'true') return; // swallow unknown commands
  }

  // ── 封禁检查 ─────────────────────────────────────────────────────────────
  const dbUser = await db.getUser(user.id);
  if (dbUser?.is_blocked) {
    const isPermanentBlock = Boolean(dbUser.is_permanent_block);
    const canAppeal = canUserAppeal(dbUser, settings);
    const pendingAppeal = await kv.get(`pending_appeal:${user.id}`);

    if (!canAppeal && pendingAppeal) {
      await kv.delete(`pending_appeal:${user.id}`).catch(() => {});
    }

    if (canAppeal && pendingAppeal && msg.text && !msg.text.startsWith('/')) {
      const appealText = msg.text.trim();
      if (appealText) {
        const who = `${name(user)} (${user.id})`;
        const text = t('appeal.title', { who: esc(who), content: esc(appealText) });
        const kb = [[
          { text: t('appeal.approve'), callback_data: `apu:${user.id}` },
          { text: t('appeal.reject'), callback_data: `apr:${user.id}` },
        ]];

        const delivery = await sendToUserThreadOrAdminDm({
          tg,
          db,
          settings,
          waitUntil,
          groupId,
          adminIds,
          userId: user.id,
          text,
          kb,
        });
        await kv.delete(`pending_appeal:${user.id}`).catch(() => {});

        if (delivery.sent) {
          await tg.sendMsg({ chatId: user.id, text: t('appeal.submitted') });
        } else {
          await tg.sendMsg({ chatId: user.id, text: t('appeal.submitFail') });
        }
      }
      return;
    }

    if (isPermanentBlock) {
      await tg.sendMsg({ chatId: user.id, text: t('appeal.blockedPermanent') });
    } else if (canAppeal) {
      await sendUserMsg({
        tg,
        settings,
        waitUntil,
        chatId: user.id,
        text: t('appeal.blockedCan'),
        kb: [[{ text: t('appeal.start'), callback_data: 'appeal:start' }]],
      });
    } else {
      await tg.sendMsg({ chatId: user.id, text: t('appeal.blocked') });
    }
    return;
  }

  const blockedRule = findBlockedRuleForMessage(settings, msg);
  if (blockedRule) {
    await sendUserMsg({
      tg,
      settings,
      waitUntil,
      chatId: user.id,
      text: buildMessageBlockedText(blockedRule, t),
    });
    return;
  }

  // ── 白名单跳过 ───────────────────────────────────────────────────────────
  const whitelisted = settings.WHITELIST_ENABLED === 'true' && await db.isWhitelisted(user.id);

  if (!whitelisted) {
    const maxRate = parseInt(settings.MAX_MESSAGES_PER_MINUTE || '30', 10);
    if (rateCheck(user.id, maxRate)) {
      await tg.sendMsg({ chatId: user.id, text: t('rateLimit') });
      return;
    }

    // ── Verification ──────────────────────────────────────────────────────
    if (settings.VERIFICATION_ENABLED === 'true' && !dbUser?.is_verified) {
      const lock = await withUserLock(
        kv,
        `verify-flow:${user.id}`,
        async () => {
          const latestUser = await db.getUser(user.id);
          if (latestUser?.is_verified) return { done: true };

          const timeout = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10)); // CF KV minimum TTL is 60s
          const captchaType = settings.CAPTCHA_TYPE || 'math';
          const existing = await db.getVerify(user.id);

          if (existing && existing.expires_at > Date.now()) {
            await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: t('verify.completeFirst') });
            return { done: true };
          }

          await kv.put(`pending:${user.id}`, JSON.stringify({ msgId: msg.message_id, type: msgType(msg) }), { expirationTtl: timeout });

          if (captchaType === 'math') {
            const { question, answer, kb } = mkMathVerify();
            const r = await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
            const verifyMsgId = r?.result?.message_id;
            await db.setVerify(user.id, { answer, captcha_type: 'math', verify_msg_id: verifyMsgId }, timeout);
            scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
            return { done: true };
          }

          if (captchaType === 'turnstile' || captchaType === 'recaptcha' || captchaType === 'recaptcha_v3' || captchaType === 'hcaptcha' || captchaType === 'slider') {
            if (captchaType !== 'slider') {
              const secretKey = captchaType === 'turnstile' ? settings.TURNSTILE_SECRET_KEY
                : captchaType === 'recaptcha_v3' ? settings.RECAPTCHA_V3_SECRET_KEY
                : captchaType === 'hcaptcha' ? settings.HCAPTCHA_SECRET_KEY
                : settings.RECAPTCHA_SECRET_KEY;
              if (!secretKey) {
                const { question, answer, kb } = mkMathVerify();
                const r = await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
                const verifyMsgId = r?.result?.message_id;
                await db.setVerify(user.id, { answer, captcha_type: 'math', verify_msg_id: verifyMsgId }, timeout);
                scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
                return { done: true };
              }
            }
            const siteUrl = settings.CAPTCHA_SITE_URL || baseUrl;
            if (!siteUrl) {
              const { question, answer, kb } = mkMathVerify();
              const r = await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
              const verifyMsgId = r?.result?.message_id;
              await db.setVerify(user.id, { answer, captcha_type: 'math', verify_msg_id: verifyMsgId }, timeout);
              scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
              return { done: true };
            }
            const webVerifyId = randId();
            const r = await tg.sendMsg({ chatId: user.id, text: t('verify.webTitle'), kb: [[{ text: t('verify.webBtn'), web_app: { url: `${siteUrl}/api/verify/${webVerifyId}` } }]] });
            const verifyMsgId = r?.result?.message_id;
            await kv.put(`webverify:${webVerifyId}`, JSON.stringify({ userId: user.id, captchaType, verifyMsgId }), { expirationTtl: timeout + 60 });
            await db.setVerify(user.id, { captcha_type: captchaType, web_verify_id: webVerifyId, verify_msg_id: verifyMsgId }, timeout);
            scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
            return { done: true };
          }

          const siteUrl = settings.CAPTCHA_SITE_URL || baseUrl;
          if (!siteUrl) {
            const { question, answer, kb } = mkMathVerify();
            const r = await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
            const verifyMsgId = r?.result?.message_id;
            await db.setVerify(user.id, { answer, captcha_type: 'math', verify_msg_id: verifyMsgId }, timeout);
            scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
            return { done: true };
          }

          const captchaId  = randId();
          const code       = generateCode(captchaType);
          await kv.put(`captcha_render:${captchaId}`, code, { expirationTtl: timeout + 60 });
          const wrongs     = generateWrongOptions(code, captchaType, VERIFY_OPTION_COUNT - 1);
          const opts       = [code, ...wrongs].sort(() => Math.random() - 0.5);
          const kb         = rowsN(opts, VERIFY_OPTION_COLUMNS, o => ({ text: o, callback_data: `iv:${o}:${captchaId}` }));
          const typeLabel  = captchaType === 'image_alphanumeric' ? t('verify.imgAlpha') : t('verify.imgNum');
          const caption    = t('verify.image', { typeLabel });
          const imgUrl     = `${siteUrl}/api/captcha/${captchaId}`;
          const r          = await tg.sendPhoto({ chatId: user.id, url: imgUrl, caption, kb });
          if (!r.ok) {
            // sendPhoto 失败时回退到数学题验证码
            const { question, answer, kb: mathKb } = mkMathVerify();
            const r2 = await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb: mathKb });
            const fallbackMsgId = r2?.result?.message_id;
            await db.setVerify(user.id, { answer, captcha_type: 'math', verify_msg_id: fallbackMsgId }, timeout);
            scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId: fallbackMsgId });
            return { done: true };
          }
          const verifyMsgId = r?.result?.message_id;
          await db.setVerify(user.id, { answer: code, captcha_id: captchaId, captcha_type: captchaType, verify_msg_id: verifyMsgId }, timeout);
          scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId: user.id, timeout, verifyMsgId });
          return { done: true };
        },
        { ttlSeconds: 90, retries: 6, waitMs: 100 },
      );

      if (!lock.acquired) {
        await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: t('verify.completeFirst') });
      }
      return;
    }
  }

  if (!groupId || isNaN(groupId)) {
    await tg.sendMsg({ chatId: user.id, text: t('badConfig') });
    return;
  }

  const tid = await getOrCreateThread(tg, db, user, groupId, kv, t);
  if (!tid) { await tg.sendMsg({ chatId: user.id, text: t('sendFail') }); return; }

  const shouldForward = await shouldProcessMessageOnce(kv, 'user-to-admin-thread', msg.chat.id, msg.message_id);
  if (!shouldForward) return;

  // 使用 copyMessage 转发所有内容类型，保留完整格式
  const res = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: tid });
  if (res.ok) {
    const recordTask = db.addMsg({
      userId: user.id,
      direction: 'incoming',
      content: msg.text || msg.caption || t('content.media'),
      messageType: msgType(msg),
      telegramMessageId: msg.message_id,
    }).catch((e) => console.error('record user msg failed:', e));
    if (waitUntil) waitUntil(recordTask);
    else await recordTask;
    await reactSentOk({ tg, chatId: msg.chat.id, msgId: msg.message_id });
    await tg.sendMsg({ chatId: user.id, text: t('sentToAdmin') });
  } else {
    // 话题可能已被删除 — 清除过期 thread_id，重建话题后重试一次
    console.warn('copyMsg failed (thread may be deleted), retrying with new thread:', res);
    await db.clearUserThread(user.id);
    const newTid = await getOrCreateThread(tg, db, user, groupId, kv, t);
    if (newTid) {
      const retry = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: newTid });
      if (retry.ok) {
        const recordTask = db.addMsg({
          userId: user.id,
          direction: 'incoming',
          content: msg.text || msg.caption || t('content.media'),
          messageType: msgType(msg),
          telegramMessageId: msg.message_id,
        }).catch((e) => console.error('record retried user msg failed:', e));
        if (waitUntil) waitUntil(recordTask);
        else await recordTask;
        await reactSentOk({ tg, chatId: msg.chat.id, msgId: msg.message_id });
        await tg.sendMsg({ chatId: user.id, text: t('sentToAdmin') });
        return;
      }
    }
    console.error('copyMsg retry also failed:', res);
    await tg.sendMsg({ chatId: user.id, text: t('sendFail') });
  }
}


async function handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId, t, waitUntil }) {
  const protectedAdminIds = new Set(parseAdminIds(settings.ADMIN_IDS).map(Number));

  const sendPanel = async () => {
    const s = await db.getStats();
    const latest = await db.getAllSettings();
    await sendUserMsg({
      tg,
      settings: latest,
      waitUntil,
      chatId: user.id,
      text: buildAdminHomeText(s, t),
      kb: adminMainMenuKb(t),
    });
  };

  const pendingNumeric = await getAdminNumericInput(kv, user.id);
  if (pendingNumeric) {
    const cfg = getAdminNumericFieldConfig(pendingNumeric.field);
    if (!cfg) {
      await clearAdminNumericInput(kv, user.id);
    } else if (msg.text?.trim() === '/cancel') {
      await clearAdminNumericInput(kv, user.id);
      await tg.sendMsg({ chatId: user.id, text: t('admin.numericCanceled') });
      return;
    } else if (!msg.text) {
      await tg.sendMsg({ chatId: user.id, text: buildAdminNumericPromptText(t, cfg) });
      return;
    } else if (!msg.text.startsWith('/')) {
      const value = parseStrictInt(msg.text);
      if (value === null || value < cfg.min || value > cfg.max) {
        await tg.sendMsg({
          chatId: user.id,
          text: t('admin.numericInvalid', { label: t(cfg.labelKey), min: cfg.min, max: cfg.max, unit: cfg.unit || '' }),
        });
        return;
      }

      await db.setSetting(pendingNumeric.field, String(value));
      await clearAdminNumericInput(kv, user.id);

      const withUnit = cfg.unit ? `${value}${cfg.unit}` : String(value);
      await tg.sendMsg({
        chatId: user.id,
        text: t('admin.numericSaved', { label: t(cfg.labelKey), value: withUnit }),
      });
      await sendPanel();
      return;
    } else {
      await clearAdminNumericInput(kv, user.id);
    }
  }

  const pendingFilter = await getAdminFilterInput(kv, user.id);
  if (pendingFilter) {
    if (msg.text?.trim() === '/cancel') {
      await clearAdminFilterInput(kv, user.id);
      const latest = await db.getAllSettings();
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(latest, t), kb: buildMessageFilterManageKb(t) });
      return;
    }

    if (!msg.text || msg.text.startsWith('/')) {
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterInputPrompt(pendingFilter.action, pendingFilter.type, t) });
      return;
    }

    if (pendingFilter.action === 'remove') {
      const latest = await db.getAllSettings();
      const { removed } = await removeMessageFilterRule(db, latest, msg.text.trim());
      await clearAdminFilterInput(kv, user.id);

      if (!removed) {
        await tg.sendMsg({ chatId: user.id, text: t('filter.notFound') });
      } else {
        await tg.sendMsg({
          chatId: user.id,
          text: t('filter.removed', { rule: getLocalizedMessageFilterRuleLabel(removed, t) }),
        });
      }

      const refreshed = await db.getAllSettings();
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(refreshed, t), kb: buildMessageFilterManageKb(t) });
      return;
    }

    try {
      const latest = await db.getAllSettings();
      const nextRules = await addMessageFilterRule(db, latest, {
        type: pendingFilter.type || 'text',
        value: msg.text.trim(),
      });
      await clearAdminFilterInput(kv, user.id);
      const addedRule = nextRules[nextRules.length - 1];
      await tg.sendMsg({
        chatId: user.id,
        text: t('filter.added', { rule: getLocalizedMessageFilterRuleLabel(addedRule, t) }),
      });
      const refreshed = await db.getAllSettings();
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(refreshed, t), kb: buildMessageFilterManageKb(t) });
    } catch (e) {
      await tg.sendMsg({ chatId: user.id, text: t('filter.invalid', { error: e?.message || '' }) });
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterInputPrompt(pendingFilter.action, pendingFilter.type, t) });
    }
    return;
  }

  if (msg.text?.startsWith('/')) {
    const parts = msg.text.trim().split(/\s+/);
    const cmd   = parts[0].split('@')[0].slice(1).toLowerCase();
    const arg   = parts[1];

    if (cmd === 'panel') {
      await sendPanel();
      return;
    }
    if (cmd === 'start') {
      await sendPanel();
      return;
    }
    if (cmd === 'help') {
      await tg.sendMsg({
        chatId: user.id,
        text: t('admin.helpText'),
      });
      return;
    }
    if (cmd === 'stats') {
      const s = await db.getStats();
      await tg.sendMsg({
        chatId: user.id,
        text: t('admin.stats', s),
        kb: [[
          { text: t('cb.back'), callback_data: 'adm:list' },
          { text: t('admin.close'), callback_data: 'adm:close' },
        ]],
      });
      return;
    }
    if (cmd === 'ban' && arg) {
      const uid = parseInt(arg, 10);
      if (protectedAdminIds.has(uid)) {
        await tg.sendMsg({ chatId: user.id, text: t('admin.cannotBanAdmin') });
        return;
      }
      await db.blockUser(uid, t('admin.reason.commandBan'), user.id, true);
      await tg.sendMsg({ chatId: user.id, text: t('admin.banned', { uid: arg }) });
      return;
    }
    if (cmd === 'unban' && arg) {
      await db.unblockUser(parseInt(arg, 10));
      await tg.sendMsg({ chatId: user.id, text: t('admin.unbanned', { uid: arg }) });
      return;
    }
    if (cmd === 'wl' && arg) {
      await db.addToWhitelist(parseInt(arg, 10), t('admin.reason.commandWhitelist'), String(user.id));
      await tg.sendMsg({ chatId: user.id, text: t('admin.wlAdded', { uid: arg }) });
      return;
    }
    if (cmd === 'unwl' && arg) {
      await db.removeFromWhitelist(parseInt(arg, 10));
      await tg.sendMsg({ chatId: user.id, text: t('admin.wlRemoved', { uid: arg }) });
      return;
    }
    if (cmd === 'info' && arg) {
      const u = await db.getUser(parseInt(arg, 10));
      if (!u) { await tg.sendMsg({ chatId: user.id, text: t('admin.userNotFound') }); return; }
      await sendUserMsg({
        tg,
        settings,
        waitUntil,
        chatId: user.id,
        text: buildDetailText(u, false, t),
        kb: fullUserKb(u.user_id, u, t),
      });
      return;
    }
    if (cmd === 'filters') {
      const latest = await db.getAllSettings();
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(latest, t), kb: buildMessageFilterManageKb(t) });
      return;
    }
    if (cmd === 'addfilter') {
      const rawInput = msg.text.trim().slice(parts[0].length).trim();
      const parsed = parseMessageFilterInput(rawInput);
      if (!parsed) {
        await tg.sendMsg({ chatId: user.id, text: t('filter.addHelp') });
        return;
      }

      try {
        const latest = await db.getAllSettings();
        const nextRules = await addMessageFilterRule(db, latest, parsed);
        const addedRule = nextRules[nextRules.length - 1];
        await tg.sendMsg({
          chatId: user.id,
        text: t('filter.added', { rule: getLocalizedMessageFilterRuleLabel(addedRule, t) }),
        });
        const refreshed = await db.getAllSettings();
        await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(refreshed, t), kb: buildMessageFilterManageKb(t) });
      } catch (e) {
        await tg.sendMsg({ chatId: user.id, text: t('filter.invalid', { error: e?.message || '' }) });
      }
      return;
    }
    if (cmd === 'delfilter') {
      if (!arg) {
        await tg.sendMsg({ chatId: user.id, text: t('filter.delHelp') });
        return;
      }

      const latest = await db.getAllSettings();
      const { removed } = await removeMessageFilterRule(db, latest, arg);
      if (!removed) {
        await tg.sendMsg({ chatId: user.id, text: t('filter.notFound') });
        return;
      }

      await tg.sendMsg({
        chatId: user.id,
        text: t('filter.removed', { rule: getLocalizedMessageFilterRuleLabel(removed, t) }),
      });
      const refreshed = await db.getAllSettings();
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterManageText(refreshed, t), kb: buildMessageFilterManageKb(t) });
      return;
    }

    // 未知的斜杠指令不应转发到群组/话题。
    await tg.sendMsg({ chatId: user.id, text: t('admin.unknownCmd') });
    return;
  }

  const shouldForward = await shouldProcessMessageOnce(kv, 'admin-private-notify', msg.chat.id, msg.message_id);
  if (!shouldForward) return;

  const adminThreadId = await getOrCreateThread(tg, db, user, groupId, kv, t);
  if (!adminThreadId) {
    if (settings.ADMIN_NOTIFY_ENABLED === 'true') await sendPanel();
    return;
  }

  // 始终将管理员私聊消息转发到管理员专属话题。
  const fwdRes = await tg.copyMsg({
    chatId: groupId,
    fromChatId: msg.chat.id,
    msgId: msg.message_id,
    threadId: adminThreadId,
  });
  if (fwdRes.ok) {
    await tg.sendMsg({ chatId: user.id, text: t('admin.forwarded') });
  } else if (settings.ADMIN_NOTIFY_ENABLED === 'true') {
    // 开启后若转发失败，回退到控制面板。
    await sendPanel();
  }
}

// ── 回调处理器 ────────────────────────────────────────────────────────────────
async function handleCb(q, { tg, db, kv, settings, t, waitUntil }) {
  const { data, from: user, message } = q;
  const chatId  = message.chat.id;
  const msgId   = message.message_id;
  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);
  const isAdmin  = adminIds.includes(user.id);

  try {
    // ── User callbacks ────────────────────────────────────────────────────────
    if (data === 'user:msg' || data === 'user:contact') {
      await editUserText({
        tg,
        settings,
        waitUntil,
        chatId,
        msgId,
        text: t('user.contactText'),
        kb: [userMenuNavRow(t)],
      });
      await tg.answerCb({ id: q.id, text: t('cb.sendText') });
      return;
    }
    if (data === 'user:status') {
      const u = await db.getUser(user.id);
      await editUserText({
        tg,
        settings,
        waitUntil,
        chatId,
        msgId,
        text: buildUserStatusText(u, t),
        kb: [userMenuNavRow(t)],
      });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:help') {
      await editUserText({
        tg,
        settings,
        waitUntil,
        chatId,
        msgId,
        text: t('user.helpText'),
        kb: [userMenuNavRow(t)],
      });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:back' || data === 'user:menu') {
      const s = await db.getAllSettings();
      await editUserText({
        tg,
        settings: s,
        waitUntil,
        chatId,
        msgId,
        text: buildUserHomeText(s, t),
        kb: userMainMenuKb(t),
      });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:close') {
      await tg.deleteMsg({ chatId, msgId }).catch(() => {});
      await tg.answerCb({ id: q.id }).catch(() => {});
      return;
    }

    // ── Math verification ─────────────────────────────────────────────────────
    if (data.startsWith('v:')) {
      const sel = data.slice(2);
      await handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, null, t);
      return;
    }

    // ── Image verification ────────────────────────────────────────────────────
    if (data.startsWith('iv:')) {
      const match = data.match(/^iv:(.+):([a-f0-9]+)$/);
      if (!match) { await tg.answerCb({ id: q.id, text: t('verify.mismatch'), alert: true }); return; }
      const [, sel, captchaId] = match;
      await handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId, t);
      return;
    }

    // ── Appeal ────────────────────────────────────────────────────────────────
    if (data.startsWith('appeal:')) {
      const blockedUser = await db.getUser(user.id);
      const canAppeal = canUserAppeal(blockedUser, settings);

      if (!canAppeal) {
        await kv.delete(`pending_appeal:${user.id}`).catch(() => {});
        const denyText = blockedUser?.is_permanent_block
          ? t('appeal.notAvailablePermanent')
          : t('appeal.notAvailable');
        await tg.answerCb({ id: q.id, text: t('cb.appealNotAvailable'), alert: true }).catch(() => {});
        await tg.editText({ chatId, msgId, text: denyText, kb: [] }).catch(() => {});
        return;
      }

      const isStart = data === 'appeal:start';
      if (isStart) await kv.put(`pending_appeal:${user.id}`, '1', { expirationTtl: 900 });
      else await kv.delete(`pending_appeal:${user.id}`);
      await editUserText({
        tg,
        settings,
        waitUntil,
        chatId,
        msgId,
        text: isStart ? t('appeal.enter') : t('appeal.blocked'),
        kb: isStart ? [[{ text: t('appeal.cancel'), callback_data: 'appeal:cancel' }]] : [[{ text: t('appeal.short'), callback_data: 'appeal:start' }]],
      });
      await tg.answerCb({ id: q.id });
      return;
    }

    if (!isAdmin) { await tg.answerCb({ id: q.id, text: t('cb.noPermission'), alert: true }); return; }

    // ── Admin callbacks ───────────────────────────────────────────────────────
    if (data.startsWith('bl:')) {
      const uid = parseInt(data.slice(3), 10);
      if (isProtectedAdminUid(uid, settings)) {
        await tg.answerCb({ id: q.id, text: t('admin.cannotBanAdmin'), alert: true });
        return;
      }
      await db.blockUser(uid, t('admin.reason.actionBan'), user.id, false);
      await refreshCard(tg, db, chatId, msgId, uid, message, t);
      await tg.sendMsg({ chatId: uid, text: t('appeal.blocked') }).catch(() => {});
      await tg.answerCb({ id: q.id, text: t('cb.blocked') });
      return;
    }
    if (data.startsWith('pb:')) {
      const uid = parseInt(data.slice(3), 10);
      if (isProtectedAdminUid(uid, settings)) {
        await tg.answerCb({ id: q.id, text: t('admin.cannotBanAdmin'), alert: true });
        return;
      }
      await db.blockUser(uid, t('admin.reason.permanentBan'), user.id, true);
      await refreshCard(tg, db, chatId, msgId, uid, message, t);
      await tg.sendMsg({ chatId: uid, text: t('appeal.blockedPermanent') }).catch(() => {});
      await tg.answerCb({ id: q.id, text: t('cb.permBlocked') });
      return;
    }
    if (data.startsWith('ub:')) {
      const uid = parseInt(data.slice(3), 10);
      await db.unblockUser(uid);
      await refreshCard(tg, db, chatId, msgId, uid, message, t);
      await tg.sendMsg({ chatId: uid, text: t('unblockedNotice') }).catch(() => {});
      await tg.answerCb({ id: q.id, text: t('cb.unblocked') });
      return;
    }
    if (data.startsWith('wl:')) {
      const uid = parseInt(data.slice(3), 10);
      const isWl = await db.isWhitelisted(uid);
      if (isWl) {
        await db.removeFromWhitelist(uid);
        await tg.answerCb({ id: q.id, text: t('cb.wlRemoved') });
      } else {
        await db.addToWhitelist(uid, t('admin.reason.manualWhitelist'), String(user.id));
        await tg.answerCb({ id: q.id, text: t('cb.wlAdded') });
      }
      await refreshCard(tg, db, chatId, msgId, uid, message, t);
      return;
    }
    if (data.startsWith('ui:')) {
      const uid = parseInt(data.slice(3), 10);
      const u   = await db.getUser(uid);
      if (!u) { await tg.answerCb({ id: q.id, text: t('admin.userNotFound') }); return; }
      const isWl = await db.isWhitelisted(uid);
      await editCard(tg, chatId, msgId, message, buildDetailText(u, isWl, t), [...fullUserKb(uid, u, t), [{ text: t('collapse'), callback_data: `rf:${uid}` }]]);
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data.startsWith('rf:')) {
      const uid = parseInt(data.slice(3), 10);
      const u   = await db.getUser(uid);
      await refreshCard(tg, db, chatId, msgId, uid, message, t);
      await tg.answerCb({ id: q.id, text: t('cb.refreshed') });
      return;
    }
    if (data.startsWith('ml:')) {
      const [, uid, pg] = data.split(':');
      const page = parseInt(pg || '1', 10), ps = 8;
      const msgs = await db.getMsgs(parseInt(uid, 10), ps, (page - 1) * ps);
      if (!msgs.length) { await tg.answerCb({ id: q.id, text: t('cb.noRecord') }); return; }
      const lines = msgs.map(m => `[${fmtMsgTime(m.created_at)}] ${m.direction === 'incoming' ? '→' : '←'} ${esc((m.content || '').slice(0, 36))}`).join('\n');
      const hasMore = msgs.length === ps;
      const nav = [];
      if (page > 1)  nav.push({ text: `◀ ${page - 1}`, callback_data: `ml:${uid}:${page - 1}` });
      nav.push({ text: `📄 ${page}`, callback_data: 'adm:none' });
      if (hasMore)   nav.push({ text: `${page + 1} ▶`, callback_data: `ml:${uid}:${page + 1}` });
      await editCard(tg, chatId, msgId, message, `📨 <b>${t('msgHistoryTitle', { page })}</b>\n\n<code>${lines}</code>`, [nav, [{ text: t('cb.back'), callback_data: `ui:${uid}` }]]);
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data.startsWith('apu:')) {
      const uid = parseInt(data.slice(4), 10);
      await db.unblockUser(uid);
      await tg.sendMsg({ chatId: uid, text: t('appealApprovedNotice') }).catch(() => {});
      await tg.answerCb({ id: q.id, text: t('cb.appealApproved') });
      return;
    }
    if (data.startsWith('apr:')) {
      const uid = parseInt(data.slice(4), 10);
      await tg.sendMsg({ chatId: uid, text: t('appealRejectedNotice') }).catch(() => {});
      await tg.answerCb({ id: q.id, text: t('cb.appealRejected') });
      return;
    }

    // ── Admin panel callbacks ─────────────────────────────────────────────────
    if (data.startsWith('adm:')) await handleAdmCb(q, data.slice(4), { tg, db, kv, settings, chatId, msgId, adminId: user.id, t, waitUntil });
    else await tg.answerCb({ id: q.id });
  } catch (e) {
    console.error('handleCb:', e);
    await tg.answerCb({ id: q.id }).catch(() => {});
  }
}

async function handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId, t) {
  const locked = await withUserLock(
    kv,
    `verify-answer:${user.id}`,
    async () => {
      const v = await db.getVerify(user.id);
      if (!v || v.expires_at < Date.now()) {
        await db.delVerify(user.id);
        await kv.delete(`pending:${user.id}`).catch(() => {});
        await tg.answerCb({ id: q.id, text: t('verify.expired'), alert: true });
        return;
      }
      if (captchaId && v.captcha_id !== captchaId) {
        await tg.answerCb({ id: q.id, text: t('verify.mismatch'), alert: true });
        return;
      }

      // 从 settings 重新读取 groupId，防止调用方传入 NaN
      const effectiveGroupId = groupId || parseInt(settings.FORUM_GROUP_ID, 10) || 0;
      const maxAtt = parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10);
      if (sel === v.answer) {
        await db.setUserVerified(user.id, true);
        await db.delVerify(user.id);
        if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
        // deleteMsg → editText → editCaption 三级回退
        const delResult = await tg.deleteMsg({ chatId, msgId }).catch(() => null);
        if (!delResult?.ok) {
          const editResult = await tg.editText({ chatId, msgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
          if (!editResult?.ok) {
            // 图片消息无法用 editText 编辑 — 尝试 editCaption
            await tg.editCaption({ chatId, msgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
          }
        }
        await tg.sendMsg({ chatId, text: t('verify.success') }).catch(() => {});

        // 使用 user.id 保持 dedup key 一致性
        const pr = await kv.get(`pending:${user.id}`);
        if (pr && effectiveGroupId) {
          await kv.delete(`pending:${user.id}`);
          const p = JSON.parse(pr);
          const tid = await getOrCreateThread(tg, db, user, effectiveGroupId, kv, t);
          if (tid && p.msgId) {
            const shouldForward = await shouldProcessMessageOnce(kv, 'verified-user-forward', user.id, p.msgId);
            if (shouldForward) {
              await tg.copyMsg({ chatId: effectiveGroupId, fromChatId: chatId, msgId: p.msgId, threadId: tid });
              await db.addMsg({ userId: user.id, direction: 'incoming', content: t('content.verifiedForwarded') });
              await tg.sendMsg({ chatId: user.id, text: t('sentAfterVerify') });
            }
          }
        }
        await tg.answerCb({ id: q.id }).catch(() => {});
      } else {
        await db.incVerify(user.id);
        const att = v.attempts + 1;
        if (att >= maxAtt) {
          await db.delVerify(user.id);
          await kv.delete(`pending:${user.id}`).catch(() => {}); // 尝试次数用尽，清理待处理记录
          if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
          await tg.editText({ chatId, msgId, text: t('verify.tooMany'), kb: [] }).catch(() => {});
          await tg.answerCb({ id: q.id }).catch(() => {});
        } else {
          await tg.answerCb({ id: q.id, text: t('verify.wrongLeft', { left: maxAtt - att }), alert: true });
        }
      }
    },
    { ttlSeconds: 60, retries: 4, waitMs: 80 },
  );

  if (!locked.acquired) {
    await tg.answerCb({ id: q.id, text: t('verify.completeFirst') }).catch(() => {});
  }
}

// ── Web App 验证回调（Turnstile / reCAPTCHA）───────────────────────────────
async function handleWebAppVerify(msg, user, { tg, db, kv, settings, t, waitUntil }) {
  const data = msg.web_app_data?.data;
  if (!data) { console.error('[web_app_verify] no data'); return; }

  let payload;
  try { payload = JSON.parse(data); } catch { console.error('[web_app_verify] invalid JSON'); return; }
  if (payload.type !== 'web_verify_ok') { console.error('[web_app_verify] unknown type:', payload.type); return; }

  console.log('[web_app_verify] processing user', user.id);

  // 幂等守卫 — 已验证且无待处理记录则跳过
  const dbUser = await db.getUser(user.id).catch(() => null);
  const v = await db.getVerify(user.id).catch(() => null);
  if (!v && dbUser?.is_verified) {
    console.log('[web_app_verify] already processed, skipping');
    return;
  }

  // 过期检查
  if (!v || v.expires_at < Date.now()) {
    console.warn('[web_app_verify] verification expired for user', user.id);
    await db.delVerify(user.id).catch(() => {});
    await tg.sendMsg({ chatId: user.id, text: t('verify.expired') }).catch(() => {});
    return;
  }

  let verifyMsgId = v.verify_msg_id;

  // 从 webverify KV 读取 verifyMsgId
  const webVerifyId = v?.web_verify_id;
  if (webVerifyId) {
    const wvRaw = await kv.get(`webverify:${webVerifyId}`).catch(() => null);
    if (wvRaw) {
      try {
        const wv = JSON.parse(wvRaw);
        if (wv.verifyMsgId) verifyMsgId = wv.verifyMsgId;
      } catch {}
    }
    await kv.delete(`webverify:${webVerifyId}`).catch(() => {});
  }

  console.log('[web_app_verify] verifyMsgId:', verifyMsgId);

  // 标记已验证
  if (!dbUser?.is_verified) {
    await db.setUserVerified(user.id, true);
  }

  // 清理验证和待处理记录
  await db.delVerify(user.id).catch(() => {});
  const pendingRaw = await kv.get(`pending:${user.id}`).catch(() => null);
  await kv.delete(`pending:${user.id}`).catch(() => {});

  // 删除验证消息
  if (verifyMsgId) {
    const delResult = await tg.deleteMsg({ chatId: user.id, msgId: verifyMsgId }).catch(() => null);
    if (!delResult?.ok) {
      const editResult = await tg.editText({ chatId: user.id, msgId: verifyMsgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
      if (!editResult?.ok) {
        await tg.editCaption({ chatId: user.id, msgId: verifyMsgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
      }
    }
  }

  // 删除 web_app_data 系统消息
  await tg.deleteMsg({ chatId: user.id, msgId: msg.message_id }).catch(() => {});

  // 发送成功通知
  await tg.sendMsg({ chatId: user.id, text: t('verify.success') }).catch(() => {});

  // 转发待处理消息
  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  if (pendingRaw && groupId) {
    try {
      const p = JSON.parse(pendingRaw);
      const tid = await getOrCreateThread(tg, db, user, groupId, kv, t);
      if (tid && p.msgId) {
        const shouldForward = await shouldProcessMessageOnce(kv, 'verified-user-forward', user.id, p.msgId);
        if (shouldForward) {
          await tg.copyMsg({ chatId: groupId, fromChatId: user.id, msgId: p.msgId, threadId: tid });
          await db.addMsg({ userId: user.id, direction: 'incoming', content: t('content.verifiedForwarded') });
          await tg.sendMsg({ chatId: user.id, text: t('sentAfterVerify') });
        }
      }
    } catch (e) {
      console.error('[web_app_verify] forward pending failed:', e);
    }
  }

  console.log('[web_app_verify] done for user', user.id);
}

async function handleAdmCb(q, action, { tg, db, kv, settings, chatId, msgId, adminId, t, waitUntil }) {
  const openAdminHome = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({
      tg,
      settings: latest,
      waitUntil,
      chatId,
      msgId,
      text: buildAdminHomeText(stats, t),
      kb: adminMainMenuKb(t),
    });
  };

  const openFeatureMenu = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({
      tg,
      settings: latest,
      waitUntil,
      chatId,
      msgId,
      text: `${t('admin.panel', stats)}\n\n${t('admin.featureHint')}`,
      kb: adminFeatureMenuKb(latest, t),
    });
  };

  const openListMenu = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({
      tg,
      settings: latest,
      waitUntil,
      chatId,
      msgId,
      text: `${t('admin.panelCompact', stats)}\n\n${t('admin.listHint')}`,
      kb: adminListMenuKb(t),
    });
  };

  const toggle = async (key, label) => {
    const cur = settings[key] === 'true';
    await db.setSetting(key, cur ? 'false' : 'true');
    await openFeatureMenu();
    await tg.answerCb({ id: q.id, text: t('toggleResult', { label, state: cur ? t('panel.off') : t('panel.on') }) });
  };

  if (action === 'menu' || action === 'bk') {
    await openAdminHome();
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  if (action === 'close') {
    await tg.deleteMsg({ chatId, msgId }).catch(() => {});
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  // 页码指示按钮 — 无操作
  if (action === 'none') {
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  if (action === 'cfg') {
    await openFeatureMenu();
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  if (action === 'list') {
    await openListMenu();
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  if (action === 'tv') return toggle('VERIFICATION_ENABLED', t('panel.verify'));
  if (action === 'ta') return toggle('AUTO_UNBLOCK_ENABLED', t('panel.appeal'));
  if (action === 'tw') return toggle('WHITELIST_ENABLED', t('panel.whitelist'));
  if (action === 'tf') return toggle('BOT_COMMAND_FILTER', t('panel.cmdFilter'));
  if (action === 'tn') return toggle('ADMIN_NOTIFY_ENABLED', t('panel.adminNotify'));

  if (action === 'ct') {
    const all = ['math', 'image_numeric', 'image_alphanumeric', 'turnstile', 'recaptcha', 'recaptcha_v3', 'hcaptcha', 'slider'];
    const cur = all.indexOf(settings.CAPTCHA_TYPE || 'math');
    const next = all[(cur + 1) % all.length];
    await db.setSetting('CAPTCHA_TYPE', next);
    await openFeatureMenu();
    await tg.answerCb({ id: q.id, text: t('captchaTypeSwitched') });
    return;
  }

  if (action === 'mf') {
    if (kv && adminId) await clearAdminFilterInput(kv, adminId);
    const latest = await db.getAllSettings();
    await editUserText({
      tg,
      settings: latest,
      waitUntil,
      chatId,
      msgId,
      text: buildMessageFilterManageText(latest, t),
      kb: buildMessageFilterManageKb(t),
    });
    await tg.answerCb({ id: q.id });
    return;
  }

  if (action.startsWith('mf:add:')) {
    const type = action.split(':')[2] || 'text';
    if (kv && adminId) {
      await clearAdminNumericInput(kv, adminId);
      await setAdminFilterInput(kv, adminId, { action: 'add', type });
    }
    await tg.answerCb({ id: q.id, text: getMessageFilterTypeLabel(type, t) });
    await tg.sendMsg({ chatId, text: buildMessageFilterInputPrompt('add', type, t) });
    return;
  }

  if (action === 'mf:remove') {
    if (kv && adminId) {
      await clearAdminNumericInput(kv, adminId);
      await setAdminFilterInput(kv, adminId, { action: 'remove' });
    }
    await tg.answerCb({ id: q.id });
    await tg.sendMsg({ chatId, text: buildMessageFilterInputPrompt('remove', '', t) });
    return;
  }

  if (action === 'to' || action === 'ma' || action === 'ik') {
    const field = action === 'to'
      ? 'VERIFICATION_TIMEOUT'
      : (action === 'ma'
        ? 'MAX_VERIFICATION_ATTEMPTS'
        : 'INLINE_KB_MSG_DELETE_SECONDS');
    const cfg = getAdminNumericFieldConfig(field);

    if (!kv || !adminId || !cfg) {
      await tg.answerCb({ id: q.id });
      return;
    }

    await setAdminNumericInput(kv, adminId, field);
    await tg.answerCb({ id: q.id, text: t('admin.awaitNumericInput') });
    await tg.sendMsg({ chatId, text: buildAdminNumericPromptText(t, cfg) });
    return;
  }

  if (kv && adminId) {
    await clearAdminNumericInput(kv, adminId);
  }

  if (action === 'st') {
    const s = await db.getStats();
    await editUserText({
      tg,
      settings,
      waitUntil,
      chatId,
      msgId,
      text: t('admin.stats', s),
      kb: [[
        { text: t('cb.back'), callback_data: 'adm:list' },
        { text: t('admin.close'), callback_data: 'adm:close' },
      ]],
    });
  } else if (action.startsWith('bk:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getBlockedUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} — ${esc(u.block_reason || t('list.none'))}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1)  nav.push({ text: `◀ ${page - 1}`, callback_data: `adm:bk:${page - 1}` });
    nav.push({ text: `📄 ${page}/${tp}`, callback_data: 'adm:none' });
    if (page < tp) nav.push({ text: `${page + 1} ▶`, callback_data: `adm:bk:${page + 1}` });
    await editUserText({
      tg,
      settings,
      waitUntil,
      chatId,
      msgId,
      text: `🚫 <b>${t('blacklistTitle', { total, page, tp })}</b>\n\n${lines}`,
      kb: [
        nav,
        [
          { text: t('cb.back'), callback_data: 'adm:list' },
          { text: t('admin.close'), callback_data: 'adm:close' },
        ],
      ],
    });
  } else if (action.startsWith('ul:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getAllUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} ${u.is_blocked ? '⛔' : '✅'}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1)  nav.push({ text: `◀ ${page - 1}`, callback_data: `adm:ul:${page - 1}` });
    nav.push({ text: `📄 ${page}/${tp}`, callback_data: 'adm:none' });
    if (page < tp) nav.push({ text: `${page + 1} ▶`, callback_data: `adm:ul:${page + 1}` });
    await editUserText({
      tg,
      settings,
      waitUntil,
      chatId,
      msgId,
      text: `👥 <b>${t('userListTitle', { total, page, tp })}</b>\n\n${lines}`,
      kb: [
        nav,
        [
          { text: t('cb.back'), callback_data: 'adm:list' },
          { text: t('admin.close'), callback_data: 'adm:close' },
        ],
      ],
    });
  }
  await tg.answerCb({ id: q.id }).catch(() => {});
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────
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
    !Boolean(blockedUser?.is_permanent_block) &&
    settings?.AUTO_UNBLOCK_ENABLED === 'true';
}

function buildDetailText(u, isWl = false, t) {
  return `👤 <b>${t('detail.title')}</b>\n\n` +
    `${t('detail.idLabel')}: <code>${u.user_id}</code>\n` +
    `${t('card.name')}: ${esc(name(u))}\n` +
    `${t('card.username')}: ${u.username ? '@' + esc(u.username) : t('list.none')}\n` +
    `${t('card.language')}: ${u.language_code || t('list.none')}\n` +
    `${t('card.status')}: ${u.is_blocked ? (u.is_permanent_block ? '♾️' : '⛔') : '✅'}\n` +
    (u.is_blocked ? `${t('detail.reason')}: ${esc(u.block_reason || t('list.none'))}\n` : '') +
    `${t('detail.whitelist')}: ${isWl ? '⚪ ' + t('panel.on') : t('panel.off')}\n` +
    `${t('detail.verification')}: ${u.is_verified ? t('status.verified') : t('status.unverified')}\n` +
    `${t('detail.firstContact')}: ${fmtUtc8(u.created_at, t)}`;
}

/** Edit existing card — handles both text and photo (caption) messages. */
async function editCard(tg, chatId, msgId, message, text, kb) {
  if (message.photo || message.video) {
    await tg.editCaption({ chatId, msgId, caption: text, kb }).catch(() =>
      tg.editText({ chatId, msgId, text, kb })
    );
  } else {
    await tg.editText({ chatId, msgId, text, kb });
  }
}

async function refreshCard(tg, db, chatId, msgId, uid, message, t) {
  const u  = await db.getUser(uid);
  const kb = fullUserKb(uid, u, t);
  if (message.photo || message.video) {
    await tg.editCaption({ chatId, msgId, caption: buildCardText(u, u, t), kb }).catch(() =>
      tg.editKb({ chatId, msgId, kb })
    );
  } else {
    await tg.editText({ chatId, msgId, text: buildCardText(u, u, t), kb }).catch(() =>
      tg.editKb({ chatId, msgId, kb })
    );
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
