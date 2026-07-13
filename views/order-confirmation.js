// views/order-confirmation.js — shown right after an order is placed.

const { layout, ICONS } = require('./layout');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderOrderConfirmation({ order, paid = false }) {
  const serverPart = order.serverId ? ` (Server ${escapeHtml(order.serverId)})` : '';
  const body = `
  <header class="site-header">
    <div class="wrap">
      <a href="/" class="logo"><img src="/static/images/mascot.jpg" alt="Wanfunzy" class="logo-mascot" /><span class="brand-name">Wanfunzy</span></a>
      <nav class="nav-links">
        <a href="https://t.me/wanfunzy" target="_blank" rel="noopener">📞 ទាក់ទង Telegram</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="wrap">
      <div class="confirm-card">
        ${ICONS.check}
        <h2 style="margin:0 0 8px;">${paid ? '✅ ទូទាត់ជោគជ័យ!' : 'Order ត្រូវបានទទួល!'}</h2>
        <p style="color:var(--text-dim);font-size:14px;margin:0;">
          ${paid ? 'Diamond កំពុងបញ្ចូលទៅ Account របស់អ្នក។ សូមរង់ចាំបន្តិច!' : 'សូមរក្សាទុក Order Code ខាងក្រោម ហើយទាក់ទងតាម Telegram ដើម្បីទូទាត់ប្រាក់'}
        </p>
        <div class="confirm-code">${escapeHtml(order.code)}</div>

        <ul class="confirm-steps">
          <li>🎮 Game: <strong>${escapeHtml(order.gameName || '—')}</strong></li>
          <li>📦 កញ្ចប់: <strong>${escapeHtml(order.packageName)}</strong> — $${order.price.toFixed(2)}</li>
          <li>🆔 Player ID: <span class="mono">${escapeHtml(order.playerId)}</span>${serverPart}</li>
          <li>📞 ទំនាក់ទំនង: ${escapeHtml(order.contact)}</li>

        </ul>

        <a href="https://t.me/wanfunzy" target="_blank" rel="noopener" class="btn btn-primary btn-full">📞 ទាក់ទងភ្លាមៗតាម Telegram</a>
        <a href="/" class="btn btn-ghost btn-full" style="margin-top:10px;">ត្រឡប់ទំព័រដើម</a>
      </div>
    </div>
  </main>`;

  return layout({ title: `Order ${order.code} — Wanfunzy`, body });
}

module.exports = { renderOrderConfirmation };
