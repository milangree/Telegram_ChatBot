// functions/_shared/bot.js
import { TG, esc, name, msgType } from './tg.js';
import { generateCode, generateWrongOptions } from './captcha.js';

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
async function getOrCreateThread(tg, db, user, groupId, kv) {
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
    await sendCard(tg, db, user, groupId, tid);
    return tid;
  } finally {
    await kv.delete(lockKey).catch(() => {});
  }
}

async function sendCard(tg, db, user, groupId, tid) {
  const u    = await db.getUser(user.id);
  const kb   = fullUserKb(user.id, u);
  const text = buildCardText(user, u);

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

function buildCardText(user, u) {
  return `👤 <b>用户信息</b>\n\n` +
    `姓名：${esc(name(user))}\n` +
    `用户名：${user.username ? '@' + esc(user.username) : '无'}\n` +
    `ID：<code>${user.id}</code>\n` +
    `语言：${user.language_code || '未知'}\n` +
    `首次联系：${fmtUtc8(u?.created_at)}\n` +
    `状态：${u?.is_blocked ? '⛔ 已封禁' : (u?.is_verified ? '✅ 已验证' : '🟡 未验证')}`;
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function fullUserKb(uid, u) {
  return [
    [
      { text: u?.is_blocked ? '✅ 解封' : '🚫 封禁', callback_data: u?.is_blocked ? `ub:${uid}` : `bl:${uid}` },
      { text: u?.is_blocked ? '♾️ 永封' : '📋 详情', callback_data: u?.is_blocked ? `pb:${uid}` : `ui:${uid}` },
    ],
    [
      { text: '⚪ 白名单', callback_data: `wl:${uid}` },
      { text: '📨 消息记录', callback_data: `ml:${uid}:1` },
    ],
    [
      { text: '🔄 刷新', callback_data: `rf:${uid}` },
    ],
  ];
}

function adminPanelKb(s) {
  const capLabel = s.CAPTCHA_TYPE === 'image_numeric'
    ? '图片数字'
    : (s.CAPTCHA_TYPE === 'image_alphanumeric' ? '图片字母数字' : '数学题');
  return [
    [
      { text: `✅ 验证: ${s.VERIFICATION_ENABLED === 'true' ? '开' : '关'}`, callback_data: 'adm:tv' },
      { text: `🔓 申诉: ${s.AUTO_UNBLOCK_ENABLED === 'true' ? '开' : '关'}`, callback_data: 'adm:ta' },
    ],
    [
      { text: `⚪ 白名单: ${s.WHITELIST_ENABLED === 'true' ? '开' : '关'}`, callback_data: 'adm:tw' },
      { text: `🤖 过滤指令: ${s.BOT_COMMAND_FILTER === 'true' ? '开' : '关'}`, callback_data: 'adm:tf' },
    ],
    [
      { text: `🧩 验证类型: ${capLabel}`, callback_data: 'adm:ct' },
      { text: `⏱ 超时: ${s.VERIFICATION_TIMEOUT || '300'}s`, callback_data: 'adm:to' },
    ],
    [
      { text: `🔁 尝试: ${s.MAX_VERIFICATION_ATTEMPTS || '3'}`, callback_data: 'adm:ma' },
      { text: `📩 管理私聊: ${s.ADMIN_NOTIFY_ENABLED === 'true' ? '开' : '关'}`, callback_data: 'adm:tn' },
    ],
    [
      { text: '📊 统计', callback_data: 'adm:st' },
      { text: '🚫 黑名单', callback_data: 'adm:bk:1' },
    ],
    [{ text: '👥 用户列表', callback_data: 'adm:ul:1' }],
  ];
}

// ── Commands setup ────────────────────────────────────────────────────────────
export async function setupCommands(tg) {
  const userCmds = [
    { command: 'start', description: '开始使用 / 查看欢迎信息' },
    { command: 'help',  description: '查看帮助' },
    { command: 'status', description: '查看当前状态' },
  ];
  const adminCmds = [
    ...userCmds,
    { command: 'stats',  description: '[管理] 查看统计信息' },
    { command: 'ban',    description: '[管理] 封禁用户 /ban <uid>' },
    { command: 'unban',  description: '[管理] 解封用户 /unban <uid>' },
    { command: 'wl',     description: '[管理] 加入白名单 /wl <uid>' },
    { command: 'unwl',   description: '[管理] 移出白名单 /unwl <uid>' },
    { command: 'info',   description: '[管理] 用户信息 /info <uid>' },
    { command: 'panel',  description: '[管理] 打开控制台' },
  ];
  await tg.setMyCommands({ commands: userCmds });
  await tg.setMyCommands({ commands: adminCmds, scope: { type: 'all_private_chats' } });
  await tg.setChatMenuButton({ menuButton: { type: 'commands' } });
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function processUpdate(update, env) {
  if (!env?.KV) { console.error('KV not bound'); return; }
  const db  = env._db;
  try {
    const settings = await db.getAllSettings();
    if (!settings.BOT_TOKEN)      { console.error('BOT_TOKEN missing'); return; }
    if (!settings.FORUM_GROUP_ID) { console.error('FORUM_GROUP_ID missing'); return; }
    const tg  = new TG(settings.BOT_TOKEN);
    const ctx = { tg, db, kv: env.KV, settings, baseUrl: env.baseUrl || '' };
    if (update.message)              await handleMsg(update.message, ctx);
    else if (update.callback_query)  await handleCb(update.callback_query, ctx);
  } catch (e) { console.error('processUpdate:', e); }
}

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMsg(msg, { tg, db, kv, settings, baseUrl }) {
  if (!msg) return;
  const user = msg.from;
  if (!user || user.is_bot) return;

  const groupId  = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);

  // ── Group topic: admin → user forwarding ──────────────────────────────────
  if (msg.chat.id === groupId && msg.is_topic_message) {
    if (!adminIds.includes(user.id)) return; // only admins' replies get forwarded
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
    await handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId });
    return;
  }

  // ── Command filter ────────────────────────────────────────────────────────
  if (msg.text?.startsWith('/')) {
    const [cmdFull] = msg.text.split(' ');
    const cmd = cmdFull.split('@')[0].slice(1).toLowerCase();

    if (cmd === 'start' || cmd === 'help') {
      const welcomeText = settings.WELCOME_MESSAGE ||
        '👋 欢迎使用双向消息机器人！\n\n请直接发送您的问题，管理员将尽快回复。';
      const kb = [[
        { text: '📨 发送消息', callback_data: 'user:msg' },
        { text: '🆘 帮助', callback_data: 'user:help' },
      ]];
      await tg.sendMsg({ chatId: user.id, text: welcomeText, kb });
      return;
    }
    if (cmd === 'status') {
      const u = await db.getUser(user.id);
      await tg.sendMsg({ chatId: user.id, text: `📋 <b>状态</b>\n\n验证：${u?.is_verified ? '✅ 已通过' : '❌ 未通过'}\n封禁：${u?.is_blocked ? '⛔ 是' : '✅ 否'}` });
      return;
    }
    if (settings.BOT_COMMAND_FILTER === 'true') return; // swallow unknown commands
  }

  // ── Block check ───────────────────────────────────────────────────────────
  const dbUser = await db.getUser(user.id);
  if (dbUser?.is_blocked) {
    const pendingAppeal = await kv.get(`pending_appeal:${user.id}`);
    if (pendingAppeal && msg.text && !msg.text.startsWith('/')) {
      const appealText = msg.text.trim();
      if (appealText) {
        const who = `${name(user)} (${user.id})`;
        const text = `📝 <b>用户申诉</b>\n\n用户：${esc(who)}\n内容：\n${esc(appealText)}`;
        if (dbUser.thread_id) {
          await tg.sendMsg({
            chatId: groupId,
            threadId: dbUser.thread_id,
            text,
            kb: [[
              { text: '✅ 通过申诉(解封)', callback_data: `apu:${user.id}` },
              { text: '❌ 拒绝申诉', callback_data: `apr:${user.id}` },
            ]],
          }).catch(() => {});
        }
        for (const aid of adminIds) {
          await tg.sendMsg({
            chatId: aid,
            text,
            kb: [[
              { text: '✅ 通过申诉(解封)', callback_data: `apu:${user.id}` },
              { text: '❌ 拒绝申诉', callback_data: `apr:${user.id}` },
            ]],
          }).catch(() => {});
        }
        await kv.delete(`pending_appeal:${user.id}`);
        await tg.sendMsg({ chatId: user.id, text: '✅ 申诉已提交，请等待管理员处理。' });
      }
      return;
    }

    if (dbUser.is_permanent_block) {
      await tg.sendMsg({ chatId: user.id, text: '⛔ <b>您已被永久封禁</b>，如有疑问请联系管理员。' });
    } else if (settings.AUTO_UNBLOCK_ENABLED === 'true') {
      await tg.sendMsg({ chatId: user.id, text: '⛔ <b>您已被封禁</b>\n可发起申诉：', kb: [[{ text: '📝 发起申诉', callback_data: 'appeal:start' }]] });
    } else {
      await tg.sendMsg({ chatId: user.id, text: '⛔ <b>您已被封禁</b>，请联系管理员。' });
    }
    return;
  }

  // ── Whitelist bypass ──────────────────────────────────────────────────────
  const whitelisted = settings.WHITELIST_ENABLED === 'true' && await db.isWhitelisted(user.id);

  if (!whitelisted) {
    const maxRate = parseInt(settings.MAX_MESSAGES_PER_MINUTE || '30', 10);
    if (rateCheck(user.id, maxRate)) {
      await tg.sendMsg({ chatId: user.id, text: `⚠️ 发送过于频繁，请稍候再试。` });
      return;
    }

    // ── Verification ──────────────────────────────────────────────────────
    if (settings.VERIFICATION_ENABLED === 'true' && !dbUser?.is_verified) {
      const timeout     = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10)); // CF KV minimum TTL is 60s
      const captchaType = settings.CAPTCHA_TYPE || 'math';
      const existing    = await db.getVerify(user.id);
      if (existing && existing.expires_at > Date.now()) {
        await tg.sendMsg({ chatId: user.id, text: '请先完成上方的人机验证 ☝️' });
        return;
      }

      await kv.put(`pending:${user.id}`, JSON.stringify({ msgId: msg.message_id, type: msgType(msg) }), { expirationTtl: timeout });

      if (captchaType === 'math') {
        const { question, answer, kb } = mkMathVerify();
        await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
        await tg.sendMsg({ chatId: user.id, text: `🔐 <b>人机验证</b>\n\n请选择正确答案：\n\n${question}`, kb });
      } else {
        const siteUrl = settings.CAPTCHA_SITE_URL || baseUrl;
        if (!siteUrl) {
          // Fallback to math
          const { question, answer, kb } = mkMathVerify();
          await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
          await tg.sendMsg({ chatId: user.id, text: `🔐 <b>人机验证</b>\n\n请选择正确答案：\n\n${question}`, kb });
        } else {
          const captchaId  = randId();
          const code       = generateCode(captchaType);
          await kv.put(`captcha_render:${captchaId}`, code, { expirationTtl: timeout + 60 });
          const wrongs     = generateWrongOptions(code, captchaType);
          const opts       = [code, ...wrongs].sort(() => Math.random() - 0.5);
          const kb         = rows2(opts, o => ({ text: o, callback_data: `iv:${o}:${captchaId}` }));
          await db.setVerify(user.id, { answer: code, captcha_id: captchaId, captcha_type: captchaType }, timeout);
          const typeLabel  = captchaType === 'image_alphanumeric' ? '5位字母+数字' : '4位数字';
          const caption    = `🔐 <b>图片验证码</b>\n\n请识别图中的 ${typeLabel} 验证码：`;
          const imgUrl     = `${siteUrl}/api/captcha/${captchaId}`;
          const r          = await tg.sendPhoto({ chatId: user.id, url: imgUrl, caption, kb });
          if (!r.ok) {
            const { question, answer, kb: mathKb } = mkMathVerify();
            await db.setVerify(user.id, { answer, captcha_type: 'math' }, timeout);
            await tg.sendMsg({ chatId: user.id, text: `🔐 <b>人机验证</b>\n\n请选择正确答案：\n\n${question}`, kb: mathKb });
          }
        }
      }
      return;
    }
  }

  if (!groupId || isNaN(groupId)) {
    await tg.sendMsg({ chatId: user.id, text: '⚙️ 机器人未正确配置，请联系管理员。' });
    return;
  }

  const tid = await getOrCreateThread(tg, db, user, groupId, kv);
  if (!tid) { await tg.sendMsg({ chatId: user.id, text: '❌ 发送失败，请稍后再试。' }); return; }

  // Use copyMessage to forward ALL content types with full formatting preserved
  const res = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: tid });
  if (res.ok) {
    await db.addMsg({ userId: user.id, direction: 'incoming', content: msg.text || msg.caption || '[媒体]', messageType: msgType(msg), telegramMessageId: msg.message_id });
    await tg.sendMsg({ chatId: user.id, text: '✅ 消息已发送，管理员将尽快回复。' });
  } else {
    console.error('copyMsg failed:', res);
    await tg.sendMsg({ chatId: user.id, text: '❌ 发送失败，请稍后再试。' });
  }
}

async function handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId }) {
  if (msg.text?.startsWith('/')) {
    const parts = msg.text.trim().split(/\s+/);
    const cmd   = parts[0].split('@')[0].slice(1).toLowerCase();
    const arg   = parts[1];

    if (cmd === 'stats') {
      const s = await db.getStats();
      await tg.sendMsg({ chatId: user.id, text: `📊 <b>统计</b>\n\n👥 总用户：${s.totalUsers}\n⛔ 封禁：${s.blockedUsers}\n💬 消息：${s.totalMessages}\n📅 今日：${s.todayMessages}` });
      return;
    }
    if (cmd === 'ban' && arg) {
      await db.blockUser(parseInt(arg, 10), '管理员指令封禁', user.id, true);
      await tg.sendMsg({ chatId: user.id, text: `✅ 已封禁用户 ${arg}` });
      return;
    }
    if (cmd === 'unban' && arg) {
      await db.unblockUser(parseInt(arg, 10));
      await tg.sendMsg({ chatId: user.id, text: `✅ 已解封用户 ${arg}` });
      return;
    }
    if (cmd === 'wl' && arg) {
      await db.addToWhitelist(parseInt(arg, 10), '管理员指令添加', String(user.id));
      await tg.sendMsg({ chatId: user.id, text: `✅ 用户 ${arg} 已加入白名单` });
      return;
    }
    if (cmd === 'unwl' && arg) {
      await db.removeFromWhitelist(parseInt(arg, 10));
      await tg.sendMsg({ chatId: user.id, text: `✅ 用户 ${arg} 已移出白名单` });
      return;
    }
    if (cmd === 'info' && arg) {
      const u = await db.getUser(parseInt(arg, 10));
      if (!u) { await tg.sendMsg({ chatId: user.id, text: '用户不存在' }); return; }
      await tg.sendMsg({ chatId: user.id, text: buildDetailText(u), kb: fullUserKb(u.user_id, u) });
      return;
    }
  }

  if (msg.text?.startsWith('/panel')) {
    const s = await db.getStats();
    await tg.sendMsg({
      chatId: user.id,
      text: `🤖 <b>管理员控制台</b>\n\n👥 ${s.totalUsers} 用户  ⛔ ${s.blockedUsers} 封禁\n💬 ${s.totalMessages} 消息  📅 今日 ${s.todayMessages}`,
      kb: adminPanelKb(settings),
    });
    return;
  }

  if (settings.ADMIN_NOTIFY_ENABLED !== 'true') return;

  // Default: show admin control panel
  const s  = await db.getStats();
  await tg.sendMsg({
    chatId: user.id,
    text: `🤖 <b>管理员控制台</b>\n\n👥 ${s.totalUsers} 用户  ⛔ ${s.blockedUsers} 封禁\n💬 ${s.totalMessages} 消息  📅 今日 ${s.todayMessages}`,
    kb: adminPanelKb(settings),
  });
}

// ── Callback handler ──────────────────────────────────────────────────────────
async function handleCb(q, { tg, db, kv, settings }) {
  const { data, from: user, message } = q;
  const chatId  = message.chat.id;
  const msgId   = message.message_id;
  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);
  const isAdmin  = adminIds.includes(user.id);

  try {
    // ── User callbacks ────────────────────────────────────────────────────────
    if (data === 'user:msg') { await tg.answerCb({ id: q.id, text: '请直接发送文字消息' }); return; }
    if (data === 'user:help') {
      await tg.editText({ chatId, msgId, text: '❓ <b>帮助</b>\n\n直接发送消息即可联系管理员。\n发送 /start 返回主页。', kb: [[{ text: '← 返回', callback_data: 'user:back' }]] });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:back') {
      const s = await db.getAllSettings();
      await tg.editText({ chatId, msgId, text: s.WELCOME_MESSAGE || '欢迎！', kb: [[{ text: '📨 发送消息', callback_data: 'user:msg' }, { text: '🆘 帮助', callback_data: 'user:help' }]] });
      await tg.answerCb({ id: q.id });
      return;
    }

    // ── Math verification ─────────────────────────────────────────────────────
    if (data.startsWith('v:')) {
      const sel = data.slice(2);
      await handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, null);
      return;
    }

    // ── Image verification ────────────────────────────────────────────────────
    if (data.startsWith('iv:')) {
      const [, sel, captchaId] = data.split(':');
      await handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId);
      return;
    }

    // ── Appeal ────────────────────────────────────────────────────────────────
    if (data.startsWith('appeal:')) {
      const isStart = data === 'appeal:start';
      if (isStart) await kv.put(`pending_appeal:${user.id}`, '1', { expirationTtl: 900 });
      else await kv.delete(`pending_appeal:${user.id}`);
      await tg.editText({
        chatId, msgId,
        text: isStart ? '📝 <b>申诉</b>\n\n请直接发送申诉内容，管理员会审核。' : '⛔ <b>您已被封禁</b>',
        kb:   isStart ? [[{ text: '❌ 取消', callback_data: 'appeal:cancel' }]] : [[{ text: '📝 申诉', callback_data: 'appeal:start' }]],
      });
      await tg.answerCb({ id: q.id });
      return;
    }

    if (!isAdmin) { await tg.answerCb({ id: q.id, text: '⛔ 无权限', alert: true }); return; }

    // ── Admin callbacks ───────────────────────────────────────────────────────
    if (data.startsWith('bl:')) {
      const uid = parseInt(data.slice(3), 10);
      await db.blockUser(uid, '管理员操作', user.id, false);
      await refreshCard(tg, db, chatId, msgId, uid, message);
      await tg.sendMsg({ chatId: uid, text: '⛔ 您已被封禁。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '✅ 已封禁' });
      return;
    }
    if (data.startsWith('pb:')) {
      const uid = parseInt(data.slice(3), 10);
      await db.blockUser(uid, '永久封禁', user.id, true);
      await refreshCard(tg, db, chatId, msgId, uid, message);
      await tg.sendMsg({ chatId: uid, text: '⛔ 您已被永久封禁。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '✅ 已永久封禁' });
      return;
    }
    if (data.startsWith('ub:')) {
      const uid = parseInt(data.slice(3), 10);
      await db.unblockUser(uid);
      await refreshCard(tg, db, chatId, msgId, uid, message);
      await tg.sendMsg({ chatId: uid, text: '✅ 您已被解封，可继续发送消息。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '✅ 已解封' });
      return;
    }
    if (data.startsWith('wl:')) {
      const uid = parseInt(data.slice(3), 10);
      const isWl = await db.isWhitelisted(uid);
      if (isWl) {
        await db.removeFromWhitelist(uid);
        await tg.answerCb({ id: q.id, text: '✅ 已移出白名单' });
      } else {
        await db.addToWhitelist(uid, '管理员手动添加', String(user.id));
        await tg.answerCb({ id: q.id, text: '✅ 已加入白名单' });
      }
      await refreshCard(tg, db, chatId, msgId, uid, message);
      return;
    }
    if (data.startsWith('ui:')) {
      const uid = parseInt(data.slice(3), 10);
      const u   = await db.getUser(uid);
      if (!u) { await tg.answerCb({ id: q.id, text: '用户不存在' }); return; }
      const isWl = await db.isWhitelisted(uid);
      await editCard(tg, chatId, msgId, message, buildDetailText(u, isWl), [...fullUserKb(uid, u), [{ text: '🔙 收起', callback_data: `rf:${uid}` }]]);
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data.startsWith('rf:')) {
      const uid = parseInt(data.slice(3), 10);
      const u   = await db.getUser(uid);
      await refreshCard(tg, db, chatId, msgId, uid, message);
      await tg.answerCb({ id: q.id, text: '已刷新' });
      return;
    }
    if (data.startsWith('ml:')) {
      const [, uid, pg] = data.split(':');
      const page = parseInt(pg || '1', 10), ps = 8;
      const msgs = await db.getMsgs(parseInt(uid, 10), ps, (page - 1) * ps);
      if (!msgs.length) { await tg.answerCb({ id: q.id, text: '暂无记录' }); return; }
      const lines = msgs.map(m => `[${fmtMsgTime(m.created_at)}] ${m.direction === 'incoming' ? '→' : '←'} ${esc((m.content || '').slice(0, 36))}`).join('\n');
      const nav = [];
      if (page > 1)           nav.push({ text: '◀', callback_data: `ml:${uid}:${page - 1}` });
      if (msgs.length === ps) nav.push({ text: '▶', callback_data: `ml:${uid}:${page + 1}` });
      await editCard(tg, chatId, msgId, message, `📨 <b>消息记录 (第${page}页)</b>\n\n<code>${lines}</code>`, [nav, [{ text: '← 返回', callback_data: `ui:${uid}` }]]);
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data.startsWith('apu:')) {
      const uid = parseInt(data.slice(4), 10);
      await db.unblockUser(uid);
      await tg.sendMsg({ chatId: uid, text: '✅ 您的申诉已通过，账号已解封。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '已通过申诉并解封' });
      return;
    }
    if (data.startsWith('apr:')) {
      const uid = parseInt(data.slice(4), 10);
      await tg.sendMsg({ chatId: uid, text: '❌ 您的申诉未通过，请稍后再试或联系管理员。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '已拒绝申诉' });
      return;
    }

    // ── Admin panel callbacks ─────────────────────────────────────────────────
    if (data.startsWith('adm:')) await handleAdmCb(q, data.slice(4), { tg, db, settings, chatId, msgId });
    else await tg.answerCb({ id: q.id });
  } catch (e) {
    console.error('handleCb:', e);
    await tg.answerCb({ id: q.id }).catch(() => {});
  }
}

async function handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId) {
  const v = await db.getVerify(user.id);
  if (!v || v.expires_at < Date.now()) {
    await db.delVerify(user.id);
    await tg.answerCb({ id: q.id, text: '验证已过期，请重新发送消息', alert: true });
    return;
  }
  if (captchaId && v.captcha_id !== captchaId) {
    await tg.answerCb({ id: q.id, text: '验证码不匹配，请重新发送消息', alert: true });
    return;
  }
  const maxAtt = parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10);
  if (sel === v.answer) {
    await db.setUserVerified(user.id, true);
    await db.delVerify(user.id);
    if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
    await tg.editText({ chatId, msgId, text: '✅ <b>验证成功！</b>\n\n现在可以发送消息了。', kb: [] }).catch(() => {});
    // Forward pending message
    const pr = await kv.get(`pending:${user.id}`);
    if (pr && groupId) {
      await kv.delete(`pending:${user.id}`);
      const p = JSON.parse(pr);
      const u = await db.getUser(user.id);
      const tid = await getOrCreateThread(tg, db, user, groupId, kv);
      if (tid && p.msgId) {
        await tg.copyMsg({ chatId: groupId, fromChatId: chatId, msgId: p.msgId, threadId: tid });
        await db.addMsg({ userId: user.id, direction: 'incoming', content: '[已验证，消息已转发]' });
        await tg.sendMsg({ chatId: user.id, text: '✅ 消息已发送给管理员。' });
      }
    }
    await tg.answerCb({ id: q.id }).catch(() => {});
  } else {
    await db.incVerify(user.id);
    const att = v.attempts + 1;
    if (att >= maxAtt) {
      await db.delVerify(user.id);
      if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
      await tg.editText({ chatId, msgId, text: '❌ <b>验证失败次数过多</b>\n请重新发送消息获取新验证。', kb: [] }).catch(() => {});
      await tg.answerCb({ id: q.id }).catch(() => {});
    } else {
      await tg.answerCb({ id: q.id, text: `❌ 错误，还剩 ${maxAtt - att} 次`, alert: true });
    }
  }
}

async function handleAdmCb(q, action, { tg, db, settings, chatId, msgId }) {
  const toggle = async (key, label) => {
    const cur = settings[key] === 'true';
    await db.setSetting(key, cur ? 'false' : 'true');
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns) });
    await tg.answerCb({ id: q.id, text: `${label}已${cur ? '关闭' : '开启'}` });
  };

  if (action === 'tv') return toggle('VERIFICATION_ENABLED', '验证');
  if (action === 'ta') return toggle('AUTO_UNBLOCK_ENABLED', '申诉');
  if (action === 'tw') return toggle('WHITELIST_ENABLED', '白名单');
  if (action === 'tf') return toggle('BOT_COMMAND_FILTER', '指令过滤');
  if (action === 'tn') return toggle('ADMIN_NOTIFY_ENABLED', '管理私聊提示');

  if (action === 'ct') {
    const all = ['math', 'image_numeric', 'image_alphanumeric'];
    const cur = all.indexOf(settings.CAPTCHA_TYPE || 'math');
    const next = all[(cur + 1) % all.length];
    await db.setSetting('CAPTCHA_TYPE', next);
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns) });
    await tg.answerCb({ id: q.id, text: '验证类型已切换' });
    return;
  }

  if (action === 'to') {
    const cur = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10));
    const next = cur >= 900 ? 60 : cur + 60;
    await db.setSetting('VERIFICATION_TIMEOUT', String(next));
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns) });
    await tg.answerCb({ id: q.id, text: `验证超时已设为 ${next}s` });
    return;
  }

  if (action === 'ma') {
    const cur = Math.max(1, parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10));
    const next = cur >= 10 ? 1 : cur + 1;
    await db.setSetting('MAX_VERIFICATION_ATTEMPTS', String(next));
    const ns = await db.getAllSettings();
    await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns) });
    await tg.answerCb({ id: q.id, text: `尝试次数已设为 ${next}` });
    return;
  }

  if (action === 'st') {
    const s = await db.getStats();
    await tg.editText({ chatId, msgId, text: `📊 <b>统计</b>\n\n👥 总用户：${s.totalUsers}\n⛔ 封禁：${s.blockedUsers}\n💬 消息：${s.totalMessages}\n📅 今日：${s.todayMessages}`, kb: [[{ text: '← 返回', callback_data: 'adm:bk' }]] });
  } else if (action === 'bk') {
    const s = await db.getAllSettings(), st = await db.getStats();
    await tg.editText({ chatId, msgId, text: `🤖 <b>管理员控制台</b>\n\n👥 ${st.totalUsers}  ⛔ ${st.blockedUsers}  💬 ${st.totalMessages}`, kb: adminPanelKb(s) });
  } else if (action.startsWith('bk:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getBlockedUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} — ${esc(u.block_reason || '无')}`).join('\n') || '暂无';
    const nav = [];
    if (page > 1)  nav.push({ text: '◀', callback_data: `adm:bk:${page - 1}` });
    if (page < tp) nav.push({ text: '▶', callback_data: `adm:bk:${page + 1}` });
    await tg.editText({ chatId, msgId, text: `🚫 <b>黑名单 (${total}人 第${page}/${tp}页)</b>\n\n${lines}`, kb: [nav, [{ text: '← 返回', callback_data: 'adm:bk' }]] });
  } else if (action.startsWith('ul:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getAllUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} ${u.is_blocked ? '⛔' : '✅'}`).join('\n') || '暂无';
    const nav = [];
    if (page > 1)  nav.push({ text: '◀', callback_data: `adm:ul:${page - 1}` });
    if (page < tp) nav.push({ text: '▶', callback_data: `adm:ul:${page + 1}` });
    await tg.editText({ chatId, msgId, text: `👥 <b>用户列表 (${total}人 第${page}/${tp}页)</b>\n\n${lines}`, kb: [nav, [{ text: '← 返回', callback_data: 'adm:bk' }]] });
  }
  await tg.answerCb({ id: q.id }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseAdminIds(str) {
  return (str || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
}

function buildDetailText(u, isWl = false) {
  return `👤 <b>用户详情</b>\n\n` +
    `ID: <code>${u.user_id}</code>\n` +
    `姓名: ${esc(name(u))}\n` +
    `用户名: ${u.username ? '@' + esc(u.username) : '无'}\n` +
    `语言: ${u.language_code || '未知'}\n` +
    `状态: ${u.is_blocked ? (u.is_permanent_block ? '♾️ 永久封禁' : '⛔ 封禁') : '✅ 正常'}\n` +
    (u.is_blocked ? `原因: ${esc(u.block_reason || '无')}\n` : '') +
    `白名单: ${isWl ? '⚪ 是' : '否'}\n` +
    `验证: ${u.is_verified ? '✅ 已验证' : '未验证'}\n` +
    `首次联系: ${fmtUtc8(u.created_at)}`;
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

async function refreshCard(tg, db, chatId, msgId, uid, message) {
  const u  = await db.getUser(uid);
  const kb = fullUserKb(uid, u);
  if (message.photo || message.video) {
    await tg.editCaption({ chatId, msgId, caption: buildCardText(u, u), kb }).catch(() =>
      tg.editKb({ chatId, msgId, kb })
    );
  } else {
    await tg.editText({ chatId, msgId, text: buildCardText(u, u), kb }).catch(() =>
      tg.editKb({ chatId, msgId, kb })
    );
  }
}

function fmtUtc8(ts) {
  if (!ts) return '未知';
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
