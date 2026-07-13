// moogold.js — compatibility shim for Wanfunzy
// MooGold logic is fully built into server.js (inline functions).
// This file prevents Railway from crashing if any cached build
// still references require('./moogold').
module.exports = {};
