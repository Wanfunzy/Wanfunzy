'use strict';
const { layout } = require('./layout');

function renderAdminLogin({ error, csrf } = {}) {
  const body = `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--void);padding:24px;">
<div style="width:100%;max-width:380px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:32px;margin-bottom:8px;">💎</div>
    <h1 style="font-size:22px;margin:0;color:var(--text);">Wanfunzy Admin</h1>
    <p style="color:var(--text-dim);margin:6px 0 0;font-size:14px;">Owner Login</p>
  </div>
  <div class="order-panel">
    ${error ? `<div style="background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#ef4444;font-size:14px;">⚠️ ${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <input type="hidden" name="csrf" value="${csrf || ''}" />
      <div class="field">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" autocomplete="username" autofocus />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" />
      </div>
      <button type="submit" class="btn btn-primary btn-full" style="margin-top:8px;">Login →</button>
    </form>
  </div>
</div>
</div>`;
  return layout({ title: 'Admin Login — Wanfunzy', body });
}

module.exports = { renderAdminLogin };
