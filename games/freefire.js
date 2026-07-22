// games/freefire.js — Free Fire validation.
// MOOGOLD_PRODUCT_ID 7847 — reseller.moogold.com/product.php?product=7847&category=50
//
// Same trust model as games/mlbb.js: a Worker or MooGold result only
// counts as a genuine pass if it comes with a real username; anything
// else (false, no username, or "not authorized") blocks the purchase.
// MooGold's own Free Fire validate currently always returns status:true
// with username:null (confirmed via production logs) — that is NOT a
// real check, so it correctly falls through to the block below rather
// than passing. Once MooGold authorizes real validation for this
// product (or the FF Worker's endpoint is fixed), a genuine username
// will start flowing through automatically — no further code changes
// needed here.

'use strict';

const https = require('https');
const { moogoldEnabled, validatePlayerWithMooGold } = require('../moogold');

const PRODUCT_ID         = '7847';
const REQUIRES_SERVER_ID = false;

function lookupUsernameViaWorker(playerId) {
  const workerUrl = process.env.FF_WORKER_URL;
  if (!workerUrl) {
    console.log('[FF Worker] FF_WORKER_URL not configured — cannot verify Free Fire accounts');
    return Promise.resolve({ ok: null, error: 'FF_WORKER_URL not configured' });
  }
  return new Promise((resolve) => {
    const body         = JSON.stringify({ playerId: String(playerId) });
    const workerSecret = process.env.FF_WORKER_SECRET || '';
    let u;
    try { u = new URL(workerUrl); } catch (e) { return resolve({ ok: null, error: 'Bad FF_WORKER_URL' }); }
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
            else resolve({ ok: false, message: json.message || 'Player ID មិនត្រឹមត្រូវ' });
          } catch (e) { resolve({ ok: null, error: 'Parse error' }); }
        });
      }
    );
    req.on('error',   e  => resolve({ ok: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: null, error: 'FF Worker timeout' }); });
    req.write(body); req.end();
  });
}

async function validate(playerId, serverId) {
  const workerUrl = process.env.FF_WORKER_URL;
  if (workerUrl) {
    try {
      const result = await lookupUsernameViaWorker(playerId);
      console.log('[Validate][FF Worker] result:', result.ok, result.username || result.message);
      if (result.ok === true) return result;
      console.log('[Validate][FF Worker] no confirmed match:', result.message || result.error, '— falling back to MooGold');
    } catch (e) { console.log('[Validate][FF Worker] threw:', e.message, '— falling back to MooGold'); }
  } else {
    console.log('[Validate][FF Worker] FF_WORKER_URL not set — falling back to MooGold (unreliable for FF)');
  }

  console.log('[Validate] game: freefire | productId:', PRODUCT_ID, '| playerId:', playerId);
  if (moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(PRODUCT_ID, playerId, serverId);
    // [CONFIRMED via production logs] MooGold's Free Fire validate always
    // returns status:true with username:null, regardless of whether the
    // Player ID is real or made up — it is NOT a real check. So ok:true
    // with no username must NOT be treated as a pass here.
    if (mgResult.ok === true && mgResult.username) {
      console.log('[Validate][MooGold] SUCCESS — game: freefire | username:', mgResult.username);
      return { ok: true, username: mgResult.username };
    }
    if (mgResult.ok === false) {
      console.log('[Validate][MooGold] BLOCKED — game: freefire |', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[Validate][MooGold] not authorized or no real username for product:', PRODUCT_ID);
  }

  // [POLICY per owner — updated] Both validate AND create_order are
  // unauthorized on this MooGold account for Free Fire (confirmed via
  // err_code 422 on a real order, even with a verified-correct
  // variation_id). Accepting purchases that can't be fulfilled just
  // creates manual-refund work, so block again until MooGold enables
  // this product for order creation.
  console.log('[Validate] BLOCKED (MooGold not authorized for this product — validate or fulfill) — game: freefire | playerId:', playerId);
  return { ok: false, message: 'Free Fire បណ្តោះអាសន្នមិនអាចទិញបានទេ (កំពុងរង់ចាំ MooGold ដោះស្រាយ)។ សូមទាក់ទង admin ដើម្បីជួយ។' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
