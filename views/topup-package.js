'use strict';
const { layout, ICONS, gameIcon, brandEffectCSS, renderSiteHeader, renderSiteFooter } = require('./layout');
const { t } = require('./i18n');

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function categorisePackages(pkgs) {
  const isPassOrPack    = p => /pass|pack|value|twilight|weekly|super|limited/i.test(p.name||'');
  const isFirstTopup    = p => /first|1st/i.test(p.name||'') && !isPassOrPack(p);
  const hasDiamondBonus = p => !isPassOrPack(p) && !isFirstTopup(p) && Number(p.bonus) > 0;
  const isPureDiamond   = p => !isPassOrPack(p) && !isFirstTopup(p) && !(Number(p.bonus) > 0);
  const byCategory = key => p => p.category
    ? p.category === key
    : (key==='passes'?isPassOrPack(p):key==='firsttopup'?isFirstTopup(p):key==='bonusDiamond'?hasDiamondBonus(p):isPureDiamond(p));
  const byPrice = (a,b) => {
    const pa=Number(a.price)||0, pb=Number(b.price)||0;
    if(pa<=0&&pb>0)return 1; if(pa>0&&pb<=0)return -1; return pa-pb;
  };
  return {
    passes:       pkgs.filter(byCategory('passes')).sort(byPrice),
    firsttopup:   pkgs.filter(byCategory('firsttopup')).sort(byPrice),
    bonusDiamond: pkgs.filter(byCategory('bonusDiamond')).sort(byPrice),
    pureDiamond:  pkgs.filter(byCategory('pureDiamond')).sort(byPrice)
  };
}

function renderGemCard(pkg, currencyUnit, iconImages, cardBg) {
  const bonusText  = pkg.bonus > 0 ? `+${pkg.bonus} Bonus` : (pkg.special ? '&nbsp;' : '');
  const amountLabel= pkg.special ? escapeHtml(pkg.name) : `${(pkg.amount||0).toLocaleString()} ${escapeHtml(currencyUnit||'💎')}`;
  const bonusClass = pkg.bonus > 0 ? ' has-bonus' : '';
  const iconFile   = (iconImages||{})[pkg.id];
  const bgFile     = cardBg;
  const iconHtml   = iconFile
    ? `<img src="/static/uploads/${escapeHtml(iconFile)}" alt="" style="width:36px;height:36px;object-fit:contain;margin-bottom:4px;" />`
    : ICONS.diamond;
  const bgStyle    = bgFile ? `style="background-image:url('/static/uploads/${escapeHtml(bgFile)}');background-size:cover;background-position:center;"` : '';
  return `
<label class="gem-card${bonusClass}" data-package-id="${pkg.id}" data-price="${pkg.price}" data-name="${escapeHtml(pkg.name)}" data-moogold-id="${escapeHtml(String(pkg.moogoldProductId||''))}" ${bgStyle}>
  <input type="radio" name="packageId" value="${pkg.id}" />
  ${iconHtml}
  <div class="gem-amount">${amountLabel}</div>
  <div class="gem-bonus">${bonusText}</div>
  <div class="gem-price">$${pkg.price.toFixed(2)}</div>
</label>`;
}

function renderSection(title, emoji, pkgs, currencyUnit, iconImages, cardBg, sectionImg) {
  if (!pkgs.length) return '';
  const cards = pkgs.map(p => renderGemCard(p, currencyUnit, iconImages, cardBg)).join('');
  const headerStyle = sectionImg
    ? `style="background:linear-gradient(rgba(11,14,20,.7),rgba(11,14,20,.85)),url('/static/uploads/${escapeHtml(sectionImg)}') center/cover;padding:14px 16px;border-radius:10px 10px 0 0;"`
    : '';
  return `
<div class="pkg-section" style="margin-bottom:24px;">
  <div class="section-band" ${headerStyle}>
    <span style="font-size:18px;">${emoji||'💎'}</span>
    <span style="font-size:14px;font-weight:700;color:var(--text);margin-left:8px;">${escapeHtml(title)}</span>
  </div>
  <div class="gem-grid">${cards}</div>
</div>`;
}

function renderTopupPackage({ game, packages, settings, lang, turnstileSiteKey, khqrAuto }) {
  // Force-disable Turnstile client-side (server-side secret still validates)
  turnstileSiteKey = '';

  const s            = settings || {};
  const profileImage = s.profileImage ? `/static/uploads/${encodeURIComponent(s.profileImage)}` : '/static/images/mascot.jpg';
  const colors       = s.colors || { heading:'#F4F6FB', body:'#9AA3B8', accent:'#FFB84D' };
  const iconImages   = (s.packageIconImages || {})[game.id] || {};
  const cardBg       = (s.cardBackgrounds   || {})[game.id] || null;
  const sectionImgs  = (s.sectionImages     || {})[game.id] || {};
  const sectionEmoji = (s.sectionEmojis     || {})[game.id] || {};
  const gameLogoFile = (s.gameLogos         || {})[game.id];
  const gameIconHtml = gameLogoFile
    ? `<img src="/static/uploads/${escapeHtml(gameLogoFile)}" alt="${escapeHtml(game.shortName)}" style="width:40px;height:40px;object-fit:contain;border-radius:10px;" />`
    : gameIcon(game.icon);

  const cats   = categorisePackages(packages);
  const needsServer = !!game.requiresServerId;

  const passesHtml       = renderSection('Special Passes & Packs', sectionEmoji.passes||'🎫', cats.passes, game.currencyUnit, iconImages, cardBg, sectionImgs.passes);
  const firsttopupHtml   = renderSection('First Top-Up Bonuses', sectionEmoji.firsttopup||'🎁', cats.firsttopup, game.currencyUnit, iconImages, cardBg, sectionImgs.firstTopup);
  const bonusDiamondHtml = renderSection('Standard Diamond Packs', sectionEmoji.bonusDiamond||'💎', cats.bonusDiamond, game.currencyUnit, iconImages, cardBg, sectionImgs.bonusDiamond);
  const pureDiamondHtml  = renderSection('Sorted by Price', sectionEmoji.pureDiamond||'💰', cats.pureDiamond, game.currencyUnit, iconImages, cardBg, sectionImgs.pureDiamond);

  const customCSS = `<style>:root{--text:${escapeHtml(colors.heading)};--text-dim:${escapeHtml(colors.body)};--amber:${escapeHtml(colors.accent)};}</style>`;
  const header = renderSiteHeader({ profileImage, lang, t, settings: s, showChangeGame: true });
  const footer = renderSiteFooter({ profileImage, lang, t, settings: s });

  const body = `
${customCSS}${brandEffectCSS(s)}
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
${header}
<main>
<section class="section" style="padding-top:20px;">
<div class="wrap">

  <!-- Game header -->
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
    ${gameIconHtml}
    <div>
      <div style="font-size:18px;font-weight:700;color:var(--text);">${escapeHtml(game.name)}</div>
      <div style="font-size:13px;color:var(--text-dim);">${escapeHtml(game.currencyLabel)} Top-up</div>
    </div>
  </div>

  <!-- Step 1: Player Info -->
  <div class="section-head"><div class="section-eyebrow">ជំហាន ១</div><h2>${t(lang,'step_player')}</h2></div>
  <div class="order-panel" style="margin-bottom:24px;">
    <div class="form-row" id="playerRow">
      <div class="field">
        <label for="playerId">${t(lang,'label_player_id')}</label>
        <input type="text" id="playerId" name="playerId" placeholder="${t(lang,'hint_player_id')}" inputmode="numeric" autocomplete="off" style="font-size:16px;" />
        <div class="field-error" id="err-playerId"></div>
      </div>
      ${needsServer ? `
      <div class="field" id="serverIdWrap">
        <label for="serverId">${t(lang,'label_server_id')}</label>
        <input type="text" id="serverId" name="serverId" placeholder="${t(lang,'hint_server_id')}" inputmode="numeric" autocomplete="off" style="font-size:16px;" />
        <div class="field-error" id="err-serverId"></div>
      </div>` : ''}
    </div>
    <button type="button" class="btn btn-ghost" id="validateBtn" style="width:100%;margin-top:4px;">${t(lang,'btn_validate')}</button>
    <div id="playerCard" style="display:none;margin-top:12px;padding:12px 14px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:10px;font-size:14px;color:#22c55e;"></div>
  </div>

  <!-- Step 2: Packages -->
  <div class="section-head"><div class="section-eyebrow">ជំហាន ២</div><h2>${t(lang,'step_package')}</h2></div>
  <div id="gemGridContainer">
    ${passesHtml}${firsttopupHtml}${bonusDiamondHtml}${pureDiamondHtml}
    ${!packages.length ? '<p style="text-align:center;color:var(--text-dim);padding:32px 0;">មិនមានកញ្ចប់ណាមួយទេ</p>' : ''}
  </div>
  <div class="field-error" id="err-package" style="margin-bottom:16px;text-align:center;"></div>

  <!-- Sticky bar -->
  <div class="sticky-bar">
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px;">ជ្រើសរើសហើយ</div>
      <div id="summaryName" style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>
    </div>
    <div id="summaryPrice" style="font-size:18px;font-weight:700;color:var(--amber);white-space:nowrap;">$0.00</div>
    <button type="button" class="btn btn-primary" id="buyBtn" disabled style="min-width:110px;">${t(lang,'btn_buy')}</button>
  </div>

  <p style="text-align:center;font-size:12px;color:var(--text-dim);margin-top:80px;padding-bottom:8px;">
    <a href="/terms" style="color:var(--text-dim);">លក្ខខណ្ឌ & គោលការណ៍</a>
  </p>

</div>
</section>
</main>
${footer}

<!-- KHQR Payment Modal -->
<div id="khqrOverlay" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);align-items:flex-end;justify-content:center;">
<div id="khqrModal" style="width:100%;max-width:420px;background:var(--void);border-radius:20px 20px 0 0;overflow:hidden;animation:slideUp .3s ease;">
  <!-- Red header -->
  <div style="background:#E21F26;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;position:relative;">
    <div>
      <div style="font-size:28px;font-weight:900;letter-spacing:2px;color:#fff;">KHQR</div>
      <div style="font-size:12px;color:rgba(255,255,255,.8);">Wanfunzy</div>
    </div>
    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Flag_of_Cambodia.svg/60px-Flag_of_Cambodia.svg.png" style="height:28px;border-radius:3px;opacity:.9;" alt="KH" />
    <div style="position:absolute;bottom:0;right:0;width:40px;height:40px;background:var(--void);clip-path:polygon(100% 0,100% 100%,0 100%);"></div>
  </div>
  <!-- QR body -->
  <div style="padding:20px;text-align:center;">
    <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">ចំនួនទូទាត់</div>
    <div id="khqrAmount" style="font-size:28px;font-weight:900;color:#E21F26;margin-bottom:16px;">$0.00</div>
    <div style="border:2px dashed var(--line);border-radius:12px;padding:12px;display:inline-block;background:#fff;margin-bottom:12px;">
      <div id="qrCanvas" style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;">
        <div style="color:#999;font-size:12px;">Loading QR...</div>
      </div>
    </div>
    <div id="khqrCountdown" style="font-size:13px;color:var(--text-dim);margin-bottom:16px;"></div>
    <div style="border-top:1px dashed var(--line);padding-top:16px;">
      <button id="copyQrBtn" class="btn btn-ghost" style="width:100%;margin-bottom:10px;">📋 Copy QR String</button>
      <button id="cancelKhqrBtn" class="btn btn-ghost" style="width:100%;color:var(--text-dim);">✕ បោះបង់</button>
    </div>
  </div>
</div>
</div>

<!-- Success overlay -->
<div id="successOverlay" style="display:none;position:fixed;inset:0;z-index:10000;background:#0b0e14;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;">
  <svg width="80" height="80" viewBox="0 0 80 80" style="margin-bottom:20px;">
    <circle cx="40" cy="40" r="38" fill="none" stroke="#22c55e" stroke-width="3" stroke-dasharray="240" stroke-dashoffset="240" id="checkCircle" style="transition:stroke-dashoffset 0.6s ease;transform:rotate(-90deg);transform-origin:center;"/>
    <path d="M22 40L35 53L58 28" fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="60" stroke-dashoffset="60" id="checkMark" style="transition:stroke-dashoffset 0.4s ease 0.5s;"/>
  </svg>
  <h2 style="color:#22c55e;font-size:24px;margin:0 0 8px;">ទូទាត់ជោគជ័យ!</h2>
  <p style="color:var(--text-dim);margin:0 0 4px;">Diamond កំពុងបញ្ចូល...</p>
  <p id="successCode" style="color:var(--amber);font-size:18px;font-weight:700;margin:12px 0 0;font-family:monospace;"></p>
</div>

<style>
@keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
.sticky-bar { position:fixed;bottom:0;left:0;right:0;z-index:100;background:var(--void);border-top:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:12px;max-width:680px;margin:0 auto; }
.pkg-section .section-band { display:flex;align-items:center;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:10px 10px 0 0;border-bottom:1px solid var(--line); }
</style>

<script>
(function(){
'use strict';

var game = ${JSON.stringify({ id: game.id, name: game.name, requiresServerId: !!game.requiresServerId, currencyUnit: game.currencyUnit })};
var KHQR_AUTO = ${khqrAuto ? 'true' : 'false'};

var playerIdInput  = document.getElementById('playerId');
var serverIdInput  = document.getElementById('serverId');
var validateBtn    = document.getElementById('validateBtn');
var playerCard     = document.getElementById('playerCard');
var buyBtn         = document.getElementById('buyBtn');
var summaryName    = document.getElementById('summaryName');
var summaryPrice   = document.getElementById('summaryPrice');
var errPkg         = document.getElementById('err-package');
var gemContainer   = document.getElementById('gemGridContainer');
var khqrOverlay    = document.getElementById('khqrOverlay');
var khqrModal      = document.getElementById('khqrModal');
var khqrAmount     = document.getElementById('khqrAmount');
var qrCanvas       = document.getElementById('qrCanvas');
var khqrCountdown  = document.getElementById('khqrCountdown');
var copyQrBtn      = document.getElementById('copyQrBtn');
var cancelKhqrBtn  = document.getElementById('cancelKhqrBtn');
var successOverlay = document.getElementById('successOverlay');

var selectedPkgId  = null;
var selectedPrice  = 0;
var selectedName   = '';
var selectedMgId   = '';
var playerValidated= false;
var currentOrderCode = null;
var currentPayToken  = null;
var pollTimer = null;
var countdownTimer = null;
var submissionInFlight = false;
var cancellationToken = 0;

// Package selection
gemContainer.addEventListener('click', function(e) {
  var card = e.target.closest('.gem-card');
  if (!card) return;
  document.querySelectorAll('.gem-card').forEach(function(c){ c.classList.remove('selected'); });
  card.classList.add('selected');
  card.querySelector('input[type=radio]').checked = true;
  selectedPkgId  = card.dataset.packageId;
  selectedPrice  = parseFloat(card.dataset.price) || 0;
  selectedName   = card.dataset.name;
  selectedMgId   = card.dataset.moogoldId || '';
  summaryName.textContent = selectedName;
  summaryPrice.textContent = '$' + selectedPrice.toFixed(2);
  if (playerValidated) { buyBtn.disabled = false; }
  errPkg.textContent = '';
});

// Validate player
validateBtn.addEventListener('click', function() {
  var pid = (playerIdInput.value||'').trim();
  var sid = serverIdInput ? (serverIdInput.value||'').trim() : '';
  var errPid = document.getElementById('err-playerId');
  var errSid = document.getElementById('err-serverId');
  if (errPid) errPid.textContent = '';
  if (errSid) errSid.textContent = '';
  if (!/^[0-9]{4,20}$/.test(pid)) {
    if (errPid) errPid.textContent = '${t(lang,'err_player_id')}';
    return;
  }
  if (game.requiresServerId && !/^[0-9]{1,6}$/.test(sid)) {
    if (errSid) errSid.textContent = '${t(lang,'err_server_id')}';
    return;
  }
  validateBtn.disabled = true;
  validateBtn.textContent = 'កំពុងពិនិត្យ...';
  var qs = '?playerId=' + encodeURIComponent(pid) + (sid ? '&serverId=' + encodeURIComponent(sid) : '') + (selectedMgId ? '&moogoldProductId=' + encodeURIComponent(selectedMgId) : '');
  fetch('/api/topup/validate' + qs).then(function(r){ return r.json(); }).then(function(data) {
    validateBtn.disabled = false;
    validateBtn.textContent = '${t(lang,'btn_validate')}';
    if (data.ok === true) {
      playerCard.style.display = 'block';
      playerCard.innerHTML = '✓ ' + (data.username ? '<strong>' + data.username + '</strong>' : '${t(lang,'validated_ok')}');
      playerValidated = true;
      if (selectedPkgId) buyBtn.disabled = false;
    } else if (data.ok === null || data.skipped) {
      playerCard.style.display = 'block';
      playerCard.innerHTML = '${t(lang,'validated_skip')}';
      playerValidated = true;
      if (selectedPkgId) buyBtn.disabled = false;
    } else {
      playerCard.style.display = 'block';
      playerCard.style.background = 'rgba(239,68,68,.08)';
      playerCard.style.borderColor = 'rgba(239,68,68,.25)';
      playerCard.style.color = '#ef4444';
      playerCard.innerHTML = '⚠️ ' + (data.message || 'Player ID ឬ Zone ID មិនត្រឹមត្រូវ');
      playerValidated = false;
      buyBtn.disabled = true;
    }
  }).catch(function(){ validateBtn.disabled=false; validateBtn.textContent='${t(lang,'btn_validate')}'; });
});

// Buy button
buyBtn.addEventListener('click', function() {
  if (submissionInFlight) return;
  if (!playerValidated) { validateBtn.click(); return; }
  if (!selectedPkgId) { errPkg.textContent = '${t(lang,'err_no_package')}'; return; }
  startBuy();
});

function startBuy() {
  submissionInFlight = true;
  cancellationToken++;
  var myToken = cancellationToken;
  buyBtn.disabled = true;
  buyBtn.textContent = 'កំពុងដំណើរការ...';

  var pid = (playerIdInput.value||'').trim();
  var sid = serverIdInput ? (serverIdInput.value||'').trim() : '';

  fetch('/api/topup/orders', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      gameId: game.id, packageId: selectedPkgId,
      playerId: pid, serverId: sid,
      contact: '', note: '', slip: '', turnstileToken: ''
    })
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (myToken !== cancellationToken) return;
    buyBtn.disabled = false;
    buyBtn.textContent = '${t(lang,'btn_buy')}';
    submissionInFlight = false;
    if (!data.ok) { errPkg.textContent = (data.errors||[data.error||'Error']).join(' '); return; }
    currentOrderCode = data.order.code;
    currentPayToken  = data.order && data.order.payToken ? data.order.payToken : null;
    if (data.khqr && data.khqr.qr) {
      openKhqrModal(data.khqr, data.order.code);
    } else {
      window.location.href = '/order/confirmation?code=' + encodeURIComponent(data.order.code);
    }
  }).catch(function() {
    if (myToken !== cancellationToken) return;
    buyBtn.disabled = false;
    buyBtn.textContent = '${t(lang,'btn_buy')}';
    submissionInFlight = false;
    errPkg.textContent = 'Connection error — សូមព្យាយាមម្ដងទៀត';
  });
}

function openKhqrModal(khqr, orderCode) {
  khqrAmount.textContent = '$' + selectedPrice.toFixed(2);
  qrCanvas.innerHTML = '';
  khqrOverlay.style.display = 'flex';
  // Generate QR
  setTimeout(function() {
    if (typeof QRCode === 'undefined') { qrCanvas.innerHTML = '<p style="font-size:11px;word-break:break-all;color:#333;">' + khqr.qr + '</p>'; }
    else {
      try { new QRCode(qrCanvas, { text: khqr.qr, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); }
      catch(e) { qrCanvas.innerHTML = '<p style="font-size:11px;word-break:break-all;color:#333;">' + khqr.qr + '</p>'; }
    }
  }, 100);
  // Countdown
  if (khqr.expiresAt) {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(function() {
      var left = Math.max(0, Math.round((khqr.expiresAt - Date.now()) / 1000));
      var m = Math.floor(left/60), s = left%60;
      khqrCountdown.textContent = 'អស់សុពលភាពក្នុង: ' + m + ':' + (s<10?'0':'') + s;
      if (left <= 0) clearInterval(countdownTimer);
    }, 1000);
  }
  // Copy QR
  copyQrBtn.onclick = function() {
    navigator.clipboard && navigator.clipboard.writeText(khqr.qr).then(function(){ copyQrBtn.textContent = '✅ Copied!'; setTimeout(function(){ copyQrBtn.textContent='📋 Copy QR String'; },2000); });
  };
  // Start polling
  startPoll(orderCode);
}

function startPoll(orderCode) {
  var attempt = 0;
  var maxAttempts = 60;
  var gaps = [5000,5000,5000,8000,8000,10000,10000,15000,20000,30000];
  function poll() {
    if (!khqrOverlay.style.display || khqrOverlay.style.display === 'none') return;
    attempt++;
    fetch('/api/topup/orders/payment-status?code=' + encodeURIComponent(orderCode)).then(function(r){ return r.json(); }).then(function(d) {
      if (d.ok && d.status === 'paid') { closeModal(); showSuccess(orderCode); return; }
      if (d.ok && (d.status === 'expired' || d.status === 'cancelled')) { closeModal(); return; }
      if (attempt < maxAttempts) {
        var gap = gaps[Math.min(attempt-1, gaps.length-1)];
        pollTimer = setTimeout(poll, gap);
      }
    }).catch(function(){ if(attempt<maxAttempts){ pollTimer=setTimeout(poll,15000); } });
  }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, 5000);
}

function closeModal() {
  clearTimeout(pollTimer);
  clearInterval(countdownTimer);
  khqrOverlay.style.display = 'none';
  if (currentOrderCode && currentPayToken) {
    fetch('/api/topup/orders/cancel', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ orderCode: currentOrderCode, payToken: currentPayToken })
    }).catch(function(){});
    currentOrderCode = null;
    currentPayToken = null;
    cancellationToken++;
    submissionInFlight = false;
    buyBtn.disabled = false;
    buyBtn.textContent = '${t(lang,'btn_buy')}';
  }
}

cancelKhqrBtn.addEventListener('click', closeModal);
khqrOverlay.addEventListener('click', function(e){ if(e.target===khqrOverlay) closeModal(); });

function showSuccess(orderCode) {
  clearTimeout(pollTimer);
  clearInterval(countdownTimer);
  currentPayToken = null;
  successOverlay.style.display = 'flex';
  document.getElementById('successCode').textContent = orderCode;
  var circle = document.getElementById('checkCircle');
  var mark   = document.getElementById('checkMark');
  requestAnimationFrame(function(){ circle.style.strokeDashoffset='0'; mark.style.strokeDashoffset='0'; });
  if (navigator.vibrate) navigator.vibrate([100,50,200]);
  setTimeout(function(){ window.location.href = '/order/confirmation?code=' + encodeURIComponent(orderCode) + '&paid=1'; }, 2800);
}

})();
</script>`;

  return layout({ title: escapeHtml(game.name) + ' Top-up — Wanfunzy', body });
}

module.exports = { renderTopupPackage };
