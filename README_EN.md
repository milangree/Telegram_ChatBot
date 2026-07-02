<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  Telegram two-way chat bot · Web admin panel · Multi-storage backend · Multiple verification methods
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169e1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License">
</p>

<p align="center">
  <a href="./README.md">中文文档</a>
</p>

---

Users DM the bot → auto-creates a forum topic → admin replies → message forwarded back to user.

Deploy via **Cloudflare Pages** or **Docker**. Storage supports **KV / D1 / Hyperdrive (PostgreSQL & MySQL)** with seamless switching.

---

<p align="center">
  <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#deployment-guide">Deployment</a> · <a href="#configuration">Configuration</a> · <a href="#verification-system">Verification</a> · <a href="#message-filtering-regex">Message Filtering</a> · <a href="#storage-system">Storage</a> · <a href="#security">Security</a> · <a href="#local-development">Local Dev</a> · <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## ✨ Features

<details>
<summary><b>📨 Messaging</b></summary>

- Two-way message forwarding (user ↔ admin forum topics)
- Per-user forum topics
- Message edit sync
- Message deduplication (prevents duplicate forwarding)
- Supports all message types (text/photo/video/audio/file/sticker/location/poll etc.)
- Admin replies auto-forwarded back to user

</details>

<details>
<summary><b>🔐 Verification System</b> (8 verification methods)</summary>

| Type | Key Required | Site URL Required | Description |
|------|:---:|:---:|------|
| Math | ❌ | ❌ | Random arithmetic, button selection |
| Image Numeric | ❌ | ✅ | 4-digit image captcha |
| Image Alphanumeric | ❌ | ✅ | 5-digit alphanumeric image captcha |
| Cloudflare Turnstile | ✅ | ✅ | Cloudflare invisible verification |
| Google reCAPTCHA v2 | ✅ | ✅ | "I'm not a robot" checkbox |
| Google reCAPTCHA v3 | ✅ | ✅ | Invisible score-based verification |
| hCaptcha | ✅ | ✅ | hCaptcha verification widget |

All verification methods support:
- Auto-timeout with notification and cleanup
- Max attempts limit
- Whitelist bypass

</details>

<details>
<summary><b>🛡️ Moderation</b></summary>

- Rate limiting (max messages per minute, KV-based sliding window)
- Ban / unban / permanent ban
- User appeal flow (admin approval)
- Slash command filter (`/xxx` commands not forwarded to admin)
- Zalgo abnormal text filter
- Keyword filtering (text and regex rules, ReDoS protection)

</details>

<details>
<summary><b>🖥️ Web Admin Panel</b></summary>

- Dashboard (total users, message statistics)
- Conversation history
- User management (ban/unblock/whitelist/delete)
- Whitelist management
- Full settings page (Bot/Webhook/Verification/Features/Filters/Welcome/Storage)
- Profile (change password/username/2FA)
- Login rate limiting (configurable max attempts and lockout duration)

</details>

<details>
<summary><b>🗄️ Storage System</b></summary>

- **KV** — Zero config, suitable for small-medium scale
- **D1** — SQLite, supports SQL queries
- **Hyperdrive** — PostgreSQL / MySQL, suitable for production
- One-click switching with automatic data sync
- SQL import/export (plain / Base64 / AES-256-GCM encryption)

</details>

<details>
<summary><b>🌍 Internationalization</b></summary>

- Simplified Chinese / Traditional Chinese / English
- Bot message language and WebUI language configured independently
- Switch bot language via settings page

</details>

---

## 🚀 Quick Start

### Fastest: Docker Compose

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

Visit `http://localhost:3000`, login with default credentials `admin` / `admins`.

### Setup Order

1. Login to WebUI → **Change password** → Enable **2FA**
2. Set **Bot Token** (from [@BotFather](https://t.me/BotFather))
3. Set **Forum Group ID** (supergroup with topics enabled, system provides chat resolver)
4. Set **Admin Telegram IDs**
5. Set **Webhook URL**: `https://your-domain/webhook`
6. Choose and configure verification method
7. Test: user sends message → topic created → admin replies → user receives

---

## 📦 Deployment Guide

<details>
<summary><b>☁️ Cloudflare Pages Deployment</b></summary>

### 1. Create Storage Resources

**Required — KV namespace:**
Cloudflare Dashboard → Workers & Pages → KV → Create a namespace

**Optional — D1 database:**
```bash
npx wrangler d1 create tg-chatbot-d1
```

**Optional — Hyperdrive:**
Dashboard → Hyperdrive → Create connection (`postgres://` / `mysql://`)

### 2. Create Pages Project

Fork this repo → Workers & Pages → Create → Pages → Connect GitHub repo

| Setting | Value |
|---------|-------|
| Framework preset | `Vue` |
| Build command | `npm run build` |
| Output directory | `dist` |

### 3. Add Bindings

Settings → Bindings → Add binding:

| Variable | Binding type | Required |
|----------|-------------|:--------:|
| `KV` | KV namespace | ✅ |
| `D1` | D1 database | ❌ |
| `HYPERDRIVE` | Hyperdrive | ❌ |

> For Hyperdrive: run `npm install pg mysql2` and add `nodejs_compat` in Settings → Compatibility flags.

### 4. Deploy

Push code to trigger auto-deploy. You'll get `https://your-project.pages.dev`.

</details>

<details>
<summary><b>🐳 Docker Deployment</b></summary>

### Docker Compose (Recommended)

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

### Docker Run

```bash
docker pull kakuwari/tg-chatbot:latest
docker run -d \
  -p 3000:3000 \
  -v telegram-data:/app/data \
  --name telegram-chatbot \
  kakuwari/tg-chatbot:latest
```

### Build Locally

```bash
docker build -t telegram-chatbot .
docker run -d -p 3000:3000 -v data:/app/data telegram-chatbot
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `KV_FILE` | `/app/data/kv-store.db` | KV storage SQLite path |
| `D1_FILE` | `/app/data/d1-store.db` | D1 storage SQLite path |
| `DATABASE_URL` | — | PostgreSQL / MySQL connection string |
| `ACTIVE_DB` | `kv` | Storage backend: `kv` / `d1` / `hyperdrive` |

### Using PostgreSQL

Edit `docker-compose.yml`, uncomment the PostgreSQL service:

```yaml
services:
  telegram-chatbot:
    environment:
      - DATABASE_URL=postgresql://telegram:password@postgres:5432/telegram_bot
      - ACTIVE_DB=hyperdrive

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: telegram_bot
      POSTGRES_USER: telegram
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-telegram_password}
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

### HTTPS Configuration

Docker has no built-in HTTPS. Use a reverse proxy:

**Cloudflare Tunnel (Recommended):**
```bash
cloudflared tunnel --url http://localhost:3000
```

**Nginx Reverse Proxy:**
```nginx
server {
    listen 443 ssl;
    server_name bot.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

---

## ⚙️ Configuration

<details>
<summary><b>🤖 Bot Settings</b></summary>

| Setting | Description | Required |
|---------|-------------|:--------:|
| `BOT_TOKEN` | Telegram Bot Token (from @BotFather) | ✅ |
| `FORUM_GROUP_ID` | Forum supergroup ID (starts with `-100`) | ✅ |
| `ADMIN_IDS` | Admin Telegram IDs (comma-separated) | ✅ |
| `BOT_LOCALE` | Bot language: `zh-hans` / `zh-hant` / `en` | ❌ |

**Getting Group ID:** Use the "Query Chat ID" helper in WebUI settings — enter group username or link to resolve.

</details>

<details>
<summary><b>🔗 Webhook Settings</b></summary>

| Setting | Description |
|---------|-------------|
| `WEBHOOK_URL` | Webhook URL, format: `https://domain/webhook` |

After setting the webhook, `WEBHOOK_SECRET` is auto-generated for request verification.
On Cloudflare Pages, `CAPTCHA_SITE_URL` is auto-filled from the Webhook URL origin.

</details>

<details>
<summary><b>🔐 Verification Settings</b></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| `VERIFICATION_ENABLED` | `true` | Verification toggle |
| `CAPTCHA_TYPE` | `math` | Verification type (see table below) |
| `VERIFICATION_TIMEOUT` | `300` | Timeout in seconds (60-3600) |
| `MAX_VERIFICATION_ATTEMPTS` | `3` | Max retry attempts (1-10) |
| `CAPTCHA_SITE_URL` | — | Verification page site URL |

**Per-type settings:**

| Setting | Used by |
|---------|---------|
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA v2 |
| `RECAPTCHA_V3_SITE_KEY` / `RECAPTCHA_V3_SECRET_KEY` | Google reCAPTCHA v3 |
| `RECAPTCHA_V3_SCORE_THRESHOLD` | reCAPTCHA v3 min score (default 0.5) |
| `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET_KEY` | hCaptcha |

</details>

<details>
<summary><b>🛡️ Moderation Settings</b></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_MESSAGES_PER_MINUTE` | `30` | Max messages per user per minute (whitelist exempt) |
| `AUTO_UNBLOCK_ENABLED` | `true` | Allow banned users to appeal |
| `WHITELIST_ENABLED` | `false` | Whitelist feature (skip verification & rate limit) |
| `BOT_COMMAND_FILTER` | `true` | Filter `/xxx` commands from forwarding |
| `ADMIN_NOTIFY_ENABLED` | `false` | Admin DM notifications |
| `ZALGO_FILTER_ENABLED` | `true` | Filter Zalgo abnormal text |
| `MESSAGE_FILTER_RULES` | `[]` | Keyword filter rules (JSON array) |

</details>

<details>
<summary><b>⏰ Message Management Settings</b></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| `USER_MSG_DELETE_SECONDS` | `30` | Auto-delete user messages (0=disabled) |
| `INLINE_KB_MSG_DELETE_ENABLED` | `true` | Auto-delete button messages toggle |
| `INLINE_KB_MSG_DELETE_SECONDS` | `30` | Auto-delete button messages timeout |
| `WELCOME_ENABLED` | `true` | Welcome message toggle |
| `WELCOME_MESSAGE` | — | Welcome message content (HTML supported) |

</details>

<details>
<summary><b>🔒 Security Settings</b></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| `LOGIN_SESSION_TTL` | `86400` | WebUI login expiration (seconds) |
| `LOGIN_MAX_ATTEMPTS` | `5` | Max login attempts before lockout |
| `LOGIN_LOCKOUT_SECONDS` | `900` | Lockout duration (seconds, default 15 min) |

Passwords stored with PBKDF2 (600,000 iterations SHA-256). TOTP two-factor authentication supported.

</details>

---

## 🔐 Verification System

### Flow

```
User sends first message
    ↓
Bot sends verification message (buttons/image/link, depending on type)
    ↓
User completes verification
    ↓
Bot marks user as verified → forwards pending message to admin
    ↓
Subsequent messages forwarded directly, no re-verification needed
```

### Timeout Handling

- After timeout, bot auto-edits verification message to "⏳ Verification timed out"
- Cleans up all verification data (verify record, pending message, webverify KV)
- User can re-trigger verification by sending a new message

### Whitelist

Whitelisted users skip verification and rate limiting. Add via WebUI or bot command `/wl <userID>`.

---

## 📝 Message Filtering (Regex)

Two filter rule types supported:

| Type | Description | Example |
|------|-------------|---------|
| `text` | Plain text match (case-insensitive) | `spam`, `advertisement` |
| `regex` | Regular expression match | `/https?:\/\/t\.me\/\w+/i` |

### Adding Rules

**WebUI:** Settings → Message Filter → Select type → Enter content → Add

**Bot commands:**
```
/addfilter text keyword
/addfilter regex /https?:\/\/t\.me\/\w+/i
/delfilter 1
/filters
```

### Regex Tutorial

<details>
<summary><b>Regex Basic Syntax</b></summary>

| Syntax | Description | Example |
|--------|-------------|---------|
| `.` | Any single character | `a.c` matches `abc`, `a1c` |
| `*` | Previous char 0+ times | `ab*c` matches `ac`, `abc`, `abbc` |
| `+` | Previous char 1+ times | `ab+c` matches `abc`, `abbc` |
| `?` | Previous char optional | `ab?c` matches `ac`, `abc` |
| `\d` | Digit `[0-9]` | `\d+` matches one or more digits |
| `\w` | Word char `[a-zA-Z0-9_]` | `\w+` matches a word |
| `\s` | Whitespace | `\s+` matches one or more spaces |
| `[abc]` | Character set | `[aeiou]` matches any vowel |
| `[^abc]` | Negated set | `[^0-9]` matches non-digit |
| `(abc)` | Group | `(ab)+` matches `ab`, `abab` |
| `a\|b` | Or | `cat\|dog` matches `cat` or `dog` |
| `^` | Start of line | `^Hello` matches `Hello` at start |
| `$` | End of line | `end$` matches `end` at end |

</details>

<details>
<summary><b>Common Filter Regex Examples</b></summary>

```
# Match Telegram invite links
/addfilter regex /t\.me\/(joinchat\/|\+)\w+/i

# Match all external links
/addfilter regex /https?:\/\/[^\s]+/i

# Match phone numbers
/addfilter regex /\b1[3-9]\d{9}\b/

# Match specific keywords (Chinese)
/addfilter regex /加群|进群|入群/

# Match pure emoji messages (5+ consecutive)
/addfilter regex /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{5,}$/u
```

</details>

<details>
<summary><b>Regex Testing & Debugging</b></summary>

### Online Testing Tools

Before adding complex regex rules, test them with online tools:

- **[regex101.com](https://regex101.com/)** — Most popular regex tester with syntax highlighting and explanation
- **[regexr.com](https://regexr.com/)** — Visual regex matching
- **[debuggex.com](https://www.debuggex.com/)** — Regex visualization (state machine diagrams)

### Testing Steps

1. Open [regex101.com](https://regex101.com/)
2. Paste your test message text in "Test String"
3. Enter your regex in "Regular Expression" (without leading/trailing `/` and flags)
4. Select flags on the right: `g` (global), `i` (case-insensitive), `m` (multiline)
5. Confirm the match results are correct, then add in bot: `/addfilter regex /your-regex/flags`

### Notes

- Regex matching targets **extracted plain text** from message content (not raw JSON), including text, usernames, titles, etc.
- Avoid nested quantifiers like `(a+)+` — these cause ReDoS (Regex Denial of Service)
- The system auto-detects and rejects regex patterns with ReDoS risk at creation time
- Match target string is limited to 4096 characters to prevent performance issues with long messages
- Regex match failures (syntax errors etc.) silently return no-match without affecting message processing

</details>

<details>
<summary><b>ReDoS Protection</b></summary>

Built-in ReDoS (Regular Expression Denial of Service) protection:

1. **Creation-time detection**: Nested quantifier patterns (e.g., `(a+)+`, `(a|a)+`) are automatically detected and rejected
2. **Match-time protection**: Regex matching is wrapped in try-catch, target string limited to 4096 characters
3. **Silent errors**: Match failures don't affect normal message processing

If your regex is rejected, it contains patterns that may cause catastrophic backtracking. Simplify the regex or use more specific character classes.

</details>

---

## 🗄️ Storage System

| Backend | Use Case | Features |
|---------|----------|----------|
| **KV** | Small-medium | Zero config, key-value storage |
| **D1** | Medium-large | SQLite, SQL queries, transactions |
| **Hyperdrive** | Production | PostgreSQL / MySQL, external database |

### Switching Storage

One-click switch in WebUI Settings → Storage Management. System auto-syncs data.

> ⚠️ Stop bot message processing before switching to avoid data inconsistency during sync.

### SQL Import/Export

Three modes supported:
- **Plain** — Direct SQL text export
- **Base64** — Base64 encoded
- **AES-256-GCM** — Encrypted export, requires password

---

## 🛡️ Security

| Mechanism | Description |
|-----------|-------------|
| Password Hashing | PBKDF2 (600,000 iterations SHA-256), backward-compatible with legacy salt:sha256 |
| Two-Factor Auth | TOTP (RFC 6238), login page recovery supported |
| Login Rate Limiting | Configurable max attempts and lockout duration (default 5 attempts / 15 min) |
| Bot Rate Limiting | KV-based sliding window (compatible with CF Workers multi-isolate) |
| Webhook Verification | Secret Token header validation |
| SQL Injection Prevention | All queries use parameterized bindings |
| Default Admin | Auto-disabled after first real account registration |
| ReDoS Protection | Regex creation-time detection, match-time protection |
| Regex Error Handling | Match exceptions handled silently, no message flow disruption |

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Preview build
npm run preview

# Docker local development
cd server && npm install && cd ..
node server/index.js
```

> Full backend requires Cloudflare environment. Local is for frontend preview and build verification. Docker mode supports full backend testing.

---

## 🩺 Troubleshooting

<details>
<summary><b>WebUI 500 / Blank Page</b></summary>

Check that KV is bound with variable name `KV` (uppercase). Redeploy after binding.

In Docker mode, check `KV_FILE` path has write permissions.

</details>

<details>
<summary><b>Webhook Setup Fails</b></summary>

- Bot Token is correct (format: `123456:ABC-DEF...`)
- URL must be public HTTPS: `https://domain/webhook`
- Docker users need a reverse proxy for HTTPS

</details>

<details>
<summary><b>Messages Not Forwarding</b></summary>

- Group has topics enabled (supergroup → Settings → Topics)
- Bot is a group admin (needs manage topics permission)
- `FORUM_GROUP_ID` is correct (starts with `-100`)
- User has passed verification

</details>

<details>
<summary><b>Forgot Password</b></summary>

- With 2FA enabled: Use the login page "Recover" flow with TOTP code
- Without 2FA: Manually edit storage (delete web_users records in KV/D1/database, restart to rebuild default admin)

</details>

<details>
<summary><b>Docker Has No HTTPS</b></summary>

Use one of:
- **Cloudflare Tunnel** (recommended): `cloudflared tunnel --url http://localhost:3000`
- **Nginx reverse proxy** (see deployment guide)
- **Caddy**: Auto-HTTPS, simplest configuration

</details>

<details>
<summary><b>Verification Timeout No Response</b></summary>

- Check `VERIFICATION_TIMEOUT` setting (default 300 seconds)
- Turnstile/reCAPTCHA requires correct `CAPTCHA_SITE_URL` configuration
- Unconfigured secret keys auto-fallback to math captcha
- Check container logs: `docker compose logs -f telegram-chatbot`

</details>

<details>
<summary><b>Viewing Container Logs</b></summary>

```bash
# Real-time logs
docker compose logs -f telegram-chatbot

# Last 100 lines
docker compose logs --tail 100 telegram-chatbot

# Key log keywords
# [web_app_verify] — Web verification callbacks
# [verify_timeout] — Verification timeout cleanup
# [api/verify] — Verification API operations
```

</details>

---

## 📄 License

See the `LICENSE` file in the repository root.
