'use strict';
const { layout, gameIcon, brandEffectCSS, renderSiteHeader, renderSiteFooter } = require('./layout');

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTopupSelect({ games, settings, lang }) {
  const s = settings || {};
  const profileImage = s.profileImage ? `/static/uploads/${encodeURIComponent(s.profileImage)}` : '/static/images/mascot.jpg';
  const { t } = require('./i18n');
  const header = renderSiteHeader({ profileImage, lang, t, settings: s, showChangeGame: false });
  const footer = renderSiteFooter({ profileImage, lang, t, settings: s });
  const gameLogos = s.gameLogos || {};

  const activeGames = (games || []).filter(g => g.active);
  const cardsHtml = activeGames.map(g => {
    const logoFile = gameLogos[g.id];
    const iconHtml = logoFile
      ? `<img src="/static/uploads/${escapeHtml(logoFile)}" alt="${escapeHtml(g.shortName)}" style="width:56px;height:56px;object-fit:contain;border-radius:12px;" />`
      : gameIcon(g.icon);
    return `
<a href="/topup/order?game=${encodeURIComponent(g.id)}" class="game-select-card">
  ${iconHtml}
  <div class="game-select-name">${escapeHtml(g.shortName)}</div>
  <div class="game-select-currency">${escapeHtml(g.currencyLabel)}</div>
</a>`;
  }).join('\n');

  const colors = s.colors || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const customCSS = `<style>:root{--text:${colors.heading};--text-dim:${colors.body};--amber:${colors.accent};}</style>`;

  const body = `
${customCSS}${brandEffectCSS(s)}
${header}
<main>
<section class="section" style="padding-top:48px;padding-bottom:48px;">
<div class="wrap" style="max-width:600px;">
  <div class="section-head" style="text-align:center;margin-bottom:32px;">
    <div class="section-eyebrow">Top-up Center</div>
    <h2>ជ្រើសរើស Game</h2>
    <p style="color:var(--text-dim);font-size:14px;margin:8px 0 0;">ចុចលើ Game ដែលអ្នកចង់ Top-up</p>
  </div>
  <div class="game-select-grid">
    ${cardsHtml || '<p style="text-align:center;color:var(--text-dim);">មិនមាន Game ដែល active ទេ</p>'}
  </div>
</div>
</section>
</main>
${footer}`;
  return layout({ title: 'ជ្រើសរើស Game — Wanfunzy', body });
}

module.exports = { renderTopupSelect };
