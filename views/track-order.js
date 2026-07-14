'use strict';
const { layout, renderSiteHeader, renderSiteFooter, brandEffectCSS } = require('./layout');

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const STATUS_KH = {
  pending: '⏳ រង់ចាំ', confirmed: '✅ បានបញ្ជាក់',
  delivered: '🎮 Diamond បានបញ្ចូល', rejected: '❌ បានបដិសេធ',
  cancelled: '🚫 បានបោះបង់'
};

function renderTrackOrder({ order, searched }) {
  const profileImage = '/static/images/mascot.jpg';
  const header = renderSiteHeader({ profileImage, lang: 'km', t: (l, k) => k, settings: {}, showChangeGame: false });
  const footer = renderSiteFooter({ profileImage, lang: 'km', t: (l, k) => k, settings: {} });

  let resultHtml = '';
  if (searched && !order) {
    resultHtml = `<div style="text-align:center;padding:32px;color:var(--text-dim);">🔍 រកមិនឃើញ Order។ សូម check Code ម្ដងទៀត។</div>`;
  } else if (order) {
    const st = STATUS_KH[order.status] || order.status;
    resultHtml = `
<div class="order-panel" style="margin-top:24px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <span class="mono" style="font-size:18px;font-weight:700;color:var(--amber);">${escapeHtml(order.code)}</span>
    <span style="font-size:14px;font-weight:600;">${st}</span>
  </div>
  <div style="display:grid;gap:8px;font-size:14px;color:var(--text-dim);">
    <div>🎮 Game: <span style="color:var(--text);">${escapeHtml(order.gameName || '—')}</span></div>
    <div>📦 កញ្ចប់: <span style="color:var(--text);">${escapeHtml(order.packageName)} — $${order.price.toFixed(2)}</span></div>
    <div>🆔 Player ID: <span class="mono" style="color:var(--text);">${escapeHtml(order.playerId)}${order.serverId ? ` (Server ${escapeHtml(order.serverId)})` : ''}</span></div>
    <div>📅 ថ្ងៃ: <span style="color:var(--text);">${new Date(order.createdAt).toLocaleString('km-KH')}</span></div>
    ${order.note ? `<div>📝 ចំណាំ: <span style="color:var(--text);">${escapeHtml(order.note)}</span></div>` : ''}
  </div>
</div>`;
  }

  const body = `
${brandEffectCSS({})}
${header}
<main>
<section class="section" style="padding-top:40px;">
<div class="wrap" style="max-width:480px;">
  <div class="section-head">
    <div class="section-eyebrow">Track</div>
    <h2>តាមដាន Order</h2>
  </div>
  <form method="GET" action="/track">
    <div class="field">
      <label for="code">Order Code</label>
      <input type="text" id="code" name="code" placeholder="ឧ. WF-XXXXXXXX" style="text-transform:uppercase;" />
    </div>
    <button type="submit" class="btn btn-primary btn-full">🔍 ស្វែងរក</button>
  </form>
  ${resultHtml}
</div>
</section>
</main>
${footer}`;
  return layout({ title: 'តាមដាន Order — Wanfunzy', body });
}

module.exports = { renderTrackOrder };
