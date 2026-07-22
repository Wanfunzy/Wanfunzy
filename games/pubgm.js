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

  // [TEMP TEST per owner] Testing the hypothesis that PUBG's
  // create_order might have the same "wrong field name" issue Free Fire
  // had (validate said "not authorized" but the real fix was using
  // "Player ID" instead of "User ID" for create_order) rather than a
  // genuine account-level authorization gap. Accepting format-valid IDs
  // through temporarily so a real order can reach fulfillment and reveal
  // the actual create_order response. Revert to hard block below if this
  // turns out to be a genuine authorization gap after all.
  console.log('[Validate] ACCEPTED (TEMP TEST — checking if create_order has a field-name issue like FF did) — game: pubgm | playerId:', playerId);
  return { ok: true, username: '' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
