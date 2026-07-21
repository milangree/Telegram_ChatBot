// functions/webhook.js
import { DB } from './_shared/db.js';
import { ensureAdminInitializedOnce } from './_shared/admin-bootstrap.js';
import { processUpdate } from './_shared/bot.js';
import { createT, normalizeLocale } from '../shared/i18n.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    const earlyT = createT('zh-hans');
    if (!env.KV) return new Response(earlyT('webhook.kvNotBound'), { status: 500 });

    const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null);

    // 先读取 webhook secret，校验不通过不触发昂贵的初始化
    const botLocale = normalizeLocale(await db.getSetting('BOT_LOCALE'));
    const t = createT(botLocale);

    const secret = String(await db.getSetting('WEBHOOK_SECRET') || '').trim();
    const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    // 未配置 secret 时拒绝所有 webhook，避免公网伪造 update
    if (!secret) {
      console.error('Webhook secret not configured — rejecting request');
      return new Response(t('webhook.unauthorized'), { status: 503 });
    }
    if (received !== secret) {
      console.error('Webhook secret mismatch');
      return new Response(t('webhook.unauthorized'), { status: 401 });
    }

    // Secret 校验通过后执行初始化
    await db.autoRepair();
    await ensureAdminInitializedOnce({ db, kv: env.KV, env });

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
