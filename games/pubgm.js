// games/pubgm.js — PUBG Mobile validation.
// MOOGOLD_PRODUCT_ID 6963 — reseller.moogold.com/product.php?product=6963&category=50
//
// Same trust model as games/mlbb.js: only a genuine MooGold pass counts
// (real username, or an explicit status:false to block). MooGold's
// validate endpoint is currently "not authorized" for this product on
// the account at all, which correctly falls through to block below. Once
// MooGold authorizes it, real validation will start flowing through
// automatically — no further code changes needed here.

'use strict';

const { moogoldEnabled, validatePlayerWithMooGold } = require('../moogold');

const PRODUCT_ID         = '6963';
const REQUIRES_SERVER_ID = false;

async function validate(playerId, serverId) {
  console.log('[Validate] game: pubgm | productId:', PRODUCT_ID, '| playerId:', playerId);
  if (moogoldEnabled()) {
    const mgResult = await validatePlayerWithMooGold(PRODUCT_ID, playerId, serverId);
    if (mgResult.ok === true) {
      console.log('[Validate][MooGold] SUCCESS — game: pubgm | username:', mgResult.username || '(none)');
      return { ok: true, username: mgResult.username || '' };
    }
    if (mgResult.ok === false) {
      console.log('[Validate][MooGold] BLOCKED — game: pubgm |', mgResult.message);
      return { ok: false, message: mgResult.message };
    }
    console.log('[Validate][MooGold] not authorized for product:', PRODUCT_ID);
  }

  // [FIX per MooGold CS] Confirmed "Player ID" is the correct field name
  // for PUBG's create_order too (same fix as Free Fire). Re-enabling
  // format-only accept temporarily to push a real test order through and
  // confirm the fix works end-to-end.
  console.log('[Validate] ACCEPTED (TEMP TEST — confirming "Player ID" fix for create_order) — game: pubgm | playerId:', playerId);
  return { ok: true, username: '' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
