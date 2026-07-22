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

  // [CONFIRMED via testing] Tried "User ID", "Player ID", and "Player
  // UID" field names for create_order — all still return err_code 422
  // "not yet been authorized". This rules out a field-name issue (unlike
  // Free Fire, where "Player ID" was the actual fix) — HOK genuinely has
  // an account-level authorization gap on MooGold's side. Blocking until
  // MooGold CS confirms this is enabled.
  console.log('[Validate] BLOCKED (confirmed account-level authorization gap, not a field-name issue) — game: hok | playerId:', playerId);
  return { ok: false, message: 'Honor of Kings បណ្តោះអាសន្នមិនអាចទិញបានទេ។ សូមទាក់ទង admin ដើម្បីជួយ។' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
