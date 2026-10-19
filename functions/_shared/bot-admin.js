// functions/_shared/bot-admin.js
// 管理员私聊消息处理
import { name } from './tg.js';
import {
  parseAdminIds, parseStrictInt,
  getAdminNumericInput, clearAdminNumericInput,
  getAdminNumericFieldConfig, setAdminNumericInput,
  shouldProcessMessageOnce,
} from './bot-utils.js';
import {
  buildAdminHomeText, adminMainMenuKb, fullUserKb,
  buildDetailText, buildMessageFilterManageText, buildMessageFilterManageKb,
  buildMessageFilterInputPrompt, getLocalizedMessageFilterRuleLabel,
  getMessageFilterTypeLabel, buildAdminNumericPromptText,
} from './bot-keyboard.js';
import {
  addMessageFilterRule, removeMessageFilterRule,
  parseMessageFilterInput, setAdminFilterInput,
  getAdminFilterInput, clearAdminFilterInput,
} from './bot-filter.js';
import { getOrCreateThread } from './bot-thread.js';
import { sendUserMsg } from './bot-utils.js';
import { logError } from './error-handler.js';

async function handleAdminPrivateMsg(msg, user, { tg, db, kv, settings, groupId, t, waitUntil }) {
  const protectedAdminIds = new Set(parseAdminIds(settings.ADMIN_IDS).map(Number));

  const sendPanel = async () => {
    const s = await db.getStats();
    const latest = await db.getAllSettings();
    await sendUserMsg({
      tg, settings: latest, waitUntil, chatId: user.id,
      text: buildAdminHomeText(s, t), kb: adminMainMenuKb(t),
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
      logError('BOT', 'adminFilterAdd', e, { adminId: user.id });
      await tg.sendMsg({ chatId: user.id, text: t('filter.invalid', { error: e?.message || '' }) });
      await tg.sendMsg({ chatId: user.id, text: buildMessageFilterInputPrompt(pendingFilter.action, pendingFilter.type, t) });
    }
    return;
  }

  if (msg.text?.startsWith('/')) {
    const parts = msg.text.trim().split(/\s+/);
    const cmd = parts[0].split('@')[0].slice(1).toLowerCase();
    const arg = parts[1];

    if (cmd === 'panel') { await sendPanel(); return; }
    if (cmd === 'start') { await sendPanel(); return; }
    if (cmd === 'help') {
      await tg.sendMsg({ chatId: user.id, text: t('admin.helpText') });
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
        tg, settings, waitUntil, chatId: user.id,
        text: buildDetailText(u, false, t), kb: fullUserKb(u.user_id, u, t),
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

    await tg.sendMsg({ chatId: user.id, text: t('admin.unknownCmd') });
    return;
  }

  const shouldForward = await shouldProcessMessageOnce(kv, 'admin-private-notify', msg.chat.id, msg.message_id);
  if (!shouldForward) return;

  await db.upsertUser({
    user_id: user.id, username: user.username,
    first_name: user.first_name, last_name: user.last_name, language_code: user.language_code,
  });
  const adminThreadId = await getOrCreateThread(tg, db, user, groupId, kv, t);
  if (!adminThreadId) {
    if (settings.ADMIN_NOTIFY_ENABLED === 'true') await sendPanel();
    return;
  }

  const fwdRes = await tg.copyMsg({
    chatId: groupId,
    fromChatId: msg.chat.id,
    msgId: msg.message_id,
    threadId: adminThreadId,
  });
  if (fwdRes.ok) {
    await tg.sendMsg({ chatId: user.id, text: t('admin.forwarded') });
  } else if (settings.ADMIN_NOTIFY_ENABLED === 'true') {
    await sendPanel();
  }
}

export { handleAdminPrivateMsg };
