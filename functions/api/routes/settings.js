// functions/api/routes/settings.js
// 设置路由
import { TG } from '../../_shared/tg.js';
import { genToken } from '../../_shared/auth.js';
import { exportBusinessDataSql, importBusinessDataSql, parseBusinessSql } from '../../_shared/db-sql.js';
import { setupMiniAppMenu } from '../../_shared/bot.js';
import {
  j, err, maskSettingsForClient, isMaskedOrEmptySecret, SECRET_SETTING_KEYS,
} from '../../_shared/api-utils.js';
import { logError } from '../../_shared/error-handler.js';
import { logAuditAction, getAuditLogs } from '../../_shared/audit-log.js';

const ALLOWED_SETTINGS = [
  'BOT_TOKEN', 'FORUM_GROUP_ID', 'ADMIN_IDS',
  'VERIFICATION_ENABLED', 'VERIFICATION_TIMEOUT', 'MAX_VERIFICATION_ATTEMPTS',
  'AUTO_UNBLOCK_ENABLED',
  'INLINE_KB_MSG_DELETE_ENABLED', 'INLINE_KB_MSG_DELETE_SECONDS',
  'USER_MSG_DELETE_SECONDS',
  'CAPTCHA_TYPE', 'CAPTCHA_SITE_URL',
  'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
  'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_V3_SITE_KEY', 'RECAPTCHA_V3_SECRET_KEY', 'RECAPTCHA_V3_SCORE_THRESHOLD',
  'HCAPTCHA_SITE_KEY', 'HCAPTCHA_SECRET_KEY',
  'WELCOME_ENABLED', 'WELCOME_MESSAGE', 'BOT_COMMAND_FILTER', 'WHITELIST_ENABLED',
  'ADMIN_NOTIFY_ENABLED',
  'LOGIN_SESSION_TTL',
  'BOT_LOCALE',
  'ZALGO_FILTER_ENABLED',
  'MESSAGE_FILTER_RULES',
  'WEBHOOK_URL',
];

/**
 * 处理设置路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleSettingsRoutes(path, request, ctx) {
  const { db, kv, env } = ctx;
  const t = ctx.t;

  // 获取设置（脱敏）
  if (path === '/settings' && request.method === 'GET') {
    return j(maskSettingsForClient(await db.getAllSettings()));
  }

  // 保存设置
  if (path === '/settings' && request.method === 'PUT') {
    return handleSaveSettings(request, ctx);
  }

  // 设置 Webhook
  if (path === '/settings/webhook' && request.method === 'POST') {
    return handleSetupWebhook(request, ctx);
  }

  // 测试 Bot Token
  if (path === '/settings/test-token' && request.method === 'POST') {
    try {
      const { token: testToken } = await request.json();
      if (!testToken) return err(t('settings.missingToken'), 400);
      const res = await new TG(testToken).getMe();
      if (!res.ok) return err(t('settings.invalidToken', { error: res.description }));
      return j({ ok: true, bot: res.result });
    } catch {
      return err(t('settings.testFailed'), 500);
    }
  }

  // 数据库状态
  if (path === '/settings/db' && request.method === 'GET') {
    const active = await db.getActiveDb();
    const hasD1 = !!env.D1;
    const hasHyperdrive = !!env.HYPERDRIVE;
    return j({ active, hasD1, hasHyperdrive });
  }

  // 审计日志
  if (path === '/settings/audit-logs' && request.method === 'GET') {
    const limit = Math.min(200, parseInt(new URL(request.url).searchParams.get('limit') || '100', 10));
    const logs = await getAuditLogs(kv, limit);
    return j({ logs });
  }

  // 数据库切换
  if (path === '/settings/db/switch' && request.method === 'POST') {
    try {
      const { target, sync } = await request.json();
      if (!['kv', 'd1', 'hyperdrive'].includes(target)) return err(t('settings.invalidTarget'), 400);
      if (target === 'd1' && !env.D1) return err(t('settings.d1NotBound'), 400);
      if (target === 'hyperdrive' && !env.HYPERDRIVE) return err(t('settings.hyperdriveNotBound'), 400);

      const current = await db.getActiveDb();
      if (sync && current !== target) await db.syncData(current, target);

      await db.switchDb(target);
      return j({ ok: true, active: target });
    } catch (e) {
      console.error('[API Error] settings.switchFailed:', e.message);
      return err(t('settings.switchFailed'), 500);
    }
  }

  // 清空数据
  if (path === '/settings/clear-data' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (botToken) {
        try {
          await new TG(botToken).deleteWebhook({ dropPendingUpdates: true });
        } catch (e) {
          logError('API', 'clearData.deleteWebhook', e);
        }
      }
      await db.clearAppDataPreserveWebUsers();
      await logAuditAction(db, kv, 'data.clear', ctx.webUser.id);
      return j({ ok: true });
    } catch (e) {
      logError('API', 'clearData', e);
      return err(t('settings.clearDataFailed'), 500);
    }
  }

  // SQL 导出
  if (path === '/settings/sql/export' && request.method === 'POST') {
    return handleSqlExport(request, ctx);
  }

  // SQL 导入
  if (path === '/settings/sql/import' && request.method === 'POST') {
    return handleSqlImport(request, ctx);
  }

  return null;
}

async function handleSaveSettings(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const body = await request.json();
    const previousSettings = await db.getAllSettings();
    const previousBotToken = String(previousSettings.BOT_TOKEN || '');

    let shouldRefreshCommands = false;
    let botTokenChanged = false;
    for (const key of ALLOWED_SETTINGS) {
      if (body[key] === undefined) continue;
      if (SECRET_SETTING_KEYS.includes(key) && isMaskedOrEmptySecret(body[key])) continue;

      const value = key === 'BOT_LOCALE'
        ? normalizeBotLocale(body[key])
        : String(body[key]);
      await db.setSetting(key, value);
      if (key === 'BOT_TOKEN' || key === 'BOT_LOCALE') shouldRefreshCommands = true;
      if (key === 'BOT_TOKEN') botTokenChanged = true;
    }

    const nextBotToken = botTokenChanged
      ? String(body.BOT_TOKEN || '')
      : previousBotToken;
    if (botTokenChanged && previousBotToken && previousBotToken !== nextBotToken) {
      try {
        const webhookResult = await new TG(previousBotToken).deleteWebhook({ dropPendingUpdates: false });
        if (!webhookResult?.ok) {
          console.error('delete old webhook after bot token change failed:', webhookResult);
        }
      } catch (e) {
        console.error('delete old webhook after bot token change failed:', e);
      }
    }

    if (shouldRefreshCommands) {
      try {
        const latest = await db.getAllSettings();
        if (latest.BOT_TOKEN) {
          if (latest.WEBHOOK_URL) {
            const origin = new URL(latest.WEBHOOK_URL).origin;
            await setupMiniAppMenu(new TG(latest.BOT_TOKEN), `${origin}/miniapp/`);
          }
        }
      } catch (e) {
        logError('API', 'saveSettings.refreshCommands', e);
      }
    }

    await logAuditAction(db, kv, 'settings.save', ctx.webUser.id, { changedKeys: Object.keys(body).filter(k => ALLOWED_SETTINGS.includes(k)) });
    return j({ ok: true, settings: maskSettingsForClient(await db.getAllSettings()) });
  } catch (e) {
    logError('API', 'saveSettings', e);
    return err(t('settings.saveFailed'), 500);
  }
}

async function handleSetupWebhook(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const settings = await db.getAllSettings();
    if (!settings.BOT_TOKEN) return err(t('settings.botTokenRequired'), 400);
    const { webhookUrl } = await request.json();
    if (!webhookUrl) return err(t('settings.missingWebhookUrl'), 400);
    const tg = new TG(settings.BOT_TOKEN);
    let secret = settings.WEBHOOK_SECRET;
    if (!secret) {
      secret = genToken(32);
      await db.setSetting('WEBHOOK_SECRET', secret);
    }
    if (!settings.CAPTCHA_SITE_URL) await db.setSetting('CAPTCHA_SITE_URL', new URL(webhookUrl).origin);
    const res = await tg.setWebhook({ url: webhookUrl, secret });
    if (!res.ok) return err(t('settings.setupFailed', { error: res.description }));
    await db.setSetting('WEBHOOK_URL', webhookUrl);
    const miniAppUrl = `${new URL(webhookUrl).origin}/miniapp/`;
    await setupMiniAppMenu(tg, miniAppUrl).catch(console.error);
    return j({ ok: true, message: t('settings.webhookSetupSuccess') });
  } catch (e) {
    console.error('[API Error] settings.setupFailed:', e?.message || '');
    return err(t('settings.setupFailed'), 500);
  }
}

async function handleSqlExport(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const active = await db.getActiveDb();
    const body = await request.json().catch(() => ({}));
    const password = String(body?.password || '');
    if (!password) return err(t('common.missingParams'), 400);
    const includeSecrets = body?.includeSecrets === false || body?.includeSecrets === 0 || body?.includeSecrets === '0'
      ? false
      : true;
    const includeWebUsers = body?.includeWebUsers === false || body?.includeWebUsers === 0 || body?.includeWebUsers === '0'
      ? false
      : true;

    const binary = await exportBusinessDataSql(db, active, {
      password,
      includeSecrets,
      includeWebUsers,
      secretKeys: SECRET_SETTING_KEYS,
    });
    await logAuditAction(db, kv, 'data.export', ctx.webUser.id, { active, includeSecrets, includeWebUsers });
    const fileName = `${String(active || 'kv').toUpperCase()}_AES.db`;
    return new Response(binary, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Active-Db': active,
        'X-Export-Secrets': includeSecrets ? '1' : '0',
        'X-Export-WebUsers': includeWebUsers ? '1' : '0',
        'X-Export-Format': 'tgcb-bin-aes',
      },
    });
  } catch (e) {
    console.error('[API Error] settings.sqlExportFailed:', e.message);
    return err(t('settings.sqlExportFailed'), 500);
  }
}

async function handleSqlImport(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const body = await request.json().catch(() => ({}));
    const password = String(body?.password || '');
    const sqlPayload = body?.sql ?? body?.data ?? '';
    if (!sqlPayload || !String(sqlPayload).trim()) return err(t('common.missingParams'), 400);
    if (!password) return err(t('common.missingParams'), 400);

    const active = await db.getActiveDb();
    const snapshotStore = await db._store();

    const parsedPreview = await parseBusinessSql(sqlPayload, { password });
    const hasWebUsers = Array.isArray(parsedPreview.web_users) && parsedPreview.web_users.length > 0;

    await importBusinessDataSql({
      sqlText: sqlPayload,
      target: active,
      kvStore: db._kv,
      d1Store: db._d1,
      hyperdriveStore: db._hyperdrive,
      password,
      clearFn: () => hasWebUsers
        ? db.clearAppDataIncludingWebUsers()
        : db.clearAppDataPreserveWebUsers(),
      snapshotStore,
    });

    if (db._d1 && active !== 'd1') {
      const other = active === 'kv' ? 'd1' : 'kv';
      await db.syncData(active, other);
    }
    if (db._hyperdrive && active !== 'hyperdrive') {
      await db.syncData(active, 'hyperdrive');
    }

    await logAuditAction(db, kv, 'data.import', ctx.webUser.id, { active, hasWebUsers });
    return j({ ok: true, active, restoredWebUsers: hasWebUsers });
  } catch (e) {
    logError('API', 'sqlImport', e);
    return err(t('settings.sqlImportFailed'), 500);
  }
}

function normalizeBotLocale(input) {
  const v = String(input || '').toLowerCase();
  if (v === 'zh' || v === 'zh-cn' || v === 'zh_hans') return 'zh-hans';
  if (v === 'zh-tw' || v === 'zh-hk' || v === 'zh_hant') return 'zh-hant';
  return ['zh-hans', 'zh-hant', 'en'].includes(v) ? v : 'zh-hans';
}
