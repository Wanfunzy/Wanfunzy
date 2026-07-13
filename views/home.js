// views/home.js — public storefront. Game selector + package grid + order form.
const { layout, ICONS, gameIcon, brandEffectCSS } = require('./layout');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGameTab(game, isFirst, customLogoFilename) {
  const iconHtml = customLogoFilename
    ? `<img src="/static/uploads/${escapeHtml(customLogoFilename)}" alt="${escapeHtml(game.shortName)}" class="game-icon game-icon-custom" />`
    : gameIcon(game.icon);

  return `
<button class="game-tab${isFirst ? ' active' : ''}" data-game-id="${game.id}" data-requires-server="${game.requiresServerId}">
${iconHtml}
<span class="game-tab-name">${escapeHtml(game.shortName)}</span>
<span class="game-tab-label">${escapeHtml(game.currencyLabel)}</span>
</button>`;
}

function renderGemCard(pkg, currencyUnit) {
  const bonusText = pkg.bonus > 0 ? `+${pkg.bonus} Bonus` : (pkg.special ? '&nbsp;' : '');
  const amountLabel = pkg.special
    ? pkg.name
    : `${pkg.amount.toLocaleString()} ${currencyUnit}`;
  const bonusClass = pkg.bonus > 0 ? ' has-bonus' : '';

  return `
<label class="gem-card${bonusClass}" data-package-id="${pkg.id}" data-game-id="${pkg.gameId}" data-price="${pkg.price}" data-name="${escapeHtml(pkg.name)}">
<input type="radio" name="packageId" value="${pkg.id}" />
${ICONS.diamond}
<div class="gem-amount">${amountLabel}</div>
<div class="gem-bonus">${bonusText}</div>
<div class="gem-price">$${pkg.price.toFixed(2)}</div>
</label>`;
}

function renderHome({ games, packages, settings }) {
  const activeGames = games.filter((g) => g.active);
  const colors = (settings && settings.colors) || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const gameLogos = (settings && settings.gameLogos) || {};
  const profileImage = settings && settings.profileImage
    ? `/static/uploads/${encodeURIComponent(settings.profileImage)}`
    : '/static/images/mascot.jpg';
  const coverImage = settings && settings.coverImage
    ? `/static/uploads/${encodeURIComponent(settings.coverImage)}`
    : null;

  const tabsHtml = activeGames.map((g, i) => renderGameTab(g, i === 0, gameLogos[g.id])).join('\n');

  const cardsHtml = activeGames.map((game) => {
    const gamePackages = packages.filter((p) => p.gameId === game.id && p.active);
    const cards = gamePackages.map((p) => renderGemCard(p, game.currencyUnit)).join('\n');
    return `<div class="gem-grid-panel" data-game-id="${game.id}" style="display:${game === activeGames[0] ? 'grid' : 'none'};">
${cards}
</div>`;
  }).join('\n');

  const gamesJson = JSON.stringify(activeGames.map((g) => ({
    id: g.id,
    name: g.name,
    requiresServerId: g.requiresServerId,
    currencyLabel: g.currencyLabel
  })));

  const coverStyle = coverImage
    ? `background-image: linear-gradient(180deg, rgba(11,14,20,0.55), rgba(11,14,20,0.92)), url('${coverImage}'); background-size: cover; background-position: center;`
    : '';

  const customColorStyle = `
<style>
:root {
--text: ${escapeHtml(colors.heading)};
--text-dim: ${escapeHtml(colors.body)};
--amber: ${escapeHtml(colors.accent)};
}
</style>` + brandEffectCSS(settings);

  const body = `
${customColorStyle}
<header class="site-header">
<div class="wrap">
<a href="/" class="logo">
<img src="${profileImage}" alt="Wanfunzy" class="logo-mascot" />
<span class="brand-name">Wanfunzy</span>
</a>
<nav class="nav-links">
<a href="https://t.me/wanfunzy" target="_blank" rel="noopener">📞 ទាក់ទង Telegram</a>
</nav>
</div>
</header>
<main>
<section class="hero" style="${coverStyle}">
<div class="hero-bg-fx" aria-hidden="true">
<svg class="circuit-bg" viewBox="0 0 1200 600" xmlns="http://www.w3.org/2000/svg">
<g stroke="#3DB8FF" stroke-width="1" fill="none" opacity="0.18">
<path d="M0 80 H180 L210 110 H400"/>
<path d="M0 200 H120 L150 230 H320 L350 200 H600"/>
<path d="M1200 60 H1000 L970 90 H800"/>
<path d="M1200 180 H1050 L1020 150 H880"/>
<path d="M1200 320 H980 L950 350 H760"/>
<path d="M0 400 H200 L230 430 H500"/>
</g>
<g fill="#FFD24D" opacity="0.5">
<circle cx="210" cy="110" r="3"/>
<circle cx="350" cy="200" r="3"/>
<circle cx="970" cy="90" r="3"/>
<circle cx="1020" cy="150" r="3"/>
<circle cx="950" cy="350" r="3"/>
<circle cx="230" cy="430" r="3"/>
</g>
</svg>
</div>
<div class="wrap hero-grid">
<div>
<div class="hero-eyebrow">Top-up Center</div>
<h1><span class="accent">សុវត្ថិភាព</span> ១០០%</h1>
<p class="lead">ជ្រើសរើស Game ដែលអ្នកលេង ជ្រើសរើសកញ្ចប់ បញ្ចូល Player ID ហើយដាក់ Order — Owner នឹងផ្ទៀងផ្ទាត់ និងបញ្ចូលអោយក្នុងពេលឆាប់បំផុត។</p>
<div class="hero-stats">
<div class="hero-stat">
<div class="num">50K+</div>
</div>
<div class="hero-stat">
<div class="num">~15</div>
</div>
<div class="hero-stat">
<div class="num">100%</div>
</div>
</div>
</div>
<div class="hero-visual">
<div class="hero-mascot-glow"></div>
<img src="${profileImage}" alt="Wanfunzy mascot" class="hero-mascot" />
</div>
</div>
</section>
<section class="section" id="packages">
<div class="wrap">
<div class="section-head">
<div class="section-eyebrow">Step 01</div>
<h2>ជ្រើសរើស Game</h2>
</div>
<div class="game-tabs" id="gameTabs">
${tabsHtml}
</div>
<div class="section-head" style="margin-top:36px;">
<div class="section-eyebrow">Step 02</div>
<h2>ជ្រើសរើសកញ្ចប់</h2>
</div>
<div id="gemGridContainer">
${cardsHtml}
</div>
</div>
</section>
<section class="section" id="order-form">
<div class="wrap">
<div class="section-head">
<div class="section-eyebrow">Step 03</div>
<h2>បំពេញព័ត៌មានគណនី</h2>
</div>
<div class="order-panel">
<form id="orderForm" novalidate>
<div class="hp-field" aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;">
<label for="website">Website</label>
<input type="text" id="website" name="website" tabindex="-1" autocomplete="off" />
</div>
<div class="form-row" id="formRow">
<div class="field">
<label for="playerId">Player ID</label>
<input type="text" id="playerId" name="playerId" placeholder="ឧ. 123456789" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-playerId"></div>
</div>
<div class="field" id="serverIdField">
<label for="serverId">Server ID</label>
<input type="text" id="serverId" name="serverId" placeholder="ឧ. 2001" inputmode="numeric" autocomplete="off" />
<div class="field-error" id="err-serverId"></div>
</div>
</div>
<div class="field">
<label for="contact">លេខទូរស័ព្ទ ឬ Telegram (សម្រាប់ទាក់ទងវិញ)</label>
<input type="text" id="contact" name="contact" placeholder="ឧ. 0961234567 ឬ @username" autocomplete="off" />
<div class="field-error" id="err-contact"></div>
</div>
<div class="field">
<label for="note">កំណត់ចំណាំ (មិនទាមទារ)</label>
<textarea id="note" name="note" rows="2" placeholder="ព័ត៌មានបន្ថែម..."></textarea>
</div>
<div class="order-summary">
<div>
<div class="label">Game + កញ្ចប់ដែលបានជ្រើស</div>
<div id="summaryName" style="font-size:14px;margin-top:2px;color:var(--text-faint)">មិនទាន់ជ្រើសរើស</div>
</div>
<div class="value" id="summaryPrice">$0.00</div>
</div>
<div class="field-error show" id="err-package" style="margin-bottom:16px;"></div>
<button type="submit" class="btn btn-primary btn-full" id="submitBtn">
ដាក់ Order
</button>
<p class="hint" style="text-align:center;margin-top:12px;">
ការទូទាត់ត្រូវធ្វើឡើងតាមការណែនាំក្រោយពេលដាក់ Order។ Owner នឹងទាក់ទងអ្នកវិញដើម្បីបញ្ជាក់។
</p>
</form>
</div>
</div>
</section>
</main>
<footer class="site-footer">
<div class="wrap">
<span>© ${new Date().getFullYear()} Wanfunzy. មិនមានទំនាក់ទំនងផ្លូវការជាមួយក្រុមហ៊ុនបង្កើត game ណាមួយឡើយ។</span>
<a href="https://t.me/wanfunzy" target="_blank" rel="noopener" style="color:var(--text-dim);">📞 ទាក់ទងតាម Telegram →</a>
</div>
</footer>
<script>
(function () {
const GAMES = ${gamesJson};
const gameTabs = document.getElementById('gameTabs');
const gridContainer = document.getElementById('gemGridContainer');
const form = document.getElementById('orderForm');
const summaryName = document.getElementById('summaryName');
const summaryPrice = document.getElementById('summaryPrice');
const submitBtn = document.getElementById('submitBtn');
const serverIdField = document.getElementById('serverIdField');
const serverIdInput = document.getElementById('serverId');
let selectedGameId = GAMES.length ? GAMES[0].id : null;
let selectedPackageId = null;

function getGame(id) { return GAMES.find(g => g.id === id); }

function updateServerIdVisibility() {
const game = getGame(selectedGameId);
if (game && game.requiresServerId) {
serverIdField.style.display = '';
} else {
serverIdField.style.display = 'none';
}
}

function resetSelection() {
selectedPackageId = null;
summaryName.textContent = 'មិនទាន់ជ្រើសរើស';
summaryPrice.textContent = '$0.00';
}

gameTabs.addEventListener('click', function (e) {
const tab = e.target.closest('.game-tab');
if (!tab) return;
document.querySelectorAll('.game-tab').forEach(t => t.classList.remove('active'));
tab.classList.add('active');
selectedGameId = tab.dataset.gameId;
document.querySelectorAll('.gem-grid-panel').forEach(panel => {
panel.style.display = (panel.dataset.gameId === selectedGameId) ? 'grid' : 'none';
});
updateServerIdVisibility();
resetSelection();
clearError('package');
});

gridContainer.addEventListener('click', function (e) {
const card = e.target.closest('.gem-card');
if (!card) return;
document.querySelectorAll('.gem-card').forEach(c => c.classList.remove('selected'));
card.classList.add('selected');
card.querySelector('input[type=radio]').checked = true;
selectedPackageId = card.dataset.packageId;
const game = getGame(card.dataset.gameId);
summaryName.textContent = (game ? game.name + ' — ' : '') + card.dataset.name;
summaryPrice.textContent = '$' + parseFloat(card.dataset.price).toFixed(2);
clearError('package');
});

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

function clearAllErrors() {
['playerId', 'serverId', 'contact', 'package'].forEach(clearError);
}

updateServerIdVisibility();

form.addEventListener('submit', async function (e) {
e.preventDefault();
clearAllErrors();

const playerId = document.getElementById('playerId').value.trim();
const game = getGame(selectedGameId);
const needsServerId = game && game.requiresServerId;
const serverId = needsServerId ? serverIdInput.value.trim() : '';
const contact = document.getElementById('contact').value.trim();
const note = document.getElementById('note').value.trim();
const website = document.getElementById('website').value;

let hasError = false;

if (!/^[0-9]{4,20}$/.test(playerId)) {
showError('playerId', 'Player ID ត្រូវតែជាលេខ (4-20 ខ្ទង់)');
hasError = true;
}

if (needsServerId && !/^[0-9]{1,6}$/.test(serverId)) {
showError('serverId', 'Server ID មិនត្រឹមត្រូវ');
hasError = true;
}

if (contact.length < 5) {
showError('contact', 'សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Telegram');
hasError = true;
}

if (!selectedPackageId) {
document.getElementById('err-package').textContent = 'សូមជ្រើសរើសកញ្ចប់សិន';
document.getElementById('err-package').classList.add('show');
hasError = true;
}

if (hasError) return;

submitBtn.disabled = true;
submitBtn.textContent = 'កំពុងដាក់ Order...';

try {
const res = await fetch('/api/orders', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ playerId, serverId, contact, note, packageId: selectedPackageId, gameId: selectedGameId, website })
});
const data = await res.json();
if (!res.ok || !data.ok) {
(data.errors || [data.error || 'មានបញ្ហាកើតឡើង']).forEach(msg => {
document.getElementById('err-package').textContent = msg;
document.getElementById('err-package').classList.add('show');
});
submitBtn.disabled = false;
submitBtn.textContent = 'ដាក់ Order';
return;
}
window.location.href = '/order/confirmation?code=' + encodeURIComponent(data.order.code);
} catch (err) {
document.getElementById('err-package').textContent = 'មិនអាចភ្ជាប់ទៅ server បានទេ។ សូមព្យាយាមម្តងទៀត។';
document.getElementById('err-package').classList.add('show');
submitBtn.disabled = false;
submitBtn.textContent = 'ដាក់ Order';
}
});
})();
</script>`;

  return layout({ title: 'Wanfunzy — Top-up Game ល្បីៗ', body });
}

module.exports = { renderHome };
