'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERSIST_DIR = process.env.PERSIST_DIR || path.join(__dirname, 'persist');
const DB_PATH     = path.join(PERSIST_DIR, 'db.json');
const UPLOADS_DIR = path.join(PERSIST_DIR, 'uploads');

function getUploadsDir() { return UPLOADS_DIR; }

function ensureDataFile() {
  if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const hash = crypto.createHash('sha256').update('wanfunzy123').digest('hex');
    const init = {
      games: [
        { id: 'mlbb', name: 'Mobile Legends: Bang Bang', shortName: 'MLBB', icon: 'mlbb', currencyLabel: 'Diamonds', currencyUnit: '💎', requiresServerId: true, active: true },
        { id: 'freefire', name: 'Free Fire', shortName: 'Free Fire', icon: 'freefire', currencyLabel: 'Diamonds', currencyUnit: '💎', requiresServerId: false, active: true },
        { id: 'pubgm', name: 'PUBG Mobile', shortName: 'PUBG Mobile', icon: 'pubgm', currencyLabel: 'UC', currencyUnit: 'UC', requiresServerId: false, active: true },
        { id: 'hok', name: 'Honor of Kings', shortName: 'Honor of Kings', icon: 'hok', currencyLabel: 'Tokens', currencyUnit: 'Token', requiresServerId: false, active: true }
      ],
      packages: [],
      orders: [],
      admins: [{ username: 'admin', passwordHash: hash }],
      sessions: {},
      settings: {
        colors: { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' },
        socialLinks: {},
        socialIcons: {},
        gameLogos: {},
        cardBackgrounds: {},
        packageIconImages: {},
        specialOfferImages: {},
        packageImages: {},
        sectionImages: {},
        sectionEmojis: {},
        brandNameEffect: 'fantasy-gold',
        safetyBadgeEffect: 'shimmer',
        brandTextAnimEnabled: true,
        brandTextAnimSpeed: 'normal',
        brandGlowColor1: '#FFD700',
        brandGlowColor2: '#3DB8FF'
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    console.log('[DB] Initialized fresh database at', DB_PATH);
  }
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.sessions)          data.sessions = {};
    if (!data.settings)          data.settings = {};
    if (!data.settings.colors)   data.settings.colors = { heading: '#F4F6FB', body: '#9AA3B8', accent: '#FFB84D' };
    if (!data.settings.socialLinks)        data.settings.socialLinks = {};
    if (!data.settings.socialIcons)        data.settings.socialIcons = {};
    if (!data.settings.gameLogos)          data.settings.gameLogos = {};
    if (!data.settings.cardBackgrounds)    data.settings.cardBackgrounds = {};
    if (!data.settings.packageIconImages)  data.settings.packageIconImages = {};
    if (!data.settings.specialOfferImages) data.settings.specialOfferImages = {};
    if (!data.settings.packageImages)      data.settings.packageImages = {};
    if (!data.settings.sectionImages)      data.settings.sectionImages = {};
    if (!data.settings.sectionEmojis)      data.settings.sectionEmojis = {};
    return data;
  } catch (e) {
    console.error('[DB] readDB error:', e.message);
    throw e;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[DB] writeDB error:', e.message);
    throw e;
  }
}

function genId(prefix) {
  return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function genOrderCode() {
  return 'WF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function verifyPassword(plain, hash) {
  const h = crypto.createHash('sha256').update(plain).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

function hashPassword(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function saveUploadedImage(dataUrl, filename) {
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  const ext  = match[1].split('/')[1].replace('jpeg', 'jpg');
  const data = Buffer.from(match[2], 'base64');
  if (data.length > 5 * 1024 * 1024) throw new Error('Image too large (max 5MB)');
  const fname = (filename || ('img-' + Date.now())) + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), data);
  return fname;
}

function deleteUploadedImage(filename) {
  if (!filename) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch (e) { /* ignore */ }
}

module.exports = {
  ensureDataFile, ensureUploadsDir,
  readDB, writeDB,
  genId, genOrderCode,
  verifyPassword, hashPassword,
  saveUploadedImage, deleteUploadedImage,
  getUploadsDir
};
