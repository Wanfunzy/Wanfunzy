// views/admin-dashboard.js — Owner-only control panel: orders + per-game package catalog.
const { layout, ICONS, gameIcon } = require('./layout');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const STATUS_LABEL = {
  pending: { text: 'រង់ចាំ', cls: 'badge-pending' },
  confirmed: { text: 'បានបញ្ជាក់', cls: 'badge-confirmed' },
  delivered: { text: 'បានបញ្ចូល', cls: 'badge-delivered' },
  rejected: { text: 'បានបដិសេធ', cls: 'badge-rejected' }
};

function renderOrderRow(order, filter) {
  const status = STATUS_LABEL[order.status] || STATUS_LABEL.pending;
  const serverLine = order.serverId ? `<div style="color:var(--text-faint);font-size:12px;">Server ${escapeHtml(order.serverId)}</div>` : '';
  const gameNameLine = order.gameName ? `<div style="color:var(--accent);font-size:11px;margin-top:2px;">🎮 ${escapeHtml(order.gameName)}</div>` : '';
  const isDeletedView = filter === 'deleted';
  // Deleted view: Restore + permanent-delete side by side.
  // Active view: status dropdown + soft-delete trash button.
  const actionCell = isDeletedView
    ? `<div style="display:flex;gap:6px;align-items:center;">
<button class="btn btn-sm btn-ghost" data-action="restore-order" data-order-id="${order.id}">↩️ ស្តារវិញ</button>
<button class="btn btn-sm btn-danger" data-action="hard-delete-order" data-order-id="${order.id}" title="លុបជាអចិន្ត្រៃយ៍" style="padding:6px 8px;">🗑️</button>
</div>`
    : `<div style="display:flex;gap:6px;align-items:center;">
<select class="status-select" data-order-id="${order.id}" style="background:var(--void);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12px;">
<option value="pending" ${order.status === 'pending' ? 'selected' : ''}>រង់ចាំ</option>
<option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>បញ្ជាក់</option>
<option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>បានបញ្ចូល</option>
<option value="rejected" ${order.status === 'rejected' ? 'selected' : ''}>បដិសេធ</option>
</select>
<button class="btn btn-sm btn-danger" data-action="delete-order" data-order-id="${order.id}" title="លុប Order នេះ" style="padding:6px 8px;">🗑️</button>
</div>`;
  // Checkbox is shown on both views so bulk actions work for either
  // soft delete (active tabs) or permanent delete (deleted tab).
  const checkboxCell = `<td style="width:32px;"><input type="checkbox" class="order-check" data-order-id="${order.id}" /></td>`;
  return `
<tr data-order-id="${order.id}">
${checkboxCell}
<td class="mono">${escapeHtml(order.code)}</td>
<td>${escapeHtml(order.gameName || '—')}</td>
<td>
<div class="mono">${escapeHtml(order.playerId)}</div>
      ${serverLine}
      ${gameNameLine}
</td>
<td>${escapeHtml(order.packageName)}</td>
<td class="mono">$${order.price.toFixed(2)}</td>
<td>${escapeHtml(order.contact)}${order.paymentSlip ? ` <a href="/static/uploads/${escapeHtml(order.paymentSlip)}" target="_blank" rel="noopener" style="display:block;margin-top:4px;font-size:11px;color:var(--amber);">📎 មើលស្លីប</a>` : ''}</td>
<td><span class="badge ${status.cls}" data-status-badge>${status.text}</span></td>
<td style="color:var(--text-faint);font-size:12px;">${new Date(order.createdAt).toLocaleString('km-KH', { dateStyle: 'short', timeStyle: 'short' })}</td>
<td>${actionCell}</td>
</tr>`;
}

function renderPackageRow(pkg, packageIconImages) {
  const iconFile = (packageIconImages || {})[pkg.id];
  const iconPreview = iconFile ? `/static/uploads/${iconFile}` : null;
  return `
<div class="pkg-row" data-package-id="${pkg.id}">
<label class="pkg-icon-upload" title="Upload រូបភាព icon" style="width:36px;height:36px;border-radius:8px;overflow:hidden;flex-shrink:0;cursor:pointer;border:1px dashed var(--line);display:flex;align-items:center;justify-content:center;background:var(--void);position:relative;">
  ${iconPreview ? `<img src="${iconPreview}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />` : `<span style="font-size:18px;color:var(--text-faint);">+</span>`}
  <input type="file" accept="image/jpeg,image/png,image/webp" class="pkg-icon-input" data-package-id="${pkg.id}" style="position:absolute;inset:0;opacity:0;cursor:pointer;" />
</label>
<input type="text" class="pkg-name" value="${escapeHtml(pkg.name)}" />
<input type="number" class="pkg-amount" value="${pkg.amount}" min="0" placeholder="Amount" />
<input type="number" class="pkg-bonus" value="${pkg.bonus}" min="0" placeholder="Bonus" />
<input type="number" class="pkg-price" value="${pkg.price}" min="0" step="0.01" placeholder="Price USD" />
<input type="text" class="pkg-moogold-id" value="${escapeHtml(String(pkg.moogoldProductId || ''))}" placeholder="MooGold ID" title="MooGold variation_id" style="width:110px;font-size:12px;" />
<input type="text" class="pkg-badge" value="${escapeHtml(String(pkg.badge || ''))}" placeholder="Badge (ស្រេចចិត្ត)" title="Highlight ribbon shown on card, e.g. +5 ពិន្ទុ, ក្តៅ🔥" maxlength="20" style="width:110px;font-size:12px;" />
<button class="toggle ${pkg.active ? 'on' : ''}" data-action="toggle-active" title="Active/Inactive"></button>
<button class="btn btn-sm btn-danger" data-action="delete-package">លុប</button>
</div>`;
}

// Categorise packages the same way both /mlbb and /api/mlbb-packages do
// (in server.js and views/topup-package.js) so what the admin sees here
// matches exactly what customers see on the storefront.
//   passes       — Special Passes & Packs
//   firsttopup   — First Top-Up Bonuses
//   bonusDiamond — Standard Diamond Packs (has a bonus)
//   pureDiamond  — Sorted by Price (no bonus)
function categorisePackages(pkgs) {
  const isPassOrPack    = (p) => /pass|pack|value|twilight|weekly|super|limited/i.test(p.name || '');
  const isFirstTopup    = (p) => /first|1st/i.test(p.name || '') && !isPassOrPack(p);
  const hasDiamondBonus = (p) => !isPassOrPack(p) && !isFirstTopup(p) && Number(p.bonus) > 0;
  const isPureDiamond   = (p) => !isPassOrPack(p) && !isFirstTopup(p) && !(Number(p.bonus) > 0);

  // Explicit .category tag (set via admin "+ Add" button) always wins over
  // the regex/bonus guess below — prevents a freshly-added $0 package from
  // being mis-filed into the wrong section.
  const byCategory = (key) => (p) => p.category
    ? p.category === key
    : (key === 'passes' ? isPassOrPack(p)
      : key === 'firsttopup' ? isFirstTopup(p)
      : key === 'bonusDiamond' ? hasDiamondBonus(p)
      : isPureDiamond(p));

  // Sort by price ascending, same as storefront — but packages with no
  // price yet (just added, price<=0) always sort last so they don't jump
  // to the top the instant they're created.
  function sortByPriceDraftsLast(a, b) {
    const pa = Number(a.price) || 0, pb = Number(b.price) || 0;
    const aDraft = pa <= 0, bDraft = pb <= 0;
    if (aDraft && !bDraft) return 1;
    if (!aDraft && bDraft) return -1;
    if (aDraft && bDraft) return 0;
    return pa - pb;
  }

  const passes       = pkgs.filter(byCategory('passes')).sort(sortByPriceDraftsLast);
  const firsttopup   = pkgs.filter(byCategory('firsttopup')).sort(sortByPriceDraftsLast);
  const bonusDiamond = pkgs.filter(byCategory('bonusDiamond')).sort(sortByPriceDraftsLast);
  const pureDiamond  = pkgs.filter(byCategory('pureDiamond')).sort(sortByPriceDraftsLast);
  return { passes, firsttopup, bonusDiamond, pureDiamond };
}

// Renders one categorised package group (title + column headers + rows +
// Add button). The Add button carries data-category so the click handler
// can pre-fill a name that lands the new package in this same group.
function renderPackageGroup(game, title, categoryKey, groupPkgs, addButtonLabel, packageIconImages) {
  const rowsHtml = groupPkgs.length
    ? groupPkgs.map(p => renderPackageRow(p, packageIconImages)).join('')
    : `<div class="pkg-empty" style="padding:14px 16px;font-size:12px;color:var(--text-faint);text-align:center;">មិន​មាន​កញ្ចប់​ក្នុង​ផ្នែក​នេះ​ទេ — ចុច "${escapeHtml(addButtonLabel)}" ដើម្បី​បន្ថែម</div>`;
  return `
<div class="pkg-group" data-category="${categoryKey}" style="margin-top:14px;">
<div class="pkg-group-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:0 4px;">
<h4 style="margin:0;font-size:13px;font-weight:700;color:var(--text);letter-spacing:.3px;">${escapeHtml(title)}</h4>
<button class="btn btn-primary btn-sm add-package-btn" data-game-id="${game.id}" data-category="${categoryKey}" style="font-size:12px;padding:6px 12px;">+ ${escapeHtml(addButtonLabel)}</button>
</div>
<div class="order-panel" style="margin-top:0;padding:0;">
<div class="pkg-row" style="font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.5px;">
<div>ឈ្មោះ</div><div>Amount</div><div>Bonus</div><div>តម្លៃ (USD)</div><div>Badge</div><div>សកម្ម</div><div></div>
</div>
<div class="package-list" data-game-id="${game.id}" data-category="${categoryKey}">${rowsHtml}</div>
</div>
</div>`;
}

function renderUploadBox({ label, hint, previewSrc, uploadEndpoint, deleteEndpoint, inputId, shape }) {
  const shapeClass = shape === 'round' ? 'upload-preview-round' : 'upload-preview-wide';
  const previewHtml = previewSrc
    ? `<img src="${previewSrc}" class="upload-preview ${shapeClass}" alt="${escapeHtml(label)}" />`
    : `<div class="upload-preview upload-preview-empty ${shapeClass}">គ្មានរូបភាព</div>`;
  return `
<div class="upload-box" data-upload-endpoint="${uploadEndpoint}" data-delete-endpoint="${deleteEndpoint || ''}">
<div class="upload-box-label">${escapeHtml(label)}</div>
    ${hint ? `<div class="upload-box-hint">${escapeHtml(hint)}</div>` : ''}
<div class="upload-box-body">
      ${previewHtml}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="${inputId}" style="cursor:pointer;">ជ្រើសរើសរូបភាព</label>
<input type="file" id="${inputId}" class="upload-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
        ${previewSrc && deleteEndpoint ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុបរូបភាព</button>` : ''}
</div>
</div>
</div>`;
}

function renderGameSection(game, packages, gameLogos, cardBackgrounds, sectionImages, packageIconImages) {
  const gamePackages = packages.filter((p) => p.gameId === game.id);
  const customLogo = gameLogos[game.id];
  const logoPreview = customLogo ? `/static/uploads/${customLogo}` : null;
  const customCardBg = (cardBackgrounds || {})[game.id];
  const cardBgPreview = customCardBg ? `/static/uploads/${customCardBg}` : null;
  const secImgs = (sectionImages || {})[game.id] || {};

  function renderSectionBox(sectionKey, sectionLabel) {
    const img = secImgs[sectionKey];
    const imgPreview = img ? `/static/uploads/${img}` : null;
    const inputId = `sectionImgInput-${sectionKey}-${game.id}`;
    return `
<div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px;">
<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;font-weight:600;">${escapeHtml(sectionLabel)}</div>
<div class="upload-box upload-box-inline" data-upload-endpoint="/api/admin/settings/section-image/${sectionKey}/${game.id}" data-delete-endpoint="/api/admin/settings/section-image/${sectionKey}/${game.id}">
<div class="upload-box-body">
  ${imgPreview ? `<img src="${imgPreview}" class="upload-preview upload-preview-wide" style="height:52px;" />` : `<div class="upload-preview upload-preview-empty upload-preview-wide" style="height:52px;">គ្មានរូបភាព</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="${inputId}" style="cursor:pointer;">${imgPreview ? 'ប្តូររូបភាព' : 'Upload រូបភាព'}</label>
<input type="file" id="${inputId}" class="upload-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
  ${imgPreview ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុបរូបភាព</button>` : ''}
</div>
</div>
</div>
</div>`;
  }

  const groups = categorisePackages(gamePackages);
  return `
<div class="game-pkg-section" data-game-id="${game.id}">
<div class="game-pkg-header">
  ${customLogo ? `<img src="${logoPreview}" class="game-icon game-icon-custom" alt="${escapeHtml(game.shortName)}" />` : gameIcon(game.icon)}
<div>
<div class="game-pkg-title">${escapeHtml(game.name)}</div>
<div class="game-pkg-sub">${escapeHtml(game.currencyLabel)} ${game.requiresServerId ? '· ត្រូវការ Server ID' : '· Player ID ប៉ុណ្ណោះ'}</div>
</div>
</div>
<div class="upload-box upload-box-inline" data-upload-endpoint="/api/admin/settings/game-logo/${game.id}" data-delete-endpoint="/api/admin/settings/game-logo/${game.id}">
<div class="upload-box-body">
  ${logoPreview ? `<img src="${logoPreview}" class="upload-preview upload-preview-round" alt="logo" />` : `<div class="upload-preview upload-preview-empty upload-preview-round">Logo</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="gameLogoInput-${game.id}" style="cursor:pointer;">ប្តូរ Logo Game នេះ</label>
<input type="file" id="gameLogoInput-${game.id}" class="upload-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
  ${logoPreview ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុប Logo</button>` : ''}
</div>
</div>
</div>
<div class="upload-box upload-box-inline" data-upload-endpoint="/api/admin/settings/card-background/${game.id}" data-delete-endpoint="/api/admin/settings/card-background/${game.id}" data-allow-video="true" style="margin-bottom:18px;">
<div class="upload-box-label" style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Background Banner ទំព័រ Top-up (រូបភាព ឬ វីដេអូខ្លីៗ)</div>
<div class="upload-box-body">
  ${cardBgPreview ? (/\.(mp4|webm)$/i.test(cardBgPreview) ? `<video src="${cardBgPreview}" class="upload-preview upload-preview-wide" style="height:60px;object-fit:cover;" autoplay muted loop playsinline></video>` : `<img src="${cardBgPreview}" class="upload-preview upload-preview-wide" style="height:60px;" />`) : `<div class="upload-preview upload-preview-empty upload-preview-wide" style="height:60px;">គ្មានរូបភាព</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="cardBgInput-${game.id}" style="cursor:pointer;">${cardBgPreview ? 'ប្តូររូបភាព/វីដេអូ' : 'Upload Background'}</label>
<input type="file" id="cardBgInput-${game.id}" class="upload-input" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" style="display:none;" />
  ${cardBgPreview ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុបរូបភាព</button>` : ''}
</div>
</div>
</div>
<div style="font-size:12px;color:var(--text-dim);font-weight:700;margin:16px 0 10px;">រូបភាព ដាច់ដោយឡែក សម្រាប់ ៤ ផ្នែក (Section Image):</div>
${renderSectionBox('passes',       'Special Passes & Packs')}
${renderSectionBox('firstTopup',   'First Top-Up Bonuses')}
${renderSectionBox('bonusDiamond', 'Standard Diamond Packs')}
${renderSectionBox('pureDiamond',  'Sorted by Price')}
${renderPackageGroup(game, 'Special Passes & Packs',    'passes',       groups.passes,       'បន្ថែម Pass / Pack',          packageIconImages)}
${renderPackageGroup(game, 'First Top-Up Bonuses',      'firsttopup',   groups.firsttopup,   'បន្ថែម First Top-Up',         packageIconImages)}
${renderPackageGroup(game, 'Standard Diamond Packs',    'bonusDiamond', groups.bonusDiamond, 'បន្ថែម​កញ្ចប់​មាន Bonus',    packageIconImages)}
${renderPackageGroup(game, 'Sorted by Price',           'pureDiamond',  groups.pureDiamond,  'បន្ថែម​ Diamond គ្មាន Bonus', packageIconImages)}
</div>`;
}

function renderAdminDashboard({ orders, packages, games, settings, filter, username, counts, csrfToken }) {
  const colors = (settings && settings.colors) || { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
  const gameLogos = (settings && settings.gameLogos) || {};
  const cardBackgrounds = (settings && settings.cardBackgrounds) || {};
  const sectionImages = (settings && settings.sectionImages) || {};
  const packageIconImages = (settings && settings.packageIconImages) || {};
  const profileImage = settings && settings.profileImage ? `/static/uploads/${settings.profileImage}` : '/static/images/mascot.jpg';
  const coverImage = settings && settings.coverImage ? `/static/uploads/${settings.coverImage}` : null;
  const coverImages = (settings && settings.coverImages) || [];
  const brandNameEffect = (settings && settings.brandNameEffect) || 'none';
  const safetyBadgeEffect = (settings && settings.safetyBadgeEffect) || 'none';
  const brandTextAnimEnabled = !(settings && settings.brandTextAnimEnabled === false);
  const brandLogoAnimEnabled = !(settings && settings.brandLogoAnimEnabled === false);
  const brandTextAnimSpeed = (settings && settings.brandTextAnimSpeed) || 'normal';
  const brandLogoAnimSpeed = (settings && settings.brandLogoAnimSpeed) || 'normal';
  const brandGlowColor1 = (settings && settings.brandGlowColor1) || '#FFD700';
  const brandGlowColor2 = (settings && settings.brandGlowColor2) || '#3DB8FF';
  const social = (settings && settings.socialLinks) || {};
  const socialIcons = (settings && settings.socialIcons) || {};
  const khqrImage = settings && settings.khqrImage ? `/static/uploads/${settings.khqrImage}` : null;

  const tabs = [
    { key: 'all', label: 'ទាំងអស់' },
    { key: 'pending', label: 'រង់ចាំ' },
    { key: 'confirmed', label: 'បានបញ្ជាក់' },
    { key: 'delivered', label: 'បានបញ្ចូល' },
    { key: 'rejected', label: 'បានបដិសេធ' },
    { key: 'deleted', label: '🗑️ បានលុប' }
  ];

  const tabsHtml = tabs.map(t => `
<a href="/admin?status=${t.key}" class="admin-tab ${filter === t.key ? 'active' : ''}">
      ${t.label} <span class="count">${counts[t.key]}</span>
</a>`).join('');

  const isDeletedView = filter === 'deleted';
  const bulkBar = isDeletedView ? `
<div id="bulkBar" style="display:none;margin:10px 0;padding:10px 14px;background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.3);border-radius:8px;align-items:center;gap:12px;">
<span id="bulkCount" style="font-size:13px;">0 orders selected</span>
<button class="btn btn-sm btn-danger" id="bulkHardDeleteBtn">🗑️ លុបជាអចិន្ត្រៃយ៍</button>
</div>` : `
<div id="bulkBar" style="display:none;margin:10px 0;padding:10px 14px;background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.3);border-radius:8px;align-items:center;gap:12px;">
<span id="bulkCount" style="font-size:13px;">0 orders selected</span>
<button class="btn btn-sm btn-danger" id="bulkDeleteBtn">🗑️ លុប orders ដែលបានជ្រើសរើស</button>
</div>`;

  const ordersHtml = orders.length ? `
    ${bulkBar}
<table class="data-table">
<thead>
<tr>
<th style="width:32px;"><input type="checkbox" id="checkAll" /></th>
<th>Order Code</th>
<th>Game</th>
<th>Player</th>
<th>កញ្ចប់</th>
<th>តម្លៃ</th>
<th>ទំនាក់ទំនង</th>
<th>ស្ថានភាព</th>
<th>${isDeletedView ? 'បានលុប' : 'បានដាក់'}</th>
<th>${isDeletedView ? 'សកម្មភាព' : 'ផ្លាស់ប្តូរ'}</th>
</tr>
</thead>
<tbody>${orders.map((o) => renderOrderRow(o, filter)).join('')}</tbody>
</table>` : `
<div class="empty-state">
      ${ICONS.empty}
<p>${isDeletedView ? 'គ្មាន orders ដែលបានលុបទេ' : 'មិនទាន់មាន Order ទេនៅពេលនេះ'}</p>
</div>`;

  const gameSectionsHtml = games.map((g) => renderGameSection(g, packages, gameLogos, cardBackgrounds, sectionImages, packageIconImages)).join('');

  const profileUploadBox = renderUploadBox({
    label: 'Profile Picture (Logo)',
    hint: 'បង្ហាញនៅ header និង hero — ល្អបំផុតបើជារូបការ៉េ',
    previewSrc: profileImage,
    uploadEndpoint: '/api/admin/settings/profile-image',
    deleteEndpoint: settings && settings.profileImage ? '/api/admin/settings/profile-image' : null,
    inputId: 'profileImageInput',
    shape: 'round'
  });

  const coverUploadBox = renderUploadBox({
    label: 'Cover Banner',
    hint: 'បង្ហាញជា background ខាងក្រោយ Hero section — ល្អបំផុតបើជារូបវែង (1600x600px ឬប្រហាក់ប្រហែល)',
    previewSrc: coverImage,
    uploadEndpoint: '/api/admin/settings/cover-image',
    deleteEndpoint: coverImage ? '/api/admin/settings/cover-image' : null,
    inputId: 'coverImageInput',
    shape: 'wide'
  });

  const body = `
<div class="admin-shell" style="flex-direction:column;">
<div class="admin-topbar">
<div class="wrap">
<a href="/" class="logo"><img src="${profileImage}" alt="Wanfunzy" class="logo-mascot" /><span class="brand-name">Wanfunzy</span> <span style="font-size:12px;color:var(--text-faint);margin-left:6px;">Admin</span></a>
<div style="display:flex;align-items:center;gap:16px;">
<span style="font-size:13px;color:var(--text-dim);">👤 ${escapeHtml(username)}</span>
<button id="changePwBtn" class="btn btn-ghost btn-sm">ប្តូរពាក្យសម្ងាត់</button>
<form method="POST" action="/admin/logout" style="margin:0;">
<input type="hidden" name="csrf" value="${escapeHtml(csrfToken || '')}" />
<button type="submit" class="btn btn-ghost btn-sm">ចាកចេញ</button>
</form>
</div>
</div>
</div>
<div class="admin-main">
<div id="toast" style="display:none;" class="alert alert-success"></div>
<h2 style="font-family:var(--font-display);margin:0 0 4px;">Orders</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">គ្រប់គ្រង និងផ្ទៀងផ្ទាត់ការបញ្ជាទិញ</p>
<div class="admin-tabs">${tabsHtml}</div>
      ${ordersHtml}
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">Site Customization</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">កែប្រែពណ៌ Text, Profile Picture, និង Cover Banner របស់ Website</p>
<div class="customize-grid">
<div class="order-panel">
<h3 style="margin:0 0 14px;font-size:15px;">ពណ៌ Text</h3>
<div class="color-field">
<label>ពណ៌ Heading (ចំណងជើង)</label>
<div class="color-input-row">
<input type="color" id="colorHeading" value="${colors.heading}" />
<input type="text" id="colorHeadingHex" class="color-hex-input" value="${colors.heading}" />
</div>
</div>
<div class="color-field">
<label>ពណ៌ Body Text (អត្ថបទធម្មតា)</label>
<div class="color-input-row">
<input type="color" id="colorBody" value="${colors.body}" />
<input type="text" id="colorBodyHex" class="color-hex-input" value="${colors.body}" />
</div>
</div>
<div class="color-field">
<label>ពណ៌ Accent (តម្លៃ, ប៊ូតុង)</label>
<div class="color-input-row">
<input type="color" id="colorAccent" value="${colors.accent}" />
<input type="text" id="colorAccentHex" class="color-hex-input" value="${colors.accent}" />
</div>
</div>
<h3 style="margin:18px 0 14px;font-size:15px;">Appearance — Package Card (Fill &amp; Stroke)</h3>
<div class="color-field">
<label>Fill (ពណ៌ Background កញ្ចប់) — ទុកទទេ = default</label>
<div class="color-input-row">
<input type="color" id="colorPkgFill" value="${colors.pkgFill || '#0b0e14'}" />
<input type="text" id="colorPkgFillHex" class="color-hex-input" value="${colors.pkgFill || ''}" placeholder="default" />
<button id="clearPkgFillBtn" type="button" class="btn btn-ghost btn-sm" title="Reset to default">✕</button>
</div>
</div>
<div class="color-field">
<label>Stroke (ពណ៌ស៊ុម) — ទុកទទេ = default</label>
<div class="color-input-row">
<input type="color" id="colorPkgStroke" value="${colors.pkgStroke || '#232733'}" />
<input type="text" id="colorPkgStrokeHex" class="color-hex-input" value="${colors.pkgStroke || ''}" placeholder="default" />
<button id="clearPkgStrokeBtn" type="button" class="btn btn-ghost btn-sm" title="Reset to default">✕</button>
</div>
</div>
<button id="saveColorsBtn" class="btn btn-primary btn-sm" style="margin-top:8px;">រក្សាទុកពណ៌</button>
<h3 style="margin:18px 0 14px;font-size:15px;">Effects — Shooting Star Video (ស្រេចចិត្ត)</h3>
<div class="upload-box upload-box-inline" data-upload-endpoint="/api/admin/settings/starfield-video" data-delete-endpoint="/api/admin/settings/starfield-video" data-allow-video="true" style="margin-bottom:0;">
<div class="upload-box-label" style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Upload video ទេពច្យុត/meteor ផ្ទាល់ខ្លួន (ជំនួស animation CSS លំនាំដើម) — background ខ្មៅនឹងបាត់ដោយស្វ័យប្រវត្តិ ដូច្នេះគួរប្រើ video ដែលមាន background ខ្មៅសុទ្ធ</div>
<div class="upload-box-body">
  ${settings.starfieldVideo ? `<video src="/static/uploads/${settings.starfieldVideo}" class="upload-preview upload-preview-wide" style="height:60px;object-fit:cover;background:#000;" autoplay muted loop playsinline></video>` : `<div class="upload-preview upload-preview-empty upload-preview-wide" style="height:60px;">Default (CSS stars)</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="starfieldVideoInput" style="cursor:pointer;">${settings.starfieldVideo ? 'ប្តូរ video' : 'Upload Video'}</label>
<input type="file" id="starfieldVideoInput" class="upload-input" accept="video/mp4,video/webm" style="display:none;" />
  ${settings.starfieldVideo ? `<button class="btn btn-sm btn-danger upload-remove-btn">ត្រឡប់ទៅ Default</button>` : ''}
</div>
</div>
</div>
</div>
<div>
            ${profileUploadBox}
<div style="height:16px;"></div>
            ${coverUploadBox}
</div>
</div>
</div>
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">Brand Text & Animation — ឈ្មោះ "Wanfunzy"</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">ជ្រើសរើស Effect សម្រាប់ឈ្មោះ Brand និង Safety Badge ដែលបង្ហាញនៅលើគ្រប់ទំព័រ</p>
<div class="order-panel">
<div class="color-field">
<label>Effect លើឈ្មោះ "Wanfunzy"</label>
<select id="brandNameEffectSelect" style="width:100%;background:var(--void);border:1px solid var(--line);border-radius:8px;padding:10px;color:var(--text);margin-top:6px;">
<option value="none" ${brandNameEffect === 'none' ? 'selected' : ''}>គ្មាន Effect (ធម្មតា)</option>
<option value="glow" ${brandNameEffect === 'glow' ? 'selected' : ''}>Glow (ពន្លឺទន់ៗ)</option>
<option value="glow-sweep" ${brandNameEffect === 'glow-sweep' ? 'selected' : ''}>Glow Sweep (ពន្លឺរត់)</option>
<option value="glow-rays" ${brandNameEffect === 'glow-rays' ? 'selected' : ''}>Glow Rays (ពន្លឺរស្មី)</option>
<option value="glow-zoom" ${brandNameEffect === 'glow-zoom' ? 'selected' : ''}>Glow + Zoom Pulse</option>
<option value="fantasy-gold" ${brandNameEffect === 'fantasy-gold' ? 'selected' : ''}>Fantasy Gold + Blue (Wipe Slide)</option>
<option value="fantasy-gold-zoom" ${brandNameEffect === 'fantasy-gold-zoom' ? 'selected' : ''}>Fantasy Gold + Blue + Zoom</option>
</select>
</div>
<div class="color-field">
<label>Effect លើ Safety Badge (សុវត្ថិភាព ១០០%)</label>
<select id="safetyBadgeEffectSelect" style="width:100%;background:var(--void);border:1px solid var(--line);border-radius:8px;padding:10px;color:var(--text);margin-top:6px;">
<option value="none" ${safetyBadgeEffect === 'none' ? 'selected' : ''}>គ្មាន Effect</option>
<option value="shimmer" ${safetyBadgeEffect === 'shimmer' ? 'selected' : ''}>Shimmer</option>
<option value="glow-zoom" ${safetyBadgeEffect === 'glow-zoom' ? 'selected' : ''}>Glow + Zoom Pulse</option>
<option value="fantasy-gold" ${safetyBadgeEffect === 'fantasy-gold' ? 'selected' : ''}>Fantasy Gold + Blue</option>
<option value="fantasy-gold-zoom" ${safetyBadgeEffect === 'fantasy-gold-zoom' ? 'selected' : ''}>Fantasy Gold + Blue + Zoom</option>
</select>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
<div class="color-field">
<label style="display:flex;align-items:center;gap:8px;">
<input type="checkbox" id="brandTextAnimEnabled" ${brandTextAnimEnabled ? 'checked' : ''} />
Animation លើអក្សរ (Text)
</label>
<select id="brandTextAnimSpeed" style="width:100%;background:var(--void);border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--text);margin-top:6px;">
<option value="slow" ${brandTextAnimSpeed === 'slow' ? 'selected' : ''}>យឺត (Slow)</option>
<option value="normal" ${brandTextAnimSpeed === 'normal' ? 'selected' : ''}>ធម្មតា (Normal)</option>
<option value="fast" ${brandTextAnimSpeed === 'fast' ? 'selected' : ''}>លឿន (Fast)</option>
</select>
</div>
<div class="color-field">
<label style="display:flex;align-items:center;gap:8px;">
<input type="checkbox" id="brandLogoAnimEnabled" ${brandLogoAnimEnabled ? 'checked' : ''} />
Animation លើ Logo/Mascot
</label>
<select id="brandLogoAnimSpeed" style="width:100%;background:var(--void);border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--text);margin-top:6px;">
<option value="slow" ${brandLogoAnimSpeed === 'slow' ? 'selected' : ''}>យឺត (Slow)</option>
<option value="normal" ${brandLogoAnimSpeed === 'normal' ? 'selected' : ''}>ធម្មតា (Normal)</option>
<option value="fast" ${brandLogoAnimSpeed === 'fast' ? 'selected' : ''}>លឿន (Fast)</option>
</select>
</div>
</div>
<button id="saveTextEffectsBtn" class="btn btn-primary btn-sm" style="margin-top:16px;">រក្សាទុក Effect</button>
</div>
<div class="order-panel" style="margin-top:16px;">
<h3 style="margin:0 0 14px;font-size:15px;">ពណ៌ Glow (សម្រាប់ Effect ខាងលើ)</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
<div class="color-field">
<label>ពណ៌ទី ១ (លំនាំដើម: មាស)</label>
<div class="color-input-row">
<input type="color" id="glowColor1" value="${brandGlowColor1}" />
<input type="text" id="glowColor1Hex" class="color-hex-input" value="${brandGlowColor1}" />
</div>
</div>
<div class="color-field">
<label>ពណ៌ទី ២ (លំនាំដើម: ខៀវ)</label>
<div class="color-input-row">
<input type="color" id="glowColor2" value="${brandGlowColor2}" />
<input type="text" id="glowColor2Hex" class="color-hex-input" value="${brandGlowColor2}" />
</div>
</div>
</div>
<button id="saveGlowColorsBtn" class="btn btn-primary btn-sm" style="margin-top:12px;">រក្សាទុកពណ៌ Glow</button>
</div>
</div>
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">KHQR Payment — QR ទូទាត់</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">Upload រូប KHQR របស់អ្នក (ពី ABA / ACLEDA / Wing app → Receive Money → Save QR)។ អតិថិជននឹងស្កេន QR នេះ ដើម្បីទូទាត់នៅជំហានទី ៣។ បើមិន Upload ទំព័រនឹងបង្ហាញសារ "ទាក់ទង Telegram" ជំនួស។</p>
<div class="order-panel">
<div class="upload-box" data-upload-endpoint="/api/admin/settings/khqr-image" data-delete-endpoint="/api/admin/settings/khqr-image" style="border:none;padding:0;">
<div class="upload-box-body">
${khqrImage ? `<img src="${khqrImage}" class="upload-preview" alt="KHQR" style="width:120px;height:120px;object-fit:contain;background:#fff;border-radius:8px;padding:4px;" />` : `<div class="upload-preview upload-preview-empty" style="width:120px;height:120px;border-radius:8px;">គ្មាន QR</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="khqrImageInput" style="cursor:pointer;">${khqrImage ? 'ប្តូរ QR' : 'Upload QR'}</label>
<input type="file" id="khqrImageInput" class="upload-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
${khqrImage ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុប QR</button>` : ''}
</div>
</div>
</div>
</div>
</div>
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">Social Media Links</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">ដាក់ Link + Upload logo icon ខ្លួនឯង សម្រាប់ Facebook / YouTube / Telegram / TikTok — icon នឹងបង្ហាញនៅ Header (តែ Link ណាដែលបំពេញ)។ បើមិន Upload icon នឹងប្រើ emoji default។ ទុក URL ទទេ = មិនបង្ហាញ។</p>
<div class="order-panel">
${['facebook','youtube','telegram','tiktok'].map(function(key){
  var meta = {
    facebook: { emoji:'📘', name:'Facebook', ph:'https://facebook.com/yourpage' },
    youtube:  { emoji:'▶️', name:'YouTube',  ph:'https://youtube.com/@yourchannel' },
    telegram: { emoji:'✈️', name:'Telegram', ph:'https://t.me/yourchannel' },
    tiktok:   { emoji:'🎵', name:'TikTok',   ph:'https://tiktok.com/@youraccount' }
  }[key];
  var iconFile = socialIcons[key];
  var iconPreview = iconFile ? ('/static/uploads/' + iconFile) : null;
  var capKey = key.charAt(0).toUpperCase() + key.slice(1);
  return `
<div style="padding:16px 0;border-bottom:1px solid var(--line-soft);">
<div class="color-field" style="margin-bottom:12px;">
<label>${meta.emoji} ${meta.name} URL</label>
<input type="text" id="social${capKey}" class="color-hex-input" style="width:100%;font-family:var(--font-body);" value="${escapeHtml(social[key] || '')}" placeholder="${meta.ph}" />
</div>
<div class="upload-box upload-box-inline" data-upload-endpoint="/api/admin/settings/social-icon/${key}" data-delete-endpoint="/api/admin/settings/social-icon/${key}" style="margin:0;">
<div class="upload-box-body">
${iconPreview ? `<img src="${iconPreview}" class="upload-preview upload-preview-round" alt="${meta.name} icon" style="width:40px;height:40px;" />` : `<div class="upload-preview upload-preview-empty upload-preview-round" style="width:40px;height:40px;">${meta.emoji}</div>`}
<div class="upload-box-actions">
<label class="btn btn-ghost btn-sm" for="socialIcon-${key}" style="cursor:pointer;">${iconPreview ? 'ប្តូរ Icon' : 'Upload Icon'}</label>
<input type="file" id="socialIcon-${key}" class="upload-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
${iconPreview ? `<button class="btn btn-sm btn-danger upload-remove-btn">លុប Icon</button>` : ''}
</div>
</div>
</div>
</div>`;
}).join('')}
<button id="saveSocialBtn" class="btn btn-primary btn-sm" style="margin-top:16px;">រក្សាទុក Social Links</button>
</div>
</div>
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">Cover Carousel — សម្រាប់ទំព័រ /topup</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">Upload រូបភាពច្រើនសន្លឹក (អតិបរមា 8 រូប) — នឹងបង្ហាញជា Slideshow ស្វ័យប្រវត្តិនៅខាងលើទំព័រ /topup</p>
<div class="order-panel">
<div id="coverCarouselGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-bottom:16px;">
            ${coverImages.map((img, i) => `
<div class="carousel-thumb" data-index="${i}" style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:16/9;border:1px solid var(--line);">
<img src="/static/uploads/${escapeHtml(img)}" style="width:100%;height:100%;object-fit:cover;" />
<button class="carousel-remove-btn" data-index="${i}" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.65);color:var(--red);border:none;border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:13px;">✕</button>
</div>`).join('')}
</div>
<label class="btn btn-ghost btn-sm" for="carouselInput" style="cursor:pointer;">+ បន្ថែមរូបភាព (${coverImages.length}/8)</label>
<input type="file" id="carouselInput" accept="image/jpeg,image/png,image/webp" style="display:none;" />
</div>
</div>
<div style="margin-top:48px;">
<h2 style="font-family:var(--font-display);margin:0 0 4px;">កញ្ចប់តាម Game</h2>
<p style="color:var(--text-dim);font-size:13px;margin:0 0 20px;">បន្ថែម កែប្រែ ឬដក Package ចេញពីហាង សម្រាប់ game នីមួយៗ — ក៏អាចប្តូរ Logo របស់ game នីមួយៗបានដែរ</p>
        ${gameSectionsHtml}
</div>
</div>
</div>
<div id="pwModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center;">
<div class="login-card" style="max-width:360px;">
<h3 style="margin:0 0 16px;">ប្តូរពាក្យសម្ងាត់</h3>
<div id="pwError" class="alert alert-error" style="display:none;"></div>
<div class="field">
<label>ពាក្យសម្ងាត់បច្ចុប្បន្ន</label>
<input type="password" id="currentPassword" />
</div>
<div class="field">
<label>ពាក្យសម្ងាត់ថ្មី (យ៉ាងតិច ៨ តួ)</label>
<input type="password" id="newPassword" />
</div>
<div style="display:flex;gap:8px;margin-top:16px;">
<button id="pwCancel" class="btn btn-ghost btn-full">បោះបង់</button>
<button id="pwSubmit" class="btn btn-primary btn-full">រក្សាទុក</button>
</div>
</div>
</div>
<script>
(function () {
  // CSRF token issued for this admin session at login time. Embedded here
  // (server-rendered, same-origin only) and echoed back as a header on
  // every state-changing fetch() call below — a page an attacker controls
  // has no way to read this value out of our HTML, so a forged cross-site
  // request from another site won't have it and gets rejected server-side.
  const CSRF_TOKEN = ${JSON.stringify(csrfToken || '')};

  function csrfFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, { 'X-CSRF-Token': CSRF_TOKEN });
    return fetch(url, options);
  }

function toast(msg, isError) {
const el = document.getElementById('toast');
el.textContent = msg;
el.className = 'alert ' + (isError ? 'alert-error' : 'alert-success');
el.style.display = 'block';
setTimeout(() => { el.style.display = 'none'; }, 3000);
}
document.querySelectorAll('.status-select').forEach(function (sel) {
sel.addEventListener('change', async function () {
const orderId = sel.dataset.orderId;
const status = sel.value;
try {
const res = await csrfFetch('/api/admin/orders/' + orderId + '/status', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ status })
});
const data = await res.json();
if (data.ok) {
toast('បានធ្វើបច្ចុប្បន្នភាព Order ✓');
setTimeout(() => location.reload(), 600);
} else {
toast(data.error || 'មានបញ្ហា', true);
}
} catch (e) {
toast('មិនអាចភ្ជាប់ server បានទេ', true);
}
});
});

// Per-row soft delete (⚠️ confirm dialog first — hard to accidentally trigger)
document.querySelectorAll('[data-action="delete-order"]').forEach(function (btn) {
btn.addEventListener('click', async function () {
const orderId = btn.dataset.orderId;
if (!confirm('លុប Order នេះមែនទេ? អ្នកអាចស្តារវិញបានពី tab "🗑️ បានលុប"។')) return;
try {
const res = await csrfFetch('/api/admin/orders/' + orderId, { method: 'DELETE' });
const data = await res.json();
if (data.ok) { toast('លុប Order ✓'); setTimeout(() => location.reload(), 500); }
else toast(data.error || 'មានបញ្ហា', true);
} catch (e) { toast('មិនអាចភ្ជាប់ server បានទេ', true); }
});
});

// Restore from Deleted tab
document.querySelectorAll('[data-action="restore-order"]').forEach(function (btn) {
btn.addEventListener('click', async function () {
const orderId = btn.dataset.orderId;
try {
const res = await csrfFetch('/api/admin/orders/' + orderId + '/restore', { method: 'POST' });
const data = await res.json();
if (data.ok) { toast('បានស្តារ Order វិញ ✓'); setTimeout(() => location.reload(), 500); }
else toast(data.error || 'មានបញ្ហា', true);
} catch (e) { toast('មិនអាចភ្ជាប់ server បានទេ', true); }
});
});

// Permanent (hard) delete from the Deleted tab — double-confirm because
// it wipes the row and its payment slip from disk with no restore path.
document.querySelectorAll('[data-action="hard-delete-order"]').forEach(function (btn) {
btn.addEventListener('click', async function () {
const orderId = btn.dataset.orderId;
if (!confirm('⚠️ លុប Order នេះជាអចិន្ត្រៃយ៍មែនទេ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទៀតទេ។')) return;
if (!confirm('សូមបញ្ជាក់ម្តងទៀត — លុបជាអចិន្ត្រៃយ៍?')) return;
try {
const res = await csrfFetch('/api/admin/orders/' + orderId + '/hard-delete', { method: 'DELETE' });
const data = await res.json();
if (data.ok) { toast('លុបជាអចិន្ត្រៃយ៍ ✓'); setTimeout(() => location.reload(), 500); }
else toast(data.error || 'មានបញ្ហា', true);
} catch (e) { toast('មិនអាចភ្ជាប់ server បានទេ', true); }
});
});

// Bulk actions: same checkbox UI drives soft-delete on active tabs and
// hard-delete on the Deleted tab, depending on which button is present.
(function () {
var bulkBar = document.getElementById('bulkBar');
var bulkCount = document.getElementById('bulkCount');
var softBtn = document.getElementById('bulkDeleteBtn');
var hardBtn = document.getElementById('bulkHardDeleteBtn');
var checkAll = document.getElementById('checkAll');
if (!bulkBar || (!softBtn && !hardBtn)) return;
var boxes = document.querySelectorAll('.order-check');

function refresh() {
var ids = [];
boxes.forEach(function (b) { if (b.checked) ids.push(b.dataset.orderId); });
if (ids.length) {
bulkBar.style.display = 'flex';
bulkCount.textContent = ids.length + ' orders selected';
} else {
bulkBar.style.display = 'none';
}
return ids;
}
boxes.forEach(function (b) { b.addEventListener('change', refresh); });
if (checkAll) {
checkAll.addEventListener('change', function () {
boxes.forEach(function (b) { b.checked = checkAll.checked; });
refresh();
});
}
if (softBtn) {
softBtn.addEventListener('click', async function () {
var ids = refresh();
if (!ids.length) return;
if (!confirm('លុប ' + ids.length + ' orders មែនទេ? អ្នកអាចស្តារវិញបានពី tab "🗑️ បានលុប"។')) return;
softBtn.disabled = true;
try {
const res = await csrfFetch('/api/admin/orders/bulk-delete', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ ids: ids })
});
const data = await res.json();
if (data.ok) { toast('លុប ' + data.deleted + ' orders ✓'); setTimeout(() => location.reload(), 500); }
else { toast(data.error || 'មានបញ្ហា', true); softBtn.disabled = false; }
} catch (e) { toast('មិនអាចភ្ជាប់ server បានទេ', true); softBtn.disabled = false; }
});
}
if (hardBtn) {
hardBtn.addEventListener('click', async function () {
var ids = refresh();
if (!ids.length) return;
if (!confirm('⚠️ លុប ' + ids.length + ' orders ជាអចិន្ត្រៃយ៍មែនទេ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទៀតទេ។')) return;
if (!confirm('សូមបញ្ជាក់ម្តងទៀត — លុប ' + ids.length + ' orders ជាអចិន្ត្រៃយ៍?')) return;
hardBtn.disabled = true;
try {
const res = await csrfFetch('/api/admin/orders/bulk-hard-delete', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ ids: ids })
});
const data = await res.json();
if (data.ok) { toast('លុបជាអចិន្ត្រៃយ៍ ' + data.deleted + ' orders ✓'); setTimeout(() => location.reload(), 500); }
else { toast(data.error || 'មានបញ្ហា', true); hardBtn.disabled = false; }
} catch (e) { toast('មិនអាចភ្ជាប់ server បានទេ', true); hardBtn.disabled = false; }
});
}
})();
document.querySelectorAll('.package-list').forEach(function (packageList) {
packageList.addEventListener('click', async function (e) {
const row = e.target.closest('.pkg-row');
if (!row) return;
const packageId = row.dataset.packageId;
if (e.target.dataset.action === 'toggle-active') {
const isOn = !e.target.classList.contains('on');
e.target.classList.toggle('on');
await csrfFetch('/api/admin/packages/' + packageId, {
method: 'PATCH',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ active: isOn })
});
toast('បានកែប្រែស្ថានភាពកញ្ចប់ ✓');
}
if (e.target.dataset.action === 'delete-package') {
if (!confirm('លុបកញ្ចប់នេះមែនទេ?')) return;
const res = await csrfFetch('/api/admin/packages/' + packageId, { method: 'DELETE' });
const data = await res.json();
if (data.ok) {
row.remove();
toast('បានលុបកញ្ចប់ ✓');
}
}
});
packageList.querySelectorAll('input').forEach(function (input) {
input.addEventListener('change', async function () {
const row = input.closest('.pkg-row');
const packageId = row.dataset.packageId;
const moogoldEl = row.querySelector('.pkg-moogold-id');
const badgeEl = row.querySelector('.pkg-badge');
const payload = {
name: row.querySelector('.pkg-name').value,
amount: row.querySelector('.pkg-amount').value,
bonus: row.querySelector('.pkg-bonus').value,
price: row.querySelector('.pkg-price').value,
moogoldProductId: moogoldEl ? moogoldEl.value.trim() || null : null,
badge: badgeEl ? badgeEl.value.trim() || '' : ''
};
const res = await csrfFetch('/api/admin/packages/' + packageId, {
method: 'PATCH',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
const data = await res.json();
if (data.ok) toast('បានរក្សាទុក ✓');
});
});
});
document.querySelectorAll('.add-package-btn').forEach(function (btn) {
btn.addEventListener('click', async function () {
const gameId = btn.dataset.gameId;
// The category tag is stored directly on the new package (server-side)
// so it always renders in the exact section this button belongs to —
// no more guessing from name/bonus, which used to misfile new $0 items
// into "Sorted by Price" regardless of which button was clicked.
const category = btn.dataset.category || 'pureDiamond';
const defaultName = category === 'passes'       ? 'New Special Pass'
                  : category === 'firsttopup'   ? 'New First Top-Up Bonus'
                  : category === 'bonusDiamond' ? 'កញ្ចប់ថ្មី (មាន Bonus)'
                  : 'កញ្ចប់ថ្មី';
const res = await csrfFetch('/api/admin/packages', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ gameId, name: defaultName, amount: 0, bonus: 0, price: 0, category })
});
const data = await res.json();
if (data.ok) location.reload();
});
});
document.querySelectorAll('.save-emoji-btn').forEach(function (btn) {
btn.addEventListener('click', async function () {
const gameId = btn.dataset.gameId;
const row = btn.closest('.emoji-edit-row');
const emoji = row.querySelector('.emoji-input').value.trim();
if (!emoji) { toast('សូមបញ្ចូល emoji សិន', true); return; }
try {
const res = await csrfFetch('/api/admin/games/' + gameId + '/currency-emoji', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ emoji })
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុក Emoji ✓ (បង្ហាញនៅ /topup ភ្លាមៗ)');
} else {
toast(data.error || 'មានបញ្ហា', true);
}
} catch (err) {
toast('មិនអាចភ្ជាប់ server បានទេ', true);
}
});
});
const pwModal = document.getElementById('pwModal');
document.getElementById('changePwBtn').addEventListener('click', () => { pwModal.style.display = 'flex'; });
document.getElementById('pwCancel').addEventListener('click', () => { pwModal.style.display = 'none'; });
document.getElementById('pwSubmit').addEventListener('click', async function () {
const currentPassword = document.getElementById('currentPassword').value;
const newPassword = document.getElementById('newPassword').value;
const errEl = document.getElementById('pwError');
errEl.style.display = 'none';
const res = await csrfFetch('/admin/change-password', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ currentPassword, newPassword })
});
const data = await res.json();
if (data.ok) {
pwModal.style.display = 'none';
toast('បានប្តូរពាក្យសម្ងាត់ដោយជោគជ័យ ✓');
} else {
errEl.textContent = data.error || 'មានបញ្ហាកើតឡើង';
errEl.style.display = 'block';
}
});
// ---------- Color pickers: keep <input type=color> and hex text in sync ----------
function linkColorPair(colorId, hexId) {
const colorInput = document.getElementById(colorId);
const hexInput = document.getElementById(hexId);
if (!colorInput || !hexInput) return;
colorInput.addEventListener('input', () => { hexInput.value = colorInput.value; });
hexInput.addEventListener('input', () => {
if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) colorInput.value = hexInput.value;
});
}
linkColorPair('colorHeading', 'colorHeadingHex');
linkColorPair('colorBody', 'colorBodyHex');
linkColorPair('colorAccent', 'colorAccentHex');
linkColorPair('colorPkgFill', 'colorPkgFillHex');
linkColorPair('colorPkgStroke', 'colorPkgStrokeHex');
const clearPkgFillBtn = document.getElementById('clearPkgFillBtn');
if (clearPkgFillBtn) clearPkgFillBtn.addEventListener('click', function () {
document.getElementById('colorPkgFillHex').value = '';
});
const clearPkgStrokeBtn = document.getElementById('clearPkgStrokeBtn');
if (clearPkgStrokeBtn) clearPkgStrokeBtn.addEventListener('click', function () {
document.getElementById('colorPkgStrokeHex').value = '';
});
const saveColorsBtn = document.getElementById('saveColorsBtn');
if (saveColorsBtn) {
saveColorsBtn.addEventListener('click', async function () {
const heading = document.getElementById('colorHeadingHex').value;
const body2 = document.getElementById('colorBodyHex').value;
const accent = document.getElementById('colorAccentHex').value;
const pkgFill = document.getElementById('colorPkgFillHex').value;
const pkgStroke = document.getElementById('colorPkgStrokeHex').value;
const res = await csrfFetch('/api/admin/settings/colors', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ heading, body: body2, accent, pkgFill, pkgStroke })
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុកពណ៌ ✓ (Refresh ទំព័រដើមដើម្បីមើល)');
} else {
toast(data.error || 'មានបញ្ហា', true);
}
});
}
// ---------- Brand Text & Animation effects ----------
linkColorPair('glowColor1', 'glowColor1Hex');
linkColorPair('glowColor2', 'glowColor2Hex');
const saveTextEffectsBtn = document.getElementById('saveTextEffectsBtn');
if (saveTextEffectsBtn) {
saveTextEffectsBtn.addEventListener('click', async function () {
const payload = {
brandNameEffect: document.getElementById('brandNameEffectSelect').value,
safetyBadgeEffect: document.getElementById('safetyBadgeEffectSelect').value,
brandTextAnimEnabled: document.getElementById('brandTextAnimEnabled').checked,
brandLogoAnimEnabled: document.getElementById('brandLogoAnimEnabled').checked,
brandTextAnimSpeed: document.getElementById('brandTextAnimSpeed').value,
brandLogoAnimSpeed: document.getElementById('brandLogoAnimSpeed').value
};
const res = await csrfFetch('/api/admin/settings/text-effects', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុក Effect ✓ (Refresh ទំព័រដើមដើម្បីមើល)');
} else {
toast(data.error || 'មានបញ្ហា', true);
}
});
}
const saveGlowColorsBtn = document.getElementById('saveGlowColorsBtn');
if (saveGlowColorsBtn) {
saveGlowColorsBtn.addEventListener('click', async function () {
const color1 = document.getElementById('glowColor1Hex').value;
const color2 = document.getElementById('glowColor2Hex').value;
const res = await csrfFetch('/api/admin/settings/brand-glow-colors', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ color1, color2 })
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុកពណ៌ Glow ✓ (Refresh ទំព័រដើមដើម្បីមើល)');
} else {
toast(data.error || 'មានបញ្ហា', true);
}
});
}
const saveSocialBtn = document.getElementById('saveSocialBtn');
if (saveSocialBtn) {
saveSocialBtn.addEventListener('click', async function () {
const payload = {
facebook: document.getElementById('socialFacebook').value.trim(),
youtube: document.getElementById('socialYoutube').value.trim(),
telegram: document.getElementById('socialTelegram').value.trim(),
tiktok: document.getElementById('socialTiktok').value.trim()
};
const res = await csrfFetch('/api/admin/settings/social-links', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុក Social Links ✓ (Refresh ទំព័រដើមដើម្បីមើល)');
} else {
toast(data.error || 'មានបញ្ហា', true);
}
});
}
// ---------- Image upload boxes (profile / cover / per-game logo) ----------
function fileToDataUrl(file) {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result);
reader.onerror = reject;
reader.readAsDataURL(file);
});
}
document.querySelectorAll('.upload-box').forEach(function (box) {
const input = box.querySelector('.upload-input');
const uploadEndpoint = box.dataset.uploadEndpoint;
const removeBtn = box.querySelector('.upload-remove-btn');
if (input) {
input.addEventListener('change', async function () {
const file = input.files[0];
if (!file) return;
// Card-background upload accepts a short video clip (up to 20MB); every
// other upload box stays image-only (5MB), same as before.
const allowVideo = box.dataset.allowVideo === 'true';
const maxBytes = allowVideo ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
if (file.size > maxBytes) {
toast(allowVideo
  ? 'ឯកសារធំជាង 20MB — សូម compress វីដេអូ ឬជ្រើសរើស file តូចជាងនេះ'
  : 'រូបភាពធំជាង 5MB — សូមជ្រើសរើសរូបតូចជាងនេះ', true);
return;
}
try {
const dataUrl = await fileToDataUrl(file);
const res = await csrfFetch(uploadEndpoint, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ image: dataUrl })
});
const data = await res.json();
if (data.ok) {
toast('បានរក្សាទុករូបភាព ✓');
setTimeout(() => location.reload(), 600);
} else {
toast(data.error || 'Upload បរាជ័យ', true);
}
} catch (err) {
toast('មានបញ្ហាកើតឡើងពេល Upload', true);
}
});
}
if (removeBtn) {
removeBtn.addEventListener('click', async function () {
const deleteEndpoint = box.dataset.deleteEndpoint;
if (!deleteEndpoint) return;
if (!confirm('លុបរូបភាពនេះមែនទេ?')) return;
const res = await csrfFetch(deleteEndpoint, { method: 'DELETE' });
const data = await res.json();
if (data.ok) {
toast('បានលុបរូបភាព ✓');
setTimeout(() => location.reload(), 600);
}
});
}
});
// ---------- Cover Carousel (multi-image upload for /topup) ----------
const carouselInput = document.getElementById('carouselInput');
if (carouselInput) {
carouselInput.addEventListener('change', async function () {
const file = carouselInput.files[0];
if (!file) return;
if (file.size > 5 * 1024 * 1024) {
toast('រូបភាពធំជាង 5MB — សូមជ្រើសរើសរូបតូចជាងនេះ', true);
return;
}
try {
const dataUrl = await fileToDataUrl(file);
const res = await csrfFetch('/api/admin/settings/cover-carousel', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ image: dataUrl })
});
const data = await res.json();
if (data.ok) {
toast('បានបន្ថែមរូបភាព ✓');
setTimeout(() => location.reload(), 600);
} else {
toast(data.error || 'Upload បរាជ័យ', true);
}
} catch (err) {
toast('មានបញ្ហាកើតឡើងពេល Upload', true);
}
});
}
document.querySelectorAll('.carousel-remove-btn').forEach(function (btn) {
btn.addEventListener('click', async function () {
const index = btn.dataset.index;
if (!confirm('លុបរូបភាពនេះចេញពី Carousel មែនទេ?')) return;
const res = await csrfFetch('/api/admin/settings/cover-carousel/' + index, { method: 'DELETE' });
const data = await res.json();
if (data.ok) {
toast('បានលុបរូបភាព ✓');
setTimeout(() => location.reload(), 600);
}
});
});
// Per-package icon upload (small square in each package row)
document.addEventListener('change', function(e) {
  const input = e.target.closest('.pkg-icon-input');
  if (!input) return;
  const packageId = input.dataset.packageId;
  const file = input.files[0];
  if (!file || !packageId) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const res = await csrfFetch('/api/admin/packages/' + packageId + '/icon', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: ev.target.result })
      });
      const data = await res.json();
      if (data.ok) {
        const label = input.closest('.pkg-icon-upload');
        if (label) {
          const imgEl = document.createElement('img');
          imgEl.src = '/static/uploads/' + data.filename;
          imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;';
          label.innerHTML = '';
          label.appendChild(imgEl);
          const ni = document.createElement('input');
          ni.type='file'; ni.accept='image/jpeg,image/png,image/webp';
          ni.className='pkg-icon-input'; ni.dataset.packageId=packageId;
          ni.style.cssText='position:absolute;inset:0;opacity:0;cursor:pointer;';
          label.appendChild(ni);
        }
        toast('Upload រូបភាព package ✓');
      } else { toast(data.error || 'Upload failed', true); }
    } catch(err) { toast('Upload failed', true); }
  };
  reader.readAsDataURL(file);
});
})();
</script>`;
  return layout({ title: 'Admin Dashboard — Wanfunzy', body });
}

module.exports = { renderAdminDashboard };
