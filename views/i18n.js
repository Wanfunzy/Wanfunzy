// views/i18n.js — central bilingual dictionary (English default, Khmer).
// Every user-facing string lives here keyed by a short id. Views call
// t(lang, 'key') to render the right language. The active language is
// resolved from a `lang` cookie (falling back to 'en') by the server and
// passed into each view.
//
// AUDIT (v2) — no functional bugs found in i18n.js itself.
// Minor hardening applied:
//   [HARDENING-1] t() now trims the key before lookup so accidental
//                 whitespace in call sites (" nav_home ") never silently
//                 returns the raw key string.
//   [HARDENING-2] resolveLang() guards against non-string types more
//                 explicitly (numbers, objects) that typeof !== 'string'
//                 already catches, but the comment is now clearer.
//   [STYLE]       No string content changed — all EN/KM values preserved
//                 exactly as authored.

const STRINGS = {
  // ---- Header / nav ----
  nav_change_game: { en: '← Change Game', km: '← ប្តូរ Game' },
  nav_contact:     { en: 'Contact',        km: 'ទាក់ទង' },
  nav_home:        { en: 'Home',           km: 'ទំព័រដើម' },
  nav_topup:       { en: 'Top Up',         km: 'បញ្ចូលទឹកប្រាក់' },
  nav_track:       { en: 'Track Order',    km: 'តាមដាន Order' },
  nav_terms:       { en: 'Terms',          km: 'លក្ខខណ្ឌ' },
  menu_title:      { en: 'Menu',           km: 'ម៉ឺនុយ' },
  lang_label:      { en: 'EN',             km: 'ខ្មែរ' },

  // ---- Landing (game select) ----
  landing_heading: { en: 'Top Up', km: 'Top Up' },

  // ---- Single-page order flow ----
  topping_up_for: { en: 'Topping up for',         km: 'កំពុងបញ្ចូលសម្រាប់' },
  step1_title:    { en: 'Enter your account info', km: 'បញ្ចូលព័ត៌មានរបស់អ្នក' },
  step2_title:    { en: 'Choose a package',        km: 'ជ្រើសរើសកញ្ចប់' },
  step3_title:    { en: 'Contact & Payment',       km: 'ទំនាក់ទំនង និងទូទាត់' },

  label_player_id: { en: 'Player ID', km: 'Player ID' },
  label_server_id: { en: 'Zone ID (Server)', km: 'Zone ID (Server)' },
  ph_player_id:    { en: 'e.g. 123456789', km: 'ឧ. 123456789' },
  ph_server_id:    { en: 'e.g. 2001',      km: 'ឧ. 2001' },
  hint_player_id:  { en: 'MLBB → Profile → ID number below your username', km: 'MLBB → Profile → លេខ ID ក្រោម username' },
  hint_server_id:  { en: 'MLBB → Profile → number in brackets e.g. (2001)', km: 'MLBB → Profile → លេខក្នុងវង់ក្រចក ឧ. (2001)' },

  btn_validate:      { en: 'Verify Account', km: 'ពិនិត្យគណនី' },
  btn_validated:     { en: '✓ Verified',     km: '✓ បានពិនិត្យ' },
  hint_validate_first: { en: 'Please verify your account above first', km: 'សូមពិនិត្យគណនីខាងលើជាមុនសិន' },
  hint_pick_package:   { en: 'Tap a package to select it',             km: 'ចុចលើកញ្ចប់ណាមួយ ដើម្បីជ្រើសរើស' },

  band_promo:    { en: 'Special Offers', km: 'ការបញ្ចុះតម្លៃ' },
  band_packages: { en: 'Packages',       km: 'កញ្ចប់' },

  label_contact: { en: 'Phone or Telegram (so we can reach you)', km: 'លេខទូរស័ព្ទ ឬ Telegram (សម្រាប់ទាក់ទងវិញ)' },
  ph_contact:    { en: 'e.g. 0961234567 or @username',            km: 'ឧ. 0961234567 ឬ @username' },
  label_note:    { en: 'Note (optional)',                          km: 'កំណត់ចំណាំ (មិនទាមទារ)' },
  ph_note:       { en: 'Extra info...',                            km: 'ព័ត៌មានបន្ថែម...' },

  pay_manual_name: { en: 'Pay via instructions (Telegram)', km: 'ទូទាត់តាមការណែនាំ (Telegram)' },
  pay_manual_sub:  { en: 'Owner will confirm and guide the payment', km: 'Owner នឹងទាក់ទងបញ្ជាក់ និងណែនាំការទូទាត់' },
  pay_khqr_name:   { en: 'KHQR — Scan to pay instantly',           km: 'KHQR — ស្កេនបង់ភ្លាមៗ' },
  pay_khqr_sub:    { en: 'Coming soon 🔜',                          km: 'មកដល់ឆាប់ៗនេះ 🔜' },

  khqr_scan_title: { en: 'Scan KHQR to pay', km: 'ស្កេន KHQR ដើម្បីទូទាត់' },
  khqr_scan_hint:  {
    en: 'Open any banking app (ABA, ACLEDA, Wing…), scan the QR, and pay the exact amount above. Then upload your payment screenshot below.',
    km: 'បើក app ធនាគារណាមួយ (ABA, ACLEDA, Wing…) ស្កេន QR ហើយបង់ចំនួនទឹកប្រាក់ខាងលើ។ បន្ទាប់មក upload រូបភាពបញ្ជាក់ការទូទាត់ខាងក្រោម។'
  },
  khqr_slip_label: {
    en: 'Upload payment screenshot (optional but faster)',
    km: 'Upload រូបភាពបញ្ជាក់ការទូទាត់ (ស្រេចចិត្ត តែលឿនជាង)'
  },
  khqr_not_ready: {
    en: 'Payment method is being set up. Please contact us on Telegram to complete your order.',
    km: 'វិធីទូទាត់កំពុងរៀបចំ។ សូមទាក់ទងតាម Telegram ដើម្បីបញ្ចប់ការបញ្ជាទិញ។'
  },

  total_label: { en: 'Total:',           km: 'សរុប៖' },
  btn_buy:     { en: 'Buy Now',          km: 'ទិញឥឡូវនេះ' },
  btn_buying:  { en: 'Placing order...', km: 'កំពុងដាក់ Order...' },

  // ---- KHQR auto-pay (dynamic QR + live verification) ----
  khqr_auto_title: { en: 'Scan KHQR to pay', km: 'ស្កេន KHQR ដើម្បីទូទាត់' },
  khqr_auto_notice: {
    en: 'After you tap Buy Now, a QR code with your exact amount will appear. Scan it with any banking app — your order is confirmed automatically the moment you pay.',
    km: 'បន្ទាប់ពីចុច "ទិញឥឡូវនេះ" QR ដែលមានចំនួនទឹកប្រាក់ពិតប្រាកដនឹងបង្ហាញឡើង។ ស្កេនជាមួយ app ធនាគារណាមួយ — order របស់អ្នកនឹងត្រូវបញ្ជាក់ដោយស្វ័យប្រវត្តិភ្លាមៗពេលបង់រួច។'
  },
  khqr_auto_hint: {
    en: 'Open ABA, ACLEDA, Wing or any Bakong-connected app and scan this QR.',
    km: 'បើក ABA, ACLEDA, Wing ឬ app ណាដែលភ្ជាប់ Bakong ហើយស្កេន QR នេះ។'
  },
  khqr_auto_waiting:    { en: 'Waiting for your payment…',         km: 'កំពុងរង់ចាំការទូទាត់របស់អ្នក…' },
  khqr_auto_paid:       { en: '✓ Payment received! Redirecting…',  km: '✓ ទទួលបានការទូទាត់ហើយ! កំពុងបន្ត…' },
  khqr_auto_expired: {
    en: 'QR expired. Your order was saved — contact us on Telegram with your order code, or place a new order.',
    km: 'QR ផុតកំណត់ហើយ។ Order របស់អ្នកត្រូវបានរក្សាទុក — សូមទាក់ទងតាម Telegram ជាមួយ order code របស់អ្នក ឬបញ្ជាទិញម្តងទៀត។'
  },
  khqr_auto_goto_order: { en: 'View my order',  km: 'មើល Order របស់ខ្ញុំ' },
  khqr_auto_time_left:  { en: 'Time left',       km: 'ពេលនៅសល់' },

  // Default merchant/store name shown on the KHQR pay card.
  // The view still reads settings.khqrMerchantName first (admin override).
  khqr_merchant_name: { en: 'Wanfunzy Store', km: 'ហាង Wanfunzy' },

  // Currency label displayed next to the amount on the KHQR card.
  currency_unit: { en: 'USD', km: 'USD' },

  // ---- Validation errors ----
  err_player_id: { en: 'Player ID must be numbers (4-20 digits)', km: 'Player ID ត្រូវតែជាលេខ (4-20 ខ្ទង់)' },
  err_server_id: { en: 'Invalid Server ID',                       km: 'Server ID មិនត្រឹមត្រូវ' },
  err_contact:   { en: 'Please enter a phone number or Telegram', km: 'សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Telegram' },
  err_generic:   { en: 'Something went wrong',                    km: 'មានបញ្ហាកើតឡើង' },
  err_connect:   {
    en: 'Could not connect to the server. Please try again.',
    km: 'មិនអាចភ្ជាប់ទៅ server បានទេ។ សូមព្យាយាមម្តងទៀត។'
  },

  // ---- Footer ----
  footer_disclaimer: {
    en: 'is not officially affiliated with any game publisher.',
    km: 'មិនមានទំនាក់ទំនងផ្លូវការជាមួយក្រុមហ៊ុនបង្កើត game ណាមួយឡើយ។'
  },
  footer_contact_tg: { en: 'Contact us on Telegram →', km: 'ទាក់ទងតាម Telegram →' }
};

// [HARDENING-1] Trim key so accidental whitespace in call sites never
// causes a silent miss that returns the raw key string to the user.
function t(lang, key) {
  const entry = STRINGS[String(key).trim()];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

// Resolve language safely from either a pre-parsed cookie value or a raw
// Cookie header. The server calls this with the parsed value (fast path),
// but supporting the raw header too means a mis-wired call site never
// silently falls back to English on Khmer users.
// [HARDENING-2] Defaults to English for anything that is not a non-empty
// string (null, undefined, numbers, objects, arrays, etc.).
function resolveLang(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return 'en';
  // Parsed single-cookie value
  if (cookieValue === 'km') return 'km';
  // Raw Cookie header: "theme=dark; lang=km; session=…"
  // Anchored so "lang=km-formal" or "lang=kma" does NOT match.
  return /(?:^|;\s*)lang=km(?:;|$)/.test(cookieValue) ? 'km' : 'en';
}

module.exports = { t, resolveLang, STRINGS };
