'use strict';
const { layout, renderSiteHeader, renderSiteFooter, brandEffectCSS } = require('./layout');

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderOrderConfirmation({ order, paid }) {
  const profileImage = '/static/images/mascot.jpg';
  const header = renderSiteHeader({ profileImage, lang: 'km', t: (l,k)=>k, settings: {}, showChangeGame: false });
  const footer = renderSiteFooter({ profileImage, lang: 'km', t: (l,k)=>k, settings: {} });

  const isPaid = paid || order.paymentStatus === 'paid';
  const isDelivered = order.status === 'delivered';

  const statusSection = isPaid ? `
<div style="text-align:center;padding:28px 0 16px;">
  <div style="font-size:56px;margin-bottom:8px;">${isDelivered ? '🎮' : '✅'}</div>
  <h2 style="color:#22c55e;margin:0 0 4px;">${isDelivered ? 'Diamond បានបញ្ចូលរួចរាល់!' : 'ទូទាត់ជោគជ័យ!'}</h2>
  <p style="color:var(--text-dim);font-size:14px;margin:0;">${isDelivered ? 'Diamonds ត្រូវបានបញ្ចូលក្នុងគណនីរបស់អ្នកហើយ!' : 'Diamond កំពុងបញ្ចូល... រង់ចាំបន្តិច'}</p>
</div>` : `
<div style="text-align:center;padding:28px 0 16px;">
  <div style="font-size:56px;margin-bottom:8px;">🔖</div>
  <h2 style="color:var(--amber);margin:0 0 4px;">Order ត្រូវបានទទួល!</h2>
  <p style="color:var(--text-dim);font-size:14px;margin:0;">Owner នឹងទូរស័ព្ទទំនាក់ទំនងវិញក្នុងពេលឆាប់</p>
</div>`;

  const body = `
${brandEffectCSS({})}
${header}
<main>
<section class="section" style="padding-top:32px;">
<div class="wrap" style="max-width:480px;">
  ${statusSection}
  <div class="order-panel">
    <div class="order-summary" style="margin-bottom:0;">
      <div>
        <div class="label" style="margin-bottom:6px;">Order Code</div>
        <div class="mono confirm-code" style="font-size:20px;color:var(--amber);">${escapeHtml(order.code)}</div>
      </div>
      <div class="value">$${order.price.toFixed(2)}</div>
    </div>
    <div style="display:grid;gap:8px;font-size:13px;color:var(--text-dim);margin-top:16px;padding-top:16px;border-top:1px solid var(--line);">
      <div>🎮 Game: <span style="color:var(--text);">${escapeHtml(order.gameName || '—')}</span></div>
      <div>📦 កញ្ចប់: <span style="color:var(--text);">${escapeHtml(order.packageName)}</span></div>
      <div>🆔 Player ID: <span class="mono" style="color:var(--text);">${escapeHtml(order.playerId)}${order.serverId ? ` (Server ${escapeHtml(order.serverId)})` : ''}</span></div>
      <div>📅 ថ្ងៃ: <span style="color:var(--text);">${new Date(order.createdAt).toLocaleString('km-KH')}</span></div>
    </div>
  </div>
  <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
    <a href="/track?code=${encodeURIComponent(order.code)}" class="btn btn-ghost" style="flex:1;text-align:center;">🔍 តាមដាន Order</a>
    <a href="/topup" class="btn btn-primary" style="flex:1;text-align:center;">🛒 ទិញបន្ត</a>
  </div>
</div>
</section>
</main>
${footer}`;
  return layout({ title: 'Order ' + order.code + ' — Wanfunzy', body });
}

module.exports = { renderOrderConfirmation };
