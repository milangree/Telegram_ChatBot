// functions/_shared/bot.js
import { TG, esc, name, msgType } from './tg.js';

// ── Verification questions ──────────────────────────────────────────────────
const QS = [
  { q: '1 + 1 = ?',   a: '2'  }, { q: '3 × 3 = ?',   a: '9'  },
  { q: '10 - 4 = ?',  a: '6'  }, { q: '2 + 5 = ?',   a: '7'  },
  { q: '4 × 2 = ?',   a: '8'  }, { q: '15 ÷ 3 = ?',  a: '5'  },
  { q: '6 + 7 = ?',   a: '13' }, { q: '20 ÷ 4 = ?',  a: '5'  },
  { q: '9 - 3 = ?',   a: '6'  },
];

function mkVerify() {
  const { q, a } = QS[Math.floor(Math.random() * QS.length)];
  const cor = parseInt(a, 10);
  const opts = new Set([cor]);
  while (opts.size < 4) {
    const c = cor + Math.floor(Math.random() * 10) - 5;
    if (c !== cor && c > 0) opts.add(c);
  }
  const kb = Array.from(opts)
    .sort(() => Math.random() - 0.5)
    .map(n => [{ text: String(n), callback_data: `verify:${n}:${a}` }]);
  return { question: q, answer: a, kb };
}

// ── Thread helpers ──────────────────────────────────────────────────────────

async function getOrCreateThread(tg, db, user, groupId) {
  try {
    const u = await db.getUser(user.id);
    if (u?.thread_id) return u.thread_id;

    console.log(`Creating thread for user ${user.id} in group ${groupId}`);
    const topicName = (name(user) || `User ${user.id}`).slice(0, 128);
    const res = await tg.createTopic({ chatId: groupId, name: topicName });

    if (!res.ok) {
      console.error('createTopic failed:', JSON.stringify(res));
      return null;
    }

    const tid = res.result.message_thread_id;
    await db.setUserThread(user.id, tid); // also writes thread:{tid} reverse index
    await sendCard(tg, db, user, groupId, tid);
    return tid;
  } catch (e) {
    console.error('getOrCreateThread error:', e);
    return null;
  }
}

async function sendCard(tg, db, user, groupId, tid) {
  try {
    const u = await db.getUser(user.id);
    const text =
      `👤 <b>用户信息</b>\n\n` +
      `姓名：${esc(name(user))}\n` +
      `用户名：${user.username ? '@' + esc(user.username) : '无'}\n` +
      `ID：<code>${user.id}</code>\n` +
      `状态：${u?.is_blocked ? '⛔ 已封禁' : '✅ 正常'}`;
    await tg.sendMsg({ chatId: groupId, text, threadId: tid, kb: userCardKb(user.id, u) });
  } catch (e) {
    console.error('sendCard error:', e);
  }
}

// ── Keyboards ───────────────────────────────────────────────────────────────

function userCardKb(uid, u) {
  return [
    [
      {
        text: u?.is_blocked ? '✅ 解封' : '🚫 封禁',
        callback_data: u?.is_blocked ? `unblock:${uid}` : `block:${uid}`,
      },
      { text: '📋 详情', callback_data: `userinfo:${uid}` },
    ],
    [
      { text: '📨 消息记录', callback_data: `msglog:${uid}:1` },
      { text: '🔄 刷新',    callback_data: `refresh:${uid}` },
    ],
  ];
}

function adminPanelKb(s) {
  return [
    [
      {
        text: `✅ 验证: ${s.VERIFICATION_ENABLED === 'true' ? '开' : '关'}`,
        callback_data: 'admin:toggle_verify',
      },
      {
        text: `🔓 自动解封: ${s.AUTO_UNBLOCK_ENABLED === 'true' ? '开' : '关'}`,
        callback_data: 'admin:toggle_autounblock',
      },
    ],
    [
      { text: '📊 统计',   callback_data: 'admin:stats' },
      { text: '🚫 黑名单', callback_data: 'admin:blacklist:1' },
    ],
    [{ text: '👥 用户列表', callback_data: 'admin:users:1' }],
  ];
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// NOTE: rateMap is in-memory and resets on each cold start / worker instance.
// This provides best-effort rate limiting only; for strict enforcement store
// counters in KV with an expirationTtl of 60 seconds.
const rateMap = new Map();

function rateCheck(uid, max) {
  const now = Date.now();
  const WIN = 60_000;
  const ts = (rateMap.get(uid) || []).filter(t => now - t < WIN);
  ts.push(now);
  rateMap.set(uid, ts);
  return ts.length > max;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function processUpdate(update, env) {
  try {
    if (!env?.KV) {
      console.error('KV is not bound');
      return;
    }

    const db = env._db;
    const settings = await db.getAllSettings();

    if (!settings.BOT_TOKEN) { console.error('BOT_TOKEN not configured'); return; }
    if (!settings.FORUM_GROUP_ID) { console.error('FORUM_GROUP_ID not configured'); return; }

    const tg = new TG(settings.BOT_TOKEN);
    const ctx = { tg, db, kv: env.KV, settings };

    if (update.message)        await handleMsg(update.message, ctx);
    else if (update.callback_query) await handleCb(update.callback_query, ctx);
  } catch (e) {
    console.error('processUpdate error:', e);
  }
}

// ── Message handler ──────────────────────────────────────────────────────────

async function handleMsg(msg, { tg, db, kv, settings }) {
  try {
    if (!msg) return;
    const user = msg.from;
    if (!user || user.is_bot) return;

    const groupId  = parseInt(settings.FORUM_GROUP_ID, 10);
    const adminIds = (settings.ADMIN_IDS || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(Boolean);

    // ── Admin replies from the forum group → forward to user ──
    if (msg.chat.id === groupId && msg.is_topic_message && !msg.from.is_bot) {
      const target = await db.getUserByThread(msg.message_thread_id);
      if (!target) return;
      if (msg.text) {
        await tg.sendMsg({
          chatId: target.user_id,
          text: `💬 <b>管理员回复：</b>\n\n${esc(msg.text)}`,
        });
      } else {
        await tg.copyMsg({
          chatId: target.user_id,
          fromChatId: msg.chat.id,
          msgId: msg.message_id,
        });
      }
      await db.addMsg({
        userId: target.user_id,
        direction: 'outgoing',
        content: msg.text || '[媒体]',
        messageType: msgType(msg),
      });
      return;
    }

    // Only handle private chats from here on
    if (msg.chat.type !== 'private') return;

    await db.upsertUser({
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      languageCode: user.language_code,
    });

    // ── Admin private message → show control panel ──
    if (adminIds.includes(user.id)) {
      const s  = await db.getStats();
      await tg.sendMsg({
        chatId: user.id,
        text:
          `🤖 <b>管理员控制台</b>\n\n` +
          `👥 总用户：${s.totalUsers}  ⛔ 封禁：${s.blockedUsers}\n` +
          `💬 总消息：${s.totalMessages}  📅 今日：${s.todayMessages}`,
        kb: adminPanelKb(settings),
      });
      return;
    }

    const dbUser = await db.getUser(user.id);

    // ── Block check ──
    if (dbUser?.is_blocked) {
      if (dbUser.is_permanent_block) {
        await tg.sendMsg({ chatId: user.id, text: '⛔ <b>您已被永久封禁</b>，如有疑问请联系管理员。' });
      } else if (settings.AUTO_UNBLOCK_ENABLED === 'true') {
        await tg.sendMsg({
          chatId: user.id,
          text: '⛔ <b>您已被封禁</b>\n\n可发起申诉：',
          kb: [[{ text: '📝 发起申诉', callback_data: 'appeal:start' }]],
        });
      } else {
        await tg.sendMsg({ chatId: user.id, text: '⛔ <b>您已被封禁</b>，请联系管理员。' });
      }
      return;
    }

    // ── Rate limit ──
    const maxRate = parseInt(settings.MAX_MESSAGES_PER_MINUTE || '30', 10);
    if (rateCheck(user.id, maxRate)) {
      await tg.sendMsg({
        chatId: user.id,
        text: `⚠️ 发送过于频繁，每分钟最多 ${maxRate} 条，请稍后再试。`,
      });
      return;
    }

    if (!groupId || isNaN(groupId)) {
      await tg.sendMsg({ chatId: user.id, text: '⚙️ 机器人尚未配置论坛群组，请联系管理员。' });
      return;
    }

    // ── Verification ──
    if (settings.VERIFICATION_ENABLED === 'true' && !dbUser?.is_verified) {
      const existing = await db.getVerify(user.id);
      const timeout  = parseInt(settings.VERIFICATION_TIMEOUT || '300', 10);
      if (existing && existing.expires_at > Date.now()) {
        await tg.sendMsg({ chatId: user.id, text: '请先完成上方的人机验证 ☝️' });
        return;
      }
      const { question, answer, kb } = mkVerify();
      await db.setVerify(user.id, question, answer, timeout);
      await kv.put(
        `pending:${user.id}`,
        JSON.stringify({ text: msg.text, type: msgType(msg), msgId: msg.message_id }),
        { expirationTtl: timeout },
      );
      await tg.sendMsg({
        chatId: user.id,
        text: `🔐 <b>人机验证</b>\n\n请点击正确答案：\n\n<b>${question}</b>`,
        kb,
      });
      return;
    }

    // ── Forward message to forum thread ──
    const tid = await getOrCreateThread(tg, db, user, groupId);
    if (!tid) {
      await tg.sendMsg({ chatId: user.id, text: '❌ 发送失败，请稍后再试。' });
      return;
    }

    const res = await tg.copyMsg({
      chatId: groupId,
      fromChatId: msg.chat.id,
      msgId: msg.message_id,
      threadId: tid,
    });

    if (res.ok) {
      await db.addMsg({
        userId: user.id,
        direction: 'incoming',
        content: msg.text || '[媒体]',
        messageType: msgType(msg),
        telegramMessageId: msg.message_id,
      });
      await tg.sendMsg({ chatId: user.id, text: '✅ 消息已发送，管理员将尽快回复。' });
    } else {
      console.error('copyMsg failed:', JSON.stringify(res));
      await tg.sendMsg({ chatId: user.id, text: '❌ 发送失败，请稍后再试。' });
    }
  } catch (e) {
    console.error('handleMsg error:', e);
  }
}

// ── Callback handler ─────────────────────────────────────────────────────────

async function handleCb(q, { tg, db, kv, settings }) {
  try {
    const { data, from: user, message } = q;
    const chatId  = message.chat.id;
    const msgId   = message.message_id;
    const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
    const adminIds = (settings.ADMIN_IDS || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(Boolean);
    const isAdmin = adminIds.includes(user.id);

    // ── Verification callback ──
    if (data.startsWith('verify:')) {
      const [, sel, correct] = data.split(':');
      const v = await db.getVerify(user.id);

      if (!v || v.expires_at < Date.now()) {
        await db.delVerify(user.id);
        await tg.answerCb({ id: q.id, text: '验证已过期，请重新发送消息', alert: true });
        return;
      }

      const maxAtt = parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10);

      if (sel === correct && sel === v.answer) {
        // ── Correct answer ──
        await db.setUserVerified(user.id, true);
        await db.delVerify(user.id);
        await tg.editText({ chatId, msgId, text: '✅ <b>验证成功！</b>\n\n现在可以发送消息了。', kb: [] });

        const pr = await kv.get(`pending:${user.id}`);
        if (pr) {
          const p = JSON.parse(pr);
          await kv.delete(`pending:${user.id}`);
          if (p.text && groupId) {
            const tid = await getOrCreateThread(tg, db, user, groupId);
            if (tid) {
              await tg.sendMsg({ chatId: groupId, text: p.text, threadId: tid });
              await db.addMsg({ userId: user.id, direction: 'incoming', content: p.text });
              await tg.sendMsg({ chatId: user.id, text: '✅ 消息已发送给管理员。' });
            }
          }
        }
        // FIX: only one answerCb call per branch (no fall-through)
        await tg.answerCb({ id: q.id }).catch(() => {});
      } else {
        // ── Wrong answer ──
        await db.incVerify(user.id);
        const att = v.attempts + 1;
        if (att >= maxAtt) {
          await db.delVerify(user.id);
          await tg.editText({
            chatId, msgId,
            text: '❌ <b>验证失败次数过多</b>\n请重新发送消息获取新验证题。',
            kb: [],
          });
          await tg.answerCb({ id: q.id }).catch(() => {});
        } else {
          // FIX: was calling answerCb twice (once here, once at end of block)
          await tg.answerCb({ id: q.id, text: `❌ 错误，还剩 ${maxAtt - att} 次`, alert: true });
        }
      }
      return;
    }

    // ── Appeal callback ──
    if (data.startsWith('appeal:')) {
      const isStart = data === 'appeal:start';
      await tg.editText({
        chatId, msgId,
        text: isStart
          ? '📝 <b>申诉说明</b>\n\n请直接发送申诉内容，管理员会审核。'
          : '⛔ <b>您已被封禁</b>',
        kb: isStart
          ? [[{ text: '❌ 取消', callback_data: 'appeal:cancel' }]]
          : [[{ text: '📝 发起申诉', callback_data: 'appeal:start' }]],
      });
      await tg.answerCb({ id: q.id });
      return;
    }

    if (!isAdmin) {
      await tg.answerCb({ id: q.id, text: '⛔ 无权限', alert: true });
      return;
    }

    // ── Admin: block ──
    if (data.startsWith('block:')) {
      const uid = parseInt(data.slice(6), 10);
      await db.blockUser(uid, '管理员操作', user.id, true);
      await tg.editKb({ chatId, msgId, kb: userCardKb(uid, await db.getUser(uid)) });
      await tg.sendMsg({ chatId: uid, text: '⛔ 您已被管理员封禁。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '✅ 已封禁' });
      return;
    }

    // ── Admin: unblock ──
    if (data.startsWith('unblock:')) {
      const uid = parseInt(data.slice(8), 10);
      await db.unblockUser(uid);
      await tg.editKb({ chatId, msgId, kb: userCardKb(uid, await db.getUser(uid)) });
      await tg.sendMsg({ chatId: uid, text: '✅ 您已被解封，可继续发送消息。' }).catch(() => {});
      await tg.answerCb({ id: q.id, text: '✅ 已解封' });
      return;
    }

    // ── Admin: userinfo ──
    if (data.startsWith('userinfo:')) {
      const uid = parseInt(data.slice(9), 10);
      const u   = await db.getUser(uid);
      if (!u) {
        await tg.answerCb({ id: q.id, text: '用户不存在' });
        return;
      }
      // FIX: was [...userCardKb(), [[{...}]]] — double-nested array for last row
      await tg.editText({
        chatId, msgId,
        text:
          `👤 <b>用户详情</b>\n\n` +
          `ID: <code>${u.user_id}</code>\n` +
          `姓名: ${esc(name(u))}\n` +
          `用户名: ${u.username ? '@' + esc(u.username) : '无'}\n` +
          `状态: ${u.is_blocked ? '⛔封禁' : '✅正常'}\n` +
          (u.is_blocked ? `原因: ${esc(u.block_reason || '无')}\n` : '') +
          `注册: ${u.created_at}`,
        kb: [
          ...userCardKb(uid, u),
          [{ text: '🔙 收起', callback_data: `refresh:${uid}` }], // FIX: single row, not [[...]]
        ],
      });
      await tg.answerCb({ id: q.id });
      return;
    }

    // ── Admin: refresh ──
    if (data.startsWith('refresh:')) {
      const uid = parseInt(data.slice(8), 10);
      await tg.editKb({ chatId, msgId, kb: userCardKb(uid, await db.getUser(uid)) });
      await tg.answerCb({ id: q.id, text: '已刷新' });
      return;
    }

    // ── Admin: message log ──
    if (data.startsWith('msglog:')) {
      const [, uid, pg] = data.split(':');
      const page  = parseInt(pg || '1', 10);
      const ps    = 8;
      const msgs  = await db.getMsgs(parseInt(uid, 10), ps, (page - 1) * ps);
      if (!msgs.length) {
        await tg.answerCb({ id: q.id, text: '暂无记录' });
        return;
      }
      const lines = msgs
        .map(m =>
          `[${m.created_at.slice(0, 16)}] ${m.direction === 'incoming' ? '→' : '←'}: ` +
          esc((m.content || '').slice(0, 40)),
        )
        .join('\n');
      const nav = [];
      if (page > 1)          nav.push({ text: '◀', callback_data: `msglog:${uid}:${page - 1}` });
      if (msgs.length === ps) nav.push({ text: '▶', callback_data: `msglog:${uid}:${page + 1}` });
      await tg.editText({
        chatId, msgId,
        text: `📨 <b>消息记录(第${page}页)</b>\n\n<code>${lines}</code>`,
        kb: [nav, [{ text: '🔙 返回', callback_data: `userinfo:${uid}` }]],
      });
      await tg.answerCb({ id: q.id });
      return;
    }

    // ── Admin panel callbacks ──
    if (data.startsWith('admin:')) {
      await handleAdminCb(q, data.slice(6), { tg, db, settings, chatId, msgId });
      return;
    }

    await tg.answerCb({ id: q.id });
  } catch (e) {
    console.error('handleCb error:', e);
    await tg.answerCb({ id: q.id }).catch(() => {});
  }
}

// ── Admin panel callback handler ─────────────────────────────────────────────

async function handleAdminCb(q, action, { tg, db, settings, chatId, msgId }) {
  try {
    const toggle = async (key, label) => {
      const cur = settings[key] === 'true';
      await db.setSetting(key, cur ? 'false' : 'true');
      const ns = await db.getAllSettings();
      await tg.editKb({ chatId, msgId, kb: adminPanelKb(ns) });
      await tg.answerCb({ id: q.id, text: `${label}已${cur ? '关闭' : '开启'}` });
    };

    if (action === 'toggle_verify')     return toggle('VERIFICATION_ENABLED', '人机验证');
    if (action === 'toggle_autounblock') return toggle('AUTO_UNBLOCK_ENABLED', '自动解封');

    if (action === 'stats') {
      const s = await db.getStats();
      await tg.editText({
        chatId, msgId,
        text:
          `📊 <b>统计</b>\n\n` +
          `👥 总用户：${s.totalUsers}\n⛔ 封禁：${s.blockedUsers}\n` +
          `💬 总消息：${s.totalMessages}\n📅 今日：${s.todayMessages}`,
        kb: [[{ text: '🔙 返回', callback_data: 'admin:back' }]],
      });
    } else if (action === 'back') {
      const s  = await db.getAllSettings();
      const st = await db.getStats();
      await tg.editText({
        chatId, msgId,
        text:
          `🤖 <b>管理员控制台</b>\n\n` +
          `👥 总用户：${st.totalUsers}  ⛔ 封禁：${st.blockedUsers}`,
        kb: adminPanelKb(s),
      });
    } else if (action.startsWith('blacklist:')) {
      const page = parseInt(action.split(':')[1] || '1', 10);
      const ps   = 8;
      const { users, total } = await db.getBlockedUsers(page, ps);
      const tp    = Math.ceil(total / ps) || 1;
      const lines = users
        .map(u => `• <code>${u.user_id}</code> ${esc(name(u))} - ${esc(u.block_reason || '无')}`)
        .join('\n') || '暂无';
      const nav = [];
      if (page > 1)  nav.push({ text: '◀', callback_data: `admin:blacklist:${page - 1}` });
      if (page < tp) nav.push({ text: '▶', callback_data: `admin:blacklist:${page + 1}` });
      await tg.editText({
        chatId, msgId,
        text: `🚫 <b>黑名单(${total}人 第${page}/${tp}页)</b>\n\n${lines}`,
        kb: [nav, [{ text: '🔙 返回', callback_data: 'admin:back' }]],
      });
    } else if (action.startsWith('users:')) {
      const page = parseInt(action.split(':')[1] || '1', 10);
      const ps   = 8;
      const { users, total } = await db.getAllUsers(page, ps);
      const tp    = Math.ceil(total / ps) || 1;
      const lines = users
        .map(u => `• <code>${u.user_id}</code> ${esc(name(u))} ${u.is_blocked ? '⛔' : '✅'}`)
        .join('\n') || '暂无';
      const nav = [];
      if (page > 1)  nav.push({ text: '◀', callback_data: `admin:users:${page - 1}` });
      if (page < tp) nav.push({ text: '▶', callback_data: `admin:users:${page + 1}` });
      await tg.editText({
        chatId, msgId,
        text: `👥 <b>用户列表(${total}人 第${page}/${tp}页)</b>\n\n${lines}`,
        kb: [nav, [{ text: '🔙 返回', callback_data: 'admin:back' }]],
      });
    }

    await tg.answerCb({ id: q.id });
  } catch (e) {
    console.error('handleAdminCb error:', e);
  }
}
