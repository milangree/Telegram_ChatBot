// functions/webhook.js
import { DB } from './_shared/db.js';
import { processUpdate } from './_shared/bot.js';
import { createT, normalizeLocale } from '../shared/i18n.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    const earlyT = createT('zh-hans');
    if (!env.KV) return new Response(earlyT('webhook.kvNotBound'), { status: 500 });

    const db = new DB(env.KV, env.D1 || null);
    await db.autoRepair();
    await db.ensureDefaultAdmin();

    const botLocale = normalizeLocale(await db.getSetting('BOT_LOCALE'));
    const t = createT(botLocale);

    const secret = await db.getSetting('WEBHOOK_SECRET');
    const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret && received !== secret) {
      console.error('Webhook secret mismatch');
      return new Response(t('webhook.unauthorized'), { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response(t('webhook.badJson'), { status: 400 });
    }

    // Log update type so it's visible in CF Pages log viewer
    const updateType = update.message ? 'message' : update.callback_query ? 'callback_query' : 'other';
    const userId = update.message?.from?.id || update.callback_query?.from?.id || '?';
    console.log(`[webhook] ${updateType} from user ${userId}`);

    const baseUrl = new URL(request.url).origin;
    const ctx = { _db: db, KV: env.KV, baseUrl, waitUntil };

    waitUntil(processUpdate(update, ctx).catch(e => console.error('[processUpdate]', e)));
    return new Response(t('webhook.ok'));
  } catch (e) {
    console.error('[webhook error]', e);
    return new Response(createT('zh-hans')('webhook.internalServerError'), { status: 500 });
  }
}
