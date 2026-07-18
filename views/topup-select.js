// views/topup-select.js — Landing page (game picker). Big game-card grid
// with full-frame logos, compact shared header (menu + language + social),
// and a minimal "Top Up" heading.

const { layout, ICONS, brandEffectCSS, renderSiteHeader, renderSiteFooter, hexToRgba } = require('./layout');
const _i18n = require('./i18n');
const t = (typeof _i18n.t === 'function') ? _i18n.t : function (l, key) { return key; };

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderGameCard(game, customLogoFilename) {
  const artHtml = customLogoFilename
    ? `<img src="/static/uploads/${escapeHtml(customLogoFilename)}" alt="${escapeHtml(game.shortName)}" class="topup-tile-logo-lg" loading="lazy" decoding="async" />`
    : `<div class="topup-tile-logo-lg-empty">${ICONS.empty}</div>`;

  // MLBB uses new standalone checkout page
  const isMlbb = game.id === 'mlbb' || (game.name || '').toLowerCase().includes('mobile legend');
  const href = isMlbb ? '/mlbb' : `/topup/order?game=${encodeURIComponent(game.id)}`;

  return `
<a href="${href}" class="topup-tile-card">
<div class="topup-tile-card-art">${artHtml}</div>
<div class="topup-tile-card-body">
<div class="topup-tile-card-name">${escapeHtml(game.shortName)}</div>
<span class="topup-tile-card-btn">${escapeHtml(game.currencyLabel)}</span>
</div>
</a>`;
}

function renderTopupSelect({ games, settings, lang = 'en' }) {
  const activeGames = games.filter((g) => g.active);
  const colors = (settings && settings.colors) || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const gameLogos = (settings && settings.gameLogos) || {};
  const profileImage = settings && settings.profileImage
    ? `/static/uploads/${encodeURIComponent(settings.profileImage)}`
    : '/static/images/mascot.jpg';
  const coverImages = (settings && settings.coverImages) || [];
  const coverImage = settings && settings.coverImage ? settings.coverImage : null;
  const coverVideo = settings && settings.coverVideo ? settings.coverVideo : null;

  // Same optional Fill/Stroke/Shadow "frame" override used on the per-game
  // /topup banner — reused here so admin only has ONE set of Frame color
  // controls that affects both the landing-page Cover Carousel and the
  // per-game banner consistently.
  const frameFillLine   = colors.frameFill   ? `--frame-fill: ${escapeHtml(colors.frameFill)};`     : '';
  const frameStrokeLine = colors.frameStroke ? `--frame-stroke: ${escapeHtml(colors.frameStroke)};` : '';
  const frameShadowLine = colors.frameShadow ? `--frame-shadow: ${hexToRgba(colors.frameShadow, colors.frameShadowOpacity)};` : '';

  const customColorStyle = `
<style>
:root {
--text: ${escapeHtml(colors.heading)};
--text-dim: ${escapeHtml(colors.body)};
--amber: ${escapeHtml(colors.accent)};
${frameFillLine}
${frameStrokeLine}
${frameShadowLine}
}
</style>` + brandEffectCSS(settings);

  const header = renderSiteHeader({ profileImage, lang, t, settings, showChangeGame: false });

  const tilesHtml = activeGames.map((g) => renderGameCard(g, gameLogos[g.id])).join('\n');

  const carouselHtml = coverVideo
    ? `
<div class="cover-carousel cover-carousel-video-wrap">
<video class="cover-carousel-video" autoplay muted loop playsinline src="/static/uploads/${escapeHtml(coverVideo)}"></video>
<div class="cover-carousel-video-overlay"></div>
</div>`
    : (coverImages.length
      ? `
<div class="cover-carousel" id="coverCarousel">
${coverImages.map((img, i) => `<div class="cover-slide${i === 0 ? ' active' : ''}" style="background-image: linear-gradient(180deg, rgba(11,14,20,0.35), rgba(11,14,20,0.85)), url('/static/uploads/${escapeHtml(img)}');"></div>`).join('\n')}
${coverImages.length > 1 ? `<div class="cover-dots">${coverImages.map((_, i) => `<span class="cover-dot${i === 0 ? ' active' : ''}" data-index="${i}"></span>`).join('')}</div>` : ''}
</div>`
      : (coverImage
        ? `
<div class="cover-carousel">
<div class="cover-slide active" style="background-image: linear-gradient(180deg, rgba(11,14,20,0.35), rgba(11,14,20,0.85)), url('/static/uploads/${escapeHtml(coverImage)}');"></div>
</div>`
        : ''));

  const body = `
${customColorStyle}
${header}
${carouselHtml}
<main>
<section class="section" style="padding-top:28px;">
<div class="wrap">
<div class="section-head" style="text-align:center;margin-bottom:20px;">
<h2 style="font-size:28px;">${t(lang, 'landing_heading')}</h2>
</div>
<div class="topup-card-grid">
${tilesHtml}
</div>
</div>
</section>
</main>
${renderSiteFooter({ profileImage, lang, t, settings })}
${(!coverVideo && coverImages.length > 1) ? `
<script>
(function () {
const slides = document.querySelectorAll('#coverCarousel .cover-slide');
const dots = document.querySelectorAll('#coverCarousel .cover-dot');
let current = 0;
function showSlide(i) {
slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
current = i;
}
dots.forEach((dot) => { dot.addEventListener('click', () => showSlide(parseInt(dot.dataset.index, 10))); });
setInterval(() => { showSlide((current + 1) % slides.length); }, 4000);
})();
</script>` : ''}`;

  return layout({ title: 'Top Up — Wanfunzy', body });
}

module.exports = { renderTopupSelect };
