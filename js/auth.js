// Autenticazione admin con PIN.
// PIN hashato con SHA-256 + salt; salvato in IndexedDB.settings.
// Gestione timeout inattività: timer reset su pointerdown/touchstart, allo scadere logout admin.

import { getSetting, setSetting } from './db.js';

const SALT = 'magazzino-pizzeria-v1-salt';

async function sha256(s) {
  const buf = new TextEncoder().encode(SALT + ':' + s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hasPin() {
  const h = await getSetting('adminPinHash');
  return !!h;
}

export async function setPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('Il PIN deve essere da 4 a 6 cifre.');
  const hash = await sha256(pin);
  await setSetting('adminPinHash', hash);
}

export async function verifyPin(pin) {
  const expected = await getSetting('adminPinHash');
  if (!expected) return false;
  const hash = await sha256(pin);
  return hash === expected;
}

export async function changePin(oldPin, newPin) {
  const ok = await verifyPin(oldPin);
  if (!ok) throw new Error('PIN attuale errato.');
  await setPin(newPin);
}

// ============ Timeout inattività ============
let _timer = null;
let _onExpire = null;
let _timeoutMs = 120000;
let _listenerActive = false;
let _expiresAt = 0;

function _onActivity() {
  if (!_onExpire) return;
  _expiresAt = Date.now() + _timeoutMs;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _stopListeners();
    const fn = _onExpire;
    _onExpire = null;
    if (fn) fn();
  }, _timeoutMs);
}

function _startListeners() {
  if (_listenerActive) return;
  _listenerActive = true;
  ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach((evt) => {
    window.addEventListener(evt, _onActivity, { passive: true });
  });
}

function _stopListeners() {
  if (!_listenerActive) return;
  _listenerActive = false;
  ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach((evt) => {
    window.removeEventListener(evt, _onActivity);
  });
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _expiresAt = 0;
}

export function startInactivityTimer(timeoutMs, onExpire) {
  _timeoutMs = timeoutMs;
  _onExpire = onExpire;
  _startListeners();
  _onActivity();
}

export function stopInactivityTimer() {
  _onExpire = null;
  _stopListeners();
}

export function remainingMs() {
  if (!_expiresAt) return 0;
  return Math.max(0, _expiresAt - Date.now());
}
