// functions/_shared/tg.js
export class TG {
  constructor(token) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  async call(method, body = {}) {
    const r = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  sendMsg({ chatId, text, threadId, kb, parseMode = 'HTML' }) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      message_thread_id: threadId,
      parse_mode: parseMode,
      disable_web_page_preview: true,
      reply_markup: kb ? { inline_keyboard: kb } : undefined,
    });
  }

  editText({ chatId, msgId, text, kb, parseMode = 'HTML' }) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text,
      parse_mode: parseMode,
      reply_markup: kb !== undefined ? { inline_keyboard: kb } : undefined,
    });
  }

  editKb({ chatId, msgId, kb }) {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: { inline_keyboard: kb },
    });
  }

  answerCb({ id, text, alert = false }) {
    return this.call('answerCallbackQuery', {
      callback_query_id: id,
      text,
      show_alert: alert,
    });
  }

  createTopic({ chatId, name }) {
    return this.call('createForumTopic', { chat_id: chatId, name });
  }

  copyMsg({ chatId, fromChatId, msgId, threadId }) {
    return this.call('copyMessage', {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: msgId,
      message_thread_id: threadId,
    });
  }

  setWebhook({ url, secret }) {
    return this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  getMe() { return this.call('getMe'); }
  getChat(chatId) { return this.call('getChat', { chat_id: chatId }); }
}

export const esc = t =>
  String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const name = u =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') ||
  u.username ||
  `User ${u.user_id || u.id}`;

export const msgType = m => {
  if (m.text)     return 'text';
  if (m.photo)    return 'photo';
  if (m.video)    return 'video';
  if (m.audio)    return 'audio';
  if (m.voice)    return 'voice';
  if (m.document) return 'document';
  if (m.sticker)  return 'sticker';
  return 'other';
};
