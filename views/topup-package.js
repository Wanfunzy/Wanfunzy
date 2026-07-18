// views/topup-package.js

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
  let iconHtml = '';
  if (cardBgFilename) {
    iconHtml = `<div class="sp-pkg-icon sp-pkg-icon-photo" style="background-image:url('/static/uploads/${escapeHtml(cardBgFilename)}');"></div>`;
  } else if (!isPureOrBonus) {
    iconHtml = `<div class="sp-pkg-icon sp-pkg-icon-empty"></div>`;
  }
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
    if (amt > 0 && bon > 0)     line1 = `${amt}+${bon}`;
    else if (amt > 0)            line1 = `${amt}`;
    else                         line1 = pkg.name;
    line2 = '';
  }
  // Admin-editable highlight ribbon (e.g. "+5 ពិន្ទុ", "ក្តៅ🔥", "Best
  // Value") — free text set per-package from the admin dashboard, shown
  // pinned to the card's top-right corner.
  const badgeHtml = pkg.badge ? `<div class="sp-pkg-badge">${escapeHtml(pkg.badge)}</div>` : '';
  return `\n<button type="button" class="sp-pkg-card${isPureOrBonus ? ' sp-pkg-card-plain' : ''}" data-package-id="${pkg.id}" data-price="${pkg.price}" data-name="${escapeHtml(pkg.name)}">\n${badgeHtml}\n${iconHtml}\n<div class="sp-pkg-info">\n<div class="sp-pkg-name">${escapeHtml(line1)}</div>\n${line2 ? `<div class="sp-pkg-sub">${escapeHtml(line2)}</div>` : ''}\n</div>\n<div class="sp-pkg-price">$${pkg.price.toFixed(2)}</div>\n</button>`;
}

function renderTopupPackage({ game, packages, settings, lang = 'en', turnstileSiteKey = '', khqrAuto = false }) {
  turnstileSiteKey = '';
  const colors = (settings && settings.colors) || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const gameLogos = (settings && settings.gameLogos) || {};
  const cardBackgrounds = (settings && settings.cardBackgrounds) || {};
  const specialOfferImages = (settings && settings.specialOfferImages) || {};
  const packageImages = (settings && settings.packageImages) || {};
  const profileImage = settings && settings.profileImage ? `/static/uploads/${encodeURIComponent(settings.profileImage)}` : '/static/images/mascot.jpg';
  const khqrImage = (settings && settings.khqrImage) || null;
  const khqrMerchantName = (settings && settings.khqrMerchantName) || 'Wanfunzy';
  const pkgFillLine   = colors.pkgFill   ? `--pkg-fill: ${escapeHtml(colors.pkgFill)};`     : '';
  const pkgStrokeLine = colors.pkgStroke ? `--pkg-stroke: ${escapeHtml(colors.pkgStroke)};` : '';
  const customColorStyle = `\n<style>\n:root {\n--text: ${escapeHtml(colors.heading)};\n--text-dim: ${escapeHtml(colors.body)};\n--amber: ${escapeHtml(colors.accent)};\n${pkgFillLine}\n${pkgStrokeLine}\n}\n</style>` + brandEffectCSS(settings);
  const customLogo = gameLogos[game.id];
  const cardBg = cardBackgrounds[game.id];
  const isVideoBg = cardBg && /\.(mp4|webm)$/i.test(cardBg);
  const bannerHtml = cardBg
    ? (isVideoBg
        ? `<div class="sp-game-banner sp-game-banner-video-wrap"><video class="sp-game-banner-video" autoplay muted loop playsinline src="/static/uploads/${escapeHtml(cardBg)}"></video><div class="sp-game-banner-overlay"></div></div>`
        : `<div class="sp-game-banner" style="background-image: linear-gradient(180deg, rgba(11,14,20,0.15), rgba(11,14,20,0.9)), url('/static/uploads/${escapeHtml(cardBg)}');"></div>`)
    : '';
  const logoHtml = customLogo ? `<img src="/static/uploads/${escapeHtml(customLogo)}" alt="${escapeHtml(game.shortName)}" class="topup-header-logo" />` : `<div class="topup-header-logo topup-header-logo-empty">${ICONS.empty}</div>`;
  const isPassOrPack    = (p) => /pass|pack|value|twilight|weekly|super|limited/i.test(p.name);
  const isFirstTopup    = (p) => /first|1st/i.test(p.name) && !isPassOrPack(p);
  const hasDiamondBonus = (p) => !isPassOrPack(p) && !isFirstTopup(p) && p.bonus > 0;
  const isPureDiamond   = (p) => !isPassOrPack(p) && !isFirstTopup(p) && !(p.bonus > 0);
  const byCategory = (key) => (p) => p.category ? p.category === key : (key === 'passes' ? isPassOrPack(p) : key === 'firsttopup' ? isFirstTopup(p) : key === 'bonusDiamond' ? hasDiamondBonus(p) : isPureDiamond(p));
  const passesPkgs       = packages.filter(byCategory('passes'));
  const firstTopupPkgs   = packages.filter(byCategory('firsttopup'));
  const bonusDiamondPkgs = packages.filter(byCategory('bonusDiamond')).sort((a, b) => (a.price || 0) - (b.price || 0));
  const pureDiamondPkgs  = packages.filter(byCategory('pureDiamond')).sort((a, b) => (a.price || 0) - (b.price || 0));
  const sectionImages = (settings && settings.sectionImages && settings.sectionImages[game.id]) || {};
  const packageIconImages = (settings && settings.packageIconImages) || {};
  const sectionEmoji  = (settings && settings.sectionEmoji  && settings.sectionEmoji[game.id])  || {};
  const passesImg = sectionImages.passes || null;
  const firstImg  = sectionImages.firstTopup || null;
  const bonusImg  = sectionImages.bonusDiamond || null;
  const priceImg  = sectionImages.pureDiamond  || null;
  const passesBand = passesPkgs.length ? `\n<div class="sp-band"><span>Special Passes &amp; Packs</span></div>\n<div class="sp-pkg-grid">\n${passesPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || passesImg)).join('\n')}\n</div>` : '';
  const firstTopupBand = firstTopupPkgs.length ? `\n<div class="sp-band"><span>First Top-Up Bonuses</span></div>\n<div class="sp-pkg-grid">\n${firstTopupPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || firstImg)).join('\n')}\n</div>` : '';
  const bonusDiamondBand = bonusDiamondPkgs.length ? `\n<div class="sp-band"><span>Standard Diamond Packs</span></div>\n<div class="sp-pkg-grid">\n${bonusDiamondPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || bonusImg)).join('\n')}\n</div>` : '';
  const pureDiamondBand = pureDiamondPkgs.length ? `\n<div class="sp-band"><span>Sorted by Price</span></div>\n<div class="sp-pkg-grid">\n${pureDiamondPkgs.map((p) => renderPkgCard(p, game, packageIconImages[p.id] || priceImg)).join('\n')}\n</div>` : '';
  const header = renderSiteHeader({ profileImage, lang, t, settings, showChangeGame: true });

  const needsServerIdSSR = (game.requiresServerId || game.id === 'mlbb' || (game.name||'').toLowerCase().includes('mobile legend'));

  const body = `
${customColorStyle}
<div class="sp-hero">
${header}
${bannerHtml}
</div>
<main class="sp-main">
<div class="wrap">
<div class="topup-game-header" style="border-bottom:none;padding-bottom:16px;">
${logoHtml}
<div>
<div class="section-eyebrow">${t(lang, 'topping_up_for')}</div>
<h2 style="font-size:22px;margin:0;">${escapeHtml(game.name)}</h2>
</div>
</div>

<div class="sp-panel" id="panelStep1">
<div class="form-row" id="formRow">
<div class="field">
<label for="playerId">Player ID</label>
<input type="text" id="playerId" name="playerId" placeholder="${t(lang, 'ph_player_id')}" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-playerId"></div>
</div>
<div class="field" id="serverIdField" style="display:${needsServerIdSSR ? '' : 'none'};">
<label for="serverId">Server ID</label>
<input type="text" id="serverId" name="serverId" placeholder="${t(lang, 'ph_server_id')}" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-serverId"></div>
</div>
</div>
<div class="field-error show" id="err-validate" style="margin-bottom:8px;"></div>
<button type="button" class="btn btn-primary btn-full" id="validateBtn">${t(lang, 'btn_validate')}</button>
</div>

<div class="sp-panel sp-locked" id="panelStep2">
<p class="sp-lock-hint" id="pkgHint" style="display:none;"></p>
${passesBand}
${firstTopupBand}
${bonusDiamondBand}
${pureDiamondBand}
</div>

<div class="hp-field" aria-hidden="true" style="position:absolute !important;left:-9999px !important;top:-9999px !important;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;">
<label for="b_field" aria-hidden="true" tabindex="-1">Leave this empty</label>
<input type="text" id="b_field" name="b_field" tabindex="-1" autocomplete="new-password" data-hp="1" />
</div>
<input type="hidden" id="contact" value="" />
<input type="hidden" id="note" value="" />
${turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-callback="onTurnstileOk" style="position:absolute;left:-9999px;"></div>` : ''}
<div class="field-error show" id="err-general"></div>
</main>

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
  btn_validate: ${JSON.stringify(t(lang, 'btn_validate'))},
  khqr_auto_waiting: ${JSON.stringify(t(lang, 'khqr_auto_waiting'))},
  khqr_auto_paid: ${JSON.stringify(t(lang, 'khqr_auto_paid'))},
  khqr_auto_expired: ${JSON.stringify(t(lang, 'khqr_auto_expired'))},
  khqr_auto_time_left: ${JSON.stringify(t(lang, 'khqr_auto_time_left'))},
  err_agree_terms: ${JSON.stringify(t(lang, 'err_agree_terms'))}
};
const khqrAuto = ${khqrAuto ? 'true' : 'false'};
const gameId = ${JSON.stringify(game.id)};
const needsServerId = ${needsServerIdSSR ? 'true' : 'false'};
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
let submissionInFlight = false;
let selectedPrice = 0;

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const validateBtn = document.getElementById('validateBtn');
const panelStep2  = document.getElementById('panelStep2');
const pkgHint     = document.getElementById('pkgHint');
const totalValue  = document.getElementById('totalValue');
const buyBtn      = document.getElementById('buyBtn');

function showError(field, message) {
  var el = document.getElementById('err-' + field);
  if (el) { el.textContent = message; el.classList.add('show'); }
  var input = document.getElementById(field);
  if (input) input.classList.add('error');
}
function clearError(field) {
  var el = document.getElementById('err-' + field);
  if (el) { el.textContent = ''; el.classList.remove('show'); }
  var input = document.getElementById(field);
  if (input) input.classList.remove('error');
}

validateBtn.addEventListener('click', async function () {
  ['playerId', 'serverId', 'validate'].forEach(clearError);
  playerId = document.getElementById('playerId').value.trim();
  serverId = needsServerId ? document.getElementById('serverId').value.trim() : '';
  var hasError = false;
  if (!/^[0-9]{4,20}$/.test(playerId)) { showError('playerId', T.err_player_id); hasError = true; }
  if (needsServerId && !/^[0-9]{1,6}$/.test(serverId)) { showError('serverId', T.err_server_id); hasError = true; }
  if (hasError) return;

  validateBtn.disabled = true;
  validateBtn.textContent = 'កំពុងពិនិត្យ...';
  try {
    var validatePkgId = selectedPackageId || firstPackageId;
    var params = new URLSearchParams({ gameId, playerId });
    params.append('serverId', serverId || '');
    if (validatePkgId) params.append('packageId', validatePkgId);
    var vRes  = await fetch('/api/topup/validate?' + params.toString());
    var vData = await vRes.json();

    // [POLICY] Only ok:true with a confirmed username unlocks packages.
    // ok:false = blocked (wrong ID, validate unavailable, unsupported game).
    // skipped path is removed — server never returns skipped anymore.
    if (!vData.ok) {
      showError('validate', vData.message || 'Player ID មិនត្រឹមត្រូវ។ សូមពិនិត្យម្តងទៀត។');
      validateBtn.disabled = false;
      validateBtn.textContent = T.btn_validate || 'ពិនិត្យ';
      return;
    }

    // MooGold confirmed — show real username and unlock.
    var validateHint = document.getElementById('err-validate');
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
  validateBtn.disabled = true;
  document.getElementById('playerId').readOnly = true;
  if (needsServerId) document.getElementById('serverId').readOnly = true;
  panelStep2.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('.sp-pkg-card').forEach(function (card) {
  card.addEventListener('click', function () {
    if (submissionInFlight) return;
    var modalEl = document.getElementById('khqrPayModal');
    if (modalEl && modalEl.style.display === 'block') return;
    if (!validated) {
      document.getElementById('err-validate').textContent = T.hint_validate_first;
      document.getElementById('err-validate').classList.add('show');
      document.getElementById('panelStep1').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    document.querySelectorAll('.sp-pkg-card').forEach(function(c) { c.classList.remove('sp-pkg-selected'); });
    card.classList.add('sp-pkg-selected');
    selectedPackageId = card.dataset.packageId;
    selectedPrice = parseFloat(card.dataset.price);
    totalValue.textContent = '$' + selectedPrice.toFixed(2);
    if (agreeTermsEl) { agreeTermsEl.disabled = false; }
    buyBtn.disabled = false;
    if (khqrAuto) { autoBuyWhenReady(); }
    else { buyBtn.scrollIntoView({ behavior: 'smooth', block: 'end' }); }
  });
});

var autoBuyCancelled = false;
function cancelAutoBuy() { autoBuyCancelled = true; }
function autoBuyWhenReady() {
  autoBuyCancelled = false;
  var start = Date.now();
  function tick() {
    if (autoBuyCancelled) return;
    var modalEl = document.getElementById('khqrPayModal');
    if (modalEl && modalEl.style.display === 'block') return;
    var tsEl = document.querySelector('[name="cf-turnstile-response"]');
    var haveToken = tsEl && tsEl.value;
    var turnstileEnabled = !!document.querySelector('.cf-turnstile');
    if (haveToken || !turnstileEnabled || Date.now() - start > 6000) { buyBtn.click(); return; }
    setTimeout(tick, 250);
  }
  tick();
}

buyBtn.addEventListener('click', async function () {
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
  clearError('contact'); clearError('general');
  if (!validated || !selectedPackageId) {
    submissionInFlight = false; buyBtn.disabled = false; buyBtn.textContent = T.btn_buy; return;
  }
  var contact = document.getElementById('contact').value.trim();
  var note    = document.getElementById('note').value.trim();
  var website = document.getElementById('b_field').value;
  var turnstileToken = '';
  var tsEl = document.querySelector('[name="cf-turnstile-response"]');
  if (tsEl) turnstileToken = tsEl.value;
  var slipData = '';
  try {
    var res  = await fetch('/api/topup/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, serverId, contact, note, packageId: selectedPackageId, gameId, website, slip: slipData, turnstileToken })
    });
    var data = await res.json();
    if (!res.ok || !data.ok) {
      document.getElementById('err-general').textContent = (data.errors && data.errors[0]) || data.error || T.err_generic;
      document.getElementById('err-general').classList.add('show');
      submissionInFlight = false; buyBtn.disabled = false; buyBtn.textContent = T.btn_buy; return;
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
    submissionInFlight = false; buyBtn.disabled = false; buyBtn.textContent = T.btn_buy;
  }
});

function pollDelayMs(elapsedMs) {
  if (elapsedMs < 30 * 1000)    return 5000;
  if (elapsedMs < 2 * 60 * 1000) return 10000;
  if (elapsedMs < 5 * 60 * 1000) return 15000;
  return 30000;
}

function startKhqrPay(orderCode, khqrData, confirmUrl) {
  var modal    = document.getElementById('khqrPayModal');
  var statusEl = document.getElementById('khqrPayStatus');
  var timerEl  = document.getElementById('khqrPayTimer');
  var goBtn    = document.getElementById('khqrPayGoOrder');
  if (!modal) { window.location.href = confirmUrl; return; }
  document.getElementById('khqrPayAmount').textContent = '$' + selectedPrice.toFixed(2) + ' USD';
  var billEl = document.getElementById('khqrPayBillCode');
  if (billEl) billEl.textContent = orderCode;
  goBtn.href = confirmUrl;
  var startedAt = Date.now();
  var done = false;
  var deepEl   = document.getElementById('khqrPayDeeplink');
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints || 0) > 1;
  var resolvedDeeplink = null;
  var deeplinkRequest = (khqrData.payToken && isMobile)
    ? fetch('/api/topup/orders/deeplink?code=' + encodeURIComponent(orderCode) + '&t=' + encodeURIComponent(khqrData.payToken))
        .then(function(r) { return r.json(); })
        .then(function(j) { if (j && j.ok && j.deeplink) resolvedDeeplink = j.deeplink; return resolvedDeeplink; })
        .catch(function() { return null; })
    : Promise.resolve(null);
  if (deepEl) {
    if (!isMobile) {
      deepEl.textContent = '📱 Open your bank app to scan';
      deepEl.style.opacity = '0.7'; deepEl.style.cursor = 'default';
      deepEl.addEventListener('click', function(e) { e.preventDefault(); });
    } else {
      deepEl.textContent = '📱 Preparing link…'; deepEl.style.opacity = '0.85';
      deeplinkRequest.then(function(link) {
        if (done) return;
        if (link) {
          deepEl.textContent = '📱 Open Bank App →'; deepEl.style.opacity = '1';
          deepEl.onclick = function(e) { e.preventDefault(); window.location.href = link; };
        } else { setupCopyFallback(); }
      });
      function setupCopyFallback() {
        deepEl.textContent = '📋 Copy code & paste in bank app'; deepEl.style.opacity = '1';
        deepEl.addEventListener('click', function(e) {
          e.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(khqrData.qr).then(function() {
              deepEl.textContent = '✅ Copied! Paste in bank app';
              setTimeout(function() { if (!done) deepEl.textContent = '📋 Copy code & paste in bank app'; }, 2500);
            }).catch(function() { deepEl.textContent = '📱 Scan the QR with your bank app'; });
          } else { deepEl.textContent = '📱 Scan the QR with your bank app'; }
        });
      }
      var bankPicker = document.getElementById('khqrBankPicker');
      var bankRow    = document.getElementById('bankButtonsRow');
      var BANK_BUTTONS = window._WANFUNZY_BANKS || [];
      if (bankPicker && bankRow && BANK_BUTTONS.length > 0) {
        bankRow.innerHTML = '';
        BANK_BUTTONS.forEach(function(bank) {
          var btn = document.createElement('a');
          btn.href = '#';
          btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:12px 6px;background:' + (bank.color||'#333') + ';color:#fff;border-radius:10px;text-decoration:none;font-size:12px;font-weight:700;min-width:0;';
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
            if (resolvedDeeplink) { window.location.href = resolvedDeeplink; return; }
            deeplinkRequest.then(function(link) {
              if (link) { window.location.href = link; }
              else {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(khqrData.qr).then(function() {
                    var d3 = document.getElementById('khqrPayDeeplink');
                    if (d3) d3.textContent = '✅ Code បានចម្លង — បើក ' + bank.name + ' → Scan QR → Paste';
                  }).catch(function(){});
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
  var canvasEl = document.getElementById('khqrCanvas');
  canvasEl.innerHTML = '';
  new QRCode(canvasEl, { text: khqrData.qr, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  setTimeout(function() {
    ['canvas','img'].forEach(function(tag) {
      var el = canvasEl.querySelector(tag);
      if (!el) return;
      el.style.cssText = 'width:220px!important;height:220px!important;display:block;margin:0 auto;';
    });
  }, 0);
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
  var closeBtn = document.getElementById('khqrPayClose');
  if (closeBtn) {
    if (closeBtn._khqrHandler) { closeBtn.removeEventListener('click', closeBtn._khqrHandler); closeBtn._khqrHandler = null; }
    var capturedCode  = orderCode;
    var capturedToken = khqrData.payToken;
    closeBtn._khqrHandler = function() {
      done = true;
      clearInterval(countdown);
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      cancelAutoBuy();
      try {
        fetch('/api/topup/orders/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: capturedCode, t: capturedToken }) }).catch(function(){});
      } catch(e) {}
      modal.style.display = 'none';
      document.body.style.overflow = '';
      submissionInFlight = false; buyBtn.disabled = false; buyBtn.textContent = T.btn_buy;
    };
    closeBtn.addEventListener('click', closeBtn._khqrHandler);
  }
  var expiresAt = Number(khqrData.expiresAt);
  var countdown = setInterval(function() {
    var left = Math.max(0, expiresAt - Date.now());
    var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    timerEl.textContent = T.khqr_auto_time_left + ': ' + m + ':' + (s < 10 ? '0' : '') + s;
    if (left <= 0) clearInterval(countdown);
  }, 1000);
  var pollTimer = null;
  function finish(paid) {
    if (done) return; done = true;
    clearInterval(countdown);
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (paid) {
      statusEl.textContent = T.khqr_auto_paid; statusEl.style.color = '#38d980';
      setTimeout(function() { window.location.href = confirmUrl + '&paid=1'; }, 1200);
    } else {
      statusEl.textContent = T.khqr_auto_expired; timerEl.textContent = ''; goBtn.style.display = 'inline-block';
    }
  }
  function poll() {
    pollTimer = null; if (done) return;
    if (Date.now() > expiresAt) return finish(false);
    fetch('/api/topup/orders/payment-status?code=' + encodeURIComponent(orderCode) + '&t=' + encodeURIComponent(khqrData.payToken))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (done) return;
        if (d && d.status === 'paid')      return finish(true);
        if (d && d.status === 'expired')   return finish(false);
        if (d && d.status === 'cancelled') return;
        pollTimer = setTimeout(poll, pollDelayMs(Date.now() - startedAt));
      })
      .catch(function() { if (!done) pollTimer = setTimeout(poll, pollDelayMs(Date.now() - startedAt)); });
  }
  pollTimer = setTimeout(poll, 4000);
}
})();
</script>`;

  const turnstileHead = turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
  const khqrHead = khqrAuto ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' : '';
  return layout({ title: `${game.shortName || game.name || 'Top-Up'} — បញ្ចូល — Wanfunzy`, body, head: turnstileHead + khqrHead });
}

module.exports = { renderTopupPackage };
