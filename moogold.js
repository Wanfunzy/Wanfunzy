// moogold.js — low-level MooGold API client, shared by server.js
// (order fulfillment, polling) and the per-game modules in games/
// (validation). Game-specific policy (which product ID, whether a Worker
// is tried first, what happens when MooGold says "not authorized", etc.)
// lives in games/*.js — this file only knows how to talk to MooGold.

'use strict';

const https  = require('https');
const crypto = require('crypto');
const db     = require('./db');

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
    console.log('[MooGold] BLOCKED — missing Zone ID for', order.gameId, '| order:', order.code);
    return { ok: false, error: `Zone ID ត្រូវតែបញ្ចូលសម្រាប់ game នេះ (${order.gameName || order.gameId})` };
  }

  // [FIX] MooGold's API requires the key "Zone ID" (with a space) for the
  // server/zone value, NOT "Server". "User ID" (with space) is correct
  // as-is and works fine. Sending "Server" caused MooGold to silently
  // ignore the value entirely — account_details echoed back
  // "Server ID": "" even though our payload's Server field was populated
  // correctly — and the order was later refunded for incorrect details,
  // despite the User ID + Zone ID pair being 100% correct (verified
  // against the customer's own in-game profile screenshot: 592784466
  // (10050), Cambodia/Phnom Penh).
  const orderData = {
    category:     1,
    'product-id': Number(order.moogoldProductId),
    quantity:     1,
    'User ID':    String(order.playerId)
  };
  // [FIX] Confirmed by MooGold CS: the correct field name for MLBB is
  // "Server ID" (with a space) — NOT "Server", "Zone ID", or "Zone_ID".
  // CS also noted: different products may require different field names;
  // call product/product_detail to get the exact field list per product
  // if this ever needs to be made fully dynamic in the future.
  if (order.serverId) orderData['Server ID'] = String(order.serverId);

  const logPayload = { 'product-id': order.moogoldProductId, 'User ID': order.playerId };
  if (order.serverId) logPayload['Server ID'] = order.serverId;
  console.log('[MooGold] create_order payload:', JSON.stringify(logPayload));

  const payload        = { path: 'order/create_order', data: orderData, partnerOrderId: order.code };
  const signingPayload = payload; // sign exactly what we send

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
      return { ok: false, error: 'MooGold refunded — Player ID ឬ Zone ID មិនត្រឹមត្រូវ', refunded: true, moogoldOrderId: r.order_id || null };
    if (r && (r.err_code === '111' || r.err_code === 111)) return { ok: false, error: 'MooGold: Insufficient Balance — សូមបញ្ចូលទឹកប្រាក់ MooGold!' };
    if (r && (r.err_code === '422' || r.err_code === 422)) return { ok: false, error: 'MooGold: Product ID មិនត្រឹមត្រូវ ឬ មិនទាន់ authorized' };
    if (r && (r.err_code === '114' || r.err_code === 114)) return { ok: false, error: 'MooGold: Product Out of Stock!' };
    if (r && (r.err_code === '426' || r.err_code === 426)) return { ok: false, error: 'MooGold: Timestamp mismatch (retried once, still failing) — server clock ឬ network delay ខុសប្រក្រតី' };
    return { ok: false, error: `MooGold err ${r && r.err_code}: ${r && r.err_message} | raw: ${JSON.stringify(result).slice(0, 300)}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function validatePlayerWithMooGold(productId, playerId, serverId) {
  if (!moogoldEnabled() || !productId) return { ok: null };
  // [FIX] Confirmed field name: "Server ID" (per MooGold CS).
  const payload = {
    path: 'product/validate',
    data: { 'product-id': String(productId), 'User ID': String(playerId), ...(serverId ? { 'Server ID': String(serverId) } : {}) }
  };
  try {
    const result = await moogoldRequest('product/validate', payload, payload);
    console.log('[MooGold] validate raw:', JSON.stringify(result).slice(0, 400));
    if (result && (result.status === true || result.status === 'true')) {
      const uname = (result.username) || (result.data && result.data.username) || '';
      return { ok: true, username: uname, message: result.message || '' };
    }
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
    return { ok: false, message: msg || 'Player ID ឬ Zone ID មិនត្រឹមត្រូវ' };
  } catch (e) { console.error('[MooGold] validate error:', e.message); return { ok: null, error: e.message }; }
}

// Calls MooGold's "Product Details" API to get the real list of
// variation_id values (+ name, price, stock status) for a given MooGold
// product ID. This is the ONLY correct way to get a variation_id per the
// official API docs ("It is the variation_id of Product Details API.
// Call the Product Details API to get the variation_id of the product
// you want to purchase and put it here.") — copying it by hand from the
// reseller website (as was done before) risks grabbing a stale/wrong ID,
// which is the likely cause of the "422: Product ID incorrect or not
// authorized" fulfillment failures seen for Free Fire.
async function getProductVariations(productId) {
  if (!moogoldEnabled()) return { ok: false, error: 'MooGold not configured' };
  const payload = { path: 'product/product_detail', product_id: Number(productId) };
  try {
    const result = await moogoldRequest('product/product_detail', payload, payload);
    console.log('[MooGold] product_detail raw:', JSON.stringify(result).slice(0, 500));
    if (result && Array.isArray(result.Variation)) {
      return {
        ok: true,
        productName: result.Product_Name || '',
        variations: result.Variation.map(v => ({
          name: v.variation_name,
          variationId: v.variation_id,
          price: v.variation_price,
          stockStatus: v.stock_status
        }))
      };
    }
    return { ok: false, error: (result && (result.err_message || result.message)) || 'Unexpected response format' };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  moogoldEnabled,
  moogoldRequest,
  fulfillWithMooGold,
  validatePlayerWithMooGold,
  getProductVariations
};
