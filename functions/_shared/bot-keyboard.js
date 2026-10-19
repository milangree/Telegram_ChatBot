// functions/_shared/bot-keyboard.js
// Bot 键盘与文本构建
import { esc, name } from './tg.js';
import { createBotT } from './bot-i18n.js';
import {
  rowsN,
  getInlineKbMsgDeleteSeconds,
  getAdminNumericFieldConfig,
  parseAdminIds,
  fmtUtc8,
} from './bot-utils.js';
import {
  findMatchedMessageFilterRule,
  normalizeMessageFilterRule,
  parseMessageFilterRules,
} from '../../shared/message-filters.js';

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
  };
  const capLabel = capLabelMap[s.CAPTCHA_TYPE] || t('panel.cap.math');
  const inlineKbDeleteSec = getInlineKbMsgDeleteSeconds(s);
  const filterCount = parseMessageFilterRules(s?.MESSAGE_FILTER_RULES).length;
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

function buildCardText(user, u, t) {
  return `👤 <b>${t('card.userInfo')}</b>\n\n` +
    `${t('card.name')}：${esc(name(user))}\n` +
    `${t('card.username')}：${user.username ? '@' + esc(user.username) : t('list.none')}\n` +
    `${t('card.id')}：<code>${user.id ?? user.user_id}</code>\n` +
    `${t('card.language')}：${user.language_code || t('list.none')}\n` +
    `${t('card.firstContact')}：${fmtUtc8(u?.created_at, t)}\n` +
    `${t('card.status')}：${u?.is_blocked ? t('status.blocked') : (u?.is_verified ? t('status.verified') : t('status.unverified'))}`;
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

function getMessageFilterTypeLabel(type, t) {
  return {
    text: t('filter.type.text'),
    regex: t('filter.type.regex'),
  }[type] || type;
}

function getLocalizedMessageFilterRuleLabel(rule, t) {
  const normalized = normalizeMessageFilterRule(rule);
  return `${getMessageFilterTypeLabel(normalized.type, t)}: ${normalized.value}`;
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

function buildMessageFilterListText(settings, t) {
  const rules = parseMessageFilterRules(settings?.MESSAGE_FILTER_RULES);
  if (!rules.length) return t('filter.empty');

  const lines = rules.map((rule, index) => {
    const normalized = normalizeMessageFilterRule(rule);
    return `${index + 1}. <b>${esc(getMessageFilterTypeLabel(normalized.type, t))}</b>\n<code>${esc(normalized.id)}</code>\n${esc(normalized.value)}`;
  });
  return `${t('filter.title')}\n\n${lines.join('\n\n')}`;
}

function buildMessageFilterManageText(settings, t) {
  return `${buildMessageFilterListText(settings, t)}\n\n${t('filter.help')}\n${t('filter.manageHint')}`;
}

function buildMessageFilterInputPrompt(action, type, t) {
  if (action === 'remove') return t('filter.promptRemove');
  if (type === 'regex') return t('filter.promptRegex');
  return t('filter.promptText');
}

function buildAdminNumericPromptText(t, cfg) {
  const label = t(cfg.labelKey);
  const unit = cfg.unit || '';
  return t('admin.numericPrompt', { label, min: cfg.min, max: cfg.max, unit });
}

export {
  fullUserKb,
  adminFeatureMenuKb,
  adminListMenuKb,
  adminMainMenuKb,
  buildAdminHomeText,
  buildUserHomeText,
  buildUserStatusText,
  userMenuNavRow,
  userMainMenuKb,
  buildCardText,
  buildDetailText,
  getMessageFilterTypeLabel,
  getLocalizedMessageFilterRuleLabel,
  buildMessageBlockedText,
  buildMessageFilterManageKb,
  buildMessageFilterListText,
  buildMessageFilterManageText,
  buildMessageFilterInputPrompt,
  buildAdminNumericPromptText,
};
