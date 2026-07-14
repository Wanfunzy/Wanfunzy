'use strict';
// khqr.js — Bakong KHQR payment helpers (via Bakong Relay proxy)
const https = require('https');

const RELAY_BASE = process.env.BAKONG_API_BASE || 'https://api-bakong.nbc.gov.kh';

function _post(apiBase, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const isRelay  = apiBase.includes('bakongrelay');
    const hostname = new URL(apiBase).hostname;
    const basePath = new URL(apiBase).pathname.replace(/\/$/, '');
    const headers  = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request(
      { hostname, path: basePath + path, method: 'POST', headers, timeout: 15000 },
      (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Bad JSON from Bakong: ' + data.slice(0, 100))); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Bakong timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Generate a KHQR string + md5 hash via Bakong API
function generateKhqr({ accountId, merchantName, merchantCity, amount, currency, billNumber, expireMinutes, token, apiBase }) {
  const base = apiBase || RELAY_BASE;
  const tok  = token  || process.env.BAKONG_TOKEN || '';
  const body = {
    accountID:    accountId,
    merchantName: merchantName || 'WANFUNZY',
    merchantCity: merchantCity || 'Phnom Penh',
    amount:       Number(amount),
    currency:     currency === 'KHR' ? 'KHR' : 'USD',
    billNumber:   billNumber || '',
    mobileNumber: '',
    storeLabel:   merchantName || 'WANFUNZY',
    terminalLabel: 'wanfunzy',
    expirationTimestamp: expireMinutes
      ? String(Math.floor(Date.now() / 1000) + expireMinutes * 60)
      : ''
  };
  return _post(base, '/v1/generate_khqr_by_account_id', body, tok).then(r => {
    if (!r || !r.data || !r.data.qr) throw new Error('generateKhqr failed: ' + JSON.stringify(r).slice(0, 200));
    return { qr: r.data.qr, md5: r.data.md5, expiresAt: body.expirationTimestamp ? Number(body.expirationTimestamp) * 1000 : null };
  });
}

// Check if a transaction has been paid (by md5 hash)
function checkTransactionByMd5(md5, { token, apiBase } = {}) {
  const base = apiBase || RELAY_BASE;
  const tok  = token  || process.env.BAKONG_TOKEN || '';
  return _post(base, '/v1/check_transaction_by_md5', { md5 }, tok);
}

// Verify that a Bakong transaction matches what we expect
function verifyTransaction(result, { amount, currency, accountId } = {}) {
  if (!result || !result.data) return false;
  const d = result.data;
  if (!d || d.status === undefined) return false;
  // status 0 or null = not paid, 1 = paid
  if (!d.status && d.status !== 0) return false;
  if (d.status === 0 || d.status === null || d.status === false) return false;
  if (amount && currency) {
    const paidAmt = Number(d.amount || d.transferAmount || 0);
    const paidCur = (d.currency || '').toUpperCase();
    const expAmt  = Number(amount);
    const expCur  = (currency || 'USD').toUpperCase();
    if (paidCur !== expCur) return false;
    if (paidAmt < expAmt - 0.005) return false;
  }
  if (accountId && d.toAccountId && !d.toAccountId.includes(accountId.split('@')[0])) return false;
  return true;
}

// Generate deeplink for bank app (Bakong official deeplink API)
function generateDeeplink(qr, { appName, appIconUrl, callback } = {}, { token, apiBase } = {}) {
  const base = apiBase || RELAY_BASE;
  const tok  = token  || process.env.BAKONG_TOKEN || '';
  return _post(base, '/v1/generate_deeplink_by_qr_code', {
    qrCode: qr,
    sourceInfo: { appName: appName || 'Wanfunzy', appIconUrl: appIconUrl || '', appDeepLinkCallback: callback || '' }
  }, tok);
}

module.exports = { generateKhqr, checkTransactionByMd5, verifyTransaction, generateDeeplink };
