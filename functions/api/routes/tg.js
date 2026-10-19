// functions/api/routes/tg.js
// Telegram API 代理路由
import { TG } from '../../_shared/tg.js';
import { j, err } from '../../_shared/api-utils.js';

/**
 * 处理 Telegram 代理路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleTgRoutes(path, request, ctx) {
  const { db } = ctx;
  const t = ctx.t;

  // 消息媒体代理
  if (path === '/tg/file' && request.method === 'GET') {
    try {
      const fileId = String(new URL(request.url).searchParams.get('file_id') || new URL(request.url).searchParams.get('id') || '').trim();
      if (!fileId) return new Response('', { status: 400 });
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return new Response('', { status: 404 });
      const tg = new TG(botToken);
      const fRes = await tg.getFile({ fileId });
      if (!fRes?.ok || !fRes.result?.file_path) return new Response('', { status: 404 });
      const filePath = fRes.result.file_path;
      const img = await tg.fetchFile(filePath);
      if (!img?.ok) return new Response('', { status: 404 });
      const lower = String(filePath).toLowerCase();
      const ctype = lower.endsWith('.webp') ? 'image/webp'
        : lower.endsWith('.png') ? 'image/png'
        : lower.endsWith('.gif') ? 'image/gif'
        : lower.endsWith('.tgs') ? 'application/x-tgsticker'
        : lower.endsWith('.webm') ? 'video/webm'
        : lower.endsWith('.mp4') ? 'video/mp4'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg'
        : (img.headers?.get?.('content-type') || 'application/octet-stream');
      return new Response(img.body, {
        headers: {
          'Content-Type': ctype,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return new Response('', { status: 404 });
    }
  }

  // 解析 Chat
  if (path === '/tg/resolve-chat' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err(t('tg.botTokenNotConfigured'), 400);
      const { chatId } = await request.json();
      if (!chatId) return err(t('tg.missingChatId'), 400);
      const id = typeof chatId === 'string' && /^-?\d+$/.test(chatId) ? parseInt(chatId, 10) : chatId;
      const res = await new TG(botToken).getChat(id);
      if (!res.ok) return err(t('tg.fetchFailed', { error: res.description }));
      return j({ ok: true, chat: res.result });
    } catch {
      return err(t('tg.resolveFailed'), 500);
    }
  }

  // 获取 Bot 信息
  if (path === '/tg/me' && request.method === 'GET') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err(t('tg.botTokenNotConfigured'), 400);
      const res = await new TG(botToken).getMe();
      if (!res.ok) return err(t('tg.fetchFailed', { error: res.description }));
      return j({ ok: true, bot: res.result });
    } catch {
      return err(t('tg.getFailed'), 500);
    }
  }

  return null;
}
