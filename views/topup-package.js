// views/topup-package.js — Single-page Top-up order flow (mlbbkh-style).
// Everything happens on ONE page now instead of the old Page 2 → Page 3 hop:
//   [banner]  game art / logo + name
//   ជំហាន 01  User ID + Server ID (side-by-side) + "ពិនិត្យគណនី"
//   ជំហាន 02  packages as small 2-column cards, grouped (promos vs normal),
//             locked until step 01 validates
//   ជំហាន 03  contact + note (payment method = manual/KHQR-coming-soon),
//             locked until a package is selected
//   [sticky]  bottom bar with running total + "ទិញឥឡូវនេះ" submit
// Order still posts to the same hardened /api/topup/orders endpoint
// (rate-limited + honeypot), so no server-side order logic changes.

const { layout, ICONS, brandEffectCSS, renderSiteHeader, renderSiteFooter } = require('./layout');
const _i18n = require('./i18n');
const t = (typeof _i18n.t === 'function') ? _i18n.t : function (l, key) { return key; };

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderPkgCard(pkg, game, cardBgFilename) {
  if (!(Number(pkg.price) > 0)) return '';

  const unit = game.currencyUnit || '💎';
  const amt  = Number(pkg.amount) || 0;
  const bon  = Number(pkg.bonus)  || 0;

  const isPassOrPack = !!pkg.special || /pass|pack|value|twilight|weekly|super/i.test(pkg.name || '');
  const isFirstTopup = /first|1st/i.test(pkg.name || '');
  const isPureOrBonus = !isPassOrPack && !isFirstTopup;

  // ── Icon ──────────────────────────────────────────────────────────────
  // ALL sections: show uploaded image if admin uploaded one
  // Passes & First Top-Up: empty placeholder if no image (keeps layout)
  // Standard Diamond / Sorted by Price: NO icon if no image (more space for numbers)
  let iconHtml = '';
  if (cardBgFilename) {
    // Image uploaded → show it for all sections
    iconHtml = `<div class="sp-pkg-icon sp-pkg-icon-photo" style="background-image:url('/static/uploads/${escapeHtml(cardBgFilename)}');"></div>`;
  } else if (!isPureOrBonus) {
    // Passes / First Top-Up without image → empty placeholder to keep alignment
    iconHtml = `<div class="sp-pkg-icon sp-pkg-icon-empty"></div>`;
  }
  // Standard / Sorted without image → iconHtml stays '' (no emoji, no box)

  // ── Labels ────────────────────────────────────────────────────────────
  let line1, line2;
  if (isPassOrPack) {
    line1 = pkg.name.replace(/\s*\(.*?\)\s*/g, '').trim();
    line2 = '';
  } else if (isFirstTopup) {
    line1 = 'First Top-Up';
    if (amt > 0 && bon > 0)     line2 = `${amt}+${bon}`;
    else if (amt > 0)            line2 = `${amt}`;
    else { const n = (pkg.name||'').match(/\d+/g); line2 = n ? n.slice(0,2).join('+') : ''; }
  } else {
    // Standard / Sorted — numbers only, no icon, no emoji
    if (amt > 0 && bon > 0)     line1 = `${amt}+${bon}`;
    else if (amt > 0)            line1 = `${amt}`;
    else                         line1 = pkg.name;
    line2 = '';
  }

  return `
<button type="button" class="sp-pkg-card${isPureOrBonus ? ' sp-pkg-card-plain' : ''}" data-package-id="${pkg.id}" data-price="${pkg.price}" data-name="${escapeHtml(pkg.name)}">
${iconHtml}
<div class="sp-pkg-info">
<div class="sp-pkg-name">${escapeHtml(line1)}</div>
${line2 ? `<div class="sp-pkg-sub">${escapeHtml(line2)}</div>` : ''}
</div>
<div class="sp-pkg-price">$${pkg.price.toFixed(2)}</div>
</button>`;
}

function renderTopupPackage({ game, packages, settings, lang = 'en', turnstileSiteKey = '', khqrAuto = false }) {
  // Turnstile widget rendering temporarily disabled — the client-side
  // widget was blocking the checkout flow. Server-side Turnstile
  // verification still runs when TURNSTILE_SECRET env is set; it just
  // tolerates a missing client token. To re-enable the client widget
  // once the underlying issue is fixed, remove the next line.
  turnstileSiteKey = '';
  const colors = (settings && settings.colors) || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const gameLogos = (settings && settings.gameLogos) || {};
  const cardBackgrounds = (settings && settings.cardBackgrounds) || {};
  const specialOfferImages = (settings && settings.specialOfferImages) || {};
  const packageImages = (settings && settings.packageImages) || {};
  const profileImage = settings && settings.profileImage
    ? `/static/uploads/${encodeURIComponent(settings.profileImage)}`
    : '/static/images/mascot.jpg';
  const khqrImage = (settings && settings.khqrImage) || null;
  const khqrMerchantName = (settings && settings.khqrMerchantName) || 'Wanfunzy';

  const customColorStyle = `
<style>
:root {
--text: ${escapeHtml(colors.heading)};
--text-dim: ${escapeHtml(colors.body)};
--amber: ${escapeHtml(colors.accent)};
}
</style>` + brandEffectCSS(settings);

  const customLogo = gameLogos[game.id];
  const cardBg = cardBackgrounds[game.id];
  const bannerHtml = cardBg
    ? `<div class="sp-game-banner" style="background-image: linear-gradient(180deg, rgba(11,14,20,0.15), rgba(11,14,20,0.9)), url('/static/uploads/${escapeHtml(cardBg)}');"></div>`
    : '';
  const logoHtml = customLogo
    ? `<img src="/static/uploads/${escapeHtml(customLogo)}" alt="${escapeHtml(game.shortName)}" class="topup-header-logo" />`
    : `<div class="topup-header-logo topup-header-logo-empty">${ICONS.empty}</div>`;

  // ── Package grouping — 4 sections, each independently themed ──────────
  // Priority (first match wins, no duplicates across sections):
  //   1. Special Passes & Packs  — name has pass/pack/value/twilight/weekly/super/limited
  //   2. First Top-Up Bonuses    — name has first/1st
  //   3. Standard Diamond Packs  — has a bonus (e.g. "10 + 1 Diamonds")
  //   4. Sorted by Price         — no bonus, pure diamond amount, sorted cheapest→priciest
  const isPassOrPack    = (p) => /pass|pack|value|twilight|weekly|super|limited/i.test(p.name);
  const isFirstTopup    = (p) => /first|1st/i.test(p.name) && !isPassOrPack(p);
  const hasDiamondBonus = (p) => !isPassOrPack(p) && !isFirstTopup(p) && p.bonus > 0;
  const isPureDiamond   = (p) => !isPassOrPack(p) && !isFirstTopup(p) && !(p.bonus > 0);

  // Explicit .category tag (set in the admin "+ Add" flow) always wins,
  // same rule as the admin dashboard — keeps storefront and admin in sync
  // and prevents a package from silently changing section due to a bonus
  // or name edit.
  const byCategory = (key) => (p) => p.category
    ? p.category === key
    : (key === 'passes' ? isPassOrPack(p)
      : key === 'firsttopup' ? isFirstTopup(p)
      : key === 'bonusDiamond' ? hasDiamondBonus(p)
      : isPureDiamond(p));

  const passesPkgs       = packages.filter(byCategory('passes'));
  const firstTopupPkgs   = packages.filter(byCategory('firsttopup'));
  const bonusDiamondPkgs = packages.filter(byCategory('bonusDiamond')).sort((a, b) => (a.price || 0) - (b.price || 0));
  const pureDiamondPkgs  = packages.filter(byCategory('pureDiamond')).sort((a, b) => (a.price || 0) - (b.price || 0));

  // Each of the 4 sections gets its own admin-configurable image AND its
  // own emoji fallback (when no image is uploaded) — fully independent of
  // each other, per Saem's request. Falls back to the shared card
  // background / game currency emoji so nothing breaks before admin sets
  // these per-section values.
  const sectionImages = (settings && settings.sectionImages && settings.sectionImages[game.id]) || {};
  const packageIconImages = (settings && settings.packageIconImages) || {};
  const sectionEmoji  = (settings && settings.sectionEmoji  && settings.sectionEmoji[game.id])  || {};

  // Section images: only section-specific uploads are used for card icons.
  // Legacy specialOfferImages / packageImages are intentionally NOT used
  // as fallback here — those old slots often contain unrelated images
  // (e.g. TikTok logos) that were uploaded to the wrong slot and would
  // wrongly override every section until Saem deletes them.
  const passesImg  = sectionImages.passes       || null;
  const firstImg    = sectionImages.firstTopup   || null;
  const bonusImg    = sectionImages.bonusDiamond || null;
  const priceImg    = sectionImages.pureDiamond  || null;

  const passesBand = passesPkgs.length ? `
<div class="sp-band"><span>Special Passes &amp; Packs</span></div>
<div class="sp-pkg-grid">
${passesPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || passesImg)).join('\n')}
</div>` : '';

  const firstTopupBand = firstTopupPkgs.length ? `
<div class="sp-band"><span>First Top-Up Bonuses</span></div>
<div class="sp-pkg-grid">
${firstTopupPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || firstImg)).join('\n')}
</div>` : '';

  const bonusDiamondBand = bonusDiamondPkgs.length ? `
<div class="sp-band"><span>Standard Diamond Packs</span></div>
<div class="sp-pkg-grid">
${bonusDiamondPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || bonusImg)).join('\n')}
</div>` : '';

  const pureDiamondBand = pureDiamondPkgs.length ? `
<div class="sp-band"><span>Sorted by Price</span></div>
<div class="sp-pkg-grid">
${pureDiamondPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || priceImg)).join('\n')}
</div>` : '';

  const header = renderSiteHeader({ profileImage, lang, t, settings, showChangeGame: true });

  const body = `
${customColorStyle}
${header}
${bannerHtml}
<main class="sp-main">
<div class="wrap">
<div class="topup-game-header" style="border-bottom:none;padding-bottom:16px;">
${logoHtml}
<div>
<div class="section-eyebrow">${t(lang, 'topping_up_for')}</div>
<h2 style="font-size:22px;margin:0;">${escapeHtml(game.name)}</h2>
</div>
</div>

<!-- Step 1 — Account info (step number badge + title removed per owner request) -->
<div class="sp-panel" id="panelStep1">
<div class="form-row" id="formRow">
<div class="field">
<label for="playerId">Player ID</label>
<input type="text" id="playerId" name="playerId" placeholder="${t(lang, 'ph_player_id')}" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-playerId"></div>
</div>
<div class="field" id="serverIdField" style="display:${(game.requiresServerId || game.id === 'mlbb' || (game.name||''). toLowerCase().includes('mobile legend')) ? '' : 'none'};">
<label for="serverId">Server ID</label>
<input type="text" id="serverId" name="serverId" placeholder="${t(lang, 'ph_server_id')}" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-serverId"></div>
</div>
</div>
<div class="field-error show" id="err-validate" style="margin-bottom:8px;"></div>
<button type="button" class="btn btn-primary btn-full" id="validateBtn">${t(lang, 'btn_validate')}</button>
</div>

<!-- Step 2 — Packages (step number badge + title + hint text removed per owner request) -->
<div class="sp-panel sp-locked" id="panelStep2">
<p class="sp-lock-hint" id="pkgHint" style="display:none;"></p>
${passesBand}
${firstTopupBand}
${bonusDiamondBand}
${pureDiamondBand}
</div>

<!-- Step 3 removed: order goes straight from package selection to the
     KHQR pay modal. Hidden fields kept so the existing submit payload
     shape (contact/note/honeypot) doesn't need server changes.
     Player is identified by User ID + Server ID; payment is proven by
     the auto-verified KHQR transaction. -->
<!-- Honeypot: off-screen, NOT display:none. Naive bots that ignore CSS
     fill everything visible in the DOM tree; smart bots check for
     display:none and skip. Positioning it off-screen keeps it out of
     the human's view while still tempting bots that scrape by DOM.
     Field name is intentionally generic ("b_field") not "website" —
     browsers' autofill heuristics recognise "website"/"url" and would
     silently fill it for real humans, tripping our own trap. Empty
     placeholder + new-password autocomplete additionally suppress
     password managers. -->
<div class="hp-field" aria-hidden="true" style="position:absolute !important;left:-9999px !important;top:-9999px !important;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;">
<label for="b_field" aria-hidden="true" tabindex="-1">Leave this empty</label>
<input type="text" id="b_field" name="b_field" tabindex="-1" autocomplete="new-password" data-hp="1" />
</div>
<input type="hidden" id="contact" value="" />
<input type="hidden" id="note" value="" />
${turnstileSiteKey ? `
<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-callback="onTurnstileOk" style="position:absolute;left:-9999px;"></div>` : ''}
<div class="field-error show" id="err-general"></div>
</main>

<!-- Sticky bottom bar: agree-terms checkbox stacked directly above the
     total + Pay button row, matching the competitor (Karina) layout
     where checkbox sits right before the total/pay row. -->
<div class="sp-sticky-bar" style="flex-direction:column;gap:8px;padding-bottom:10px;">
  <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;width:100%;font-size:13px;line-height:1.4;">
    <input type="checkbox" id="agreeTerms" disabled style="margin-top:2px;width:16px;height:16px;flex-shrink:0;accent-color:var(--amber);" />
    <span>${t(lang, 'agree_terms')} <a href="/terms" target="_blank" rel="noopener" style="color:var(--amber);font-weight:700;text-decoration:none;letter-spacing:.4px;">TERMS AND CONDITIONS</a></span>
  </label>
  <div class="field-error" id="err-agree-terms" style="width:100%;"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;">
    <div class="sp-total">
    <span class="sp-total-label">${t(lang, 'total_label')}</span>
    <span class="sp-total-value" id="totalValue">$0.00</span>
    </div>
    <button type="button" class="btn btn-primary sp-buy-btn" id="buyBtn" disabled>${t(lang, 'btn_buy')}</button>
  </div>
</div>

${khqrAuto ? `
<!-- KHQR pay overlay: styled to match the official Bakong KHQR merchant
     card as closely as possible — red header with the KHQR wordmark and
     angled corner, white body with a big scannable QR under the merchant
     name, and a prominent purple "Open Bank App" button. -->
<div id="khqrPayModal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(5,7,12,0.92);overflow-y:auto;">
<div style="max-width:340px;margin:24px auto;padding:0 16px 40px;text-align:center;position:relative;">
<button id="khqrPayClose" type="button" aria-label="Close" style="position:absolute;top:0;right:16px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;z-index:2;">×</button>
<div style="background:#fff;border-radius:20px;box-shadow:0 20px 50px rgba(0,0,0,0.5);overflow:hidden;position:relative;margin-top:12px;">
<div style="background:#E21F26;padding:22px 16px 26px;position:relative;">
<div style="color:#fff;font-size:34px;font-weight:900;letter-spacing:2px;text-align:center;">KHQR</div>
<div style="position:absolute;bottom:-1px;right:0;width:0;height:0;border-style:solid;border-width:0 0 22px 40px;border-color:transparent transparent #fff transparent;"></div>
</div>
<div style="padding:20px;background:#fff;text-align:left;">
<div id="khqrPayMerchantName" style="font-size:22px;font-weight:700;color:#111;letter-spacing:0.5px;">${escapeHtml(khqrMerchantName)}</div>
<div style="display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 4px;">
<div id="khqrPayAmount" style="font-size:20px;font-weight:800;color:#E21F26;">$0.00 USD</div>
<div style="font-size:11px;color:#999;">#<span id="khqrPayBillCode">-</span></div>
</div>
<div style="border-top:1px dashed #ccc;margin:14px 0 16px;"></div>
<div id="khqrCanvas" style="display:flex;justify-content:center;align-items:center;width:236px;height:236px;margin:0 auto;overflow:hidden;"></div>
<div id="khqrBankPicker" style="display:none;margin:16px 0 6px;">
<div style="font-size:12px;color:#666;text-align:center;margin-bottom:10px;font-weight:600;">បើក App ធនាគារ​ភ្លាមៗ</div>
<div id="bankButtonsRow" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;"></div>
</div>
<a id="khqrPayDeeplink" href="#" style="display:block;margin:16px 0 4px;padding:14px 16px;background:linear-gradient(135deg,#7C4DFF 0%,#5E35B1 100%);color:#fff;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;text-align:center;box-shadow:0 4px 12px rgba(124,77,255,0.4);">📱 Open Bank App →</a>
<div style="font-size:11px;color:#888;text-align:center;margin-top:10px;line-height:1.5;">ABA · ACLEDA · Wing · Bakong · & more</div>
</div>
</div>
<div id="khqrPayStatus" style="margin-top:20px;font-size:14px;color:#F4F6FB;text-align:center;">${t(lang, 'khqr_auto_waiting')}</div>
<div id="khqrPayTimer" style="margin-top:6px;font-size:13px;color:#9AA3B8;text-align:center;"></div>
<a id="khqrPayGoOrder" href="#" style="display:none;margin:20px auto 0;max-width:200px;" class="btn btn-primary">${t(lang, 'khqr_auto_goto_order')}</a>
</div>
</div>` : ''}

${renderSiteFooter({ profileImage, lang, t, settings })}
<script>
window._WANFUNZY_BANKS = ${JSON.stringify((settings && settings.bankButtons && settings.bankButtons.length) ? settings.bankButtons : [{ id: 'aba', name: 'ABA', color: '#005EAB', emoji: '🏦', scheme: 'abamobilebank://qr?data={qr}', logo: null }])};
(function () {
const T = {
  err_player_id: ${JSON.stringify(t(lang, 'err_player_id'))},
  err_server_id: ${JSON.stringify(t(lang, 'err_server_id'))},
  err_contact: ${JSON.stringify(t(lang, 'err_contact'))},
  err_generic: ${JSON.stringify(t(lang, 'err_generic'))},
  err_connect: ${JSON.stringify(t(lang, 'err_connect'))},
  hint_pick_package: ${JSON.stringify(t(lang, 'hint_pick_package'))},
  btn_validated: ${JSON.stringify(t(lang, 'btn_validated'))},
  hint_validate_first: 'សូមបញ្ចូល Player ID ហើយចុច Verify Account ជាមុនសិន',
  btn_buying: ${JSON.stringify(t(lang, 'btn_buying'))},
  btn_buy: ${JSON.stringify(t(lang, 'btn_buy'))},
  khqr_auto_waiting: ${JSON.stringify(t(lang, 'khqr_auto_waiting'))},
  khqr_auto_paid: ${JSON.stringify(t(lang, 'khqr_auto_paid'))},
  khqr_auto_expired: ${JSON.stringify(t(lang, 'khqr_auto_expired'))},
  khqr_auto_time_left: ${JSON.stringify(t(lang, 'khqr_auto_time_left'))},
  err_agree_terms: ${JSON.stringify(t(lang, 'err_agree_terms'))}
};
const khqrAuto = ${khqrAuto ? 'true' : 'false'};
const gameId = ${JSON.stringify(game.id)};
const needsServerId = ${(game.requiresServerId || game.id === 'mlbb' || (game.name||'').toLowerCase().includes('mobile legend')) ? 'true' : 'false'};
// First package with a moogoldProductId — used for validate before user picks one
const firstPackageId = ${JSON.stringify((packages.find(p => p.moogoldProductId) || packages[0] || {}).id || '')};
let validated = false;
var agreeTermsEl = document.getElementById('agreeTerms');
function isAgreedTerms() { return !!(agreeTermsEl && agreeTermsEl.checked); }
if (agreeTermsEl) {
  agreeTermsEl.addEventListener('change', function () {
    var errEl = document.getElementById('err-agree-terms');
    if (isAgreedTerms() && errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  });
}
let playerId = '';
let serverId = '';
let selectedPackageId = null;
// Tracks whether we're currently in the middle of POSTing an order to
// the server. Used by the package-click handler (to ignore rapid taps)
// and by the buy-button handler (as a re-entry guard). Cleared on
// success (redirect / modal open) and on error paths.
let submissionInFlight = false;
let selectedPrice = 0;

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const validateBtn = document.getElementById('validateBtn');
const panelStep2 = document.getElementById('panelStep2');
const pkgHint = document.getElementById('pkgHint');
const totalValue = document.getElementById('totalValue');
const buyBtn = document.getElementById('buyBtn');

function showError(field, message) {
const el = document.getElementById('err-' + field);
if (el) { el.textContent = message; el.classList.add('show'); }
const input = document.getElementById(field);
if (input) input.classList.add('error');
}
function clearError(field) {
const el = document.getElementById('err-' + field);
if (el) { el.textContent = ''; el.classList.remove('show'); }
const input = document.getElementById(field);
if (input) input.classList.remove('error');
}

validateBtn.addEventListener('click', async function () {
['playerId', 'serverId', 'validate'].forEach(clearError);
playerId = document.getElementById('playerId').value.trim();
serverId = needsServerId ? document.getElementById('serverId').value.trim() : '';
let hasError = false;
if (!/^[0-9]{4,20}$/.test(playerId)) { showError('playerId', T.err_player_id); hasError = true; }
if (needsServerId && !/^[0-9]{1,6}$/.test(serverId)) { showError('serverId', T.err_server_id); hasError = true; }
if (hasError) return;

// Call validate API — 3 possible outcomes:
// 1. ok:true + real username → show the real in-game name, unlock packages
// 2. ok:false → block (system positively confirmed the ID is wrong)
// 3. ok:true + skipped:true → name-check unavailable — proceed WITHOUT
//    claiming anything is "correct" (no fake confirmation UI). The
//    customer's own responsibility to enter the right ID; admin reviews
//    before fulfilling, same as before.
validateBtn.disabled = true;
validateBtn.textContent = 'កំពុងពិនិត្យ...';
try {
  const validatePkgId = selectedPackageId || firstPackageId;
  const params = new URLSearchParams({ gameId, playerId });
  if (serverId) params.append('serverId', serverId);
  if (validatePkgId) params.append('packageId', validatePkgId);
  const vRes = await fetch('/api/topup/validate?' + params.toString());
  const vData = await vRes.json();

  if (!vData.ok) {
    // System positively confirmed this ID is wrong — block.
    showError('validate', vData.message || 'Player ID ឬ Server ID មិនត្រឹមត្រូវ។ សូមពិនិត្យម្តងទៀត។');
    validateBtn.disabled = false;
    validateBtn.textContent = T.btn_validate || 'ពិនិត្យ';
    return;
  }

  const validateHint = document.getElementById('err-validate');

  if (vData.skipped) {
    // Name-check unavailable — proceed neutrally, no false "correct" claim.
    if (validateHint) {
      validateHint.innerHTML =
        '<span style="color:var(--text-dim);">Player ID <strong style="color:var(--text)">' + escapeHtml(playerId) + '</strong>' +
        (serverId ? ' / Zone ID <strong style="color:var(--text)">' + escapeHtml(serverId) + '</strong>' : '') +
        ' — សូមប្រាកដថាបានវាយត្រឹមត្រូវ ព្រោះប្រព័ន្ធមិនអាចឆែកឈ្មោះ Game ដោយស្វ័យប្រវត្តិបានទេ</span>';
      validateHint.style.color = '';
      validateHint.style.fontWeight = '';
      validateHint.classList.add('show');
    }
    // Unlock immediately — no checkbox, no extra click, no fake confirmation.
    validated = true;
    validateBtn.textContent = T.btn_validated || 'បន្ត';
    validateBtn.disabled = true;
    document.getElementById('playerId').readOnly = true;
    if (needsServerId) document.getElementById('serverId').readOnly = true;
    panelStep2.classList.remove('sp-locked');
    pkgHint.textContent = T.hint_pick_package;
    panelStep2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // Real name-check succeeded — show the actual in-game username.
  if (validateHint) {
    validateHint.textContent = '✅ ' + (vData.username || 'Player ID ត្រឹមត្រូវ');
    validateHint.style.color = '#4ade80';
    validateHint.style.fontWeight = 'bold';
    validateHint.classList.add('show');
  }
  validateBtn.textContent = vData.username ? ('✓ ' + vData.username) : '✓ ត្រឹមត្រូវ';

} catch (e) {
  showError('validate', 'មិនអាចភ្ជាប់ server បានទេ។ សូម Refresh ទំព័រ ហើយព្យាយាមម្តងទៀត។');
  validateBtn.disabled = false;
  validateBtn.textContent = T.btn_validate || 'ពិនិត្យ';
  return;
}

validated = true;
panelStep2.classList.remove('sp-locked');
pkgHint.textContent = T.hint_pick_package;
validateBtn.textContent = T.btn_validated;
validateBtn.disabled = true;
document.getElementById('playerId').readOnly = true;
if (needsServerId) document.getElementById('serverId').readOnly = true;
panelStep2.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('.sp-pkg-card').forEach(function (card) {
card.addEventListener('click', function () {
// Ignore clicks while an order submission is in-flight OR while the
// pay modal is open. Without this guard, a user rapidly tapping two
// packages could submit an order for package A but end up with an
// order for package B (the async submit reads selectedPackageId at
// send time, which the second tap already changed).
//
// NOTE: we check submissionInFlight (a dedicated flag), NOT
// buyBtn.disabled — the button starts life disabled by design (no
// package picked yet), so keying the guard off .disabled would block
// every very first click forever. Bug found 2026-07-06.
if (submissionInFlight) return;
var modalEl = document.getElementById('khqrPayModal');
if (modalEl && modalEl.style.display === 'block') return;
if (!validated) {
document.getElementById('err-validate').textContent = T.hint_validate_first;
document.getElementById('err-validate').classList.add('show');
document.getElementById('panelStep1').scrollIntoView({ behavior: 'smooth' });
return;
}
document.querySelectorAll('.sp-pkg-card').forEach(c => c.classList.remove('sp-pkg-selected'));
card.classList.add('sp-pkg-selected');
selectedPackageId = card.dataset.packageId;
selectedPrice = parseFloat(card.dataset.price);
totalValue.textContent = '$' + selectedPrice.toFixed(2);
// Package chosen — now unlock the agree-terms checkbox (it stays
// disabled/unchecked until a package price has been selected).
if (agreeTermsEl) { agreeTermsEl.disabled = false; }
buyBtn.disabled = false;
// Step 3 removed — clicking a package auto-triggers checkout on
// auto-KHQR sites (Codashop-style: 1 tap = buy). Users still see
// the sticky Buy button and can re-tap it after a package change.
// We wait briefly for Turnstile to solve first (it's usually done
// by now since the user spent time on Verify), otherwise the server
// would reject the order with a captcha error.
if (khqrAuto) {
autoBuyWhenReady();
} else {
// Non-auto sites keep the visible Buy button as the confirmation
// step so users have a chance to review before submitting.
buyBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
}
});
});

// Wait up to 6s for Turnstile to solve (Cloudflare typically completes
// in ~1-2s once the widget renders). If it's already solved (common,
// since the user spent time on Verify), fires immediately. If Turnstile
// isn't configured, fires immediately as well.
// Cancellation token for the autoBuyWhenReady loop.
// The close-button handler sets this to true so any pending tick()
// that fires after a cancel sees the flag and bails out immediately
// instead of calling buyBtn.click() and submitting a new order.
var autoBuyCancelled = false;

function cancelAutoBuy() {
  autoBuyCancelled = true;
}

function autoBuyWhenReady() {
// Each call to autoBuyWhenReady (i.e. each package tap) starts fresh:
// reset the flag so a previous cancel doesn't block the new attempt.
autoBuyCancelled = false;
var start = Date.now();
function tick() {
// [ROOT CAUSE FIX] If the customer cancelled while this tick was
// queued via setTimeout, stop here — do NOT submit a new order.
// Without this check the tick() fires 250ms after cancel, sees the
// modal is now hidden, and calls buyBtn.click() which opens a brand
// new order (the "cancel → instantly back to waiting" loop).
if (autoBuyCancelled) return;
// Bail out if the pay modal already opened for a prior click, so
// consecutive rapid taps can't stack multiple orders.
var modalEl = document.getElementById('khqrPayModal');
if (modalEl && modalEl.style.display === 'block') return;
var tsEl = document.querySelector('[name="cf-turnstile-response"]');
var haveToken = tsEl && tsEl.value;
var turnstileEnabled = !!document.querySelector('.cf-turnstile');
if (haveToken || !turnstileEnabled || Date.now() - start > 6000) {
buyBtn.click();
return;
}
setTimeout(tick, 250);
}
tick();
}
buyBtn.addEventListener('click', async function () {
// Re-entry guard: block any click that arrives while a submission is
// already in flight. Belt-and-suspenders — the package handler also
// checks submissionInFlight before firing, but this covers direct
// buyBtn.click() calls (from bots) or double-taps that slip through
// between the fetch call and the button reset.
//
// Critical: set the flag IMMEDIATELY on entry, before any async work
// or DOM reads, so a second click that races into this handler on the
// very next tick sees submissionInFlight=true and bails at the guard
// above. (JS is single-threaded, but click events queue up — the
// browser dispatches them one after the other with no yield in between.)
if (submissionInFlight) return;
if (!isAgreedTerms()) {
var errAgree2 = document.getElementById('err-agree-terms');
if (errAgree2) { errAgree2.textContent = T.err_agree_terms; errAgree2.classList.add('show'); }
if (agreeTermsEl) agreeTermsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
return;
}
submissionInFlight = true;
buyBtn.disabled = true;
buyBtn.textContent = T.btn_buying;
clearError('contact');
clearError('general');
if (!validated || !selectedPackageId) {
submissionInFlight = false;
buyBtn.disabled = false;
buyBtn.textContent = T.btn_buy;
return;
}
const contact = document.getElementById('contact').value.trim();
const note = document.getElementById('note').value.trim();
// Read the honeypot from its DOM-neutral id ("b_field") — the server
// still receives it under the "website" key in the JSON payload so
// isHoneypotTripped() doesn't need any change.
const website = document.getElementById('b_field').value;
var turnstileToken = '';
var tsEl = document.querySelector('[name="cf-turnstile-response"]');
if (tsEl) turnstileToken = tsEl.value;
// If the customer attached a KHQR payment slip, read it as a data URL so
// it rides along with the order for the admin to verify against.
// Slip upload was removed with Step 3 — auto-verified KHQR proves
// payment now, no manual screenshot needed. Field kept in payload as
// empty string so server body shape stays the same.
var slipData = '';
try {
const res = await fetch('/api/topup/orders', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ playerId, serverId, contact, note, packageId: selectedPackageId, gameId, website, slip: slipData, turnstileToken })
});
const data = await res.json();
if (!res.ok || !data.ok) {
document.getElementById('err-general').textContent = (data.errors && data.errors[0]) || data.error || T.err_generic;
document.getElementById('err-general').classList.add('show');
submissionInFlight = false;
buyBtn.disabled = false;
buyBtn.textContent = T.btn_buy;
return;
}
var confirmUrl = '/order/confirmation?code=' + encodeURIComponent(data.order.code);
if (khqrAuto && data.khqr && data.khqr.qr) {
(function waitForQRCode(tries) {
  if (window.QRCode) { startKhqrPay(data.order.code, data.khqr, confirmUrl); return; }
  if (tries <= 0) { window.location.href = confirmUrl; return; }
  setTimeout(function () { waitForQRCode(tries - 1); }, 200);
})(25);
} else {
window.location.href = confirmUrl;
}
} catch (err) {
document.getElementById('err-general').textContent = T.err_connect;
document.getElementById('err-general').classList.add('show');
submissionInFlight = false;
buyBtn.disabled = false;
buyBtn.textContent = T.btn_buy;
}
});

// ---------- KHQR auto-pay: show QR, count down, poll payment status ----------
// Polling backs off over time (5s → 10s → 15s → 30s) so an abandoned QR
// screen costs at most ~35 status checks over its 10-minute lifetime.
function pollDelayMs(elapsedMs) {
if (elapsedMs < 30 * 1000) return 5000;
if (elapsedMs < 2 * 60 * 1000) return 10000;
if (elapsedMs < 5 * 60 * 1000) return 15000;
return 30000;
}

function startKhqrPay(orderCode, khqrData, confirmUrl) {
var modal = document.getElementById('khqrPayModal');
var statusEl = document.getElementById('khqrPayStatus');
var timerEl = document.getElementById('khqrPayTimer');
var goBtn = document.getElementById('khqrPayGoOrder');
if (!modal) { window.location.href = confirmUrl; return; }

document.getElementById('khqrPayAmount').textContent = '$' + selectedPrice.toFixed(2) + ' USD';
var billEl = document.getElementById('khqrPayBillCode');
if (billEl) billEl.textContent = orderCode;
goBtn.href = confirmUrl;

// Declare 'done' up-front so the async deeplink fetch below can safely
// reference it in its .then callback (otherwise we hit a temporal-dead-
// zone ReferenceError that silently kills the whole click handler and
// makes the modal never appear).
var startedAt = Date.now();
var done = false;

// Deeplink button: only shown on touch/mobile devices where a deeplink
// can actually launch an installed banking app. Fetched asynchronously
// so a slow Bakong API doesn't hold up the checkout modal. The QR is
// already usable when the modal opens; the button appears once the
// deeplink resolves. If Bakong is unreachable, the button stays hidden
// and the QR is enough.
// Show the "Open Bank App" button by default. Behaviour splits three ways:
//   1. Mobile + deeplink resolved → button links straight into ABA/Wing.
//   2. Mobile + deeplink pending or unavailable → button prompts to scan.
//   3. Desktop → button explains to open a bank app on the user's phone.
// Users see feedback either way instead of a mysteriously hidden button.
var deepEl = document.getElementById('khqrPayDeeplink');
var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints || 0) > 1;

// [FIX] This was previously described in the comments above ("Fetched
// asynchronously...") but the actual fetch call was never written — the
// button always fell straight to the clipboard-copy fallback and the
// per-bank buttons used guessed custom URL schemes (e.g.
// 'abamobilebank://qr?data={qr}') that ABA/Wing/ACLEDA do not actually
// support, which is why tapping "ABA" just opened the app with nothing
// pre-filled. This now calls our own /api/topup/orders/deeplink route,
// which calls Bakong's official generate_deeplink_by_qr API and returns
// a validated bakong.page.link universal link that Bakong itself routes
// into whichever compatible bank app is installed, with the transaction
// pre-loaded.
var resolvedDeeplink = null;
var deeplinkRequest = (khqrData.payToken && isMobile)
? fetch('/api/topup/orders/deeplink?code=' + encodeURIComponent(orderCode) + '&t=' + encodeURIComponent(khqrData.payToken))
.then(function (r) { return r.json(); })
.then(function (j) { if (j && j.ok && j.deeplink) resolvedDeeplink = j.deeplink; return resolvedDeeplink; })
.catch(function () { return null; })
: Promise.resolve(null);

if (deepEl) {
if (!isMobile) {
// Desktop: no way to launch a mobile bank app — turn the button into
// a helpful hint that doesn't navigate anywhere.
deepEl.textContent = '📱 Open your bank app to scan';
deepEl.style.opacity = '0.7';
deepEl.style.cursor = 'default';
deepEl.addEventListener('click', function (e) { e.preventDefault(); });
} else {
// Mobile: three-tier strategy.
// 1) Ask the server for a Bakong-generated deeplink (works when the
//    Bakong account is verified — otherwise Bakong returns errorCode 4).
// 2) If Bakong can't produce one, fall back to copying the KHQR
//    string to the clipboard so the user can paste it into their
//    banking app's paste-QR feature. All modern Cambodian bank apps
//    (ABA, Wing, ACLEDA, Bakong) support pasting a KHQR string.
// 3) If clipboard is unavailable, the button becomes a friendly hint
//    telling the user to scan.
deepEl.textContent = '📱 Preparing link…';
deepEl.style.opacity = '0.85';

deeplinkRequest.then(function (link) {
if (done) return; // modal already closed/paid — don't touch a torn-down UI
if (link) {
deepEl.textContent = '📱 Open Bank App →';
deepEl.style.opacity = '1';
deepEl.onclick = function (e) {
e.preventDefault();
// iOS/Android: use hidden iframe to trigger custom URI scheme.
// abamobilebank:// scheme requires this approach to reliably open ABA app
// with QR pre-loaded instead of just opening the app home screen.
var iframe = document.createElement('iframe');
iframe.style.display = 'none';
iframe.src = link;
document.body.appendChild(iframe);
setTimeout(function() { document.body.removeChild(iframe); }, 2000);
};
} else {
setupCopyFallback();
}
});

function setupCopyFallback() {
deepEl.textContent = '📋 Copy code & paste in bank app';
deepEl.style.opacity = '1';
deepEl.addEventListener('click', function (e) {
e.preventDefault();
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(khqrData.qr).then(function () {
deepEl.textContent = '✅ Copied! Paste in bank app';
setTimeout(function () {
if (!done) deepEl.textContent = '📋 Copy code & paste in bank app';
}, 2500);
}).catch(function () {
deepEl.textContent = '📱 Scan the QR with your bank app';
});
} else {
deepEl.textContent = '📱 Scan the QR with your bank app';
}
});
}

// Build bank buttons dynamically from admin config (window._WANFUNZY_BANKS).
// These are visual shortcuts only — Bakong's deeplink is bank-agnostic
// (one universal link routes into whichever app is installed), so every
// button below uses the SAME resolved Bakong link once it's ready. The
// per-bank 'scheme' field is kept only as a last-resort guess for the
// rare case the Bakong deeplink API itself is unavailable; it is not
// guaranteed to work since these schemes aren't officially published by
// the banks.
var qrData = encodeURIComponent(khqrData.qr);
var bankPicker = document.getElementById('khqrBankPicker');
var bankRow = document.getElementById('bankButtonsRow');
var BANK_BUTTONS = window._WANFUNZY_BANKS || [];

if (bankPicker && bankRow && BANK_BUTTONS.length > 0) {
  // [FIX] Clear stale buttons from prior package selection — prevents duplicates
  bankRow.innerHTML = '';
  BANK_BUTTONS.forEach(function(bank) {
    var btn = document.createElement('a');
    btn.href = '#';
    btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:12px 6px;background:' + (bank.color || '#333') + ';color:#fff;border-radius:10px;text-decoration:none;font-size:12px;font-weight:700;min-width:0;';
    if (bank.logo) {
      var img = document.createElement('img');
      img.src = '/static/uploads/' + bank.logo;
      img.style.cssText = 'width:32px;height:32px;object-fit:contain;margin-bottom:4px;border-radius:6px;background:#fff;padding:2px;';
      btn.appendChild(img);
    } else {
      var icon = document.createElement('span');
      icon.style.cssText = 'font-size:22px;line-height:1;margin-bottom:4px;';
      icon.textContent = bank.emoji || '🏦';
      btn.appendChild(icon);
    }
    var label = document.createElement('span');
    label.textContent = bank.name;
    label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
    btn.appendChild(label);
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      // [FIX] Use window.open('_blank') so iOS hands the custom URI scheme
      // to the ABA app instead of treating it as a page navigation.
      if (resolvedDeeplink) {
        // iframe trick for custom URI scheme (abamobilebank://)
        var iframe2 = document.createElement('iframe');
        iframe2.style.display = 'none';
        iframe2.src = resolvedDeeplink;
        document.body.appendChild(iframe2);
        setTimeout(function() { document.body.removeChild(iframe2); }, 2000);
        return;
      }
      // Deeplink may still be resolving — wait then open
      deeplinkRequest.then(function(link) {
        if (link) {
          var iframe3 = document.createElement('iframe');
          iframe3.style.display = 'none';
          iframe3.src = link;
          document.body.appendChild(iframe3);
          setTimeout(function() { document.body.removeChild(iframe3); }, 2000);
        } else {
          // Clipboard fallback — paste in bank app Scan QR screen
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(khqrData.qr).then(function() {
              var deepEl3 = document.getElementById('khqrPayDeeplink');
              if (deepEl3) deepEl3.textContent = '✅ Code បានចម្លង — បើក ' + bank.name + ' → Scan QR → Paste';
            }).catch(function() {});
          }
        }
      });
    });
    bankRow.appendChild(btn);
  });
  bankPicker.style.display = 'block';
}
}
}
// [BUG-1 FIX] Clear any stale QR from a prior package selection.
// qrcodejs appends — it never replaces — so without this reset the
// second package render stacks a second QR image on top of the first,
// making the container taller and causing the modal layout to distort.
var canvasEl = document.getElementById('khqrCanvas');
canvasEl.innerHTML = '';
new QRCode(canvasEl, {
text: khqrData.qr,
width: 220,
height: 220,
correctLevel: QRCode.CorrectLevel.M
});
// qrcodejs injects both a <canvas> and an <img> with their own inline
// width/height styles. Force both to an exact 220×220 square so the QR
// is always scannable regardless of which package was selected.
setTimeout(function () {
  ['canvas', 'img'].forEach(function (tag) {
    var el = canvasEl.querySelector(tag);
    if (!el) return;
    el.style.cssText = 'width:220px!important;height:220px!important;display:block;margin:0 auto;';
  });
}, 0);
modal.style.display = 'block';
document.body.style.overflow = 'hidden';

// Close button: dismiss the modal AND cancel the order server-side so
// the admin doesn't see it stuck in "awaiting" — a closed modal means
// the customer abandoned checkout. The cancel is best-effort; if the
// network drops we still close the UI so the customer isn't stuck.
// If the customer actually did pay in the last moment, the server will
// refuse the cancel (paid orders can't be cancelled) and the QR stays
// valid on the confirmation page.
var closeBtn = document.getElementById('khqrPayClose');
if (closeBtn) {
// [BUG-2 FIX] Remove any listener left by a previous startKhqrPay()
// call before attaching a new one.
//
// startKhqrPay() runs once each time the customer selects a package
// (and khqrAuto is on). Without this guard, every package tap stacks
// another click listener on the same × button. When the user hits ×:
//   1. The OLDEST listener fires first: it resets submissionInFlight=false
//      and clears buyBtn — which immediately lets autoBuyWhenReady()
//      fire again and submit a brand-new order.
//   2. The NEWER listener fires a moment later and cancels the WRONG
//      order (the old one), leaving the new order stuck in "awaiting".
// Net result: modal appeared to loop back into the waiting state.
if (closeBtn._khqrHandler) {
  closeBtn.removeEventListener('click', closeBtn._khqrHandler);
  closeBtn._khqrHandler = null;
}
// Capture the current order's identifiers in the closure so the
// handler cancels the RIGHT order even if the user somehow changes
// the package selection before the fetch returns.
var capturedCode  = orderCode;
var capturedToken = khqrData.payToken;
closeBtn._khqrHandler = function () {
done = true;
// Stop countdown timer and any queued poll tick immediately so nothing
// fires after the modal is closed.
clearInterval(countdown);
if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
// Kill any pending autoBuyWhenReady tick() queued in the event loop.
cancelAutoBuy();
// Fire-and-forget cancel — don't block the UI on the response.
try {
fetch('/api/topup/orders/cancel', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ code: capturedCode, t: capturedToken })
}).catch(function () { /* silent */ });
} catch (e) { /* silent */ }
modal.style.display = 'none';
document.body.style.overflow = '';
// Reset the Buy button so the customer can start a fresh order.
submissionInFlight = false;
buyBtn.disabled = false;
buyBtn.textContent = T.btn_buy;
};
closeBtn.addEventListener('click', closeBtn._khqrHandler);
}

// Countdown to QR expiry
// Use a stable expiry baseline computed once when the modal opens.
var expiresAt = Number(khqrData.expiresAt);
var countdown = setInterval(function () {
var left = Math.max(0, expiresAt - Date.now());
var m = Math.floor(left / 60000);
var s = Math.floor((left % 60000) / 1000);
timerEl.textContent = T.khqr_auto_time_left + ': ' + m + ':' + (s < 10 ? '0' : '') + s;
if (left <= 0) clearInterval(countdown);
}, 1000);

// pollTimer holds the setTimeout handle for the next poll tick so we
// can cancel it instantly when the user closes the modal.
var pollTimer = null;

function finish(paid) {
if (done) return;
done = true;
clearInterval(countdown);
if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
if (paid) {
statusEl.textContent = T.khqr_auto_paid;
statusEl.style.color = '#38d980';
setTimeout(function () { window.location.href = confirmUrl + '&paid=1'; }, 1200);
} else {
statusEl.textContent = T.khqr_auto_expired;
timerEl.textContent = '';
goBtn.style.display = 'inline-block';
}
}

function poll() {
pollTimer = null;
if (done) return;
if (Date.now() > expiresAt) return finish(false);
fetch('/api/topup/orders/payment-status?code=' + encodeURIComponent(orderCode) + '&t=' + encodeURIComponent(khqrData.payToken))
.then(function (r) { return r.json(); })
.then(function (d) {
if (done) return;
if (d && d.status === 'paid') return finish(true);
if (d && d.status === 'expired') return finish(false);
// status === 'cancelled' means the server already cancelled this order
if (d && d.status === 'cancelled') return;
pollTimer = setTimeout(poll, pollDelayMs(Date.now() - startedAt));
})
.catch(function () {
if (!done) pollTimer = setTimeout(poll, pollDelayMs(Date.now() - startedAt));
});
}
pollTimer = setTimeout(poll, 4000);
}
})();
</script>`;

  const turnstileHead = turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  const khqrHead = khqrAuto
    ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>'
    : '';
  return layout({ title: `${game.shortName || game.name || 'Top-Up'} — បញ្ចូល — Wanfunzy`, body, head: turnstileHead + khqrHead });
}

module.exports = { renderTopupPackage };
