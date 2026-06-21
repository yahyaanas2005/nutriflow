'use strict';
// ============================================================
// NutriFlow — IndexedDB persistence layer
//
// Storage choice: IndexedDB primary + localStorage write-through cache.
// Rationale: static SPA (no server, no npm). IndexedDB provides
// multi-GB async storage with per-record keying; localStorage is kept
// as a sync cache so the render pipeline stays non-async.
//
// Schema (v1):
//   profiles  — {id, name, email, avatar, createdAt}
//   state     — {profileId (pk), data (full state blob), updatedAt}
// ============================================================
const DB = (() => {
  const NAME    = 'nutriflow_db';
  const VERSION = 1;
  let _db = null;

  // ----------------------------------------------------------
  // Open / upgrade
  // ----------------------------------------------------------
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'profileId' });
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror   = (e) => reject(e.target.error);
      req.onblocked = ()  => reject(new Error('IndexedDB blocked — close other tabs and retry'));
    });
  }

  // ----------------------------------------------------------
  // Low-level IDB helpers
  // ----------------------------------------------------------
  function _store(name, mode) {
    return _db.transaction(name, mode).objectStore(name);
  }
  function _get(store, key) {
    return new Promise((res, rej) => {
      const r = store.get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  }
  function _put(store, val) {
    return new Promise((res, rej) => {
      const r = store.put(val);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }
  function _del(store, key) {
    return new Promise((res, rej) => {
      const r = store.delete(key);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }
  function _getAll(store) {
    return new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result ?? []);
      r.onerror   = () => rej(r.error);
    });
  }

  // ----------------------------------------------------------
  // Profile CRUD
  // ----------------------------------------------------------
  async function getProfiles() {
    await open();
    const list = await _getAll(_store('profiles', 'readonly'));
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  async function createProfile(name, email = '') {
    await open();
    const profile = {
      id:        'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name:      name.trim() || 'User',
      email:     email.trim(),
      avatar:    name.trim().charAt(0).toUpperCase() || 'U',
      createdAt: Date.now(),
    };
    await _put(_store('profiles', 'readwrite'), profile);
    return profile;
  }

  async function updateProfile(id, changes) {
    await open();
    const existing = await _get(_store('profiles', 'readonly'), id);
    if (!existing) return null;
    const updated = { ...existing, ...changes };
    await _put(_store('profiles', 'readwrite'), updated);
    return updated;
  }

  async function deleteProfile(profileId) {
    await open();
    // Delete in parallel — each needs its own transaction
    await Promise.all([
      _del(_store('profiles', 'readwrite'), profileId),
      _del(_store('state',    'readwrite'), profileId),
    ]);
    localStorage.removeItem('nutriflow_state_' + profileId);
    if (localStorage.getItem('nutriflow_last_profile') === profileId) {
      localStorage.removeItem('nutriflow_last_profile');
    }
  }

  // ----------------------------------------------------------
  // State persistence
  // ----------------------------------------------------------
  async function saveState(profileId, stateObj) {
    await open();
    // localStorage write-through cache (sync, for fast startup)
    try {
      localStorage.setItem('nutriflow_state_' + profileId, JSON.stringify(stateObj));
    } catch(e) { /* quota exceeded — continue with IDB */ }
    // IndexedDB primary store (async)
    await _put(_store('state', 'readwrite'), {
      profileId,
      data:      stateObj,
      updatedAt: Date.now(),
    });
  }

  async function loadState(profileId) {
    await open();
    // Try IndexedDB first (source of truth)
    const record = await _get(_store('state', 'readonly'), profileId);
    if (record && record.data) return record.data;
    // Fall back to localStorage cache
    const lsRaw = localStorage.getItem('nutriflow_state_' + profileId)
                || localStorage.getItem('nutriflow_state');       // legacy key
    if (lsRaw) {
      try {
        const parsed = JSON.parse(lsRaw);
        // Opportunistically migrate legacy data into IDB
        saveState(profileId, parsed).catch(() => {});
        return parsed;
      } catch { return null; }
    }
    return null;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------
  return {
    open,
    getProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    saveState,
    loadState,
    // Expose for diagnostics / settings page
    dbName: NAME,
    dbVersion: VERSION,
  };
})();
