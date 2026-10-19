// functions/_shared/bot-verify.js
// 验证逻辑（数学题、图片验证码、Web 验证、超时）
import { generateCode, generateWrongOptions } from './captcha.js';
import { createBotT } from './bot-i18n.js';
import {
  rowsN, secureRandomInt, secureShuffle, randId,
  withUserLock, shouldProcessMessageOnce,
  VERIFY_OPTION_COUNT, VERIFY_OPTION_COLUMNS,
} from './bot-utils.js';
import { getOrCreateThread } from './bot-thread.js';
import { logError } from './error-handler.js';

/** 随机生成一道整数四则运算题（保证结果为正整数、除法整除） */
function generateMathQuestion() {
  const ops = ['+', '-', '×', '÷'];
  const op = ops[secureRandomInt(ops.length)];
  let a, b, answer;

  switch (op) {
    case '+':
      a = secureRandomInt(20) + 1;
      b = secureRandomInt(20) + 1;
      answer = a + b;
      break;
    case '-':
      answer = secureRandomInt(20) + 1;
      b = secureRandomInt(20) + 1;
      a = answer + b;
      break;
    case '×':
      a = secureRandomInt(9) + 2;
      b = secureRandomInt(9) + 2;
      answer = a * b;
      break;
    case '÷':
      b = secureRandomInt(9) + 2;
      answer = secureRandomInt(9) + 2;
      a = b * answer;
      break;
  }

  return { q: `${a} ${op} ${b}`, a: String(answer), answerNum: answer };
}

function mkMathVerify() {
  const { q, a, answerNum } = generateMathQuestion();
  const opts = new Set([answerNum]);
  let guard = 0;
  while (opts.size < VERIFY_OPTION_COUNT && guard++ < 80) {
    const c = answerNum + secureRandomInt(15) - 7;
    if (c > 0 && c !== answerNum) opts.add(c);
  }
  const arr = secureShuffle([...opts]).map(String);
  return {
    question: `<b>${q} = ?</b>`,
    answer: a,
    kb: rowsN(arr, VERIFY_OPTION_COLUMNS, n => ({ text: n, callback_data: `v:${n}` })),
  };
}

function scheduleVerifyTimeout({ waitUntil, tg, db, kv, userId, timeout, verifyMsgId }) {
  let fired = false;
  const cleanup = async () => {
    if (fired) return;
    fired = true;
    console.log('[verify_timeout] cleanup for user', userId, 'verifyMsgId:', verifyMsgId);
    const v = await db.getVerify(userId).catch(() => null);
    if (v && v.expires_at > Date.now() + 5000) return;
    const user = await db.getUser(userId).catch(() => null);
    if (user?.is_verified) return;
    if (v?.web_verify_id) await kv.delete(`webverify:${v.web_verify_id}`).catch(() => {});
    await db.delVerify(userId).catch(() => {});
    const pendingRaw = await kv.get(`pending:${userId}`).catch(() => null);
    if (pendingRaw) {
      try {
        const p = JSON.parse(pendingRaw);
        if (!p.msgId || p.msgId === verifyMsgId) {
          await kv.delete(`pending:${userId}`).catch(() => {});
        }
      } catch { await kv.delete(`pending:${userId}`).catch(() => {}); }
    }
    const msgId = verifyMsgId || v?.verify_msg_id;
    if (msgId) {
      console.log('[verify_timeout] editing message', msgId, 'for user', userId);
      await tg.editText({ chatId: userId, msgId, text: '⏳ 验证已超时，请重新发送消息以发起新的验证。', kb: [] }).catch(e => {
        logError('BOT', 'verifyTimeout.edit', e, { userId, msgId });
      });
    } else {
      console.warn('[verify_timeout] no verifyMsgId for user', userId);
    }
  };
  setTimeout(cleanup, timeout * 1000 + 2000);
  if (waitUntil) {
    const task = (async () => {
      await new Promise(r => setTimeout(r, timeout * 1000 + 2000));
      await cleanup();
    })();
    waitUntil(task);
  }
}

async function handleVerifyAnswer(q, tg, db, kv, user, chatId, msgId, settings, groupId, sel, captchaId, t) {
  const locked = await withUserLock(
    kv,
    `verify-answer:${user.id}`,
    async () => {
      const v = await db.getVerify(user.id);
      if (!v || v.expires_at < Date.now()) {
        if (v?.web_verify_id) await kv.delete(`webverify:${v.web_verify_id}`).catch(() => {});
        await db.delVerify(user.id);
        await kv.delete(`pending:${user.id}`).catch(() => {});
        await tg.answerCb({ id: q.id, text: t('verify.expired'), alert: true });
        return;
      }
      if (captchaId && v.captcha_id !== captchaId) {
        await tg.answerCb({ id: q.id, text: t('verify.mismatch'), alert: true });
        return;
      }

      const effectiveGroupId = groupId || parseInt(settings.FORUM_GROUP_ID, 10) || 0;
      const maxAtt = parseInt(settings.MAX_VERIFICATION_ATTEMPTS || '3', 10);
      if (sel === v.answer) {
        await db.setUserVerified(user.id, true);
        await db.delVerify(user.id);
        if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
        const delResult = await tg.deleteMsg({ chatId, msgId }).catch(() => null);
        if (!delResult?.ok) {
          const editResult = await tg.editText({ chatId, msgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
          if (!editResult?.ok) {
            await tg.editCaption({ chatId, msgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
          }
        }
        await tg.sendMsg({ chatId, text: t('verify.success') }).catch(() => {});

        const pr = await kv.get(`pending:${user.id}`);
        if (pr && effectiveGroupId) {
          await kv.delete(`pending:${user.id}`);
          const p = JSON.parse(pr);
          const tid = await getOrCreateThread(tg, db, user, effectiveGroupId, kv, t);
          if (tid && p.msgId) {
            const shouldForward = await shouldProcessMessageOnce(kv, 'verified-user-forward', user.id, p.msgId);
            if (shouldForward) {
              await tg.copyMsg({ chatId: effectiveGroupId, fromChatId: chatId, msgId: p.msgId, threadId: tid });
              await db.addMsg({ userId: user.id, direction: 'incoming', content: t('content.verifiedForwarded') });
              await tg.sendMsg({ chatId: user.id, text: t('sentAfterVerify') });
            }
          }
        }
        await tg.answerCb({ id: q.id }).catch(() => {});
      } else {
        await db.incVerify(user.id);
        const att = v.attempts + 1;
        if (att >= maxAtt) {
          await db.delVerify(user.id);
          await kv.delete(`pending:${user.id}`).catch(() => {});
          if (captchaId) await kv.delete(`captcha_render:${captchaId}`);
          await tg.editText({ chatId, msgId, text: t('verify.tooMany'), kb: [] }).catch(() => {});
          await tg.answerCb({ id: q.id }).catch(() => {});
        } else {
          await tg.answerCb({ id: q.id, text: t('verify.wrongLeft', { left: maxAtt - att }), alert: true });
        }
      }
    },
    { ttlSeconds: 60, retries: 4, waitMs: 80 },
  );

  if (!locked.acquired) {
    await tg.answerCb({ id: q.id, text: t('verify.completeFirst') }).catch(() => {});
  }
}

async function handleWebAppVerify(msg, user, { tg, db, kv, settings, t, waitUntil }) {
  const data = msg.web_app_data?.data;
  if (!data) { logError('BOT', 'webAppVerify', new Error('no data'), { userId: user.id }); return; }

  let payload;
  try { payload = JSON.parse(data); } catch { logError('BOT', 'webAppVerify', new Error('invalid JSON'), { userId: user.id }); return; }
  if (payload.type !== 'web_verify_ok') { logError('BOT', 'webAppVerify', new Error('unknown type'), { userId: user.id, type: payload.type }); return; }

  console.log('[web_app_verify] processing user', user.id);

  const locked = await withUserLock(kv, `verify-answer:${user.id}`, async () => {
    const dbUser = await db.getUser(user.id).catch(() => null);
    const v = await db.getVerify(user.id).catch(() => null);
    if (!v && dbUser?.is_verified) {
      console.log('[web_app_verify] already processed, skipping');
      return;
    }

    if (!v || v.expires_at < Date.now()) {
      console.warn('[web_app_verify] verification expired for user', user.id);
      await db.delVerify(user.id).catch(() => {});
      await tg.sendMsg({ chatId: user.id, text: t('verify.expired') }).catch(() => {});
      return;
    }

    if (!dbUser?.is_verified) {
      console.warn('[web_app_verify] user not server-verified yet, ignoring client ok signal', user.id);
      await tg.sendMsg({
        chatId: user.id,
        text: t('verify.needCompleteWeb') || t('verify.expired'),
      }).catch(() => {});
      return;
    }

    let verifyMsgId = v.verify_msg_id;

    const webVerifyId = v?.web_verify_id || payload?.webVerifyId;
    if (webVerifyId) {
      const wvRaw = await kv.get(`webverify:${webVerifyId}`).catch(() => null);
      if (wvRaw) {
        try {
          const wv = JSON.parse(wvRaw);
          if (wv.userId && String(wv.userId) !== String(user.id)) {
            console.warn('[web_app_verify] webVerifyId user mismatch', { webVerifyId, userId: user.id, owner: wv.userId });
            return;
          }
          if (wv.verifyMsgId) verifyMsgId = wv.verifyMsgId;
        } catch {}
      }
      await kv.delete(`webverify:${webVerifyId}`).catch(() => {});
    }

    console.log('[web_app_verify] verifyMsgId:', verifyMsgId);

    await db.delVerify(user.id).catch(() => {});
    const pendingRaw = await kv.get(`pending:${user.id}`).catch(() => null);
    await kv.delete(`pending:${user.id}`).catch(() => {});

    if (verifyMsgId) {
      const delResult = await tg.deleteMsg({ chatId: user.id, msgId: verifyMsgId }).catch(() => null);
      if (!delResult?.ok) {
        const editResult = await tg.editText({ chatId: user.id, msgId: verifyMsgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
        if (!editResult?.ok) {
          await tg.editCaption({ chatId: user.id, msgId: verifyMsgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
        }
      }
    }

    await tg.deleteMsg({ chatId: user.id, msgId: msg.message_id }).catch(() => {});
    await tg.sendMsg({ chatId: user.id, text: t('verify.success') }).catch(() => {});

    const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
    if (pendingRaw && groupId) {
      try {
        const p = JSON.parse(pendingRaw);
        const tid = await getOrCreateThread(tg, db, user, groupId, kv, t);
        if (tid && p.msgId) {
          const shouldForward = await shouldProcessMessageOnce(kv, 'verified-user-forward', user.id, p.msgId);
          if (shouldForward) {
            await tg.copyMsg({ chatId: groupId, fromChatId: user.id, msgId: p.msgId, threadId: tid });
            await db.addMsg({ userId: user.id, direction: 'incoming', content: t('content.verifiedForwarded') });
            await tg.sendMsg({ chatId: user.id, text: t('sentAfterVerify') });
          }
        }
      } catch (e) {
        logError('BOT', 'webAppVerify.forward', e, { userId: user.id });
      }
    }
  }, { ttlSeconds: 60, retries: 4, waitMs: 80 });

  if (!locked.acquired) {
    console.warn('[web_app_verify] lock not acquired for user', user.id);
  }

  console.log('[web_app_verify] done for user', user.id);
}

export {
  generateMathQuestion,
  mkMathVerify,
  scheduleVerifyTimeout,
  handleVerifyAnswer,
  handleWebAppVerify,
};
