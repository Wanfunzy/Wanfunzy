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

  // [POLICY per owner — updated] MooGold not authorized for this
  // product on validate or (likely) create_order either. Block until
  // MooGold enables it, same reasoning as Free Fire.
  console.log('[Validate] BLOCKED (MooGold not authorized for this product) — game: pubgm | playerId:', playerId);
  return { ok: false, message: 'PUBG Mobile បណ្តោះអាសន្នមិនអាចទិញបានទេ (កំពុងរង់ចាំ MooGold ដោះស្រាយ)។ សូមទាក់ទង admin ដើម្បីជួយ។' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
