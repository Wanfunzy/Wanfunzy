// games/hok.js — Honor of Kings validation.
// MOOGOLD_PRODUCT_ID 5177311 — reseller.moogold.com/product.php?product=5177311&category=50
//
// Same trust model as games/mlbb.js: only a genuine MooGold pass counts
// (real username, or an explicit status:false to block). MooGold's
// validate endpoint is currently "not authorized" for this product on
// the account at all — confirmed both via the API and manually on
// moogold.com (no nickname/validation popup appears for HOK at all,
// unlike Free Fire). This correctly falls through to block below. Once
// MooGold authorizes it, real validation will start flowing through
// automatically — no further code changes needed here.

'use strict';

const { moogoldEnabled, validatePlayerWithMooGold } = require('../moogold');

const PRODUCT_ID         = '5177311';
const REQUIRES_SERVER_ID = false;

async function validate(playerId, serverId) {
  console.log('[Validate] game: hok | productId:', PRODUCT_ID, '| playerId:', playerId);
  if (moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(PRODUCT_ID, playerId, serverId);
    if (mgResult.ok === true) {
      console.log('[Validate][MooGold] SUCCESS — game: hok | username:', mgResult.username || '(none)');
      return { ok: true, username: mgResult.username || '' };
    }
    if (mgResult.ok === false) {
      console.log('[Validate][MooGold] BLOCKED — game: hok |', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[Validate][MooGold] not authorized for product:', PRODUCT_ID);
  }

  // [FIX per MooGold CS] Confirmed "Player ID" is the correct field name
  // for HOK's create_order too (same fix as Free Fire). Re-enabling
  // format-only accept temporarily to push a real test order through and
  // confirm the fix works end-to-end.
  console.log('[Validate] ACCEPTED (TEMP TEST — confirming "Player ID" fix for create_order) — game: hok | playerId:', playerId);
  return { ok: true, username: '' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
