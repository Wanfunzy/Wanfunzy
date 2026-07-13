// server.js — Wanfunzy storefront. Zero external dependencies.
// Run with: node server.js   (after copying .env.example to .env)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const db = require('./db');
const khqr = require('./khqr');

// ---------- MooGold API ----------
const MOOGOLD_API_BASE = 'https://moogold.com/wp-json/v1/api';
function moogoldEnabled() { return !!(process.env.MOOGOLD_PARTNER_ID && process.env.MOOGOLD_SECRET_KEY); }
function moogoldAuth(payload, path) {
  const partnerId = process.env.MOOGOLD_PARTNER_ID;
  const secretKey = process.env.MOOGOLD_SECRET_KEY;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const basicAuth = Buffer.from(`${partnerId}:${secretKey}`).toString('base64');
  // Auth signature: HMAC-SHA256( JSON.stringify(payload) + timestamp + path, secretKey )
  // Must match exactly what MooGold docs specify:
  //   stringToSign = payloadString + timestamp + path
  const payloadString = JSON.stringify(payload);
  const stringToSign = payloadString + timestamp + path;
  const authSig = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');
  return { basicAuth, authSig, timestamp };
}
function moogoldRequest(path, payload, signingPayload) {
  return new Promise((resolve, reject) => {
    // Use signingPayload for auth if provided (excludes partnerOrderId)
    // otherwise fall back to full payload — matches MooGold docs
    const { basicAuth, authSig, timestamp } = moogoldAuth(signingPayload || payload, path);
    const body = JSON.stringify(payload);
    const workerUrl = process.env.MOOGOLD_WORKER_URL;
    const workerSecret = process.env.MOOGOLD_WORKER_SECRET;
    let hostname, reqPath;
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Basic ${basicAuth}`,
      'auth': authSig,
      'timestamp': timestamp
    };
    if (workerUrl && workerSecret) {
      const u = new URL(`${workerUrl}/${path}`);
      hostname = u.hostname; reqPath = u.pathname;
      headers['x-worker-secret'] = workerSecret;
      console.log('[MooGold] via Worker:', u.href);
    } else {
      hostname = 'moogold.com'; reqPath = `/wp-json/v1/api/${path}`;
    }
    const req = https.request({ hostname, path: reqPath, method: 'POST', headers, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', c => { data += c; if (data.length > 64*1024) req.destroy(new Error('Too large')); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Bad JSON from MooGold')); } });
    });
    req.on('timeout', () => req.destroy(new Error('MooGold timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}
// ---------- MooGold order status polling ----------
// Called after create_order returns status='processing'.
// Polls /order/order_detail_partner_id every 2 min up to 10 times (~20 min).
// Updates order in DB and sends Telegram once completed or refunded.
// Poll every 2 min, up to 30 attempts (60 min total).
// MooGold MLBB orders often stay "sending" 20-40 min before completing.
// Statuses: processing/sending → keep polling | completed ✅ | refunded/incorrect-details 🔴
async function pollMooGoldOrderStatus(orderCode, moogoldOrderId, maxAttempts = 30) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < maxAttempts; i++) {
    await delay(2 * 60 * 1000); // wait 2 minutes
    try {
      const payload = { path: 'order/order_detail_partner_id', partner_order_id: orderCode };
      const result = await moogoldRequest('order/order_detail_partner_id', payload);
      const status = result && result.order_status;
      console.log('[MooGold] poll #' + (i+1) + '/' + maxAttempts + ' for', orderCode, '| status:', status);

      if (status === 'completed') {
        const data = db.readDB();
        const o = data.orders.find(o => o.code === orderCode);
        if (o) {
          o.moogoldStatus = 'completed';
          o.status = 'delivered';
          o.note = (o.note ? o.note + ' | ' : '') + '✅ MooGold completed';
          o.updatedAt = new Date().toISOString();
          db.writeDB(data);
        }
        notifyTelegram(
          `🎮 <b>Diamond បញ្ចូលរួចរាល់! ✅</b>\n` +
          `🔖 Code: ${orderCode}\n` +
          `🆔 MooGold Order: ${result.order_id || moogoldOrderId}`
        );
        return;
      }

      if (status === 'refunded' || status === 'incorrect-details') {
        const data = db.readDB();
        const o = data.orders.find(o => o.code === orderCode);
        if (o) {
          o.moogoldStatus = status;
          o.note = (o.note ? o.note + ' | ' : '') + `🔴 MooGold ${status}`;
          o.updatedAt = new Date().toISOString();
          db.writeDB(data);
        }
        notifyTelegram(
          `🔴 <b>MooGold ${status.toUpperCase()}!</b>\n` +
          `🔖 Code: ${orderCode}\n` +
          `🆔 MooGold Order: ${result.order_id || moogoldOrderId}\n` +
          `⚠️ <b>ពិនិត្យ Player ID + Zone ID! ហើយទាក់ទង MooGold CS!</b>`
        );
        return;
      }

      // processing / sending → keep polling
      if (status === 'sending') {
        console.log('[MooGold] poll: still sending — attempt', (i+1), '/', maxAttempts);
      }

    } catch(e) {
      console.error('[MooGold] poll error for', orderCode, ':', e.message);
    }
  }

  // Gave up after 60 min — notify admin
  console.log('[MooGold] poll timeout for', orderCode, '— gave up after', maxAttempts, 'attempts (~60 min)');
  const data = db.readDB();
  const o = data.orders.find(o => o.code === orderCode);
  if (o) {
    o.moogoldStatus = 'timeout';
    o.note = (o.note ? o.note + ' | ' : '') + '⏳ MooGold poll timeout (60 min) — check portal';
    o.updatedAt = new Date().toISOString();
    db.writeDB(data);
  }
  notifyTelegram(
    `⏳ <b>MooGold មិនទាន់ confirmed (60 នាទី)</b>\n` +
    `🔖 Code: ${orderCode}\n` +
    `🆔 MooGold Order: ${moogoldOrderId || '?'}\n` +
    `🔔 <b>ចូល MooGold portal ពិនិត្យ Order #${moogoldOrderId}!</b>`
  );
}

async function fulfillWithMooGold(order) {
  if (!moogoldEnabled()) return { ok: false, error: 'MooGold not configured' };
  if (!order.moogoldProductId) return { ok: false, error: 'No moogoldProductId' };

  // Block orders missing Server ID for ANY game that requiresServerId.
  // MooGold refunds instantly when Server field is missing/empty for these games.
  // Check via: (1) game flag from DB, (2) MLBB name/id fallback if flag not set.
  const isMlbb = (order.gameId || '').toLowerCase() === 'mlbb' ||
                 (order.gameName || '').toLowerCase().includes('mobile legend');

  // Read game config from DB to get requiresServerId flag
  let gameRequiresServer = isMlbb; // MLBB always requires server
  try {
    const dbSnap = db.readDB();
    const gameDoc = dbSnap.games && dbSnap.games.find(g => g.id === order.gameId);
    if (gameDoc && gameDoc.requiresServerId) gameRequiresServer = true;
  } catch(e) { /* non-fatal — fall back to isMlbb check above */ }

  if (gameRequiresServer && !order.serverId) {
    console.log('[MooGold] BLOCKED fulfill — missing Server/Zone ID for game:', order.gameId, '| order:', order.code);
    return { ok: false, error: `Server/Zone ID ត្រូវតែបញ្ចូលសម្រាប់ game នេះ (${order.gameName || order.gameId})` };
  }
  // Match MooGold's PHP sample payload exactly — send scalar values as
  // strings. The sample uses "category":"1" and "quantity":"1", not
  // numeric 1. MooGold's WordPress backend is PHP so it usually accepts
  // both, but sending strings removes any risk of a strict type check
  // on their side rejecting the request. Sample reference:
  //   { "category": "1", "product-id": "1874705", "quantity": "1",
  //     "Player ID": "12314123", "Server": "Asia Pacific - Eden" }
  // For MLBB specifically the field name is "User ID" (not "Player ID")
  // and Server is the numeric Zone ID (e.g. "2001") — both confirmed
  // working by a successful live delivery.
  // MooGold API doc confirms category/product-id/quantity are type:integer
  // (see api-doc.yaml create_order schema), and Saem's own confirmed
  // working live request used unquoted numbers:
  //   { "category": 1, "product-id": 215570, "quantity": 1,
  //     "User ID": "12314123", "Server": "3402" }
  // 'User ID' / 'Server' stay strings — that's what the doc's dynamic
  // field schema (from product_detail's "fields" array) specifies.
  const orderData = {
    category: 1,
    'product-id': Number(order.moogoldProductId),
    quantity: 1,
    'User ID': String(order.playerId)
  };
  if (order.serverId) {
    orderData['Server'] = String(order.serverId);
  }
  console.log('[MooGold] create_order payload data:', JSON.stringify({
    'product-id': order.moogoldProductId,
    'User ID': order.playerId,
    'Server': order.serverId || '(none)'
  }));
  // Signature is computed on { path, data } ONLY — matching MooGold docs exactly.
  // partnerOrderId is added AFTER signing so it doesn't corrupt the signature.
  const signingPayload = { path: 'order/create_order', data: orderData };
  const payload = { path: 'order/create_order', data: orderData, partnerOrderId: order.code };
  try {
    const result = await moogoldRequest('order/create_order', payload, signingPayload);
    // Log full response so we can see exact structure from MooGold
    console.log('[MooGold] create_order FULL:', JSON.stringify(result));
    // MooGold sometimes wraps response inside .data — unwrap if needed
    const r = (result && result.data && typeof result.data === 'object') ? result.data : result;
    const isOk = r && (
      r.status === true ||
      r.status === 'true' ||
      r.status === 'processing' ||
      r.status === 'completed' ||
      r.message === 'Order has been created successfully' ||
      !!(r.order_id)
    );
    console.log('[MooGold] isOk:', isOk, '| status:', r && r.status, '| msg:', r && r.message);
    if (isOk) return {
      ok: true,
      moogoldOrderId: (r.account_details && r.account_details.order_id) || r.order_id || null,
      status: r.status || 'processing'
    };
    if (r && (r.err_code === '420' || r.err_code === 420)) return { ok: true, status: 'duplicate-ignored' };
    if (r && r.status === 'refunded') return { ok: false, error: 'MooGold refunded — Player ID ឬ Server ID មិនត្រឹមត្រូវ', refunded: true, moogoldOrderId: r.order_id || null };
    if (r && (r.err_code === '111' || r.err_code === 111)) return { ok: false, error: 'MooGold: Insufficient Balance — សូមបញ្ចូលទឹកប្រាក់ MooGold!' };
    if (r && (r.err_code === '422' || r.err_code === 422)) return { ok: false, error: 'MooGold: Product ID មិនត្រឹមត្រូវ ឬ មិនទាន់ authorized' };
    if (r && (r.err_code === '114' || r.err_code === 114)) return { ok: false, error: 'MooGold: Product Out of Stock!' };
    return { ok: false, error: `MooGold err ${r && r.err_code}: ${r && r.err_message} | raw: ${JSON.stringify(result).slice(0,300)}` };
  } catch(e) { return { ok: false, error: e.message }; }
}
async function validatePlayerWithMooGold(productId, playerId, serverId) {
  if (!moogoldEnabled() || !productId) return { ok: null };
  // Payload matches MooGold docs exactly:
  // { "path": "product/validate", "data": { "product-id", "User ID", "Server" } }
  // Signature computed on this exact object (no extra fields)
  const payload = {
    path: 'product/validate',
    data: {
      'product-id': String(productId),
      'User ID':    String(playerId),
      ...(serverId ? { 'Server': String(serverId) } : {})
    }
  };
  console.log('[MooGold] validate payload:', JSON.stringify({
    'product-id': productId,
    'User ID': playerId,
    'Server': serverId || '(none)'
  }));
  try {
    // signingPayload = payload itself (no partnerOrderId here, so same object)
    const result = await moogoldRequest('product/validate', payload, payload);
    console.log('[MooGold] validate:', JSON.stringify(result).slice(0,200));
    if (result && (result.status === true || result.status === 'true')) return { ok: true, username: result.username || '', message: result.message || '' };
    const msg = (result && (result.message || result.err_message)) || '';
    // Detect endpoint-not-authorized responses → skip (hybrid mode)
    // WordPress returns "rest_no_route" when endpoint not enabled for account
    // MooGold returns "validation is not available" for products without validate
    const code = (result && (result.code || result.err_code)) || '';
    const httpStatus = (result && result.data && result.data.status) || 0;
    const notAuthorized = 
      code === 'rest_no_route' ||
      httpStatus === 404 ||
      msg.toLowerCase().includes('validation is not available') ||
      msg.toLowerCase().includes('kindly contact') ||
      msg.toLowerCase().includes('no route was found');
    if (notAuthorized) {
      // MooGold hasn't enabled validate endpoint for this account/product
      console.log('[MooGold] validate endpoint not authorized — falling to hybrid mode');
      return { ok: null, skipped: true, message: msg };
    }
    return { ok: false, message: msg || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ' };
  } catch(e) { console.error('[MooGold] validate error:', e.message); return { ok: null, error: e.message }; }
}



// ---------- MLBB direct player validation ----------
// Uses MLBB's own public checkrole endpoint — no API key needed.
// Works regardless of whether MooGold supports validate for this product.
// validateMLBBPlayer — 3-tier strategy:
// 1. Cloudflare Worker (MLBB_WORKER_URL) — ប្រើ Worker ដែល Saem set up
// 2. MooGold product/validate — fallback ប្រសិនបើ Worker OFF
// 3. Hybrid pass — ប្រសិន​បើ​ទាំង​ 2 ខាងលើ fail → ភ្ងៀវវាយ confirm checkbox
// Returns: { ok: true, username } | { ok: false, message } | { ok: null, error }
async function validateMLBBPlayer(playerId, serverId, moogoldProductId) {
  // ── Tier 1: Cloudflare Worker ──────────────────────────────────────────
  const workerUrl = process.env.MLBB_WORKER_URL;
  if (workerUrl) {
    try {
      const result = await new Promise((resolve) => {
        const body = JSON.stringify({ playerId: String(playerId), serverId: String(serverId || '0') });
        const workerSecret = process.env.MLBB_WORKER_SECRET || '';
        let u;
        try { u = new URL(workerUrl); } catch(e) { return resolve({ ok: null, error: 'Bad worker URL' }); }
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
        if (workerSecret) headers['X-Worker-Secret'] = workerSecret;
        const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers, timeout: 8000 }, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.ok === true && json.username) resolve({ ok: true, username: json.username });
              else if (json.ok === false) resolve({ ok: false, message: json.message || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ' });
              else resolve({ ok: null, error: 'Worker response unclear' });
            } catch(e) { resolve({ ok: null, error: 'Parse error' }); }
          });
        });
        req.on('error', (e) => resolve({ ok: null, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: null, error: 'Worker timeout' }); });
        req.write(body); req.end();
      });
      if (result.ok === true || result.ok === false) {
        console.log('[MLBB] Worker result:', result.ok, result.username || result.message);
        return result;
      }
      console.log('[MLBB] Worker unavailable:', result.error, '— trying MooGold validate');
    } catch(e) {
      console.log('[MLBB] Worker threw:', e.message, '— trying MooGold validate');
    }
  }

  // ── Tier 2: MooGold product/validate ──────────────────────────────────
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
    // ok:null = endpoint not authorized for this account → tier 3
    console.log('[MLBB] MooGold validate not authorized — hybrid mode');
  }

  // ── Tier 3: Hybrid pass ────────────────────────────────────────────────
  // All automated checks unavailable → let customer confirm their own ID.
  // Order still saves with the ID they entered; admin reviews before fulfill.
  console.log('[MLBB] All validate paths unavailable — hybrid pass for', playerId);
  return { ok: null, error: 'all paths unavailable' };
}

// ---------- KHQR auto-verification (optional, env-gated) ----------
// When BAKONG_TOKEN + BAKONG_ACCOUNT_ID are set, each new order gets a
// dynamic KHQR (exact amount + order code baked in) and the server can
// confirm payment automatically via check_transaction_by_md5. Without the
// env vars the site behaves exactly as before (static KHQR + slip upload).
// BAKONG_API_BASE points at the official NBC API by default; servers
// hosted outside Cambodia should point it at a relay (e.g. Bakong Relay).
const KHQR_CONFIG = {
  token: process.env.BAKONG_TOKEN || '',
  accountId: process.env.BAKONG_ACCOUNT_ID || '',
  apiBase: process.env.BAKONG_API_BASE || 'https://api-bakong.nbc.gov.kh',
  merchantName: process.env.KHQR_MERCHANT_NAME || 'WANFUNZY',
  merchantCity: process.env.KHQR_MERCHANT_CITY || 'Phnom Penh',
  // Optional — used only for the deeplink UI shown by Bakong's redirect page
  appIconUrl: process.env.KHQR_APP_ICON_URL || '',
  deeplinkCallback: process.env.KHQR_DEEPLINK_CALLBACK || '',
  expireMinutes: 10
};
function khqrAutoEnabled() {
  return !!(KHQR_CONFIG.token && KHQR_CONFIG.accountId);
}
// Startup diagnostic — prints once on boot so a quick glance at the
// deploy log confirms whether the KHQR auto-verify is actually armed.
// Never logs the token itself, only whether it's set and its length.
console.log('[KHQR] auto-verify enabled:', khqrAutoEnabled());
console.log('[KHQR] accountId:', KHQR_CONFIG.accountId || '(not set)');
console.log('[KHQR] apiBase:', KHQR_CONFIG.apiBase);
console.log('[MooGold] auto-fulfill enabled:', moogoldEnabled());
console.log('[KHQR] token set:', KHQR_CONFIG.token ? 'yes (length=' + KHQR_CONFIG.token.length + ')' : 'NO — deeplink and auto-verify disabled');
// Per-order throttle so client polling can't burn the relay API quota:
// no matter how often the browser asks, we hit the payment API at most
// once every few seconds per order. Entries are pruned on expiry.
const khqrCheckThrottle = new Map(); // orderCode -> lastCheckMs
const KHQR_MIN_CHECK_GAP_MS = 4000;
const { renderHome } = require('./views/home');
const { renderAdminLogin } = require('./views/admin-login');
const { renderAdminDashboard } = require('./views/admin-dashboard');
const { renderOrderConfirmation } = require('./views/order-confirmation');
const { renderTrackOrder } = require('./views/track-order');
const { renderNotFound } = require('./views/not-found');
const { renderTopupSelect } = require('./views/topup-select');
const { resolveLang } = require('./views/i18n');

// Resolve the active UI language from the `lang` cookie (defaults to 'en').
function getLang(req) {
  const cookies = parseCookies(req);
  return resolveLang(cookies.lang);
}
const { renderTopupPackage } = require('./views/topup-package');
// topup-checkout view retired — Page 3 merged into the single-page flow in topup-package.js

const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'wanfunzy_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function getClientIp(req) {
  // Railway (and most platforms behind a proxy) set x-forwarded-for.
  // Fall back to the raw socket address for local/dev use.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || 'unknown';
}

// ---------- Telegram notify (optional — no admin panel required) ----------
// Set these two environment variables on Railway to get every /topup order
// pushed straight to your Telegram instantly:
//   TELEGRAM_BOT_TOKEN  → token from @BotFather
//   TELEGRAM_CHAT_ID    → your numeric chat id (message @userinfobot to get it)
// If either is missing, orders still save normally — they just won't be
// auto-pushed to Telegram. Nothing breaks either way.

function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // not configured — silently skip

  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const reqOptions = {
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  const tgReq = https.request(reqOptions, (tgRes) => {
    tgRes.on('data', () => {}); // drain, we don't need the response body
    tgRes.on('end', () => {});
  });
  tgReq.on('error', (err) => {
    console.error('Telegram notify failed:', err.message);
  });
  tgReq.write(payload);
  tgReq.end();
}

// ---------- helpers ----------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
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
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = maxBytes || 1024 * 1024; // default 1MB cap, plenty for normal forms
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseBody(req, raw) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
  }
  // application/x-www-form-urlencoded fallback
  const out = {};
  const params = new url.URLSearchParams(raw || '');
  for (const [k, v] of params) out[k] = v;
  return out;
}

// Order កំពុងរង់ចាំការស្កេន/ទូទាត់ KHQR — មិនទាន់ paid ហើយ QR មិនទាន់ hết ម៉ោង
// (expiresAt) ។ ប្រភេទ order បែបនេះកើតឡើងភ្លាមៗពេលអតិថិជនចុច checkout
// (មុននឹងគេស្កេន QR ផង) ដូច្នេះវាមិនមែនជា order ពិតប្រាកដដែល admin ត្រូវការឃើញ
// ក្នុង Dashboard ទេ ដរាបណា វានៅតែមានលទ្ធភាព paid ដោយស្វ័យប្រវត្តិ ឬ hết ម៉ោង
// ដោយខ្លួនឯង។ ប្រើ helper នេះដើម្បីច្រោះ order ទាំងនេះចេញពី Dashboard views
// (all/pending/counts...) — វានឹងលេចមកវិញភ្លាមៗពេល paid ឬ expired ឬ cancelled.
function isAwaitingKhqrPayment(order) {
  if (!order) return false;
  if (order.paymentStatus === 'cancelled') return true;
  if (!order.khqr) return false;
  // លាក់ awaiting orders រហូតដល់ QR expire ឬ paid
  if (order.paymentStatus !== 'awaiting') return false;
  const expiresAt = order.khqr.expiresAt;
  if (!expiresAt) return false;
  return Date.now() <= expiresAt;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const data = db.readDB();
  const session = data.sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete data.sessions[token];
    db.writeDB(data);
    return null;
  }
  return { token, ...session };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    send(res, 302, '', { Location: '/admin/login' });
    return null;
  }
  // Backfill: sessions created before CSRF protection existed won't have a
  // csrfToken yet. Generate and persist one now so they keep working
  // instead of getting silently locked out of every admin action.
  if (!session.csrfToken) {
    const data = db.readDB();
    if (data.sessions[session.token]) {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      data.sessions[session.token].csrfToken = csrfToken;
      db.writeDB(data);
      session.csrfToken = csrfToken;
    }
  }
  return session;
}

// CSRF check for state-changing admin API calls (POST/PATCH/DELETE). The
// admin dashboard page embeds session.csrfToken in its HTML and echoes it
// back as the X-CSRF-Token header on every fetch() call — a page an
// attacker controls has no way to read that value, so a request missing or
// mismatching it is rejected as a forged cross-site request.
function requireCsrf(req, res, session) {
  const provided = req.headers['x-csrf-token'];
  if (!provided || provided !== session.csrfToken) {
    sendJSON(res, 403, { ok: false, error: 'ការស្នើសុំមិនត្រឹមត្រូវ (CSRF token missing/invalid)។ សូម Refresh ទំព័រ ហើយសាកល្បងម្តងទៀត។' });
    return false;
  }
  return true;
}

// In-memory rate limiter, per-process — resets on redeploy, which is fine
// here (it's a deterrent against rapid automated abuse, not a hard
// security boundary). Tracks attempts per client IP within a named
// "bucket" (e.g. "login", "order") so different actions can have
// different limits without colliding with each other.
const rateLimitBuckets = new Map(); // key: `${bucket}:${ip}` -> { count, windowStart }

function isRateLimited(ip, bucket = 'login', maxAttempts = 8, windowMs = 60 * 1000) {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = rateLimitBuckets.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateLimitBuckets.set(key, entry);
  return entry.count > maxAttempts;
}

// Periodic cleanup so the map doesn't grow unbounded on a long-running
// process — stale buckets (untouched for over an hour) are dropped.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitBuckets.entries()) {
    if (now - entry.windowStart > 1000 * 60 * 60) rateLimitBuckets.delete(key);
  }
}, 1000 * 60 * 10);

// ---------- Account lockout (stronger brute-force defense for admin login) ----------
// isRateLimited() above only slows down rapid-fire attempts within a short
// window (8/min) — a patient attacker can still keep guessing indefinitely
// at a slower pace. This adds a second, independent layer: track *failed*
// login attempts per IP, and once they cross a threshold, lock that IP out
// entirely for a longer cool-down period, regardless of how slowly they try.
const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_DURATION_MS = 1000 * 60 * 15; // 15 minutes
const loginFailures = new Map(); // ip -> { count, lockedUntil }

function isLockedOut(ip) {
  const entry = loginFailures.get(ip);
  if (!entry || !entry.lockedUntil) return false;
  if (Date.now() > entry.lockedUntil) {
    // lockout expired — clear it so the IP gets a fresh start
    loginFailures.delete(ip);
    return false;
  }
  return true;
}

function recordLoginFailure(ip) {
  const entry = loginFailures.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= LOCKOUT_MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginFailures.set(ip, entry);
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

// Periodic cleanup for the lockout map too.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginFailures.entries()) {
    if (entry.lockedUntil && now > entry.lockedUntil) loginFailures.delete(ip);
  }
}, 1000 * 60 * 10);

// Periodic sweep of expired sessions out of db.json — they were already
// rejected at auth time once past expiresAt, but without this they'd pile
// up on disk forever (data hygiene, not a security hole).
setInterval(() => {
  try {
    const data = db.readDB();
    const now = Date.now();
    let removed = 0;
    for (const [token, session] of Object.entries(data.sessions || {})) {
      if (session.expiresAt && now > session.expiresAt) {
        delete data.sessions[token];
        removed++;
      }
    }
    if (removed > 0) db.writeDB(data);
  } catch (e) { /* best-effort cleanup; never crash the server over it */ }
}, 1000 * 60 * 60); // hourly

// ---------- static file serving ----------

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');

  // Uploaded images (logos, covers, etc.) live on the persistent Volume,
  // separate from the rest of public/ which is just regular deployed code
  // (CSS, the default mascot image) and doesn't need to survive redeploys.
  if (safePath.startsWith(`uploads${path.sep}`) || safePath.startsWith('uploads/')) {
    const uploadsRoot = db.getUploadsDir();
    const relative = safePath.replace(/^uploads[/\\]/, '');
    const filePath = path.join(uploadsRoot, relative);
    if (!filePath.startsWith(uploadsRoot)) {
      return send(res, 403, 'Forbidden');
    }
    return fs.readFile(filePath, (err, content) => {
      if (err) return send(res, 404, 'Not found');
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    });
  }

  const filePath = path.join(__dirname, 'public', safePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- route handlers ----------

async function handleHome(req, res) {
  const data = db.readDB();
  const activeGames = data.games.filter((g) => g.active);
  const activePackages = data.packages.filter((p) => p.active);
  send(res, 200, renderHome({ games: activeGames, packages: activePackages, settings: data.settings }));
}

// ---------- Honeypot bot check (no external CAPTCHA service needed) ----------
// The order forms include a hidden field ("website") that's invisible to
// real customers (off-screen via CSS) but that naive bot scripts fill in
// automatically when they auto-submit every field they find. If it arrives
// non-empty, the request is treated as a bot and rejected — silently, with
// a generic message, so a bot doesn't get useful feedback to adapt around.
function isHoneypotTripped(body) {
  return !!(body.website && String(body.website).trim().length > 0);
}

// ---------- Cloudflare Turnstile (optional CAPTCHA) ----------
// Only enforced when TURNSTILE_SECRET_KEY is set in the environment. If it's
// not configured, verifyTurnstile() resolves true and the order flow relies
// on the honeypot + rate limiting alone — so the site keeps working whether
// or not the admin has set up Turnstile. The matching site key is exposed to
// the page via TURNSTILE_SITE_KEY (public, safe to embed).
function turnstileEnabled() {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

async function verifyTurnstile(token, ip) {
  if (!turnstileEnabled()) return true; // not configured → skip
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', process.env.TURNSTILE_SECRET_KEY);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);

    const result = await new Promise((resolve) => {
      const postData = params.toString();
      const req = https.request({
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v0/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 8000
      }, (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false }); }
        });
      });
      req.on('error', () => resolve({ success: false }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
      req.write(postData);
      req.end();
    });
    return !!result.success;
  } catch (e) {
    // On verification error, fail closed only if Turnstile is configured.
    return false;
  }
}

async function handleCreateOrder(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'order', 10, 60 * 1000)) {
    return sendJSON(res, 429, { ok: false, error: 'សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំមួយភ្លែត។' });
  }

  const raw = await readBody(req);
  const body = parseBody(req, raw);

  if (isHoneypotTripped(body)) {
    return sendJSON(res, 400, { ok: false, error: 'មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។' });
  }

  const playerId = (body.playerId || '').trim();
  const serverId = (body.serverId || '').trim();
  const packageId = (body.packageId || '').trim();
  const gameId = (body.gameId || '').trim();
  const contact = (body.contact || '').trim();
  const note = (body.note || '').trim().slice(0, 500);

  const data = db.readDB();
  const game = data.games.find((g) => g.id === gameId && g.active);

  const errors = [];
  if (!playerId || playerId.length < 4 || playerId.length > 20 || !/^[0-9]+$/.test(playerId)) {
    errors.push('Player ID ត្រូវតែជាលេខ និងមានប្រវែងត្រឹមត្រូវ។');
  }
  if (!game) {
    errors.push('Game ដែលជ្រើសរើសមិនត្រឹមត្រូវ។');
  } else if (game.requiresServerId && (!serverId || !/^[0-9]{1,6}$/.test(serverId))) {
    errors.push('Server ID មិនត្រឹមត្រូវ។');
  }
  if (!contact || contact.length < 5 || contact.length > 100) {
    errors.push('សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Telegram សម្រាប់ទាក់ទងវិញ។');
  }

  const pkg = data.packages.find((p) => p.id === packageId && p.active && p.gameId === gameId);
  if (!pkg) errors.push('កញ្ចប់ដែលជ្រើសរើសមិនត្រឹមត្រូវ ឬលែងមានទៀតហើយ។');

  if (errors.length) {
    return sendJSON(res, 400, { ok: false, errors });
  }

  const order = {
    id: db.genId('order'),
    code: db.genOrderCode(),
    gameId: game.id,
    gameName: game.name,
    playerId,
    serverId: serverId || '',
    contact,
    note,
    packageId: pkg.id,
    packageName: pkg.name,
    price: pkg.price,
    currency: pkg.currency,
    status: 'pending', // pending -> confirmed -> delivered, or rejected
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.orders.unshift(order);
  db.writeDB(data);

  sendJSON(res, 201, { ok: true, order: { code: order.code, id: order.id } });
}

// ---------- Standalone Top-up flow (/topup) ----------
// Separate 2-page flow: Page 1 = game grid, Page 2 = packages + order form.
// Shares game/package data with the homepage, but has its own minimal nav
// (no "Owner Login", no "Track Order") and pushes orders to Telegram.

async function handleTopupSelectPage(req, res) {
  const data = db.readDB();
  send(res, 200, renderTopupSelect({ games: data.games, settings: data.settings, lang: getLang(req) }));
}

async function handleTopupPackagePage(req, res, query) {
  const gameId = (query.game || '').trim();

  // Redirect MLBB to the new standalone checkout page
  const data = db.readDB();
  const game = data.games.find((g) => g.id === gameId && g.active);
  if (game) {
    const isMlbb = gameId === 'mlbb' ||
                   (game.name || '').toLowerCase().includes('mobile legend');
    if (isMlbb) {
      return send(res, 302, '', { Location: '/mlbb' });
    }
  }

  if (!game) return send(res, 404, renderNotFound());
  const packages = data.packages.filter((p) => p.gameId === game.id && p.active);
  send(res, 200, renderTopupPackage({ game, packages, settings: data.settings, lang: getLang(req), turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '', khqrAuto: khqrAutoEnabled() }));
}

async function handleTopupCheckoutPage(req, res, query) {
  // The old separate checkout page (Page 3) has been merged into the
  // single-page flow at /topup/order — everything (account info, package
  // choice, contact, payment) now happens on one page. Old bookmarks and
  // links to /topup/checkout just get redirected there.
  const gameId = (query.game || '').trim();
  const target = gameId ? `/topup/order?game=${encodeURIComponent(gameId)}` : '/topup';
  return send(res, 302, '', { Location: target });
}

// ── MLBB Checkout Page (/mlbb) ──────────────────────────────────────────────────────────────────
// Serves the standalone MLBB top-up page with Player ID + Server ID input,
// "Show Name Player" button (calls /api/topup/validate), package table,
// and confirm modal before KHQR payment.
async function handleMlbbPackagesApi(req, res) {
  try {
    const data = db.readDB();
    const mlbbGame = data.games.find(g =>
      g.id === 'mlbb' || (g.name || '').toLowerCase().includes('mobile legend')
    );
    if (!mlbbGame) return sendJSON(res, 404, { ok: false, error: 'MLBB not configured' });

    const allPkgs = data.packages.filter(p => p.gameId === mlbbGame.id && p.active);
    const passes    = allPkgs.filter(p => /pass|pack|value/i.test(p.name));
    const firsttopup= allPkgs.filter(p => /first|1st/i.test(p.name));
    const standard  = allPkgs.filter(p => !/pass|pack|value|first|1st/i.test(p.name))
                              .sort((a,b) => a.price - b.price);
    const gameLogos = (data.settings && data.settings.gameLogos) || {};
    const cardBackgrounds = (data.settings && data.settings.cardBackgrounds) || {};
    return sendJSON(res, 200, {
      ok: true,
      game: {
        id: mlbbGame.id,
        name: mlbbGame.name,
        currencyUnit: mlbbGame.currencyUnit || '💎',
        // Both URLs are read from admin dashboard uploads.
        // logoUrl → shown as the round game icon on /mlbb (top-left).
        // bannerUrl → shown as the hero background image behind the header.
        // When either is null the client keeps its baked-in fallback image.
        logoUrl: gameLogos[mlbbGame.id] ? `/static/uploads/${gameLogos[mlbbGame.id]}` : null,
        bannerUrl: cardBackgrounds[mlbbGame.id] ? `/static/uploads/${cardBackgrounds[mlbbGame.id]}` : null
      },
      packages: { passes, firsttopup, standard }
    });
  } catch(e) { return sendJSON(res, 500, { ok: false, error: e.message }); }
}

async function handleMlbbCheckoutPage(req, res) {
  // Route /mlbb through the same renderTopupPackage() template that other
  // games use — Saem prefers the OLD page's design (two-step wizard, grid
  // package cards, Bakong-style KHQR modal, sticky bottom bar) over the
  // previous standalone HTML. This reuses one battle-tested view for all
  // games and gives MLBB the same beautiful Bakong-app-style KHQR modal
  // that was already proven on Free Fire / PUBG / HOK.
  const data = db.readDB();
  const game = data.games.find((g) =>
    g.id === 'mlbb' || (g.name || '').toLowerCase().includes('mobile legend')
  );
  if (!game) return send(res, 404, renderNotFound());
  const packages = data.packages.filter((p) => p.gameId === game.id && p.active);
  return send(res, 200, renderTopupPackage({
    game,
    packages,
    settings: data.settings,
    lang: getLang(req),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
    khqrAuto: khqrAutoEnabled()
  }));
}

// ── Terms & Conditions Page (/terms) ─────────────────────────────────────────────────────
async function handleTermsPage(req, res) {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'terms.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  } catch (e) {
    console.error('[Terms] terms.html not found:', e.message);
    return send(res, 404, '<h1>Terms page not found.</h1><p>Upload public/terms.html</p>');
  }
}

async function handleCreateTopupOrder(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'order', 10, 60 * 1000)) {
    return sendJSON(res, 429, { ok: false, errors: ['សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំមួយភ្លែត។'] });
  }

  // 8MB cap: the payload may include a base64 KHQR payment slip image
  // (base64 inflates raw bytes ~33%), so the default 1MB body limit would
  // truncate it and make the order fail. saveUploadedImage still enforces
  // its own MIME/size checks on the decoded image.
  const raw = await readBody(req, 8 * 1024 * 1024);
  const body = parseBody(req, raw);

  if (isHoneypotTripped(body)) {
    return sendJSON(res, 400, { ok: false, errors: ['មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។'] });
  }

  // Cloudflare Turnstile (only enforced if configured via env). Blocks
  // automated submissions that get past the honeypot + rate limiter.
  const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstileOk) {
    return sendJSON(res, 400, { ok: false, errors: ['ការផ្ទៀងផ្ទាត់បរាជ័យ។ សូម Refresh ទំព័រ ហើយសាកល្បងម្តងទៀត។'] });
  }

  const playerId = (body.playerId || '').trim();
  const serverId = (body.serverId || '').trim();
  const packageId = (body.packageId || '').trim();
  const gameId = (body.gameId || '').trim();
  const contact = (body.contact || '').trim();
  const note = (body.note || '').trim().slice(0, 500);

  const data = db.readDB();
  const game = data.games.find((g) => g.id === gameId && g.active);

  const errors = [];
  if (!playerId || playerId.length < 4 || playerId.length > 20 || !/^[0-9]+$/.test(playerId)) {
    errors.push('Player ID ត្រូវតែជាលេខ និងមានប្រវែងត្រឹមត្រូវ។');
  }
  if (!game) {
    errors.push('Game ដែលជ្រើសរើសមិនត្រឹមត្រូវ។');
  } else if (game.requiresServerId && (!serverId || !/^[0-9]{1,6}$/.test(serverId))) {
    errors.push('Server ID មិនត្រឹមត្រូវ។');
  }
  // Contact is now optional (removed from the checkout UI to reduce friction).
  // If provided it's still length-capped; if empty, the order proceeds — the
  // player is identified by User ID + Server ID and payment by the KHQR slip.
  if (contact && contact.length > 100) {
    errors.push('ព័ត៌មានទំនាក់ទំនងវែងពេក។');
  }

  const pkg = data.packages.find((p) => p.id === packageId && p.active && p.gameId === gameId);
  if (!pkg) errors.push('កញ្ចប់ដែលជ្រើសរើសមិនត្រឹមត្រូវ ឬលែងមានទៀតហើយ។');

  if (errors.length) {
    return sendJSON(res, 400, { ok: false, errors });
  }

  // Optional KHQR payment slip — customer may attach a screenshot of their
  // transfer. Stored like any other uploaded image; failure to save is
  // non-fatal (the order still goes through, admin can follow up).
  let slipFilename = '';
  if (body.slip && typeof body.slip === 'string' && body.slip.startsWith('data:image')) {
    try {
      slipFilename = db.saveUploadedImage(body.slip, 'slip-' + Date.now());
    } catch (e) { slipFilename = ''; }
  }

  const order = {
    id: db.genId('order'),
    code: db.genOrderCode(),
    gameId: game.id,
    gameName: game.name,
    playerId,
    serverId: serverId || '',
    contact,
    note,
    packageId: pkg.id,
    packageName: pkg.name,
    price: pkg.price,
    currency: pkg.currency,
    status: 'pending',
    channel: 'topup', // tags orders that came from the standalone /topup flow
    paymentSlip: slipFilename, // KHQR payment screenshot, if uploaded
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.orders.unshift(order);

  // Dynamic KHQR for auto-verification (only when configured). Generated
  // locally — no API call. The md5 is what we later use to ask Bakong
  // whether this exact QR was paid. payToken gates the public
  // payment-status endpoint so order codes alone can't be probed.
  let khqrPayload = null;
  if (khqrAutoEnabled()) {
    try {
      const gen = khqr.generateKhqr({
        accountId: KHQR_CONFIG.accountId,
        merchantName: KHQR_CONFIG.merchantName,
        merchantCity: KHQR_CONFIG.merchantCity,
        amount: order.price,
        currency: 'USD',
        billNumber: order.code,
        expireMinutes: KHQR_CONFIG.expireMinutes
      });
      order.payToken = crypto.randomBytes(16).toString('hex');
      order.paymentStatus = 'awaiting'; // awaiting | paid
      order.khqr = { qr: gen.qr, md5: gen.md5, expiresAt: gen.expiresAt };
      khqrPayload = { qr: gen.qr, expiresAt: gen.expiresAt, payToken: order.payToken };
      console.log('[KHQR] order', order.code, 'has KHQR attached, md5=', gen.md5.slice(0, 8) + '...');
      // Deeplink is fetched by the browser in the background via
      // /api/topup/orders/deeplink so create-order stays fast even if
      // Bakong's deeplink endpoint is slow. The QR still works during
      // the wait, and the "Open bank app" button appears as soon as it
      // resolves (or stays hidden if Bakong is unreachable).
    } catch (e) {
      // Non-fatal: the order still goes through the manual flow.
      console.log('[KHQR] KHQR generation FAILED for', order.code, ':', e.message);
      khqrPayload = null;
    }
  } else {
    console.log('[KHQR] order', order.code, 'has NO KHQR — auto mode disabled (missing token or accountId)');
  }

  db.writeDB(data);

  const serverLine = order.serverId ? ` (Server ${order.serverId})` : '';
  notifyTelegram(
    `🆕 <b>Order ថ្មីពី /topup</b>\n` +
    `🎮 Game: ${order.gameName}\n` +
    `📦 កញ្ចប់: ${order.packageName} — $${order.price.toFixed(2)}\n` +
    `🆔 Player ID: ${order.playerId}${serverLine}\n` +
    `📞 ទំនាក់ទំនង: ${order.contact}\n` +
    `🔖 Code: ${order.code}` +
    (order.note ? `\n📝 ចំណាំ: ${order.note}` : '')
  );

  sendJSON(res, 201, { ok: true, order: { code: order.code, id: order.id }, khqr: khqrPayload });
}

// GET /api/topup/orders/payment-status?code=...&t=...
// Public endpoint the checkout page polls while the customer scans the QR.
// Guarded by: per-IP rate limit, a per-order random payToken (so order
// codes alone can't be probed), and a per-order throttle so browser
// polling can never hit the payment API more than once per few seconds.
// GET /api/topup/orders/deeplink?code=...&t=...
// Fetched by the browser in the background after order creation. Splits
// the slow Bakong deeplink call off the critical order-creation path so
// the checkout modal opens instantly. Same auth guards as payment-status.
// Cached on the order once resolved so a page refresh doesn't re-hit
// Bakong.
// POST /api/topup/orders/cancel — customer clicked the × on the KHQR
// modal. Marks the order paymentStatus='cancelled' so it drops out of
// the admin "awaiting" list and lands in a dedicated cancelled tab.
// Refuses if the order has already been paid (money already came in;
// admin has to handle that manually rather than us silently cancelling
// a real payment). Same authentication as payment-status: order code +
// payToken with a timing-safe compare.
// GET /api/topup/validate?gameId=mlbb&playerId=123456789&serverId=2001
// Called by the checkout page "Show Name Player" button.
// MLBB: uses Cloudflare Worker → MLBB checkrole API directly (no MooGold needed)
// Other games: falls back to MooGold product/validate
// Returns { ok: true, username: '...' } or { ok: false, message: '...' }
async function handleValidatePlayer(req, res, query) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'validate', 20, 60 * 1000)) {
    return sendJSON(res, 429, { ok: false, message: 'សកម្មភាពញឹកញាប់ពេក។ សូមរង់ចាំ។' });
  }

  const playerId = (query.playerId || '').trim();
  const serverId = (query.serverId || '').trim();

  if (!playerId || !/^[0-9]{4,20}$/.test(playerId)) {
    return sendJSON(res, 400, { ok: false, message: 'Player ID មិនត្រឹមត្រូវ។' });
  }
  if (!serverId || !/^[0-9]{1,6}$/.test(serverId)) {
    return sendJSON(res, 400, { ok: false, message: 'Server ID មិនត្រឹមត្រូវ។' });
  }

  // ── Validation SKIPPED entirely (2026-07-12) ────────────────────────────
  // External validate sources (MLBB Worker, MooGold product/validate) are
  // unreliable — either not authorized on the MooGold account, blocked by
  // Railway DNS, or return wrong-game data from unofficial reseller APIs.
  // Calling them was also the root cause of "Application failed to respond"
  // crashes when a request hung waiting on a dead upstream.
  // Decision: skip automated validation entirely. Customer confirms their
  // own Player ID + Zone ID via a checkbox in the UI, then proceeds
  // straight to package selection. This is instant, never hangs, and never
  // depends on a third-party endpoint's uptime.
  console.log('[Validate] skipped (manual confirm mode) — playerId:', playerId, '/ serverId:', serverId);
  return sendJSON(res, 200, {
    ok: true,
    username: '',
    skipped: true,
    message: 'សូមបញ្ជាក់ Player ID + Zone ID ខ្លួនឯង ក្នុង Game មុន'
  });
}

// ---------- LEGACY (unused) — kept for reference, not called anywhere ----
async function handleValidatePlayer_LEGACY_UNUSED(req, res, query) {
  const data = db.readDB();
  const gameId = (query.gameId || '').trim();
  const playerId = (query.playerId || '').trim();
  const serverId = (query.serverId || '').trim();
  const packageId = (query.packageId || '').trim();
  let pkg = packageId
    ? data.packages.find(p => p.id === packageId && p.active && p.moogoldProductId)
    : null;
  if (!pkg) pkg = data.packages.find(p => p.gameId === gameId && p.active && p.moogoldProductId);
  const productId = pkg && pkg.moogoldProductId;

  if (!productId) {
    console.log('[Validate] no moogoldProductId for game', gameId);
    return sendJSON(res, 200, { ok: false, message: 'មិនអាចពិនិត្យ Player ID បានទេ។ សូមទាក់ទង Admin។' });
  }

  const result = await validatePlayerWithMooGold(productId, playerId, serverId);

  if (result.ok === true && result.username) {
    console.log('[Validate] MooGold SUCCESS —', playerId, '→', result.username);
    return sendJSON(res, 200, { ok: true, username: result.username });
  }
  if (result.ok === true && !result.username) {
    return sendJSON(res, 200, { ok: false, message: 'Player ID ឬ Server ID មិនត្រឹមត្រូវ។' });
  }
  if (result.ok === null) {
    return sendJSON(res, 200, {
      ok: true, username: '', skipped: true,
      message: 'មិនអាច verify — សូមឆែក ID ដោយខ្លួនឯង'
    });
  }
  return sendJSON(res, 200, {
    ok: false,
    message: result.message || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ។'
  });
}


// ---------- MooGold Callback endpoint ----------
// MooGold calls POST /api/moogold/callback when order status changes.
// Contact MooGold account manager to register: https://wanfunzy.com/api/moogold/callback
// Callback sends: { status, message, account_details, order_id, total }
// Must reply: { "status": "success" }
async function handleMooGoldCallback(req, res) {
  // ── Security: verify callback secret to block fake/spoofed callbacks ──
  // Set MOOGOLD_CALLBACK_SECRET in Railway env vars, then tell MooGold CS
  // to include it as header: x-callback-secret: YOUR_SECRET
  const callbackSecret = process.env.MOOGOLD_CALLBACK_SECRET;
  if (callbackSecret) {
    const provided = (req.headers['x-callback-secret'] || '').trim();
    if (!provided || provided !== callbackSecret) {
      console.warn('[MooGold] callback REJECTED — invalid secret from', getClientIp(req));
      return sendJSON(res, 401, { status: 'error' });
    }
  }

  let body;
  try {
    const raw = await readBody(req);
    body = parseBody(req, raw);
  } catch(e) {
    return sendJSON(res, 400, { status: 'error' });
  }

  console.log('[MooGold] callback received:', JSON.stringify(body).slice(0, 500));

  const status = (body.status || '').toLowerCase();
  const moogoldOrderId = body.order_id;
  const partnerOrderId = body.account_details && body.account_details.partnerOrderId;

  // Find order by MooGold order_id or partnerOrderId
  const data = db.readDB();
  const order = data.orders.find(o =>
    (moogoldOrderId && String(o.moogoldOrderId) === String(moogoldOrderId)) ||
    (partnerOrderId && o.code === partnerOrderId)
  );

  if (order) {
    if (status === 'completed') {
      order.moogoldStatus = 'completed';
      order.status = 'delivered';
      order.note = (order.note ? order.note + ' | ' : '') + '✅ MooGold completed (callback)';
      order.updatedAt = new Date().toISOString();
      db.writeDB(data);
      notifyTelegram(
        `🎮 <b>Diamond បញ្ចូលរួចរាល់! ✅</b>
` +
        `🔖 Code: ${order.code}
` +
        `📦 ${order.packageName} — $${order.price.toFixed(2)}
` +
        `🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ' ('+order.serverId+')' : ''}
` +
        `🆔 MooGold Order: ${moogoldOrderId}`
      );
    } else if (status === 'refunded') {
      order.moogoldStatus = 'refunded';
      order.note = (order.note ? order.note + ' | ' : '') + '🔴 MooGold refunded (callback)';
      order.updatedAt = new Date().toISOString();
      db.writeDB(data);
      notifyTelegram(
        `🔴 <b>MooGold REFUNDED!</b>
` +
        `🔖 Code: ${order.code}
` +
        `🆔 MooGold Order: ${moogoldOrderId}
` +
        `⚠️ <b>ពិនិត្យ Player ID + Server ID!</b>`
      );
    } else if (status === 'incorrect-details') {
      order.moogoldStatus = 'incorrect-details';
      order.note = (order.note ? order.note + ' | ' : '') + '⚠️ MooGold incorrect-details (callback)';
      order.updatedAt = new Date().toISOString();
      db.writeDB(data);
      notifyTelegram(
        `⚠️ <b>MooGold: Incorrect Details!</b>
` +
        `🔖 Code: ${order.code}
` +
        `🆔 MooGold Order: ${moogoldOrderId}
` +
        `🔔 <b>Player ID ខុស — ទាក់ទង MooGold CS!</b>`
      );
    }
  } else {
    console.log('[MooGold] callback: order not found for order_id:', moogoldOrderId, 'partnerOrderId:', partnerOrderId);
  }

  // Must reply success so MooGold stops retrying
  sendJSON(res, 200, { status: 'success' });
}

async function handleOrderCancel(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'cancel', 20, 60 * 1000)) {
    return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  }

  let body;
  try {
    const raw = await readBody(req);
    body = parseBody(req, raw);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: 'Bad request' });
  }
  const code = (body.code || '').trim();
  const token = (body.t || '').trim();
  if (!code) return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });

  const data = db.readDB();
  const order = data.orders.find((o) => o.code === code && o.channel === 'topup');
  if (!order || order.deleted) {
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }
  if (order.payToken) {
    if (!token) return sendJSON(res, 400, { ok: false, error: 'Missing token' });
    const a = crypto.createHash('sha256').update(token).digest();
    const b = crypto.createHash('sha256').update(order.payToken).digest();
    if (!crypto.timingSafeEqual(a, b)) return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }

  // Don't cancel orders that are already paid — the payment came through
  // in the last moment and the admin needs to see it.
  if (order.paymentStatus === 'paid' || order.status === 'confirmed') {
    return sendJSON(res, 200, { ok: true, status: order.paymentStatus });
  }

  order.paymentStatus = 'cancelled';
  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  db.writeDB(data);
  console.log('[KHQR] order cancelled by user:', code);
  sendJSON(res, 200, { ok: true, status: 'cancelled' });
}

async function handleOrderDeeplink(req, res, query) {
  console.log('[KHQR] deeplink endpoint hit — code:', query.code);
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'deeplink', 20, 60 * 1000)) {
    console.log('[KHQR] deeplink RATE LIMITED for ip', ip);
    return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  }

  const code = (query.code || '').trim();
  const token = (query.t || '').trim();
  if (!code || !token) {
    console.log('[KHQR] deeplink MISSING PARAMS — code:', !!code, 'token:', !!token);
    return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });
  }

  const data = db.readDB();
  const order = data.orders.find((o) => o.code === code && o.channel === 'topup');
  if (!order || !order.payToken || !order.khqr || order.deleted) {
    console.log('[KHQR] deeplink ORDER NOT FOUND — has order:', !!order, 'has payToken:', !!(order && order.payToken), 'has khqr:', !!(order && order.khqr), 'deleted:', order && order.deleted);
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(order.payToken).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    console.log('[KHQR] deeplink BAD TOKEN for order', code);
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }

  // Already resolved (or explicitly marked unavailable).
  if (order.khqr.deeplink) {
    console.log('[KHQR] deeplink CACHED HIT for', code);
    return sendJSON(res, 200, { ok: true, deeplink: order.khqr.deeplink });
  }
  if (order.khqr.deeplinkFailed) {
    console.log('[KHQR] deeplink CACHED FAILURE for', code);
    return sendJSON(res, 200, { ok: true, deeplink: null });
  }

  console.log('[KHQR] calling Bakong generate_deeplink_by_qr for', code, '→', KHQR_CONFIG.apiBase);
  let dl;
  try {
    dl = await khqr.generateDeeplink(order.khqr.qr, {
      appName: KHQR_CONFIG.merchantName,
      appIconUrl: KHQR_CONFIG.appIconUrl,
      callback: KHQR_CONFIG.deeplinkCallback
    }, KHQR_CONFIG);
    console.log('[KHQR] Bakong deeplink response:', JSON.stringify(dl).slice(0, 300));
  } catch (e) {
    // Transient error — don't cache failure, next poll may succeed.
    console.log('[KHQR] Bakong deeplink THREW:', e.message);
    return sendJSON(res, 200, { ok: true, deeplink: null });
  }

  // Validate the returned URL before ever handing it to the browser:
  // must be HTTPS from a Bakong-controlled host, sane length, string type.
  // Guards against a compromised relay smuggling in a javascript: URL or
  // a phishing domain.
  if (dl && dl.responseCode === 0 && dl.data && typeof dl.data.shortLink === 'string') {
    let parsedDl;
    try { parsedDl = new URL(dl.data.shortLink); } catch (e) { parsedDl = null; }
    const isSafe = parsedDl
      && parsedDl.protocol === 'https:'
      && /(?:^|\.)(bakong\.gov\.kh|bakong\.page\.link|page\.link)$/i.test(parsedDl.hostname)
      && dl.data.shortLink.length < 500;
    if (isSafe) {
      console.log('[KHQR] deeplink OK for', code, '→', dl.data.shortLink);
      order.khqr.deeplink = dl.data.shortLink;
      db.writeDB(data);
      return sendJSON(res, 200, { ok: true, deeplink: dl.data.shortLink });
    }
    console.log('[KHQR] deeplink REJECTED (unsafe URL) for', code, '→ host:', parsedDl && parsedDl.hostname);
  } else {
    console.log('[KHQR] deeplink API returned failure — responseCode:', dl && dl.responseCode, 'errorCode:', dl && dl.errorCode, 'message:', dl && dl.responseMessage);
  }

  // Permanent failure (bad response shape) — cache so we don't keep asking.
  order.khqr.deeplinkFailed = true;
  db.writeDB(data);
  sendJSON(res, 200, { ok: true, deeplink: null });
}

async function handleOrderPaymentStatus(req, res, query) {
  const ip = getClientIp(req);
  if (isRateLimited(ip, 'paycheck', 40, 60 * 1000)) {
    return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  }

  const code = (query.code || '').trim();
  const token = (query.t || '').trim();
  if (!code || !token) return sendJSON(res, 400, { ok: false, error: 'Missing parameters' });

  const data = db.readDB();
  const order = data.orders.find((o) => o.code === code && o.channel === 'topup');
  if (!order || !order.payToken || !order.khqr || order.deleted) {
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }

  // Constant-time token compare (both sides hashed to fixed length first).
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(order.payToken).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }

  if (order.paymentStatus === 'paid') {
    return sendJSON(res, 200, { ok: true, status: 'paid' });
  }

  const now = Date.now();
  if (order.khqr.expiresAt && now > order.khqr.expiresAt) {
    khqrCheckThrottle.delete(order.code);
    return sendJSON(res, 200, { ok: true, status: 'expired' });
  }

  // Throttle actual API calls regardless of client polling frequency.
  const last = khqrCheckThrottle.get(order.code) || 0;
  if (now - last < KHQR_MIN_CHECK_GAP_MS) {
    return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  }
  khqrCheckThrottle.set(order.code, now);

  let result;
  try {
    result = await khqr.checkTransactionByMd5(order.khqr.md5, KHQR_CONFIG);
  } catch (e) {
    // Network/relay hiccup: report "awaiting" — the next poll retries.
    return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  }

  // responseCode 0 = transaction found (paid). Anything else = not yet.
  if (!result || result.responseCode !== 0 || !result.data) {
    return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  }

  // Defense in depth: the md5 already pins the exact QR (amount + currency
  // + account are hashed into it), but verify the reported transaction
  // matches what this order expects before trusting it.
  const tx = result.data;
  const amountOk = Math.abs(Number(tx.amount) - Number(order.price)) < 0.005;
  const currencyOk = !tx.currency || String(tx.currency).toUpperCase() === 'USD';
  const accountOk = !tx.toAccountId ||
    String(tx.toAccountId).toLowerCase() === KHQR_CONFIG.accountId.toLowerCase();
  if (!amountOk || !currencyOk || !accountOk) {
    return sendJSON(res, 200, { ok: true, status: 'awaiting' });
  }

  order.paymentStatus = 'paid';
  order.paidAt = new Date().toISOString();
  order.paymentMethod = 'khqr-auto';
  order.note = (order.note ? order.note + ' | ' : '') + '✅ KHQR paid (auto-verified)';
  order.updatedAt = new Date().toISOString();
  db.writeDB(data);
  khqrCheckThrottle.delete(order.code);

  // MooGold auto-fulfill — background, non-blocking
  (async () => {
    const dbData2 = db.readDB();
    const orderRef = dbData2.orders.find(o => o.code === order.code);
    const pkg = dbData2.packages && dbData2.packages.find(p => p.id === order.packageId);
    if (orderRef) {
      // Backfill moogoldProductId ពី package (package ប្រហែល update ក្រោយ order បង្កើត)
      if (pkg && pkg.moogoldProductId) orderRef.moogoldProductId = pkg.moogoldProductId;

      // [FIX] Backfill player fields ពី in-memory order snapshot ទៅ DB copy។
      // DB re-read (dbData2) អាច stale ឬ missing fields ដោយ race condition
      // រវាង order creation និង KHQR payment confirm។
      // បើ orderRef missing playerId ឬ serverId → MooGold ទទួល empty string → refund ភ្លាម។
      // ប្រើ || ជំនួស !x && y — override empty string '' ផង មិនមែន undefined តែ។
      // orderRef.serverId = '' (empty string) គឺ falsy → override ពី original order។
      orderRef.playerId = orderRef.playerId || order.playerId;
      orderRef.serverId = orderRef.serverId || order.serverId;
      orderRef.gameId   = orderRef.gameId   || order.gameId;
      orderRef.gameName = orderRef.gameName || order.gameName;

      console.log('[MooGold] fulfill fields →',
        'playerId:', orderRef.playerId,
        '| serverId:', orderRef.serverId || '(none)',
        '| gameId:', orderRef.gameId,
        '| moogoldProductId:', orderRef.moogoldProductId
      );
    }
    const fulfillResult = await fulfillWithMooGold(orderRef || order);
    console.log('[MooGold] fulfill result for', order.code, ':', JSON.stringify(fulfillResult));
    const dbData3 = db.readDB();
    const o3 = dbData3.orders.find(o => o.code === order.code);
    if (o3) {
      if (fulfillResult.ok) {
        o3.moogoldOrderId = fulfillResult.moogoldOrderId;
        o3.moogoldStatus = fulfillResult.status;
        o3.status = 'confirmed';
        o3.note = (o3.note ? o3.note + ' | ' : '') + '🎮 MooGold #' + (fulfillResult.moogoldOrderId || 'submitted');
        notifyTelegram(
          `💰 <b>ទទួលប្រាក់ + Diamond ✅</b>\n` +
          `🔖 Code: ${order.code}\n` +
          `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
          `🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ' ('+order.serverId+')' : ''}\n` +
          `🆔 MooGold Order: ${fulfillResult.moogoldOrderId || '(processing)'}\n` +
          `✅ Diamond កំពុងបញ្ចូល!`
        );
        // Poll MooGold for final status (processing → completed/refunded)
        if (fulfillResult.status === 'processing' || fulfillResult.status === 'processing') {
          pollMooGoldOrderStatus(order.code, fulfillResult.moogoldOrderId).catch(e => console.error('[MooGold] poll start error:', e.message));
        }
      } else {
        o3.moogoldError = fulfillResult.error;
        const refundTag = fulfillResult.refunded ? '🔴 REFUNDED' : '⚠️ Error';
        o3.note = (o3.note ? o3.note + ' | ' : '') + refundTag + ': ' + fulfillResult.error;
        notifyTelegram(
          `💰 <b>ទទួលប្រាក់ ✅ — MooGold ⚠️</b>\n` +
          `🔖 Code: ${order.code}\n` +
          `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
          `🎮 ${order.gameName} | <code>${order.playerId}</code>${order.serverId ? ' ('+order.serverId+')' : ''}\n` +
          `❌ ${fulfillResult.error}\n` +
          `🔔 <b>បញ្ចូល Diamond ដោយដៃ!</b>`
        );
      }
      o3.updatedAt = new Date().toISOString();
      db.writeDB(dbData3);
    }
  })().catch(e => console.error('[MooGold] fulfill error:', e.message));

  notifyTelegram(
    `💰 <b>ទទួលបានការទូទាត់ KHQR (auto)</b>\n` +
    `🔖 Code: ${order.code}\n` +
    `📦 ${order.packageName} — $${order.price.toFixed(2)}\n` +
    `🎮 ${order.gameName} — Player ${order.playerId}${order.serverId ? ' (Server ' + order.serverId + ')' : ''}`
  );

  sendJSON(res, 200, { ok: true, status: 'paid' });
}

async function handleOrderConfirmationPage(req, res, query) {
  const code = (query.code || '').trim();
  const data = db.readDB();
  const order = data.orders.find((o) => o.code === code);
  if (!order) return send(res, 404, renderNotFound());
  const paid = query.paid === '1' || order.paymentStatus === 'paid';
  send(res, 200, renderOrderConfirmation({ order, paid }));
}

async function handleTrackOrderPage(req, res, query) {
  const code = (query.code || '').trim();
  const data = db.readDB();
  const order = code ? data.orders.find((o) => o.code === code.toUpperCase()) : null;
  send(res, 200, renderTrackOrder({ order, searched: !!code }));
}

async function handleDebugIp(req, res) {
  // Returns the outbound IP MooGold sees. Delete this endpoint once
  // you've confirmed the IP is whitelisted correctly.
  const options = { hostname: 'api.ipify.org', path: '/?format=json', method: 'GET', timeout: 5000 };
  const req2 = https.request(options, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        sendJSON(res, 200, {
          ok: true,
          outboundIp: parsed.ip,
          message: 'This is the IP MooGold sees. Give this to MooGold CS for whitelisting.'
        });
      } catch(e) {
        sendJSON(res, 500, { ok: false, error: 'Could not parse ipify response', raw: data });
      }
    });
  });
  req2.on('error', (e) => sendJSON(res, 500, { ok: false, error: e.message }));
  req2.on('timeout', () => { req2.destroy(); sendJSON(res, 500, { ok: false, error: 'timeout' }); });
  req2.end();
}

async function handleAdminLoginPage(req, res) {
  const session = getSession(req);
  if (session) return send(res, 302, '', { Location: '/admin' });
  send(res, 200, renderAdminLogin({}));
}

async function handleAdminLoginSubmit(req, res) {
  const ip = getClientIp(req);

  // Longer-term lockout check first — if this IP has racked up too many
  // wrong passwords recently, refuse outright without even touching the
  // faster rate limiter below.
  if (isLockedOut(ip)) {
    return send(res, 429, renderAdminLogin({
      error: 'គណនីត្រូវបានចាក់សោបណ្តោះអាសន្នដោយសារការប៉ុនប៉ងចូលខុសច្រើនដង។ សូមរង់ចាំ ១៥ នាទី។'
    }));
  }

  if (isRateLimited(ip)) {
    return send(res, 429, renderAdminLogin({ error: 'ការប៉ុនប៉ងចូលច្រើនពេក។ សូមរង់ចាំមួយនាទី។' }));
  }

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const username = (body.username || '').trim();
  const password = body.password || '';

  const data = db.readDB();
  const admin = data.admins.find((a) => a.username === username);

  if (!admin || !db.verifyPassword(password, admin.salt, admin.hash)) {
    recordLoginFailure(ip);
    return send(res, 401, renderAdminLogin({ error: 'ឈ្មោះ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។' }));
  }

  // Successful login — this IP is no longer under suspicion.
  clearLoginFailures(ip);

  const token = crypto.randomBytes(32).toString('hex');
  // A separate token (distinct from the session cookie itself) that gets
  // embedded directly in the admin dashboard HTML and echoed back by the
  // page's own JS as a request header on every state-changing call. Cross-
  // site attackers can forge a request that rides on the victim's cookies,
  // but they can't read this value out of a page they don't control — so
  // a request missing/mismatching it is rejected as forged (CSRF).
  const csrfToken = crypto.randomBytes(32).toString('hex');
  data.sessions[token] = {
    adminId: admin.id,
    username: admin.username,
    csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  db.writeDB(data);

  setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000 });
  send(res, 302, '', { Location: '/admin' });
}

async function handleAdminLogout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const data = db.readDB();
    const session = data.sessions[token];
    // CSRF check: the logout form embeds the session's csrfToken as a
    // hidden field. A cross-site forged POST won't know it, so it can't
    // force the admin out of their session (annoyance-level attack, but
    // free to close off). Legacy sessions without a token pass through.
    if (session && session.csrfToken) {
      const raw = await readBody(req);
      const body = parseBody(req, raw);
      if (body.csrf !== session.csrfToken) {
        return send(res, 302, '', { Location: '/admin' });
      }
    }
    delete data.sessions[token];
    db.writeDB(data);
  }
  clearCookie(res, SESSION_COOKIE);
  send(res, 302, '', { Location: '/admin/login' });
}

async function handleAdminDashboard(req, res, query) {
  const session = requireAuth(req, res);
  if (!session) return;
  const data = db.readDB();
  const filter = query.status || 'all';
  // Every tab except the dedicated Deleted view hides soft-deleted orders,
  // AND hides orders still awaiting KHQR scan (not yet paid, QR not yet
  // expired) — these are "in-progress checkouts", not confirmed orders
  // yet. They reappear on their own the moment they're paid, expire, or
  // get cancelled by the customer.
  const activeOrders = data.orders.filter((o) => !o.deleted && !isAwaitingKhqrPayment(o));
  let orders;
  if (filter === 'deleted') {
    orders = data.orders.filter((o) => o.deleted);
  } else if (filter === 'all') {
    orders = activeOrders;
  } else {
    orders = activeOrders.filter((o) => o.status === filter);
  }
  send(res, 200, renderAdminDashboard({
    orders,
    packages: data.packages,
    games: data.games,
    settings: data.settings,
    filter,
    username: session.username,
    csrfToken: session.csrfToken,
    counts: {
      all: activeOrders.length,
      pending: activeOrders.filter((o) => o.status === 'pending').length,
      confirmed: activeOrders.filter((o) => o.status === 'confirmed').length,
      delivered: activeOrders.filter((o) => o.status === 'delivered').length,
      rejected: activeOrders.filter((o) => o.status === 'rejected').length,
      deleted: data.orders.filter((o) => o.deleted).length
    }
  }));
}

async function handleUpdateOrderStatus(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const status = body.status;
  const validStatuses = ['pending', 'confirmed', 'delivered', 'rejected'];
  if (!validStatuses.includes(status)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid status' });
  }

  const data = db.readDB();
  const order = data.orders.find((o) => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });

  order.status = status;
  order.updatedAt = new Date().toISOString();
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, order });
}

// Soft-delete: flag the order as deleted so it's hidden from the main
// tabs but stays recoverable from the "Deleted" tab. Preferred over hard
// delete so a mis-click on a real order isn't a catastrophe.
async function handleDeleteOrder(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const order = data.orders.find((o) => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });

  order.deleted = true;
  order.deletedAt = new Date().toISOString();
  order.updatedAt = order.deletedAt;
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

async function handleRestoreOrder(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const order = data.orders.find((o) => o.id === params.orderId);
  if (!order) return sendJSON(res, 404, { ok: false, error: 'Order not found' });

  delete order.deleted;
  delete order.deletedAt;
  order.updatedAt = new Date().toISOString();
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

// Hard-delete: only allowed for orders already in the deleted state, so
// this is a two-step process (soft delete first, then permanent purge).
// Also cleans up the uploaded payment slip so we don't leak disk space.
async function handleHardDeleteOrder(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const idx = data.orders.findIndex((o) => o.id === params.orderId);
  if (idx === -1) return sendJSON(res, 404, { ok: false, error: 'Order not found' });
  if (!data.orders[idx].deleted) {
    return sendJSON(res, 400, { ok: false, error: 'Order must be soft-deleted first' });
  }

  // Best-effort cleanup of the associated payment slip file.
  const slip = data.orders[idx].paymentSlip;
  if (slip) {
    try { db.deleteUploadedImage(slip); } catch (e) { /* non-fatal */ }
  }
  data.orders.splice(idx, 1);
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

// Bulk hard-delete: purge every currently-deleted order in one shot.
// Same rule — only orders already flagged deleted are affected.
async function handleBulkHardDeleteOrders(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (!ids.length) return sendJSON(res, 400, { ok: false, error: 'No order IDs provided' });

  const data = db.readDB();
  const toRemove = new Set(ids);
  let count = 0;
  data.orders = data.orders.filter((o) => {
    // Only purge orders that are both selected AND currently soft-deleted.
    if (toRemove.has(o.id) && o.deleted) {
      if (o.paymentSlip) {
        try { db.deleteUploadedImage(o.paymentSlip); } catch (e) { /* non-fatal */ }
      }
      count++;
      return false;
    }
    return true;
  });
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, deleted: count });
}

// Bulk soft-delete: for wiping test orders in one shot. Body: { ids: [] }
async function handleBulkDeleteOrders(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (!ids.length) return sendJSON(res, 400, { ok: false, error: 'No order IDs provided' });

  const data = db.readDB();
  const now = new Date().toISOString();
  let count = 0;
  data.orders.forEach((o) => {
    if (ids.includes(o.id) && !o.deleted) {
      o.deleted = true;
      o.deletedAt = now;
      o.updatedAt = now;
      count++;
    }
  });
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, deleted: count });
}

async function handleUpdatePackage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);

  const data = db.readDB();
  const pkg = data.packages.find((p) => p.id === params.packageId);
  if (!pkg) return sendJSON(res, 404, { ok: false, error: 'Package not found' });

  if (typeof body.name === 'string' && body.name.trim()) pkg.name = body.name.trim().slice(0, 60);
  if (body.price !== undefined) {
    const price = parseFloat(body.price);
    if (!isNaN(price) && price >= 0) pkg.price = price;
  }
  if (body.amount !== undefined) {
    const a = parseInt(body.amount, 10);
    if (!isNaN(a) && a >= 0) pkg.amount = a;
  }
  if (body.bonus !== undefined) {
    const b = parseInt(body.bonus, 10);
    if (!isNaN(b) && b >= 0) pkg.bonus = b;
  }
  if (typeof body.active === 'boolean') pkg.active = body.active;
  if (typeof body.active === 'string') pkg.active = body.active === 'true';
  // Explicit section tag — lets admin move a package between the 4 sections
  // without renaming it to trigger a different regex match.
  const VALID_CATEGORIES = ['passes', 'firsttopup', 'bonusDiamond', 'pureDiamond'];
  if (body.category !== undefined) {
    pkg.category = VALID_CATEGORIES.includes(body.category) ? body.category : undefined;
  }
  // Save MooGold product ID — required for auto-fulfill after KHQR payment
  if (body.moogoldProductId !== undefined) {
    const mid = String(body.moogoldProductId || '').trim();
    pkg.moogoldProductId = mid || null;
  }

  db.writeDB(data);
  sendJSON(res, 200, { ok: true, package: pkg });
}

async function handleCreatePackage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const name = (body.name || '').trim();
  const gameId = (body.gameId || '').trim();
  const price = parseFloat(body.price);
  const amount = parseInt(body.amount, 10) || 0;
  const bonus = parseInt(body.bonus, 10) || 0;
  // Explicit section tag from the admin UI's "+ Add" button (which section
  // it was clicked from): 'passes' | 'firsttopup' | 'bonusDiamond' | 'pureDiamond'.
  // Storing this directly avoids mis-classifying a brand-new package (which
  // defaults to bonus:0, price:0) into the wrong section via regex/bonus
  // guessing — it always renders in the exact section Saem added it from.
  const VALID_CATEGORIES = ['passes', 'firsttopup', 'bonusDiamond', 'pureDiamond'];
  const category = VALID_CATEGORIES.includes(body.category) ? body.category : undefined;

  if (!name || isNaN(price) || price < 0) {
    return sendJSON(res, 400, { ok: false, error: 'Name and valid price are required' });
  }

  const data = db.readDB();
  const game = data.games.find((g) => g.id === gameId);
  if (!game) {
    return sendJSON(res, 400, { ok: false, error: 'Valid gameId is required' });
  }

  const pkg = {
    id: db.genId('pkg'),
    gameId: game.id,
    name: name.slice(0, 60),
    amount,
    bonus,
    price,
    currency: 'USD',
    active: true,
    category // explicit section tag; undefined for older creation paths
  };
  data.packages.push(pkg);
  db.writeDB(data);
  sendJSON(res, 201, { ok: true, package: pkg });
}

async function handleDeletePackage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const idx = data.packages.findIndex((p) => p.id === params.packageId);
  if (idx === -1) return sendJSON(res, 404, { ok: false, error: 'Package not found' });

  data.packages.splice(idx, 1);
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleChangePassword(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';

  if (newPassword.length < 8) {
    return sendJSON(res, 400, { ok: false, error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៨ តួអក្សរ។' });
  }

  const data = db.readDB();
  const admin = data.admins.find((a) => a.id === session.adminId);
  if (!admin || !db.verifyPassword(currentPassword, admin.salt, admin.hash)) {
    return sendJSON(res, 401, { ok: false, error: 'ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវ។' });
  }

  const { salt, hash } = db.hashPassword(newPassword);
  admin.salt = salt;
  admin.hash = hash;
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

async function handleUpdateColors(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const hexPattern = /^#[0-9A-Fa-f]{6}$/;

  const data = db.readDB();
  ['heading', 'body', 'accent'].forEach((key) => {
    if (typeof body[key] === 'string' && hexPattern.test(body[key])) {
      data.settings.colors[key] = body[key];
    }
  });
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, colors: data.settings.colors });
}

async function handleUploadProfileImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  try {
    const raw = await readBody(req, 8 * 1024 * 1024); // 8MB raw cap (base64 inflates ~33%)
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'profile');

    const data = db.readDB();
    db.deleteUploadedImage(data.settings.profileImage);
    data.settings.profileImage = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleUploadCoverImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'cover');

    const data = db.readDB();
    db.deleteUploadedImage(data.settings.coverImage);
    data.settings.coverImage = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleUploadKhqrImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'khqr');

    const data = db.readDB();
    db.deleteUploadedImage(data.settings.khqrImage);
    data.settings.khqrImage = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleDeleteKhqrImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  db.deleteUploadedImage(data.settings.khqrImage);
  data.settings.khqrImage = null;
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleUpdateGameCurrencyEmoji(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const emoji = (body.emoji || '').trim();

  if (!emoji || emoji.length > 8) {
    return sendJSON(res, 400, { ok: false, error: 'សូមបញ្ចូល emoji ឬនិមិត្តសញ្ញាខ្លី (មិនលើសពី 8 តួ)' });
  }

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  game.currencyUnit = emoji;
  db.writeDB(data);
  sendJSON(res, 200, { ok: true, currencyUnit: game.currencyUnit });
}

async function handleUploadGameLogo(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'gamelogo-' + game.id);

    db.deleteUploadedImage(data.settings.gameLogos[game.id]);
    data.settings.gameLogos[game.id] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleUploadSocialIcon(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const VALID_PLATFORMS = ['telegram', 'facebook', 'youtube', 'tiktok'];
  if (!VALID_PLATFORMS.includes(params.platform)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid platform' });
  }

  const data = db.readDB();
  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'social-' + params.platform);

    if (!data.settings.socialIcons) data.settings.socialIcons = {};
    db.deleteUploadedImage(data.settings.socialIcons[params.platform]);
    data.settings.socialIcons[params.platform] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleSetSocialLinks(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);

  function cleanUrl(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('Link ត្រូវចាប់ផ្តើមដោយ http:// ឬ https://');
    }
    return trimmed;
  }

  const data = db.readDB();
  try {
    if (!data.settings.socialLinks) data.settings.socialLinks = {};
    data.settings.socialLinks.telegram = cleanUrl(body.telegram) || data.settings.socialLinks.telegram || 'https://t.me/wanfunzy';
    data.settings.socialLinks.facebook = cleanUrl(body.facebook);
    data.settings.socialLinks.youtube = cleanUrl(body.youtube);
    data.settings.socialLinks.tiktok = cleanUrl(body.tiktok);
  } catch (err) {
    return sendJSON(res, 400, { ok: false, error: err.message });
  }
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleSetTextEffects(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);

  const VALID_BRAND_EFFECTS = ['none', 'glow', 'glow-sweep', 'glow-rays', 'glow-zoom', 'fantasy-gold', 'fantasy-gold-zoom'];
  const VALID_SAFETY_EFFECTS = ['none', 'shimmer', 'glow-zoom', 'fantasy-gold', 'fantasy-gold-zoom'];
  const VALID_SPEEDS = ['slow', 'normal', 'fast'];

  const brandEffect = (body.brandNameEffect || 'glow').trim();
  const safetyEffect = (body.safetyBadgeEffect || 'shimmer').trim();
  const textSpeed = (body.brandTextAnimSpeed || 'normal').trim();
  const logoSpeed = (body.brandLogoAnimSpeed || 'normal').trim();

  if (!VALID_BRAND_EFFECTS.includes(brandEffect)) {
    return sendJSON(res, 400, { ok: false, error: 'Brand effect មិនត្រឹមត្រូវ' });
  }
  if (!VALID_SAFETY_EFFECTS.includes(safetyEffect)) {
    return sendJSON(res, 400, { ok: false, error: 'Safety badge effect មិនត្រឹមត្រូវ' });
  }
  if (!VALID_SPEEDS.includes(textSpeed) || !VALID_SPEEDS.includes(logoSpeed)) {
    return sendJSON(res, 400, { ok: false, error: 'Speed setting មិនត្រឹមត្រូវ' });
  }

  const data = db.readDB();
  data.settings.brandNameEffect = brandEffect;
  data.settings.safetyBadgeEffect = safetyEffect;
  data.settings.brandTextAnimEnabled = body.brandTextAnimEnabled !== false;
  data.settings.brandLogoAnimEnabled = body.brandLogoAnimEnabled !== false;
  data.settings.brandTextAnimSpeed = textSpeed;
  data.settings.brandLogoAnimSpeed = logoSpeed;
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleSetBrandGlowColors(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const color1 = (body.color1 || '').trim();
  const color2 = (body.color2 || '').trim();

  const hexPattern = /^#[0-9a-fA-F]{6}$/;
  if (color1 && !hexPattern.test(color1)) {
    return sendJSON(res, 400, { ok: false, error: 'Color 1 ត្រូវតែជា hex ត្រឹមត្រូវ' });
  }
  if (color2 && !hexPattern.test(color2)) {
    return sendJSON(res, 400, { ok: false, error: 'Color 2 ត្រូវតែជា hex ត្រឹមត្រូវ' });
  }

  const data = db.readDB();
  data.settings.brandGlowColor1 = color1 || null;
  data.settings.brandGlowColor2 = color2 || null;
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleSetPageBackgroundColor(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const color = (body.color || '').trim();

  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return sendJSON(res, 400, { ok: false, error: 'Color ត្រូវតែជា hex ត្រឹមត្រូវ ឧ. #1A0F2E' });
  }

  const data = db.readDB();
  data.settings.pageBackgroundColor = color || null;
  // Setting a color clears any previously uploaded background image, since
  // the image takes visual priority when both exist.
  if (color && data.settings.pageBackgroundImage) {
    db.deleteUploadedImage(data.settings.pageBackgroundImage);
    data.settings.pageBackgroundImage = null;
  }
  db.writeDB(data);
  sendJSON(res, 200, { ok: true, pageBackgroundColor: data.settings.pageBackgroundColor });
}

async function handleUploadPageBackgroundImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'pagebg');

    db.deleteUploadedImage(data.settings.pageBackgroundImage);
    data.settings.pageBackgroundImage = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleUploadCoverCarouselImage(req, res) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  if (!data.settings.coverImages) data.settings.coverImages = [];

  if (data.settings.coverImages.length >= 8) {
    return sendJSON(res, 400, { ok: false, error: 'អនុញ្ញាតតែ 8 រូបភាពអតិបរមាសម្រាប់ Cover Carousel' });
  }

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'cover-' + Date.now());

    data.settings.coverImages.push(filename);
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename, coverImages: data.settings.coverImages });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleRemoveCoverCarouselImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  if (!data.settings.coverImages) data.settings.coverImages = [];

  const index = parseInt(params.index, 10);
  if (isNaN(index) || index < 0 || index >= data.settings.coverImages.length) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid image index' });
  }

  const [removed] = data.settings.coverImages.splice(index, 1);
  db.deleteUploadedImage(removed);
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, coverImages: data.settings.coverImages });
}

async function handleUploadCardBackground(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'cardbg-' + game.id);

    if (!data.settings.cardBackgrounds) data.settings.cardBackgrounds = {};
    db.deleteUploadedImage(data.settings.cardBackgrounds[game.id]);
    data.settings.cardBackgrounds[game.id] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

// Per-game thumbnails for the TWO package bands on the order page:
//   'special' → image shown on Special Offers cards
//   'package' → image shown on regular diamond-package cards
// Stored separately from cardBackgrounds, which stays as the page banner
// and as the fallback when one of these two isn't uploaded yet.
const PKG_IMAGE_KEYS = { special: 'specialOfferImages', package: 'packageImages' };

// Per-package image: stored as settings.packageIconImages[packageId] = filename
async function handleUploadPackageIcon(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const pkg = data.packages.find(p => p.id === params.packageId);
  if (!pkg) return sendJSON(res, 404, { ok: false, error: 'Package not found' });

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'pkgicon-' + params.packageId);

    if (!data.settings.packageIconImages) data.settings.packageIconImages = {};
    db.deleteUploadedImage(data.settings.packageIconImages[params.packageId]);
    data.settings.packageIconImages[params.packageId] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleDeletePackageIcon(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  if (!data.settings.packageIconImages) data.settings.packageIconImages = {};
  db.deleteUploadedImage(data.settings.packageIconImages[params.packageId]);
  delete data.settings.packageIconImages[params.packageId];
  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

async function handleUploadPkgImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const settingKey = PKG_IMAGE_KEYS[params.kind];
  if (!settingKey) return sendJSON(res, 400, { ok: false, error: 'Invalid image type' });

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, params.kind + 'img-' + game.id);

    if (!data.settings[settingKey]) data.settings[settingKey] = {};
    db.deleteUploadedImage(data.settings[settingKey][game.id]);
    data.settings[settingKey][game.id] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleDeletePkgImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const settingKey = PKG_IMAGE_KEYS[params.kind];
  if (!settingKey) return sendJSON(res, 400, { ok: false, error: 'Invalid image type' });

  const data = db.readDB();
  if (!data.settings[settingKey]) data.settings[settingKey] = {};
  db.deleteUploadedImage(data.settings[settingKey][params.gameId]);
  delete data.settings[settingKey][params.gameId];
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

// ── 4-Section Image + Emoji configuration ──────────────────────────────
// Each package section on the order page (Special Passes & Packs, First
// Top-Up Bonuses, Standard Diamond Packs, Sorted by Price) can have its
// own independent image AND its own fallback emoji, per game. Stored as:
//   settings.sectionImages[gameId][sectionKey] = filename
//   settings.sectionEmoji[gameId][sectionKey]  = emoji string
const SECTION_KEYS = ['passes', 'firstTopup', 'bonusDiamond', 'pureDiamond'];

async function handleUploadSectionImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  if (!SECTION_KEYS.includes(params.section)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  }

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  try {
    const raw = await readBody(req, 8 * 1024 * 1024);
    const body = parseBody(req, raw);
    const filename = db.saveUploadedImage(body.image, 'section-' + params.section + '-' + game.id);

    if (!data.settings.sectionImages) data.settings.sectionImages = {};
    if (!data.settings.sectionImages[game.id]) data.settings.sectionImages[game.id] = {};
    db.deleteUploadedImage(data.settings.sectionImages[game.id][params.section]);
    data.settings.sectionImages[game.id][params.section] = filename;
    db.writeDB(data);

    sendJSON(res, 200, { ok: true, filename });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: err.message || 'Upload failed' });
  }
}

async function handleDeleteSectionImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  if (!SECTION_KEYS.includes(params.section)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  }

  const data = db.readDB();
  if (!data.settings.sectionImages) data.settings.sectionImages = {};
  if (!data.settings.sectionImages[params.gameId]) data.settings.sectionImages[params.gameId] = {};
  db.deleteUploadedImage(data.settings.sectionImages[params.gameId][params.section]);
  delete data.settings.sectionImages[params.gameId][params.section];
  db.writeDB(data);

  sendJSON(res, 200, { ok: true });
}

async function handleSetSectionEmoji(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  if (!SECTION_KEYS.includes(params.section)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid section' });
  }

  const raw = await readBody(req);
  const body = parseBody(req, raw);
  const emoji = (body.emoji || '').trim();
  if (!emoji || emoji.length > 8) {
    return sendJSON(res, 400, { ok: false, error: 'សូមបញ្ចូល emoji ខ្លី (មិនលើសពី 8 តួ)' });
  }

  const data = db.readDB();
  const game = data.games.find((g) => g.id === params.gameId);
  if (!game) return sendJSON(res, 404, { ok: false, error: 'Game not found' });

  if (!data.settings.sectionEmoji) data.settings.sectionEmoji = {};
  if (!data.settings.sectionEmoji[game.id]) data.settings.sectionEmoji[game.id] = {};
  data.settings.sectionEmoji[game.id][params.section] = emoji;
  db.writeDB(data);

  sendJSON(res, 200, { ok: true, emoji });
}

async function handleRemoveCustomImage(req, res, params) {
  const session = getSession(req);
  if (!session) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  if (!requireCsrf(req, res, session)) return;

  const data = db.readDB();
  const target = params.target; // 'profile' | 'cover' | 'gamelogo' | 'cardbackground'

  if (target === 'profile') {
    db.deleteUploadedImage(data.settings.profileImage);
    data.settings.profileImage = null;
  } else if (target === 'cover') {
    db.deleteUploadedImage(data.settings.coverImage);
    data.settings.coverImage = null;
  } else if (target === 'gamelogo' && params.gameId) {
    db.deleteUploadedImage(data.settings.gameLogos[params.gameId]);
    delete data.settings.gameLogos[params.gameId];
  } else if (target === 'cardbackground' && params.gameId) {
    if (!data.settings.cardBackgrounds) data.settings.cardBackgrounds = {};
    db.deleteUploadedImage(data.settings.cardBackgrounds[params.gameId]);
    delete data.settings.cardBackgrounds[params.gameId];
  } else if (target === 'pagebackground') {
    db.deleteUploadedImage(data.settings.pageBackgroundImage);
    data.settings.pageBackgroundImage = null;
  } else {
    return sendJSON(res, 400, { ok: false, error: 'Invalid target' });
  }

  db.writeDB(data);
  sendJSON(res, 200, { ok: true });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  // Security headers applied to every response. These are defensive
  // defaults — none of them change app behavior, they just close off a
  // few common attack vectors (clickjacking, MIME-type sniffing, leaking
  // the full URL via the Referer header to third-party links).
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Content-Security-Policy: an extra layer on top of escapeHtml() output
  // sanitization — even if a stray unescaped value slipped through
  // somewhere, the browser itself refuses to execute injected <script>
  // tags or load resources from untrusted origins.
  // 'unsafe-inline' is kept for style/script because the views currently
  // use inline <style>/<script> blocks — tightening this further would
  // require moving those into external files first.
  res.setHeader(
    'Content-Security-Policy',
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
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query = parsed.query;
    const method = req.method;

    // static assets
    if (pathname.startsWith('/static/')) {
      return serveStatic(req, res, pathname.replace('/static', ''));
    }

    // public routes
    // NOTE: "/" now serves the standalone top-up flow directly (game grid +
    // cover carousel) per owner's decision — the old homepage (headline,
    // stats, "How it works" sections) is no longer the default landing page.
    // handleHome/renderHome are kept in the codebase unused, in case the
    // owner wants to bring that design back later.
    if (pathname === '/' && method === 'GET') return handleTopupSelectPage(req, res);
    if (pathname === '/api/orders' && method === 'POST') return handleCreateOrder(req, res);
    if (pathname === '/order/confirmation' && method === 'GET') return handleOrderConfirmationPage(req, res, query);
    if (pathname === '/track' && method === 'GET') return handleTrackOrderPage(req, res, query);

    // standalone top-up flow — "/topup" now redirects to "/" since "/" IS the
    // top-up flow. Kept as a redirect (not removed) so any old bookmarks or
    // shared links to "/topup" still work instead of breaking.
    if (pathname === '/topup' && method === 'GET') return send(res, 302, '', { Location: '/' });
    if (pathname === '/topup/order' && method === 'GET') return handleTopupPackagePage(req, res, query);
    if (pathname === '/topup/checkout' && method === 'GET') return handleTopupCheckoutPage(req, res, query);
    if (pathname === '/mlbb' && method === 'GET') return handleMlbbCheckoutPage(req, res);
    if (pathname === '/api/mlbb-packages' && method === 'GET') return handleMlbbPackagesApi(req, res);
    if (pathname === '/terms' && method === 'GET') return handleTermsPage(req, res);
    if (pathname === '/api/topup/orders' && method === 'POST') return handleCreateTopupOrder(req, res);
    if (pathname === '/api/topup/orders/payment-status' && method === 'GET') return handleOrderPaymentStatus(req, res, query);
    if (pathname === '/api/topup/orders/deeplink' && method === 'GET') return handleOrderDeeplink(req, res, query);
    if (pathname === '/api/topup/orders/cancel' && method === 'POST') return handleOrderCancel(req, res);
    if (pathname === '/api/topup/validate' && method === 'GET') return handleValidatePlayer(req, res, query);
    if (pathname === '/api/moogold/callback' && method === 'POST') return handleMooGoldCallback(req, res);
    if (pathname === '/api/debug/ip' && method === 'GET') {
      // Admin-only: reveals outbound server IP — not for public
      if (!getSession(req)) return sendJSON(res, 401, { error: 'unauthorized' });
      return handleDebugIp(req, res);
    }

    // admin auth
    if (pathname === '/admin/login' && method === 'GET') return handleAdminLoginPage(req, res);
    if (pathname === '/admin/login' && method === 'POST') return handleAdminLoginSubmit(req, res);
    if (pathname === '/admin/logout' && method === 'POST') return handleAdminLogout(req, res);

    // admin dashboard
    if (pathname === '/admin' && method === 'GET') return handleAdminDashboard(req, res, query);
    if (pathname === '/admin/change-password' && method === 'POST') return handleChangePassword(req, res);

    // admin API — orders
    const orderStatusMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && method === 'POST') {
      return handleUpdateOrderStatus(req, res, { orderId: orderStatusMatch[1] });
    }
    const orderDeleteMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (orderDeleteMatch && method === 'DELETE') {
      return handleDeleteOrder(req, res, { orderId: orderDeleteMatch[1] });
    }
    const orderRestoreMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/restore$/);
    if (orderRestoreMatch && method === 'POST') {
      return handleRestoreOrder(req, res, { orderId: orderRestoreMatch[1] });
    }
    if (pathname === '/api/admin/orders/bulk-delete' && method === 'POST') {
      return handleBulkDeleteOrders(req, res);
    }
    if (pathname === '/api/admin/orders/bulk-hard-delete' && method === 'POST') {
      return handleBulkHardDeleteOrders(req, res);
    }
    const orderHardDeleteMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/hard-delete$/);
    if (orderHardDeleteMatch && method === 'DELETE') {
      return handleHardDeleteOrder(req, res, { orderId: orderHardDeleteMatch[1] });
    }

    // admin API — packages
    if (pathname === '/api/admin/packages' && method === 'POST') return handleCreatePackage(req, res);
    const pkgMatch = pathname.match(/^\/api\/admin\/packages\/([^/]+)$/);
    if (pkgMatch && method === 'PATCH') return handleUpdatePackage(req, res, { packageId: pkgMatch[1] });
    if (pkgMatch && method === 'DELETE') return handleDeletePackage(req, res, { packageId: pkgMatch[1] });

    // admin API — site customization
    if (pathname === '/api/admin/settings/colors' && method === 'POST') return handleUpdateColors(req, res);
    if (pathname === '/api/admin/settings/profile-image' && method === 'POST') return handleUploadProfileImage(req, res);
    if (pathname === '/api/admin/settings/cover-image' && method === 'POST') return handleUploadCoverImage(req, res);
    if (pathname === '/api/admin/settings/khqr-image' && method === 'POST') return handleUploadKhqrImage(req, res);
    if (pathname === '/api/admin/settings/khqr-image' && method === 'DELETE') return handleDeleteKhqrImage(req, res);
    if (pathname === '/api/admin/settings/cover-carousel' && method === 'POST') return handleUploadCoverCarouselImage(req, res);
    if (pathname === '/api/admin/settings/page-background-color' && method === 'POST') return handleSetPageBackgroundColor(req, res);
    if (pathname === '/api/admin/settings/brand-glow-colors' && method === 'POST') return handleSetBrandGlowColors(req, res);
    if (pathname === '/api/admin/settings/text-effects' && method === 'POST') return handleSetTextEffects(req, res);
    if (pathname === '/api/admin/settings/social-links' && method === 'POST') return handleSetSocialLinks(req, res);
    const socialIconMatch = pathname.match(/^\/api\/admin\/settings\/social-icon\/([^/]+)$/);
    if (socialIconMatch && method === 'POST') return handleUploadSocialIcon(req, res, { platform: socialIconMatch[1] });
    if (pathname === '/api/admin/settings/page-background-image' && method === 'POST') return handleUploadPageBackgroundImage(req, res);
    if (pathname === '/api/admin/settings/page-background-image' && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'pagebackground' });
    const coverCarouselMatch = pathname.match(/^\/api\/admin\/settings\/cover-carousel\/(\d+)$/);
    if (coverCarouselMatch && method === 'DELETE') return handleRemoveCoverCarouselImage(req, res, { index: coverCarouselMatch[1] });
    const gameLogoMatch = pathname.match(/^\/api\/admin\/settings\/game-logo\/([^/]+)$/);
    if (gameLogoMatch && method === 'POST') return handleUploadGameLogo(req, res, { gameId: gameLogoMatch[1] });
    const gameEmojiMatch = pathname.match(/^\/api\/admin\/games\/([^/]+)\/currency-emoji$/);
    if (gameEmojiMatch && method === 'POST') return handleUpdateGameCurrencyEmoji(req, res, { gameId: gameEmojiMatch[1] });
    const cardBgMatch = pathname.match(/^\/api\/admin\/settings\/card-background\/([^/]+)$/);
    if (cardBgMatch && method === 'POST') return handleUploadCardBackground(req, res, { gameId: cardBgMatch[1] });
    // Two separate per-game images for the order-page bands (special offers / packages)
    const pkgImageMatch = pathname.match(/^\/api\/admin\/settings\/pkg-image\/(special|package)\/([^/]+)$/);
    if (pkgImageMatch && method === 'POST') return handleUploadPkgImage(req, res, { kind: pkgImageMatch[1], gameId: pkgImageMatch[2] });
    if (pkgImageMatch && method === 'DELETE') return handleDeletePkgImage(req, res, { kind: pkgImageMatch[1], gameId: pkgImageMatch[2] });

    // Per-package icon: /api/admin/packages/{packageId}/icon
    const pkgIconMatch = pathname.match(/^\/api\/admin\/packages\/([^/]+)\/icon$/);
    if (pkgIconMatch && method === 'POST') return handleUploadPackageIcon(req, res, { packageId: pkgIconMatch[1] });
    if (pkgIconMatch && method === 'DELETE') return handleDeletePackageIcon(req, res, { packageId: pkgIconMatch[1] });

    // 4-section image + emoji config: /api/admin/settings/section-image/{section}/{gameId}
    const sectionImageMatch = pathname.match(/^\/api\/admin\/settings\/section-image\/(passes|firstTopup|bonusDiamond|pureDiamond)\/([^/]+)$/);
    if (sectionImageMatch && method === 'POST') return handleUploadSectionImage(req, res, { section: sectionImageMatch[1], gameId: sectionImageMatch[2] });
    if (sectionImageMatch && method === 'DELETE') return handleDeleteSectionImage(req, res, { section: sectionImageMatch[1], gameId: sectionImageMatch[2] });
    const sectionEmojiMatch = pathname.match(/^\/api\/admin\/settings\/section-emoji\/(passes|firstTopup|bonusDiamond|pureDiamond)\/([^/]+)$/);
    if (sectionEmojiMatch && method === 'POST') return handleSetSectionEmoji(req, res, { section: sectionEmojiMatch[1], gameId: sectionEmojiMatch[2] });
    if (pathname === '/api/admin/settings/profile-image' && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'profile' });
    if (pathname === '/api/admin/settings/cover-image' && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'cover' });
    if (gameLogoMatch && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'gamelogo', gameId: gameLogoMatch[1] });
    if (cardBgMatch && method === 'DELETE') return handleRemoveCustomImage(req, res, { target: 'cardbackground', gameId: cardBgMatch[1] });

    return send(res, 404, renderNotFound());
  } catch (err) {
    console.error('Unhandled error:', err);
    send(res, 500, '<h1>500 — Something broke.</h1><p>Check server logs.</p>');
  }
});

db.ensureDataFile();
db.ensureUploadsDir();
server.listen(PORT, () => {
  console.log(`Wanfunzy server running → http://localhost:${PORT}`);
  console.log(`Admin login → http://localhost:${PORT}/admin/login`);
  console.log(`Default credentials: admin / wanfunzy123  (change this immediately)`);
});
