'use strict';
// views/i18n.js — central bilingual dictionary. Every user-facing string
// lives here keyed by a short id. Views call t(lang, 'key') to render the
// right language.

const STRINGS = {
  nav_change_game: { en: '← Change Game', km: '← ប្តូរ Game' },
  nav_contact:     { en: 'Contact',        km: 'Contact' },
  nav_home:        { en: 'Home',           km: 'Home' },
  nav_topup:       { en: 'Top Up',         km: 'Top Up' },
  nav_track:       { en: 'Track Order',    km: 'តាមដាន Order' },
  nav_terms:       { en: 'Terms',          km: 'លក្ខខណ្ឌ' },
  menu_title:      { en: 'Menu',           km: 'ម៉ឺនុយ' },
  lang_label:      { en: 'EN',             km: 'ខ្មែរ' },

  landing_heading: { en: 'Top Up', km: 'Top Up' },

  topping_up_for:  { en: 'Topping up for', km: 'កំពុងបញ្ចូលសម្រាប់' },
  step1_title:     { en: '', km: '' },
  step2_title:     { en: '', km: '' },
  step3_title:     { en: 'Contact & Payment', km: 'ទំនាក់ទំនង និងទូទាត់' },

  label_player_id: { en: 'Player ID',          km: 'Player ID' },
  label_server_id: { en: 'Zone ID (Server)',   km: 'Zone ID (Server)' },
  ph_player_id:    { en: 'e.g. 123456789',     km: 'ឧ. 123456789' },
  ph_server_id:    { en: 'e.g. 2001',          km: 'ឧ. 2001' },
  hint_player_id:  { en: 'MLBB → Profile → ID number below your username', km: 'MLBB → Profile → លេខ ID ក្រោម username' },
  hint_server_id:  { en: 'MLBB → Profile → number in brackets e.g. (2001)', km: 'MLBB → Profile → លេខក្នុងវង់ក្រចក ឧ. (2001)' },

  btn_validate:    { en: 'Verify Account', km: 'ពិនិត្យគណនី' },
  btn_validated:   { en: '✓ Verified',     km: '✓ បានពិនិត្យ' },
  hint_validate_first: {
    en: 'Before paying, please check "I agree to the TERMS AND CONDITIONS" below to enable the Pay button',
    km: 'មុនពេលបង់លុយ សូមចុចធីក "I agree TERMS AND CONDITIONS" ខាងក្រោមជាមុនសិន ទើបប៊ូតុង Pay អាចប្រើបាន'
  },
  hint_pick_package:   { en: 'Tap a package to select it', km: 'ចុចលើកញ្ចប់ណាមួយ ដើម្បីជ្រើសរើស' },

  band_promo:    { en: 'Special Offers', km: 'ការបញ្ចុះតម្លៃ' },
  band_packages: { en: 'Packages',       km: 'កញ្ចប់' },

  label_contact: { en: 'Phone or Telegram (so we can reach you)', km: 'លេខទូរស័ព្ទ ឬ Telegram (សម្រាប់ទាក់ទងវិញ)' },
  ph_contact:    { en: 'e.g. 0961234567 or @username', km: 'ឧ. 0961234567 ឬ @username' },
  label_note:    { en: 'Note (optional)', km: 'កំណត់ចំណាំ (មិនទាមទារ)' },
  ph_note:       { en: 'Extra info...',   km: 'ព័ត៌មានបន្ថែម...' },

  agree_terms: {
    en: 'I agree TERMS AND CONDITIONS',
    km: 'I agree TERMS AND CONDITIONS'
  },
  err_agree_terms: {
    en: 'Please agree to the Terms and Conditions first',
    km: 'សូមចុចយល់ព្រម Terms and Conditions ជាមុនសិន'
  },

  total_label: { en: 'Total:',           km: 'សរុប៖' },
  btn_buy:     { en: 'Buy Now',          km: 'ទិញឥឡូវនេះ' },
  btn_buying:  { en: 'Placing order...', km: 'កំពុងដាក់ Order...' },

  khqr_auto_title:     { en: 'Scan KHQR to pay', km: 'ស្កេន KHQR ដើម្បីទូទាត់' },
  khqr_auto_waiting:   { en: 'Waiting for your payment…', km: 'កំពុងរង់ចាំការទូទាត់របស់អ្នក…' },
  khqr_auto_paid:      { en: '✓ Payment received! Redirecting…', km: '✓ ទទួលបានការទូទាត់ហើយ! កំពុងបន្ត…' },
  khqr_auto_time_left: { en: 'Time left', km: 'ពេលនៅសល់' },
  khqr_merchant_name:  { en: 'Wanfunzy Store', km: 'ហាង Wanfunzy' },
  currency_unit:       { en: 'USD', km: 'USD' },

  err_player_id: { en: 'Player ID must be numbers (4-20 digits)', km: 'Player ID ត្រូវតែជាលេខ (4-20 ខ្ទង់)' },
  err_server_id: { en: 'Invalid Server ID', km: 'Server ID មិនត្រឹមត្រូវ' },
  err_contact:   { en: 'Please enter a phone number or Telegram', km: 'សូមបញ្ចូលលេខទូរស័ព្ទ ឬ Telegram' },
  err_generic:   { en: 'Something went wrong', km: 'មានបញ្ហាកើតឡើង' },
  err_connect:   { en: 'Could not connect to the server. Please try again.', km: 'មិនអាចភ្ជាប់ទៅ server បានទេ។ សូមព្យាយាមម្តងទៀត។' },

  footer_disclaimer: { en: 'is not officially affiliated with any game publisher.', km: 'មិនមានទំនាក់ទំនងផ្លូវការជាមួយក្រុមហ៊ុនបង្កើត game ណាមួយឡើយ។' },
  footer_contact_tg: { en: 'Contact us on Telegram →', km: 'ទាក់ទងតាម Telegram →' }
};

function t(lang, key) {
  const entry = STRINGS[String(key).trim()];
  if (!entry) return key;
  const l = (lang === 'km') ? 'km' : 'en';
  return entry[l] || entry.en || key;
}

function resolveLang(input) {
  if (!input) return 'en';
  if (typeof input === 'string') {
    if (input === 'km') return 'km';
    if (/(?:^|;\s*)lang=km(?:;|$)/.test(input)) return 'km';
    return 'en';
  }
  if (typeof input === 'object' && input.headers) {
    const cookie = input.headers.cookie || '';
    if (/(?:^|;\s*)lang=km(?:;|$)/.test(cookie)) return 'km';
  }
  return 'en';
}

module.exports = { t, resolveLang, STRINGS };
