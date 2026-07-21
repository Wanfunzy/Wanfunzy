// games/mlbb.js — Mobile Legends: Bang Bang validation.
// MOOGOLD_PRODUCT_ID 15145 — reseller.moogold.com/product.php?product=15145&category=50
//
// MLBB is the one game where MooGold's own validate genuinely checks the
// account (via Moonton) and returns a real username, so it's trusted
// directly as a fallback if the Worker is unavailable. This game also
// requires a Server ID (Zone ID) — freefire/pubgm/hok do not.

'use strict';

const https = require('https');
const { moogoldEnabled, validatePlayerWithMooGold } = require('../moogold');

const PRODUCT_ID          = '15145';
const REQUIRES_SERVER_ID  = true;

function callWorker(playerId, serverId) {
  const workerUrl = process.env.MLBB_WORKER_URL;
  return new Promise((resolve) => {
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
            else if (json.ok === false)            resolve({ ok: false, message: json.message || 'Player ID ឬ Zone ID មិនត្រឹមត្រូវ' });
            else                                   resolve({ ok: null, error: 'Worker response unclear' });
          } catch (e) { resolve({ ok: null, error: 'Parse error' }); }
        });
      }
    );
    req.on('error',   e  => resolve({ ok: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: null, error: 'Worker timeout' }); });
    req.write(body); req.end();
  });
}

async function validate(playerId, serverId) {
  const workerUrl = process.env.MLBB_WORKER_URL;
  if (workerUrl) {
    try {
      const result = await callWorker(playerId, serverId);
      console.log('[Validate][MLBB Worker] result:', result.ok, result.username || result.message);
      if (result.ok === true || result.ok === false) return result;
      console.log('[Validate][MLBB Worker] unavailable:', result.error, '— falling back to MooGold');
    } catch (e) { console.log('[Validate][MLBB Worker] threw:', e.message, '— falling back to MooGold'); }
  }

  console.log('[Validate] game: mlbb | productId:', PRODUCT_ID, '| playerId:', playerId, '| serverId:', serverId || '(none)');
  if (moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(PRODUCT_ID, playerId, serverId);
    if (mgResult.ok === true) {
      console.log('[Validate][MooGold] SUCCESS — game: mlbb | username:', mgResult.username || '(none)');
      return { ok: true, username: mgResult.username || '' };
    }
    if (mgResult.ok === false) {
      console.log('[Validate][MooGold] BLOCKED — game: mlbb |', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[Validate][MooGold] not authorized for product:', PRODUCT_ID);
  }

  // Safety default: MLBB does NOT get the format-only accept policy that
  // freefire/pubgm/hok have — its real verification already works, so an
  // unavailable path here means something is actually wrong and should
  // block rather than silently accept.
  console.log('[Validate] BLOCKED (all paths unavailable) — game: mlbb | playerId:', playerId);
  return { ok: false, message: 'មិនអាចផ្ទៀងផ្ទាត់ Player ID បានទេនៅពេលនេះ។ សូមព្យាយាមម្តងទៀត ឬទាក់ទង admin។' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
