'use strict';
const STRINGS = {
  en: {
    nav_home: 'Home', nav_change_game: 'Change Game', nav_contact: 'Contact', nav_track: 'Track Order', nav_terms: 'Terms',
    step_player: 'Player Info', step_package: 'Choose Package', step_pay: 'Payment',
    label_player_id: 'Player ID', label_server_id: 'Zone ID (Server)',
    hint_player_id: 'e.g. 123456789', hint_server_id: 'e.g. 2014',
    btn_validate: 'Verify Account', btn_buy: 'Buy Now',
    validated_ok: '✓ Player verified', validated_skip: '✓ Player ID + Zone ID correct',
    pay_scan: 'Scan to Pay', pay_amount: 'Amount', pay_expire: 'Expires in',
    pay_open_bank: '📱 Open Bank App', pay_copy: '📋 Copy QR',
    pay_copied: '✅ Copied!', pay_cancel: 'Cancel',
    order_success: '✅ Payment successful!', order_delivering: 'Diamond is being delivered...',
    err_player_id: 'Player ID must be 4–20 digits', err_server_id: 'Invalid Zone ID',
    err_no_package: 'Please select a package', footer_rights: 'All rights reserved.'
  },
  km: {
    nav_home: 'ទំព័រដើម', nav_change_game: 'ប្តូរ Game', nav_contact: 'ទំនាក់ទំនង', nav_track: 'តាមដាន Order', nav_terms: 'លក្ខខណ្ឌ',
    step_player: 'ព័ត៌មានអ្នកលេង', step_package: 'ជ្រើសរើសកញ្ចប់', step_pay: 'ការទូទាត់',
    label_player_id: 'Player ID', label_server_id: 'Zone ID (Server)',
    hint_player_id: 'ឧ. 123456789', hint_server_id: 'ឧ. 2014',
    btn_validate: 'ពិនិត្យគណនី', btn_buy: 'ទិញឥឡូវ',
    validated_ok: '✓ Player ត្រឹមត្រូវ', validated_skip: '✓ Player ID + Zone ID ត្រឹមត្រូវ',
    pay_scan: 'ស្កេន QR ដើម្បីបង់', pay_amount: 'ចំនួនទឹកប្រាក់', pay_expire: 'អស់សុពលភាពក្នុង',
    pay_open_bank: '📱 បើ App ធនាគារ', pay_copy: '📋 Copy QR',
    pay_copied: '✅ បានចម្លង!', pay_cancel: 'បោះបង់',
    order_success: '✅ ទូទាត់ជោគជ័យ!', order_delivering: 'Diamond កំពុងបញ្ចូល...',
    err_player_id: 'Player ID ត្រូវតែជាលេខ (4-20 ខ្ទង់)', err_server_id: 'Zone ID មិនត្រឹមត្រូវ',
    err_no_package: 'សូមជ្រើសរើសកញ្ចប់សិន', footer_rights: 'រក្សាសិទ្ធិគ្រប់យ៉ាង។'
  }
};

function t(lang, key) {
  const l = (lang === 'en') ? 'en' : 'km';
  return STRINGS[l][key] || STRINGS['km'][key] || key;
}

function resolveLang(req) {
  if (!req || !req.headers) return 'km';
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('lang='));
  if (cookie) { const v = cookie.split('=')[1]; if (v === 'en' || v === 'km') return v; }
  return 'km';
}

module.exports = { t, resolveLang, STRINGS };
