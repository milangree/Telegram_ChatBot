// functions/_shared/bot-callback.js
// 回调处理器
import { name, esc } from './tg.js';
import {
  parseAdminIds, isProtectedAdminUid, canUserAppeal,
  editUserText, withUserLock, shouldProcessMessageOnce,
  fmtMsgTime, fmtUtc8, rowsN, parseBoundedInt,
  getInlineKbMsgDeleteSeconds, getAdminNumericFieldConfig,
  ADMIN_NUMERIC_INPUT_FIELDS,
  setAdminNumericInput, clearAdminNumericInput, getAdminNumericInput,
} from './bot-utils.js';
import {
  fullUserKb, buildUserStatusText, buildUserHomeText,
  userMainMenuKb, userMenuNavRow, buildDetailText,
  buildMessageFilterManageKb, buildMessageFilterManageText,
  buildMessageFilterInputPrompt, getLocalizedMessageFilterRuleLabel,
  getMessageFilterTypeLabel, buildAdminHomeText, buildCardText,
  adminMainMenuKb, adminFeatureMenuKb, adminListMenuKb,
  buildAdminNumericPromptText,
} from './bot-keyboard.js';
import {
  addMessageFilterRule, removeMessageFilterRule,
  setAdminFilterInput, clearAdminFilterInput,
  getAdminFilterInput, parseMessageFilterRules,
} from './bot-filter.js';import { getOrCreateThread } from './bot-thread.js';
import { handleVerifyAnswer } from './bot-verify.js';
import { logError, silentCatch } from './error-handler.js';

async function handleCb(q, { tg, db, kv, settings, t, waitUntil }) {
  const { data, from: user, message } = q;
  const chatId = message.chat.id;
  const msgId = message.message_id;
  const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
  const adminIds = parseAdminIds(settings.ADMIN_IDS);
  const isAdmin = adminIds.includes(user.id);

  try {
    // ── User callbacks ────────────────────────────────────────────────────────
    if (data === 'user:msg' || data === 'user:contact') {
      await editUserText({ tg, settings, waitUntil, chatId, msgId, text: t('user.contactText'), kb: [userMenuNavRow(t)] });
      await tg.answerCb({ id: q.id, text: t('cb.sendText') });
      return;
    }
    if (data === 'user:status') {
      const u = await db.getUser(user.id);
      await editUserText({ tg, settings, waitUntil, chatId, msgId, text: buildUserStatusText(u, t), kb: [userMenuNavRow(t)] });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:help') {
      await editUserText({ tg, settings, waitUntil, chatId, msgId, text: t('user.helpText'), kb: [userMenuNavRow(t)] });
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data === 'user:back' || data === 'user:menu') {
      const s = await db.getAllSettings();
      await editUserText({ tg, settings: s, waitUntil, chatId, msgId, text: buildUserHomeText(s, t), kb: userMainMenuKb(t) });
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
      const canAppealUser = canUserAppeal(blockedUser, settings);

      if (!canAppealUser) {
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
        tg, settings, waitUntil, chatId, msgId,
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
      const u = await db.getUser(uid);
      if (!u) { await tg.answerCb({ id: q.id, text: t('admin.userNotFound') }); return; }
      const isWl = await db.isWhitelisted(uid);
      await editCard(tg, chatId, msgId, message, buildDetailText(u, isWl, t), [...fullUserKb(uid, u, t), [{ text: t('collapse'), callback_data: `rf:${uid}` }]]);
      await tg.answerCb({ id: q.id });
      return;
    }
    if (data.startsWith('rf:')) {
      const uid = parseInt(data.slice(3), 10);
      const u = await db.getUser(uid);
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
      if (page > 1) nav.push({ text: `◀ ${page - 1}`, callback_data: `ml:${uid}:${page - 1}` });
      nav.push({ text: `📄 ${page}`, callback_data: 'adm:none' });
      if (hasMore) nav.push({ text: `${page + 1} ▶`, callback_data: `ml:${uid}:${page + 1}` });
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
    logError('BOT', 'handleCb', e, { data: q?.data, userId: q?.from?.id });
    await tg.answerCb({ id: q.id }).catch(() => {});
  }
}

async function handleAdmCb(q, action, { tg, db, kv, settings, chatId, msgId, adminId, t, waitUntil }) {
  const openAdminHome = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({ tg, settings: latest, waitUntil, chatId, msgId, text: buildAdminHomeText(stats, t), kb: adminMainMenuKb(t) });
  };

  const openFeatureMenu = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({ tg, settings: latest, waitUntil, chatId, msgId, text: `${t('admin.panel', stats)}\n\n${t('admin.featureHint')}`, kb: adminFeatureMenuKb(latest, t) });
  };

  const openListMenu = async () => {
    const latest = await db.getAllSettings();
    const stats = await db.getStats();
    await editUserText({ tg, settings: latest, waitUntil, chatId, msgId, text: `${t('admin.panelCompact', stats)}\n\n${t('admin.listHint')}`, kb: adminListMenuKb(t) });
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
    const all = ['math', 'image_numeric', 'image_alphanumeric', 'turnstile', 'recaptcha', 'recaptcha_v3', 'hcaptcha'];
    const labelMap = {
      math: t('panel.cap.math'),
      image_numeric: t('panel.cap.imageNumeric'),
      image_alphanumeric: t('panel.cap.imageAlnum'),
      turnstile: t('panel.cap.turnstile'),
      recaptcha: t('panel.cap.recaptcha'),
      recaptcha_v3: t('panel.cap.recaptchaV3'),
      hcaptcha: t('panel.cap.hcaptcha'),
    };
    const cur = settings.CAPTCHA_TYPE || 'math';
    const btns = all.map(type => ({
      text: (type === cur ? '✅ ' : '') + (labelMap[type] || type),
      callback_data: `adm:ct:set:${type}`,
    }));
    const kb = rowsN(btns, 2, b => b);
    kb.push([{ text: t('cb.back'), callback_data: 'adm:cfg' }]);
    await editUserText({ tg, settings, waitUntil, chatId, msgId, text: t('panel.captchaType') + '：', kb });
    await tg.answerCb({ id: q.id }).catch(() => {});
    return;
  }

  if (action.startsWith('ct:set:')) {
    const type = action.slice('ct:set:'.length);
    const all = ['math', 'image_numeric', 'image_alphanumeric', 'turnstile', 'recaptcha', 'recaptcha_v3', 'hcaptcha'];
    if (all.includes(type)) {
      await db.setSetting('CAPTCHA_TYPE', type);
    }
    await openFeatureMenu();
    await tg.answerCb({ id: q.id, text: t('captchaTypeSwitched') });
    return;
  }

  if (action === 'mf') {
    if (kv && adminId) await clearAdminFilterInput(kv, adminId);
    const latest = await db.getAllSettings();
    await editUserText({ tg, settings: latest, waitUntil, chatId, msgId, text: buildMessageFilterManageText(latest, t), kb: buildMessageFilterManageKb(t) });
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
    await editUserText({ tg, settings, waitUntil, chatId, msgId, text: t('admin.stats', s), kb: [[
      { text: t('cb.back'), callback_data: 'adm:list' },
      { text: t('admin.close'), callback_data: 'adm:close' },
    ]] });
  } else if (action.startsWith('bk:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getBlockedUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} — ${esc(u.block_reason || t('list.none'))}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1) nav.push({ text: `◀ ${page - 1}`, callback_data: `adm:bk:${page - 1}` });
    nav.push({ text: `📄 ${page}/${tp}`, callback_data: 'adm:none' });
    if (page < tp) nav.push({ text: `${page + 1} ▶`, callback_data: `adm:bk:${page + 1}` });
    await editUserText({ tg, settings, waitUntil, chatId, msgId, text: `🚫 <b>${t('blacklistTitle', { total, page, tp })}</b>\n\n${lines}`, kb: [
      nav,
      [
        { text: t('cb.back'), callback_data: 'adm:list' },
        { text: t('admin.close'), callback_data: 'adm:close' },
      ],
    ] });
  } else if (action.startsWith('ul:')) {
    const page = parseInt(action.split(':')[1] || '1', 10), ps = 8;
    const { users, total } = await db.getAllUsers(page, ps);
    const tp = Math.ceil(total / ps) || 1;
    const lines = users.map(u => `• <code>${u.user_id}</code> ${esc(name(u))} ${u.is_blocked ? '⛔' : '✅'}`).join('\n') || t('list.none');
    const nav = [];
    if (page > 1) nav.push({ text: `◀ ${page - 1}`, callback_data: `adm:ul:${page - 1}` });
    nav.push({ text: `📄 ${page}/${tp}`, callback_data: 'adm:none' });
    if (page < tp) nav.push({ text: `${page + 1} ▶`, callback_data: `adm:ul:${page + 1}` });
    await editUserText({ tg, settings, waitUntil, chatId, msgId, text: `👥 <b>${t('userListTitle', { total, page, tp })}</b>\n\n${lines}`, kb: [
      nav,
      [
        { text: t('cb.back'), callback_data: 'adm:list' },
        { text: t('admin.close'), callback_data: 'adm:close' },
      ],
    ] });
  }
  await tg.answerCb({ id: q.id }).catch(() => {});
}

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
  const u = await db.getUser(uid);
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

export { handleCb, handleAdmCb, editCard, refreshCard };
