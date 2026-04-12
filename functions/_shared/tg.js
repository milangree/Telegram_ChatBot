// functions/_shared/tg.js
export class TG {
  constructor(token) {
    this.token = token;
    this.base  = `https://api.telegram.org/bot${token}`;
  }

  async call(method, body = {}) {
    const r = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  sendMsg({ chatId, text, threadId, kb, parseMode = 'HTML', replyToMsgId }) {
    return this.call('sendMessage', {
      chat_id: chatId, text,
      message_thread_id: threadId,
      parse_mode: parseMode,
      disable_web_page_preview: true,
      reply_to_message_id: replyToMsgId,
      reply_markup: kb ? { inline_keyboard: kb } : undefined,
    });
  }

  sendPhoto({ chatId, fileId, url, caption, threadId, kb, parseMode = 'HTML' }) {
    return this.call('sendPhoto', {
      chat_id: chatId, photo: fileId || url, caption,
      message_thread_id: threadId, parse_mode: parseMode,
      reply_markup: kb ? { inline_keyboard: kb } : undefined,
    });
  }

  /** Forward preserving "Forwarded from" header. */
  forwardMsg({ chatId, fromChatId, msgId, threadId }) {
    return this.call('forwardMessage', {
      chat_id: chatId, from_chat_id: fromChatId,
      message_id: msgId, message_thread_id: threadId,
    });
  }

  /** Copy without "Forwarded from" header — preserves all entities, media, etc. */
  copyMsg({ chatId, fromChatId, msgId, threadId }) {
    return this.call('copyMessage', {
      chat_id: chatId, from_chat_id: fromChatId,
      message_id: msgId, message_thread_id: threadId,
    });
  }

  deleteMsg({ chatId, msgId }) {
    return this.call('deleteMessage', {
      chat_id: chatId,
      message_id: msgId,
    });
  }

  editText({ chatId, msgId, text, kb, parseMode = 'HTML' }) {
    return this.call('editMessageText', {
      chat_id: chatId, message_id: msgId, text, parse_mode: parseMode,
      reply_markup: kb !== undefined ? { inline_keyboard: kb } : undefined,
    });
  }

  editCaption({ chatId, msgId, caption, kb, parseMode = 'HTML' }) {
    return this.call('editMessageCaption', {
      chat_id: chatId, message_id: msgId, caption, parse_mode: parseMode,
      reply_markup: kb !== undefined ? { inline_keyboard: kb } : undefined,
    });
  }

  editKb({ chatId, msgId, kb }) {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb },
    });
  }

  answerCb({ id, text, alert = false }) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
  }

  createTopic({ chatId, name }) {
    return this.call('createForumTopic', { chat_id: chatId, name });
  }

  getUserProfilePhotos({ userId, limit = 1 }) {
    return this.call('getUserProfilePhotos', { user_id: userId, limit });
  }

  getFile({ fileId }) {
    return this.call('getFile', { file_id: fileId });
  }

  async fetchFile(filePath) {
    return fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
  }

  /**
   * Set bot commands visible to users (BotCommandScopeDefault)
   * and optionally a larger set for chats where bot is admin.
   */
  setMyCommands({ commands, scope, languageCode }) {
    return this.call('setMyCommands', {
      commands,
      scope: scope || { type: 'default' },
      language_code: languageCode || '',
    });
  }

  deleteMyCommands({ scope, languageCode }) {
    return this.call('deleteMyCommands', {
      scope: scope || { type: 'default' },
      language_code: languageCode || '',
    });
  }

  /**
   * Set the menu button shown in the chat input for users.
   * type: 'default' | 'commands' | 'web_app'
   */
  setChatMenuButton({ chatId, menuButton } = {}) {
    return this.call('setChatMenuButton', {
      chat_id: chatId,
      menu_button: menuButton || { type: 'commands' },
    });
  }

  deleteForumTopic({ chatId, threadId }) {
    return this.call('deleteForumTopic', { chat_id: chatId, message_thread_id: threadId });
  }
  closeForumTopic({ chatId, threadId }) {
    return this.call('closeForumTopic', { chat_id: chatId, message_thread_id: threadId });
  }
  reopenForumTopic({ chatId, threadId }) {
    return this.call('reopenForumTopic', { chat_id: chatId, message_thread_id: threadId });
  }
  setWebhook({ url, secret }) {
    return this.call('setWebhook', {
      url, secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  getMe()         { return this.call('getMe'); }
  getChat(chatId) { return this.call('getChat', { chat_id: chatId }); }

  /** Ban a user from a group. */
  banChatMember({ chatId, userId }) {
    return this.call('banChatMember', { chat_id: chatId, user_id: userId });
  }
}

export const esc = t =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const name = u =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') ||
  u.username || `User ${u.user_id ?? u.id}`;

export const msgType = m => {
  if (m.text)           return 'text';
  if (m.photo)          return 'photo';
  if (m.video)          return 'video';
  if (m.audio)          return 'audio';
  if (m.voice)          return 'voice';
  if (m.video_note)     return 'video_note';
  if (m.document)       return 'document';
  if (m.sticker)        return 'sticker';
  if (m.animation)      return 'animation';
  if (m.contact)        return 'contact';
  if (m.location)       return 'location';
  if (m.poll)           return 'poll';
  if (m.venue)          return 'venue';
  if (m.dice)           return 'dice';
  return 'other';
};
