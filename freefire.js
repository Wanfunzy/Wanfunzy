// games/freefire.js — Free Fire validation.
// MOOGOLD_PRODUCT_ID 7847 — reseller.moogold.com/product.php?product=7847&category=50
//
// MooGold's own Free Fire validate does NOT actually check if the account
// exists (always status:true, username:null). A Cloudflare Worker
// (ff-worker.js) is the only path that can return a genuine username, but
// its current endpoint is broken (confirmed dead — see conversation
// history), so its "not found" results aren't trustworthy right now.
// [POLICY per owner] Rather than blocking Free Fire entirely while this
// gets sorted out, any correctly-formatted Player ID is accepted with no
// username shown — same trust level FF/PUBG/HOK had before real
// verification was attempted.

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

  console.log('[Validate] game: freefire | productId:', PRODUCT_ID, '| playerId:', playerId, '| serverId:', serverId || '(none)');
  if (moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(PRODUCT_ID, playerId, serverId);
    if (mgResult.ok === true) {
      console.log('[Validate][MooGold] SUCCESS — game: freefire | username:', mgResult.username || '(none)');
      return { ok: true, username: mgResult.username || '' };
    }
    if (mgResult.ok === false) {
      console.log('[Validate][MooGold] BLOCKED — game: freefire |', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[Validate][MooGold] not authorized for product:', PRODUCT_ID);
  }

  console.log('[Validate] ACCEPTED (format-only, no verification available) — game: freefire | playerId:', playerId);
  return { ok: true, username: '' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
