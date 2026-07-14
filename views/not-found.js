'use strict';
const { layout } = require('./layout');

function renderNotFound() {
  const body = `
<div style="min-height:80vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;">
  <div style="font-size:64px;margin-bottom:16px;">💎</div>
  <h1 style="font-size:48px;margin:0;color:var(--amber);">404</h1>
  <p style="color:var(--text-dim);margin:12px 0 24px;font-size:16px;">ទំព័រនេះមិនមានទេ</p>
  <a href="/topup" class="btn btn-primary">← ត្រលប់ទៅទំព័រដើម</a>
</div>`;
  return layout({ title: '404 — Wanfunzy', body });
}

module.exports = { renderNotFound };
