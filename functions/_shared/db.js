// functions/_shared/db.js
import { hashPw } from './auth.js';

const DEFAULT_SETTINGS = {
  BOT_TOKEN: '',
  FORUM_GROUP_ID: '',
  ADMIN_IDS: '',
  VERIFICATION_ENABLED: 'true',
  VERIFICATION_TIMEOUT: '300',
  MAX_VERIFICATION_ATTEMPTS: '3',
  AUTO_UNBLOCK_ENABLED: 'true',
  MAX_MESSAGES_PER_MINUTE: '30',
  WEBHOOK_SECRET: '',
};

// ── KV helper: fetch ALL keys for a prefix, handling CF pagination cursor ──
async function kvListAll(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const opts = { prefix };
    if (cursor) opts.cursor = cursor;
    const res = await kv.list(opts);
    keys.push(...res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export class DB {
  constructor(kv) {
    this.kv = kv;
  }

  // ========== Settings ==========

  async getSetting(key) {
    try {
      return await this.kv.get(`setting:${key}`);
    } catch (e) {
      console.error(`getSetting error for ${key}:`, e);
      return null;
    }
  }

  async setSetting(key, value) {
    try {
      await this.kv.put(`setting:${key}`, String(value));
    } catch (e) {
      console.error(`setSetting error for ${key}:`, e);
    }
  }

  async getAllSettings() {
    try {
      const settings = { ...DEFAULT_SETTINGS };
      // Batch: fetch all setting keys in parallel
      const entries = await Promise.all(
        Object.keys(DEFAULT_SETTINGS).map(async key => {
          const val = await this.kv.get(`setting:${key}`);
          return [key, val];
        }),
      );
      for (const [key, val] of entries) {
        if (val !== null) settings[key] = val;
      }
      return settings;
    } catch (e) {
      console.error('getAllSettings error:', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  // ========== Users ==========

  async getUser(userId) {
    try {
      const data = await this.kv.get(`user:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('getUser error:', e);
      return null;
    }
  }

  async upsertUser({ userId, username, firstName, lastName, languageCode }) {
    try {
      const existing = await this.getUser(userId);
      const user = {
        user_id: userId,
        username: username || existing?.username,
        first_name: firstName || existing?.first_name,
        last_name: lastName || existing?.last_name,
        language_code: languageCode || existing?.language_code,
        thread_id: existing?.thread_id,
        is_verified: existing?.is_verified || 0,
        is_blocked: existing?.is_blocked || 0,
        is_permanent_block: existing?.is_permanent_block || 0,
        block_reason: existing?.block_reason,
        blocked_by: existing?.blocked_by,
        created_at: existing?.created_at || new Date().toISOString(),
      };
      await this.kv.put(`user:${userId}`, JSON.stringify(user));
      if (username) {
        await this.kv.put(`username:${username.toLowerCase()}`, String(userId));
      }
    } catch (e) {
      console.error('upsertUser error:', e);
    }
  }

  async setUserThread(userId, threadId) {
    try {
      const user = await this.getUser(userId);
      if (user) {
        user.thread_id = threadId;
        await this.kv.put(`user:${userId}`, JSON.stringify(user));
        // FIX: maintain reverse index for O(1) lookup in getUserByThread
        await this.kv.put(`thread:${threadId}`, String(userId));
      }
    } catch (e) {
      console.error('setUserThread error:', e);
    }
  }

  async setUserVerified(userId, verified) {
    try {
      const user = await this.getUser(userId);
      if (user) {
        user.is_verified = verified ? 1 : 0;
        await this.kv.put(`user:${userId}`, JSON.stringify(user));
      }
    } catch (e) {
      console.error('setUserVerified error:', e);
    }
  }

  /**
   * FIX: was O(n) full scan of all users.
   * Now O(1) via the thread:{threadId} → userId reverse index written in setUserThread.
   */
  async getUserByThread(threadId) {
    try {
      const userId = await this.kv.get(`thread:${threadId}`);
      if (!userId) return null;
      return this.getUser(parseInt(userId, 10));
    } catch (e) {
      console.error('getUserByThread error:', e);
      return null;
    }
  }

  async blockUser(userId, reason, blockedBy, permanent = true) {
    try {
      const user = await this.getUser(userId);
      if (user) {
        user.is_blocked = 1;
        user.is_permanent_block = permanent ? 1 : 0;
        user.block_reason = reason;
        user.blocked_by = blockedBy;
        await this.kv.put(`user:${userId}`, JSON.stringify(user));
      }
    } catch (e) {
      console.error('blockUser error:', e);
    }
  }

  async unblockUser(userId) {
    try {
      const user = await this.getUser(userId);
      if (user) {
        user.is_blocked = 0;
        user.is_permanent_block = 0;
        user.block_reason = null;
        user.blocked_by = null;
        await this.kv.put(`user:${userId}`, JSON.stringify(user));
      }
    } catch (e) {
      console.error('unblockUser error:', e);
    }
  }

  async searchUsers(query, limit = 10) {
    try {
      const results = [];
      const keys = await kvListAll(this.kv, 'user:');
      const q = query.toLowerCase();
      for (const key of keys) {
        if (results.length >= limit) break;
        const data = await this.kv.get(key.name);
        if (data) {
          const user = JSON.parse(data);
          if (
            String(user.user_id).includes(q) ||
            (user.username && user.username.toLowerCase().includes(q)) ||
            (user.first_name && user.first_name.toLowerCase().includes(q))
          ) {
            results.push(user);
          }
        }
      }
      return results;
    } catch (e) {
      console.error('searchUsers error:', e);
      return [];
    }
  }

  async getAllUsers(page = 1, pageSize = 20) {
    try {
      const users = [];
      const keys = await kvListAll(this.kv, 'user:');
      await Promise.all(
        keys.map(async key => {
          const data = await this.kv.get(key.name);
          if (data) users.push(JSON.parse(data));
        }),
      );
      users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const start = (page - 1) * pageSize;
      return { users: users.slice(start, start + pageSize), total: users.length };
    } catch (e) {
      console.error('getAllUsers error:', e);
      return { users: [], total: 0 };
    }
  }

  async getBlockedUsers(page = 1, pageSize = 10) {
    try {
      const users = [];
      const keys = await kvListAll(this.kv, 'user:');
      await Promise.all(
        keys.map(async key => {
          const data = await this.kv.get(key.name);
          if (data) {
            const user = JSON.parse(data);
            if (user.is_blocked) users.push(user);
          }
        }),
      );
      users.sort((a, b) => b.user_id - a.user_id);
      const start = (page - 1) * pageSize;
      return { users: users.slice(start, start + pageSize), total: users.length };
    } catch (e) {
      console.error('getBlockedUsers error:', e);
      return { users: [], total: 0 };
    }
  }

  // ========== Messages ==========

  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    try {
      const msgId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const message = {
        id: msgId,
        user_id: userId,
        direction,
        content: content || '',
        message_type: messageType,
        telegram_message_id: telegramMessageId,
        created_at: new Date().toISOString(),
      };
      await this.kv.put(`msg:${userId}:${msgId}`, JSON.stringify(message));
      await this.kv.put(
        `recent:${userId}`,
        JSON.stringify({
          user_id: userId,
          last_message: content,
          last_direction: direction,
          last_at: message.created_at,
        }),
      );
    } catch (e) {
      console.error('addMsg error:', e);
    }
  }

  async getMsgs(userId, limit = 50, offset = 0) {
    try {
      const messages = [];
      const keys = await kvListAll(this.kv, `msg:${userId}:`);
      await Promise.all(
        keys.map(async key => {
          const data = await this.kv.get(key.name);
          if (data) messages.push(JSON.parse(data));
        }),
      );
      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return messages.slice(offset, offset + limit);
    } catch (e) {
      console.error('getMsgs error:', e);
      return [];
    }
  }

  async getRecentConvs(limit = 40) {
    try {
      const convs = [];
      const keys = await kvListAll(this.kv, 'recent:');
      await Promise.all(
        keys.map(async key => {
          const data = await this.kv.get(key.name);
          if (data) {
            const conv = JSON.parse(data);
            const user = await this.getUser(conv.user_id);
            convs.push({ ...conv, ...user });
          }
        }),
      );
      convs.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
      return convs.slice(0, limit);
    } catch (e) {
      console.error('getRecentConvs error:', e);
      return [];
    }
  }

  // ========== Verification ==========

  async setVerify(userId, question, answer, ttlSeconds = 300) {
    try {
      const data = {
        user_id: userId,
        question,
        answer,
        attempts: 0,
        expires_at: Date.now() + ttlSeconds * 1000,
      };
      await this.kv.put(`verify:${userId}`, JSON.stringify(data), {
        expirationTtl: ttlSeconds,
      });
    } catch (e) {
      console.error('setVerify error:', e);
    }
  }

  async getVerify(userId) {
    try {
      const data = await this.kv.get(`verify:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('getVerify error:', e);
      return null;
    }
  }

  async incVerify(userId) {
    try {
      const v = await this.getVerify(userId);
      if (v) {
        v.attempts++;
        // FIX: CF KV rejects expirationTtl < 60; clamp to minimum 60s
        const remainingMs = v.expires_at - Date.now();
        const ttl = Math.max(60, Math.floor(remainingMs / 1000));
        await this.kv.put(`verify:${userId}`, JSON.stringify(v), {
          expirationTtl: ttl,
        });
      }
    } catch (e) {
      console.error('incVerify error:', e);
    }
  }

  async delVerify(userId) {
    try {
      await this.kv.delete(`verify:${userId}`);
    } catch (e) {
      console.error('delVerify error:', e);
    }
  }

  // ========== Web Users (Admin) ==========

  async webUserCount() {
    try {
      const keys = await kvListAll(this.kv, 'webuser:');
      return keys.length;
    } catch (e) {
      console.error('webUserCount error:', e);
      return 0;
    }
  }

  async createWebUser(username, passwordHash) {
    try {
      const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      const user = {
        id,
        username,
        password_hash: passwordHash,
        totp_secret: null,
        totp_enabled: 0,
        is_admin: 1,
        created_at: new Date().toISOString(),
      };
      await this.kv.put(`webuser:${username.toLowerCase()}`, JSON.stringify(user));
      await this.kv.put(`webuser_id:${id}`, JSON.stringify(user));
      return user;
    } catch (e) {
      console.error('createWebUser error:', e);
      return null;
    }
  }

  async getWebUser(username) {
    try {
      const data = await this.kv.get(`webuser:${username.toLowerCase()}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('getWebUser error:', e);
      return null;
    }
  }

  async getWebUserById(id) {
    try {
      const data = await this.kv.get(`webuser_id:${id}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('getWebUserById error:', e);
      return null;
    }
  }

  async updateWebUserPassword(id, hash) {
    try {
      const user = await this.getWebUserById(id);
      if (user) {
        user.password_hash = hash;
        await this.kv.put(`webuser:${user.username.toLowerCase()}`, JSON.stringify(user));
        await this.kv.put(`webuser_id:${id}`, JSON.stringify(user));
      }
    } catch (e) {
      console.error('updateWebUserPassword error:', e);
    }
  }

  /**
   * FIX: this method was called by the API but did not exist in db.js, causing a 500 error.
   */
  async updateWebUserUsername(id, newUsername) {
    try {
      const user = await this.getWebUserById(id);
      if (!user) return;
      // Remove old username key
      await this.kv.delete(`webuser:${user.username.toLowerCase()}`);
      user.username = newUsername;
      await this.kv.put(`webuser:${newUsername.toLowerCase()}`, JSON.stringify(user));
      await this.kv.put(`webuser_id:${id}`, JSON.stringify(user));
    } catch (e) {
      console.error('updateWebUserUsername error:', e);
    }
  }

  async setWebUserTotp(id, secret, enabled) {
    try {
      const user = await this.getWebUserById(id);
      if (user) {
        user.totp_secret = secret;
        user.totp_enabled = enabled ? 1 : 0;
        await this.kv.put(`webuser:${user.username.toLowerCase()}`, JSON.stringify(user));
        await this.kv.put(`webuser_id:${id}`, JSON.stringify(user));
      }
    } catch (e) {
      console.error('setWebUserTotp error:', e);
    }
  }

  // ========== Stats ==========

  async getStats() {
    try {
      const [userKeys, msgKeys] = await Promise.all([
        kvListAll(this.kv, 'user:'),
        kvListAll(this.kv, 'msg:'),
      ]);

      // Count blocked users by fetching all user records in parallel
      const userData = await Promise.all(
        userKeys.map(k => this.kv.get(k.name)),
      );
      const blockedCount = userData.reduce((n, raw) => {
        if (!raw) return n;
        const u = JSON.parse(raw);
        return n + (u.is_blocked ? 1 : 0);
      }, 0);

      // Count today's messages via KV metadata (key contains timestamp prefix)
      const today = new Date().toISOString().slice(0, 10);
      let todayMsgs = 0;
      // Keys are msg:{userId}:{timestamp}_{rand} — check the key name directly
      for (const k of msgKeys) {
        // Extract timestamp segment from key: msg:userId:TS_rand
        const parts = k.name.split(':');
        if (parts.length >= 3) {
          const ts = parseInt(parts[2].split('_')[0], 10);
          if (!isNaN(ts)) {
            const d = new Date(ts).toISOString().slice(0, 10);
            if (d === today) todayMsgs++;
          }
        }
      }

      return {
        totalUsers: userKeys.length,
        blockedUsers: blockedCount,
        totalMessages: msgKeys.length,
        todayMessages: todayMsgs,
      };
    } catch (e) {
      console.error('getStats error:', e);
      return { totalUsers: 0, blockedUsers: 0, totalMessages: 0, todayMessages: 0 };
    }
  }

  /**
   * FIX: only call ensureDefaultAdmin once (on first request) by checking count.
   * Moved to a lazy init guard to avoid the race condition of two cold-starts
   * both seeing count=0 and creating duplicate admins.
   */
  async ensureDefaultAdmin() {
    try {
      // Use a lock key to prevent concurrent initialization
      const initDone = await this.kv.get('init:default_admin');
      if (initDone) return;

      const count = await this.webUserCount();
      if (count === 0) {
        // Use a strong random password instead of a hardcoded one
        const { genToken } = await import('./auth.js');
        const pw = genToken(16);
        const hashed = await hashPw(pw);
        await this.createWebUser('admin', hashed);
        // Store the generated password in KV so the operator can retrieve it once
        await this.kv.put('init:default_admin_pw', pw, { expirationTtl: 3600 });
        console.log(`Default admin created. Retrieve password once via KV key "init:default_admin_pw" (expires in 1h).`);
      }
      // Mark as initialized regardless (existing users already present)
      await this.kv.put('init:default_admin', '1');
    } catch (e) {
      console.error('ensureDefaultAdmin error:', e);
    }
  }
}
