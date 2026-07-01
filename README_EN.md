<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  Telegram two-way chat bot · Web admin panel · Multi-storage backend.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Vuetify-3-7B61FF?style=flat&logo=vuetify&logoColor=white" alt="Vuetify 3">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169e1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License">
</p>

<p align="center">
  <a href="./README.md">中文文档</a>
</p>

---

A Telegram two-way chat bot built on **Cloudflare Pages + Pages Functions + Vue 3 (Vuetify 3)**. 

Deployable via **Cloudflare Pages** or **Docker**. Storage supports **KV / D1 / Hyperdrive (PostgreSQL & MySQL)** with seamless switching.

Users DM the bot → auto-creates a topic in admin forum group → admin replies → message forwarded back to user.

---

## Features

**Messaging** — Two-way forwarding · Per-user forum topics · Edit sync · Dedup · Keyword filter

**Verification** — Math captcha (buttons) · 4-digit image captcha · 5-digit alphanumeric captcha · Whitelist bypass

**Moderation** — Rate limiting · Ban / unban / permanent ban · Appeal flow · Command filter

**Admin Panel** — Dashboard · Conversations · User management · Whitelist · Settings · Profile · 2FA

**Storage** — KV ↔ D1 ↔ Hyperdrive sync switch · SQL import/export (plain / Base64 / AES-256-GCM)

**i18n** — Simplified Chinese · Traditional Chinese · English

---

## 🚀 Cloudflare Pages Deployment

### 1. Create Storage Resources

**Required — KV namespace:** Cloudflare Dashboard → Workers & Pages → KV → Create a namespace

**Optional — D1 database:** `npx wrangler d1 create tg-chatbot-d1`

**Optional — Hyperdrive:** Dashboard → Hyperdrive → Create connection (`postgres://` / `mysql://`)

### 2. Create Pages Project

Fork this repo → Workers & Pages → Create → Pages → Connect GitHub repo

| Setting | Value |
| :---: | :---: |
| Framework preset | `Vue` |
| Build command | `npm run build` |
| Output directory | `dist` |

### 3. Add Bindings

Settings → Bindings → Add binding:

| Variable | Binding type | Required |
| :---: | :---: | :---: |
| `KV` | KV namespace | ✅ |
| `D1` | D1 database | ❌ |
| `HYPERDRIVE` | Hyperdrive | ❌ |

> For Hyperdrive: run `npm install pg mysql2` and add `nodejs_compat` in Settings → Compatibility flags.

### 4. Redeploy

After deployment you'll get `https://your-project.pages.dev`.

---

## 🐳 Docker Deployment

Docker uses the same business code as Cloudflare Pages, with local SQLite for storage.

### Quick Start

```bash
docker pull kakuwari/tg-chatbot:latest
```

### docker compose
```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

Visit `http://localhost:3000` to access the WebUI.

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Server port |
| `KV_FILE` | `./data/kv-store.db` | KV storage path |
| `D1_FILE` | `./data/d1-store.db` | D1 storage path |
| `DATABASE_URL` | — | PostgreSQL / MySQL connection string |
| `ACTIVE_DB` | `kv` | Storage backend: `kv` / `d1` / `hyperdrive` |

### Using PostgreSQL

Edit `docker-compose.yml`, uncomment the PostgreSQL service, set `DATABASE_URL` and `ACTIVE_DB=hyperdrive`.

### Build Locally

```bash
docker build -t telegram-chatbot .
docker run -d -p 3000:3000 -v data:/app/data telegram-chatbot
```

---

## 🔐 First Access

Default admin: `admin` / `admins`

Change the password immediately after first login and enable 2FA. The default admin is auto-disabled after the first real account is registered.

---

## 🧭 Setup Order

1. Login to WebUI → Change password → Enable 2FA
2. Set **Bot Token** (from @BotFather)
3. Set **Forum Group ID** (supergroup, system provides chat resolver)
4. Set **Admin Telegram IDs**
5. Set **Webhook URL**: `https://your-domain/webhook`
6. Adjust verification, moderation, and keyword filter settings
7. Test: user sends message → topic created → admin replies → user receives

---

## ⚙️ Configuration

### Bot

| Setting | Description |
| :--- | :--- |
| `BOT_TOKEN` | Telegram Bot Token |
| `FORUM_GROUP_ID` | Forum supergroup ID |
| `ADMIN_IDS` | Admin Telegram IDs (comma-separated) |

### Verification

| Setting | Description |
| :--- | :--- |
| `VERIFICATION_ENABLED` | Enable/disable verification |
| `CAPTCHA_TYPE` | `math` / `image_numeric` / `image_alphanumeric` |
| `VERIFICATION_TIMEOUT` | Timeout in seconds |
| `MAX_VERIFICATION_ATTEMPTS` | Max retry attempts |

### Moderation

| Setting | Description |
| :--- | :--- |
| `WHITELIST_ENABLED` | Whitelist toggle |
| `MAX_MESSAGES_PER_MINUTE` | Rate limit |
| `AUTO_UNBLOCK_ENABLED` | Appeal toggle |
| `BOT_COMMAND_FILTER` | Command filter |
| `ADMIN_NOTIFY_ENABLED` | Admin DM notifications |
| `ZALGO_FILTER_ENABLED` | Zalgo text filter |
| `MESSAGE_FILTER_RULES` | Keyword filter rules |
| `BOT_LOCALE` | Bot language (`zh-hans` / `zh-hant` / `en`) |

---

## 🗄️ Storage

| Backend | Use case | Complexity |
| :--- | :--- | :---: |
| KV | Small-medium, zero config | ⭐ |
| D1 | Medium-large, SQL queries | ⭐⭐ |
| Hyperdrive | Production, external DB | ⭐⭐⭐ |

Switch in WebUI settings with automatic data sync. SQL export supports plain / Base64 / AES-256-GCM encryption.

---

## 🛠️ Local Development

```bash
npm install
npm run build
npm run preview
```

> Full backend requires Cloudflare environment. Local is for frontend preview and build verification.

---

## 🩺 Troubleshooting

**WebUI 500 / blank page** — Check KV is bound with variable name `KV` (uppercase). Redeploy after binding.

**Webhook setup fails** — Verify Bot Token. URL must be public HTTPS: `https://domain/webhook`

**Messages not appearing** — Check forum group has topics enabled, bot has admin permissions, `FORUM_GROUP_ID` is correct (starts with `-100`)

**Forgot password** — With 2FA enabled, use the login page recovery flow. Without 2FA, manually edit storage.

**Docker has no HTTPS** — Use Cloudflare Tunnel or Nginx reverse proxy.

---

## 🛡️ Security

- Webhook verified via Secret Token header
- Passwords stored as `salt:sha256` hash
- TOTP two-factor authentication supported
- Default admin auto-disabled after first registration
- SQL export supports AES-256-GCM encryption
- All database queries use parameterized bindings

---

## 📄 License

See the `LICENSE` file in the repository root.
