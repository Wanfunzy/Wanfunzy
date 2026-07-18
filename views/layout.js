// views/layout.js — shared HTML shell + small inline SVG icons used across pages.

// Starfield + shooting-star background, injected once here so every page
// (home, topup, admin, etc.) gets it automatically without each view
// needing to remember to add it. Pure CSS/HTML — no images, no JS, so it
// costs nothing on slow connections and never fails to load.
const STARFIELD_HTML = `
<div class="sp-starfield" aria-hidden="true">
<div class="sp-stars sp-stars-far"></div>
<div class="sp-stars sp-stars-near"></div>
<div class="sp-shooting-star" style="top:8%; left:75%; animation-delay:0.5s;"></div>
<div class="sp-shooting-star" style="top:18%; left:40%; animation-delay:4.5s;"></div>
<div class="sp-shooting-star" style="top:4%; left:92%; animation-delay:8.5s;"></div>
<div class="sp-shooting-star" style="top:30%; left:15%; animation-delay:12.5s;"></div>
</div>`;

function layout({ title, body, head = '' }) {
  return `<!DOCTYPE html>
<html lang="km">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>${title}</title>
<link rel="icon" type="image/x-icon" href="/static/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/static/favicon-192x192.png">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
<link rel="stylesheet" href="/static/styles.css" />
<!-- Fonts loaded non-render-blocking: the stylesheet is fetched as a
     low-priority "print" sheet then flipped to "all" once ready, so the
     page paints immediately with system fonts and swaps in the web fonts
     when they arrive (instead of blocking first paint on a slow network).
     Trimmed to only the weights actually used to shrink the download. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&family=Inter:wght@400;600;700&family=Noto+Sans+Khmer:wght@400;600;700&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&family=Inter:wght@400;600;700&family=Noto+Sans+Khmer:wght@400;600;700&display=swap"></noscript>
<style>
body, .hero p.lead, .field label, .nav-links, .site-footer {
font-family: 'Inter', 'Noto Sans Khmer', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
h1, h2, h3, .logo, .gem-amount, .order-summary .value, .confirm-code, .hero-stat .num {
font-family: 'Rajdhani', 'Noto Sans Khmer', -apple-system, sans-serif;
}
/* Fallback brand-name styling — used only if a page doesn't inject
   brandEffectCSS() below (e.g. before an admin picks a setting). Pages
   that call brandEffectCSS() output a <style> later in the document,
   which wins on equal specificity by source order. */
.brand-name { font-weight: 700; }
</style>
  ${head}
</head>
<body>
${STARFIELD_HTML}
<div class="sp-page-content">
${body}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------
// brandEffectCSS(settings) — generates the CSS for the "Wanfunzy" brand
// name text effect and (optionally) the safety-badge shimmer effect,
// driven entirely by admin-configurable settings:
//   settings.brandNameEffect      'none' | 'glow' | 'glow-sweep' |
//                                 'glow-rays' | 'glow-zoom' |
//                                 'fantasy-gold' | 'fantasy-gold-zoom'
//   settings.safetyBadgeEffect    'none' | 'shimmer' | 'glow-zoom' |
//                                 'fantasy-gold' | 'fantasy-gold-zoom'
//   settings.brandTextAnimEnabled boolean — master on/off for the text
//   settings.brandTextAnimSpeed   'slow' | 'normal' | 'fast'
//   settings.brandGlowColor1/2    hex colors (defaults: gold / blue)
//
// Pages call this and drop the result inside their own <style> block
// (alongside the existing Heading/Body/Accent color variables), so the
// exact same effect renders identically on every page.
// ---------------------------------------------------------------------
function speedToSeconds(speed) {
  if (speed === 'slow') return '6s';
  if (speed === 'fast') return '2.2s';
  return '4s';
}

function brandEffectCSS(settings) {
  const s = settings || {};
  const effect = s.brandNameEffect || 'none';
  const safetyEffect = s.safetyBadgeEffect || 'none';
  const enabled = s.brandTextAnimEnabled !== false;
  const dur = speedToSeconds(s.brandTextAnimSpeed);
  const c1 = s.brandGlowColor1 || '#FFD700'; // gold
  const c2 = s.brandGlowColor2 || '#3DB8FF'; // blue
  const anim = enabled ? `${dur} ease-in-out infinite` : 'none';

  let brandCSS = '';
  if (effect === 'none') {
    brandCSS = `.brand-name { color: var(--text); background: none; }`;
  } else if (effect === 'glow') {
    brandCSS = `.brand-name { color: ${c1}; text-shadow: 0 0 10px ${c1}99, 0 0 22px ${c2}66; }`;
  } else if (effect === 'glow-rays') {
    brandCSS = `.brand-name { color: ${c1}; text-shadow: 0 0 8px ${c1}, 0 0 18px ${c2}, 0 0 32px ${c2}88; }`;
  } else if (effect === 'glow-zoom') {
    brandCSS = `
.brand-name { color: ${c1}; text-shadow: 0 0 10px ${c1}aa, 0 0 22px ${c2}77; display: inline-block; animation: brandZoomPulse ${anim}; }
@keyframes brandZoomPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }`;
  } else if (effect === 'glow-sweep') {
    brandCSS = `
.brand-name {
  background-image: linear-gradient(100deg, ${c1} 0%, #FFFFFF 45%, ${c2} 55%, ${c1} 100%);
  background-size: 260% auto;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  text-shadow: 0 0 14px ${c2}55;
  animation: brandSweep ${anim};
}
@keyframes brandSweep { 0% { background-position: 220% center; } 100% { background-position: -220% center; } }`;
  } else {
    // 'fantasy-gold' and 'fantasy-gold-zoom' — the gold-to-blue "fantasy"
    // lettering with a light-sweep pass through it, similar to a wipe/
    // slide transition (as opposed to a simple back-and-forth glow).
    const zoomPart = effect === 'fantasy-gold-zoom' ? `, brandZoomPulse ${anim}` : '';
    brandCSS = `
.brand-name {
  background-image:
    linear-gradient(100deg, transparent 42%, rgba(255,255,255,0.95) 50%, transparent 58%),
    linear-gradient(90deg, #B8860B 0%, ${c1} 18%, #FFF6C8 32%, ${c2} 48%, #FFF6C8 64%, ${c1} 82%, #B8860B 100%);
  background-size: 250% 100%, 100% 100%;
  background-position: -150% 0, 0 0;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  text-shadow: 0 0 14px ${c2}55, 0 0 26px ${c1}33;
  font-weight: 700;
  display: inline-block;
  animation: brandWipeSweep ${anim}${zoomPart};
}
@keyframes brandWipeSweep { 0% { background-position: -150% 0, 0 0; } 100% { background-position: 250% 0, 0 0; } }
@keyframes brandZoomPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }`;
  }

  let safetyCSS = '';
  if (safetyEffect === 'shimmer') {
    safetyCSS = `
.safety-badge-effect {
  background-image: linear-gradient(100deg, ${c1} 0%, #FFFFFF 50%, ${c1} 100%);
  background-size: 220% auto;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  animation: safetyShimmer ${anim};
}
@keyframes safetyShimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }`;
  } else if (safetyEffect === 'glow-zoom') {
    safetyCSS = `.safety-badge-effect { color: ${c1}; text-shadow: 0 0 10px ${c1}aa; display:inline-block; animation: brandZoomPulse ${anim}; }`;
  } else if (safetyEffect === 'fantasy-gold' || safetyEffect === 'fantasy-gold-zoom') {
    const zoomPart = safetyEffect === 'fantasy-gold-zoom' ? `, brandZoomPulse ${anim}` : '';
    safetyCSS = `
.safety-badge-effect {
  background-image: linear-gradient(90deg, #B8860B 0%, ${c1} 25%, #FFF6C8 50%, ${c2} 75%, #B8860B 100%);
  background-size: 220% auto;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  animation: brandWipeSweep ${anim}${zoomPart};
}`;
  } else {
    safetyCSS = `.safety-badge-effect { color: var(--text); background: none; }`;
  }

  return `<style>
${brandCSS}
${safetyCSS}
@media (prefers-reduced-motion: reduce) {
  .brand-name, .safety-badge-effect { animation: none !important; }
}
</style>`;
}

const ICONS = {
  diamond: `<svg class="diamond-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6 12L16 4L26 12L16 28L6 12Z" fill="url(#diamondGrad)" stroke="#FFB84D" stroke-width="1"/>
<path d="M6 12H26M11 12L16 4L21 12M11 12L16 28M21 12L16 28" stroke="#0B0E14" stroke-width="0.8" stroke-opacity="0.4"/>
<defs>
<linearGradient id="diamondGrad" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
<stop stop-color="#FFD68A"/>
<stop offset="1" stop-color="#FFB84D"/>
</linearGradient>
</defs>
</svg>`,
  logoMark: `<svg class="mark" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5 11L14 3L23 11L14 25L5 11Z" fill="url(#logoGrad)"/>
<defs>
<linearGradient id="logoGrad" x1="5" y1="3" x2="23" y2="25" gradientUnits="userSpaceOnUse">
<stop stop-color="#9B7FFF"/>
<stop offset="1" stop-color="#FFB84D"/>
</linearGradient>
</defs>
</svg>`,
  check: `<svg class="confirm-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="32" cy="32" r="30" stroke="#3DDC97" stroke-width="2.5"/>
<path d="M20 33L27 40L44 23" stroke="#3DDC97" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
  empty: `<svg class="empty-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M9 18L24 8L39 18L24 40L9 18Z" stroke="#5C6478" stroke-width="2"/>
</svg>`,
  search404: `<svg class="confirm-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="28" cy="28" r="16" stroke="#5C6478" stroke-width="2.5"/>
<path d="M40 40L52 52" stroke="#5C6478" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,
  // Game icons — original symbolic marks (not official logos/trademarks).
  game_mlbb: `<svg class="game-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="10" fill="url(#mlbbBg)"/>
<path d="M13 27L24 11M24 11L27 8M24 11L29 16M13 27L9 25M13 27L15 32" stroke="#E8EBF5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="27" cy="8" r="1.6" fill="#E8EBF5"/>
<defs>
<linearGradient id="mlbbBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
<stop stop-color="#5B3FCB"/>
<stop offset="1" stop-color="#2A1F66"/>
</linearGradient>
</defs>
</svg>`,
  game_freefire: `<svg class="game-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="10" fill="url(#ffBg)"/>
<path d="M20 9C20 9 14 15 14 21C14 25.4 16.7 28.5 20 28.5C23.3 28.5 26 25.4 26 21C26 19.5 25.4 17.8 24.5 16.3C24.3 18 23.3 19 22.2 19C22.6 17 21.8 13.5 20 9Z" fill="#FFE8D6"/>
<path d="M20 14C20 14 17 18 17 21.5C17 23.8 18.3 25.5 20 25.5C21.7 25.5 23 23.8 23 21.5C23 20.6 22.7 19.7 22.2 18.9C22.1 19.8 21.5 20.3 20.9 20.2C21.1 18.8 20.7 16.5 20 14Z" fill="#FF7A30"/>
<defs>
<linearGradient id="ffBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
<stop stop-color="#FF8A3D"/>
<stop offset="1" stop-color="#C2410C"/>
</linearGradient>
</defs>
</svg>`,
  game_pubgm: `<svg class="game-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="10" fill="url(#pgBg)"/>
<circle cx="20" cy="20" r="9" stroke="#EFE9DD" stroke-width="2"/>
<circle cx="20" cy="20" r="1.8" fill="#EFE9DD"/>
<path d="M20 9V14M20 26V31M9 20H14M26 20H31" stroke="#EFE9DD" stroke-width="2" stroke-linecap="round"/>
<defs>
<linearGradient id="pgBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
<stop stop-color="#8A7A52"/>
<stop offset="1" stop-color="#4A4023"/>
</linearGradient>
</defs>
</svg>`,
  game_hok: `<svg class="game-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="10" fill="url(#hokBg)"/>
<path d="M11 17L14 12L20 16L26 12L29 17L27 26H13L11 17Z" fill="#FFE9B8" stroke="#7A1F1F" stroke-width="0.6"/>
<circle cx="20" cy="21" r="2" fill="#C0203A"/>
<defs>
<linearGradient id="hokBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
<stop stop-color="#E0A93B"/>
<stop offset="1" stop-color="#8C5A12"/>
</linearGradient>
</defs>
</svg>`
};

function gameIcon(iconKey) {
  return ICONS['game_' + iconKey] || ICONS.diamond;
}

// ---------------------------------------------------------------------
// renderSiteHeader(opts) — the shared compact top bar used on every
// public page: logo + brand name, a slide-out hamburger menu (Home /
// Top Up / Track / Contact / Terms), a language switcher (EN / ខ្មែរ),
// and admin-configurable social icons (Facebook / YouTube / Telegram /
// TikTok). Social URLs come from settings.socialLinks.* and optional custom
// icons from settings.socialIcons.* — only links the admin filled in show.
// opts: { profileImage, lang, t (translator fn), settings, showChangeGame }
// ---------------------------------------------------------------------
function renderSiteHeader({ profileImage, lang, t, settings, showChangeGame }) {
  if (typeof t !== 'function') { t = (l, key) => key; }
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const social = (settings && settings.socialLinks) || {};
  const socialIcons = (settings && settings.socialIcons) || {};
  const otherLang = lang === 'km' ? 'en' : 'km';
  const otherLangLabel = otherLang === 'km' ? 'ខ្មែរ' : 'EN';

  const socialDefs = [
    { key: 'facebook', emoji: '📘', label: 'Facebook' },
    { key: 'youtube', emoji: '▶️', label: 'YouTube' },
    { key: 'telegram', emoji: '✈️', label: 'Telegram' },
    { key: 'tiktok', emoji: '🎵', label: 'TikTok' }
  ];
  const socialHtml = socialDefs
    .filter((s) => social[s.key] && String(social[s.key]).trim())
    .map((s) => {
      const iconImg = socialIcons[s.key];
      const inner = iconImg
        ? `<img src="/static/uploads/${esc(iconImg)}" class="social-icon-img" alt="${s.label}" />`
        : s.emoji;
      return `<a href="${esc(social[s.key])}" target="_blank" rel="noopener" class="social-icon-link" title="${s.label}">${inner}</a>`;
    })
    .join('\n');

  const changeGameLink = showChangeGame
    ? `<a href="/topup" class="menu-link">${t(lang, 'nav_change_game')}</a>`
    : '';

  return `
<header class="site-header site-header-compact">
<div class="wrap">
<button class="hamburger-btn" id="hamburgerBtn" aria-label="Menu">
<span></span><span></span><span></span>
</button>
<a href="/topup" class="logo">
<img src="${profileImage}" alt="Wanfunzy" class="logo-mascot" />
<span class="brand-name">Wanfunzy</span>
</a>
<div class="header-right">
${socialHtml ? `<div class="nav-links-social">${socialHtml}</div>` : ''}
<button class="lang-switch" id="langSwitch" data-target="${otherLang}">${otherLangLabel}</button>
</div>
</div>
</header>
<div class="menu-overlay" id="menuOverlay"></div>
<nav class="menu-drawer" id="menuDrawer">
<div class="menu-drawer-head">
<img src="${profileImage}" alt="Wanfunzy" class="logo-mascot" />
<span class="brand-name" style="font-size:20px;">Wanfunzy</span>
<button class="menu-close" id="menuClose" aria-label="Close">✕</button>
</div>
<a href="/topup" class="menu-link">${t(lang, 'nav_home')}</a>
${changeGameLink}
<a href="https://t.me/wanfunzy" target="_blank" rel="noopener" class="menu-link">${t(lang, 'nav_contact')}</a>
${socialHtml ? `<div class="menu-social">${socialHtml}</div>` : ''}
</nav>
<script>
(function () {
  var btn = document.getElementById('hamburgerBtn');
  var drawer = document.getElementById('menuDrawer');
  var overlay = document.getElementById('menuOverlay');
  var closeBtn = document.getElementById('menuClose');
  function open() { drawer.classList.add('open'); overlay.classList.add('open'); }
  function close() { drawer.classList.remove('open'); overlay.classList.remove('open'); }
  if (btn) btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (overlay) overlay.addEventListener('click', close);
  var lang = document.getElementById('langSwitch');
  if (lang) lang.addEventListener('click', function () {
    var target = lang.dataset.target;
    document.cookie = 'lang=' + target + ';path=/;max-age=31536000';
    location.reload();
  });
})();
</script>`;
}

// renderSiteFooter(opts) — shared footer: brand logo + copyright, social
// icons, a "We accept KHQR" badge (shown only once the admin has uploaded
// a KHQR image), and a subtle "Powered by Wanfunzy" line. Mirrors the
// clean footer style of comparable top-up sites.
function renderSiteFooter({ profileImage, lang, t, settings }) {
  if (typeof t !== 'function') { t = (l, key) => key; }
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const social = (settings && settings.socialLinks) || {};
  const socialIcons = (settings && settings.socialIcons) || {};
  const hasKhqr = !!(settings && settings.khqrImage);

  const socialDefs = [
    { key: 'facebook', emoji: '📘', label: 'Facebook' },
    { key: 'youtube', emoji: '▶️', label: 'YouTube' },
    { key: 'telegram', emoji: '✈️', label: 'Telegram' },
    { key: 'tiktok', emoji: '🎵', label: 'TikTok' }
  ];
  const socialHtml = socialDefs
    .filter((s) => social[s.key] && String(social[s.key]).trim())
    .map((s) => {
      const iconImg = socialIcons[s.key];
      const inner = iconImg
        ? `<img src="/static/uploads/${esc(iconImg)}" class="social-icon-img" alt="${s.label}" />`
        : s.emoji;
      return `<a href="${esc(social[s.key])}" target="_blank" rel="noopener" class="footer-social-link" title="${s.label}">${inner} <span>${s.label}</span></a>`;
    })
    .join('\n');

  const year = new Date().getFullYear();

  return `
<footer class="site-footer site-footer-rich" style="padding-bottom:110px;">
<div class="wrap footer-inner">
<img src="${profileImage}" alt="Wanfunzy" class="footer-logo" />
${socialHtml ? `<div class="footer-social">${socialHtml}</div>` : ''}
<div class="footer-copy">© ${year} <span class="footer-brand">Wanfunzy</span>. All rights reserved.</div>
${hasKhqr ? `<div class="footer-accept">We accept: <span class="footer-khqr-badge">KHQR</span></div>` : ''}
<div class="footer-devby">Web developer by <span class="footer-brand">Wanfunzy</span></div>
</div>
</footer>`;
}

module.exports = { layout, ICONS, gameIcon, brandEffectCSS, renderSiteHeader, renderSiteFooter };
