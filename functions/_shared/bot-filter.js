// functions/_shared/bot-filter.js
// 消息过滤 CRUD
import {
  findMatchedMessageFilterRule,
  normalizeMessageFilterRule,
  parseMessageFilterRules,
  serializeMessageFilterRules,
} from '../../shared/message-filters.js';

function getMessageFilterRules(settings) {
  return parseMessageFilterRules(settings?.MESSAGE_FILTER_RULES);
}

function findBlockedRuleForMessage(settings, message) {
  const rules = getMessageFilterRules(settings);
  if (!rules.length) return null;
  return findMatchedMessageFilterRule(rules, message);
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

export {
  getMessageFilterRules,
  findBlockedRuleForMessage,
  parseMessageFilterInput,
  parseMessageFilterRules,
  saveMessageFilterRules,
  addMessageFilterRule,
  removeMessageFilterRule,
  getAdminFilterInputKey,
  setAdminFilterInput,
  getAdminFilterInput,
  clearAdminFilterInput,
};
