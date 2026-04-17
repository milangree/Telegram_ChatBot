export const DEFAULT_SETTINGS = {
  BOT_TOKEN: '',
  FORUM_GROUP_ID: '',
  ADMIN_IDS: '',
  VERIFICATION_ENABLED: 'true',
  VERIFICATION_TIMEOUT: '300',
  MAX_VERIFICATION_ATTEMPTS: '3',
  AUTO_UNBLOCK_ENABLED: 'true',
  MAX_MESSAGES_PER_MINUTE: '30',
  USER_MSG_DELETE_SECONDS: '30',
  INLINE_KB_MSG_DELETE_ENABLED: 'true',
  INLINE_KB_MSG_DELETE_SECONDS: '30',
  WEBHOOK_SECRET: '',
  CAPTCHA_TYPE: 'math', // 验证类型：数学题 / 数字图片 / 字母数字图片
  CAPTCHA_SITE_URL: '',
  WELCOME_ENABLED: 'true',
  WELCOME_MESSAGE: '👋 欢迎使用双向消息机器人！\n\n请直接发送您的问题或留言，管理员将尽快回复。\n\n发送 /help 查看帮助。',
  BOT_COMMAND_FILTER: 'true',
  WHITELIST_ENABLED: 'false',
  ADMIN_NOTIFY_ENABLED: 'false',
  LOGIN_SESSION_TTL: '86400',
  BOT_LOCALE: 'zh-hans', // 机器人语言：简中 / 繁中 / 英文
  ZALGO_FILTER_ENABLED: 'true',
  MESSAGE_FILTER_RULES: '[]',
  ACTIVE_DB: 'kv', // 当前启用的存储：KV / D1
  WEBHOOK_URL: '',
}
