// functions/_shared/bot.js
// Bot 主入口 — 消息处理与命令注册
import { TG, esc, name, msgType, extractFileId, packMediaContent } from './tg.js';
import { createBotT, getBotCommands, normalizeBotLocale } from './bot-i18n.js';
import {
  parseAdminIds, canUserAppeal, isPrivateChatId,
  withUserLock, shouldProcessMessageOnce,
  sendUserMsg, reactSentOk, editUserText,
  getAdminNumericInput, clearAdminNumericInput,
  getAdminNumericFieldConfig,
  fmtUtc8,
} from './bot-utils.js';
import {
  buildUserHomeText, buildUserStatusText, userMainMenuKb, userMenuNavRow,
  buildMessageBlockedText, buildCardText, fullUserKb,
  buildDetailText, buildAdminHomeText, adminMainMenuKb,
  buildMessageFilterManageText, buildMessageFilterManageKb,
  buildMessageFilterInputPrompt, getLocalizedMessageFilterRuleLabel,
  getMessageFilterTypeLabel, buildAdminNumericPromptText,
} from './bot-keyboard.js';
import {
  findBlockedRuleForMessage, addMessageFilterRule, removeMessageFilterRule,
  parseMessageFilterInput, setAdminFilterInput,
  getAdminFilterInput, clearAdminFilterInput,
} from './bot-filter.js';
import { getOrCreateThread, sendToUserThreadOrAdminDm } from './bot-thread.js';
import { mkMathVerify, scheduleVerifyTimeout, handleWebAppVerify } from './bot-verify.js';
import { handleCb } from './bot-callback.js';
import { handleAdminPrivateMsg } from './bot-admin.js';
import { generateCode, generateWrongOptions } from './captcha.js';
import {
  rowsN, secureRandomInt, secureShuffle, randId,
  VERIFY_OPTION_COUNT, VERIFY_OPTION_COLUMNS,
} from './bot-utils.js';
import { logError, silentCatch } from './error-handler.js';

// ── 部署版本（用于 Mini App URL 缓存穿透）──────────────────────────────
export const DEPLOY_VERSION = (() => {
  try {
    if (typeof require === 'undefined') return 'v1';
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const idx = path.join(__dirname, '..', '..', 'dist', 'index.html');
    if (fs.existsSync(idx)) {
      const content = fs.readFileSync(idx);
      return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    }
  } catch { /* Workers / 无文件系统 */ }
  return 'v1';
})();

// ── 命令与 Mini App 菜单注册 ──────────────────────────────────────────────
export async function setupCommands(tg, locale = 'zh-hans') {
  const normalized = normalizeBotLocale(locale);
  const { userCmds, adminCmds } = getBotCommands(normalized);
  await tg.setMyCommands({ commands: userCmds });
  await tg.setMyCommands({ commands: adminCmds, scope: { type: 'all_private_chats' } });
}

export async function setupMiniAppMenu(tg, miniAppUrl, text = '面板') {
  if (!miniAppUrl || typeof miniAppUrl !== 'string') return;
  try {
    const versionedUrl = miniAppUrl.includes('?')
      ? `${miniAppUrl}&v=${DEPLOY_VERSION}`
      : `${miniAppUrl}?v=${DEPLOY_VERSION}`;
    await tg.setChatMenuButton({
      menuButton: { type: 'web_app', text, web_app: { url: versionedUrl } },
    });
  } catch {
    // 静默跳过，不影响核心流程
  }
}

// ── 入口函数 ──────────────────────────────────────────────────────────────────
export async function processUpdate(update, env) {
  if (!env?.KV) { console.error('KV not bound'); return; }
  const db = env._db;
  try {
    const settings = await db.getAllSettings();
    if (!settings.BOT_TOKEN) { console.error('BOT_TOKEN missing'); return; }
    if (!settings.FORUM_GROUP_ID) { console.error('FORUM_GROUP_ID missing'); return; }
    const locale = normalizeBotLocale(settings.BOT_LOCALE);
    const t = createBotT(locale);
    const tg = new TG(settings.BOT_TOKEN);
    const ctx = { tg, db, kv: env.KV, settings, baseUrl: env.baseUrl || '', t, waitUntil: env.waitUntil };
    if (update.message) await handleMsg(update.message, ctx);
    else if (update.callback_query) await handleCb(update.callback_query, ctx);
  } catch (e) { logError('BOT', 'processUpdate', e); }
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

  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);

  // ── 群组话题：管理员 → 用户消息转发 ─────────────────────────────────────
  if (msg.chat.id === groupId && msg.is_topic_message) {
    if (!adminIds.includes(user.id)) return;
    if (msg.text?.startsWith('/')) return;
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

    const forwardRes = await tg.copyMsg({ chatId: target.user_id, fromChatId: msg.chat.id, msgId: msg.message_id });
    if (!forwardRes?.ok) {
      console.error('admin topic forward failed:', forwardRes);
      return;
    }

    await reactSentOk({ tg, chatId: msg.chat.id, msgId: msg.message_id });

    const recordTask = db.addMsg({
      userId: target.user_id,
      direction: 'outgoing',
      content: (() => {
        const type = msgType(msg);
        const fileId = extractFileId(msg);
        if (fileId && type !== 'text') return packMediaContent(fileId, msg.caption || '');
        return msg.text || msg.caption || t('content.media');
      })(),
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
      await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: buildUserHomeText(settings, t), kb: userMainMenuKb(t) });
      return;
    }
    if (cmd === 'help') {
      await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: t('user.helpText'), kb: [userMenuNavRow(t)] });
      return;
    }
    if (cmd === 'status') {
      const u = await db.getUser(user.id);
      await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: buildUserStatusText(u, t), kb: [userMenuNavRow(t)] });
      return;
    }
    if (settings.BOT_COMMAND_FILTER === 'true') return;
  }

  // ── 封禁检查 ─────────────────────────────────────────────────────────────
  const dbUser = await db.getUser(user.id);
  if (dbUser?.is_blocked) {
    const isPermanentBlock = Boolean(dbUser.is_permanent_block);
    const canAppealUser = canUserAppeal(dbUser, settings);
    const pendingAppeal = await kv.get(`pending_appeal:${user.id}`);

    if (!canAppealUser && pendingAppeal) {
      await kv.delete(`pending_appeal:${user.id}`).catch(() => {});
    }

    if (canAppealUser && pendingAppeal && msg.text && !msg.text.startsWith('/')) {
      const appealText = msg.text.trim();
      if (appealText) {
        const who = `${name(user)} (${user.id})`;
        const text = t('appeal.title', { who: esc(who), content: esc(appealText) });
        const kb = [[
          { text: t('appeal.approve'), callback_data: `apu:${user.id}` },
          { text: t('appeal.reject'), callback_data: `apr:${user.id}` },
        ]];

        const delivery = await sendToUserThreadOrAdminDm({
          tg, db, settings, waitUntil, groupId, adminIds,
          userId: user.id, text, kb,
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
    } else if (canAppealUser) {
      await sendUserMsg({
        tg, settings, waitUntil, chatId: user.id,
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
    await sendUserMsg({ tg, settings, waitUntil, chatId: user.id, text: buildMessageBlockedText(blockedRule, t) });
    return;
  }

  // ── 白名单跳过 ───────────────────────────────────────────────────────────
  const whitelisted = settings.WHITELIST_ENABLED === 'true' && await db.isWhitelisted(user.id);

  if (!whitelisted) {
    // ── Verification ──────────────────────────────────────────────────────
    if (settings.VERIFICATION_ENABLED === 'true' && !dbUser?.is_verified) {
      const lock = await withUserLock(
        kv,
        `verify-flow:${user.id}`,
        async () => {
          const latestUser = await db.getUser(user.id);
          if (latestUser?.is_verified) return { done: true };

          const timeout = Math.max(60, parseInt(settings.VERIFICATION_TIMEOUT || '300', 10));
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

          if (captchaType === 'turnstile' || captchaType === 'recaptcha' || captchaType === 'recaptcha_v3' || captchaType === 'hcaptcha') {
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

          const captchaId = randId();
          const code = generateCode(captchaType);
          await kv.put(`captcha_render:${captchaId}`, code, { expirationTtl: timeout + 60 });
          const wrongs = generateWrongOptions(code, captchaType, VERIFY_OPTION_COUNT - 1);
          const opts = secureShuffle([code, ...wrongs]);
          const kb = rowsN(opts, VERIFY_OPTION_COLUMNS, o => ({ text: o, callback_data: `iv:${o}:${captchaId}` }));
          const typeLabel = captchaType === 'image_alphanumeric' ? t('verify.imgAlpha') : t('verify.imgNum');
          const caption = t('verify.image', { typeLabel });
          const imgUrl = `${siteUrl}/api/captcha/${captchaId}`;
          const r = await tg.sendPhoto({ chatId: user.id, url: imgUrl, caption, kb });
          if (!r.ok) {
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

  const res = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: tid });
  if (res.ok) {
    const recordTask = db.addMsg({
      userId: user.id,
      direction: 'incoming',
      content: (() => {
        const type = msgType(msg);
        const fileId = extractFileId(msg);
        if (fileId && type !== 'text') return packMediaContent(fileId, msg.caption || '');
        return msg.text || msg.caption || t('content.media');
      })(),
      messageType: msgType(msg),
      telegramMessageId: msg.message_id,
    }).catch((e) => console.error('record user msg failed:', e));
    if (waitUntil) waitUntil(recordTask);
    else await recordTask;
    await reactSentOk({ tg, chatId: msg.chat.id, msgId: msg.message_id });
    await tg.sendMsg({ chatId: user.id, text: t('sentToAdmin') });
  } else {
    console.warn('copyMsg failed (thread may be deleted), retrying with new thread:', res);
    await db.clearUserThread(user.id);
    const newTid = await getOrCreateThread(tg, db, user, groupId, kv, t);
    if (newTid) {
      const retry = await tg.copyMsg({ chatId: groupId, fromChatId: msg.chat.id, msgId: msg.message_id, threadId: newTid });
      if (retry.ok) {
        const recordTask = db.addMsg({
          userId: user.id,
          direction: 'incoming',
          content: (() => {
            const type = msgType(msg);
            const fileId = extractFileId(msg);
            if (fileId && type !== 'text') return packMediaContent(fileId, msg.caption || '');
            return msg.text || msg.caption || t('content.media');
          })(),
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
