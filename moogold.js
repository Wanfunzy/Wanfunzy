// moogold.js — MooGold API client for Wanfunzy
// Zero dependencies — uses Node.js built-in `https` + `crypto` only.
//
// ══════════════════════════════════════════════════════════════════════
// MooGold API Reference (from api-doc.yaml):
//   Base URL : https://moogold.com/wp-json/v1/api
//   Auth     : 3 headers on every request
//     Authorization : Basic base64(partnerId + ":" + secretKey)
//     auth          : HMAC-SHA256(JSON.stringify(payload) + timestamp + path, secretKey)
//     timestamp     : Unix timestamp (seconds)
//
// Endpoints used:
//   POST order/create_order        — place a diamond top-up
//   POST order/order_detail        — get order by MooGold order_id
//   POST order/order_detail_partner_id — get order by our partnerOrderId
//   POST product/validate          — validate player ID (may not be enabled)
//   POST user/balance              — check wallet balance
// ══════════════════════════════════════════════════════════════════════

'use strict';

const https  = require('https');
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────────────────────

const MOOGOLD_BASE = 'https://moogold.com/wp-json/v1/api';

function isEnabled() {
  return !!(process.env.MOOGOLD_PARTNER_ID && process.env.MOOGOLD_SECRET_KEY);
}

// ── Auth header builder ────────────────────────────────────────────────────
// MooGold requires 3 headers per request:
//   1. Authorization : Basic base64(partnerId:secretKey)
//   2. auth          : HMAC-SHA256(payloadJson + timestamp + path, secretKey)
//   3. timestamp     : current Unix seconds
//
// NOTE: `path` here is just the API sub-path e.g. "order/create_order",
// NOT the full URL — must match exactly what's inside the payload's `path`
// field, otherwise MooGold returns err_code 418 (path mismatch).
function buildAuthHeaders(payload, apiPath) {
  const partnerId = process.env.MOOGOLD_PARTNER_ID;
  const secretKey  = process.env.MOOGOLD_SECRET_KEY;
  const timestamp  = Math.floor(Date.now() / 1000).toString();

  const basicAuth  = Buffer.from(`${partnerId}:${secretKey}`).toString('base64');

  // Signature: HMAC-SHA256( payloadJson + timestamp + path )
  const payloadJson  = JSON.stringify(payload);
  const stringToSign = payloadJson + timestamp + apiPath;
  const authSig = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign)
    .digest('hex');

  return {
    'Authorization': `Basic ${basicAuth}`,
    'auth':          authSig,
    'timestamp':     timestamp,
    'Content-Type':  'application/json'
  };
}

// ── Low-level HTTP POST ────────────────────────────────────────────────────
// `apiPath`      : sub-path e.g. "order/create_order"
// `payload`      : full JSON body (must include `path` field per MooGold docs)
// `signingPayload`: optional — if provided, auth signature is computed on this
//                  instead of `payload`. Used when partnerOrderId must be
//                  excluded from the signature (per MooGold's signing rules).
function post(apiPath, payload, signingPayload) {
  return new Promise((resolve, reject) => {
    const forSigning = signingPayload || payload;
    const headers    = buildAuthHeaders(forSigning, apiPath);
    const body       = JSON.stringify(payload);
    headers['Content-Length'] = Buffer.byteLength(body);

    // Optional Cloudflare Worker proxy (bypasses Railway's blocked IPs)
    const workerUrl    = process.env.MOOGOLD_WORKER_URL;
    const workerSecret = process.env.MOOGOLD_WORKER_SECRET;

    let hostname, reqPath;
    if (workerUrl && workerSecret) {
      const u = new URL(`${workerUrl}/${apiPath}`);
      hostname = u.hostname;
      reqPath  = u.pathname;
      headers['x-worker-secret'] = workerSecret;
      console.log('[MooGold] via Worker:', u.href);
    } else {
      hostname = 'moogold.com';
      reqPath  = `/wp-json/v1/api/${apiPath}`;
    }

    const req = https.request(
      { hostname, path: reqPath, method: 'POST', headers, timeout: 30_000 },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 64 * 1024) req.destroy(new Error('MooGold response too large'));
        });
        res.on('end', () => {
          try   { resolve(JSON.parse(raw)); }
          catch { reject(new Error('MooGold returned non-JSON: ' + raw.slice(0, 200))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('MooGold request timed out')));
    req.on('error',   reject);
    req.write(body);
    req.end();
  });
}

// ── unwrapResponse ─────────────────────────────────────────────────────────
// MooGold occasionally wraps the response inside a `.data` key.
// Normalise to a single object so callers don't need to think about it.
function unwrap(result) {
  if (result && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return result.data;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════

// ── 1. createOrder ─────────────────────────────────────────────────────────
// Places a direct top-up order on MooGold.
//
// params:
//   moogoldProductId  {string|number} — variation_id from product_detail API
//   playerId          {string}        — the player's in-game User ID
//   serverId          {string}        — Zone/Server ID (required for MLBB etc.)
//   partnerOrderId    {string}        — our internal order code (e.g. "WF-ABC123")
//
// Returns:
//   { ok: true,  moogoldOrderId, status }
//   { ok: false, error, refunded?, moogoldOrderId? }
//
// MooGold create_order payload shape (from api-doc.yaml):
//   {
//     "path": "order/create_order",
//     "data": {
//       "category"  : 1,          // 1 = Direct Top Up
//       "product-id": 215570,     // integer (variation_id)
//       "quantity"  : 1,
//       "User ID"   : "12314123", // string — dynamic field name from product_detail
//       "Server"    : "3402"      // string — required for games with serverId
//     },
//     "partnerOrderId": "WF-ABC123"  // optional but recommended for dedup + polling
//   }
//
// Auth signature is computed on { path, data } ONLY — partnerOrderId is
// added AFTER signing so it doesn't corrupt the signature.
async function createOrder({ moogoldProductId, playerId, serverId, partnerOrderId }) {
  if (!isEnabled()) return { ok: false, error: 'MooGold not configured (missing env vars)' };
  if (!moogoldProductId)  return { ok: false, error: 'moogoldProductId is required' };
  if (!playerId)          return { ok: false, error: 'playerId is required' };

  const orderData = {
    'category':   1,
    'product-id': Number(moogoldProductId),
    'quantity':   1,
    'User ID':    String(playerId)
  };
  if (serverId) {
    orderData['Server'] = String(serverId);
  }

  // Signature payload excludes partnerOrderId
  const signingPayload = { path: 'order/create_order', data: orderData };
  const fullPayload    = { path: 'order/create_order', data: orderData, partnerOrderId };

  console.log('[MooGold] createOrder →', JSON.stringify({
    'product-id': moogoldProductId,
    'User ID':    playerId,
    'Server':     serverId || '(none)',
    partnerOrderId
  }));

  try {
    const raw    = await post('order/create_order', fullPayload, signingPayload);
    const result = unwrap(raw);
    console.log('[MooGold] createOrder FULL response:', JSON.stringify(result));

    // ── Success detection ──────────────────────────────────────────────
    // MooGold returns status:true/string or just an order_id on success.
    const isOk = result && (
      result.status === true        ||
      result.status === 'true'      ||
      result.status === 'processing'||
      result.status === 'completed' ||
      result.message === 'Order has been created successfully' ||
      !!(result.order_id)
    );

    if (isOk) {
      const moogoldOrderId =
        (result.account_details && result.account_details.order_id) ||
        result.order_id || null;
      console.log('[MooGold] createOrder OK — moogoldOrderId:', moogoldOrderId, '| status:', result.status);
      return { ok: true, moogoldOrderId, status: result.status || 'processing' };
    }

    // ── Known error codes ──────────────────────────────────────────────
    const code = result && (result.err_code || result.code);
    const msg  = result && (result.err_message || result.message || '');

    if (code === '420' || code === 420) {
      // Duplicate partnerOrderId — treat as success (idempotency guard)
      console.log('[MooGold] createOrder: duplicate partnerOrderId — ignoring');
      return { ok: true, status: 'duplicate-ignored', moogoldOrderId: null };
    }
    if (result && result.status === 'refunded') {
      return { ok: false, error: 'MooGold refunded — Player ID ឬ Server ID មិនត្រឹមត្រូវ', refunded: true, moogoldOrderId: result.order_id || null };
    }
    if (code === '111' || code === 111) return { ok: false, error: 'MooGold: Insufficient Balance — សូមបញ្ចូលទឹកប្រាក់ MooGold!' };
    if (code === '113' || code === 113) return { ok: false, error: 'MooGold: Product ID ខ្វះ (code 113)' };
    if (code === '114' || code === 114) return { ok: false, error: 'MooGold: Product Out of Stock!' };
    if (code === '116' || code === 116) return { ok: false, error: 'MooGold: Quantity លើស 10 (code 116)' };
    if (code === '117' || code === 117) return { ok: false, error: 'MooGold: Product មិនទាន់ available (code 117)' };
    if (code === '118' || code === 118) return { ok: false, error: 'MooGold: Product ស្ថិតក្នុង blocked list (code 118)' };
    if (code === '422' || code === 422) return { ok: false, error: 'MooGold: Product ID ខុស ឬ API មិនទាន់ authorized (code 422)' };
    if (code === '433' || code === 433) return { ok: false, error: 'MooGold: IP not allowed — ទាក់ទង MooGold ដើម្បី whitelist IP (code 433)' };

    // Unknown error
    return { ok: false, error: `MooGold err ${code}: ${msg} | raw: ${JSON.stringify(raw).slice(0, 300)}` };

  } catch (e) {
    console.error('[MooGold] createOrder exception:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── 2. getOrderDetail ──────────────────────────────────────────────────────
// Fetches order status by MooGold's own order_id.
//
// Returns the raw MooGold response on success, or null on error.
// Response shape (from api-doc.yaml order_detail_response_200):
//   { order_id, date_created, order_status, item: [...], total }
async function getOrderDetail(moogoldOrderId) {
  if (!isEnabled()) return null;
  const payload = { path: 'order/order_detail', order_id: Number(moogoldOrderId) };
  try {
    const result = await post('order/order_detail', payload);
    console.log('[MooGold] getOrderDetail for', moogoldOrderId, '| status:', result && result.order_status);
    return result;
  } catch (e) {
    console.error('[MooGold] getOrderDetail error:', e.message);
    return null;
  }
}

// ── 3. getOrderDetailByPartnerOrderId ──────────────────────────────────────
// Fetches order status by our own partnerOrderId (e.g. "WF-ABC123").
// Used for polling — more reliable than storing MooGold's order_id.
//
// Returns the raw MooGold response, or null on error.
async function getOrderDetailByPartnerOrderId(partnerOrderId) {
  if (!isEnabled()) return null;
  const payload = { path: 'order/order_detail_partner_id', partner_order_id: String(partnerOrderId) };
  try {
    const result = await post('order/order_detail_partner_id', payload);
    console.log('[MooGold] getOrderDetailByPartnerOrderId for', partnerOrderId, '| status:', result && result.order_status);
    return result;
  } catch (e) {
    console.error('[MooGold] getOrderDetailByPartnerOrderId error:', e.message);
    return null;
  }
}

// ── 4. validatePlayer ─────────────────────────────────────────────────────
// Calls product/validate to confirm the player exists before placing an order.
// NOTE: This endpoint may not be authorized for your MooGold account.
//       When not authorized the function returns { ok: null, skipped: true }.
//
// params:
//   moogoldProductId {string|number}
//   playerId         {string}
//   serverId         {string} — optional
//
// Returns:
//   { ok: true,  username }           — player found
//   { ok: false, message }            — player not found / wrong ID
//   { ok: null,  skipped, message }   — endpoint not enabled for this account
async function validatePlayer(moogoldProductId, playerId, serverId) {
  if (!isEnabled() || !moogoldProductId) return { ok: null, skipped: true, message: 'MooGold not configured or no productId' };

  // Payload per api-doc.yaml product/validate schema:
  // { "path": "product/validate", "data": { "product-id", "User ID", "Server"? } }
  const data = {
    'product-id': String(moogoldProductId),
    'User ID':    String(playerId)
  };
  if (serverId) data['Server'] = String(serverId);

  const payload = { path: 'product/validate', data };

  console.log('[MooGold] validatePlayer →', JSON.stringify({
    'product-id': moogoldProductId,
    'User ID':    playerId,
    'Server':     serverId || '(none)'
  }));

  try {
    const result = await post('product/validate', payload, payload);
    console.log('[MooGold] validatePlayer response:', JSON.stringify(result).slice(0, 200));

    if (result && (result.status === true || result.status === 'true')) {
      return { ok: true, username: result.username || '', message: result.message || '' };
    }

    // Detect "endpoint not authorized" patterns
    const code    = (result && (result.code || result.err_code)) || '';
    const msg     = (result && (result.message || result.err_message)) || '';
    const status4 = (result && result.data && result.data.status) || 0;
    const notAuthorized =
      code === 'rest_no_route'                       ||
      status4 === 404                                ||
      msg.toLowerCase().includes('validation is not available') ||
      msg.toLowerCase().includes('kindly contact')  ||
      msg.toLowerCase().includes('no route was found');

    if (notAuthorized) {
      console.log('[MooGold] validatePlayer: endpoint not authorized — hybrid mode');
      return { ok: null, skipped: true, message: msg };
    }

    return { ok: false, message: msg || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ' };

  } catch (e) {
    console.error('[MooGold] validatePlayer error:', e.message);
    return { ok: null, error: e.message };
  }
}

// ── 5. getBalance ─────────────────────────────────────────────────────────
// Returns the current MooGold wallet balance.
// Response: { currency: 'USD', balance: '832.21' }  or null on error.
async function getBalance() {
  if (!isEnabled()) return null;
  const payload = { path: 'user/balance' };
  try {
    const result = await post('user/balance', payload);
    console.log('[MooGold] balance:', result && result.balance, result && result.currency);
    return result;
  } catch (e) {
    console.error('[MooGold] getBalance error:', e.message);
    return null;
  }
}

// ── 6. pollOrderUntilDone ─────────────────────────────────────────────────
// Polls order status every `intervalMs` until completed/refunded/timeout.
// Calls `onUpdate(status, result)` on each meaningful status change.
//
// params:
//   partnerOrderId {string}   — our order code
//   moogoldOrderId {string}   — MooGold's order_id (used for logging only)
//   options:
//     maxAttempts {number}    — default 30 (~60 min at 2 min intervals)
//     intervalMs  {number}    — default 120_000 (2 minutes)
//     onUpdate    {function}  — called with (status, rawResult)
async function pollOrderUntilDone(partnerOrderId, moogoldOrderId, options = {}) {
  const {
    maxAttempts = 30,
    intervalMs  = 2 * 60 * 1000,
    onUpdate    = () => {}
  } = options;

  const delay = ms => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < maxAttempts; i++) {
    await delay(intervalMs);

    const result = await getOrderDetailByPartnerOrderId(partnerOrderId);
    const status = result && result.order_status;

    console.log(`[MooGold] poll #${i + 1}/${maxAttempts} — ${partnerOrderId} | status: ${status}`);

    if (status === 'completed' || status === 'refunded' || status === 'incorrect-details') {
      await onUpdate(status, result);
      return { finalStatus: status, result };
    }

    if (status === 'processing' || status === 'sending') {
      // Keep polling — not done yet
      continue;
    }

    // Unexpected status — still keep polling (don't abort early on unknowns)
    console.log('[MooGold] poll: unexpected status "' + status + '" — continuing');
  }

  // Timed out after maxAttempts
  console.log(`[MooGold] poll TIMEOUT for ${partnerOrderId} after ${maxAttempts} attempts`);
  await onUpdate('timeout', null);
  return { finalStatus: 'timeout', result: null };
}

// ── 7. fulfillOrder ───────────────────────────────────────────────────────
// High-level helper: validates requirements, then calls createOrder.
// This is the function called by server.js when payment is confirmed.
//
// `order` fields required:
//   moogoldProductId, playerId, serverId (if required), gameId, gameName, code
//
// Returns the same shape as createOrder().
async function fulfillOrder(order) {
  if (!isEnabled()) return { ok: false, error: 'MooGold not configured' };
  if (!order.moogoldProductId) return { ok: false, error: 'No moogoldProductId on order' };

  // Block if Server/Zone ID is missing for games that require it.
  // MLBB always requires it. Other games: check `requiresServerId` flag from DB.
  const isMlbb = (order.gameId || '').toLowerCase() === 'mlbb' ||
                 (order.gameName || '').toLowerCase().includes('mobile legend');

  let gameRequiresServer = isMlbb;
  // Caller can pass `requiresServerId: true` directly on the order object
  // to avoid needing a DB read inside this module.
  if (order.requiresServerId) gameRequiresServer = true;

  if (gameRequiresServer && !order.serverId) {
    console.log('[MooGold] fulfillOrder BLOCKED — missing serverId for', order.gameId, '| order:', order.code);
    return { ok: false, error: `Server/Zone ID ត្រូវតែបញ្ចូលសម្រាប់ game នេះ (${order.gameName || order.gameId})` };
  }

  console.log('[MooGold] fulfillOrder →', JSON.stringify({
    code:             order.code,
    gameId:           order.gameId,
    moogoldProductId: order.moogoldProductId,
    playerId:         order.playerId,
    serverId:         order.serverId || '(none)'
  }));

  return createOrder({
    moogoldProductId: order.moogoldProductId,
    playerId:         order.playerId,
    serverId:         order.serverId,
    partnerOrderId:   order.code
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════════════
module.exports = {
  isEnabled,
  createOrder,
  getOrderDetail,
  getOrderDetailByPartnerOrderId,
  validatePlayer,
  getBalance,
  pollOrderUntilDone,
  fulfillOrder
};
