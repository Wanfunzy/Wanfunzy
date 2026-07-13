// khqr.js — KHQR (Bakong) payment helpers, zero external dependencies.
//
// AUDIT FIXES (v2):
//   [BUG-1] generateKhqr was appending a CSS <style> block directly onto the
//           QR data string ("qr: qr + forcedCssStyle"). On the first package
//           selection this sometimes survived because the QR renderer ignored
//           trailing garbage, but on every subsequent package change the
//           accumulated / re-injected CSS corrupted the EMV payload and made
//           the code un-scannable.  FIX: QR string is now returned pure
//           (only EMV TLV + CRC16).  Aspect-ratio styling belongs in CSS/HTML.
//   [BUG-2] safeSliceByByte had an infinite-loop risk when the input was
//           already within budget — the inner while-loop mutated the wrong
//           variable (`str` instead of `res`).  FIX: rewritten cleanly.
//   [SEC-1] billNumber sanitisation now also strips characters outside the
//           ANS character set allowed by EMV field 62-01 (alphanumeric only).
//           Already present but made explicit.
//   [STYLE] Removed the dead `forcedCssStyle` constant entirely so no future
//           developer accidentally re-enables it.

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ---------- EMV TLV helpers ----------

function tlv(tag, value) {
  const v = String(value);
  const byteLength = Buffer.byteLength(v, 'utf8');
  if (byteLength > 99) throw new Error(`KHQR field ${tag} too long (${byteLength} bytes)`);
  return tag + String(byteLength).padStart(2, '0') + v;
}

function crc16(str) {
  let crc = 0xffff;
  const buf = Buffer.from(str, 'utf8');
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// [BUG-2 FIX] Rewritten — was mutating `str` but checking `res` length.
function safeSliceByByte(str, maxBytes) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  // Walk codepoints until we exceed the byte budget.
  let byteCount = 0;
  let i = 0;
  for (const char of str) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (byteCount + charBytes > maxBytes) break;
    byteCount += charBytes;
    i += char.length; // handles surrogate pairs
  }
  return str.slice(0, i);
}

const CURRENCY_CODES = { USD: '840', KHR: '116' };

// ---------- QR generation ----------

function generateKhqr(opts) {
  const accountId = String(opts.accountId || '').trim();
  const merchantName = safeSliceByByte(String(opts.merchantName || 'Wanfunzy').trim(), 25);
  const merchantCity = safeSliceByByte(String(opts.merchantCity || 'Phnom Penh').trim(), 15);
  const currency = (opts.currency || 'USD').toUpperCase();

  // Bill number: alphanumeric only, 12 chars, left-padded with zeros.
  const rawBill = String(opts.billNumber || '').trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!rawBill) throw new Error('Bill number is required for dynamic KHQR');
  const billNumber = rawBill.slice(0, 12).padStart(12, '0');

  if (!accountId || !accountId.includes('@')) throw new Error('Invalid Bakong account ID');
  if (!CURRENCY_CODES[currency]) throw new Error('Unsupported currency: ' + currency);

  // Amount — always 2 decimal places for USD, integer string for KHR.
  const parsedAmount = Number(opts.amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error('Invalid amount');
  const amountStr = currency === 'USD' ? parsedAmount.toFixed(2) : String(Math.round(parsedAmount));

  // Timestamp floored to the minute so the QR string (and its MD5) is stable
  // within the same minute — avoids unnecessary re-renders on hot-reload.
  const expireMinutes = Number(opts.expireMinutes) > 0 ? Number(opts.expireMinutes) : 10;
  const createdAt = Math.floor(Date.now() / 60000) * 60000;
  const expiresAt = createdAt + expireMinutes * 60 * 1000;

  // Build EMV TLV string.
  let qr = '';
  qr += tlv('00', '01');
  qr += tlv('01', '12');
  qr += tlv('29', tlv('00', accountId));
  qr += tlv('52', '5999');
  qr += tlv('53', CURRENCY_CODES[currency]);
  qr += tlv('54', amountStr);
  qr += tlv('58', 'KH');
  qr += tlv('59', merchantName);
  qr += tlv('60', merchantCity);
  qr += tlv('62', tlv('01', billNumber));
  qr += tlv('99', tlv('00', String(createdAt)) + tlv('01', String(expiresAt)));
  qr += '6304';
  qr += crc16(qr);

  const md5 = crypto.createHash('md5').update(qr).digest('hex');

  // [BUG-1 FIX] Return the pure EMV QR string only.
  // Do NOT append CSS, HTML, or any other content here — it corrupts the
  // payload and breaks scanning on every package change after the first.
  // Aspect-ratio / sizing CSS belongs in your stylesheet or <img> class.
  return {
    qr,        // pure EMV TLV string — safe to pass to any QR encoder
    md5,
    expiresAt,
    amount: amountStr,
    currency
  };
}

// ---------- Transaction check ----------

function checkTransactionByMd5(md5, config) {
  return new Promise((resolve, reject) => {
    let base;
    try {
      base = new URL(config.apiBase);
    } catch (e) {
      return reject(new Error('Invalid BAKONG_API_BASE URL'));
    }
    const payload = JSON.stringify({ md5: String(md5) });
    const lib = base.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === 'http:' ? 80 : 443),
        path: base.pathname.replace(/\/$/, '') + '/v1/check_transaction_by_md5',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: 'Bearer ' + config.token
        },
        timeout: 10000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Bad JSON from payment API (HTTP ' + res.statusCode + ')'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Payment API timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------- Deeplink generation ----------

function generateDeeplink(qrString, appInfo, config) {
  return new Promise((resolve, reject) => {
    let base;
    try {
      base = new URL(config.apiBase);
    } catch (e) {
      return reject(new Error('Invalid BAKONG_API_BASE URL'));
    }
    const payload = JSON.stringify({
      qr: String(qrString),
      sourceInfo: {
        appIconUrl: appInfo.appIconUrl || '',
        appName: appInfo.appName || 'Wanfunzy',
        appDeepLinkCallback: appInfo.callback || ''
      }
    });
    const lib = base.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === 'http:' ? 80 : 443),
        path: base.pathname.replace(/\/$/, '') + '/v1/generate_deeplink_by_qr',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: 'Bearer ' + config.token
        },
        timeout: 10000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Bad JSON from deeplink API (HTTP ' + res.statusCode + ')'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Deeplink API timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { generateKhqr, checkTransactionByMd5, generateDeeplink, crc16 };
