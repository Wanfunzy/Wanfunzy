// db.js — minimal file-based JSON datastore.
// No external dependencies. Safe for small-to-medium traffic stores.
// Swap this module out for a real database later without touching server.js,
// as long as the exported function signatures stay the same.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// PERSIST_DIR points at the Railway Volume mount path (set in Railway
// service settings — see TOPUP_SETUP notes). Everything that must survive
// redeploys (the JSON "database" and uploaded images) lives under this one
// directory, since Railway's free/starter plans only allow one Volume per
// service. Locally (no Volume mounted), this just falls back to a normal
// folder inside the project, so `node server.js` still works unchanged for
// local development.
const PERSIST_DIR = process.env.PERSIST_DIR || path.join(__dirname, 'persist');

const DATA_DIR = path.join(PERSIST_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = buildSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
  }
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

function buildSeedData() {
  // Default owner login: admin / wanfunzy123  (CHANGE THIS after first deploy)
  const { salt, hash } = hashPassword('wanfunzy123');
  return {
    admins: [
      { id: 'admin-1', username: 'admin', salt, hash, createdAt: new Date().toISOString() }
    ],
    games: [
      {
        id: 'mlbb',
        name: 'Mobile Legends: Bang Bang',
        shortName: 'Mobile Legends',
        currencyLabel: 'Diamonds',
        currencyUnit: '💎',
        icon: 'mlbb',
        requiresServerId: true,
        active: true
      },
      {
        id: 'freefire',
        name: 'Free Fire',
        shortName: 'Free Fire',
        currencyLabel: 'Diamonds',
        currencyUnit: '💎',
        icon: 'freefire',
        requiresServerId: false,
        active: true
      },
      {
        id: 'pubgm',
        name: 'PUBG Mobile',
        shortName: 'PUBG Mobile',
        currencyLabel: 'UC',
        currencyUnit: '🔶',
        icon: 'pubgm',
        requiresServerId: false,
        active: true
      },
      {
        id: 'hok',
        name: 'Honor of Kings',
        shortName: 'HOK',
        currencyLabel: 'Tokens',
        currencyUnit: '🪙',
        icon: 'hok',
        requiresServerId: false,
        active: true
      }
    ],
    packages: [
      // Mobile Legends
      // moogoldProductId = variation_id ពី MooGold Reseller Panel
      // ប្រើសម្រាប់ validate Player ID និង auto-fulfill តាម MooGold API
      { id: 'pkg-ml-1', gameId: 'mlbb', name: '10 + 1 Diamonds', amount: 10, bonus: 1, price: 0.18, currency: 'USD', active: true, moogoldProductId: '4700134' },
      { id: 'pkg-ml-2', gameId: 'mlbb', name: '20 + 2 Diamonds', amount: 20, bonus: 2, price: 0.39, currency: 'USD', active: true, moogoldProductId: '4700148' },
      { id: 'pkg-ml-3', gameId: 'mlbb', name: '51 + 5 Diamonds', amount: 51, bonus: 5, price: 0.99, currency: 'USD', active: true, moogoldProductId: '4700149' },
      { id: 'pkg-ml-4', gameId: 'mlbb', name: '102 + 10 Diamonds', amount: 102, bonus: 10, price: 1.99, currency: 'USD', active: true, moogoldProductId: '4700152' },
      { id: 'pkg-ml-5', gameId: 'mlbb', name: '203 + 20 Diamonds', amount: 203, bonus: 20, price: 3.99, currency: 'USD', active: true, moogoldProductId: '4700153' },
      { id: 'pkg-ml-6', gameId: 'mlbb', name: '303 + 33 Diamonds', amount: 303, bonus: 33, price: 5.99, currency: 'USD', active: true, moogoldProductId: '4700155' },
      { id: 'pkg-ml-7', gameId: 'mlbb', name: '504 + 66 Diamonds', amount: 504, bonus: 66, price: 9.99, currency: 'USD', active: true, moogoldProductId: '4700157' },
      { id: 'pkg-ml-8', gameId: 'mlbb', name: '1007 + 156 Diamonds', amount: 1007, bonus: 156, price: 19.99, currency: 'USD', active: true, moogoldProductId: '4700158' },
      { id: 'pkg-ml-9', gameId: 'mlbb', name: '2015 + 383 Diamonds', amount: 2015, bonus: 383, price: 39.99, currency: 'USD', active: true, moogoldProductId: '4700160' },
      { id: 'pkg-ml-10', gameId: 'mlbb', name: 'Weekly Pass', amount: 0, bonus: 0, price: 1.49, currency: 'USD', active: true, special: 'weekly', moogoldProductId: '4690783' },
      { id: 'pkg-ml-11', gameId: 'mlbb', name: 'Twilight Pass', amount: 0, bonus: 0, price: 9.99, currency: 'USD', active: true, special: 'twilight', moogoldProductId: '4690786' },

      // Free Fire
      { id: 'pkg-ff-1', gameId: 'freefire', name: '100 Diamonds', amount: 100, bonus: 0, price: 1.29, currency: 'USD', active: true },
      { id: 'pkg-ff-2', gameId: 'freefire', name: '310 Diamonds', amount: 310, bonus: 10, price: 3.99, currency: 'USD', active: true },
      { id: 'pkg-ff-3', gameId: 'freefire', name: '520 Diamonds', amount: 520, bonus: 20, price: 6.49, currency: 'USD', active: true },
      { id: 'pkg-ff-4', gameId: 'freefire', name: '1060 Diamonds', amount: 1060, bonus: 60, price: 12.99, currency: 'USD', active: true },
      { id: 'pkg-ff-5', gameId: 'freefire', name: '2180 Diamonds', amount: 2180, bonus: 150, price: 25.99, currency: 'USD', active: true },
      { id: 'pkg-ff-6', gameId: 'freefire', name: 'Weekly Membership', amount: 0, bonus: 0, price: 1.99, currency: 'USD', active: true, special: 'weekly' },

      // PUBG Mobile
      { id: 'pkg-pg-1', gameId: 'pubgm', name: '60 UC', amount: 60, bonus: 0, price: 0.99, currency: 'USD', active: true },
      { id: 'pkg-pg-2', gameId: 'pubgm', name: '325 UC', amount: 325, bonus: 25, price: 4.99, currency: 'USD', active: true },
      { id: 'pkg-pg-3', gameId: 'pubgm', name: '660 UC', amount: 660, bonus: 60, price: 9.99, currency: 'USD', active: true },
      { id: 'pkg-pg-4', gameId: 'pubgm', name: '1800 UC', amount: 1800, bonus: 200, price: 24.99, currency: 'USD', active: true },
      { id: 'pkg-pg-5', gameId: 'pubgm', name: '3850 UC', amount: 3850, bonus: 500, price: 49.99, currency: 'USD', active: true },

      // Honor of Kings
      { id: 'pkg-hk-1', gameId: 'hok', name: '60 Tokens', amount: 60, bonus: 0, price: 0.99, currency: 'USD', active: true },
      { id: 'pkg-hk-2', gameId: 'hok', name: '300 Tokens', amount: 300, bonus: 20, price: 4.99, currency: 'USD', active: true },
      { id: 'pkg-hk-3', gameId: 'hok', name: '980 Tokens', amount: 980, bonus: 80, price: 14.99, currency: 'USD', active: true },
      { id: 'pkg-hk-4', gameId: 'hok', name: '1980 Tokens', amount: 1980, bonus: 200, price: 29.99, currency: 'USD', active: true }
    ],
    orders: [],
    sessions: {},
    settings: {
      colors: {
        heading: '#F4F6FB',
        body: '#9AA3B8',
        accent: '#FFB84D',
        pkgFill: null,   // optional global background color for package cards on /topup — falls back to the theme default if unset
        pkgStroke: null, // optional global border color for package cards on /topup — falls back to the theme default if unset
        pkgShadow: null, // optional global drop-shadow color for package cards
        priceFill: null,   // optional text color for the price ("$1.75") on package cards
        priceStroke: null, // optional text outline color for the price
        priceShadow: null  // optional text-shadow color for the price
      },
      profileImage: null,  // filename inside public/uploads/, e.g. "profile.jpg"
      coverImage: null,    // filename inside public/uploads/, e.g. "cover.jpg" (legacy, kept for backward compat)
      coverImages: [],     // array of filenames inside public/uploads/ — used for the /topup cover carousel
      pageBackgroundColor: null,  // hex color for the area below the carousel on /topup, e.g. "#1a0f2e"
      pageBackgroundImage: null,  // filename inside public/uploads/ — overrides pageBackgroundColor if set
      brandGlowColor1: null,  // hex color for the "Wanfunzy" logo glow effect (primary), defaults to violet if unset
      brandGlowColor2: null,  // hex color for the "Wanfunzy" logo glow effect (secondary), defaults to amber if unset
      brandNameEffect: 'fantasy-gold',     // 'none' | 'glow' | 'glow-sweep' | 'glow-rays' | 'glow-zoom' | 'fantasy-gold' | 'fantasy-gold-zoom'
      safetyBadgeEffect: 'fantasy-gold', // 'none' | 'shimmer' | 'glow-zoom' | 'fantasy-gold' | 'fantasy-gold-zoom'
      brandTextAnimEnabled: true,  // independent toggle: letters of "Wanfunzy" bounce one-by-one on a loop
      brandTextAnimSpeed: 'normal', // 'slow' | 'normal' | 'fast' — how fast the bounce loop runs
      brandLogoAnimEnabled: true,  // independent toggle: the round mascot icon next to the name bobs/tilts
      brandLogoAnimSpeed: 'normal', // 'slow' | 'normal' | 'fast'
      socialLinks: {
        telegram: 'https://t.me/wanfunzy',
        facebook: null,
        youtube: null,
        tiktok: null
      },
      socialIcons: {
        telegram: null,  // filename inside public/uploads/ — admin-uploaded logo image
        facebook: null,
        youtube: null,
        tiktok: null
      },
      gameLogos: {},       // { [gameId]: filename inside public/uploads/ }
      cardBackgrounds: {},  // { [gameId]: filename inside public/uploads/ } — optional single photo/video behind each package card on /topup
      cardBackgroundSlides: {}, // { [gameId]: [filenames] } — optional multi-image slideshow (max 8) shown instead of a single cardBackgrounds image when present
      starfieldVideo: null  // optional admin-uploaded video (mp4/webm) shown as a shooting-star/meteor overlay on every page, in place of the built-in CSS animation
    }
  };
}

function readDB() {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Corrupt file fallback — reseed rather than crash the server.
    data = buildSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return data;
  }
  // Backfill fields added in later versions, so existing db.json files
  // created before this field existed don't crash the server.
  if (!data.settings) {
    data.settings = {
      colors: { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' },
      profileImage: null,
      coverImage: null,
      gameLogos: {}
    };
  }
  if (!data.settings.colors) {
    data.settings.colors = { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D', pkgFill: null, pkgStroke: null, pkgShadow: null, priceFill: null, priceStroke: null, priceShadow: null };
  }
  if (data.settings.colors.pkgFill === undefined) data.settings.colors.pkgFill = null;
  if (data.settings.colors.pkgStroke === undefined) data.settings.colors.pkgStroke = null;
  if (data.settings.colors.pkgShadow === undefined) data.settings.colors.pkgShadow = null;
  if (data.settings.colors.priceFill === undefined) data.settings.colors.priceFill = null;
  if (data.settings.colors.priceStroke === undefined) data.settings.colors.priceStroke = null;
  if (data.settings.colors.priceShadow === undefined) data.settings.colors.priceShadow = null;
  if (data.settings.gameLogos === undefined) {
    data.settings.gameLogos = {};
  }
  if (data.settings.cardBackgrounds === undefined) {
    data.settings.cardBackgrounds = {};
  }
  if (data.settings.cardBackgroundSlides === undefined) {
    data.settings.cardBackgroundSlides = {};
  }
  if (data.settings.starfieldVideo === undefined) {
    data.settings.starfieldVideo = null;
  }
  if (data.settings.sectionImages === undefined) {
    data.settings.sectionImages = {};
  }
  if (data.settings.packageIconImages === undefined) {
    data.settings.packageIconImages = {};
  }
  if (data.settings.profileImage === undefined) data.settings.profileImage = null;
  if (data.settings.coverImage === undefined) data.settings.coverImage = null;
  if (data.settings.coverImages === undefined) data.settings.coverImages = [];
  if (data.settings.pageBackgroundColor === undefined) data.settings.pageBackgroundColor = null;
  if (data.settings.pageBackgroundImage === undefined) data.settings.pageBackgroundImage = null;
  if (data.settings.brandGlowColor1 === undefined) data.settings.brandGlowColor1 = null;
  if (data.settings.brandGlowColor2 === undefined) data.settings.brandGlowColor2 = null;
  if (data.settings.brandNameEffect === undefined) data.settings.brandNameEffect = 'fantasy-gold';
  if (data.settings.safetyBadgeEffect === undefined) data.settings.safetyBadgeEffect = 'fantasy-gold';
  // Migrate the old single brandNameReadAnimation toggle (if present from
  // an earlier version of this file) into the two new independent ones,
  // so existing saved preferences aren't lost.
  const legacyAnim = data.settings.brandNameReadAnimation;
  if (data.settings.brandTextAnimEnabled === undefined) {
    data.settings.brandTextAnimEnabled = legacyAnim !== false;
  }
  if (data.settings.brandLogoAnimEnabled === undefined) {
    data.settings.brandLogoAnimEnabled = legacyAnim !== false;
  }
  if (data.settings.brandTextAnimSpeed === undefined) data.settings.brandTextAnimSpeed = 'normal';
  if (data.settings.brandLogoAnimSpeed === undefined) data.settings.brandLogoAnimSpeed = 'normal';
  if (!data.settings.socialLinks) {
    data.settings.socialLinks = { telegram: 'https://t.me/wanfunzy', facebook: null, youtube: null, tiktok: null };
  }
  if (!data.settings.socialIcons) {
    data.settings.socialIcons = { telegram: null, facebook: null, youtube: null, tiktok: null };
  }
  return data;
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function genOrderCode() {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `WF-${code}`;
}

const UPLOADS_DIR = path.join(PERSIST_DIR, 'uploads');
const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
// Video is only accepted where the caller explicitly opts in (currently:
// the per-game "Background Banner" upload) — everywhere else (logos,
// package icons, KHQR image, etc.) stays image-only exactly as before.
const ALLOWED_VIDEO_TYPES = {
  'video/mp4': '.mp4',
  'video/webm': '.webm'
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — images
const MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — short/compressed banner clips

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Accepts a data URL like "data:image/png;base64,...." and writes the decoded
// bytes to public/uploads/<random-name>.<ext>. Returns the filename (not the
// full path) on success, or throws on invalid/oversized input.
// Pass { allowVideo: true } to also accept data:video/mp4 or data:video/webm
// (used only by the per-game Background Banner upload, which supports a
// short looping clip instead of a static image).
function saveUploadedImage(dataUrl, prefix, opts) {
  opts = opts || {};
  ensureUploadsDir();
  const combinedTypes = opts.allowVideo
    ? Object.assign({}, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES)
    : ALLOWED_IMAGE_TYPES;
  const mimePattern = Object.keys(combinedTypes).map(m => m.replace('/', '\\/')).join('|');
  const match = new RegExp(`^data:(${mimePattern});base64,(.+)$`).exec(dataUrl || '');
  if (!match) {
    throw new Error(opts.allowVideo
      ? 'Unsupported format. Use JPG, PNG, WEBP, MP4, or WEBM.'
      : 'Unsupported image format. Use JPG, PNG, or WEBP.');
  }
  const mimeType = match[1];
  const base64Data = match[2];
  const ext = combinedTypes[mimeType];
  const isVideo = mimeType.startsWith('video/');
  const buffer = Buffer.from(base64Data, 'base64');

  const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.length > maxBytes) {
    throw new Error(isVideo ? 'Video is too large (max 20MB).' : 'Image is too large (max 5MB).');
  }

  // Defense-in-depth: strip anything that isn't a safe filename character
  // from the prefix before using it to build a path. All current call
  // sites pass hardcoded strings (e.g. 'gamelogo-mlbb'), so this never
  // changes existing behavior — it just guards against a future caller
  // accidentally passing unsanitized input straight through to the
  // filesystem path.
  const safePrefix = String(prefix || 'upload').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'upload';

  const filename = `${safePrefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return filename;
}

function deleteUploadedImage(filename) {
  if (!filename) return;
  // Defense-in-depth: only allow deleting files whose name matches exactly
  // what saveUploadedImage() generates (safe chars + known extensions),
  // and confirm the resolved path stays inside UPLOADS_DIR. Prevents any
  // path-traversal style filename (e.g. "../../server.js") from ever being
  // passed through to fs.unlinkSync, even though current callers only ever
  // pass back filenames that came from saveUploadedImage() in the first
  // place.
  if (!/^[a-zA-Z0-9_-]+-[a-z0-9]+-[a-f0-9]+\.(jpg|png|webp|mp4|webm)$/.test(filename)) return;
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!filePath.startsWith(UPLOADS_DIR)) return;
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore — non-critical cleanup */ }
  }
}

function getUploadsDir() {
  return UPLOADS_DIR;
}

module.exports = {
  readDB,
  writeDB,
  hashPassword,
  verifyPassword,
  genId,
  genOrderCode,
  ensureDataFile,
  saveUploadedImage,
  deleteUploadedImage,
  ensureUploadsDir,
  getUploadsDir
};
