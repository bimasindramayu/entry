// ===== ENHANCED CACHE CONFIGURATION =====
// File: config-enhanced.js

const CACHE_CONFIG_ENHANCED = {
  ENABLED: true,

  DURATION: {
    DASHBOARD_STATS: 2 * 60 * 1000,
    BUDGETS:         5 * 60 * 1000,
    RPDS:            3 * 60 * 1000,
    REALISASIS:      2 * 60 * 1000,
    VERIFIKASI:      1 * 60 * 1000,
    CONFIG:          10 * 60 * 1000,
    SUPERVISI_FILES: 5 * 60 * 1000    // ✅ cache daftar file Drive (5 menit)
  },

  AUTO_REFRESH: {
    ENABLED:  false,
    INTERVAL: 30 * 1000
  },

  INVALIDATE_ON_WRITE: true,
  DEBUG: true,

  // ✅ Anti 404 / timeout / "API is running" dari Apps Script (batas eksekusi bersamaan)
  MAX_CONCURRENT: 4,       // maks request ke Apps Script yang berjalan bersamaan per browser
  READ_RETRIES:   3,       // total percobaan untuk action baca (get*); write TIDAK di-retry
  RETRY_BASE_MS:  800      // jeda dasar antar percobaan (bertambah tiap percobaan)
};

// =====================================================================
// SMART CACHE MANAGER
// =====================================================================
const SmartCacheManager = {
  cache:      {},
  timestamps: {},

  getCacheKey(type, params) {
    const paramsStr = params ? JSON.stringify(params) : '';
    return `${type}_${paramsStr}`;
  },

  isValid(cacheKey, type) {
    if (!CACHE_CONFIG_ENHANCED.ENABLED)   return false;
    if (!this.cache[cacheKey])            return false;
    if (!this.timestamps[cacheKey])       return false;
    const duration = CACHE_CONFIG_ENHANCED.DURATION[type] || 5 * 60 * 1000;
    return (Date.now() - this.timestamps[cacheKey]) < duration;
  },

  get(type, params) {
    const cacheKey = this.getCacheKey(type, params);
    if (this.isValid(cacheKey, type)) {
      if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] ✓ HIT for ${type}`);
      return this.cache[cacheKey];
    }
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] ✗ MISS for ${type}`);
    return null;
  },

  set(type, params, data) {
    if (!CACHE_CONFIG_ENHANCED.ENABLED) return;
    const cacheKey = this.getCacheKey(type, params);
    this.cache[cacheKey]      = data;
    this.timestamps[cacheKey] = Date.now();
    if (CACHE_CONFIG_ENHANCED.DEBUG) {
      console.log(`[SMART_CACHE] ✓ SET for ${type}`, { key: cacheKey, size: JSON.stringify(data).length + ' bytes' });
    }
  },

  invalidate(type, params) {
    const cacheKey = this.getCacheKey(type, params);
    delete this.cache[cacheKey];
    delete this.timestamps[cacheKey];
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] ✓ INVALIDATED ${cacheKey}`);
  },

  invalidateType(type) {
    const prefix = type + '_';
    let count = 0;
    Object.keys(this.cache).forEach(key => {
      if (key.startsWith(prefix)) {
        delete this.cache[key];
        delete this.timestamps[key];
        count++;
      }
    });
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] ✓ INVALIDATED ${count} entries for type: ${type}`);
  },

  clearAll() {
    const count = Object.keys(this.cache).length;
    this.cache      = {};
    this.timestamps = {};
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] ✓ CLEARED ALL (${count} entries)`);
  },

  invalidateOnWrite(operation) {
    if (!CACHE_CONFIG_ENHANCED.INVALIDATE_ON_WRITE) return;
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log(`[SMART_CACHE] Invalidating caches for operation: ${operation}`);
    switch (operation) {
      case 'saveBudget':
      case 'deleteBudget':
        this.invalidateType('BUDGETS');
        this.invalidateType('DASHBOARD_STATS');
        break;
      case 'saveRPD':
      case 'deleteRPD':
        this.invalidateType('RPDS');
        this.invalidateType('DASHBOARD_STATS');
        break;
      case 'saveRealisasi':
      case 'deleteRealisasi':
      case 'verifyRealisasi':
      case 'updateRealisasiStatus':
        this.invalidateType('REALISASIS');
        this.invalidateType('VERIFIKASI');
        this.invalidateType('DASHBOARD_STATS');
        break;
      case 'saveRPDConfig':
        this.invalidateType('CONFIG');
        break;
    }
  },

  getStats() {
    const stats = { totalEntries: Object.keys(this.cache).length, byType: {}, totalSize: 0 };
    Object.keys(this.cache).forEach(key => {
      const type = key.split('_')[0];
      if (!stats.byType[type]) stats.byType[type] = { count: 0, size: 0 };
      const size = JSON.stringify(this.cache[key]).length;
      stats.byType[type].count++;
      stats.byType[type].size += size;
      stats.totalSize          += size;
    });
    return stats;
  },

  logStats() {
    const stats = this.getStats();
    console.log('[SMART_CACHE] Cache Statistics:', {
      totalEntries: stats.totalEntries,
      totalSize:    (stats.totalSize / 1024).toFixed(2) + ' KB',
      byType:       stats.byType
    });
  }
};

// =====================================================================
// ACTION MAPS
// =====================================================================

/**
 * Read-only actions yang hasilnya di-cache oleh SmartCacheManager.
 * getSupervisiData sengaja TIDAK di sini karena binary/besar —
 * di-handle oleh DataCache di supervisi-script.js.
 */
const CACHEABLE_ACTIONS = {
  getBudgets:        'BUDGETS',
  getRPDs:           'RPDS',
  getRealisasis:     'REALISASIS',
  getDashboardStats: 'DASHBOARD_STATS',
  getRPDConfig:      'CONFIG',
  getSupervisiFiles: 'SUPERVISI_FILES'
};

/**
 * Actions yang di-bypass sepenuhnya dari SmartCacheManager
 * (caching-nya dikelola sendiri oleh caller).
 */
const PASSTHROUGH_ACTIONS = new Set([
  'getSupervisiData'
]);

// =====================================================================
// API TRANSPORT: ANTRIAN + RETRY
// =====================================================================
// Latar belakang: Apps Script hanya melayani ±30 eksekusi bersamaan per script.
// Saat banyak user login bersamaan dan tiap dashboard menembakkan belasan request
// paralel, sebagian request ditolak Google dan browser menerima 404 / halaman HTML /
// respons doGet ("API is running") — padahal log Apps Script tampak normal karena
// request yang ditolak tidak pernah masuk ke doPost().
var _apiActive = 0;
var _apiWaiters = [];        // antrian pembacaan (get*)
var _apiWaitersHigh = [];    // antrian prioritas: simpan/verifikasi/upload/ekspor (aksi yang ditunggu user)

function _apiAcquire(high) {
  return new Promise(function(resolve) {
    if (_apiActive < CACHE_CONFIG_ENHANCED.MAX_CONCURRENT) { _apiActive++; resolve(); }
    else (high ? _apiWaitersHigh : _apiWaiters).push(resolve);
  });
}
function _apiRelease() {
  var next = _apiWaitersHigh.shift() || _apiWaiters.shift();
  if (next) next();          // oper slot langsung ke antrian berikutnya (prioritas dulu)
  else _apiActive--;
}
function _apiSleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Hanya action baca (idempoten) yang aman di-retry. Write TIDAK di-retry agar tidak
// menggandakan data / memotong kuota dua kali bila respons gagal tapi eksekusi sukses.
function _isRetryableRead(action) { return /^get/.test(action); }

async function _apiTransport(action, payload, opts) {
  var maxTry = _isRetryableRead(action) ? CACHE_CONFIG_ENHANCED.READ_RETRIES : 1;
  if (opts && opts.tries && _isRetryableRead(action)) maxTry = Math.max(1, opts.tries);
  var lastErr = null;

  for (var attempt = 1; attempt <= maxTry; attempt++) {
    await _apiAcquire(!_isRetryableRead(action));   // tulis/upload/ekspor = prioritas tinggi
    var t0 = Date.now(), diag = {};
    try {
      var response = await fetch(APP_CONFIG.SCRIPT_URL, {
        method: 'POST',
        body:   JSON.stringify(payload)
      });
      diag.status = response.status;
      diag.redirected = response.redirected;
      try { diag.finalHost = new URL(response.url).host + new URL(response.url).pathname.slice(0, 24); } catch (ue) {}

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + (response.statusText ? ': ' + response.statusText : ''));
      }

      var text = await response.text();
      diag.bytes = text.length;
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (pe) { diag.head = text.slice(0, 80); throw new Error('Respons server bukan JSON (server sibuk)'); }

      // Respons doGet() ({status:'OK', message:'API is running'}) = request POST
      // dialihkan sebagai GET oleh Google → bukan jawaban dari doPost.
      if (parsed && parsed.success === undefined && parsed.status === 'OK') {
        throw new Error('Server sibuk (API is running)');
      }

      return parsed;                       // sukses ATAU error logika dari server → jangan di-retry

    } catch (err) {
      lastErr = err;
      diag.ms = Date.now() - t0;
      // Selalu dicatat (bukan hanya saat DEBUG) agar penyebab bisa dilacak:
      // ms kecil = ditolak cepat (batas eksekusi bersamaan); ms besar = eksekusi lambat/timeout.
      console.warn('[API] ' + action + ' gagal percobaan ' + attempt + '/' + maxTry + ' (' + err.message + ')', diag);
    } finally {
      _apiRelease();
    }

    if (attempt < maxTry) {
      await _apiSleep(CACHE_CONFIG_ENHANCED.RETRY_BASE_MS * attempt + Math.floor(Math.random() * 400));
    }
  }

  var msg = (lastErr && lastErr.message) || 'Gagal terhubung ke server';
  if (!_isRetryableRead(action)) {
    msg += ' — data mungkin sudah tersimpan, periksa daftar sebelum mengulang.';
  } else {
    msg += ' — silakan coba lagi.';
  }
  throw new Error(msg);
}

// =====================================================================
// ENHANCED API CALL
// =====================================================================
// Opsi khusus client (tidak dikirim ke server, tidak ikut kunci cache):
//   _tries  : jumlah percobaan untuk action baca
//   _silent : true → jangan tampilkan toast error (caller menangani sendiri)
function _stripClientOpts(obj) {
  var out = {};
  Object.keys(obj).forEach(function(k) { if (k.charAt(0) !== '_') out[k] = obj[k]; });
  return out;
}

// Request baca yang identik & sedang berjalan DIGABUNG jadi satu (mis. klik ganda,
// auto-refresh + klik manual, dua komponen meminta data yang sama bersamaan).
var _apiInflight = {};

async function apiCallWithCache(action, data) {

  // Normalkan data agar selalu object (bukan undefined)
  var safeData = (data !== null && typeof data === 'object') ? data : {};
  var cacheParams = _stripClientOpts(safeData);

  // ── 1. Cache hit check ──────────────────────────────────────────
  var cacheType = CACHEABLE_ACTIONS[action] || null;

  if (cacheType) {
    var cached = SmartCacheManager.get(cacheType, cacheParams);
    if (cached !== null) {
      if (CACHE_CONFIG_ENHANCED.DEBUG) console.log('[API] Using cached data for ' + action);
      return cached;
    }
  }

  // ── 2. Gabungkan request baca identik yang sedang berjalan ───────
  var dedupeKey = _isRetryableRead(action) ? (action + '_' + JSON.stringify(cacheParams)) : null;
  if (dedupeKey && _apiInflight[dedupeKey]) {
    if (CACHE_CONFIG_ENHANCED.DEBUG) console.log('[API] Joining in-flight request for ' + action);
    return _apiInflight[dedupeKey];
  }

  var p = _apiCallCore(action, safeData, cacheParams, cacheType);
  if (dedupeKey) {
    _apiInflight[dedupeKey] = p;
    var clear = function() { if (_apiInflight[dedupeKey] === p) delete _apiInflight[dedupeKey]; };
    p.then(clear, clear);
  }
  return p;
}

async function _apiCallCore(action, safeData, cacheParams, cacheType) {
  // payload dibangun DI LUAR try (ROOT FIX sebelumnya): field berawalan "_" tidak dikirim
  var payload = { action: action };
  Object.keys(cacheParams).forEach(function(k) { payload[k] = cacheParams[k]; });
  var transportOpts = { tries: safeData._tries };

  if (CACHE_CONFIG_ENHANCED.DEBUG) console.log('[API] Calling ' + action, cacheParams);

  showLoading();

  try {
    // Lewat antrian (maks N request bersamaan) + retry otomatis khusus action baca
    var result = await _apiTransport(action, payload, transportOpts);
    hideLoading();

    if (result.success) {
      // Cache hasil read operations
      if (cacheType) {
        SmartCacheManager.set(cacheType, cacheParams, result.data);
      }
      // Invalidate caches terkait HANYA pada aksi tulis (bukan pembacaan get*)
      if (!cacheType && !PASSTHROUGH_ACTIONS.has(action) && !_isRetryableRead(action)) {
        SmartCacheManager.invalidateOnWrite(action);
      }
      return result.data;

    } else {
      throw new Error(result.message || 'Terjadi kesalahan pada server');
    }

  } catch (error) {
    hideLoading();
    if (safeData._silent === true) {
      console.warn('[API] (silent) ' + action + ': ' + error.message);
    } else {
      console.error('[API ERROR]', error);
      showNotification(error.message || 'Terjadi kesalahan jaringan', 'error');
    }
    throw error;
  }
}

/** Isi SmartCache untuk action baca dengan data yang didapat dari sumber lain (mis. bootstrap). */
function apiPrimeCache(action, params, data) {
  var type = CACHEABLE_ACTIONS[action];
  if (!type || data === undefined || data === null) return;
  SmartCacheManager.set(type, _stripClientOpts(params || {}), data);
}

// =====================================================================
// AUTO-REFRESH
// =====================================================================
var autoRefreshInterval = null;

function startAutoRefresh(refreshCallback) {
  if (!CACHE_CONFIG_ENHANCED.AUTO_REFRESH.ENABLED) {
    console.log('[AUTO_REFRESH] Disabled in config');
    return;
  }
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(function() {
    console.log('[AUTO_REFRESH] Refreshing...');
    SmartCacheManager.clearAll();
    if (refreshCallback) refreshCallback();
  }, CACHE_CONFIG_ENHANCED.AUTO_REFRESH.INTERVAL);
  console.log('[AUTO_REFRESH] Started');
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log('[AUTO_REFRESH] Stopped');
  }
}

function setupSmartCache(options) {
  options = options || {};
  if (options.enabled     !== undefined) CACHE_CONFIG_ENHANCED.ENABLED              = options.enabled;
  if (options.autoRefresh !== undefined) CACHE_CONFIG_ENHANCED.AUTO_REFRESH.ENABLED = options.autoRefresh;
  if (options.debug       !== undefined) CACHE_CONFIG_ENHANCED.DEBUG                = options.debug;
  console.log('[SMART_CACHE] Setup complete', CACHE_CONFIG_ENHANCED);
  if (CACHE_CONFIG_ENHANCED.DEBUG) SmartCacheManager.logStats();
}

// =====================================================================
// EXPORT
// =====================================================================
window.SmartCacheManager     = SmartCacheManager;
window.CACHE_CONFIG_ENHANCED = CACHE_CONFIG_ENHANCED;
window.CACHEABLE_ACTIONS     = CACHEABLE_ACTIONS;
window.apiCallWithCache      = apiCallWithCache;
window.apiPrimeCache         = apiPrimeCache;
window.startAutoRefresh      = startAutoRefresh;
window.stopAutoRefresh       = stopAutoRefresh;
window.setupSmartCache       = setupSmartCache;

// Override global apiCall
window.apiCall = apiCallWithCache;

console.log('[CONFIG_ENHANCED] ✓ Smart Cache Manager loaded');