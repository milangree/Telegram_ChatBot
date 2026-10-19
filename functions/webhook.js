// functions/webhook.js
import { DB } from './_shared/db.js';
import { ensureAdminInitializedOnce } from './_shared/admin-bootstrap.js';
import { processUpdate } from './_shared/bot.js';
import { timingSafeEqualStr } from './_shared/auth.js';
import { createT, normalizeLocale } from '../shared/i18n.js';
import { logError, silentCatch } from './_shared/error-handler.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    const earlyT = createT('zh-hans');
    if (!env.KV) return new Response(earlyT('webhook.kvNotBound'), { status: 500 });

    const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null);

    const botLocale = normalizeLocale(await db.getSetting('BOT_LOCALE'));
    const t = createT(botLocale);

    const secret = String(await db.getSetting('WEBHOOK_SECRET') || '').trim();
    const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (!secret) {
      logError('WEBHOOK', 'secret', new Error('webhook secret not configured'));
      return new Response(t('webhook.unauthorized'), { status: 503 });
    }
    if (!timingSafeEqualStr(received, secret)) {
      logError('WEBHOOK', 'secret', new Error('webhook secret mismatch'));
      return new Response(t('webhook.unauthorized'), { status: 401 });
    }

    await db.autoRepair();
    await ensureAdminInitializedOnce({ db, kv: env.KV, env });

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response(t('webhook.badJson'), { status: 400 });
    }

    const updateType = update.message ? 'message' : update.callback_query ? 'callback_query' : 'other';
    const userId = update.message?.from?.id || update.callback_query?.from?.id || '?';
    console.log(`[webhook] ${updateType} from user ${userId}`);

    const baseUrl = new URL(request.url).origin;
    const ctx = { _db: db, KV: env.KV, baseUrl, waitUntil };

    silentCatch(processUpdate(update, ctx), 'WEBHOOK', 'processUpdate', { userId, updateType });
    return new Response(t('webhook.ok'));
  } catch (e) {
    logError('WEBHOOK', 'handler', e);
    return new Response(createT('zh-hans')('webhook.internalServerError'), { status: 500 });
  }
}
