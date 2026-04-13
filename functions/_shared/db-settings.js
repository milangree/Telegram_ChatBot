// functions/_shared/db-settings.js
export const DEFAULT_SETTINGS = {
  BOT_TOKEN: '',
  FORUM_GROUP_ID: '',
  ADMIN_IDS: '',
  VERIFICATION_ENABLED: 'true',
  VERIFICATION_TIMEOUT: '300',
  MAX_VERIFICATION_ATTEMPTS: '3',
  AUTO_UNBLOCK_ENABLED: 'true',
  MAX_MESSAGES_PER_MINUTE: '30',
  WEBHOOK_SECRET: '',
  CAPTCHA_TYPE: 'math', // math | image_numeric | image_alphanumeric
  CAPTCHA_SITE_URL: '',
  WELCOME_ENABLED: 'true',
  WELCOME_MESSAGE: '👋 欢迎使用双向消息机器人！\n\n请直接发送您的问题或留言，管理员将尽快回复。\n\n发送 /help 查看帮助。',
  BOT_COMMAND_FILTER: 'true',
  WHITELIST_ENABLED: 'false',
  ADMIN_NOTIFY_ENABLED: 'false',
  BOT_LOCALE: 'zh-hans', // zh-hans | zh-hant | en
  ACTIVE_DB: 'kv', // kv | d1
  WEBHOOK_URL: '',
}
