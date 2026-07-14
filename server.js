// server.js — Wanfunzy storefront. Zero external dependencies.
// Run with: node server.js

'use strict';

// ─────────────────────────────────────────────
//  Core modules
// ─────────────────────────────────────────────
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const url    = require('url');

// ─────────────────────────────────────────────
//  Internal modules
// ─────────────────────────────────────────────
const db   = require('./db');
const khqr = require('./khqr');

const { renderHome }              = require('./views/home');
const { renderAdminLogin }        = require('./views/admin-login');
const { renderAdminDashboard }    = require('./views/admin-dashboard');
const { renderOrderConfirmation } = require('./views/order-confirmation');
const { renderTrackOrder }        = require('./views/track-order');
const { renderNotFound }          = require('./views/not-found');
const { renderTopupSelect }       = require('./views/topup-select');
const { renderTopupPackage }      = require('./views/topup-package');
// resolveLang is now self-contained below (i18n.js import removed to avoid version-mismatch crashes)

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
const SESSION_COOKIE = 'wanfunzy_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const VALID_CATEGORIES = ['passes', 'firsttopup', 'bonusDiamond', 'pureDiamond'];
const SECTION_KEYS     = ['passes', 'firstTopup', 'bonusDiamond', 'pureDiamond'];
const PKG_IMAGE_KEYS   = { special: 'specialOfferImages', package: 'packageImages' };

const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_DURATION_MS  = 1000 * 60 * 15; // 15 minutes

// ─────────────────────────────────────────────
//  KHQR / Bakong config
// ─────────────────────────────────────────────
const KHQR_CONFIG = {
  token:            process.env.BAKONG_TOKEN           || '',
  accountId:        process.env.BAKONG_ACCOUNT_ID      || '',
  apiBase:          process.env.BAKONG_API_BASE        || 'https://api-bakong.nbc.gov.kh',
  merchantName:     process.env.KHQR_MERCHANT_NAME     || 'WANFUNZY',
  merchantCity:     process.env.KHQR_MERCHANT_CITY     || 'Phnom Penh',
  appIconUrl:       process.env.KHQR_APP_ICON_URL      || '',
  deeplinkCallback: process.env.KHQR_DEEPLINK_CALLBACK || '',
  expireMinutes:    10
};

function khqrAutoEnabled() {
  return !!(KHQR_CONFIG.token && KHQR_CONFIG.accountId);
}

const khqrCheckThrottle      = new Map(); // orderCode -> lastCheckMs
const KHQR_MIN_CHECK_GAP_MS  = 4000;
const KHQR_POLL_INTERVAL_MS  = 45 * 1000;
const KHQR_POLL_ORDER_GAP_MS = 800;

// ─────────────────────────────────────────────
//  Startup diagnostics
// ─────────────────────────────────────────────
console.log('[KHQR] auto-verify enabled:', khqrAutoEnabled());
console.log('[KHQR] accountId:', KHQR_CONFIG.accountId || '(not set)');
console.log('[KHQR] apiBase:', KHQR_CONFIG.apiBase);
console.log('[KHQR] token set:', KHQR_CONFIG.token
  ? `yes (length=${KHQR_CONFIG.token.length})`
  : 'NO — deeplink and auto-verify disabled');
console.log('[MooGold] auto-fulfill enabled:', moogoldEnabled());

// ═════════════════════════════════════════════
//  MooGold API
// ═════════════════════════════════════════════

function moogoldEnabled() {
  return !!(process.env.MOOGOLD_PARTNER_ID && process.env.MOOGOLD_SECRET_KEY);
}

function moogoldAuth(payload, reqPath) {
  const partnerId = process.env.MOOGOLD_PARTNER_ID;
  const secretKey = process.env.MOOGOLD_SECRET_KEY;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const basicAuth = Buffer.from(`${partnerId}:${secretKey}`).toString('base64');
  const authSig   = crypto.createHmac('sha256', secretKey)
    .update(JSON.stringify(payload) + timestamp + reqPath).digest('hex');
  return { basicAuth, authSig, timestamp };
}

function moogoldRequest(reqPath, payload, signingPayload, _retried) {
  return new Promise((resolve, reject) => {
    const { basicAuth, authSig, timestamp } = moogoldAuth(signingPayload || payload, reqPath);
    const body         = JSON.stringify(payload);
    const workerUrl    = process.env.MOOGOLD_WORKER_URL;
    const workerSecret = process.env.MOOGOLD_WORKER_SECRET;

    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization':  `Basic ${basicAuth}`,
      'auth':           authSig,
      'timestamp':      timestamp
    };

    let hostname, reqPathFinal;
    if (workerUrl && workerSecret) {
      const u = new URL(`${workerUrl}/${reqPath}`);
      hostname     = u.hostname;
      reqPathFinal = u.pathname;
      headers['x-worker-secret'] = workerSecret;
      console.log('[MooGold] via Worker:', u.href);
    } else {
      hostname     = 'moogold.com';
      reqPathFinal = `/wp-json/v1/api/${reqPath}`;
    }

    const req = https.request({ hostname, path: reqPathFinal, method: 'POST', headers, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', c => {
        data += c;
        if (data.length > 64 * 1024) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch (e) { return reject(new Error('Bad JSON from MooGold')); }

        // [FIX] err_code 426 = "Timestamp is incorrect". moogoldAuth()
        // always mints a brand-new timestamp per call, so this is almost
        // always a transient issue (slow network, cold container start,
        // brief clock skew) rather than a real bug — the request just
        // arrived at MooGold slightly outside their acceptance window.
        // Retry ONCE, automatically, with a freshly generated timestamp
        // + signature. If it still fails after the retry, surface the
        // error normally so it doesn't loop forever.
        const errCode = parsed && (parsed.err_code || (parsed.data && parsed.data.err_code));
        if (!_retried && (errCode === '426' || errCode === 426)) {
          console.log('[MooGold] err 426 (Timestamp is incorrect) — retrying once with a fresh timestamp for', reqPath);
          return resolve(moogoldRequest(reqPath, payload, signingPayload, true));
        }

        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('MooGold timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fulfillWithMooGold(order) {
  if (!moogoldEnabled())       return { ok: false, error: 'MooGold not configured' };
  if (!order.moogoldProductId) return { ok: false, error: 'No moogoldProductId' };

  const isMlbb = (order.gameId   || '').toLowerCase() === 'mlbb' ||
                 (order.gameName || '').toLowerCase().includes('mobile legend');
  let gameRequiresServer = isMlbb;
  try {
    const snap    = db.readDB();
    const gameDoc = snap.games && snap.games.find(g => g.id === order.gameId);
    if (gameDoc && gameDoc.requiresServerId) gameRequiresServer = true;
  } catch (e) { /* non-fatal */ }

  if (gameRequiresServer && !order.serverId) {
    console.log('[MooGold] BLOCKED — missing Server/Zone ID for', order.gameId, '| order:', order.code);
    return { ok: false, error: `Server/Zone ID ត្រូវតែបញ្ចូលសម្រាប់ game នេះ (${order.gameName || order.gameId})` };
  }

  const orderData = {
    category:     1,
    'product-id': Number(order.moogoldProductId),
    quantity:     1,
    'User ID':    String(order.playerId)
  };
  if (order.serverId) orderData['Server'] = String(order.serverId);

  console.log('[MooGold] create_order payload:', JSON.stringify({
    'product-id': order.moogoldProductId, 'User ID': order.playerId,
    'Server': order.serverId || '(none)'
  }));

  const signingPayload = { path: 'order/create_order', data: orderData };
  const payload        = { path: 'order/create_order', data: orderData, partnerOrderId: order.code };

  try {
    const result = await moogoldRequest('order/create_order', payload, signingPayload);
    console.log('[MooGold] create_order response:', JSON.stringify(result));
    const r = (result && result.data && typeof result.data === 'object') ? result.data : result;
    const isOk = r && (
      r.status === true || r.status === 'true' || r.status === 'processing' ||
      r.status === 'completed' || r.message === 'Order has been created successfully' || !!(r.order_id)
    );
    console.log('[MooGold] isOk:', isOk, '| status:', r && r.status, '| msg:', r && r.message);
    if (isOk) return {
      ok: true,
      moogoldOrderId: (r.account_details && r.account_details.order_id) || r.order_id || null,
      status: r.status || 'processing'
    };
    if (r && (r.err_code === '420' || r.err_code === 420)) return { ok: true, status: 'duplicate-ignored' };
    if (r && r.status === 'refunded')
      return { ok: false, error: 'MooGold refunded — Player ID ឬ Server ID មិនត្រឹមត្រូវ', refunded: true, moogoldOrderId: r.order_id || null };
    if (r && (r.err_code === '111' || r.err_code === 111)) return { ok: false, error: 'MooGold: Insufficient Balance — សូមបញ្ចូលទឹកប្រាក់ MooGold!' };
    if (r && (r.err_code === '422' || r.err_code === 422)) return { ok: false, error: 'MooGold: Product ID មិនត្រឹមត្រូវ ឬ មិនទាន់ authorized' };
    if (r && (r.err_code === '114' || r.err_code === 114)) return { ok: false, error: 'MooGold: Product Out of Stock!' };
    if (r && (r.err_code === '426' || r.err_code === 426)) return { ok: false, error: 'MooGold: Timestamp mismatch (retried once, still failing) — server clock ឬ network delay ខុសប្រក្រតី' };
    return { ok: false, error: `MooGold err ${r && r.err_code}: ${r && r.err_message} | raw: ${JSON.stringify(result).slice(0, 300)}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function validatePlayerWithMooGold(productId, playerId, serverId) {
  if (!moogoldEnabled() || !productId) return { ok: null };
  const payload = {
    path: 'product/validate',
    data: { 'product-id': String(productId), 'User ID': String(playerId), ...(serverId ? { 'Server': String(serverId) } : {}) }
  };
  try {
    const result = await moogoldRequest('product/validate', payload, payload);
    console.log('[MooGold] validate:', JSON.stringify(result).slice(0, 200));
    if (result && (result.status === true || result.status === 'true'))
      return { ok: true, username: result.username || '', message: result.message || '' };
    const msg  = (result && (result.message || result.err_message)) || '';
    const code = (result && (result.code || result.err_code)) || '';
    const httpStatus = (result && result.data && result.data.status) || 0;
    const notAuthorized =
      code === 'rest_no_route' || httpStatus === 404 ||
      msg.toLowerCase().includes('validation is not available') ||
      msg.toLowerCase().includes('kindly contact') ||
      msg.toLowerCase().includes('no route was found');
    if (notAuthorized) {
      console.log('[MooGold] validate endpoint not authorized — hybrid mode');
      return { ok: null, skipped: true, message: msg };
    }
    return { ok: false, message: msg || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ' };
  } catch (e) { console.error('[MooGold] validate error:', e.message); return { ok: null, error: e.message }; }
}

async function validateMLBBPlayer(playerId, serverId, moogoldProductId) {
  // Tier 1: Cloudflare Worker
  const workerUrl = process.env.MLBB_WORKER_URL;
  if (workerUrl) {
    try {
      const result = await new Promise((resolve) => {
        const body         = JSON.stringify({ playerId: String(playerId), serverId: String(serverId || '0') });
        const workerSecret = process.env.MLBB_WORKER_SECRET || '';
        let u;
        try { u = new URL(workerUrl); } catch (e) { return resolve({ ok: null, error: 'Bad worker URL' }); }
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
        if (workerSecret) headers['X-Worker-Secret'] = workerSecret;
        const req = https.request(
          { hostname: u.hostname, path: u.pathname, method: 'POST', headers, timeout: 8000 },
          (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.ok === true && json.username) resolve({ ok: true, username: json.username });
                else if (json.ok === false)            resolve({ ok: false, message: json.message || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ' });
                else                                   resolve({ ok: null, error: 'Worker response unclear' });
              } catch (e) { resolve({ ok: null, error: 'Parse error' }); }
            });
          }
        );
        req.on('error',   e  => resolve({ ok: null, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: null, error: 'Worker timeout' }); });
        req.write(body); req.end();
      });
      console.log('[MLBB] Worker result:', result.ok, result.username || result.message);
      if (result.ok === true || result.ok === false) return result;
      console.log('[MLBB] Worker unavailable:', result.error, '— trying MooGold validate');
    } catch (e) { console.log('[MLBB] Worker threw:', e.message, '— trying MooGold validate'); }
  }

  // Tier 2: MooGold product/validate
  if (moogoldProductId && moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(moogoldProductId, playerId, serverId);
    if (mgResult.ok === true && mgResult.username) {
      console.log('[MLBB] MooGold validate SUCCESS:', mgResult.username);
      return { ok: true, username: mgResult.username };
    }
    if (mgResult.ok === false) {
      console.log('[MLBB] MooGold validate BLOCKED:', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[MLBB] MooGold validate not authorized — hybrid mode');
  }

  // Tier 3: Hybrid pass
  console.log('[MLBB] All validate paths unavailable — hybrid pass for', playerId);
  return { ok: null, error: 'all paths unavailable' };
}

async function pollMooGoldOrderStatus(orderCode, moogoldOrderId, maxAttempts = 30) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < maxAttempts; i++) {
    await delay(2 * 60 * 1000);
    try {
      const payload = { path: 'order/order_detail_partner_id', partner_order_id: orderCode };
      const result  = await moogoldRequest('order/order_detail_partner_id', payload);
      const status  = result && result.order_status;
      console.log(`[MooGold] poll #${i + 1}/${maxAttempts} for ${orderCode} | status: ${status}`);
      if (status === 'completed') {
        const data = db.readDB();
        const o    = data.orders.find(o => o.code === orderCode);
        if (o) { o.moogoldStatus = 'completed'; o.status = 'delivered'; o.note = appendNote(o.note, '✅ MooGold completed'); o.updatedAt = new Date().toISOString(); db.writeDB(data); }
        notifyTelegram(`🎮 <b>Diamond បញ្ចូលរួចរាល់! ✅</b>\n🔖 Code: ${orderCode}\n🆔 MooGold Order: ${result.order_id || moogoldOrderId}`);
        return;
      }
      if (status === 'refunded' || status === 'incorrect-details') {
        const data = db.readDB();
        const o    = data.orders.find(o => o.code === orderCode);
        if (o) { o.moogoldStatus = status; o.note = appendNote(o.note, `🔴 MooGold ${status}`); o.updatedAt = new Date().toISOString(); db.writeDB(data); }
        notifyTelegram(`🔴 <b>MooGold ${status.toUpperCase()}!</b>\n🔖 Code: ${orderCode}\n🆔 MooGold Order: ${result.order_id || moogoldOrderId}\n⚠️ <b>ពិនិត្យ Player ID + Zone ID!</b>`);
        return;
      }
    } catch (e) { console.error('[MooGold] poll error for', orderCode, ':', e.message); }
  }
  console.log(`[MooGold] poll timeout for ${orderCode} after ${maxAttempts} attempts`);
  const data = db.readDB();
  const o    = data.orders.find(o => o.code === orderCode);
  if (o) { o.moogoldStatus = 'timeout'; o.note = appendNote(o.note, '⏳ MooGold poll timeout (60 min) — check portal'); o.updatedAt = new Date().toISOString(); db.writeDB(data); }
  notifyTelegram(`⏳ <b>MooGold មិនទាន់ confirmed (60 នាទី)</b>\n🔖 Code: ${orderCode}\n🆔 MooGold Order: ${moogoldOrderId || '?'}\n🔔 <b>ចូល MooGold portal ពិនិត្យ Order #${moogoldOrderId}!</b>`);
}

// ═════════════════════════════════════════════
//  Telegram notifications
// ═════════════════════════════════════════════

function notifyTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const req = https.request(
    { hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
    (res) => { res.on('data', () => {}); res.on('end', () => {}); }
  );
  req.on('error', err => console.error('Telegram notify failed:', err.message));
  req.write(payload); req.end();
}


// ═════════════════════════════════════════════
//  Utility helpers
// ═════════════════════════════════════════════

function appendNote(existing, segment) {
  return existing ? `${existing} | ${segment}` : segment;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Payload too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end',   () => resolve(data));
    req.on('error', reject);
  });
}

function parseBody(req, raw) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
  }
  const out = {};
  for (const [k, v] of new url.URLSearchParams(raw || '')) out[k] = v;
  return out;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function getLang(req) {
  if (!req) return 'km';
  const lang = parseCookies(req).lang;
  return (lang === 'en') ? 'en' : 'km';
}

function isAwaitingKhqrPayment(order) {
  if (!order) return false;
  if (order.paymentStatus === 'cancelled') return true;
  if (!order.khqr || order.paymentStatus !== 'awaiting') return false;
  return order.khqr.expiresAt && Date.now() <= order.khqr.expiresAt;
}

function isHoneypotTripped(body) {
  return !!(body.website && String(body.website).trim().length > 0);
}

function verifyTransaction(tx, order) {
  const amountOk   = Math.abs(Number(tx.amount) - Number(order.price)) < 0.005;
  const currencyOk = !tx.currency    || String(tx.currency).toUpperCase()    === 'USD';
  const accountOk  = !tx.toAccountId || String(tx.toAccountId).toLowerCase() === KHQR_CONFIG.accountId.toLowerCase();
  return amountOk && currencyOk && accountOk;
}


// ═════════════════════════════════════════════
//  Session & auth
// ═════════════════════════════════════════════

function getSession(req) {
  const token   = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const data    = db.readDB();
  const session = data.sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) { delete data.sessions[token]; db.writeDB(data); return null; }
  return { token, ...session };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) { send(res, 302, '', { Location: '/admin/login' }); return null; }
  if (!session.csrfToken) {
    const data = db.readDB();
    if (data.sessions[session.token]) {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      data.sessions[session.token].csrfToken = csrfToken;
      db.writeDB(data); session.csrfToken = csrfToken;
    }
  }
  return session;
}

function requireCsrf(req, res, session) {
  const provided = req.headers['x-csrf-token'];
  if (!provided || provided !== session.csrfToken) {
    sendJSON(res, 403, { ok: false, error: 'ការស្នើសុំមិនត្រឹមត្រូវ (CSRF token missing/invalid)។ សូម Refresh ទំព័រ ហើយសាកល្បងម្តងទៀត។' });
    return false;
  }
  return true;
}

// ─── Rate limiting ────────────────────────────
const rateLimitBuckets = new Map();
function isRateLimited(ip, bucket = 'login', maxAttempts = 8, windowMs = 60 * 1000) {
  const key   = `${bucket}:${ip}`;
  const now   = Date.now();
  const entry = rateLimitBuckets.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) { entry.count = 0; entry.windowStart = now; }
  entry.count += 1;
  rateLimitBuckets.set(key, entry);
  return entry.count > maxAttempts;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateLimitBuckets) if (now - e.windowStart > 3600 * 1000) rateLimitBuckets.delete(k);
}, 10 * 60 * 1000);

// ─── Account lockout ──────────────────────────
const loginFailures = new Map();
function isLockedOut(ip) {
  const entry = loginFailures.get(ip);
  if (!entry || !entry.lockedUntil) return false;
  if (Date.now() > entry.lockedUntil) { loginFailures.delete(ip); return false; }
  return true;
}
function recordLoginFailure(ip) {
  const entry = loginFailures.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= LOCKOUT_MAX_FAILURES) entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  loginFailures.set(ip, entry);
}
function clearLoginFailures(ip) { loginFailures.delete(ip); }
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of loginFailures) if (e.lockedUntil && now > e.lockedUntil) loginFailures.delete(ip);
}, 10 * 60 * 1000);

// ─── Session cleanup ──────────────────────────
setInterval(() => {
  try {
    const data = db.readDB(); const now = Date.now(); let removed = 0;
    for (const [token, session] of Object.entries(data.sessions || {}))
      if (session.expiresAt && now > session.expiresAt) { delete data.sessions[token]; removed++; }
    if (removed > 0) db.writeDB(data);
  } catch (e) { /* best-effort */ }
}, 3600 * 1000);


// ═════════════════════════════════════════════
//  Cloudflare Turnstile (optional CAPTCHA)
// ═════════════════════════════════════════════

function turnstileEnabled() { return !!process.env.TURNSTILE_SECRET_KEY; }

async function verifyTurnstile(token, ip) {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', process.env.TURNSTILE_SECRET_KEY);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);
    const postData = params.toString();
    const result = await new Promise((resolve) => {
      const req = https.request(
        { hostname: 'challenges.cloudflare.com', path: '/turnstile/v0/siteverify', method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }, timeout: 8000 },
        (resp) => { let data = ''; resp.on('data', c => { data += c; }); resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false }); } }); }
      );
      req.on('error',   () => resolve({ success: false }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
      req.write(postData); req.end();
    });
    return !!result.success;
  } catch (e) { return false; }
}


// ═════════════════════════════════════════════
//  Static file serving
// ═════════════════════════════════════════════

const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  if (safePath.startsWith(`uploads${path.sep}`) || safePath.startsWith('uploads/')) {
    const uploadsRoot = db.getUploadsDir();
    const filePath    = path.join(uploadsRoot, safePath.replace(/^uploads[/\\]/, ''));
    if (!filePath.startsWith(uploadsRoot)) return send(res, 403, 'Forbidden');
    return fs.readFile(filePath, (err, content) => {
      if (err) return send(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(content);
    });
  }
  const filePath = path.join(__dirname, 'public', safePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

// ═════════════════════════════════════════════
//  Shared paid + fulfill pipeline
// ═════════════════════════════════════════════

function confirmOrderPaidAndFulfill(order, data) {
  order.paymentStatus = 'paid';
  order.paidAt        = new Date().toISOString();
  order.paymentMethod = order.paymentMethod || 'khqr-auto';
  order.note          = appendNote(order.note, '✅ KHQR paid (auto-verified)');
  order.updatedAt     = new Date().toISOString();
  db.writeDB(data);
  khqrCheckThrottle.delete(order.code);

  notifyTelegram(
    `💰 <b>ទទួលបានការទូទាត់ KHQR (auto)</b>\n🔖 Code: ${order.code}\n` +
    `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
    `🎮 ${order.gameName} — Player ${order.playerId}${order.serverId ? ` (Server ${order.serverId})` : ''}`
  );

  (async () => {
    const dbData   = db.readDB();
    const orderRef = dbData.orders.find(o => o.code === order.code);
    const pkg      = dbData.packages && dbData.packages.find(p => p.id === order.packageId);
    if (orderRef) {
      if (pkg && pkg.moogoldProductId) orderRef.moogoldProductId = pkg.moogoldProductId;
      orderRef.playerId = orderRef.playerId || order.playerId;
      orderRef.serverId = orderRef.serverId || order.serverId;
      orderRef.gameId   = orderRef.gameId   || order.gameId;
      orderRef.gameName = orderRef.gameName || order.gameName;
      console.log('[MooGold] fulfill fields → playerId:', orderRef.playerId,
        '| serverId:', orderRef.serverId || '(none)', '| gameId:', orderRef.gameId,
        '| moogoldProductId:', orderRef.moogoldProductId);
    }
    const fulfillResult = await fulfillWithMooGold(orderRef || order);
    console.log('[MooGold] fulfill result for', order.code, ':', JSON.stringify(fulfillResult));
    const dbData2 = db.readDB();
    const o2      = dbData2.orders.find(o => o.code === order.code);
    if (o2) {
      if (fulfillResult.ok) {
        o2.moogoldOrderId = fulfillResult.moogoldOrderId;
        o2.moogoldStatus  = fulfillResult.status;
        o2.status         = 'confirmed';
        o2.note           = appendNote(o2.note, `🎮 MooGold #${fulfillResult.moogoldOrderId || 'submitted'}`);
        notifyTelegram(
          `💰 <b>ទទួលប្រាក់ + Diamond ✅</b>\n🔖 Code: ${order.code}\n` +
          `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
          `🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ` (${order.serverId})` : ''}\n` +
          `🆔 MooGold Order: ${fulfillResult.moogoldOrderId || '(processing)'}\n✅ Diamond កំពុងបញ្ចូល!`
        );
        if (fulfillResult.status === 'processing')
          pollMooGoldOrderStatus(order.code, fulfillResult.moogoldOrderId)
            .catch(e => console.error('[MooGold] poll start error:', e.message));
      } else {
        o2.moogoldError = fulfillResult.error;
        o2.note = appendNote(o2.note, `${fulfillResult.refunded ? '🔴 REFUNDED' : '⚠️ Error'}: ${fulfillResult.error}`);
        notifyTelegram(
          `💰 <b>ទទួលប្រាក់ ✅ — MooGold ⚠️</b>\n🔖 Code: ${order.code}\n` +
          `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
          `🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ` (${order.serverId})` : ''}\n` +
          `❌ ${fulfillResult.error}\n🔔 <b>បញ្ចូល Diamond ដោយដៃ!</b>`
        );
      }
      o2.updatedAt = new Date().toISOString();
      db.writeDB(dbData2);
    }
  })().catch(e => console.error('[MooGold] fulfill error:', e.message));
}

async function pollPendingKhqrOrders() {
  if (!khqrAutoEnabled()) return;
  let data;
  try { data = db.readDB(); } catch (e) { console.error('[KHQR poll] readDB failed:', e.message); return; }
  const candidates = data.orders.filter(o =>
    !o.deleted && o.channel === 'topup' && o.paymentStatus !== 'paid' &&
    o.status !== 'cancelled' && o.khqr && o.khqr.md5 &&
    (!o.khqr.expiresAt || Date.now() <= o.khqr.expiresAt)
  );
  if (!candidates.length) return;
  console.log('[KHQR poll] sweeping', candidates.length, 'pending order(s)');
  for (const order of candidates) {
    try {
      const result = await khqr.checkTransactionByMd5(order.khqr.md5, KHQR_CONFIG);
      if (!result || result.responseCode !== 0 || !result.data) continue;
      if (!verifyTransaction(result.data, order)) { console.log('[KHQR poll] mismatch for', order.code); continue; }
      const freshData  = db.readDB();
      const freshOrder = freshData.orders.find(o => o.code === order.code);
      if (!freshOrder || freshOrder.paymentStatus === 'paid') continue;
      console.log('[KHQR poll] confirmed payment for', order.code, '(background sweep)');
      confirmOrderPaidAndFulfill(freshOrder, freshData);
    } catch (e) { console.error('[KHQR poll] check failed for', order.code, ':', e.message); }
    await new Promise(r => setTimeout(r, KHQR_POLL_ORDER_GAP_MS));
  }
}
setInterval(
  () => pollPendingKhqrOrders().catch(e => console.error('[KHQR poll] sweep error:', e.message)),
  KHQR_POLL_INTERVAL_MS
);


// ═════════════════════════════════════════════
//  Route handlers — public
// ═════════════════════════════════════════════

async function handleHome(req, res) {
  const data = db.readDB();
  send(res, 200, renderHome({ games: data.games.filter(g => g.active), packages: data.packages.filter(p => p.active), settings: data.settings }));
}

async function handleTopupSelectPage(req, res) {
  const data = db.readDB();
  send(res, 200, renderTopupSelect({ games: data.games, settings: data.settings, lang: getLang(req) }));
}

async function handleTopupPackagePage(req, res, query) {
  const gameId = (query.game || '').trim();
  const data   = db.readDB();
  const game   = data.games.find(g => g.id === gameId && g.active);
  if (game) {
    const isMlbb = gameId === 'mlbb' || (game.name || '').toLowerCase().includes('mobile legend');
    if (isMlbb) return send(res, 302, '', { Location: '/mlbb' });
  }
  if (!game) return send(res, 404, renderNotFound());
  const packages = data.packages.filter(p => p.gameId === game.id && p.active);
  send(res, 200, renderTopupPackage({ game, packages, settings: data.settings, lang: getLang(req), turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '', khqrAuto: khqrAutoEnabled() }));
}

async function handleTopupCheckoutPage(req, res, query) {
  const gameId = (query.game || '').trim();
  return send(res, 302, '', { Location: gameId ? `/topup/order?game=${encodeURIComponent(gameId)}` : '/topup' });
}

async function handleMlbbCheckoutPage(req, res) {
  const data = db.readDB();
  const game = data.games.find(g => g.id === 'mlbb' || (g.name || '').toLowerCase().includes('mobile legend'));
  if (!game) return send(res, 404, renderNotFound());
  const packages = data.packages.filter(p => p.gameId === game.id && p.active);
  return send(res, 200, renderTopupPackage({ game, packages, settings: data.settings, lang: getLang(req), turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '', khqrAuto: khqrAutoEnabled() }));
}

async function handleMlbbPackagesApi(req, res) {
  try {
    const data     = db.readDB();
    const mlbbGame = data.games.find(g => g.id === 'mlbb' || (g.name || '').toLowerCase().includes('mobile legend'));
    if (!mlbbGame) return sendJSON(res, 404, { ok: false, error: 'MLBB not configured' });
    const allPkgs    = data.packages.filter(p => p.gameId === mlbbGame.id && p.active);
    const passes     = allPkgs.filter(p => /pass|pack|value/i.test(p.name));
    const firsttopup = allPkgs.filter(p => /first|1st/i.test(p.name));
    const standard   = allPkgs.filter(p => !/pass|pack|value|first|1st/i.test(p.name)).sort((a, b) => a.price - b.price);
    const gameLogos       = (data.settings && data.settings.gameLogos)       || {};
    const cardBackgrounds = (data.settings && data.settings.cardBackgrounds)  || {};
    return sendJSON(res, 200, {
      ok: true,
      game: { id: mlbbGame.id, name: mlbbGame.name, currencyUnit: mlbbGame.currencyUnit || '💎',
        logoUrl:   gameLogos[mlbbGame.id]       ? `/static/uploads/${gameLogos[mlbbGame.id]}`       : null,
        bannerUrl: cardBackgrounds[mlbbGame.id]  ? `/static/uploads/${cardBackgrounds[mlbbGame.id]}` : null },
      packages: { passes, firsttopup, standard }
    });
  } catch (e) { return sendJSON(res, 500, { ok: false, error: e.message }); }
}

async function handleTermsPage(req, res) {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'terms.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (e) { send(res, 404, '<h1>Terms page not found.</h1><p>Upload public/terms.html</p>'); }
}

async function handleOrderConfirmationPage(req, res, query) {
  const code  = (query.code || '').trim();
  const data  = db.readDB();
  const order = data.orders.find(o => o.code === code);
  if (!order) return send(res, 404, renderNotFound());
  send(res, 200, renderOrderConfirmation({ order, paid: query.paid === '1' || order.paymentStatus === 'paid' }));
}

async function handleTrackOrderPage(req, res, query) {
  const code  = (query.code || '').trim();
  const data  = db.readDB();
  const order = code ? data.orders.find(o => o.code === code.toUpperCase()) : null;
  send(res, 200, renderTrackOrder({ order, searched: !!code }));
}

async function handleDebugIp(req, res) {
  const req2 = https.request({ hostname: 'api.ipify.org', path: '/?format=json', method: 'GET', timeout: 5000 }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try { sendJSON(res, 200, { ok: true, outboundIp: JSON.parse(data).ip }); }
      catch (e) { sendJSON(res, 500, { ok: false, error: 'Could not parse ipify response' }); }
    });
  });
  req2.on('error',   e  => sendJSON(res, 500, { ok: false, error: e.message }));
  req2.on('timeout', () => { req2.destroy(); sendJSON(res, 500, { ok: false, error: 'timeout' }); });
  req2.end();
}

// ─────────────────────────────────────────────
//  Order creation — legacy (handleCreateOrder)
// ─────────────────────────────────────────────
async function handleCreateOrder(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'order', 10, 60 * 1000)) return sendJSON(res, 429, { ok: false, error: 'សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំមួយភ្លែត។' });
  const raw  = await readBody(req);
  const body = parseBody(req, raw);
  if (isHoneypotTripped(body)) return sendJSON(res, 400, { ok: false, error: 'មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។' });

  const playerId  = (body.playerId  || '').trim();
  const serverId  = (body.serverId  || '').trim();
  const packageId = (body.packageId || '').trim();
  const gameId    = (body.gameId    || '').trim();
  const contact   = (body.contact   || '').trim();
  const note      = (body.note      || '').trim().slice(0, 500);
  const data      = db.readDB();
  const game      = data.games.find(g => g.id === gameId && g.active);
  const errors    = [];

  if (!playerId || playerId.length < 4 || playerId.length > 20 || !/^[0-9]+$/.test(playerId)) errors.push('Player ID ត្រូវតែជាលេខ និងមានប្រវែងត្រឹមត្រូវ។');
  if (!game) errors.push('Game ដែលជ្រើសរើសមិនត្រឹមត្រូវ។');
  else if (game.requiresServerId && (!serverId || !/^[0-9]{1,6}$/.test(serverId))) errors.push('Server ID មិនត្រឹមត្រូវ។');
  if (!contact || contact.length < 5 || contact.length > 100) errors.push('សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Telegram សម្រាប់ទាក់ទងវិញ។');
  const pkg = data.packages.find(p => p.id === packageId && p.active && p.gameId === gameId);
  if (!pkg) errors.push('កញ្ចប់ដែលជ្រើសរើសមិនត្រឹមត្រូវ ឬលែងមានទៀតហើយ។');
  if (errors.length) return sendJSON(res, 400, { ok: false, errors });

  const order = {
    id: db.genId('order'), code: db.genOrderCode(),
    gameId: game.id, gameName: game.name,
    playerId, serverId: serverId || '', contact, note,
    packageId: pkg.id, packageName: pkg.name, price: pkg.price, currency: pkg.currency,
    status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  data.orders.unshift(order); db.writeDB(data);
  sendJSON(res, 201, { ok: true, order: { code: order.code, id: order.id } });
}

// ─────────────────────────────────────────────
//  Order creation — topup flow
// ─────────────────────────────────────────────
async function handleCreateTopupOrder(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'order', 10, 60 * 1000)) return sendJSON(res, 429, { ok: false, errors: ['សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំមួយភ្លែត។'] });
  const raw  = await readBody(req, 8 * 1024 * 1024);
  const body = parseBody(req, raw);
  if (isHoneypotTripped(body)) return sendJSON(res, 400, { ok: false, errors: ['មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។'] });
  const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstileOk) return sendJSON(res, 400, { ok: false, errors: ['ការផ្ទៀងផ្ទាត់បរាជ័យ។ សូម Refresh ទំព័រ ហើយសាកល្បងម្តងទៀត។'] });

  const playerId  = (body.playerId  || '').trim();
  const serverId  = (body.serverId  || '').trim();
  const packageId = (body.packageId || '').trim();
  const gameId    = (body.gameId    || '').trim();
  const contact   = (body.contact   || '').trim();
  const note      = (body.note      || '').trim().slice(0, 500);
  const data      = db.readDB();
  const game      = data.games.find(g => g.id === gameId && g.active);
  const errors    = [];

  if (!playerId || playerId.length < 4 || playerId.length > 20 || !/^[0-9]+$/.test(playerId)) errors.push('Player ID ត្រូវតែជាលេខ និងមានប្រវែងត្រឹមត្រូវ។');
  if (!game) errors.push('Game ដែលជ្រើសរើសមិនត្រឹមត្រូវ។');
  else if (game.requiresServerId && (!serverId || !/^[0-9]{1,6}$/.test(serverId))) errors.push('Server ID មិនត្រឹមត្រូវ។');
  if (contact && contact.length > 100) errors.push('ព័ត៌មានទំនាក់ទំនងវែងពេក។');
  const pkg = data.packages.find(p => p.id === packageId && p.active && p.gameId === gameId);
  if (!pkg) errors.push('កញ្ចប់ដែលជ្រើសរើសមិនត្រឹមត្រូវ ឬលែងមានទៀតហើយ។');
  if (errors.length) return sendJSON(res, 400, { ok: false, errors });

  let slipFilename = '';
  if (body.slip && typeof body.slip === 'string' && body.slip.startsWith('data:image')) {
    try { slipFilename = db.saveUploadedImage(body.slip, 'slip-' + Date.now()); } catch (e) { slipFilename = ''; }
  }

  const order = {
    id: db.genId('order'), code: db.genOrderCode(),
    gameId: game.id, gameName: game.name,
    playerId, serverId: serverId || '', contact, note,
    packageId: pkg.id, packageName: pkg.name, price: pkg.price, currency: pkg.currency,
    status: 'pending', channel: 'topup', paymentSlip: slipFilename,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  data.orders.unshift(order);

  let khqrPayload = null;
  if (khqrAutoEnabled()) {
    try {
      const gen = khqr.generateKhqr({ accountId: KHQR_CONFIG.accountId, merchantName: KHQR_CONFIG.merchantName, merchantCity: KHQR_CONFIG.merchantCity, amount: order.price, currency: 'USD', billNumber: order.code, expireMinutes: KHQR_CONFIG.expireMinutes });
      order.payToken = crypto.randomBytes(16).toString('hex');
      order.paymentStatus = 'awaiting';
      order.khqr = { qr: gen.qr, md5: gen.md5, expiresAt: gen.expiresAt };
      khqrPayload = { qr: gen.qr, expiresAt: gen.expiresAt, payToken: order.payToken };
      console.log('[KHQR] order', order.code, 'has KHQR, md5=', gen.md5.slice(0, 8) + '...');
    } catch (e) { console.log('[KHQR] generation FAILED for', order.code, ':', e.message); }
  }

  db.writeDB(data);
  notifyTelegram(
    `🆕 <b>Order ថ្មីពី /topup</b>\n🎮 Game: ${order.gameName}\n` +
    `📦 កញ្ចប់: ${order.packageName} — $${order.price.toFixed(2)}\n` +
    `🆔 Player ID: ${order.playerId}${order.serverId ? ` (Server ${order.serverId})` : ''}\n` +
    `📞 ទំនាក់ទំនង: ${order.contact}\n🔖 Code: ${order.code}` +
    (order.note ? `\n📝 ចំណាំ: ${order.note}` : '')
  );
  sendJSON(res, 201, { ok: true, order: { code: order.code, id: order.id }, khqr: khqrPayload });
}

async function handleValidatePlayer(req, res, query) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'validate', 20, 60 * 1000)) return sendJSON(res, 429, { ok: false, message: 'សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំ។' });
  const playerId = (query.playerId || '').trim();
  const serverId = (query.serverId || '').trim();
  if (!playerId || !/^[0-9]{4,20}$/.test(playerId)) return sendJSON(res, 400, { ok: false, message: 'Player ID មិនត្រឹមត្រូវ។' });
  if (!serverId || !/^[0-9]{1,6}$/.test(serverId))  return sendJSON(res, 400, { ok: false, message: 'Server ID មិនត្រឹមត្រូវ។' });
  // Validation skipped — external sources unreliable; customer self-confirms via checkbox.
  console.log('[Validate] skipped (manual confirm mode) — playerId:', playerId, '/ serverId:', serverId);
  return sendJSON(res, 200, { ok: true, username: '', skipped: true, message: 'សូមបញ្ជាក់ Player ID + Zone ID ខ្លួនឯង ក្នុង Game មុន' });
}

async function handleOrderPaymentStatus(req, res, query) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'paycheck', 40, 60 * 1000)) return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  const code  = (query.code || '').trim();
  const token = (query.t    || '').trim();
  if (!code || !token) return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });
  const data  = db.readDB();
  const order = data.orders.find(o => o.code === code && o.channel === 'topup');
  if (!order || !order.payToken || !order.khqr || order.deleted) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(order.payToken).digest();
  if (!crypto.timingSafeEqual(a, b)) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  if (order.paymentStatus === 'paid') return sendJSON(res, 200, { ok: true, status: 'paid' });
  const now = Date.now();
  if (order.khqr.expiresAt && now > order.khqr.expiresAt) { khqrCheckThrottle.delete(order.code); return sendJSON(res, 200, { ok: true, status: 'expired' }); }
  const last = khqrCheckThrottle.get(order.code) || 0;
  if (now - last < KHQR_MIN_CHECK_GAP_MS) return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  khqrCheckThrottle.set(order.code, now);
  let result;
  try { result = await khqr.checkTransactionByMd5(order.khqr.md5, KHQR_CONFIG); }
  catch (e) { return sendJSON(res, 200, { ok: true, status: 'awaiting' }); }
  if (!result || result.responseCode !== 0 || !result.data) return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  if (!verifyTransaction(result.data, order)) return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  confirmOrderPaidAndFulfill(order, data);
  sendJSON(res, 200, { ok: true, status: 'paid' });
}

async function handleOrderDeeplink(req, res, query) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'deeplink', 20, 60 * 1000)) return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  const code  = (query.code || '').trim();
  const token = (query.t    || '').trim();
  if (!code || !token) return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });
  const data  = db.readDB();
  const order = data.orders.find(o => o.code === code && o.channel === 'topup');
  if (!order || !order.payToken || !order.khqr || order.deleted) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(order.payToken).digest();
  if (!crypto.timingSafeEqual(a, b)) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  // Build ABA deeplink directly from QR string — no Bakong API call needed.
  // Bakong generate_deeplink_by_qr requires commercial merchant tier (errorCode 4
  // for individual/developer accounts). ABA Pay natively supports the scheme:
  //   abamobilebank://aba_pay?qr=<EMV_KHQR_STRING>
  // This opens ABA app directly on the QR scan/pay screen with amount pre-filled.
  const qrString = order.khqr && order.khqr.qr;
  if (!qrString) { console.log('[KHQR] no QR string for order:', code); return sendJSON(res, 200, { ok: true, deeplink: null }); }
  const abaDeeplink = 'abamobilebank://aba_pay?qr=' + encodeURIComponent(qrString);
  console.log('[KHQR] ABA deeplink built for order:', code, '| qr bytes:', Buffer.byteLength(qrString));
  sendJSON(res, 200, { ok: true, deeplink: abaDeeplink });
}

async function handleOrderCancel(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'cancel', 20, 60 * 1000)) return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  let body;
  try { const raw = await readBody(req); body = parseBody(req, raw); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'Bad request' }); }
  const code  = (body.code || '').trim();
  const token = (body.t    || '').trim();
  if (!code) return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });
  const data  = db.readDB();
  const order = data.orders.find(o => o.code === code && o.channel === 'topup');
  if (!order || order.deleted) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  if (order.payToken) {
    if (!token) return sendJSON(res, 400, { ok: false, error: 'Missing token' });
    const a = crypto.createHash('sha256').update(token).digest();
    const b = crypto.createHash('sha256').update(order.payToken).digest();
    if (!crypto.timingSafeEqual(a, b)) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }
  if (order.paymentStatus === 'paid' || order.status === 'confirmed') return sendJSON(res, 200, { ok: true, status: order.paymentStatus });
  order.paymentStatus = 'cancelled'; order.status = 'cancelled'; order.cancelledAt = Date.now();
  db.writeDB(data);
  console.log('[KHQR] order cancelled by user:', code);
  sendJSON(res, 200, { ok: true, status: 'cancelled' });
}

async function handleMooGoldCallback(req, res) {
  const callbackSecret = process.env.MOOGOLD_CALLBACK_SECRET;
  if (callbackSecret) {
    const provided = (req.headers['x-callback-secret'] || '').trim();
    if (!provided || provided !== callbackSecret) { console.warn('[MooGold] callback REJECTED from', getClientIp(req)); return sendJSON(res, 401, { status: 'error' }); }
  }
  let body;
  try { const raw = await readBody(req); body = parseBody(req, raw); } catch (e) { return sendJSON(res, 400, { status: 'error' }); }
  console.log('[MooGold] callback received:', JSON.stringify(body).slice(0, 500));
  const status         = (body.status || '').toLowerCase();
  const moogoldOrderId = body.order_id;
  const partnerOrderId = body.account_details && body.account_details.partnerOrderId;
  const data  = db.readDB();
  const order = data.orders.find(o =>
    (moogoldOrderId && String(o.moogoldOrderId) === String(moogoldOrderId)) ||
    (partnerOrderId && o.code === partnerOrderId)
  );
  if (order) {
    if (status === 'completed') {
      order.moogoldStatus = 'completed'; order.status = 'delivered';
      order.note = appendNote(order.note, '✅ MooGold completed (callback)'); order.updatedAt = new Date().toISOString(); db.writeDB(data);
      notifyTelegram(`🎮 <b>Diamond បញ្ចូលរួចរាល់! ✅</b>\n🔖 Code: ${order.code}\n📦 ${order.packageName} — $${order.price.toFixed(2)}\n🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ` (${order.serverId})` : ''}\n🆔 MooGold Order: ${moogoldOrderId}`);
    } else if (status === 'refunded') {
      order.moogoldStatus = 'refunded'; order.note = appendNote(order.note, '🔴 MooGold refunded (callback)'); order.updatedAt = new Date().toISOString(); db.writeDB(data);
      notifyTelegram(`🔴 <b>MooGold REFUNDED!</b>\n🔖 Code: ${order.code}\n🆔 MooGold Order: ${moogoldOrderId}\n⚠️ <b>ពិនិត្យ Player ID + Server ID!</b>`);
    } else if (status === 'incorrect-details') {
      order.moogoldStatus = 'incorrect-details'; order.note = appendNote(order.note, '⚠️ MooGold incorrect-details (callback)'); order.updatedAt = new Date().toISOString(); db.writeDB(data);
      notifyTelegram(`⚠️ <b>MooGold: Incorrect Details!</b>\n🔖 Code: ${order.code}\n🆔 MooGold Order: ${moogoldOrderId}\n🔔 <b>Player ID ខុស — ទាក់ទង MooGold CS!</b>`);
    }
  } else {
    console.log('[MooGold] callback: order not found — order_id:', moogoldOrderId, 'partnerOrderId:', partnerOrderId);
  }
  sendJSON(res, 200, { status: 'success' });
}

// ═════════════════════════════════════════════
//  Route handlers — admin auth
// ═════════════════════════════════════════════

async function handleAdminLoginPage(req, res) {
  if (getSession(req)) return send(res, 302, '', { Location: '/admin' });
  send(res, 200, renderAdminLogin({}));
}

async function handleAdminLoginSubmit(req, res) {
  const ip = getClientIp(req);
  if (isLockedOut(ip)) return send(res, 429, renderAdminLogin({ error: 'គណនីត្រូវបានចាក់សោបណ្តោះអាសន្នដោយសារការប៉ុនប៉ងចូលខុសច្រើនដង។ សូមរង់ចាំ ១៥ នាទី។' }));
  if (isRateLimited(ip)) return send(res, 429, renderAdminLogin({ error: 'ការប៉ុនប៉ងចូលច្រើនពេក។ សូមរង់ចាំមួយនាទី។' }));
  const raw  = await readBody(req);
  const body = parseBody(req, raw);
  const username = (body.username || '').trim();
  const password = body.password || '';
  const data  = db.readDB();
  const admin = data.admins.find(a => a.username === username);
  if (!admin || !db.verifyPassword(password, admin.salt, admin.hash)) {
    recordLoginFailure(ip);
    return send(res, 401, renderAdminLogin({ error: 'ឈ្មោះ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។' }));
  }
  clearLoginFailures(ip);
  const token     = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  data.sessions[token] = { adminId: admin.id, username: admin.username, csrfToken, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  db.writeDB(data);
  setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000 });
  send(res, 302, '', { Location: '/admin' });
}

async function handleAdminLogout(req, res) {
  const cookies = parseCookies(req);
  const token   = cookies[SESSION_COOKIE];
  if (token) {
    const data    = db.readDB();
    const session = data.sessions[token];
    if (session && session.csrfToken) {
      const raw  = await readBody(req); const body = parseBody(req, raw);
      if (body.csrf !== session.csrfToken) return send(res, 302, '', { Location: '/admin' });
    }
    delete data.sessions[token]; db.writeDB(data);
  }
  clearCookie(res, SESSION_COOKIE);
  send(res, 302, '', { Location: '/admin/login' });
}

// ═════════════════════════════════════════════
//  Route handlers — admin dashboard & orders
// ═════════════════════════════════════════════

async function handleAdminDashboard(req, res, query) {
  const session = requireAuth(req, res); if (!session) return;
  const data    = db.readDB();
  const filter  = query.status || 'all';
  const activeOrders = data.orders.filter(o => !o.deleted && !isAwaitingKhqrPayment(o));
  let orders;
  if (filter === 'deleted') orders = data.orders.filter(o => o.deleted);
  else if (filter === 'all') orders = activeOrders;
  else orders = activeOrders.filter(o => o.status === filter);
  send(res, 200, renderAdminDashboard({
    orders, packages: data.packages, games: data.games, settings: data.settings,
    filter, username: session.username, csrfToken: session.csrfToken,
    counts: {
      all: activeOrders.length,
      pending:   activeOrders.filter(o => o.status === 'pending').length,
      confirmed: activeOrders.filter(o => o.status === 'confirmed').length,
      delivered: activeOrders.filter(o => o.status === 'delivered').length,
      rejected:  activeOrders.filter(o => o.status === 'rejected').length,
      deleted:   data.orders.filter(o => o.deleted).length
    }
  }));
}

async function handleChangePassword(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const currentPassword = body.currentPassword || '';
  const newPassword     = body.newPassword     || '';
  if (newPassword.length < 8) return sendJSON(res, 400, { ok: false, error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៨ តួអក្សរ។' });
  const data  = db.readDB();
  const admin = data.admins.find(a => a.id === session.adminId);
  if (!admin || !db.verifyPassword(currentPassword, admin.salt, admin.hash)) return sendJSON(res, 401, { ok: false, error: 'ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវ។' });
  const { salt, hash } = db.hashPassword(newPassword);
  admin.salt = salt; admin.hash = hash; db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleUpdateOrderStatus(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const validStatuses = ['pending', 'confirmed', 'delivered', 'rejected'];
  if (!validStatuses.includes(body.status)) return sendJSON(res, 400, { ok: false, error: 'Invalid status' });
  const data  = db.readDB();
  const order = data.orders.find(o => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  order.status = body.status; order.updatedAt = new Date().toISOString();
  db.writeDB(data); sendJSON(res, 200, { ok: true, order });
}

async function handleAdminVerifyKhqr(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data  = db.readDB();
  const order = data.orders.find(o => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  if (order.paymentStatus === 'paid')  return sendJSON(res, 200, { ok: true, status: 'paid', alreadyPaid: true });
  if (!order.khqr || !order.khqr.md5) return sendJSON(res, 400, { ok: false, error: 'This order has no KHQR attached to verify' });
  if (!khqrAutoEnabled())              return sendJSON(res, 400, { ok: false, error: 'KHQR auto-verify not configured' });
  let result;
  try { result = await khqr.checkTransactionByMd5(order.khqr.md5, KHQR_CONFIG); }
  catch (e) { return sendJSON(res, 200, { ok: true, status: 'not_paid', error: e.message }); }
  if (!result || result.responseCode !== 0 || !result.data) return sendJSON(res, 200, { ok: true, status: 'not_paid' });
  if (!verifyTransaction(result.data, order)) return sendJSON(res, 200, { ok: true, status: 'mismatch' });
  console.log('[Admin] verify-khqr CONFIRMED for', order.code, 'by', session.username);
  confirmOrderPaidAndFulfill(order, data);
  sendJSON(res, 200, { ok: true, status: 'paid' });
}

async function handleDeleteOrder(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data  = db.readDB();
  const order = data.orders.find(o => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  order.deleted = true; order.deletedAt = new Date().toISOString(); order.updatedAt = order.deletedAt;
  db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleRestoreOrder(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data  = db.readDB();
  const order = data.orders.find(o => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  delete order.deleted; delete order.deletedAt; order.updatedAt = new Date().toISOString();
  db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleHardDeleteOrder(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB();
  const idx  = data.orders.findIndex(o => o.id === params.orderId);
  if (idx === -1) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  if (!data.orders[idx].deleted) return sendJSON(res, 400, { ok: false, error: 'Order must be soft-deleted first' });
  const slip = data.orders[idx].paymentSlip;
  if (slip) { try { db.deleteUploadedImage(slip); } catch (e) { /* non-fatal */ } }
  data.orders.splice(idx, 1); db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleBulkDeleteOrders(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const ids  = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return sendJSON(res, 400, { ok: false, error: 'No order IDs provided' });
  const data = db.readDB(); const now = new Date().toISOString(); let count = 0;
  data.orders.forEach(o => { if (ids.includes(o.id) && !o.deleted) { o.deleted = true; o.deletedAt = now; o.updatedAt = now; count++; } });
  db.writeDB(data); sendJSON(res, 200, { ok: true, deleted: count });
}

async function handleBulkHardDeleteOrders(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw      = await readBody(req); const body = parseBody(req, raw);
  const ids      = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return sendJSON(res, 400, { ok: false, error: 'No order IDs provided' });
  const data = db.readDB(); const toRemove = new Set(ids); let count = 0;
  data.orders = data.orders.filter(o => {
    if (toRemove.has(o.id) && o.deleted) {
      if (o.paymentSlip) { try { db.deleteUploadedImage(o.paymentSlip); } catch (e) { /* non-fatal */ } }
      count++; return false;
    }
    return true;
  });
  db.writeDB(data); sendJSON(res, 200, { ok: true, deleted: count });
}

// ═════════════════════════════════════════════
//  Route handlers — admin packages
// ═════════════════════════════════════════════

async function handleCreatePackage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const name   = (body.name   || '').trim();
  const gameId = (body.gameId || '').trim();
  const price  = parseFloat(body.price);
  const amount = parseInt(body.amount, 10) || 0;
  const bonus  = parseInt(body.bonus,  10) || 0;
  const category = VALID_CATEGORIES.includes(body.category) ? body.category : undefined;
  if (!name || isNaN(price) || price < 0) return sendJSON(res, 400, { ok: false, error: 'Name and valid price are required' });
  const data = db.readDB();
  const game = data.games.find(g => g.id === gameId);
  if (!game) return sendJSON(res, 400, { ok: false, error: 'Valid gameId is required' });
  const pkg = { id: db.genId('pkg'), gameId: game.id, name: name.slice(0, 60), amount, bonus, price, currency: 'USD', active: true, category };
  data.packages.push(pkg); db.writeDB(data);
  sendJSON(res, 201, { ok: true, package: pkg });
}

async function handleUpdatePackage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const data = db.readDB();
  const pkg  = data.packages.find(p => p.id === params.packageId);
  if (!pkg) return sendJSON(res, 404, { ok: false, error: 'Package not found' });
  if (typeof body.name === 'string' && body.name.trim()) pkg.name = body.name.trim().slice(0, 60);
  if (body.price  !== undefined) { const v = parseFloat(body.price);     if (!isNaN(v) && v >= 0) pkg.price  = v; }
  if (body.amount !== undefined) { const v = parseInt(body.amount, 10);  if (!isNaN(v) && v >= 0) pkg.amount = v; }
  if (body.bonus  !== undefined) { const v = parseInt(body.bonus, 10);   if (!isNaN(v) && v >= 0) pkg.bonus  = v; }
  if (typeof body.active === 'boolean') pkg.active = body.active;
  if (typeof body.active === 'string')  pkg.active = body.active === 'true';
  if (body.category !== undefined) pkg.category = VALID_CATEGORIES.includes(body.category) ? body.category : undefined;
  if (body.moogoldProductId !== undefined) { const mid = String(body.moogoldProductId || '').trim(); pkg.moogoldProductId = mid || null; }
  db.writeDB(data); sendJSON(res, 200, { ok: true, package: pkg });
}

async function handleDeletePackage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB();
  const idx  = data.packages.findIndex(p => p.id === params.packageId);
  if (idx === -1) return sendJSON(res, 404, { ok: false, error: 'Package not found' });
  data.packages.splice(idx, 1); db.writeDB(data); sendJSON(res, 200, { ok: true });
}


// ═════════════════════════════════════════════
//  Route handlers — admin site settings
// ═════════════════════════════════════════════

async function handleUpdateColors(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const hexPattern = /^#[0-9A-Fa-f]{6}$/;
  const data = db.readDB();
  ['heading', 'body', 'accent'].forEach(key => { if (typeof body[key] === 'string' && hexPattern.test(body[key])) data.settings.colors[key] = body[key]; });
  db.writeDB(data); sendJSON(res, 200, { ok: true, colors: data.settings.colors });
}

async function _uploadImage(req, res, settingKey, prefix, extraSetup) {
  try {
    const data     = db.readDB();
    if (extraSetup) extraSetup(data);
    const raw      = await readBody(req, 8 * 1024 * 1024);
    const body     = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, prefix);
    db.deleteUploadedImage(data.settings[settingKey]);
    data.settings[settingKey] = filename;
    db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleUploadProfileImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  await _uploadImage(req, res, 'profileImage', 'profile');
}

async function handleUploadCoverImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  await _uploadImage(req, res, 'coverImage', 'cover');
}

async function handleUploadKhqrImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  await _uploadImage(req, res, 'khqrImage', 'khqr');
}

async function handleDeleteKhqrImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); db.deleteUploadedImage(data.settings.khqrImage); data.settings.khqrImage = null; db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleUpdateGameCurrencyEmoji(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw   = await readBody(req); const body = parseBody(req, raw);
  const emoji = (body.emoji || '').trim();
  if (!emoji || emoji.length > 8) return sendJSON(res, 400, { ok: false, error: 'សូមបញ្ចូល emoji ឬនិមិត្តសញ្ញាខ្លី (មិនលើសពី 8 តួ)' });
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  game.currencyUnit = emoji; db.writeDB(data); sendJSON(res, 200, { ok: true, currencyUnit: game.currencyUnit });
}

async function handleUploadGameLogo(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'gamelogo-' + game.id);
    db.deleteUploadedImage(data.settings.gameLogos[game.id]);
    data.settings.gameLogos[game.id] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleUploadSocialIcon(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const VALID_PLATFORMS = ['telegram', 'facebook', 'youtube', 'tiktok'];
  if (!VALID_PLATFORMS.includes(params.platform)) return sendJSON(res, 400, { ok: false, error: 'Invalid platform' });
  const data = db.readDB(); if (!data.settings.socialIcons) data.settings.socialIcons = {};
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'social-' + params.platform);
    db.deleteUploadedImage(data.settings.socialIcons[params.platform]);
    data.settings.socialIcons[params.platform] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleSetSocialLinks(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  function cleanUrl(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) throw new Error('Link ត្រូវចាប់ផ្តើមដោយ http:// ឬ https://');
    return trimmed;
  }
  const data = db.readDB(); if (!data.settings.socialLinks) data.settings.socialLinks = {};
  try {
    ['telegram', 'facebook', 'youtube', 'tiktok'].forEach(p => { if (p in body) data.settings.socialLinks[p] = cleanUrl(body[p]); });
    db.writeDB(data); sendJSON(res, 200, { ok: true, socialLinks: data.settings.socialLinks });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message }); }
}

async function handleSetBrandGlowColors(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const hex  = /^#[0-9a-fA-F]{6}$/;
  const c1   = (body.color1 || '').trim(); const c2 = (body.color2 || '').trim();
  if (c1 && !hex.test(c1)) return sendJSON(res, 400, { ok: false, error: 'Color 1 ត្រូវតែជា hex ត្រឹមត្រូវ' });
  if (c2 && !hex.test(c2)) return sendJSON(res, 400, { ok: false, error: 'Color 2 ត្រូវតែជា hex ត្រឹមត្រូវ' });
  const data = db.readDB(); data.settings.brandGlowColor1 = c1 || null; data.settings.brandGlowColor2 = c2 || null;
  db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleSetPageBackgroundColor(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw   = await readBody(req); const body = parseBody(req, raw);
  const color = (body.color || '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return sendJSON(res, 400, { ok: false, error: 'Color ត្រូវតែជា hex ត្រឹមត្រូវ ឧ. #1A0F2E' });
  const data = db.readDB(); data.settings.pageBackgroundColor = color || null;
  if (color && data.settings.pageBackgroundImage) { db.deleteUploadedImage(data.settings.pageBackgroundImage); data.settings.pageBackgroundImage = null; }
  db.writeDB(data); sendJSON(res, 200, { ok: true, pageBackgroundColor: data.settings.pageBackgroundColor });
}

async function handleSetTextEffects(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const raw  = await readBody(req); const body = parseBody(req, raw);
  const data = db.readDB(); if (!data.settings.textEffects) data.settings.textEffects = {};
  ['shimmer', 'glow', 'shadow'].forEach(e => { if (e in body) data.settings.textEffects[e] = !!body[e]; });
  db.writeDB(data); sendJSON(res, 200, { ok: true, textEffects: data.settings.textEffects });
}

async function handleUploadPageBackgroundImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  await _uploadImage(req, res, 'pageBackgroundImage', 'pagebg');
}

async function handleUploadCoverCarouselImage(req, res) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); if (!data.settings.coverImages) data.settings.coverImages = [];
  if (data.settings.coverImages.length >= 8) return sendJSON(res, 400, { ok: false, error: 'អនុញ្ញាតតែ 8 រូបភាពអតិបរមាសម្រាប់ Cover Carousel' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'cover-' + Date.now());
    data.settings.coverImages.push(filename); db.writeDB(data);
    sendJSON(res, 200, { ok: true, filename, coverImages: data.settings.coverImages });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleRemoveCoverCarouselImage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data  = db.readDB(); if (!data.settings.coverImages) data.settings.coverImages = [];
  const index = parseInt(params.index, 10);
  if (isNaN(index) || index < 0 || index >= data.settings.coverImages.length) return sendJSON(res, 400, { ok: false, error: 'Invalid image index' });
  const [removed] = data.settings.coverImages.splice(index, 1); db.deleteUploadedImage(removed);
  db.writeDB(data); sendJSON(res, 200, { ok: true, coverImages: data.settings.coverImages });
}

async function handleUploadCardBackground(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'cardbg-' + game.id);
    if (!data.settings.cardBackgrounds) data.settings.cardBackgrounds = {};
    db.deleteUploadedImage(data.settings.cardBackgrounds[game.id]);
    data.settings.cardBackgrounds[game.id] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleUploadPackageIcon(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); const pkg = data.packages.find(p => p.id === params.packageId);
  if (!pkg) return sendJSON(res, 404, { ok: false, error: 'Package not found' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'pkgicon-' + params.packageId);
    if (!data.settings.packageIconImages) data.settings.packageIconImages = {};
    db.deleteUploadedImage(data.settings.packageIconImages[params.packageId]);
    data.settings.packageIconImages[params.packageId] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleDeletePackageIcon(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); if (!data.settings.packageIconImages) data.settings.packageIconImages = {};
  db.deleteUploadedImage(data.settings.packageIconImages[params.packageId]);
  delete data.settings.packageIconImages[params.packageId]; db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleUploadPkgImage(req, res, params) {
  const session    = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const settingKey = PKG_IMAGE_KEYS[params.kind]; if (!settingKey) return sendJSON(res, 400, { ok: false, error: 'Invalid image type' });
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, params.kind + 'img-' + game.id);
    if (!data.settings[settingKey]) data.settings[settingKey] = {};
    db.deleteUploadedImage(data.settings[settingKey][game.id]);
    data.settings[settingKey][game.id] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleDeletePkgImage(req, res, params) {
  const session    = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const settingKey = PKG_IMAGE_KEYS[params.kind]; if (!settingKey) return sendJSON(res, 400, { ok: false, error: 'Invalid image type' });
  const data = db.readDB(); if (!data.settings[settingKey]) data.settings[settingKey] = {};
  db.deleteUploadedImage(data.settings[settingKey][params.gameId]); delete data.settings[settingKey][params.gameId];
  db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleUploadSectionImage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  if (!SECTION_KEYS.includes(params.section)) return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  try {
    const raw = await readBody(req, 8 * 1024 * 1024); const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, `section-${params.section}-${game.id}`);
    if (!data.settings.sectionImages) data.settings.sectionImages = {};
    if (!data.settings.sectionImages[game.id]) data.settings.sectionImages[game.id] = {};
    db.deleteUploadedImage(data.settings.sectionImages[game.id][params.section]);
    data.settings.sectionImages[game.id][params.section] = filename; db.writeDB(data); sendJSON(res, 200, { ok: true, filename });
  } catch (err) { sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' }); }
}

async function handleDeleteSectionImage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  if (!SECTION_KEYS.includes(params.section)) return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  const data = db.readDB();
  if (!data.settings.sectionImages) data.settings.sectionImages = {};
  if (!data.settings.sectionImages[params.gameId]) data.settings.sectionImages[params.gameId] = {};
  db.deleteUploadedImage(data.settings.sectionImages[params.gameId][params.section]);
  delete data.settings.sectionImages[params.gameId][params.section]; db.writeDB(data); sendJSON(res, 200, { ok: true });
}

async function handleSetSectionEmoji(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  if (!SECTION_KEYS.includes(params.section)) return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  const raw   = await readBody(req); const body = parseBody(req, raw);
  const emoji = (body.emoji || '').trim();
  if (!emoji || emoji.length > 8) return sendJSON(res, 400, { ok: false, error: 'សូមបញ្ចូល emoji ខ្លី (មិនលើសពី 8 តួ)' });
  const data = db.readDB(); const game = data.games.find(g => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });
  if (!data.settings.sectionEmoji) data.settings.sectionEmoji = {};
  if (!data.settings.sectionEmoji[game.id]) data.settings.sectionEmoji[game.id] = {};
  data.settings.sectionEmoji[game.id][params.section] = emoji; db.writeDB(data); sendJSON(res, 200, { ok: true, emoji });
}

async function handleRemoveCustomImage(req, res, params) {
  const session = getSession(req); if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;
  const data = db.readDB(); const target = params.target;
  if (target === 'profile') {
    db.deleteUploadedImage(data.settings.profileImage); data.settings.profileImage = null;
  } else if (target === 'cover') {
    db.deleteUploadedImage(data.settings.coverImage); data.settings.coverImage = null;
  } else if (target === 'gamelogo' && params.gameId) {
    db.deleteUploadedImage(data.settings.gameLogos[params.gameId]); delete data.settings.gameLogos[params.gameId];
  } else if (target === 'cardbackground' && params.gameId) {
    if (!data.settings.cardBackgrounds) data.settings.cardBackgrounds = {};
    db.deleteUploadedImage(data.settings.cardBackgrounds[params.gameId]); delete data.settings.cardBackgrounds[params.gameId];
  } else if (target === 'pagebackground') {
    db.deleteUploadedImage(data.settings.pageBackgroundImage); data.settings.pageBackgroundImage = null;
  } else { return sendJSON(res, 400, { ok: false, error: 'Invalid target' }); }
  db.writeDB(data); sendJSON(res, 200, { ok: true });
}

// ═════════════════════════════════════════════
//  HTTP server & router
// ═════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "connect-src 'self'; " +
    "frame-src https://challenges.cloudflare.com; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );

  try {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query    = parsed.query;
    const method   = req.method;

    if (pathname.startsWith('/static/')) return serveStatic(req, res, pathname.replace('/static', ''));

    // ── Public ─────────────────────────────────────────────────────────────
    if (pathname === '/'                              && method === 'GET')  return handleTopupSelectPage(req, res);
    if (pathname === '/topup'                         && method === 'GET')  return send(res, 302, '', { Location: '/' });
    if (pathname === '/topup/order'                   && method === 'GET')  return handleTopupPackagePage(req, res, query);
    if (pathname === '/topup/checkout'                && method === 'GET')  return handleTopupCheckoutPage(req, res, query);
    if (pathname === '/mlbb'                          && method === 'GET')  return handleMlbbCheckoutPage(req, res);
    if (pathname === '/terms'                         && method === 'GET')  return handleTermsPage(req, res);
    if (pathname === '/order/confirmation'            && method === 'GET')  return handleOrderConfirmationPage(req, res, query);
    if (pathname === '/track'                         && method === 'GET')  return handleTrackOrderPage(req, res, query);
    if (pathname === '/api/orders'                    && method === 'POST') return handleCreateOrder(req, res);
    if (pathname === '/api/mlbb-packages'             && method === 'GET')  return handleMlbbPackagesApi(req, res);
    if (pathname === '/api/topup/orders'              && method === 'POST') return handleCreateTopupOrder(req, res);
    if (pathname === '/api/topup/orders/payment-status' && method === 'GET') return handleOrderPaymentStatus(req, res, query);
    if (pathname === '/api/topup/orders/deeplink'     && method === 'GET')  return handleOrderDeeplink(req, res, query);
    if (pathname === '/api/topup/orders/cancel'       && method === 'POST') return handleOrderCancel(req, res);
    if (pathname === '/api/topup/validate'            && method === 'GET')  return handleValidatePlayer(req, res, query);
    if (pathname === '/api/moogold/callback'          && method === 'POST') return handleMooGoldCallback(req, res);
    if (pathname === '/api/debug/ip' && method === 'GET') {
      if (!getSession(req)) return sendJSON(res, 401, { error: 'unauthorized' });
      return handleDebugIp(req, res);
    }

    // ── Admin auth ─────────────────────────────────────────────────────────
    if (pathname === '/admin/login'  && method === 'GET')  return handleAdminLoginPage(req, res);
    if (pathname === '/admin/login'  && method === 'POST') return handleAdminLoginSubmit(req, res);
    if (pathname === '/admin/logout' && method === 'POST') return handleAdminLogout(req, res);

    // ── Admin dashboard ────────────────────────────────────────────────────
    if (pathname === '/admin'                 && method === 'GET')  return handleAdminDashboard(req, res, query);
    if (pathname === '/admin/change-password' && method === 'POST') return handleChangePassword(req, res);

    // ── Admin API — orders ─────────────────────────────────────────────────
    let m;
    m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (m && method === 'POST')   return handleUpdateOrderStatus(req, res, { orderId: m[1] });
    m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/verify-khqr$/);
    if (m && method === 'POST')   return handleAdminVerifyKhqr(req, res, { orderId: m[1] });
    m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/restore$/);
    if (m && method === 'POST')   return handleRestoreOrder(req, res, { orderId: m[1] });
    m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/hard-delete$/);
    if (m && method === 'DELETE') return handleHardDeleteOrder(req, res, { orderId: m[1] });
    m = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (m && method === 'DELETE') return handleDeleteOrder(req, res, { orderId: m[1] });
    if (pathname === '/api/admin/orders/bulk-delete'      && method === 'POST') return handleBulkDeleteOrders(req, res);
    if (pathname === '/api/admin/orders/bulk-hard-delete' && method === 'POST') return handleBulkHardDeleteOrders(req, res);

    // ── Admin API — packages ───────────────────────────────────────────────
    if (pathname === '/api/admin/packages' && method === 'POST') return handleCreatePackage(req, res);
    m = pathname.match(/^\/api\/admin\/packages\/([^/]+)\/icon$/);
    if (m && method === 'POST')   return handleUploadPackageIcon(req, res, { packageId: m[1] });
    if (m && method === 'DELETE') return handleDeletePackageIcon(req, res, { packageId: m[1] });
    m = pathname.match(/^\/api\/admin\/packages\/([^/]+)$/);
    if (m && method === 'PATCH')  return handleUpdatePackage(req, res, { packageId: m[1] });
    if (m && method === 'DELETE') return handleDeletePackage(req, res, { packageId: m[1] });

    // ── Admin API — settings ───────────────────────────────────────────────
    if (pathname === '/api/admin/settings/colors'                && method === 'POST')   return handleUpdateColors(req, res);
    if (pathname === '/api/admin/settings/profile-image'         && method === 'POST')   return handleUploadProfileImage(req, res);
    if (pathname === '/api/admin/settings/profile-image'         && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'profile' });
    if (pathname === '/api/admin/settings/cover-image'           && method === 'POST')   return handleUploadCoverImage(req, res);
    if (pathname === '/api/admin/settings/cover-image'           && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'cover' });
    if (pathname === '/api/admin/settings/khqr-image'            && method === 'POST')   return handleUploadKhqrImage(req, res);
    if (pathname === '/api/admin/settings/khqr-image'            && method === 'DELETE') return handleDeleteKhqrImage(req, res);
    if (pathname === '/api/admin/settings/cover-carousel'        && method === 'POST')   return handleUploadCoverCarouselImage(req, res);
    if (pathname === '/api/admin/settings/page-background-color' && method === 'POST')   return handleSetPageBackgroundColor(req, res);
    if (pathname === '/api/admin/settings/brand-glow-colors'     && method === 'POST')   return handleSetBrandGlowColors(req, res);
    if (pathname === '/api/admin/settings/text-effects'          && method === 'POST')   return handleSetTextEffects(req, res);
    if (pathname === '/api/admin/settings/social-links'          && method === 'POST')   return handleSetSocialLinks(req, res);
    if (pathname === '/api/admin/settings/page-background-image' && method === 'POST')   return handleUploadPageBackgroundImage(req, res);
    if (pathname === '/api/admin/settings/page-background-image' && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'pagebackground' });
    m = pathname.match(/^\/api\/admin\/settings\/cover-carousel\/(\d+)$/);
    if (m && method === 'DELETE') return handleRemoveCoverCarouselImage(req, res, { index: m[1] });
    m = pathname.match(/^\/api\/admin\/settings\/social-icon\/([^/]+)$/);
    if (m && method === 'POST')   return handleUploadSocialIcon(req, res, { platform: m[1] });
    m = pathname.match(/^\/api\/admin\/settings\/game-logo\/([^/]+)$/);
    if (m && method === 'POST')   return handleUploadGameLogo(req, res, { gameId: m[1] });
    if (m && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'gamelogo', gameId: m[1] });
    m = pathname.match(/^\/api\/admin\/settings\/card-background\/([^/]+)$/);
    if (m && method === 'POST')   return handleUploadCardBackground(req, res, { gameId: m[1] });
    if (m && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'cardbackground', gameId: m[1] });
    m = pathname.match(/^\/api\/admin\/settings\/pkg-image\/(special|package)\/([^/]+)$/);
    if (m && method === 'POST')   return handleUploadPkgImage(req, res, { kind: m[1], gameId: m[2] });
    if (m && method === 'DELETE') return handleDeletePkgImage(req, res,  { kind: m[1], gameId: m[2] });
    m = pathname.match(/^\/api\/admin\/settings\/section-image\/(passes|firstTopup|bonusDiamond|pureDiamond)\/([^/]+)$/);
    if (m && method === 'POST')   return handleUploadSectionImage(req, res, { section: m[1], gameId: m[2] });
    if (m && method === 'DELETE') return handleDeleteSectionImage(req, res, { section: m[1], gameId: m[2] });
    m = pathname.match(/^\/api\/admin\/settings\/section-emoji\/(passes|firstTopup|bonusDiamond|pureDiamond)\/([^/]+)$/);
    if (m && method === 'POST')   return handleSetSectionEmoji(req, res, { section: m[1], gameId: m[2] });
    m = pathname.match(/^\/api\/admin\/games\/([^/]+)\/currency-emoji$/);
    if (m && method === 'POST')   return handleUpdateGameCurrencyEmoji(req, res, { gameId: m[1] });

    return send(res, 404, renderNotFound());
  } catch (err) {
    console.error('Unhandled error:', err);
    send(res, 500, '<h1>500 — Something broke.</h1><p>Check server logs.</p>');
  }
});

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
db.ensureDataFile();
db.ensureUploadsDir();
server.listen(PORT, () => {
  console.log(`Wanfunzy server running → http://localhost:${PORT}`);
  console.log(`Admin login → http://localhost:${PORT}/admin/login`);
  console.log(`Default credentials: admin / wanfunzy123  (change this immediately)`);
});
