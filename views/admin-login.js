// views/admin-login.js — Owner sign-in page.

const { layout, ICONS } = require('./layout');

function renderAdminLogin({ error }) {
  const body = `
  <div class="login-shell">
    <div class="login-card">
      <div class="logo" style="margin-bottom:24px;justify-content:center;">
        <img src="/static/images/mascot.jpg" alt="Wanfunzy" class="logo-mascot" style="width:48px;height:48px;"/><span class="brand-name">Wanfunzy</span>
      </div>
      <h2 style="margin:0 0 4px;font-size:20px;text-align:center;">Owner Sign-in</h2>
      <p style="color:var(--text-dim);font-size:13px;text-align:center;margin:0 0 24px;">
        សម្រាប់គ្រប់គ្រង Orders និងកញ្ចប់ពេជ្យ
      </p>

      ${error ? `<div class="alert alert-error">${error}</div>` : ''}

      <form method="POST" action="/admin/login">
        <div class="field">
          <label for="username">ឈ្មោះអ្នកប្រើ</label>
          <input type="text" id="username" name="username" required autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label for="password">ពាក្យសម្ងាត់</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-full">ចូលប្រើ</button>
      </form>

      <a href="/" style="display:block;text-align:center;margin-top:20px;font-size:13px;color:var(--text-faint);">← ត្រឡប់ទំព័រដើម</a>
    </div>
  </div>`;

  return layout({ title: 'Owner Sign-in — Wanfunzy', body });
}

module.exports = { renderAdminLogin };
