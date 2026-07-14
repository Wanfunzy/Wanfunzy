// views/not-found.js

const { layout, ICONS } = require('./layout');

function renderNotFound() {
  const body = `
  <header class="site-header">
    <div class="wrap">
      <a href="/" class="logo"><img src="/static/images/mascot.jpg" alt="Wanfunzy" class="logo-mascot" /><span class="brand-name">Wanfunzy</span></a>
    </div>
  </header>
  <main>
    <div class="wrap">
      <div class="confirm-card">
        ${ICONS.search404}
        <h2 style="margin:8px 0 4px;">404 — រកមិនឃើញទំព័រនេះទេ</h2>
        <p style="color:var(--text-dim);font-size:14px;">ទំព័រដែលអ្នកស្វែងរកប្រហែលជាត្រូវផ្លាស់ប្តូរ ឬមិនមានទៀតហើយ</p>
        <a href="/" class="btn btn-primary" style="margin-top:16px;">ត្រឡប់ទំព័រដើម</a>
      </div>
    </div>
  </main>`;
  return layout({ title: '404 — Wanfunzy', body });
}

module.exports = { renderNotFound };
