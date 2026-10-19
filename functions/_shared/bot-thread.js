// functions/_shared/bot-thread.js
// 话题管理
import { name } from './tg.js';
import { withUserLock } from './bot-utils.js';
import { fullUserKb, buildCardText } from './bot-keyboard.js';

export async function getOrCreateThread(tg, db, user, groupId, kv, t) {
  if (user && user.user_id != null && user.id == null) {
    user = { ...user, id: user.user_id };
  }
  if (!user || user.id == null) {
    console.error('getOrCreateThread: invalid user', user?.id, user?.user_id);
    return null;
  }

  const existing = await db.getUser(user.id);
  if (existing?.thread_id) return existing.thread_id;

  const result = await withUserLock(
    kv,
    `thread:${user.id}`,
    async () => {
      const u2 = await db.getUser(user.id);
      if (u2?.thread_id) return u2.thread_id;

      const baseTopicName = name(user) || t('thread.userTopic', { id: user.id });
      const topicName = `${baseTopicName} [${user.id}]`.slice(0, 128);
      const res = await tg.createTopic({ chatId: groupId, name: topicName });
      if (!res.ok) { console.error('createTopic failed:', res); return null; }
      const tid = res.result.message_thread_id;
      await db.setUserThread(user.id, tid);
      await sendCard(tg, db, user, groupId, tid, t);
      return tid;
    },
    { ttlSeconds: 30, retries: 5, waitMs: 200 },
  );

  if (!result.acquired) {
    const fallback = await db.getUser(user.id);
    return fallback?.thread_id || null;
  }

  return result.value;
}

async function sendCard(tg, db, user, groupId, tid, t) {
  const u = await db.getUser(user.id);
  const kb = fullUserKb(user.id, u, t);
  const text = buildCardText(user, u, t);

  const pinCardMessage = async (msgId) => {
    if (!msgId) return;
    await tg.pinChatMessage({ chatId: groupId, msgId, disableNotification: true }).catch((e) => {
      console.error('pin topic card failed:', e);
    });
  };

  try {
    const photos = await tg.getUserProfilePhotos({ userId: user.id, limit: 1 });
    if (photos.ok && photos.result.total_count > 0) {
      const fileId = photos.result.photos[0][0].file_id;
      const r = await tg.sendPhoto({ chatId: groupId, fileId, caption: text, threadId: tid, kb });
      if (r.ok) {
        await pinCardMessage(r.result?.message_id);
        return;
      }
    }
  } catch {}

  const r = await tg.sendMsg({ chatId: groupId, text, threadId: tid, kb });
  if (r?.ok) await pinCardMessage(r.result?.message_id);
}

async function sendToUserThreadOrAdminDm({ tg, db, settings, waitUntil, groupId, adminIds, userId, text, kb }) {
  const u = await db.getUser(userId);
  const tid = u?.thread_id;

  if (groupId && !isNaN(groupId) && tid) {
    const r = await tg.sendMsg({ chatId: groupId, threadId: tid, text, kb }).catch(() => null);
    if (r?.ok) return { sent: true, via: 'thread' };
  }

  let dmCount = 0;
  for (const aid of adminIds) {
    const r = await tg.sendMsg({ chatId: aid, text, kb }).catch(() => null);
    if (r?.ok) dmCount++;
  }
  return { sent: dmCount > 0, via: dmCount > 0 ? 'admin_dm' : 'none' };
}

export { sendToUserThreadOrAdminDm };
