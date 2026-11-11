// functions/api/routes/settings.js
// 设置路由
import { TG } from '../../_shared/tg.js';
import { genToken, consumeRateLimit, verifyPw, consumeReauthAttempt } from '../../_shared/auth.js';
import { exportBusinessDataSql, importBusinessDataSql, parseBusinessSql } from '../../_shared/db-sql.js';
import { setupMiniAppMenu } from '../../_shared/bot.js';
import {
  j, err, maskSettingsForClient, isMaskedOrEmptySecret, SECRET_SETTING_KEYS,
} from '../../_shared/api-utils.js';
import { logError } from '../../_shared/error-handler.js';
import { withOperationLock } from '../../_shared/op-lock.js';
import { logAuditAction, getAuditLogs } from '../../_shared/audit-log.js';
import { verifyTOTP } from '../../_shared/totp.js';
import { BOOTSTRAP_KEY } from '../../_shared/admin-bootstrap.js';

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

  // 测试 Bot Token（高影响外部调用：限流 + 输入校验）
  if (path === '/settings/test-token' && request.method === 'POST') {
    try {
      const { token: testToken } = await request.json().catch(() => ({}));
      if (!testToken || typeof testToken !== 'string') return err(t('settings.missingToken'), 400);
      const candidate = testToken.trim();
      // Telegram Bot Token 形如 123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      if (candidate.length < 20 || candidate.length > 200 || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(candidate)) {
        return err(t('settings.invalidToken', { error: 'format' }), 400);
      }
      const rate = await consumeRateLimit(kv, 'testToken', { key: `admin:${ctx.webUser.id}` });
      if (!rate.allowed) {
        return err(t('settings.testTooMany', { seconds: rate.retryAfterSec }), 429);
      }
      const res = await new TG(candidate).getMe();
      if (!res.ok) return err(t('settings.invalidToken', { error: res.description }), 400);
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

  // 数据库切换（高影响：二次认证 + 互斥锁 + 失败回滚）
  if (path === '/settings/db/switch' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const target = String(body?.target || '');
    const sync = body?.sync !== false;
    if (!['kv', 'd1', 'hyperdrive'].includes(target)) return err(t('settings.invalidTarget'), 400);
    if (target === 'd1' && !env.D1) return err(t('settings.d1NotBound'), 400);
    if (target === 'hyperdrive' && !env.HYPERDRIVE) return err(t('settings.hyperdriveNotBound'), 400);

    const rejected = await requireReauth(request, ctx, body);
    if (rejected) return rejected;

    try {
      const result = await withOperationLock(
        { kv, name: 'db-switch', owner: `web:${ctx.webUser.id}`, ttlSec: 300 },
        async () => {
          const current = await db.getActiveDb();
          if (current === target) return { active: target, switched: false };

          // 1) 先同步数据（失败则活动后端不变，无需回滚）
          if (sync) await db.syncData(current, target);

          // 2) 写入切换标记；失败则回滚数据副本标记，保持原后端
          try {
            await db.switchDb(target);
          } catch (e) {
            // 切换标记写失败时，尽力把标记恢复为 current，避免半切换状态
            await db.switchDb(current).catch(() => {});
            throw e;
          }
          return { active: target, switched: true, previous: current };
        },
      );
      await logAuditAction(db, kv, 'data.switch', ctx.webUser.id, result);
      return j({ ok: true, active: result.active, previous: result.previous || null });
    } catch (e) {
      if (e?.code === 'OPERATION_IN_PROGRESS') return err(t('settings.operationInProgress'), 409);
      logError('API', 'settings.switchFailed', e);
      return err(t('settings.switchFailed'), 500);
    }
  }

  // 清空数据（高影响：二次认证 + 互斥锁）
  if (path === '/settings/clear-data' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const rejected = await requireReauth(request, ctx, body);
    if (rejected) return rejected;

    try {
      await withOperationLock(
        { kv, name: 'data-clear', owner: `web:${ctx.webUser.id}`, ttlSec: 300 },
        async () => {
          const botToken = await db.getSetting('BOT_TOKEN');
          if (botToken) {
            try {
              await new TG(botToken).deleteWebhook({ dropPendingUpdates: true });
            } catch (e) {
              logError('API', 'clearData.deleteWebhook', e);
            }
          }
          await db.clearAppDataPreserveWebUsers();
        },
      );
      await logAuditAction(db, kv, 'data.clear', ctx.webUser.id);
      return j({ ok: true });
    } catch (e) {
      if (e?.code === 'OPERATION_IN_PROGRESS') return err(t('settings.operationInProgress'), 409);
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


/**
 * 高风险操作的二次认证（step-up auth）。
 * 必须提供当前账号密码；若已启用 2FA，则还需提供 TOTP。
 * 返回 null 表示通过，否则返回错误 Response。
 */
async function requireReauth(request, ctx, payload = null) {
  const t = ctx.t;
  const webUser = ctx.webUser;
  const body = payload || await request.json().catch(() => ({}));
  // 注意：SQL 导入用 password 表示 AES 解密密码，二次认证统一用 accountPassword，避免字段冲突
  const password = String(body?.accountPassword ?? body?.reauthPassword ?? '');
  if (!password) return err(t('settings.reauthRequired'), 401);

  const limited = await consumeReauthAttempt(ctx.kv, webUser.id);
  if (!limited.allowed) return err(t('auth.tooManyAttempts', { seconds: limited.retryAfterSec }), 429);

  if (!await verifyPw(password, webUser.password_hash)) {
    await logAuditAction(ctx.db, ctx.kv, 'auth.reauth_failed', webUser.id, { path: new URL(request.url).pathname });
    return err(t('settings.reauthFailed'), 401);
  }
  if (webUser.totp_enabled) {
    const totp = String(body?.totp || '');
    if (!totp) return err(t('auth.totpRequired'), 401);
    if (!await verifyTOTP(totp, webUser.totp_secret, { kv: ctx.kv, userId: webUser.id })) {
      return err(t('auth.invalidTotp'), 401);
    }
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
  const body = await request.json().catch(() => ({}));
  const password = String(body?.password || '');
  const sqlPayload = body?.sql ?? body?.data ?? '';
  if (!sqlPayload || !String(sqlPayload).trim()) return err(t('common.missingParams'), 400);
  if (!password) return err(t('common.missingParams'), 400);

  // 二次认证：导入会覆盖全部业务数据，必须重新验证管理员身份
  const rejected = await requireReauth(request, ctx, body);
  if (rejected) return rejected;

  try {
    const result = await withOperationLock(
      { kv, name: 'data-import', owner: `web:${ctx.webUser.id}`, ttlSec: 900 },
      async () => {
        const active = await db.getActiveDb();

        // 1) 先解密校验，解密失败不触碰任何现有数据
        const parsedPreview = await parseBusinessSql(sqlPayload, { password });
        const hasWebUsers = Array.isArray(parsedPreview.web_users) && parsedPreview.web_users.length > 0;

        // 2) 导入成功后按目标写入；写入前的快照用于失败回滚
        const snapshot = await captureSnapshot(db, active);
        // 清空阶段会删除 bootstrap 标记，若备份含 web_users，需在写入后还原，
        // 否则名为 admin 的既有账号会被 isBootstrapAdminDisabled 永久判定为已退役。
        const bootstrapRecord = await kv.get(BOOTSTRAP_KEY).catch(() => null);

        try {
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
            snapshotStore: await db._store(),
          });
        } catch (e) {
          // 回滚：尽量恢复导入前的数据，避免留下被清空的库
          await restoreSnapshot(db, active, snapshot).catch((re) => {
            logError('API', 'sqlImport.rollbackFailed', re, { active });
          });
          throw e;
        }

        if (bootstrapRecord) {
          await kv.put(BOOTSTRAP_KEY, bootstrapRecord).catch(() => {});
        }

        if (db._d1 && active !== 'd1') {
          await db.syncData(active, 'd1');
        }
        if (db._hyperdrive && active !== 'hyperdrive') {
          await db.syncData(active, 'hyperdrive');
        }

        return { active, hasWebUsers };
      },
    );

    await logAuditAction(db, kv, 'data.import', ctx.webUser.id, result);
    return j({ ok: true, active: result.active, restoredWebUsers: result.hasWebUsers });
  } catch (e) {
    if (e?.code === 'OPERATION_IN_PROGRESS') return err(t('settings.operationInProgress'), 409);
    logError('API', 'sqlImport', e);
    return err(t('settings.sqlImportFailed'), 500);
  }
}

/**
 * 导入前快照：复用导出逻辑生成加密备份，失败时可用同一路径完整回滚。
 * 返回 { payload, password } 或 null（快照失败时不阻塞导入，只记录告警）。
 */
async function captureSnapshot(db, active) {
  try {
    const password = genToken(32);
    const store = active === 'hyperdrive' ? db._hyperdrive : (active === 'd1' ? db._d1 : db._kv);
    const payload = await exportBusinessDataSql(store, active, {
      password,
      includeSecrets: true,
      includeWebUsers: true,
      secretKeys: SECRET_SETTING_KEYS,
    });
    return { payload, password };
  } catch (e) {
    logError('API', 'snapshot.capture', e, { active }, 'warn');
    return null;
  }
}

/** 用加密快照回滚：与导入共用同一恢复路径，避免字段遗漏。 */
async function restoreSnapshot(db, active, snapshot) {
  if (!snapshot?.payload || !snapshot?.password) return;
  await importBusinessDataSql({
    sqlText: snapshot.payload,
    target: active,
    kvStore: db._kv,
    d1Store: db._d1,
    hyperdriveStore: db._hyperdrive,
    password: snapshot.password,
    clearFn: () => db.clearAppDataIncludingWebUsers(),
    snapshotStore: await db._store(),
  });
}

function normalizeBotLocale(input) {
  const v = String(input || '').toLowerCase();
  if (v === 'zh' || v === 'zh-cn' || v === 'zh_hans') return 'zh-hans';
  if (v === 'zh-tw' || v === 'zh-hk' || v === 'zh_hant') return 'zh-hant';
  return ['zh-hans', 'zh-hant', 'en'].includes(v) ? v : 'zh-hans';
}
