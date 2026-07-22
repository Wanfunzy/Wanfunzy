// games/hok.js — Honor of Kings validation.
// MOOGOLD_PRODUCT_ID 5177311 — reseller.moogold.com/product.php?product=5177311&category=50
//
// MooGold's validate endpoint is not authorized for this product on the
// account at all ("Validation is not available for this product. Kindly
// contact our CS to add them in."). Manually confirmed on moogold.com
// that no nickname/validation popup appears for HOK at all (unlike Free
// Fire, which does show one) — validation genuinely isn't wired up for
// this product yet, on MooGold's side, not just the API.
// [POLICY per owner] Any correctly-formatted Player ID is accepted with
// no username shown, same as freefire/pubgm.

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

  // [POLICY per owner — updated] MooGold not authorized for this
  // product on validate or (likely) create_order either. Block until
  // MooGold enables it, same reasoning as Free Fire/PUBG.
  console.log('[Validate] BLOCKED (MooGold not authorized for this product) — game: hok | playerId:', playerId);
  return { ok: false, message: 'Honor of Kings បណ្តោះអាសន្នមិនអាចទិញបានទេ (កំពុងរង់ចាំ MooGold ដោះស្រាយ)។ សូមទាក់ទង admin ដើម្បីជួយ។' };
}

module.exports = { productId: PRODUCT_ID, requiresServerId: REQUIRES_SERVER_ID, validate };
