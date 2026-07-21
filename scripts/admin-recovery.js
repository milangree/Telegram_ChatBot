#!/usr/bin/env node
// scripts/admin-recovery.js
// 运维侧管理员恢复工具（本地 / Docker）。
// 用途：列出 Web 管理员、重置密码、关闭 2FA、查看 bootstrap 状态。
// 注意：系统只存密码哈希，无法还原明文密码；只能重置。

import path from 'path'
import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function print(msg = '') {
  process.stdout.write(String(msg) + '\n')
}

function printErr(msg = '') {
  process.stderr.write(String(msg) + '\n')
}

function usage(exitCode = 0) {
  print(`管理员恢复工具（运维专用）

用法:
  node scripts/admin-recovery.js <command> [args] [options]

命令:
  list                         列出全部 Web 管理员账号
  show <username|id>           查看单个账号详情
  bootstrap                    查看初始管理员 bootstrap 状态
  reset-password <user>        重置密码（可 --password，否则随机生成）
  disable-2fa <user>           关闭账号 2FA
  create <username>            创建新的管理员账号
  hash-password [password]     仅生成密码哈希（用于 Cloudflare 手工恢复）
  help                         显示帮助

选项:
  --password <pwd>             指定新密码（至少 6 位）
  --yes, -y                    跳过确认
  --json                       JSON 输出（list/show/bootstrap）
  --active-db <kv|d1|hyperdrive>
                               覆盖 ACTIVE_DB（仅本命令）
  --kv-file <path>             覆盖 KV_FILE
  --d1-file <path>             覆盖 D1_FILE
  --database-url <url>         覆盖 DATABASE_URL

环境变量（与 server 一致）:
  KV_FILE / D1_FILE / DATABASE_URL / ACTIVE_DB / KV_PERSIST

示例:
  # 本地
  npm run admin -- list
  npm run admin -- reset-password ops --password 'NewPassw0rd!' --yes
  npm run admin -- disable-2fa ops --yes

  # Docker
  docker exec -it telegram-chatbot node scripts/admin-recovery.js list
  docker exec -it telegram-chatbot node scripts/admin-recovery.js reset-password admin --yes

  # Cloudflare 手工恢复：先生成哈希，再写入 KV/D1（见 README）
  npm run admin -- hash-password 'NewPassw0rd!'
`)
  process.exit(exitCode)
}

function parseArgs(argv) {
  const args = [...argv]
  const opts = {
    password: undefined,
    yes: false,
    json: false,
    activeDb: undefined,
    kvFile: undefined,
    d1File: undefined,
    databaseUrl: undefined,
    positional: [],
  }

  while (args.length) {
    const a = args.shift()
    if (a === '--yes' || a === '-y') opts.yes = true
    else if (a === '--json') opts.json = true
    else if (a === '--password') opts.password = args.shift()
    else if (a === '--active-db') opts.activeDb = args.shift()
    else if (a === '--kv-file') opts.kvFile = args.shift()
    else if (a === '--d1-file') opts.d1File = args.shift()
    else if (a === '--database-url') opts.databaseUrl = args.shift()
    else if (a === '--help' || a === '-h') opts.positional.unshift('help')
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length)
    else if (a.startsWith('-')) {
      printErr(`未知参数: ${a}`)
      usage(1)
    } else opts.positional.push(a)
  }
  return opts
}

function ensureCrypto() {
  if (typeof globalThis.crypto === 'undefined') {
    return import('crypto').then(({ webcrypto }) => {
      globalThis.crypto = webcrypto
    })
  }
  return Promise.resolve()
}

function redactUser(user, bootstrap = null) {
  if (!user) return null
  const disabledHash = String(user.password_hash || '').startsWith('!!disabled:')
  const isBootstrap = bootstrap?.defaultAdminId && bootstrap.defaultAdminId === user.id
  const bootstrapDisabled = isBootstrap && bootstrap?.state && bootstrap.state !== 'pending'
  return {
    id: user.id,
    username: user.username,
    is_admin: Boolean(user.is_admin === 1 || user.is_admin === true || user.is_admin === '1'),
    totp_enabled: Boolean(user.totp_enabled),
    created_at: user.created_at || null,
    password_disabled: disabledHash,
    bootstrap_account: Boolean(isBootstrap),
    login_blocked: Boolean(disabledHash || bootstrapDisabled),
  }
}

async function loadBootstrap(kv) {
  const raw = await kv.get('auth:bootstrap:v2')
  if (!raw) {
    const legacy = await kv.get('auth:has_default_admin')
    return legacy === '1'
      ? { version: 1, state: 'pending', legacy: true }
      : null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return { state: 'invalid', raw: String(raw).slice(0, 120) }
  }
}

async function findUser(db, ref) {
  if (!ref) return null
  const byId = await db.getWebUserById(ref)
  if (byId) return byId
  return db.getWebUser(ref)
}

async function confirmOrExit(opts, message) {
  if (opts.yes) return
  print(`${message}`)
  print('若确认，请追加 --yes 后重试。')
  process.exit(1)
}

function fileUrl(p) {
  return pathToFileURL(p).href
}

async function openDb(opts) {
  if (opts.kvFile) process.env.KV_FILE = path.resolve(opts.kvFile)
  if (opts.d1File) process.env.D1_FILE = path.resolve(opts.d1File)
  if (opts.databaseUrl) process.env.DATABASE_URL = opts.databaseUrl
  if (opts.activeDb) process.env.ACTIVE_DB = opts.activeDb

  // 默认对齐 Docker 路径，方便本地直接对着 data/ 操作
  if (!process.env.KV_FILE) {
    const dockerDefault = path.resolve(ROOT, 'data/kv-store.db')
    const legacy = path.resolve(ROOT, 'db.sqlite')
    if (fs.existsSync(dockerDefault)) process.env.KV_FILE = dockerDefault
    else if (fs.existsSync(legacy)) process.env.KV_FILE = legacy
    else process.env.KV_FILE = dockerDefault
  }

  const { LocalKV } = await import(fileUrl(path.join(ROOT, 'server/bindings/kv.js')))
  const { DB } = await import(fileUrl(path.join(ROOT, 'functions/_shared/db.js')))

  const kv = new LocalKV()
  let d1 = null
  if (process.env.D1_FILE || process.env.ACTIVE_DB === 'd1') {
    try {
      const { LocalD1 } = await import(fileUrl(path.join(ROOT, 'server/bindings/d1.js')))
      d1 = new LocalD1()
    } catch (e) {
      printErr(`[admin] D1 不可用，已跳过: ${e.message}`)
    }
  }

  let hyperdrive = null
  if (process.env.DATABASE_URL) {
    try {
      const { HyperdriveStore } = await import(fileUrl(path.join(ROOT, 'functions/_shared/db-hyperdrive.js')))
      hyperdrive = new HyperdriveStore({ connectionString: process.env.DATABASE_URL })
    } catch (e) {
      printErr(`[admin] Hyperdrive 不可用，已跳过: ${e.message}`)
    }
  }

  const db = new DB(kv, d1, hyperdrive)
  const active = await db.getActiveDb()
  return { db, kv, d1, hyperdrive, active }
}

function printUserTable(users) {
  if (!users.length) {
    print('（无 Web 管理员账号）')
    return
  }
  const rows = users.map(u => ({
    username: u.username,
    id: u.id,
    admin: u.is_admin ? 'yes' : 'no',
    totp: u.totp_enabled ? 'on' : 'off',
    login: u.login_blocked ? 'blocked' : 'ok',
    bootstrap: u.bootstrap_account ? 'yes' : 'no',
    created_at: u.created_at || '-',
  }))
  const cols = ['username', 'id', 'admin', 'totp', 'login', 'bootstrap', 'created_at']
  const widths = Object.fromEntries(cols.map(c => [c, Math.max(c.length, ...rows.map(r => String(r[c]).length))]))
  print(cols.map(c => c.padEnd(widths[c])).join('  '))
  print(cols.map(c => '-'.repeat(widths[c])).join('  '))
  for (const r of rows) print(cols.map(c => String(r[c]).padEnd(widths[c])).join('  '))
}

async function cmdList(opts) {
  const { db, kv, active } = await openDb(opts)
  const bootstrap = await loadBootstrap(kv)
  const users = (await db.getAllWebUsersRaw()).map(u => redactUser(u, bootstrap))
  if (opts.json) {
    print(JSON.stringify({ active_db: active, bootstrap, users }, null, 2))
    return
  }
  print(`active_db: ${active}`)
  print(`kv_file: ${process.env.KV_FILE}`)
  if (bootstrap) print(`bootstrap: state=${bootstrap.state || '?'} user=${bootstrap.defaultAdminUsername || '-'} id=${bootstrap.defaultAdminId || '-'}`)
  else print('bootstrap: (none)')
  print('')
  printUserTable(users)
  print('')
  print('说明: login=blocked 表示密码已禁用或初始账号已退役，不能登录。')
  print('密码哈希不会显示；系统无法还原明文密码，只能重置。')
}

async function cmdShow(opts, ref) {
  if (!ref) {
    printErr('请提供 username 或 id')
    process.exit(1)
  }
  const { db, kv, active } = await openDb(opts)
  const bootstrap = await loadBootstrap(kv)
  const user = await findUser(db, ref)
  if (!user) {
    printErr(`未找到账号: ${ref}`)
    process.exit(1)
  }
  const view = redactUser(user, bootstrap)
  if (opts.json) {
    print(JSON.stringify({ active_db: active, bootstrap, user: view }, null, 2))
    return
  }
  print(`active_db: ${active}`)
  print(`username: ${view.username}`)
  print(`id: ${view.id}`)
  print(`is_admin: ${view.is_admin}`)
  print(`totp_enabled: ${view.totp_enabled}`)
  print(`password_disabled: ${view.password_disabled}`)
  print(`bootstrap_account: ${view.bootstrap_account}`)
  print(`login_blocked: ${view.login_blocked}`)
  print(`created_at: ${view.created_at || '-'}`)
}

async function cmdBootstrap(opts) {
  const { kv, active } = await openDb(opts)
  const bootstrap = await loadBootstrap(kv)
  if (opts.json) {
    print(JSON.stringify({ active_db: active, bootstrap }, null, 2))
    return
  }
  print(`active_db: ${active}`)
  if (!bootstrap) {
    print('bootstrap: 无记录')
    return
  }
  print(JSON.stringify(bootstrap, null, 2))
}

async function resolvePassword(opts) {
  const { validatePassword, genToken } = await import(fileUrl(path.join(ROOT, 'functions/_shared/auth.js')))
  if (opts.password !== undefined) {
    if (!validatePassword(opts.password)) {
      printErr('密码长度至少 6 位')
      process.exit(1)
    }
    return { password: opts.password, generated: false }
  }
  return { password: genToken(20), generated: true }
}

async function cmdResetPassword(opts, ref) {
  if (!ref) {
    printErr('请提供 username 或 id')
    process.exit(1)
  }
  const { password, generated } = await resolvePassword(opts)
  await confirmOrExit(opts, `将重置账号「${ref}」的密码，并吊销其全部会话。`)

  const { db, kv, active } = await openDb(opts)
  const user = await findUser(db, ref)
  if (!user) {
    printErr(`未找到账号: ${ref}`)
    process.exit(1)
  }

  const { rotatePasswordAndRevokeSessions } = await import(fileUrl(path.join(ROOT, 'functions/_shared/auth.js')))
  await rotatePasswordAndRevokeSessions({ db, kv, userId: user.id, newPassword: password })

  print(`active_db: ${active}`)
  print(`已重置密码: ${user.username} (${user.id})`)
  print(`已吊销该账号全部会话`)
  if (generated) {
    print('='.repeat(60))
    print(`[SECURITY] 新密码（仅显示一次）: ${password}`)
    print('='.repeat(60))
  } else {
    print('新密码: 使用 --password 指定的值（不会回显）')
  }
}

async function cmdDisable2fa(opts, ref) {
  if (!ref) {
    printErr('请提供 username 或 id')
    process.exit(1)
  }
  await confirmOrExit(opts, `将关闭账号「${ref}」的 2FA。`)
  const { db, active } = await openDb(opts)
  const user = await findUser(db, ref)
  if (!user) {
    printErr(`未找到账号: ${ref}`)
    process.exit(1)
  }
  await db.setWebUserTotp(user.id, null, false)
  print(`active_db: ${active}`)
  print(`已关闭 2FA: ${user.username} (${user.id})`)
}

async function cmdCreate(opts, username) {
  if (!username || username.length < 3) {
    printErr('用户名至少 3 位')
    process.exit(1)
  }
  const { password, generated } = await resolvePassword(opts)
  await confirmOrExit(opts, `将创建管理员账号「${username}」。`)

  const { db, active } = await openDb(opts)
  if (await db.getWebUser(username)) {
    printErr(`用户名已存在: ${username}`)
    process.exit(1)
  }
  const { hashPw } = await import(fileUrl(path.join(ROOT, 'functions/_shared/auth.js')))
  const user = await db.createWebUser(username, await hashPw(password))
  print(`active_db: ${active}`)
  print(`已创建管理员: ${user.username} (${user.id})`)
  if (generated) {
    print('='.repeat(60))
    print(`[SECURITY] 临时密码（仅显示一次）: ${password}`)
    print('='.repeat(60))
  } else {
    print('密码: 使用 --password 指定的值（不会回显）')
  }
}

async function cmdHashPassword(opts, maybePassword) {
  await ensureCrypto()
  const password = opts.password !== undefined ? opts.password : maybePassword
  const { validatePassword, hashPw } = await import(fileUrl(path.join(ROOT, 'functions/_shared/auth.js')))
  if (!validatePassword(password)) {
    printErr('密码长度至少 6 位')
    printErr('用法: node scripts/admin-recovery.js hash-password <password>')
    process.exit(1)
  }
  const hash = await hashPw(password)
  print(hash)
  printErr('')
  printErr('已生成 password_hash。请把它写入存储中的 password_hash 字段。')
  printErr('注意：同时应更新 auth:session_epoch:<userId>，使旧会话失效。详见 README。')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const [cmd, ...rest] = opts.positional
  if (!cmd || cmd === 'help') usage(0)

  // hash-password 不需要打开数据库
  if (cmd === 'hash-password') {
    await ensureCrypto()
    await cmdHashPassword(opts, rest[0])
    return
  }

  await ensureCrypto()

  switch (cmd) {
    case 'list':
      await cmdList(opts)
      break
    case 'show':
      await cmdShow(opts, rest[0])
      break
    case 'bootstrap':
      await cmdBootstrap(opts)
      break
    case 'reset-password':
      await cmdResetPassword(opts, rest[0])
      break
    case 'disable-2fa':
      await cmdDisable2fa(opts, rest[0])
      break
    case 'create':
      await cmdCreate(opts, rest[0])
      break
    default:
      printErr(`未知命令: ${cmd}`)
      usage(1)
  }
}

main().catch((e) => {
  printErr(`[admin] 失败: ${e?.stack || e?.message || e}`)
  process.exit(1)
})
