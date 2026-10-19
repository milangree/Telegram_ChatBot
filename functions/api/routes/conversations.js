// functions/api/routes/conversations.js
// 对话记录路由
import { TG } from '../../_shared/tg.js';
import { j, err } from '../../_shared/api-utils.js';
import { logError } from '../../_shared/error-handler.js';

/**
 * 处理对话记录路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleConversationRoutes(path, request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  const url = new URL(request.url);

  // 对话列表
  if (path === '/conversations' && request.method === 'GET') {
    const since = String(url.searchParams.get('since') || '').trim();
    const items = since ? await db.getRecentConvsSince(since, 50) : await db.getRecentConvs(50);
    return j({
      items,
      mode: since ? 'delta' : 'full',
      serverTime: new Date().toISOString(),
    });
  }

  const convMatch = path.match(/^\/conversations\/(\d+)$/);
  if (!convMatch) return null;

  const uid = parseInt(convMatch[1], 10);

  // 获取对话详情
  if (request.method === 'GET') {
    const since = String(url.searchParams.get('since') || '').trim();
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const [user, messages] = await Promise.all([
      db.getUser(uid),
      since ? db.getMsgsSince(uid, since, 50) : db.getMsgs(uid, 50, (page - 1) * 50),
    ]);
    return j({
      user,
      messages,
      mode: since ? 'delta' : 'full',
      serverTime: new Date().toISOString(),
    });
  }

  // 删除对话
  if (request.method === 'DELETE') {
    try {
      const body = await request.json().catch(() => ({}));

      await db.deleteUserMsgs(uid);

      const isWl = await db.isWhitelisted(uid);
      if (!isWl) await db.setUserVerified(uid, false);

      if (body.closeTopic !== false) {
        const settings = await db.getAllSettings();
        const botToken = settings.BOT_TOKEN;
        const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
        const user = await db.getUser(uid);
        if (botToken && groupId && user?.thread_id) {
          const tg = new TG(botToken);
          await tg.deleteForumTopic({ chatId: groupId, threadId: user.thread_id })
            .catch(() => tg.closeForumTopic({ chatId: groupId, threadId: user.thread_id }));
          await db.clearUserThread(uid);
        }
      }

      return j({ ok: true, reVerifyRequired: !(await db.isWhitelisted(uid)) });
    } catch (e) {
      console.error('[API Error] conversations.deleteFailed:', e.message);
      return err(t('conversations.deleteFailed'), 500);
    }
  }

  // 发送消息
  if (request.method === 'POST') {
    return handleSendMessage(uid, request, ctx);
  }

  return null;
}

async function handleSendMessage(uid, request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;

  try {
    if (!Number.isFinite(uid) || uid <= 0) return err(t('common.missingParams'));

    const contentType = String(request.headers.get('content-type') || '').toLowerCase();
    let kind = 'text';
    let text = '';
    let caption = '';
    let fileName = '';
    let mimeType = '';
    let fileBytes = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      kind = String(form.get('kind') || form.get('type') || 'document').toLowerCase();
      text = String(form.get('text') || form.get('message') || '').trim();
      caption = String(form.get('caption') || text || '').trim();
      const file = form.get('file');
      if (file && typeof file.arrayBuffer === 'function') {
        fileName = String(file.name || form.get('filename') || 'file.bin');
        mimeType = String(file.type || form.get('mime') || 'application/octet-stream');
        fileBytes = new Uint8Array(await file.arrayBuffer());
        if (!kind || kind === 'file') {
          kind = mimeType.startsWith('image/') ? 'photo' : 'document';
        }
      } else if (text) {
        kind = 'text';
      } else {
        return err(t('common.missingParams'));
      }
    } else {
      const body = await request.json().catch(() => ({}));
      kind = String(body?.kind || body?.type || 'text').toLowerCase();
      text = String(body?.text || body?.message || '').trim();
      caption = String(body?.caption || text || '').trim();
      if (kind !== 'text') {
        const b64 = String(body?.fileBase64 || body?.data || '').replace(/^data:[^;]+;base64,/, '');
        if (!b64) return err(t('common.missingParams'));
        fileName = String(body?.filename || body?.fileName || 'file.bin');
        mimeType = String(body?.mime || body?.mimeType || 'application/octet-stream');
        const bin = atob(b64);
        fileBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) fileBytes[i] = bin.charCodeAt(i);
        if (kind === 'file') kind = mimeType.startsWith('image/') ? 'photo' : 'document';
      } else if (!text) {
        return err(t('common.missingParams'));
      }
    }

    if (fileBytes && fileBytes.byteLength > 20 * 1024 * 1024) {
      return err(t('conversations.fileTooLarge') || '文件过大（上限 20MB）', 400);
    }

    const settings = await db.getAllSettings();
    const botToken = settings.BOT_TOKEN;
    if (!botToken) return err(t('settings.botTokenRequired') || t('common.missingParams'), 400);
    const tg = new TG(botToken);

    let sendResult = null;
    let messageType = 'text';
    let storedContent = text;

    if (kind === 'text') {
      sendResult = await tg.sendMsg({ chatId: uid, text });
      messageType = 'text';
      storedContent = text;
    } else {
      const blob = new Blob([fileBytes], { type: mimeType || 'application/octet-stream' });
      const mediaKind = kind === 'photo' ? 'photo' : 'document';
      sendResult = await tg.sendMediaUpload({
        kind: mediaKind,
        chatId: uid,
        blob,
        filename: fileName || (mediaKind === 'photo' ? 'photo.jpg' : 'file.bin'),
        caption: caption || undefined,
      });
      messageType = mediaKind;
      storedContent = caption || fileName || (mediaKind === 'photo' ? '[photo]' : '[document]');
    }

    if (!sendResult?.ok) {
      console.error('[API] send to user failed:', sendResult?.description || sendResult);
      return err(t('conversations.sendFailed') || '发送失败', 502);
    }

    const tgMsgId = sendResult?.result?.message_id;
    let fileIdStored = '';
    if (kind !== 'text' && sendResult?.result) {
      const r = sendResult.result;
      if (Array.isArray(r.photo) && r.photo.length) {
        fileIdStored = r.photo[r.photo.length - 1]?.file_id || '';
      } else if (r.document?.file_id) {
        fileIdStored = r.document.file_id;
      } else if (r.sticker?.file_id) {
        fileIdStored = r.sticker.file_id;
      } else if (r.animation?.file_id) {
        fileIdStored = r.animation.file_id;
      } else if (r.video?.file_id) {
        fileIdStored = r.video.file_id;
      }
    }
    if (fileIdStored) {
      storedContent = caption ? `${fileIdStored}\n${caption}` : fileIdStored;
    }

    await db.addMsg({
      userId: uid,
      direction: 'outgoing',
      content: storedContent,
      messageType,
      telegramMessageId: tgMsgId,
    });

    return j({
      ok: true,
      message: {
        id: `${Date.now()}_web`,
        user_id: uid,
        direction: 'outgoing',
        content: storedContent,
        message_type: messageType,
        telegram_message_id: tgMsgId,
        created_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('[API Error] conversations.sendFailed:', e?.message || e);
    return err(t('conversations.sendFailed') || '发送失败', 500);
  }
}
