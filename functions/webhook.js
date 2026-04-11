// functions/webhook.js
import { DB } from './_shared/db.js';
import { processUpdate } from './_shared/bot.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    if (!env.KV) return new Response('KV 未绑定', { status: 500 });

    const db = new DB(env.KV, env.D1 || null);
    await db.ensureDefaultAdmin();

    const secret   = await db.getSetting('WEBHOOK_SECRET');
    const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret && received !== secret) return new Response('Unauthorized', { status: 401 });

    let update;
    try { update = await request.json(); }
    catch { return new Response('Bad JSON', { status: 400 }); }

    const baseUrl = new URL(request.url).origin;
    const ctx     = { _db: db, KV: env.KV, baseUrl };

    waitUntil(processUpdate(update, ctx).catch(e => console.error('processUpdate:', e)));
    return new Response('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Internal Server Error', { status: 500 });
  }
}
