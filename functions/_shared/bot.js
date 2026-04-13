// functions/_shared/bot.js
import { TG, esc, name, msgType } from './tg.js';
import { generateCode, generateWrongOptions } from './captcha.js';
import { createBotT, getBotCommands, normalizeBotLocale } from './bot-i18n.js';

// ── Verification helpers ──────────────────────────────────────────────────────
const MATH_QS = [
  {q:'1 + 1',a:'2'},{q:'3 × 3',a:'9'},{q:'10 - 4',a:'6'},{q:'2 + 5',a:'7'},
  {q:'4 × 2',a:'8'},{q:'15 ÷ 3',a:'5'},{q:'6 + 7',a:'13'},{q:'9 - 3',a:'6'},
  {q:'8 + 4',a:'12'},{q:'7 × 2',a:'14'},{q:'18 ÷ 2',a:'9'},{q:'11 - 5',a:'6'},
];

function rows2(items, mk) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2).map(mk));
  return rows;
}

function mkMathVerify() {
  const {q, a} = MATH_QS[Math.floor(Math.random() * MATH_QS.length)];
  const cor = parseInt(a, 10);
  const opts = new Set([cor]);
  while (opts.size < 4) { const c = cor + Math.floor(Math.random() * 9) - 4; if (c > 0 && c !== cor) opts.add(c); }
  const arr = [...opts].sort(() => Math.random() - 0.5).map(String);
  return { question: `<b>${q} = ?</b>`, answer: a, kb: rows2(arr, n => ({ text: n, callback_data: `v:${n}` })) };
}

function randId() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Rate limit ────────────────────────────────────────────────────────────────
const rateMap = new Map();
function rateCheck(uid, max) {
  const now = Date.now();
  const ts  = (rateMap.get(uid) || []).filter(t => now - t < 60000);
  ts.push(now); rateMap.set(uid, ts);
  return ts.length > max;
}

// ── Thread management ─────────────────────────────────────────────────────────
async function getOrCreateThread(tg, db, user, groupId, kv, t) {
  // Atomic-ish lock to prevent duplicate topics
  const lockKey = `lock:thread:${user.id}`;
  const existing = await db.getUser(user.id);
  if (existing?.thread_id) return existing.thread_id;

  const locked = await kv.get(lockKey);
  if (locked) {
    // Wait briefly then retry
    await new Promise(r => setTimeout(r, 1500));
    const u2 = await db.getUser(user.id);
    if (u2?.thread_id) return u2.thread_id;
  }

  await kv.put(lockKey, '1', { expirationTtl: 60 }); // CF KV minimum TTL is 60s
  try {
    const topicName = (name(user) || `User ${user.id}`).slice(0, 128);
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

  try {
    const photos = await tg.getUserProfilePhotos({ userId: user.id, limit: 1 });
    if (photos.ok && photos.result.total_count > 0) {
      const fileId = photos.result.photos[0][0].file_id;
      const r = await tg.sendPhoto({ chatId: groupId, fileId, caption: text, threadId: tid, kb });
      if (r.ok) return;
    }
  } catch { /* no photo */ }

  await tg.sendMsg({ chatId: groupId, text, threadId: tid, kb });
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

async function sendToUserThreadOrAdminDm({ tg, db, groupId, adminIds, userId, text, kb }) {
  const u = await db.getUser(userId);
  const tid = u?.thread_id;

  if (groupId && !isNaN(groupId) && tid) {
    const r = await tg.sendMsg({ chatId: groupId, threadId: tid, text, kb }).catch(() => null);
    if (r?.ok) return { sent: true, via: 'thread' };
  }

  let dmCount = 0;
  for (const aid of adminIds) {
    const r = await tg.sendMsg({ chatId: aid, text, kb }).catch(() => null);
    if (r?.ok) dmCount++;
  }
  return { sent: dmCount > 0, via: dmCount > 0 ? 'admin_dm' : 'none' };
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
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

function adminPanelKb(s, t) {
  const capLabel = s.CAPTCHA_TYPE === 'image_numeric'
    ? t('panel.cap.imageNumeric')
    : (s.CAPTCHA_TYPE === 'image_alphanumeric' ? t('panel.cap.imageAlnum') : t('panel.cap.math'));
  return [
    [
      { text: `✅ ${t('panel.verify')}: ${s.VERIFICATION_ENABLED === 'true' ? t('panel.on') : t('panel.off')}`, callback_data: 'adm:tv' },
      { text: `🔓 ${t('panel.appeal')}: ${s.AUTO_UNBLOCK_ENABLED === 'true' ? t('panel.on') : t('panel.off')}`, callback_data: 'adm:ta' },
    ],
    [
      { text: `⚪ ${t('panel.whitelist')}: ${s.WHITELIST_ENABLED === 'true' ? t('panel.on') : t('panel.off')}`, callback_data: 'adm:tw' },
      { text: `🤖 ${t('panel.cmdFilter')}: ${s.BOT_COMMAND_FILTER === 'true' ? t('panel.on') : t('panel.off')}`, callback_data: 'adm:tf' },
    ],
    [
      { text: `🧩 ${t('panel.captchaType')}: ${capLabel}`, callback_data: 'adm:ct' },
      { text: `⏱ ${t('panel.timeout')}: ${s.VERIFICATION_TIMEOUT || '300'}s`, callback_data: 'adm:to' },
    ],
    [
      { text: `🔁 ${t('panel.attempts')}: ${s.MAX_VERIFICATION_ATTEMPTS || '3'}`, callback_data: 'adm:ma' },
      { text: `📩 ${t('panel.adminNotify')}: ${s.ADMIN_NOTIFY_ENABLED === 'true' ? t('panel.on') : t('panel.off')}`, callback_data: 'adm:tn' },
    ],
    [
      { text: t('kb.stats'), callback_data: 'adm:st' },
      { text: t('kb.blacklist'), callback_data: 'adm:bk:1' },
    ],
    [{ text: t('kb.userList'), callback_data: 'adm:ul:1' }],
  ];
}

// ── Commands setup ────────────────────────────────────────────────────────────
export async function setupCommands(tg, locale = 'zh-hans') {
  const normalized = normalizeBotLocale(locale)
  const { userCmds, adminCmds } = getBotCommands(normalized)
  await tg.setMyCommands({ commands: userCmds })
  await tg.setMyCommands({ commands: adminCmds, scope: { type: 'all_private_chats' } })
  await tg.setChatMenuButton({ menuButton: { type: 'commands' } })
}

// ── Entry point ───────────────────────────────────────────────────────────────
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
    const ctx = { tg, db, kv: env.KV, settings, baseUrl: env.baseUrl || '', t };
    if (update.message)              await handleMsg(update.message, ctx);
    else if (update.callback_query)  await handleCb(update.callback_query, ctx);
  } catch (e) { console.error('processUpdate:', e); }
}

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMsg(msg, { tg, db, kv, settings, baseUrl, t }) {
  if (!msg) return;
  const user = msg.from;
  if (!user || user.is_bot) return;

  const groupId  = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);

  // ── Group topic: admin → user forwarding ──────────────────────────────────
  if (msg.chat.id === groupId && msg.is_topic_message) {
    if (!adminIds.includes(user.id)) return; // only admins' replies get forwarded
    if (msg.text?.startsWith('/')) return;   // avoid accidental command forwarding
    const target = await db.getUserByThread(msg.message_thread_id);
    if (!target) return;
    // Use copyMessage to preserve ALL formatting (code, monospace, quotes, media)
    await tg.copyMsg({ chatId: target.user_id, fromChatId: msg.chat.id, msgId: msg.message_id });
    await db.addMsg({ userId: target.user_id, direction: 'outgoing', content: msg.text || msg.caption || '[媒体]', messageType: msgType(msg) });
    return;
  }

  if (msg.chat.type !== 'private') return;

  // Upsert user info
  await db.upsertUser({
    user_id: user.id, username: user.username,
    first_name: user.first_name, last_name: user.last_name, language_code: user.language_code,
  });

  // ── Admin private chat: control panel or command processing ───────────────
  if (adminIds.includes(user.id)) {
    await handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId, t });
    return;
  }

  // ── Command filter ────────────────────────────────────────────────────────
  if (msg.text?.startsWith('/')) {
    const [cmdFull] = msg.text.split(' ');
    const cmd = cmdFull.split('@')[0].slice(1).toLowerCase();

    if (cmd === 'start' || cmd === 'help') {
      const welcomeText = settings.WELCOME_MESSAGE || t('defaultWelcome');
      const kb = [[
        { text: t('user.sendMsg'), callback_data: 'user:msg' },
        { text: t('user.help'), callback_data: 'user:help' },
      ]];
      await tg.sendMsg({ chatId: user.id, text: welcomeText, kb });
      return;
    }
    if (cmd === 'status') {
      const u = await db.getUser(user.id);
      await tg.sendMsg({
        chatId: user.id,
        text: t('user.status', {
          verified: u?.is_verified ? t('user.statusVerified') : t('user.statusUnverified'),
          blocked: u?.is_blocked ? t('user.statusBlocked') : t('user.statusNotBlocked'),
        }),
      });
      return;
    }
    if (settings.BOT_COMMAND_FILTER === 'true') return; // swallow unknown commands
  }

  // ── Block check ───────────────────────────────────────────────────────────
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

        const delivery = await sendToUserThreadOrAdminDm({ tg, db, groupId, adminIds, userId: user.id, text, kb });
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
      await tg.sendMsg({ chatId: user.id, text: t('appeal.blockedCan'), kb: [[{ text: t('appeal.start'), callback_data: 'appeal:start' }]] });
    } else {
      await tg.sendMsg({ chatId: user.id, text: t('appeal.blocked') });
    }
    return;
  }

  // ── Whitelist bypass ──────────────────────────────────────────────────────
  const whitelisted = settings.WHITELIST_ENABLED === 'true' && await db.isWhitelisted(user.id);

  if (!whitelisted) {
    const maxRate = parseInt(settings.MAX_MESSAGES_PER_MINUTE || '30', 10);
    if (rateCheck(user.id, maxRate)) {
      await tg.sendMsg({ chatId: user.id, text: t('rateLimit') });
      return;
    }

    // ── Verification ──────────────────────────────────────────────────────
    if (settings.VERIFICATION_ENABLED === 'true' && !dbUser?.is_verified) {
      const timeout     = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10)); // CF KV minimum TTL is 60s
      const captchaType = settings.CAPTCHA_TYPE || 'math';
      const existing    = await db.getVerify(user.id);
      if (existing && existing.expires_at > Date.now()) {
        await tg.sendMsg({ chatId: user.id, text: t('verify.completeFirst') });
        return;
      }

      await kv.put(`pending:${user.id}`, JSON.stringify({ msgId: msg.message_id, type: msgType(msg) }), { expirationTtl: timeout });

      if (captchaType === 'math') {
        const { question, answer, kb } = mkMathVerify();
        await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
        await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
      } else {
        const siteUrl = settings.CAPTCHA_SITE_URL || baseUrl;
        if (!siteUrl) {
          // Fallback to math
          const { question, answer, kb } = mkMathVerify();
          await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
          await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb });
        } else {
          const captchaId  = randId();
          const code       = generateCode(captchaType);
          await kv.put(`captcha_render:${captchaId}`, code, { expirationTtl: timeout + 60 });
          const wrongs     = generateWrongOptions(code, captchaType);
          const opts       = [code, ...wrongs].sort(() => Math.random() - 0.5);
          const kb         = rows2(opts, o => ({ text: o, callback_data: `iv:${o}:${captchaId}` }));
          await db.setVerify(user.id, { answer: code, captcha_id: captchaId, captcha_type: captchaType }, timeout);
          const typeLabel  = captchaType === 'image_alphanumeric' ? t('verify.imgAlpha') : t('verify.imgNum');
          const caption    = t('verify.image', { typeLabel });
          const imgUrl     = `${siteUrl}/api/captcha/${captchaId}`;
          const r          = await tg.sendPhoto({ chatId: user.id, url: imgUrl, caption, kb });
          if (!r.ok) {
            const { question, answer, kb: mathKb } = mkMathVerify();
            await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
            await tg.sendMsg({ chatId: user.id, text: t('verify.title', { question }), kb: mathKb });
          }
        }
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

  // Use copyMessage to forward ALL content types with full formatting preserved
  const res = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: tid });
  if (res.ok) {
    await db.addMsg({ userId: user.id, direction: 'incoming', content: msg.text || msg.caption || '[媒体]', messageType: msgType(msg), telegramMessageId: msg.message_id });
    await tg.sendMsg({ chatId: user.id, text: t('sentToAdmin') });
  } else {
    // Topic may have been deleted — clear stale thread, recreate, and retry once
    console.warn('copyMsg failed (thread may be deleted), retrying with new thread:', res);
    await db.clearUserThread(user.id);
    const newTid = await getOrCreateThread(tg, db, user, groupId, kv, t);
    if (newTid) {
      const retry = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: newTid });
      if (retry.ok) {
        await db.addMsg({ userId: user.id, direction: 'incoming', content: msg.text || msg.caption || '[媒体]', messageType: msgType(msg), telegramMessageId: msg.message_id });
        await tg.sendMsg({ chatId: user.id, text: t('sentToAdmin') });
        return;
      }
    }
    console.error('copyMsg retry also failed:', res);
    await tg.sendMsg({ chatId: user.id, text: t('sendFail') });
  }
}

async function handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId, t }) {
  const protectedAdminIds = new Set(parseAdminIds(settings.ADMIN_IDS).map(Number));

  const sendPanel = async () => {
    const s = await db.getStats();
    await tg.sendMsg({
      chatId: user.id,
      text: t('admin.panel', s),
      kb: adminPanelKb(settings, t),
    });
  };

  if (msg.text?.startsWith('/')) {
    const parts = msg.text.trim().split(/\s+/);
    const cmd   = parts[0].split('@')[0].slice(1).toLowerCase();
    const arg   = parts[1];

    if (cmd === 'panel') {
      await sendPanel();
      return;
    }
    if (cmd === 'stats') {
      const s = await db.getStats();
      await tg.sendMsg({ chatId: user.id, text: t('admin.stats', s) });
      return;
    }
    if (cmd === 'ban' && arg) {
      const uid = parseInt(arg, 10);
      if (protectedAdminIds.has(uid)) {
        await tg.sendMsg({ chatId: user.id, text: t('admin.cannotBanAdmin') });
        return;
      }
      await db.blockUser(uid, '管理员指令封禁', user.id, true);
      await tg.sendMsg({ chatId: user.id, text: t('admin.banned', { uid: arg }) });
      return;
    }
    if (cmd === 'unban' && arg) {
      await db.unblockUser(parseInt(arg, 10));
      await tg.sendMsg({ chatId: user.id, text: t('admin.unbanned', { uid: arg }) });
      return;
    }
    if (cmd === 'wl' && arg) {
      await db.addToWhitelist(parseInt(arg, 10), '管理员指令添加', String(user.id));
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
      await tg.sendMsg({ chatId: user.id, text: buildDetailText(u, false, t), kb: fullUserKb(u.user_id, u, t) });
      return;
    }

    // Unknown slash commands should not be forwarded to group/topic.
    await tg.sendMsg({ chatId: user.id, text: t('admin.unknownCmd') });
    return;
  }

  if (settings.ADMIN_NOTIFY_ENABLED !== 'true') return;

  // ADMIN_NOTIFY is ON: forward admin message to forum group (no target thread context in private chat)
  const fwdRes = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id });
  if (fwdRes.ok) {
    await tg.sendMsg({ chatId: user.id, text: t('admin.forwarded') });
  } else {
    // Fallback: show admin control panel if forwarding fails (e.g. bot not in group yet)
    await sendPanel();
  }
}

// ── Callback handler ──────────────────────────────────────────────────────────
async function handleCb(q, { tg, db, kv, settings, t }) {
  const { data, from: user, message } = q;
  const chatId  = message.chat.id;
  const msgId   = message.message_id;
  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);
  const isAdmin  = adminIds.includes(user.id);

  try {
    // ── User callbacks ────────────────────────────────────────────────────────
    if (data === 'user:msg') { await tg.answerCb({ id: q.id, text: t('cb.sendText') }); return; }
    if (data === 'user:help') {
      await tg.editText({ chatId, msgId, text: t('cb.help'), kb: [[{ text: t('cb.back'), callback_data: 'user:back' }]] });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:back') {
      const s = await db.getAllSettings();
      await tg.editText({ chatId, msgId, text: s.WELCOME_MESSAGE || t('cb.welcomeFallback'), kb: [[{ text: t('user.sendMsg'), callback_data: 'user:msg' }, { text: t('user.help'), callback_data: 'user:help' }]] });
      await tg.answerCb({ id: q.id });
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
      const [, sel, captchaId] = data.split(':');
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
      await tg.editText({
        chatId, msgId,
        text: isStart ? t('appeal.enter') : t('appeal.blocked'),
        kb:   isStart ? [[{ text: t('appeal.cancel'), callback_data: 'appeal:cancel' }]] : [[{ text: t('appeal.short'), callback_data: 'appeal:start' }]],
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
      await db.blockUser(uid, '管理员操作', user.id, false);
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
      await db.blockUser(uid, '永久封禁', user.id, true);
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
        await db.addToWhitelist(uid, '管理员手动添加', String(user.id));
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
      const nav = [];
      if (page > 1)           nav.push({ text: '◀', callback_data: `ml:${uid}:${page - 1}` });
      if (msgs.length === ps) nav.push({ text: '▶', callback_data: `ml:${uid}:${page + 1}` });
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
    if (data.startsWith('adm:')) await handleAdmCb(q, data.slice(4), { tg, db, settings, chatId, msgId, t });
    else await tg.answerCb({ id: q.id });
  } catch (e) {
    console.error('handleCb:', e);
    await tg.answerCb({ id: q.id }).catch(() => {});
  }
}

async function handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId, t) {
  const v = await db.getVerify(user.id);
  if (!v || v.expires_at < Date.now()) {
    await db.delVerify(user.id);
    await tg.answerCb({ id: q.id, text: t('verify.expired'), alert: true });
    return;
  }
  if (captchaId && v.captcha_id !== captchaId) {
    await tg.answerCb({ id: q.id, text: t('verify.mismatch'), alert: true });
    return;
  }
  const maxAtt = parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10);
  if (sel === v.answer) {
    await db.setUserVerified(user.id, true);
    await db.delVerify(user.id);
    if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
    await tg.editText({ chatId, msgId, text: t('verify.success'), kb: [] }).catch(() => {});
    // Forward pending message
    const pr = await kv.get(`pending:${user.id}`);
    if (pr && groupId) {
      await kv.delete(`pending:${user.id}`);
      const p = JSON.parse(pr);
      const u = await db.getUser(user.id);
      const tid = await getOrCreateThread(tg, db, user, groupId, kv, t);
      if (tid && p.msgId) {
        await tg.copyMsg({ chatId: groupId, fromChatId: chatId, msgId: p.msgId, threadId: tid });
        await db.addMsg({ userId: user.id, direction: 'incoming', content: '[已验证，消息已转发]' });
        await tg.sendMsg({ chatId: user.id, text: t('sentAfterVerify') });
      }
    }
    await tg.answerCb({ id: q.id }).catch(() => {});
  } else {
    await db.incVerify(user.id);
    const att = v.attempts + 1;
    if (att >= maxAtt) {
      await db.delVerify(user.id);
      if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
      await tg.editText({ chatId, msgId, text: t('verify.tooMany'), kb: [] }).catch(() => {});
      await tg.answerCb({ id: q.id }).catch(() => {});
    } else {
      await tg.answerCb({ id: q.id, text: t('verify.wrongLeft', { left: maxAtt - att }), alert: true });
    }
  }
}

async function handleAdmCb(q, action, { tg, db, settings, chatId, msgId, t }) {
  const toggle = async (key, label) => {
    const cur = settings[key] === 'true';
    await db.setSetting(key, cur ? 'false' : 'true');
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns, t) });
    await tg.answerCb({ id: q.id, text: t('toggleResult', { label, state: cur ? t('panel.off') : t('panel.on') }) });
  };

  if (action === 'tv') return toggle('VERIFICATION_ENABLED', t('panel.verify'));
  if (action === 'ta') return toggle('AUTO_UNBLOCK_ENABLED', t('panel.appeal'));
  if (action === 'tw') return toggle('WHITELIST_ENABLED', t('panel.whitelist'));
  if (action === 'tf') return toggle('BOT_COMMAND_FILTER', t('panel.cmdFilter'));
  if (action === 'tn') return toggle('ADMIN_NOTIFY_ENABLED', t('panel.adminNotify'));

  if (action === 'ct') {
    const all = ['math', 'image_numeric', 'image_alphanumeric'];
    const cur = all.indexOf(settings.CAPTCHA_TYPE || 'math');
    const next = all[(cur + 1) % all.length];
    await db.setSetting('CAPTCHA_TYPE', next);
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns, t) });
    await tg.answerCb({ id: q.id, text: t('captchaTypeSwitched') });
    return;
  }

  if (action === 'to') {
    const cur = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10));
    const next = cur >= 900 ? 60 : cur + 60;
    await db.setSetting('VERIFICATION_TIMEOUT', String(next));
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns, t) });
    await tg.answerCb({ id: q.id, text: t('timeoutSet', { next }) });
    return;
  }

  if (action === 'ma') {
    const cur = Math.max(1, parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10));
    const next = cur >= 10 ? 1 : cur + 1;
    await db.setSetting('MAX_VERIFICATION_ATTEMPTS', String(next));
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns, t) });
    await tg.answerCb({ id: q.id, text: t('attemptsSet', { next }) });
    return;
  }

  if (action === 'st') {
    const s = await db.getStats();
    await tg.editText({ chatId, msgId, text: t('admin.stats', s), kb: [[{ text: t('cb.back'), callback_data: 'adm:bk' }]] });
  } else if (action === 'bk') {
    const s = await db.getAllSettings(), st = await db.getStats();
    await tg.editText({ chatId, msgId, text: t('admin.panelCompact', st), kb: adminPanelKb(s, t) });
  } else if (action.startsWith('bk:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getBlockedUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} — ${esc(u.block_reason || t('list.none'))}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1)  nav.push({ text: '◀', callback_data: `adm:bk:${page - 1}` });
    if (page < tp) nav.push({ text: '▶', callback_data: `adm:bk:${page + 1}` });
    await tg.editText({ chatId, msgId, text: `🚫 <b>${t('blacklistTitle', { total, page, tp })}</b>\n\n${lines}`, kb: [nav, [{ text: t('cb.back'), callback_data: 'adm:bk' }]] });
  } else if (action.startsWith('ul:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getAllUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} ${u.is_blocked ? '⛔' : '✅'}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1)  nav.push({ text: '◀', callback_data: `adm:ul:${page - 1}` });
    if (page < tp) nav.push({ text: '▶', callback_data: `adm:ul:${page + 1}` });
    await tg.editText({ chatId, msgId, text: `👥 <b>${t('userListTitle', { total, page, tp })}</b>\n\n${lines}`, kb: [nav, [{ text: t('cb.back'), callback_data: 'adm:bk' }]] });
  }
  await tg.answerCb({ id: q.id }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    `ID: <code>${u.user_id}</code>\n` +
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
  if (!ts) return t ? t('list.none') : '未知';
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
