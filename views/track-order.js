// views/track-order.js — customer-facing order status lookup by code.

const { layout, ICONS } = require('./layout');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STATUS_LABEL = {
  pending: { text: 'កំពុងរង់ចាំផ្ទៀងផ្ទាត់', cls: 'badge-pending' },
  confirmed: { text: 'បានបញ្ជាក់ — កំពុងបញ្ចូល', cls: 'badge-confirmed' },
  delivered: { text: 'បានបញ្ចូលរួចរាល់', cls: 'badge-delivered' },
  rejected: { text: 'ត្រូវបានបដិសេធ', cls: 'badge-rejected' }
};

function renderTrackOrder({ order, searched }) {
  let resultHtml = '';

  if (searched && !order) {
    resultHtml = `
    <div class="confirm-card" style="margin-top:32px;">
      ${ICONS.search404}
      <h3 style="margin:8px 0 4px;">រកមិនឃើញ Order</h3>
      <p style="color:var(--text-dim);font-size:14px;">សូមពិនិត្យ Order Code របស់អ្នកម្តងទៀត</p>
    </div>`;
  } else if (order) {
    const status = STATUS_LABEL[order.status] || STATUS_LABEL.pending;
    const serverPart = order.serverId ? ` (Server ${escapeHtml(order.serverId)})` : '';
    resultHtml = `
    <div class="order-panel" style="margin-top:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div class="confirm-code" style="margin:0;font-size:18px;padding:8px 14px;">${escapeHtml(order.code)}</div>
        <span class="badge ${status.cls}">${status.text}</span>
      </div>
      <ul class="confirm-steps" style="margin:0;">
        <li>🎮 Game: <strong>${escapeHtml(order.gameName || '—')}</strong></li>
        <li>📦 កញ្ចប់: <strong>${escapeHtml(order.packageName)}</strong> — $${order.price.toFixed(2)}</li>
        <li>🆔 Player ID: <span class="mono">${escapeHtml(order.playerId)}</span>${serverPart}</li>
        <li>🕐 បានដាក់: ${new Date(order.createdAt).toLocaleString('km-KH')}</li>
      </ul>
    </div>`;
  }

  const body = `
  <header class="site-header">
    <div class="wrap">
      <a href="/" class="logo"><img src="/static/images/mascot.jpg" alt="Wanfunzy" class="logo-mascot" /><span class="brand-name">Wanfunzy</span></a>
      <nav class="nav-links"><a href="/">ត្រឡប់ទំព័រដើម</a></nav>
    </div>
  </header>

  <main>
    <div class="wrap" style="max-width:600px;padding-top:48px;">
      <div class="section-head" style="text-align:center;">
        <div class="section-eyebrow" style="text-align:center;">Order Tracking</div>
        <h2>តាមដាន Order របស់អ្នក</h2>
      </div>

      <form method="GET" action="/track" class="order-panel" style="display:flex;gap:10px;">
        <input type="text" name="code" placeholder="ឧ. WF-A1B2C3D4" value="${order ? escapeHtml(order.code) : ''}"
          style="flex:1;background:var(--void);border:1px solid var(--line);border-radius:6px;padding:12px 14px;font-family:var(--font-mono);" />
        <button type="submit" class="btn btn-primary">ស្វែងរក</button>
      </form>

      ${resultHtml}
    </div>
  </main>`;

  return layout({ title: 'តាមដាន Order — Wanfunzy', body });
}

module.exports = { renderTrackOrder };
