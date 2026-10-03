// ===== GOOGLE APPS SCRIPT - BOP MODULE (COMPLETE FIXED VERSION) =====
// File: code-bop.gs
// Version: 4.0 - Complete with all fixes

// ============================================================
// COMPATIBILITY STUBS — definisikan semua alias di sini agar
// tidak ada ReferenceError apapun versi yang di-deploy user.
// ============================================================

// SS_ID → SPREADSHEET_ID alias
try {
  if (typeof SPREADSHEET_ID === 'undefined' && typeof SS_ID !== 'undefined') {
    var SPREADSHEET_ID = SS_ID;
  }
} catch(e) {}

// createSuccessResponse alias
function createSuccessResponse(data) {
  return { success: true, data: data };
}

// createErrorResponse alias (defined before errorResponse to avoid hoisting issues)
function createErrorResponse(message) {
  Logger.log('[COMPAT] createErrorResponse: ' + message);
  return { success: false, message: message };
}

// XLSX stub — menghasilkan TSV yang bisa dibuka di Excel
// (hanya aktif jika belum didefinisikan di file lain)
if (typeof XLSX === 'undefined') {
  var XLSX = {
    utils: {
      book_new: function() { return { _names: [], _sheets: {} }; },
      aoa_to_sheet: function(rows) { return { _rows: rows }; },
      book_append_sheet: function(wb, ws, name) {
        wb._names.push(name || 'Sheet1');
        wb._sheets[name || 'Sheet1'] = ws;
      },
      sheet_to_csv: function(ws) {
        return (ws._rows || []).map(function(r) {
          return r.map(function(c) { return (c == null) ? '' : String(c).replace(/\t/g,' '); }).join('\t');
        }).join('\n');
      }
    },
    write: function(wb, opts) {
      var n = wb._names[0] || 'Sheet1';
      var rows = (wb._sheets[n] || {})._rows || [];
      var tsv  = rows.map(function(r) {
        return r.map(function(c) { return (c == null) ? '' : String(c).replace(/\t/g,' '); }).join('\t');
      }).join('\n');
      return Utilities.newBlob(tsv, 'text/tab-separated-values').getBytes();
    }
  };
}

// ===== STATUS BACKWARD COMPATIBILITY =====
/**
 * Normalize status lama ke nilai baru.
 * Data lama: 'Pending', 'Menunggu', 'Menunggu Verifikasi', 'Diterima', 'Ditolak'
 * Data baru: 'Waiting', 'Approved', 'Rejected', 'Paid'
 */
function normalizeStatus(status) {
  var map = {
    'Pending':             'Waiting',
    'Menunggu':            'Waiting',
    'Menunggu Verifikasi': 'Waiting',
    'Waiting':             'Waiting',
    'Diterima':            'Approved',
    'Approved':            'Approved',
    'Ditolak':             'Rejected',
    'Rejected':            'Rejected',
    'Paid':                'Paid'
  };
  return map[status] || 'Waiting';
}

// ===== CONSTANTS =====
const DRIVE_FOLDER_ID = '11quguPvN4NvdhEZVhiE4gTCIFS9LWw_6';
const NAMA_KASI_BIMAS = 'H. ROSIDI, S.Ag., M.M';
const NIP_KASI_BIMAS = 'NIP: 19681230 199403 1 003';

const BOP_CONFIG = {
  RPD_PARAMETERS: {
    '521111': {
      name: 'Belanja Operasional Perkantoran',
      items: ['ATK Kantor', 'Jamuan Tamu', 'Pramubakti', 'Alat Rumah Tangga Kantor'],
      hasSubItems: true
    },
    '521211': {
      name: 'Belanja Bahan',
      items: ['Penggandaan / Penjilidan', 'Spanduk'],
      hasSubItems: true
    },
    '522111': {
      name: 'Belanja Langganan Listrik',
      items: ['Nominal'],
      hasSubItems: false
    },
    '522112': {
      name: 'Belanja Langganan Telepon / Internet',
      items: ['Nominal'],
      hasSubItems: false
    },
    '522113': {
      name: 'Belanja Langganan Air',
      items: ['Nominal'],
      hasSubItems: false
    },
    '523111': {
      name: 'Belanja Pemeliharaan Gedung dan Bangunan',
      items: ['Nominal'],
      hasSubItems: false
    },
    '523121': {
      name: 'Belanja Pemeliharaan Peralatan dan Mesin',
      items: ['Nominal'],
      hasSubItems: false
    }
  }
};

const KUA_LIST = [
  'KUA Anjatan', 'KUA Arahan', 'KUA Balongan', 'KUA Bangodua', 'KUA Bongas',
  'KUA Cantigi', 'KUA Cikedung', 'KUA Gantar', 'KUA Gabuswetan', 'KUA Haurgeulis',
  'KUA Indramayu', 'KUA Jatibarang', 'KUA Juntinyuat', 'KUA Kandanghaur', 'KUA Karangampel',
  'KUA Kedokan Bunder', 'KUA Kertasemaya', 'KUA Krangkeng', 'KUA Lelea', 'KUA Lohbener',
  'KUA Losarang', 'KUA Pasekan', 'KUA Patrol', 'KUA Sindang', 'KUA Sliyeg',
  'KUA Sukagumiwang', 'KUA Sukra', 'KUA Terisi', 'KUA Tukdana', 'KUA Widasari'
];

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const SHEETS = {
  BUDGET: 'Budget',
  RPD: 'RPD',
  REALISASI: 'Realisasi',
  CONFIG: 'Config',
  AUTO_PAYMENT_CONFIG: 'AutoPaymentConfig',
  AUTO_PAYMENT_NOMINAL: 'AutoPaymentNominal'
};

// ======================================================================
// ===== PERFORMANCE LAYER (v6) =========================================
// ======================================================================
// 1. _sheetValues()  : baca sheet SEKALI per eksekusi (memo) — dipakai jalur baca.
// 2. Cache lintas-eksekusi (CacheService) untuk aksi get* + invalidasi versi per grup
//    sheet saat ada aksi tulis. Bila cache gagal/kosong → otomatis baca dari sheet.
// 3. getBopBootstrap : 1 request menggantikan 6–8 request saat dashboard dibuka.
//
// Keamanan data: cache hanya menyimpan respons SUKSES yang sama persis dengan hasil
// pembacaan sheet; setiap aksi tulis menaikkan versi grup terkait sehingga cache lama
// tidak pernah dipakai lagi. TTL 90 detik membatasi umur data bila sheet diedit manual.
// ======================================================================

var _BOP_CACHE_TTL   = 90;      // detik
var _BOP_CACHE_CHUNK = 90000;   // karakter base64 per kunci (batas CacheService 100 KB)
var _BOP_CACHE_MAXCH = 40;      // lebih dari ini → tidak di-cache

// Jumlah kolom minimum per sheet (getDataRange bisa lebih sempit bila kolom ujung kosong)
var _SHEET_MIN_COLS = { 'Budget': 8, 'RPD': 10, 'Realisasi': 16, 'Config': 2,
                        'AutoPaymentConfig': 3, 'AutoPaymentNominal': 5 };

// ── Memo pembacaan sheet (per eksekusi) ───────────────────────────────
var _MEMO = { on: false, depth: 0, vals: {} };
function _memoStart() { _MEMO.on = true; _MEMO.vals = {}; }                 // dipakai di dalam lock penulisan
function _memoStop()  { _MEMO.on = false; _MEMO.vals = {}; _MEMO.depth = 0; }
function _memoEnter() { if (_MEMO.depth === 0) { _MEMO.on = true; _MEMO.vals = {}; } _MEMO.depth++; }
function _memoLeave() { _MEMO.depth = Math.max(0, _MEMO.depth - 1); if (_MEMO.depth === 0) { _MEMO.on = false; _MEMO.vals = {}; } }

function _readAllValues(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  var minCols = _SHEET_MIN_COLS[sh.getName()] || 0;
  var width = Math.max(lc, Math.min(minCols, sh.getMaxColumns()));
  return sh.getRange(1, 1, lr, width).getValues();
}

/** Semua nilai sheet (header + data). createHeaders → buat sheet bila belum ada. */
function _sheetValues(sheetName, createHeaders) {
  if (_MEMO.on && _MEMO.vals[sheetName]) return _MEMO.vals[sheetName];
  var sh = createHeaders ? getOrCreateSheet(sheetName, createHeaders) : getSheet(sheetName);
  var v = _readAllValues(sh);
  if (_MEMO.on) _MEMO.vals[sheetName] = v;
  return v;
}

/** Seperti _sheetValues tapi mengembalikan null bila sheet tidak ada (tanpa membuatnya). */
function _sheetValuesIfExists(sheetName) {
  if (_MEMO.on && _MEMO.vals[sheetName]) return _MEMO.vals[sheetName];
  var sh = _getSS().getSheetByName(sheetName);
  if (!sh) return null;
  var v = _readAllValues(sh);
  if (_MEMO.on) _MEMO.vals[sheetName] = v;
  return v;
}

// ── Peta ketergantungan cache ─────────────────────────────────────────
var _BOP_READ_DEPS = {
  getBudgets:                ['budget', 'rpd', 'realisasi'],
  getDashboardStats:         ['budget', 'rpd', 'realisasi'],
  getRPDs:                   ['rpd'],
  getRealisasis:             ['realisasi'],
  getRPDConfig:              ['config'],
  getAutoPaymentConfig:      ['ap'],
  getAutoPaymentNominal:     ['ap'],
  getAutoPaymentNominalYear: ['ap']
};
// Aksi tulis → grup yang harus di-invalidasi. (uploadFile tidak mengubah sheet.)
var _BOP_WRITE_GROUPS = {
  saveRealisasi:          ['realisasi'],
  updateRealisasiStatus:  ['realisasi'],
  verifyRealisasi:        ['realisasi'],
  deleteRealisasi:        ['realisasi'],
  saveRPD:                ['rpd'],
  deleteRPD:              ['rpd'],
  saveBudget:             ['budget'],
  deleteBudget:           ['budget'],
  saveRPDConfig:          ['config'],
  updateRPDConfig:        ['config'],
  saveAutoPaymentConfig:  ['ap'],
  saveAutoPaymentNominal: ['ap']
};

function _bopVersions(groups) {
  var cache = CacheService.getScriptCache();
  var keys = groups.map(function(g) { return 'bopv:' + g; });
  var got = cache.getAll(keys), out = [], add = {}, any = false;
  keys.forEach(function(k) {
    var v = got[k];
    if (!v) { v = String(Date.now()); add[k] = v; any = true; }
    out.push(v);
  });
  if (any) cache.putAll(add, 21600);
  return out.join('.');
}

function _bopBump(groups) {
  var stamp = String(Date.now()) + String(Math.floor(Math.random() * 1000));
  var o = {};
  groups.forEach(function(g) { o['bopv:' + g] = stamp; });
  CacheService.getScriptCache().putAll(o, 21600);
}

/** Dipanggil dari doPost() setelah aksi tulis selesai. */
function _bopInvalidateForAction(action) {
  var groups = _BOP_WRITE_GROUPS[action];
  if (!groups) return;
  _bopBump(groups);
  Logger.log('[CACHE] Invalidated ' + groups.join(',') + ' after ' + action);
}

function _stableStringify(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(_stableStringify).join(',') + ']';
  return '{' + Object.keys(o).sort().map(function(k) {
    return JSON.stringify(k) + ':' + _stableStringify(o[k]);
  }).join(',') + '}';
}

function _md5Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2); }).join('');
}

function _cachePutJson(key, obj) {
  var json = JSON.stringify(obj);
  var gz   = Utilities.gzip(Utilities.newBlob(json, 'text/plain', 'd.txt'));
  var b64  = Utilities.base64Encode(gz.getBytes());
  var n    = Math.ceil(b64.length / _BOP_CACHE_CHUNK) || 1;
  if (n > _BOP_CACHE_MAXCH) { Logger.log('[CACHE] Skip (terlalu besar): ' + key); return; }
  var puts = {};
  for (var i = 0; i < n; i++) {
    puts[key + ':' + i] = (i === 0 ? (n + '|') : '') + b64.substr(i * _BOP_CACHE_CHUNK, _BOP_CACHE_CHUNK);
  }
  CacheService.getScriptCache().putAll(puts, _BOP_CACHE_TTL);
}

function _cacheGetJson(key) {
  var cache = CacheService.getScriptCache();
  var first = cache.get(key + ':0');
  if (!first) return undefined;
  var bar = first.indexOf('|');
  var n = parseInt(first.substr(0, bar), 10);
  var b64 = first.substr(bar + 1);
  if (n > 1) {
    var keys = [];
    for (var i = 1; i < n; i++) keys.push(key + ':' + i);
    var rest = cache.getAll(keys);
    for (var j = 1; j < n; j++) {
      var p = rest[key + ':' + j];
      if (p === null || p === undefined) return undefined;   // chunk hilang/evicted → hitung ulang
      b64 += p;
    }
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip', 'd.gz');
  return JSON.parse(Utilities.ungzip(blob).getDataAsString());
}

/** Bungkus aksi baca: cache hit → langsung; miss → hitung + simpan (hanya respons sukses). */
function _cachedRead(action, data, computeFn) {
  var groups = _BOP_READ_DEPS[action];
  if (!groups) return computeFn();
  var key = null;
  try {
    var params = {};
    Object.keys(data || {}).forEach(function(k) {
      if (k !== 'action' && k.charAt(0) !== '_') params[k] = data[k];
    });
    key = 'bopc:' + action + ':' + _md5Hex(_stableStringify(params)) + ':' + _bopVersions(groups);
    var hit = _cacheGetJson(key);
    if (hit !== undefined) { Logger.log('[CACHE] HIT  ' + action); return hit; }
  } catch (e) {
    Logger.log('[CACHE] read error (' + action + '): ' + e);
    key = null;
  }
  var result = computeFn();
  try {
    if (key && result && result.success === true) { _cachePutJson(key, result); Logger.log('[CACHE] MISS ' + action + ' → stored'); }
  } catch (e) { Logger.log('[CACHE] write error (' + action + '): ' + e); }
  return result;
}

/** Ringkasan payload untuk log (tanpa base64 / data besar). */
function _logSummary(data) {
  var o = {};
  Object.keys(data || {}).forEach(function(k) {
    var v = data[k];
    if (k === 'fileData') o[k] = '[base64 ' + (v ? v.length : 0) + ' chars]';
    else if (typeof v === 'string' && v.length > 120) o[k] = v.substr(0, 120) + '…';
    else if (v && typeof v === 'object') o[k] = Array.isArray(v) ? '[array ' + v.length + ']' : '[object]';
    else o[k] = v;
  });
  var s = JSON.stringify(o);
  return s.length > 600 ? s.substr(0, 600) + '…' : s;
}

// ── BOOTSTRAP: semua data awal dashboard dalam SATU request ────────────
function getBopBootstrap(data) {
  var t0 = Date.now();
  var role = data.role, kua = data.kua;
  var year = parseInt(data.year, 10) || new Date().getFullYear();
  var isAdmin = (role === 'Admin');
  var out = {}, failed = [];

  function pick(name, action, params) {
    try {
      var r = handleBOPAction(action, params);        // memakai cache + memo yang sama dgn request tunggal
      if (r && r.success) out[name] = r.data; else failed.push(name);
    } catch (e) {
      Logger.log('[BOOTSTRAP] ' + name + ' error: ' + e);
      failed.push(name);
    }
  }

  // Parameter SENGAJA identik dengan yang dipakai client pada pemanggilan tunggal
  pick('stats',      'getDashboardStats',         { year: year, kua: kua, role: role });
  pick('budgets',    'getBudgets',                isAdmin ? { year: year } : { kua: kua });
  pick('config',     'getRPDConfig',              {});
  if (!isAdmin) {
    pick('rpds',       'getRPDs',                 { kua: kua, year: year });
    pick('realisasis', 'getRealisasis',           { kua: kua, year: year });
  }
  pick('apConfig',   'getAutoPaymentConfig',      {});
  pick('apNominals', 'getAutoPaymentNominalYear', { year: year });

  out._failed = failed;
  out._year = year;
  Logger.log('[BOOTSTRAP] ' + (isAdmin ? 'Admin' : kua) + ' done in ' + (Date.now() - t0) + ' ms, failed=' + failed.join(',') );
  return successResponse(out);
}

// ── Folder upload: cache ID folder bulan berjalan ─────────────────────
function _getUploadMonthFolder(year, month) {
  var cache = CacheService.getScriptCache();
  var ck = 'bopu:' + year + '-' + month;
  var id = cache.get(ck);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* folder dihapus → buat ulang */ } }

  var lock = null, locked = false;
  try { lock = LockService.getUserLock(); locked = lock.tryLock(10000); } catch (e) { locked = false; }
  try {
    id = cache.get(ck);                                  // cek ulang: request lain mungkin baru membuatnya
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }

    var rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    function child(parent, name) {
      var it = parent.getFoldersByName(name);
      return it.hasNext() ? it.next() : parent.createFolder(name);
    }
    var folder = child(child(child(rootFolder, 'BOP_Uploads'), String(year)), month);
    cache.put(ck, folder.getId(), 21600);
    return folder;
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
}

// ===== AUTO PAYMENT SHEET HELPER =====
function getOrCreateSheet(sheetName, headers) {
  try {
    const ss = _getSS();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      if (headers && headers.length > 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        Logger.log('[CREATE_SHEET] Created sheet: ' + sheetName);
      }
    }
    return sheet;
  } catch (error) {
    Logger.log('[CREATE_SHEET ERROR] ' + error.toString());
    throw error;
  }
}

// ===== HELPER FUNCTIONS =====
function getSheet(sheetName) {
  try {
    var ss = _getSS();   // ✅ memo per eksekusi (lihat code-main.gs)
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('[ERROR] Sheet not found: ' + sheetName);
      throw new Error('Sheet tidak ditemukan: ' + sheetName);
    }
    return sheet;
  } catch (error) {
    Logger.log('[ERROR] getSheet failed: ' + error.toString());
    throw error;
  }
}

function successResponse(data) {
  Logger.log('[SUCCESS_RESPONSE] Data type: ' + typeof data);
  return {
    success: true,
    data: data
  };
}

function errorResponse(message) {
  Logger.log('[ERROR_RESPONSE] ' + message);
  return {
    success: false,
    message: message
  };
}

function formatNumber(num) {
  if (num === 0 || num === '0') return '0';
  if (!num) return '';
  
  return Number(num).toLocaleString('id-ID');
}

function formatCurrency(num) {
  return 'Rp ' + formatNumber(num);
}

// ✅ NEW: Safe date formatting
function safeFormatDate(dateValue) {
  if (!dateValue) return '';
  try {
    const date = new Date(dateValue);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString();
  } catch (error) {
    Logger.log('[SAFE_FORMAT_DATE] Error formatting date: ' + error.toString());
    return '';
  }
}

// ===== MAIN HANDLER =====
/**
 * Pintu masuk semua aksi BOP.
 *  - aksi baca (get*)  : memo sheet per eksekusi + cache lintas-eksekusi (_cachedRead)
 *  - getBopBootstrap   : gabungan beberapa aksi baca dalam 1 request
 *  - aksi tulis        : langsung ke _handleBOPActionCore (tanpa cache)
 */
function handleBOPAction(action, data) {
  data = data || {};
  Logger.log('[BOP] Action: ' + action + ' | ' + _logSummary(data));
  var isRead = action === 'getBopBootstrap' || !!_BOP_READ_DEPS[action];
  if (isRead) _memoEnter();
  try {
    if (action === 'getBopBootstrap') return getBopBootstrap(data);
    if (_BOP_READ_DEPS[action]) {
      return _cachedRead(action, data, function() { return _handleBOPActionCore(action, data); });
    }
    return _handleBOPActionCore(action, data);
  } finally {
    if (isRead) _memoLeave();
  }
}

function _handleBOPActionCore(action, data) {
  try {
    let result;
    
    // ✅ Route ke enhanced functions untuk critical operations
    switch(action) {
      // Enhanced save operations dengan locking
      case 'saveRPD':
        result = saveRPDWithRetry(data);
        break;
        
      case 'saveRealisasi':
        result = saveRealisasiWithRetry(data);
        break;
        
      case 'verifyRealisasi':
        result = verifyRealisasiEnhanced(data);
        break;
      
      // Optimized batch operations
      case 'getRPDs':
        // Check if batch request
        if (data.kuas || data.years || data.months) {
          result = getRPDsBatch(data);
        } else {
          result = getRPDs(data);
        }
        break;
        
      case 'getDashboardStats':
        result = getDashboardStatsOptimized(data);
        break;
      
      // Keep existing operations untuk yang lain
      case 'getBudgets': 
        result = getBudgets(data);
        break;
      case 'saveBudget': 
        result = saveBudget(data);
        break;
      case 'deleteBudget': 
        result = deleteBudget(data);
        break;
      case 'deleteRPD': 
        result = deleteRPD(data);
        break;
      case 'getRealisasis': 
        result = getRealisasis(data);
        break;
      case 'deleteRealisasi': 
        result = deleteRealisasi(data);
        break;
      case 'updateRealisasiStatus':
        result = updateRealisasiStatus(data);
        break;
      case 'getRPDConfig': 
        result = getRPDConfig(data);
        break;
      case 'saveRPDConfig': 
        result = saveRPDConfig(data);
        break;
      case 'exportRPDPerYear': 
        result = exportRPDPerYear(data);
        break;
      case 'exportRPDDetailYear': 
        result = exportRPDDetailYear(data);
        break;
      case 'exportRealisasiPerYear': {
        // ===== INLINE — tidak memanggil fungsi eksternal yg bisa di-override =====
        Logger.log('[EXPORT_PER_YEAR] year=' + data.year + ' kua=' + (data.kua||'all') + ' format=' + data.format + ' mode=' + (data.apMode||'exclude'));
        try {
          var _bSheet    = getSheet(SHEETS.BUDGET);
          var _rSheet    = getSheet(SHEETS.REALISASI);
          var _bRows     = _bSheet.getDataRange().getValues();
          var _rRows     = _rSheet.getDataRange().getValues();
          var _apMode    = data.apMode || 'exclude';
          var _apLabel   = _apMode === 'include' ? 'INCLUDE AUTO PAYMENT' : 'EXCLUDE AUTO PAYMENT';
          var _apSlug    = _apMode === 'include' ? 'include_autopayment' : 'exclude_autopayment';
          var _apCfg     = {};
          var _apNom     = {};
          try {
            var _cs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_CONFIG);
            if (_cs) { var _cr = _cs.getDataRange().getValues(); for (var _i=1;_i<_cr.length;_i++){var _ck=_cr[_i][0];if(_ck)_apCfg[_ck]={'522111':_cr[_i][1]===true||_cr[_i][1]==='TRUE','522112':_cr[_i][2]===true||_cr[_i][2]==='TRUE'};} }
            var _ns = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_NOMINAL);
            if (_ns) { var _nr = _ns.getDataRange().getValues(); for (var _j=1;_j<_nr.length;_j++){var _nk=_nr[_j][0],_nm=_nr[_j][1];if(_nk&&_nr[_j][2]==data.year){if(!_apNom[_nk])_apNom[_nk]={};_apNom[_nk][_nm]={'522111':parseFloat(_nr[_j][3])||0,'522112':parseFloat(_nr[_j][4])||0};}} }
          } catch(e) {}
          var _yb = [];
          for (var _bi=1;_bi<_bRows.length;_bi++) { if (_bRows[_bi][2]==data.year && (!data.kua||_bRows[_bi][1]===data.kua)) _yb.push({kua:_bRows[_bi][1],budget:parseFloat(_bRows[_bi][3])||0}); }
          var _res = _yb.map(function(_b) {
            var _row = {kua:_b.kua,budget:_b.budget,months:{}};
            MONTHS.forEach(function(_m){_row.months[_m]=0;});
            for (var _ri=1;_ri<_rRows.length;_ri++) {
              var _rk=_rRows[_ri][1],_rm=_rRows[_ri][2],_ry=_rRows[_ri][4],_rs=normalizeStatus(_rRows[_ri][8]);
              if (_rk!==_b.kua||_ry!=data.year||(_rs!=='Approved'&&_rs!=='Paid')) continue;
              var _kc=_apCfg[_rk]||null,_hAP=_kc&&(_kc['522111']||_kc['522112']);
              var _mt=0, _rd={};
              try{_rd=JSON.parse(_rRows[_ri][6]||'{}');}catch(e){}
              if (!_hAP||_apMode==='exclude') {
                if (!_hAP) { _mt=parseFloat(_rRows[_ri][5])||0; }
                else { Object.keys(_rd).forEach(function(_c){if(_kc[_c])return;Object.values(_rd[_c]).forEach(function(_v){_mt+=parseFloat(_v)||0;});}); }
              } else {
                var _nm2=(_apNom[_rk]&&_apNom[_rk][_rm])?_apNom[_rk][_rm]:{};
                Object.keys(_rd).forEach(function(_c){if(_kc[_c]){_mt+=parseFloat(_nm2[_c]||0);}else{Object.values(_rd[_c]).forEach(function(_v){_mt+=parseFloat(_v)||0;});}});
              }
              _row.months[_rm]+=_mt;
            }
            _row.totalRealisasi=Object.values(_row.months).reduce(function(s,v){return s+v;},0);
            _row.sisa=_b.budget-_row.totalRealisasi;
            return _row;
          });
          if (data.format==='pdf') {
            var _h='<html><head><style>body{font-family:Arial;font-size:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{border:1px solid #000;padding:5px;text-align:center;}th{background:#dc3545;color:white;}</style></head><body>';
            _h+='<h3 style="text-align:center">LAPORAN REALISASI '+_apLabel+' PER TAHUN '+data.year+'</h3>';
            if(data.kua)_h+='<p style="text-align:center">KUA: '+data.kua+'</p>';
            _h+='<table><tr><th>No</th><th>KUA</th><th>Budget</th>';
            MONTHS.forEach(function(_m){_h+='<th>'+_m+'</th>';});
            _h+='<th>Total Realisasi</th><th>Sisa</th></tr>';
            _res.forEach(function(_r,_ix){
              _h+='<tr><td>'+(_ix+1)+'</td><td>'+_r.kua+'</td><td>'+formatCurrency(_r.budget)+'</td>';
              MONTHS.forEach(function(_m){_h+='<td>'+formatCurrency(_r.months[_m])+'</td>';});
              _h+='<td>'+formatCurrency(_r.totalRealisasi)+'</td><td>'+formatCurrency(_r.sisa)+'</td></tr>';
            });
            _h+='</table></body></html>';
            var _pb=Utilities.newBlob(_h,'text/html');
            var _pd=_pb.getAs('application/pdf');
            result=successResponse({fileData:Utilities.base64Encode(_pd.getBytes()),fileName:'Laporan_Realisasi_'+_apSlug+'_'+data.year+(data.kua?'_'+data.kua:'')+'.pdf',mimeType:'application/pdf'});
          } else {
            var _t='LAPORAN REALISASI '+_apLabel+' PER TAHUN '+data.year+'\n';
            if(data.kua)_t+='KUA: '+data.kua+'\n';
            _t+='\nNo\tKUA\tBudget\t';
            MONTHS.forEach(function(_m){_t+=_m+'\t';});
            _t+='Total Realisasi\tSisa\n';
            _res.forEach(function(_r,_ix){
              _t+=(_ix+1)+'\t'+_r.kua+'\t'+_r.budget+'\t';
              MONTHS.forEach(function(_m){_t+=_r.months[_m]+'\t';});
              _t+=_r.totalRealisasi+'\t'+_r.sisa+'\n';
            });
            var _xb=Utilities.newBlob(_t,'text/tab-separated-values');
            result=successResponse({fileData:Utilities.base64Encode(_xb.getBytes()),fileName:'Laporan_Realisasi_'+_apSlug+'_'+data.year+(data.kua?'_'+data.kua:'')+'.xls',mimeType:'application/vnd.ms-excel'});
          }
        } catch(_err) { result=errorResponse('Export Realisasi Per Tahun gagal: '+_err.toString()); }
        break;
      }
      case 'exportRealisasiDetailYear': {
        // ===== INLINE — tidak memanggil fungsi eksternal yg bisa di-override =====
        Logger.log('[EXPORT_DETAIL_YEAR] year=' + data.year + ' format=' + data.format + ' mode=' + (data.apMode||'exclude'));
        try {
          var _drSheet  = getSheet(SHEETS.REALISASI);
          var _drRows   = _drSheet.getDataRange().getValues();
          var _dApMode  = data.apMode || 'exclude';
          var _dApLabel = _dApMode === 'include' ? 'INCLUDE AUTO PAYMENT' : 'EXCLUDE AUTO PAYMENT';
          var _dApSlug  = _dApMode === 'include' ? 'include_autopayment' : 'exclude_autopayment';
          var _dApCfg   = {};
          var _dApNom   = {};
          try {
            var _dcs=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_CONFIG);
            if(_dcs){var _dcr=_dcs.getDataRange().getValues();for(var _di=1;_di<_dcr.length;_di++){var _dck=_dcr[_di][0];if(_dck)_dApCfg[_dck]={'522111':_dcr[_di][1]===true||_dcr[_di][1]==='TRUE','522112':_dcr[_di][2]===true||_dcr[_di][2]==='TRUE'};}}
            var _dns=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_NOMINAL);
            if(_dns){var _dnr=_dns.getDataRange().getValues();for(var _dj=1;_dj<_dnr.length;_dj++){var _dnk=_dnr[_dj][0],_dnm=_dnr[_dj][1];if(_dnk&&_dnr[_dj][2]==data.year){if(!_dApNom[_dnk])_dApNom[_dnk]={};_dApNom[_dnk][_dnm]={'522111':parseFloat(_dnr[_dj][3])||0,'522112':parseFloat(_dnr[_dj][4])||0};}}}
          } catch(e) {}
          var _rByKUA={};
          var _kuaSet=new Set();
          for(var _dri=1;_dri<_drRows.length;_dri++){
            var _dry=_drRows[_dri][4],_drs=normalizeStatus(_drRows[_dri][8]);
            if(_dry!=data.year||(_drs!=='Approved'&&_drs!=='Paid'))continue;
            var _drk=_drRows[_dri][1],_drm=_drRows[_dri][2];
            _kuaSet.add(_drk);
            if(!_rByKUA[_drk])_rByKUA[_drk]={};
            var _drd={};try{_drd=JSON.parse(_drRows[_dri][6]||'{}');}catch(e){}
            var _dkc=_dApCfg[_drk]||null,_dhAP=_dkc&&(_dkc['522111']||_dkc['522112']);
            var _dnMon=(_dApNom[_drk]&&_dApNom[_drk][_drm])?_dApNom[_drk][_drm]:{};
            Object.keys(_drd).forEach(function(_dc){
              if(!_rByKUA[_drk][_dc])_rByKUA[_drk][_dc]={};
              var _isAP=_dhAP&&_dkc[_dc]===true;
              Object.keys(_drd[_dc]).forEach(function(_di2){
                if(!_rByKUA[_drk][_dc][_di2])_rByKUA[_drk][_dc][_di2]=0;
                var _dv=0;
                if(_isAP){if(_dApMode==='include')_dv=parseFloat(_dnMon[_dc]||0)/Math.max(1,Object.keys(_drd[_dc]).length);}
                else{_dv=parseFloat(_drd[_dc][_di2])||0;}
                _rByKUA[_drk][_dc][_di2]+=_dv;
              });
            });
          }
          var _sKUAs=Array.from(_kuaSet).sort();
          if(data.format==='pdf'){
            // PDF: multi-page, max 10 KUA per page
            var _MAX=10,_tP=Math.ceil(_sKUAs.length/_MAX)||1;
            var _ah='<html><head><style>body{font-family:Arial;font-size:8px;}table{width:100%;border-collapse:collapse;page-break-after:always;}th,td{border:1px solid #000;padding:3px;text-align:right;}th{background:#dc3545;color:white;text-align:center;}.nm{text-align:left;}</style></head><body>';
            for(var _p=0;_p<_tP;_p++){
              var _pKUAs=_sKUAs.slice(_p*_MAX,(_p+1)*_MAX);
              _ah+='<h4 style="text-align:center">LAPORAN REALISASI DETAIL '+_dApLabel+' - TAHUN '+data.year+' (Hal '+(_p+1)+'/'+_tP+')</h4>';
              _ah+='<table><tr><th>No</th><th>Kode</th><th class="nm">Uraian</th>';
              _pKUAs.forEach(function(_k){_ah+='<th>'+_k.replace('KUA ','')+'</th>';});
              _ah+='<th>JUMLAH</th></tr>';
              var _prn=0,_pgt={},_pgAll=0;
              _pKUAs.forEach(function(_k){_pgt[_k]=0;});
              Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(_dc){
                var _dcf=BOP_CONFIG.RPD_PARAMETERS[_dc],_pct={},_pcAll=0;
                _pKUAs.forEach(function(_k){_pct[_k]=0;});
                _dcf.items.forEach(function(_di){_pKUAs.forEach(function(_k){var _v=(_rByKUA[_k]&&_rByKUA[_k][_dc]&&_rByKUA[_k][_dc][_di])?parseFloat(_rByKUA[_k][_dc][_di]):0;_pct[_k]+=_v;_pcAll+=_v;});});
                _prn++;
                _ah+='<tr><td>'+_prn+'</td><td>'+_dc+'</td><td class="nm"><strong>'+_dcf.name+'</strong></td>';
                _pKUAs.forEach(function(_k){if(_dcf.hasSubItems){_ah+='<td></td>';}else{_ah+='<td>'+formatCurrency(_pct[_k])+'</td>';_pgt[_k]+=_pct[_k];}});
                if(_dcf.hasSubItems){_ah+='<td></td></tr>';}else{_ah+='<td><strong>'+formatCurrency(_pcAll)+'</strong></td></tr>';_pgAll+=_pcAll;}
                if(_dcf.hasSubItems){_dcf.items.forEach(function(_di,_idx){var _pfx=String.fromCharCode(97+_idx),_iAll=0;_prn++;_ah+='<tr><td></td><td></td><td class="nm">&nbsp;&nbsp;'+_pfx+'. '+_di+'</td>';_pKUAs.forEach(function(_k){var _v=(_rByKUA[_k]&&_rByKUA[_k][_dc]&&_rByKUA[_k][_dc][_di])?parseFloat(_rByKUA[_k][_dc][_di]):0;_ah+='<td>'+formatCurrency(_v)+'</td>';_iAll+=_v;_pgt[_k]+=_v;_pgAll+=_v;});_ah+='<td>'+formatCurrency(_iAll)+'</td></tr>';});}
              });
              _ah+='<tr><td colspan="3"><strong>JUMLAH</strong></td>';
              _pKUAs.forEach(function(_k){_ah+='<td><strong>'+formatCurrency(_pgt[_k])+'</strong></td>';});
              _ah+='<td><strong>'+formatCurrency(_pgAll)+'</strong></td></tr></table>';
            }
            _ah+='</body></html>';
            var _dpb=Utilities.newBlob(_ah,'text/html'),_dpdf=_dpb.getAs('application/pdf');
            result=successResponse({fileData:Utilities.base64Encode(_dpdf.getBytes()),fileName:'Laporan_Realisasi_Detail_'+_dApSlug+'_'+data.year+'.pdf',mimeType:'application/pdf'});
          } else {
            // Excel TSV
            var _dt='LAPORAN REALISASI DETAIL '+_dApLabel+' - TAHUN '+data.year+'\nKementerian Agama Kabupaten Indramayu\n\n';
            _dt+='No\tKode\tUraian';
            _sKUAs.forEach(function(_k){_dt+='\t'+_k;});
            _dt+='\tJUMLAH\n';
            var _drn=0,_dgt={},_dgAll=0;
            _sKUAs.forEach(function(_k){_dgt[_k]=0;});
            Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(_dc){
              var _dcf=BOP_CONFIG.RPD_PARAMETERS[_dc],_dct={},_dcAll=0;
              _sKUAs.forEach(function(_k){_dct[_k]=0;});
              _dcf.items.forEach(function(_di){_sKUAs.forEach(function(_k){var _v=(_rByKUA[_k]&&_rByKUA[_k][_dc]&&_rByKUA[_k][_dc][_di])?parseFloat(_rByKUA[_k][_dc][_di]):0;_dct[_k]+=_v;_dcAll+=_v;});});
              _drn++;
              _dt+=_drn+'\t'+_dc+'\t'+_dcf.name;
              _sKUAs.forEach(function(_k){if(_dcf.hasSubItems){_dt+='\t';}else{_dt+='\t'+_dct[_k];_dgt[_k]+=_dct[_k];}});
              if(_dcf.hasSubItems){_dt+='\t\n';}else{_dt+='\t'+_dcAll+'\n';_dgAll+=_dcAll;}
              if(_dcf.hasSubItems){_dcf.items.forEach(function(_di,_idx){var _pfx=String.fromCharCode(97+_idx),_iAll=0;_drn++;_dt+=_drn+'\t\t'+_pfx+'. '+_di;_sKUAs.forEach(function(_k){var _v=(_rByKUA[_k]&&_rByKUA[_k][_dc]&&_rByKUA[_k][_dc][_di])?parseFloat(_rByKUA[_k][_dc][_di]):0;_dt+='\t'+_v;_iAll+=_v;_dgt[_k]+=_v;_dgAll+=_v;});_dt+='\t'+_iAll+'\n';});}
            });
            _dt+='\t\tJUMLAH';
            _sKUAs.forEach(function(_k){_dt+='\t'+_dgt[_k];});
            _dt+='\t'+_dgAll+'\n';
            var _dxb=Utilities.newBlob(_dt,'text/tab-separated-values');
            result=successResponse({fileData:Utilities.base64Encode(_dxb.getBytes()),fileName:'Laporan_Realisasi_Detail_'+_dApSlug+'_'+data.year+'.xls',mimeType:'application/vnd.ms-excel'});
          }
        } catch(_err) { result=errorResponse('Export Realisasi Detail gagal: '+_err.toString()); }
        break;
      }
      case 'exportRPDDetailMonth':
        result = exportRPDDetailMonth(data);
        break;
      case 'exportRealisasiDetailMonth':
        result = exportRealisasiDetailMonth(data);
        break;
      case 'exportFallbackPerYear':
        result = exportFallbackPerYear(data);
        break;
      case 'exportFallbackDetailYear':
        result = exportFallbackDetailYear(data);
        break;
      case 'exportFallbackDetailMonth':
        result = exportFallbackDetailMonth(data);
        break;
      case 'uploadFile':
        result = uploadFile(data);
        break;
      // ===== AUTO PAYMENT =====
      case 'getAutoPaymentConfig':
        result = getAutoPaymentConfig(data);
        break;
      case 'saveAutoPaymentConfig':
        result = saveAutoPaymentConfig(data);
        break;
      case 'getAutoPaymentNominalYear':
        result = getAutoPaymentNominalYear(data);
        break;

      case 'getAutoPaymentNominal':
        result = getAutoPaymentNominal(data);
        break;
      case 'saveAutoPaymentNominal':
        result = saveAutoPaymentNominal(data);
        break;
      default:
        result = errorResponse('Unknown BOP action: ' + action);
    }
    
    Logger.log('[BOP] Result success: ' + result.success);
    return result;
    
  } catch (error) {
    Logger.log('[BOP ERROR] ' + error.toString());
    Logger.log('[BOP ERROR STACK] ' + error.stack);
    return errorResponse('BOP Error: ' + error.toString());
  }
}

// ===== BUDGET MANAGEMENT =====
function getBudgets(data) {
  Logger.log('[GET_BUDGETS] KUA: ' + data.kua + ', Year: ' + data.year);
  
  try {
    const rows     = _sheetValues(SHEETS.BUDGET);
    const rpdRows  = _sheetValues(SHEETS.RPD);
    const realRows = _sheetValues(SHEETS.REALISASI);

    // ✅ PERFORMA: total RPD & total realisasi (Approved/Paid) per "KUA|Tahun" dihitung
    //    SEKALI jalan. Sebelumnya calculateTotalRPD/Realisasi membaca ulang seluruh sheet
    //    untuk SETIAP baris budget (31 KUA → ±62 pembacaan sheet penuh per request).
    const rpdTotals = {};
    for (let i = 1; i < rpdRows.length; i++) {
      const k = rpdRows[i][1] + '|' + rpdRows[i][3];
      rpdTotals[k] = (rpdTotals[k] || 0) + (parseFloat(rpdRows[i][4]) || 0);
    }
    const realTotals = {};
    for (let i = 1; i < realRows.length; i++) {
      const st = normalizeStatus(realRows[i][8]);
      if (st === 'Approved' || st === 'Paid') {
        const k = realRows[i][1] + '|' + realRows[i][4];
        realTotals[k] = (realTotals[k] || 0) + (parseFloat(realRows[i][5]) || 0);
      }
    }

    const budgets = [];
    for (let i = 1; i < rows.length; i++) {
      if ((!data.kua || rows[i][1] === data.kua) && 
          (!data.year || rows[i][2] == data.year)) {
        
        const kua = rows[i][1];
        const year = rows[i][2];
        const key = kua + '|' + year;
        
        const totalRPD = rpdTotals[key] || 0;
        const totalRealisasi = realTotals[key] || 0;
        const budgetTotal = parseFloat(rows[i][3]) || 0;
        
        budgets.push({
          id: rows[i][0],
          kua: kua,
          year: year,
          total: budgetTotal,          // ✅ Field utama
          budget: budgetTotal,         // ✅ Alias untuk backward compatibility
          pagu: totalRPD,              // ✅ Alias untuk totalRPD
          totalRPD: totalRPD,
          realisasi: totalRealisasi,   // ✅ Alias untuk totalRealisasi
          totalRealisasi: totalRealisasi,
          sisaBudget: budgetTotal - totalRealisasi,
          createdAt: safeFormatDate(rows[i][6]),
          updatedAt: safeFormatDate(rows[i][7])
        });
      }
    }
    
    Logger.log('[GET_BUDGETS] Found: ' + budgets.length + ' budgets');
    return successResponse(budgets);
  } catch (error) {
    Logger.log('[GET_BUDGETS ERROR] ' + error.toString());
    return errorResponse('Gagal memuat budget: ' + error.toString());
  }
}

function calculateTotalRealisasi(kua, year) {
  try {
    const rows = _sheetValues(SHEETS.REALISASI);
    let total = 0;
    
    for (let i = 1; i < rows.length; i++) {
      // Hitung realisasi yang sudah Approved atau Paid
      if (rows[i][1] === kua && rows[i][4] == year && (normalizeStatus(rows[i][8]) === 'Approved' || normalizeStatus(rows[i][8]) === 'Paid')) {
        total += parseFloat(rows[i][5]) || 0;
      }
    }
    
    return total;
  } catch (error) {
    Logger.log('[CALCULATE_TOTAL_REALISASI ERROR] ' + error.toString());
    return 0;
  }
}

function calculateTotalRPD(kua, year) {
  try {
    const rows = _sheetValues(SHEETS.RPD);
    let total = 0;
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === kua && rows[i][3] == year) {
        total += parseFloat(rows[i][4]) || 0;
      }
    }
    
    return total;
  } catch (error) {
    Logger.log('[CALCULATE_TOTAL_RPD ERROR] ' + error.toString());
    return 0;
  }
}

function saveBudget(data) {
  Logger.log('[SAVE_BUDGET] KUA: ' + data.kua + ', Year: ' + data.year + ', Total: ' + data.total);
  
  try {
    const sheet = getSheet(SHEETS.BUDGET);
    const rows = sheet.getDataRange().getValues();
    const now = new Date();
    
    if (data.id) {
      // Update existing
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.id) {
          // ✅ Update kolom total (kolom 4, index 3)
          sheet.getRange(i + 1, 4).setValue(parseFloat(data.total) || 0);
          sheet.getRange(i + 1, 8).setValue(now);  // Updated at
          
          Logger.log('[SAVE_BUDGET] Updated budget ID: ' + data.id);
          return successResponse({ 
            message: 'Budget berhasil diupdate', 
            id: data.id 
          });
        }
      }
      Logger.log('[SAVE_BUDGET] Budget not found: ' + data.id);
      return errorResponse('Budget tidak ditemukan');
    } else {
      // Check duplicate
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] === data.kua && rows[i][2] == data.year) {
          Logger.log('[SAVE_BUDGET] Duplicate found for: ' + data.kua + ' - ' + data.year);
          return errorResponse('Budget untuk KUA dan tahun ini sudah ada');
        }
      }
      
      // Create new
      const id = 'BUDGET-' + Utilities.getUuid();
      const newRow = [
        id,
        data.kua,
        data.year,
        parseFloat(data.total) || 0,  // ✅ Total budget
        0,  // Total RPD (akan dihitung otomatis)
        0,  // Total Realisasi (akan dihitung otomatis)
        now,  // Created at
        now   // Updated at
      ];
      
      sheet.appendRow(newRow);
      Logger.log('[SAVE_BUDGET] Created new budget: ' + id);
      
      return successResponse({ 
        message: 'Budget berhasil disimpan', 
        id: id 
      });
    }
  } catch (error) {
    Logger.log('[SAVE_BUDGET ERROR] ' + error.toString());
    return errorResponse('Gagal menyimpan budget: ' + error.toString());
  }
}

function deleteBudget(data) {
  Logger.log('[DELETE_BUDGET] ID: ' + data.id);
  
  try {
    const sheet = getSheet(SHEETS.BUDGET);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.deleteRow(i + 1);
        Logger.log('[DELETE_BUDGET] Deleted budget ID: ' + data.id);
        return successResponse({ message: 'Budget berhasil dihapus' });
      }
    }
    
    Logger.log('[DELETE_BUDGET] Budget not found: ' + data.id);
    return errorResponse('Budget tidak ditemukan');
  } catch (error) {
    Logger.log('[DELETE_BUDGET ERROR] ' + error.toString());
    return errorResponse('Gagal menghapus budget: ' + error.toString());
  }
}

// ===== RPD MANAGEMENT =====
function getRPDs(data) {
  Logger.log('[GET_RPDS] KUA: ' + data.kua + ', Year: ' + data.year);
  
  try {
    const rows = _sheetValues(SHEETS.RPD);
    const rpds = [];
    
    Logger.log('[GET_RPDS] Total rows: ' + rows.length);
    
    for (let i = 1; i < rows.length; i++) {
      if ((!data.kua || rows[i][1] === data.kua) && 
          (!data.year || rows[i][3] == data.year)) {
        
        // ✅ FIX: Parse data dengan error handling
        let rpdData = {};
        try {
          rpdData = JSON.parse(rows[i][5] || '{}');
        } catch (parseError) {
          Logger.log('[GET_RPDS] Failed to parse RPD data for row ' + (i+1) + ': ' + parseError.toString());
          rpdData = {};
        }
        
        rpds.push({
          id: rows[i][0],
          kua: rows[i][1],
          month: rows[i][2],
          year: rows[i][3],
          total: parseFloat(rows[i][4]) || 0,
          data: rpdData,  // ✅ Data sudah di-parse
          createdAt: safeFormatDate(rows[i][6]),
          updatedAt: safeFormatDate(rows[i][7]),
          userId: rows[i][8],
          username: rows[i][9]
        });
      }
    }
    
    Logger.log('[GET_RPDS] Found: ' + rpds.length + ' RPDs');
    return successResponse(rpds);
  } catch (error) {
    Logger.log('[GET_RPDS ERROR] ' + error.toString());
    return errorResponse('Gagal memuat RPD: ' + error.toString());
  }
}

function saveRPD(data) {
  Logger.log('[SAVE_RPD] KUA: ' + data.kua + ', Month: ' + data.month + ', Year: ' + data.year);
  Logger.log('[SAVE_RPD] Data received: ' + JSON.stringify(data.data));
  
  try {
    const sheet = getSheet(SHEETS.RPD);
    const rows = sheet.getDataRange().getValues();
    const now = new Date();
    
    // Check if RPD already exists (same KUA, month, year)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === data.kua && 
          rows[i][2] === data.month && 
          rows[i][3] == data.year) {
        
        // ✅ FIX: Update dengan stringify data
        sheet.getRange(i + 1, 5).setValue(parseFloat(data.total) || 0);
        sheet.getRange(i + 1, 6).setValue(JSON.stringify(data.data));  // ✅ Stringify dengan benar
        sheet.getRange(i + 1, 8).setValue(now);
        sheet.getRange(i + 1, 9).setValue(data.userId);
        sheet.getRange(i + 1, 10).setValue(data.username);
        
        Logger.log('[SAVE_RPD] Updated RPD at row: ' + (i + 1));
        return successResponse({ 
          message: 'RPD berhasil diupdate',
          id: rows[i][0]
        });
      }
    }
    
    // Create new RPD
    const id = 'RPD-' + Utilities.getUuid();
    const newRow = [
      id,
      data.kua,
      data.month,
      data.year,
      parseFloat(data.total) || 0,
      JSON.stringify(data.data),  // ✅ Stringify dengan benar
      now,
      now,
      data.userId,
      data.username
    ];
    
    sheet.appendRow(newRow);
    Logger.log('[SAVE_RPD] Created new RPD with ID: ' + id);
    Logger.log('[SAVE_RPD] Data column value: ' + JSON.stringify(data.data));
    
    return successResponse({ 
      message: 'RPD berhasil disimpan',
      id: id
    });
    
  } catch (error) {
    Logger.log('[SAVE_RPD ERROR] ' + error.toString());
    Logger.log('[SAVE_RPD ERROR STACK] ' + error.stack);
    return errorResponse('Gagal menyimpan RPD: ' + error.toString());
  }
}

function deleteRPD(data) {
  Logger.log('[DELETE_RPD] ID: ' + data.id);
  
  try {
    const sheet = getSheet(SHEETS.RPD);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.deleteRow(i + 1);
        Logger.log('[DELETE_RPD] Deleted RPD ID: ' + data.id);
        return successResponse({ message: 'RPD berhasil dihapus' });
      }
    }
    
    Logger.log('[DELETE_RPD] RPD not found: ' + data.id);
    return errorResponse('RPD tidak ditemukan');
  } catch (error) {
    Logger.log('[DELETE_RPD ERROR] ' + error.toString());
    return errorResponse('Gagal menghapus RPD: ' + error.toString());
  }
}

// ===== REALISASI MANAGEMENT =====
function getRealisasis(data) {
  const _t0 = Date.now();
  Logger.log('[GET_REALISASIS] KUA: ' + data.kua + ', Year: ' + data.year + ', Month: ' + data.month);
  
  try {
    const rows = _sheetValues(SHEETS.REALISASI);
    if (rows.length < 2) return successResponse([]);
    const realisasis = [];
    
    Logger.log('[GET_REALISASIS] Total rows: ' + rows.length);
    
    // ✅ CORRECT COLUMN READING:
    // A    B    C      D        E      F      G     H      I       J      K          L          M           N        O         P
    // ID | KUA | Bulan | RPD_ID | Tahun | Total | Data | Files | Status | Notes | CreatedAt | UpdatedAt | VerifiedAt | UserID | Username | VerifiedBy
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Filter by KUA and Year
      if ((!data.kua || row[1] === data.kua) && 
          (!data.month || row[2] === data.month) &&
          (!data.year || row[4] == data.year)) {
        
        // Parse Data (JSON)
        let parsedData = {};
        try {
          if (row[6] && typeof row[6] === 'string') {
            parsedData = JSON.parse(row[6]);
          }
        } catch (e) {
          Logger.log('[GET_REALISASIS] Error parsing data for row ' + i + ':', e);
        }
        
        // Parse Files (JSON)
        let parsedFiles = [];
        try {
          if (row[7] && typeof row[7] === 'string') {
            parsedFiles = JSON.parse(row[7]);
          }
        } catch (e) {
          Logger.log('[GET_REALISASIS] Error parsing files for row ' + i + ':', e);
        }
        
        realisasis.push({
          id: row[0],              // A: ID
          kua: row[1],             // B: KUA
          month: row[2],           // C: Bulan
          rpdId: row[3] || '',     // D: RPD ID ✅
          year: row[4],            // E: Tahun ✅
          total: parseFloat(row[5]) || 0,  // F: Total ✅
          data: parsedData,        // G: Data (parsed)
          files: parsedFiles,      // H: Files (parsed) ✅
          status: normalizeStatus(row[8] || 'Waiting'),  // I: Status
          notes: row[9] || '',     // J: Notes
          createdAt: safeFormatDate(row[10]),  // K: Created At
          updatedAt: safeFormatDate(row[11]),  // L: Updated At
          verifiedAt: safeFormatDate(row[12]), // M: Verified At
          userId: row[13] || '',   // N: User ID
          username: row[14] || '', // O: Username
          verifiedBy: row[15] || '' // P: Verified By
        });
      }
    }
    
    Logger.log('[GET_REALISASIS] Found: ' + realisasis.length + ' realisasis, rows=' + rows.length + ', ' + (Date.now() - _t0) + ' ms');
    return successResponse(realisasis);
    
  } catch (error) {
    Logger.log('[GET_REALISASIS ERROR] ' + error.toString());
    return errorResponse('Gagal memuat realisasi: ' + error.toString());
  }
}

function saveRealisasi(data) {
  Logger.log('[SAVE_REALISASI] ========== START ==========');
  Logger.log('[SAVE_REALISASI] Data received:', JSON.stringify(data));
  
  try {
    const realisasiSheet = getSheet(SHEETS.REALISASI);
    const rows = realisasiSheet.getDataRange().getValues();
    
    // ✅ Validate required fields
    if (!data.kua || !data.month || !data.year) {
      Logger.log('[SAVE_REALISASI ERROR] Missing required fields');
      return errorResponse('Data tidak lengkap: KUA, Bulan, dan Tahun harus diisi');
    }
    
    // ✅ Validate and prepare files
    let filesData = [];
    if (data.files) {
      if (Array.isArray(data.files)) {
        filesData = data.files;
      } else if (typeof data.files === 'string') {
        try {
          filesData = JSON.parse(data.files);
        } catch (e) {
          Logger.log('[SAVE_REALISASI] Error parsing files:', e);
          filesData = [];
        }
      }
      
      // Filter valid files only
      filesData = filesData.filter(function(file) {
        return file && file.fileName && file.fileUrl;
      });
      
      Logger.log('[SAVE_REALISASI] Valid files count:', filesData.length);
    }
    
    const now = new Date();
    const realisasiData = JSON.stringify(data.data || {});
    const filesJSON = JSON.stringify(filesData);
    
    Logger.log('[SAVE_REALISASI] Files JSON:', filesJSON);
    
    // ✅ Find existing row
    let rowIndex = -1;
    if (data.id) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.id) {
          rowIndex = i;
          Logger.log('[SAVE_REALISASI] Found existing row at:', rowIndex);
          break;
        }
      }
    }
    
    if (rowIndex === -1) {
      // ✅ CREATE NEW - CRITICAL: CORRECT COLUMN ORDER
      const newId = 'REA-' + Date.now();
      Logger.log('[SAVE_REALISASI] Creating new realisasi with ID:', newId);
      
      // ✅ CORRECT COLUMN MAPPING:
      // A    B         C       D       E       F         G     H       I        J       K           L           M           N         O          P
      // ID | KUA | Bulan | RPD_ID | Tahun | Total | Data | Files | Status | Notes | CreatedAt | UpdatedAt | VerifiedAt | UserID | Username | VerifiedBy
      
      realisasiSheet.appendRow([
        newId,                  // A: ID
        data.kua,               // B: KUA
        data.month,             // C: Bulan
        data.rpdId || '',       // D: RPD ID ✅ (NOT YEAR!)
        data.year,              // E: Tahun ✅ (NOT TOTAL!)
        data.total || 0,        // F: Total ✅
        realisasiData,          // G: Data (JSON)
        filesJSON,              // H: Files (JSON) ✅
        'Waiting',              // I: Status
        '',                     // J: Notes
        now.toISOString(),      // K: Created At
        now.toISOString(),      // L: Updated At
        '',                     // M: Verified At
        data.userId || '',      // N: User ID
        data.username || '',    // O: Username
        ''                      // P: Verified By
      ]);
      
      Logger.log('[SAVE_REALISASI] New realisasi created successfully');
      
    } else {
      // ✅ UPDATE EXISTING - CRITICAL: CORRECT COLUMN ORDER
      Logger.log('[SAVE_REALISASI] Updating existing realisasi at row:', rowIndex + 1);
      
      // Update columns (1-based index)
      realisasiSheet.getRange(rowIndex + 1, 3).setValue(data.month);      // C: Bulan
      realisasiSheet.getRange(rowIndex + 1, 4).setValue(data.rpdId || ''); // D: RPD ID
      realisasiSheet.getRange(rowIndex + 1, 5).setValue(data.year);       // E: Tahun
      realisasiSheet.getRange(rowIndex + 1, 6).setValue(data.total || 0); // F: Total
      realisasiSheet.getRange(rowIndex + 1, 7).setValue(realisasiData);   // G: Data
      realisasiSheet.getRange(rowIndex + 1, 8).setValue(filesJSON);       // H: Files
      realisasiSheet.getRange(rowIndex + 1, 12).setValue(now.toISOString()); // L: Updated At
      
      Logger.log('[SAVE_REALISASI] Realisasi updated successfully');
    }
    
    Logger.log('[SAVE_REALISASI] ========== SUCCESS ==========');
    return successResponse({ message: 'Realisasi berhasil disimpan' });
    
  } catch (error) {
    Logger.log('[SAVE_REALISASI ERROR]', error.toString());
    Logger.log('[SAVE_REALISASI ERROR STACK]', error.stack);
    return errorResponse('Gagal menyimpan realisasi: ' + error.toString());
  }
}

function updateRealisasiStatus(data) {
  Logger.log('[UPDATE_REALISASI_STATUS] ========== START ==========');
  Logger.log('[UPDATE_REALISASI_STATUS] ID: ' + data.id);
  Logger.log('[UPDATE_REALISASI_STATUS] Status: ' + data.status);
  Logger.log('[UPDATE_REALISASI_STATUS] Notes: ' + data.notes);
  Logger.log('[UPDATE_REALISASI_STATUS] Verified By: ' + data.verifiedBy);
  
  try {
    const sheet = getSheet(SHEETS.REALISASI);
    const rows = sheet.getDataRange().getValues();
    const now = new Date();
    
    Logger.log('[UPDATE_REALISASI_STATUS] Searching for ID: ' + data.id);
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        Logger.log('[UPDATE_REALISASI_STATUS] Found realisasi at row: ' + (i + 1));
        
        // Kolom sesuai struktur:
        // A=ID, B=KUA, C=Bulan, D=RPD_ID, E=Tahun, F=Total, G=Data, H=Files, 
        // I=Status, J=Notes, K=CreatedAt, L=UpdatedAt, M=VerifiedAt, N=UserID, O=Username, P=VerifiedBy
        
        sheet.getRange(i + 1, 9, 1, 2).setValues([[data.status, data.notes || '']]);   // I:J sekaligus (Status, Notes)
        sheet.getRange(i + 1, 13).setValue(now);                  // M: VerifiedAt
        sheet.getRange(i + 1, 16).setValue(data.verifiedBy || '');// P: VerifiedBy
        
        Logger.log('[UPDATE_REALISASI_STATUS] Status updated to: ' + data.status);
        
        // Update budget total realisasi jika diterima
        if (normalizeStatus(data.status) === 'Approved') {
          const kua = rows[i][1];   // B: KUA
          const year = rows[i][4];  // E: Tahun
          
          Logger.log('[UPDATE_REALISASI_STATUS] Updating budget for KUA: ' + kua + ', Year: ' + year);
          updateBudgetTotalRealisasi(kua, year);
        }
        
        Logger.log('[UPDATE_REALISASI_STATUS] ✅ SUCCESS');
        return successResponse({ message: 'Status realisasi berhasil diupdate' });
      }
    }
    
    Logger.log('[UPDATE_REALISASI_STATUS] ❌ Realisasi not found');
    return errorResponse('Realisasi tidak ditemukan');
    
  } catch (error) {
    Logger.log('[UPDATE_REALISASI_STATUS ERROR] ' + error.toString());
    Logger.log('[UPDATE_REALISASI_STATUS ERROR STACK] ' + error.stack);
    return errorResponse('Gagal update status: ' + error.toString());
  }
}

function deleteRealisasi(data) {
  Logger.log('[DELETE_REALISASI] ID: ' + data.id);
  
  try {
    const sheet = getSheet(SHEETS.REALISASI);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        const kua = rows[i][1];
        const year = rows[i][4];
        const status = rows[i][8];
        
        sheet.deleteRow(i + 1);
        
        if (normalizeStatus(status) === 'Approved') {
          updateBudgetTotalRealisasi(kua, year);
        }
        
        Logger.log('[DELETE_REALISASI] Deleted realisasi ID: ' + data.id);
        return successResponse({ message: 'Realisasi berhasil dihapus' });
      }
    }
    
    Logger.log('[DELETE_REALISASI] Realisasi not found: ' + data.id);
    return errorResponse('Realisasi tidak ditemukan');
  } catch (error) {
    Logger.log('[DELETE_REALISASI ERROR] ' + error.toString());
    return errorResponse('Gagal menghapus realisasi: ' + error.toString());
  }
}

function verifyRealisasi(data) {
  Logger.log('[VERIFY_REALISASI] ID: ' + data.id + ', Status: ' + data.status);
  
  try {
    const sheet = getSheet(SHEETS.REALISASI);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.getRange(i + 1, 9).setValue(data.status);
        sheet.getRange(i + 1, 10).setValue(data.catatan || '');
        sheet.getRange(i + 1, 13).setValue(new Date());
        
        if (normalizeStatus(data.status) === 'Approved') {
          const kua = rows[i][1];
          const year = rows[i][4];
          updateBudgetTotalRealisasi(kua, year);
        }
        
        Logger.log('[VERIFY_REALISASI] Verified realisasi ID: ' + data.id);
        return successResponse({ message: 'Verifikasi berhasil' });
      }
    }
    
    Logger.log('[VERIFY_REALISASI] Realisasi not found: ' + data.id);
    return errorResponse('Realisasi tidak ditemukan');
  } catch (error) {
    Logger.log('[VERIFY_REALISASI ERROR] ' + error.toString());
    return errorResponse('Gagal verifikasi: ' + error.toString());
  }
}

function updateBudgetTotalRealisasi(kua, year) {
  try {
    const realisasiSheet = getSheet(SHEETS.REALISASI);
    const budgetSheet = getSheet(SHEETS.BUDGET);
    const realisasiRows = realisasiSheet.getDataRange().getValues();
    const budgetRows = budgetSheet.getDataRange().getValues();
    
    let total = 0;
    for (let i = 1; i < realisasiRows.length; i++) {
      if (realisasiRows[i][1] === kua && 
          realisasiRows[i][4] == year && 
          normalizeStatus(realisasiRows[i][8]) === 'Approved') {
        total += parseFloat(realisasiRows[i][7]) || 0;
      }
    }
    
    for (let i = 1; i < budgetRows.length; i++) {
      if (budgetRows[i][1] === kua && budgetRows[i][2] == year) {
        budgetSheet.getRange(i + 1, 6).setValue(total);
        Logger.log('[UPDATE_BUDGET_REALISASI] Updated budget for ' + kua + ' - ' + year + ': ' + total);
        break;
      }
    }
  } catch (error) {
    Logger.log('[UPDATE_BUDGET_REALISASI ERROR] ' + error.toString());
  }
}

// ===== DASHBOARD STATS =====
function getDashboardStats(data) {
  Logger.log('[GET_DASHBOARD_STATS] KUA: ' + data.kua + ', Year: ' + data.year + ', Role: ' + data.role);
  
  try {
    const year = data.year || new Date().getFullYear();
    
    if (data.role === 'Admin') {
      // ============================================================================
      // ADMIN - Statistik untuk semua KUA
      // ============================================================================
      Logger.log('[GET_DASHBOARD_STATS] Loading stats for Admin');
      
      const budgetSheet = getSheet(SHEETS.BUDGET);
      const rpdSheet = getSheet(SHEETS.RPD);
      const realisasiSheet = getSheet(SHEETS.REALISASI);
      
      const budgetRows = budgetSheet.getDataRange().getValues();
      const rpdRows = rpdSheet.getDataRange().getValues();
      const realisasiRows = realisasiSheet.getDataRange().getValues();
      
      let totalBudget = 0;
      let totalRPD = 0;
      let totalRealisasi = 0;
      let pendingCount = 0;
      
      // Hitung total budget untuk tahun ini
      Logger.log('[GET_DASHBOARD_STATS] Calculating total budget...');
      for (let i = 1; i < budgetRows.length; i++) {
        if (budgetRows[i][2] == year) {
          const budgetAmount = parseFloat(budgetRows[i][3]) || 0;
          totalBudget += budgetAmount;
          Logger.log('[GET_DASHBOARD_STATS] Budget ' + budgetRows[i][1] + ': ' + budgetAmount);
        }
      }
      
      // Hitung total RPD untuk tahun ini
      Logger.log('[GET_DASHBOARD_STATS] Calculating total RPD...');
      for (let i = 1; i < rpdRows.length; i++) {
        if (rpdRows[i][3] == year) {
          const rpdAmount = parseFloat(rpdRows[i][4]) || 0;
          totalRPD += rpdAmount;
        }
      }
      
      // Hitung total realisasi yang diterima dan count yang pending
      Logger.log('[GET_DASHBOARD_STATS] Calculating total realisasi and pending...');
      for (let i = 1; i < realisasiRows.length; i++) {
        if (realisasiRows[i][4] == year) {
          const status = realisasiRows[i][8];
          
          // Total realisasi yang sudah diterima
          if (normalizeStatus(status) === 'Approved') {
            const realisasiAmount = parseFloat(realisasiRows[i][5]) || 0;
            totalRealisasi += realisasiAmount;
          }
          
          // Count pending verifikasi
          if (normalizeStatus(status) === 'Waiting') {
            pendingCount++;
          }
        }
      }
      
      Logger.log('[GET_DASHBOARD_STATS] Admin Stats - Budget: ' + totalBudget + ', RPD: ' + totalRPD + ', Realisasi: ' + totalRealisasi + ', Pending: ' + pendingCount);
      
      return successResponse({
        budget: totalBudget,
        totalBudget: totalBudget,  // Alias
        totalRPD: totalRPD,
        pagu: totalRPD,  // Alias
        totalRealisasi: totalRealisasi,
        realisasi: totalRealisasi,  // Alias
        sisaBudget: totalBudget - totalRealisasi,
        pendingVerifikasi: pendingCount,
        menungguVerifikasi: pendingCount  // Alias
      });
      
    } else {
      // ============================================================================
      // OPERATOR - Statistik untuk KUA sendiri
      // ============================================================================
      Logger.log('[GET_DASHBOARD_STATS] Loading stats for Operator: ' + data.kua);
      
      const kua = data.kua;
      
      const budget = calculateTotalBudget(kua, year);
      const totalRPD = calculateTotalRPD(kua, year);
      const totalRealisasi = calculateTotalRealisasi(kua, year);
      
      Logger.log('[GET_DASHBOARD_STATS] Operator Stats - Budget: ' + budget + ', RPD: ' + totalRPD + ', Realisasi: ' + totalRealisasi);
      
      return successResponse({
        budget: budget,
        totalBudget: budget,  // Alias
        totalRPD: totalRPD,
        pagu: totalRPD,  // Alias
        totalRealisasi: totalRealisasi,
        realisasi: totalRealisasi,  // Alias
        sisaBudget: budget - totalRealisasi
      });
    }
  } catch (error) {
    Logger.log('[GET_DASHBOARD_STATS ERROR] ' + error.toString());
    return errorResponse('Gagal memuat statistik: ' + error.toString());
  }
}

function calculateTotalBudget(kua, year) {
  try {
    const rows = _sheetValues(SHEETS.BUDGET);
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === kua && rows[i][2] == year) {
        const budgetAmount = parseFloat(rows[i][3]) || 0;
        Logger.log('[CALCULATE_TOTAL_BUDGET] ' + kua + ' - ' + year + ': ' + budgetAmount);
        return budgetAmount;
      }
    }
    
    Logger.log('[CALCULATE_TOTAL_BUDGET] No budget found for ' + kua + ' - ' + year);
    return 0;
  } catch (error) {
    Logger.log('[CALCULATE_TOTAL_BUDGET ERROR] ' + error.toString());
    return 0;
  }
}

// ===== CONFIG MANAGEMENT =====
function getRPDConfig(data) {
  Logger.log('[GET_RPD_CONFIG] Getting config from sheet');
  
  try {
    const rows = _sheetValues(SHEETS.CONFIG);
    
    const config = {};
    
    // Parse config dari sheet (Skip header row)
    for (let i = 1; i < rows.length; i++) {
      const key = rows[i][0];
      const value = rows[i][1];
      if (key) config[key] = value;
    }
    
    Logger.log('[GET_RPD_CONFIG] Config loaded: ' + Object.keys(config).length + ' keys');
    return successResponse(config);
    
  } catch (error) {
    Logger.log('[GET_RPD_CONFIG ERROR] ' + error.toString());
    return errorResponse('Gagal memuat konfigurasi: ' + error.toString());
  }
}

function saveRPDConfig(data) {
  Logger.log('[SAVE_RPD_CONFIG] Updating config');
  Logger.log('[SAVE_RPD_CONFIG] Data:', JSON.stringify(data));
  
  try {
    const configSheet = getSheet(SHEETS.CONFIG);
    const rows = configSheet.getDataRange().getValues();
    
    // Update RPD_STATUS
    if (data.rpdStatus !== undefined) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'RPD_STATUS') {
          configSheet.getRange(i + 1, 2).setValue(data.rpdStatus);
          Logger.log('[SAVE_RPD_CONFIG] RPD_STATUS updated to: ' + data.rpdStatus);
          break;
        }
      }
    }
    
    // Update REALISASI_STATUS
    if (data.realisasiStatus !== undefined) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'REALISASI_STATUS') {
          configSheet.getRange(i + 1, 2).setValue(data.realisasiStatus);
          Logger.log('[SAVE_RPD_CONFIG] REALISASI_STATUS updated to: ' + data.realisasiStatus);
          break;
        }
      }
    }
    
    // Update REALISASI_MAX_FILE_SIZE
    if (data.realisasiMaxFileSize !== undefined) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'REALISASI_MAX_FILE_SIZE') {
          configSheet.getRange(i + 1, 2).setValue(parseInt(data.realisasiMaxFileSize));
          Logger.log('[SAVE_RPD_CONFIG] REALISASI_MAX_FILE_SIZE updated to: ' + data.realisasiMaxFileSize);
          break;
        }
      }
    }
    
    // Update REALISASI_MAX_FILES
    if (data.realisasiMaxFiles !== undefined) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'REALISASI_MAX_FILES') {
          configSheet.getRange(i + 1, 2).setValue(parseInt(data.realisasiMaxFiles));
          Logger.log('[SAVE_RPD_CONFIG] REALISASI_MAX_FILES updated to: ' + data.realisasiMaxFiles);
          break;
        }
      }
    }
    
    // Update LAST_UPDATED
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === 'LAST_UPDATED') {
        configSheet.getRange(i + 1, 2).setValue(new Date().toISOString());
        break;
      }
    }
    
    Logger.log('[SAVE_RPD_CONFIG] Config saved successfully');
    return successResponse({ message: 'Konfigurasi berhasil disimpan' });
    
  } catch (error) {
    Logger.log('[SAVE_RPD_CONFIG ERROR] ' + error.toString());
    return errorResponse('Gagal menyimpan konfigurasi: ' + error.toString());
  }
}

// ===== EXPORT FUNCTIONS =====

// 1. Export RPD per Year
function exportRPDPerYear(data) {
  Logger.log('[EXPORT_RPD_PER_YEAR] Format: ' + data.format + ', KUA: ' + data.kua + ', Year: ' + data.year);
  
  try {
    const budgetSheet = getSheet(SHEETS.BUDGET);
    const rpdSheet = getSheet(SHEETS.RPD);
    
    const budgets = budgetSheet.getDataRange().getValues();
    const rpds = rpdSheet.getDataRange().getValues();
    
    Logger.log('[EXPORT_RPD_PER_YEAR] Total budgets: ' + (budgets.length - 1));
    Logger.log('[EXPORT_RPD_PER_YEAR] Total RPDs: ' + (rpds.length - 1));
    
    const yearBudgets = [];
    for (let i = 1; i < budgets.length; i++) {
      if (budgets[i][2] == data.year) {
        if (!data.kua || budgets[i][1] === data.kua) {
          yearBudgets.push({
            kua: budgets[i][1],
            budget: parseFloat(budgets[i][3]) || 0
          });
        }
      }
    }
    
    Logger.log('[EXPORT_RPD_PER_YEAR] Year budgets found: ' + yearBudgets.length);
    
    const result = yearBudgets.map(b => {
      const row = {
        kua: b.kua,
        budget: b.budget,
        months: {}
      };
      
      MONTHS.forEach(month => {
        row.months[month] = 0;
      });
      
      // ✅ FIX: Kolom yang benar
      // RPD Sheet: A=ID, B=KUA, C=Bulan, D=Tahun, E=Total, F=Data
      for (let i = 1; i < rpds.length; i++) {
        if (rpds[i][1] === b.kua && rpds[i][3] == data.year) {  // B=KUA, D=Tahun
          const month = rpds[i][2];  // C: Bulan
          const total = parseFloat(rpds[i][4]) || 0;  // E: Total ✅
          
          Logger.log('[EXPORT_RPD_PER_YEAR] RPD found: ' + b.kua + ' - ' + month + ' = ' + total);
          
          row.months[month] = total;
        }
      }
      
      row.totalRPD = Object.values(row.months).reduce((sum, val) => sum + val, 0);
      row.sisa = b.budget - row.totalRPD;
      
      Logger.log('[EXPORT_RPD_PER_YEAR] Result for ' + b.kua + ': totalRPD=' + row.totalRPD + ', sisa=' + row.sisa);
      
      return row;
    });
    
    if (data.format === 'pdf') {
      return exportRPDPerYearPDF(result, data.year, data.kua);
    } else {
      return exportRPDPerYearExcel(result, data.year, data.kua);
    }
  } catch (error) {
    Logger.log('[EXPORT_RPD_PER_YEAR ERROR] ' + error.toString());
    return errorResponse('Gagal export: ' + error.toString());
  }
}

function exportRPDPerYearExcel(data, year, kua) {
  let tsv = `LAPORAN RPD PER TAHUN ${year}\n`;
  if (kua) tsv += `KUA: ${kua}\n`;
  tsv += `\nNo\tKUA\tBudget\t`;
  
  MONTHS.forEach(month => {
    tsv += `${month}\t`;
  });
  tsv += `Total RPD\tSisa\n`;
  
  data.forEach((row, index) => {
    tsv += `${index + 1}\t${row.kua}\t${row.budget}\t`;
    MONTHS.forEach(month => {
      tsv += `${row.months[month]}\t`;
    });
    tsv += `${row.totalRPD}\t${row.sisa}\n`;
  });
  
  const blob = Utilities.newBlob(tsv, 'text/tab-separated-values');
  const base64 = Utilities.base64Encode(blob.getBytes());
  
  Logger.log('[EXPORT_RPD_PER_YEAR_EXCEL] Export completed');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_RPD_${year}${kua ? '_' + kua : ''}.xls`,
    mimeType: 'application/vnd.ms-excel'
  });
}

function exportRPDPerYearPDF(data, year, kua) {
  // ✅ FIX BUG #4: Perbaiki styling PDF untuk lebih nyaman dibaca
  let html = `<html><head><style>
    @page { 
      size: A4 landscape;     /* Landscape untuk tabel yang lebar */
      margin: 15mm 10mm;      /* Margin yang cukup */
    }
    body { 
      font-family: 'Arial', sans-serif; 
      font-size: 9pt;         /* ✅ Font lebih besar dari sebelumnya (8px) */
      margin: 0;
      padding: 0;
    }
    h3 { 
      text-align: center; 
      margin: 0 0 5px 0;
      font-size: 14pt;        /* ✅ Judul lebih besar */
      font-weight: bold;
    }
    p { 
      text-align: center; 
      margin: 0 0 15px 0;
      font-size: 11pt;        /* ✅ Sub-judul jelas */
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 10px;
      font-size: 8pt;         /* ✅ Tabel sedikit lebih kecil dari body */
    }
    th { 
      background-color: #4CAF50;
      color: white;
      font-weight: bold;
      padding: 6px 4px;       /* ✅ Padding yang cukup */
      border: 1px solid #333;
      text-align: center;
      font-size: 9pt;
    }
    td { 
      padding: 5px 4px;       /* ✅ Padding yang nyaman */
      border: 1px solid #666;
      text-align: right;      /* Angka rata kanan */
    }
    td:first-child,           /* No */
    td:nth-child(2) {         /* KUA */
      text-align: center;
    }
    .amount {
      text-align: right;
      font-family: 'Courier New', monospace; /* ✅ Font monospace untuk angka */
    }
  </style></head><body>
  <h3>LAPORAN RPD PER TAHUN ${year}</h3>`;
  
  if (kua) html += `<p>KUA: ${kua}</p>`;
  else html += `<p>Kementerian Agama Kabupaten Indramayu</p>`;
  
  html += `<table>
    <thead>
      <tr>
        <th style="width: 3%;">No</th>
        <th style="width: 15%;">KUA</th>
        <th style="width: 8%;">Budget</th>`;
  
  // Header bulan
  MONTHS.forEach(month => {
    html += `<th style="width: 5%;">${month.substring(0, 3)}</th>`; // ✅ Singkat agar muat
  });
  html += `<th style="width: 8%;">Total RPD</th>
           <th style="width: 8%;">Sisa</th>
      </tr>
    </thead>
    <tbody>`;
  
  // Data rows
  data.forEach((row, index) => {
    html += `<tr>
      <td style="text-align: center;">${index + 1}</td>
      <td style="text-align: left;">${row.kua}</td>
      <td class="amount">${formatCurrency(row.budget)}</td>`;
    
    MONTHS.forEach(month => {
      html += `<td class="amount">${formatCurrency(row.months[month])}</td>`;
    });
    
    html += `<td class="amount" style="font-weight: bold; background: #f0f0f0;">${formatCurrency(row.totalRPD)}</td>
             <td class="amount" style="font-weight: bold; background: #fff3cd;">${formatCurrency(row.sisa)}</td>
           </tr>`;
  });
  
  html += `</tbody></table></body></html>`;
  
  const blob = Utilities.newBlob(html, 'text/html');
  const pdfBlob = blob.getAs('application/pdf');
  const base64 = Utilities.base64Encode(pdfBlob.getBytes());
  
  Logger.log('[EXPORT_RPD_PER_YEAR_PDF] Export completed');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_RPD_${year}${kua ? '_' + kua : ''}.pdf`,
    mimeType: 'application/pdf'
  });
}

// 2. Export RPD Detail Year - CORRECTED FORMAT
function exportRPDDetailYear(data) {
  Logger.log('[EXPORT_RPD_DETAIL_YEAR] Format: ' + data.format + ', Year: ' + data.year);
  
  try {
    const rpdSheet = getSheet(SHEETS.RPD);
    const rpds = rpdSheet.getDataRange().getValues();
    
    Logger.log('[EXPORT_RPD_DETAIL_YEAR] Total RPD rows: ' + (rpds.length - 1));
    
    const rpdByKUA = {};
    const kuaList = new Set();
    
    // ✅ FIX: Gunakan index yang benar untuk tahun
    // RPD Sheet: A=ID(0), B=KUA(1), C=Bulan(2), D=Tahun(3), E=Total(4), F=Data(5)
    for (let i = 1; i < rpds.length; i++) {
      const rowYear = rpds[i][3];  // ✅ FIXED: Index 3 untuk tahun (bukan 4)
      const kua = rpds[i][1];
      const rpdDataString = rpds[i][5];
      
      Logger.log('[EXPORT_RPD_DETAIL_YEAR] Row ' + i + ': KUA=' + kua + ', Year=' + rowYear + ', Filter=' + data.year);
      
      if (rowYear == data.year) {
        Logger.log('[EXPORT_RPD_DETAIL_YEAR] ✓ Year match! Adding KUA: ' + kua);
        kuaList.add(kua);
        
        if (!rpdByKUA[kua]) {
          rpdByKUA[kua] = {};
        }
        
        let rpdData = {};
        try {
          rpdData = JSON.parse(rpdDataString || '{}');
          Logger.log('[EXPORT_RPD_DETAIL_YEAR] Parsed data for ' + kua + ':', JSON.stringify(rpdData));
        } catch (parseError) {
          Logger.log('[EXPORT_RPD_DETAIL_YEAR] JSON parse error: ' + parseError.toString());
        }
        
        // Aggregate data per code and item
        Object.keys(rpdData).forEach(code => {
          if (!rpdByKUA[kua][code]) {
            rpdByKUA[kua][code] = {};
          }
          Object.keys(rpdData[code]).forEach(item => {
            if (!rpdByKUA[kua][code][item]) {
              rpdByKUA[kua][code][item] = 0;
            }
            rpdByKUA[kua][code][item] += parseFloat(rpdData[code][item]) || 0;
          });
        });
      }
    }
    
    const sortedKUAs = Array.from(kuaList).sort();
    
    Logger.log('[EXPORT_RPD_DETAIL_YEAR] Total KUAs found: ' + sortedKUAs.length);
    Logger.log('[EXPORT_RPD_DETAIL_YEAR] KUAs: ' + JSON.stringify(sortedKUAs));
    
    if (sortedKUAs.length === 0) {
      Logger.log('[EXPORT_RPD_DETAIL_YEAR] WARNING: No RPD data found for year ' + data.year);
      return errorResponse('Tidak ada data RPD untuk tahun ' + data.year);
    }
    
    if (data.format === 'pdf') {
      return exportRPDDetailYearPDF(rpdByKUA, sortedKUAs, data.year);
    } else {
      return exportRPDDetailYearExcel(rpdByKUA, sortedKUAs, data.year);
    }
  } catch (error) {
    Logger.log('[EXPORT_RPD_DETAIL_YEAR ERROR] ' + error.toString());
    return errorResponse('Gagal export: ' + error.toString());
  }
}

function exportRPDDetailYearExcel(rpdByKUA, kuaList, year) {
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_EXCEL] Starting export for year: ' + year);
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_EXCEL] KUA count: ' + kuaList.length);
  
  let tsv = `LAPORAN RPD DETAIL - TAHUN ${year}\n`;
  tsv += `Kementerian Agama Kabupaten Indramayu\n\n`;
  
  // ✅ FIX #4: Header dengan kolom KUA
  tsv += `No\tKode\tUraian Program/Kegiatan/Output/Komponen`;
  kuaList.forEach(kua => {
    tsv += `\t${kua}`;
  });
  tsv += `\tJUMLAH\n`;
  
  let rowNum = 0;
  let grandTotal = {};
  kuaList.forEach(kua => { grandTotal[kua] = 0; });
  let grandTotalAll = 0;
  
  // Header row
  rowNum++;
  tsv += `${rowNum}\t025.04.WA\tDukungan Manajemen dan Pelaksanaan Tugas Teknis Lainnya Bimas Islam`;
  kuaList.forEach(() => tsv += `\t`);
  tsv += `\t\n`;
  
  // ✅ FIX #4: Iterasi setiap parameter dan tampilkan nilai per KUA
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(code => {
    const config = BOP_CONFIG.RPD_PARAMETERS[code];
    
    // Calculate totals
    let codeTotal = {};
    kuaList.forEach(kua => { codeTotal[kua] = 0; });
    let codeTotalAll = 0;
    
    config.items.forEach(item => {
      kuaList.forEach(kua => {
        const value = (rpdByKUA[kua] && rpdByKUA[kua][code] && rpdByKUA[kua][code][item]) || 0;
        codeTotal[kua] += value;
        codeTotalAll += value;
      });
    });
    
    // Header row for parameter
    tsv += `\t${code}\t${config.name}`;
    kuaList.forEach(kua => {
      if (config.hasSubItems) {
        tsv += `\t`;  // Empty for codes with breakdown
      } else {
        tsv += `\t${codeTotal[kua]}`;  // Show total for codes without breakdown
      }
    });
    if (config.hasSubItems) {
      tsv += `\t\n`;
    } else {
      tsv += `\t${codeTotalAll}\n`;
      // Add to grand total for non-breakdown items
      kuaList.forEach(kua => {
        grandTotal[kua] += codeTotal[kua];
      });
    }
    grandTotalAll += codeTotalAll;
    
    // Sub-items
    if (config.hasSubItems) {
      config.items.forEach((item, idx) => {
        const prefix = String.fromCharCode(97 + idx);
        tsv += `\t\t  ${prefix}. ${item}`;
        
        let itemTotal = 0;
        kuaList.forEach(kua => {
          const value = (rpdByKUA[kua] && rpdByKUA[kua][code] && rpdByKUA[kua][code][item]) || 0;
          tsv += `\t${value}`;
          itemTotal += value;
          grandTotal[kua] += value;
        });
        tsv += `\t${itemTotal}\n`;
      });
    }
  });
  
  // Grand total row
  tsv += `JUMLAH\t\t`;
  kuaList.forEach(kua => {
    tsv += `\t${grandTotal[kua]}`;
  });
  tsv += `\t${grandTotalAll}\n`;
  
  const blob = Utilities.newBlob(tsv, 'text/tab-separated-values');
  const base64 = Utilities.base64Encode(blob.getBytes());
  
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_EXCEL] Export completed');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_RPD_Detail_${year}.xls`,
    mimeType: 'application/vnd.ms-excel'
  });
}

function exportRPDDetailYearPDF(rpdByKUA, kuaList, year) {
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_PDF] Starting PDF export for year: ' + year);
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_PDF] KUA count: ' + kuaList.length);
  
  // ✅ FIX ISSUE #5: Jika KUA terlalu banyak, split ke multiple pages
  const MAX_KUA_PER_PAGE = 10;  // Maksimal 10 KUA per halaman
  const totalPages = Math.ceil(kuaList.length / MAX_KUA_PER_PAGE);
  
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_PDF] Will create ' + totalPages + ' page(s)');
  
  let allPagesHTML = '';
  
  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const startIdx = pageNum * MAX_KUA_PER_PAGE;
    const endIdx = Math.min(startIdx + MAX_KUA_PER_PAGE, kuaList.length);
    const pageKUAs = kuaList.slice(startIdx, endIdx);
    
    Logger.log('[EXPORT_RPD_DETAIL_YEAR_PDF] Page ' + (pageNum + 1) + ': KUAs ' + (startIdx + 1) + ' to ' + endIdx);
    
    // ✅ Generate HTML untuk satu halaman
    const pageHTML = generateRPDDetailPage(rpdByKUA, pageKUAs, year, pageNum + 1, totalPages);
    allPagesHTML += pageHTML;
    
    // ✅ Tambahkan page break kecuali halaman terakhir
    if (pageNum < totalPages - 1) {
      allPagesHTML += '<div style="page-break-after: always;"></div>';
    }
  }
  
  // ✅ Wrap semua pages dalam HTML complete
  const html = `<html><head><style>
    @page {
      size: A3 landscape;
      margin: 12mm 10mm;
    }
    body { 
      font-family: 'Arial', sans-serif; 
      font-size: 8pt;
      margin: 0;
      padding: 0;
    }
    h3 { 
      text-align: center; 
      margin: 5px 0 3px 0;
      font-size: 13pt;
      font-weight: bold;
    }
    h4 { 
      text-align: center; 
      margin: 0 0 8px 0;
      font-size: 10pt;
      font-weight: normal;
    }
    .page-info {
      text-align: center;
      font-size: 9pt;
      color: #666;
      margin-bottom: 8px;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 8px;
      table-layout: fixed;
    }
    th, td { 
      border: 1px solid #333;
      padding: 4px 3px;
      text-align: center;
      word-wrap: break-word;
      overflow: hidden;
    }
    th { 
      background-color: #4CAF50;
      color: white; 
      font-weight: bold;
      font-size: 8pt;
      padding: 5px 3px;
    }
    td {
      font-size: 7pt;
    }
    .left { 
      text-align: left; 
      padding-left: 5px;
    }
    .code { 
      font-weight: bold; 
      font-size: 7pt;
    }
    .subitem { 
      padding-left: 15px; 
      text-align: left;
      font-size: 7pt;
    }
    .total { 
      background-color: #f0f0f0; 
      font-weight: bold; 
    }
    .amount {
      font-family: 'Courier New', monospace;
      text-align: right;
      padding-right: 5px;
    }
    .kua-col {
      font-size: 7pt;
    }
  </style></head><body>
    ${allPagesHTML}
  </body></html>`;
  
  const blob = Utilities.newBlob(html, 'text/html');
  const pdfBlob = blob.getAs('application/pdf');
  const base64 = Utilities.base64Encode(pdfBlob.getBytes());
  
  Logger.log('[EXPORT_RPD_DETAIL_YEAR_PDF] Export completed with ' + totalPages + ' page(s)');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_RPD_Detail_${year}.pdf`,
    mimeType: 'application/pdf'
  });
}

function generateRPDDetailPage(rpdByKUA, kuaList, year, pageNum, totalPages) {
  let html = `
    <h3>LAPORAN RPD DETAIL - TAHUN ${year}</h3>
    <h4>Kementerian Agama Kabupaten Indramayu</h4>
    <div class="page-info">Halaman ${pageNum} dari ${totalPages}</div>
    <table>
      <thead>
        <tr>
          <th style="width: 3%;">No</th>
          <th style="width: 6%;">Kode</th>
          <th style="width: 20%;">Uraian Program/Kegiatan/Output/Komponen</th>`;
  
  // ✅ Kolom KUA dengan width dinamis
  const kuaColWidth = Math.floor(65 / kuaList.length);
  kuaList.forEach(kua => {
    const shortName = kua.replace('KUA ', '');
    html += `<th class="kua-col" style="width: ${kuaColWidth}%;">${shortName}</th>`;
  });
  
  html += `<th style="width: 6%;">JUMLAH</th>
        </tr>
      </thead>
      <tbody>`;
  
  let rowNum = 0;
  let grandTotal = {};
  kuaList.forEach(kua => { grandTotal[kua] = 0; });
  let grandTotalAll = 0;
  
  // Header row
  rowNum++;
  html += `<tr>
    <td>${rowNum}</td>
    <td class="code">025.04.WA</td>
    <td class="left">Dukungan Manajemen dan Pelaksanaan Tugas Teknis Lainnya Bimas Islam</td>`;
  kuaList.forEach(() => html += `<td></td>`);
  html += `<td></td></tr>`;
  
  // Iterasi parameter
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(code => {
    const config = BOP_CONFIG.RPD_PARAMETERS[code];
    
    let codeTotal = {};
    kuaList.forEach(kua => { codeTotal[kua] = 0; });
    let codeTotalAll = 0;
    
    // Calculate totals
    config.items.forEach(item => {
      kuaList.forEach(kua => {
        const value = (rpdByKUA[kua] && rpdByKUA[kua][code] && rpdByKUA[kua][code][item]) || 0;
        codeTotal[kua] += value;
        codeTotalAll += value;
      });
    });
    
    // Parent row
    html += `<tr>
      <td></td>
      <td class="code">${code}</td>
      <td class="left">${config.name}</td>`;
    
    kuaList.forEach(kua => {
      if (config.hasSubItems) {
        html += `<td></td>`;
      } else {
        html += `<td class="amount">${formatNumber(codeTotal[kua])}</td>`;
        grandTotal[kua] += codeTotal[kua];
      }
    });
    
    if (config.hasSubItems) {
      html += `<td></td></tr>`;
    } else {
      html += `<td class="amount total">${formatNumber(codeTotalAll)}</td></tr>`;
    }
    
    grandTotalAll += codeTotalAll;
    
    // Sub-items
    if (config.hasSubItems) {
      config.items.forEach((item, idx) => {
        const prefix = String.fromCharCode(97 + idx);
        
        html += `<tr>
          <td></td>
          <td></td>
          <td class="subitem">${prefix}. ${item}</td>`;
        
        let itemTotal = 0;
        kuaList.forEach(kua => {
          const value = (rpdByKUA[kua] && rpdByKUA[kua][code] && rpdByKUA[kua][code][item]) || 0;
          html += `<td class="amount">${formatNumber(value)}</td>`;
          itemTotal += value;
          grandTotal[kua] += value;
        });
        
        html += `<td class="amount">${formatNumber(itemTotal)}</td></tr>`;
      });
    }
  });
  
  // Grand total row
  html += `<tr class="total">
    <td colspan="3" style="text-align: center; font-weight: bold;">JUMLAH (Halaman ${pageNum})</td>`;
  kuaList.forEach(kua => {
    html += `<td class="amount">${formatNumber(grandTotal[kua])}</td>`;
  });
  html += `<td class="amount" style="font-size: 8pt;">${formatNumber(grandTotalAll)}</td>
  </tr>`;
  
  html += `</tbody></table>`;
  
  return html;
}

// ===== EXPORT RPD DETAIL PER BULAN =====
function exportRPDDetailMonth(data) {
  Logger.log('[EXPORT_RPD_DETAIL_MONTH] Format: ' + data.format + ', Year: ' + data.year + ', Month: ' + data.month);
  try {
    var rpdSheet = getSheet(SHEETS.RPD);
    var rpds = rpdSheet.getDataRange().getValues();
    // RPD Sheet: A=ID(0), B=KUA(1), C=Bulan(2), D=Tahun(3), E=Total(4), F=Data(5)
    var rpdByKUA = {};
    var kuaSet = new Set();
    for (var i = 1; i < rpds.length; i++) {
      if (rpds[i][3] != data.year || rpds[i][2] !== data.month) continue;
      var kua = rpds[i][1];
      kuaSet.add(kua);
      if (!rpdByKUA[kua]) rpdByKUA[kua] = {};
      var rpdData = {};
      try { rpdData = JSON.parse(rpds[i][5] || '{}'); } catch(e) {}
      Object.keys(rpdData).forEach(function(code) {
        if (!rpdByKUA[kua][code]) rpdByKUA[kua][code] = {};
        Object.keys(rpdData[code]).forEach(function(item) {
          if (!rpdByKUA[kua][code][item]) rpdByKUA[kua][code][item] = 0;
          rpdByKUA[kua][code][item] += parseFloat(rpdData[code][item]) || 0;
        });
      });
    }
    var sortedKUAs = Array.from(kuaSet).sort();
    if (sortedKUAs.length === 0) return errorResponse('Tidak ada data RPD untuk ' + data.month + ' ' + data.year);
    var title = 'LAPORAN RPD DETAIL - ' + data.month.toUpperCase() + ' ' + data.year;
    var slug  = 'RPD_Detail_' + data.month + '_' + data.year;
    if (data.format === 'pdf') {
      return _exportRPDDetailPDF(rpdByKUA, sortedKUAs, title, slug);
    } else {
      return _exportRPDDetailExcel(rpdByKUA, sortedKUAs, title, slug);
    }
  } catch(err) {
    Logger.log('[EXPORT_RPD_DETAIL_MONTH ERROR] ' + err.toString());
    return errorResponse('Gagal export: ' + err.toString());
  }
}

function _exportRPDDetailExcel(rpdByKUA, kuaList, title, slug) {
  var t = title + '\n\nNo\tKode\tUraian\t' + kuaList.join('\t') + '\tTotal\n';
  var grand = {}, grandAll = 0;
  kuaList.forEach(function(k) { grand[k] = 0; });
  var n = 0;
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(code) {
    var cfg = BOP_CONFIG.RPD_PARAMETERS[code], ctot = {}, cAll = 0;
    kuaList.forEach(function(k) { ctot[k] = 0; });
    cfg.items.forEach(function(item) {
      kuaList.forEach(function(k) {
        var v = (rpdByKUA[k] && rpdByKUA[k][code] && rpdByKUA[k][code][item]) ? parseFloat(rpdByKUA[k][code][item]) : 0;
        ctot[k] += v; cAll += v;
      });
    });
    n++;
    t += n + '\t' + code + '\t' + cfg.name;
    // ✅ FIX: only add grand per KUA here if no subitems
    kuaList.forEach(function(k) {
      if (cfg.hasSubItems) {
        t += '\t';
      } else {
        t += '\t' + ctot[k];
        grand[k] += ctot[k];
      }
    });
    if (cfg.hasSubItems) {
      t += '\t\n';
    } else {
      t += '\t' + cAll + '\n';
      grandAll += cAll;
    }
    if (cfg.hasSubItems) {
      cfg.items.forEach(function(item, idx) {
        var pfx = String.fromCharCode(97 + idx), iAll = 0;
        n++; t += n + '\t\t' + pfx + '. ' + item;
        kuaList.forEach(function(k) {
          var v = (rpdByKUA[k] && rpdByKUA[k][code] && rpdByKUA[k][code][item]) ? parseFloat(rpdByKUA[k][code][item]) : 0;
          t += '\t' + v; iAll += v; grand[k] += v; grandAll += v;
        });
        t += '\t' + iAll + '\n';
      });
    }
  });
  t += '\t\tJUMLAH'; kuaList.forEach(function(k) { t += '\t' + grand[k]; }); t += '\t' + grandAll + '\n';
  var blob = Utilities.newBlob(t, 'text/tab-separated-values');
  return successResponse({ fileData: Utilities.base64Encode(blob.getBytes()), fileName: slug + '.xls', mimeType: 'application/vnd.ms-excel' });
}

function _exportRPDDetailPDF(rpdByKUA, kuaList, title, slug) {
  var style = 'body{font-family:Arial;font-size:9px;}table{width:100%;border-collapse:collapse;margin-top:10px;}th,td{border:1px solid #000;padding:4px;text-align:center;}th{background:#dc3545;color:white;}.left{text-align:left;}';
  var h = '<html><head><style>' + style + '</style></head><body><h3 style="text-align:center">' + title + '</h3><table><tr><th>No</th><th>Kode</th><th>Uraian</th>';
  kuaList.forEach(function(k) { h += '<th>' + k + '</th>'; }); h += '<th>Total</th></tr>';
  var grand = {}, grandAll = 0; kuaList.forEach(function(k) { grand[k] = 0; }); var n = 0;
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(code) {
    var cfg = BOP_CONFIG.RPD_PARAMETERS[code], ctot = {}, cAll = 0;
    kuaList.forEach(function(k) { ctot[k] = 0; });
    cfg.items.forEach(function(item) { kuaList.forEach(function(k) { var v = (rpdByKUA[k]&&rpdByKUA[k][code]&&rpdByKUA[k][code][item])?parseFloat(rpdByKUA[k][code][item]):0; ctot[k]+=v; cAll+=v; }); });
    n++; h += '<tr><td>' + n + '</td><td>' + code + '</td><td class="left">' + cfg.name + '</td>';
    // ✅ FIX: only add grand per KUA here if no subitems
    kuaList.forEach(function(k) {
      if (cfg.hasSubItems) {
        h += '<td>-</td>';
      } else {
        h += '<td>' + formatCurrency(ctot[k]) + '</td>';
        grand[k] += ctot[k];
      }
    });
    if (cfg.hasSubItems) {
      h += '<td>-</td></tr>';
    } else {
      h += '<td>' + formatCurrency(cAll) + '</td></tr>';
      grandAll += cAll;
    }
    if (cfg.hasSubItems) {
      cfg.items.forEach(function(item, idx) {
        var pfx = String.fromCharCode(97+idx), iAll = 0; n++;
        h += '<tr><td>' + n + '</td><td></td><td class="left">' + pfx + '. ' + item + '</td>';
        kuaList.forEach(function(k) { var v=(rpdByKUA[k]&&rpdByKUA[k][code]&&rpdByKUA[k][code][item])?parseFloat(rpdByKUA[k][code][item]):0; h+='<td>'+formatCurrency(v)+'</td>'; iAll+=v; grand[k]+=v; grandAll+=v; });
        h += '<td>' + formatCurrency(iAll) + '</td></tr>';
      });
    }
  });
  h += '<tr><td colspan="3"><strong>JUMLAH</strong></td>';
  kuaList.forEach(function(k) { h += '<td><strong>' + formatCurrency(grand[k]) + '</strong></td>'; });
  h += '<td><strong>' + formatCurrency(grandAll) + '</strong></td></tr></table></body></html>';
  var pdf = Utilities.newBlob(h, 'text/html').getAs('application/pdf');
  return successResponse({ fileData: Utilities.base64Encode(pdf.getBytes()), fileName: slug + '.pdf', mimeType: 'application/pdf' });
}

// ===== EXPORT REALISASI DETAIL PER BULAN =====
function exportRealisasiDetailMonth(data) {
  Logger.log('[EXPORT_REALISASI_DETAIL_MONTH] Format: ' + data.format + ', Year: ' + data.year + ', Month: ' + data.month + ', apMode: ' + (data.apMode||'exclude'));
  try {
    var rSheet = getSheet(SHEETS.REALISASI);
    var rows   = rSheet.getDataRange().getValues();
    var apMode = data.apMode || 'exclude';
    // Load AP config
    var apCfg = {}, apNom = {};
    try {
      var cs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_CONFIG);
      if (cs) { var cr = cs.getDataRange().getValues(); for (var ci=1;ci<cr.length;ci++){var ck=cr[ci][0];if(ck)apCfg[ck]={'522111':cr[ci][1]===true||cr[ci][1]==='TRUE','522112':cr[ci][2]===true||cr[ci][2]==='TRUE'};} }
      var ns = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_NOMINAL);
      if (ns) { var nr = ns.getDataRange().getValues(); for (var ni=1;ni<nr.length;ni++){var nk=nr[ni][0],nm=nr[ni][1],ny=nr[ni][2];if(nk&&ny==data.year&&nm===data.month){if(!apNom[nk])apNom[nk]={};apNom[nk]={'522111':parseFloat(nr[ni][3])||0,'522112':parseFloat(nr[ni][4])||0};}} }
    } catch(e) {}
    // REALISASI: A=ID(0), B=KUA(1), C=Bulan(2), D=RPD_ID(3), E=Tahun(4), F=Total(5), G=Data(6), H=Files(7), I=Status(8)
    var rByKUA = {}, kuaSet = new Set();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][4] != data.year || rows[i][2] !== data.month) continue;
      var norm = normalizeStatus(rows[i][8]);
      if (norm !== 'Approved' && norm !== 'Paid') continue;
      var kua = rows[i][1]; kuaSet.add(kua);
      if (!rByKUA[kua]) rByKUA[kua] = {};
      var rawData = {}; try { rawData = JSON.parse(rows[i][6]||'{}'); } catch(e) {}
      var kuaCfg = apCfg[kua]||null, hasAP = kuaCfg&&(kuaCfg['522111']||kuaCfg['522112']);
      var nomM = apNom[kua]||{};
      Object.keys(rawData).forEach(function(code) {
        if (!rByKUA[kua][code]) rByKUA[kua][code] = {};
        var isAP = hasAP && kuaCfg[code] === true;
        Object.keys(rawData[code]).forEach(function(item) {
          if (!rByKUA[kua][code][item]) rByKUA[kua][code][item] = 0;
          var val = 0;
          if (isAP) { if (apMode==='include') val = parseFloat(nomM[code]||0)/Math.max(1,Object.keys(rawData[code]).length); }
          else { val = parseFloat(rawData[code][item])||0; }
          rByKUA[kua][code][item] += val;
        });
      });
    }
    var sortedKUAs = Array.from(kuaSet).sort();
    if (sortedKUAs.length === 0) return errorResponse('Tidak ada data realisasi untuk ' + data.month + ' ' + data.year);
    var apLabel = apMode==='include'?'INCLUDE AUTO PAYMENT':'EXCLUDE AUTO PAYMENT';
    var apSlug  = apMode==='include'?'include_ap':'exclude_ap';
    var title = 'LAPORAN REALISASI DETAIL ' + apLabel + ' - ' + data.month.toUpperCase() + ' ' + data.year;
    var slug  = 'Realisasi_Detail_' + apSlug + '_' + data.month + '_' + data.year;
    if (data.format === 'pdf') {
      return _exportRPDDetailPDF(rByKUA, sortedKUAs, title, slug);
    } else {
      return _exportRPDDetailExcel(rByKUA, sortedKUAs, title, slug);
    }
  } catch(err) {
    Logger.log('[EXPORT_REALISASI_DETAIL_MONTH ERROR] ' + err.toString());
    return errorResponse('Gagal export: ' + err.toString());
  }
}

// 3. Export Realisasi per Year
function exportRealisasiPerYear(data) {
  Logger.log('[EXPORT_REALISASI_PER_YEAR] Format: ' + data.format + ', KUA: ' + data.kua + ', Year: ' + data.year + ', apMode: ' + (data.apMode || 'exclude'));
  
  try {
    const budgetSheet    = getSheet(SHEETS.BUDGET);
    const realisasiSheet = getSheet(SHEETS.REALISASI);
    
    const budgets    = budgetSheet.getDataRange().getValues();
    const realisasis = realisasiSheet.getDataRange().getValues();
    const apMode     = data.apMode || 'exclude'; // 'include' | 'exclude'
    
    // ---- Load AP Config & Nominal if mode != 'exclude' with no actives ----
    var apCfg = {};
    var apNom = {}; // { KUA: { month: { '522111': n, '522112': n } } }
    
    try {
      var cfgSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_CONFIG);
      if (cfgSheet) {
        var cfgRows = cfgSheet.getDataRange().getValues();
        for (var ci = 1; ci < cfgRows.length; ci++) {
          var ck = cfgRows[ci][0];
          if (!ck) continue;
          apCfg[ck] = {
            '522111': cfgRows[ci][1] === true || cfgRows[ci][1] === 'TRUE',
            '522112': cfgRows[ci][2] === true || cfgRows[ci][2] === 'TRUE'
          };
        }
      }
      var nomSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_NOMINAL);
      if (nomSheet) {
        var nomRows = nomSheet.getDataRange().getValues();
        for (var ni = 1; ni < nomRows.length; ni++) {
          var nk = nomRows[ni][0], nm = nomRows[ni][1], ny = nomRows[ni][2];
          if (!nk || ny != data.year) continue;
          if (!apNom[nk]) apNom[nk] = {};
          apNom[nk][nm] = {
            '522111': parseFloat(nomRows[ni][3]) || 0,
            '522112': parseFloat(nomRows[ni][4]) || 0
          };
        }
      }
    } catch (e) {
      Logger.log('[EXPORT AP LOAD ERROR] ' + e.toString());
    }
    
    Logger.log('[EXPORT_REALISASI_PER_YEAR] Total budgets: ' + (budgets.length - 1));
    Logger.log('[EXPORT_REALISASI_PER_YEAR] Total realisasis: ' + (realisasis.length - 1));
    
    const yearBudgets = [];
    for (let i = 1; i < budgets.length; i++) {
      if (budgets[i][2] == data.year) {
        if (!data.kua || budgets[i][1] === data.kua) {
          yearBudgets.push({
            kua: budgets[i][1],
            budget: parseFloat(budgets[i][3]) || 0
          });
        }
      }
    }
    
    const result = yearBudgets.map(b => {
      const row = { kua: b.kua, budget: b.budget, months: {} };
      MONTHS.forEach(month => { row.months[month] = 0; });
      
      // Realisasi Sheet: A=ID, B=KUA, C=Bulan, D=RPD_ID, E=Tahun, F=Total, G=Data, H=Files, I=Status
      for (let i = 1; i < realisasis.length; i++) {
        const kua    = realisasis[i][1];
        const month  = realisasis[i][2];
        const year   = realisasis[i][4];
        const status = realisasis[i][8];
        const kuaCfg = apCfg[kua] || null;
        const hasAP  = kuaCfg && (kuaCfg['522111'] || kuaCfg['522112']);
        
        if (kua !== b.kua || year != data.year) continue;
        if (normalizeStatus(status) !== 'Approved' && normalizeStatus(status) !== 'Paid') continue;
        
        var monthTotal = 0;
        
        if (!hasAP || apMode === 'exclude') {
          // No AP config OR exclude mode:
          // exclude → POS aktif = 0, non-aktif = manual
          // no AP   → all manual
          if (!hasAP) {
            monthTotal = parseFloat(realisasis[i][5]) || 0;
          } else {
            // exclude: parse per-POS dari G:Data
            var rawData = {};
            try { rawData = JSON.parse(realisasis[i][6] || '{}'); } catch(e) {}
            Object.keys(rawData).forEach(function(code) {
              if (kuaCfg[code]) return; // POS aktif → 0
              Object.values(rawData[code]).forEach(function(v) {
                monthTotal += parseFloat(v) || 0;
              });
            });
          }
        } else {
          // include mode: POS aktif = nominal admin, non-aktif = manual
          var rawData2 = {};
          try { rawData2 = JSON.parse(realisasis[i][6] || '{}'); } catch(e) {}
          var nomForMonth = (apNom[kua] && apNom[kua][month]) ? apNom[kua][month] : {};
          Object.keys(rawData2).forEach(function(code) {
            if (kuaCfg[code]) {
              monthTotal += parseFloat(nomForMonth[code] || 0);
            } else {
              Object.values(rawData2[code]).forEach(function(v) {
                monthTotal += parseFloat(v) || 0;
              });
            }
          });
        }
        
        row.months[month] += monthTotal;
      }
      
      row.totalRealisasi = Object.values(row.months).reduce((sum, val) => sum + val, 0);
      row.sisa = b.budget - row.totalRealisasi;
      Logger.log('[EXPORT_REALISASI_PER_YEAR] ' + b.kua + ': totalRealisasi=' + row.totalRealisasi + ' (mode=' + apMode + ')');
      return row;
    });
    
    if (data.format === 'pdf') {
      // ===== INLINE PDF =====
      var htmlPY = '<html><head><style>';
      htmlPY += 'body{font-family:Arial;font-size:10px;}';
      htmlPY += 'table{width:100%;border-collapse:collapse;margin-top:20px;}';
      htmlPY += 'th,td{border:1px solid #000;padding:5px;text-align:center;}';
      htmlPY += 'th{background:#dc3545;color:white;}';
      htmlPY += '</style></head><body>';
      htmlPY += '<h3 style="text-align:center">LAPORAN REALISASI PER TAHUN ' + data.year + '</h3>';
      if (data.kua) htmlPY += '<p style="text-align:center">KUA: ' + data.kua + '</p>';
      htmlPY += '<table><tr><th>No</th><th>KUA</th><th>Budget</th>';
      MONTHS.forEach(function(m) { htmlPY += '<th>' + m + '</th>'; });
      htmlPY += '<th>Total Realisasi</th><th>Sisa</th></tr>';
      result.forEach(function(row, idx) {
        htmlPY += '<tr><td>' + (idx+1) + '</td><td>' + row.kua + '</td><td>' + formatCurrency(row.budget) + '</td>';
        MONTHS.forEach(function(m) { htmlPY += '<td>' + formatCurrency(row.months[m]) + '</td>'; });
        htmlPY += '<td>' + formatCurrency(row.totalRealisasi) + '</td><td>' + formatCurrency(row.sisa) + '</td></tr>';
      });
      htmlPY += '</table></body></html>';
      var blobPY = Utilities.newBlob(htmlPY, 'text/html');
      var pdfPY = blobPY.getAs('application/pdf');
      var b64PY = Utilities.base64Encode(pdfPY.getBytes());
      return successResponse({ fileData: b64PY, fileName: 'Laporan_Realisasi_' + data.year + (data.kua ? '_' + data.kua : '') + '.pdf', mimeType: 'application/pdf' });
    } else {
      // ===== INLINE EXCEL (TSV) =====
      var tsvPY = 'LAPORAN REALISASI PER TAHUN ' + data.year + '\n';
      if (data.kua) tsvPY += 'KUA: ' + data.kua + '\n';
      tsvPY += '\nNo\tKUA\tBudget\t';
      MONTHS.forEach(function(m) { tsvPY += m + '\t'; });
      tsvPY += 'Total Realisasi\tSisa\n';
      result.forEach(function(row, idx) {
        tsvPY += (idx+1) + '\t' + row.kua + '\t' + row.budget + '\t';
        MONTHS.forEach(function(m) { tsvPY += row.months[m] + '\t'; });
        tsvPY += row.totalRealisasi + '\t' + row.sisa + '\n';
      });
      var blobXL = Utilities.newBlob(tsvPY, 'text/tab-separated-values');
      var b64XL  = Utilities.base64Encode(blobXL.getBytes());
      return successResponse({ fileData: b64XL, fileName: 'Laporan_Realisasi_' + data.year + (data.kua ? '_' + data.kua : '') + '.xls', mimeType: 'application/vnd.ms-excel' });
    }
  } catch (error) {
    Logger.log('[EXPORT_REALISASI_PER_YEAR ERROR] ' + error.toString());
    return errorResponse('Gagal export: ' + error.toString());
  }
}

function exportRealisasiPerYearExcel(data, year, kua) {
  let tsv = `LAPORAN REALISASI PER TAHUN ${year}\n`;
  if (kua) tsv += `KUA: ${kua}\n`;
  tsv += `\nNo\tKUA\tBudget\t`;
  
  MONTHS.forEach(month => {
    tsv += `${month}\t`;
  });
  tsv += `Total Realisasi\tSisa\n`;
  
  data.forEach((row, index) => {
    tsv += `${index + 1}\t${row.kua}\t${row.budget}\t`;
    MONTHS.forEach(month => {
      tsv += `${row.months[month]}\t`;
    });
    tsv += `${row.totalRealisasi}\t${row.sisa}\n`;
  });
  
  const blob = Utilities.newBlob(tsv, 'text/tab-separated-values');
  const base64 = Utilities.base64Encode(blob.getBytes());
  
  Logger.log('[EXPORT_REALISASI_PER_YEAR_EXCEL] Export completed');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_Realisasi_${year}${kua ? '_' + kua : ''}.xls`,
    mimeType: 'application/vnd.ms-excel'
  });
}

function exportRealisasiPerYearPDF(data, year, kua) {
  let html = `<html><head><style>
    body { font-family: Arial; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #000; padding: 5px; text-align: center; }
    th { background: #dc3545; color: white; }
  </style></head><body>
  <h3 style="text-align:center">LAPORAN REALISASI PER TAHUN ${year}</h3>`;
  
  if (kua) html += `<p style="text-align:center">KUA: ${kua}</p>`;
  
  html += `<table><tr><th>No</th><th>KUA</th><th>Budget</th>`;
  
  MONTHS.forEach(month => {
    html += `<th>${month}</th>`;
  });
  html += `<th>Total Realisasi</th><th>Sisa</th></tr>`;
  
  data.forEach((row, index) => {
    html += `<tr><td>${index + 1}</td><td>${row.kua}</td><td>${formatCurrency(row.budget)}</td>`;
    MONTHS.forEach(month => {
      html += `<td>${formatCurrency(row.months[month])}</td>`;
    });
    html += `<td>${formatCurrency(row.totalRealisasi)}</td><td>${formatCurrency(row.sisa)}</td></tr>`;
  });
  
  html += `</table></body></html>`;
  
  const blob = Utilities.newBlob(html, 'text/html');
  const pdfBlob = blob.getAs('application/pdf');
  const base64 = Utilities.base64Encode(pdfBlob.getBytes());
  
  Logger.log('[EXPORT_REALISASI_PER_YEAR_PDF] Export completed');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_Realisasi_${year}${kua ? '_' + kua : ''}.pdf`,
    mimeType: 'application/pdf'
  });
}

// 4. Export Realisasi Detail Year - CORRECTED FORMAT
function exportRealisasiDetailYear(data) {
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR] Format: ' + data.format + ', Year: ' + data.year + ', apMode: ' + (data.apMode || 'exclude'));
  
  try {
    const realisasiSheet = getSheet(SHEETS.REALISASI);
    const realisasis = realisasiSheet.getDataRange().getValues();
    const apMode = data.apMode || 'exclude';
    
    // Load AP Config & Nominal
    var apCfg = {};
    var apNom = {}; // { KUA: { month: { '522111': n, '522112': n } } }
    try {
      var cfgSheet2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_CONFIG);
      if (cfgSheet2) {
        var cfgRows2 = cfgSheet2.getDataRange().getValues();
        for (var ci2 = 1; ci2 < cfgRows2.length; ci2++) {
          var ck2 = cfgRows2[ci2][0];
          if (!ck2) continue;
          apCfg[ck2] = { '522111': cfgRows2[ci2][1] === true || cfgRows2[ci2][1] === 'TRUE', '522112': cfgRows2[ci2][2] === true || cfgRows2[ci2][2] === 'TRUE' };
        }
      }
      var nomSheet2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUTO_PAYMENT_NOMINAL);
      if (nomSheet2) {
        var nomRows2 = nomSheet2.getDataRange().getValues();
        for (var ni2 = 1; ni2 < nomRows2.length; ni2++) {
          var nk2 = nomRows2[ni2][0], nm2 = nomRows2[ni2][1], ny2 = nomRows2[ni2][2];
          if (!nk2 || ny2 != data.year) continue;
          if (!apNom[nk2]) apNom[nk2] = {};
          apNom[nk2][nm2] = { '522111': parseFloat(nomRows2[ni2][3]) || 0, '522112': parseFloat(nomRows2[ni2][4]) || 0 };
        }
      }
    } catch (apErr) {
      Logger.log('[EXPORT_DETAIL AP LOAD ERROR] ' + apErr.toString());
    }
    
    const realisasiByKUA = {};
    const kuaList = new Set();
    
    for (let i = 1; i < realisasis.length; i++) {
      const year   = realisasis[i][4];
      const status = realisasis[i][8];
      const norm   = normalizeStatus(status);
      
      // Hanya Approved & Paid
      if (year != data.year || (norm !== 'Approved' && norm !== 'Paid')) continue;
      
      const kua    = realisasis[i][1];
      const month  = realisasis[i][2];
      kuaList.add(kua);
      if (!realisasiByKUA[kua]) realisasiByKUA[kua] = {};
      
      var rawData3 = {};
      try { rawData3 = JSON.parse(realisasis[i][6] || '{}'); } catch (e) {}
      
      const kuaCfg3   = apCfg[kua] || null;
      const hasAP3    = kuaCfg3 && (kuaCfg3['522111'] || kuaCfg3['522112']);
      const nomMonth3 = (apNom[kua] && apNom[kua][month]) ? apNom[kua][month] : {};
      
      Object.keys(rawData3).forEach(function(code) {
        if (!realisasiByKUA[kua][code]) realisasiByKUA[kua][code] = {};
        var isAP = hasAP3 && kuaCfg3[code] === true;
        Object.keys(rawData3[code]).forEach(function(item) {
          if (!realisasiByKUA[kua][code][item]) realisasiByKUA[kua][code][item] = 0;
          var val = 0;
          if (isAP) {
            if (apMode === 'include') val = parseFloat(nomMonth3[code] || 0) / Math.max(1, Object.keys(rawData3[code]).length);
            // exclude → 0
          } else {
            val = parseFloat(rawData3[code][item]) || 0;
          }
          realisasiByKUA[kua][code][item] += val;
        });
      });
    }
    
    const sortedKUAs = Array.from(kuaList).sort();
    Logger.log('[EXPORT_REALISASI_DETAIL_YEAR] Total KUAs: ' + sortedKUAs.length);
    
    if (data.format === 'pdf') {
      // ===== INLINE PDF =====
      return _exportRealisasiDetailYearPDF_inline(realisasiByKUA, sortedKUAs, data.year);
    } else {
      // ===== INLINE EXCEL (TSV) =====
      return _exportRealisasiDetailYearExcel_inline(realisasiByKUA, sortedKUAs, data.year);
    }
  } catch (error) {
    Logger.log('[EXPORT_REALISASI_DETAIL_YEAR ERROR] ' + error.toString());
    return errorResponse('Gagal export: ' + error.toString());
  }
}

// ===== PRIVATE INLINE EXPORT HELPERS (unique names — tidak bisa di-override) =====
function _exportRealisasiDetailYearExcel_inline(realisasiByKUA, kuaList, year) {
  Logger.log('[EXPORT_DETAIL_EXCEL_INLINE] Starting for year: ' + year);
  var tsv = 'LAPORAN REALISASI DETAIL - TAHUN ' + year + '\n';
  tsv += 'Kementerian Agama Kabupaten Indramayu\n\n';
  tsv += 'No\tKode\tUraian';
  kuaList.forEach(function(kua) { tsv += '\t' + kua; });
  tsv += '\tJUMLAH\n';

  var rowNum = 0;
  var grandTotal = {};
  kuaList.forEach(function(kua) { grandTotal[kua] = 0; });
  var grandTotalAll = 0;

  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(code) {
    var cfg = BOP_CONFIG.RPD_PARAMETERS[code];
    var codeTotal = {};
    kuaList.forEach(function(kua) { codeTotal[kua] = 0; });
    var codeTotalAll = 0;

    cfg.items.forEach(function(item) {
      kuaList.forEach(function(kua) {
        var v = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) ? parseFloat(realisasiByKUA[kua][code][item]) : 0;
        codeTotal[kua] += v;
        codeTotalAll += v;
      });
    });

    rowNum++;
    tsv += rowNum + '\t' + code + '\t' + cfg.name;
    kuaList.forEach(function(kua) {
      if (cfg.hasSubItems) { tsv += '\t'; } else { tsv += '\t' + codeTotal[kua]; grandTotal[kua] += codeTotal[kua]; }
    });
    if (cfg.hasSubItems) { tsv += '\t\n'; } else { tsv += '\t' + codeTotalAll + '\n'; }
    grandTotalAll += cfg.hasSubItems ? 0 : codeTotalAll;

    if (cfg.hasSubItems) {
      cfg.items.forEach(function(item, idx) {
        var prefix = String.fromCharCode(97 + idx);
        rowNum++;
        tsv += rowNum + '\t\t' + prefix + '. ' + item;
        var itemTotal = 0;
        kuaList.forEach(function(kua) {
          var v = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) ? parseFloat(realisasiByKUA[kua][code][item]) : 0;
          tsv += '\t' + v;
          itemTotal += v;
          grandTotal[kua] += v;
          grandTotalAll += v;
        });
        tsv += '\t' + itemTotal + '\n';
      });
    }
  });

  tsv += '\t\tJUMLAH';
  kuaList.forEach(function(kua) { tsv += '\t' + grandTotal[kua]; });
  tsv += '\t' + grandTotalAll + '\n';

  var blob   = Utilities.newBlob(tsv, 'text/tab-separated-values');
  var base64 = Utilities.base64Encode(blob.getBytes());
  return successResponse({ fileData: base64, fileName: 'Laporan_Realisasi_Detail_' + year + '.xls', mimeType: 'application/vnd.ms-excel' });
}

function _exportRealisasiDetailYearPDF_inline(realisasiByKUA, kuaList, year) {
  Logger.log('[EXPORT_DETAIL_PDF_INLINE] Starting for year: ' + year + ', KUAs: ' + kuaList.length);
  var MAX_KUA = 10;
  var totalPages = Math.ceil(kuaList.length / MAX_KUA) || 1;
  var allHtml = '<html><head><style>';
  allHtml += 'body{font-family:Arial;font-size:8px;} table{width:100%;border-collapse:collapse;page-break-after:always;} ';
  allHtml += 'th,td{border:1px solid #000;padding:3px;text-align:right;} th{background:#dc3545;color:white;text-align:center;} .name{text-align:left;}';
  allHtml += '</style></head><body>';

  for (var p = 0; p < totalPages; p++) {
    var pageKUAs = kuaList.slice(p * MAX_KUA, (p + 1) * MAX_KUA);
    allHtml += '<h4 style="text-align:center">LAPORAN REALISASI DETAIL TAHUN ' + year + ' (Hal ' + (p+1) + '/' + totalPages + ')</h4>';
    allHtml += '<table><tr><th>No</th><th>Kode</th><th class="name">Uraian</th>';
    pageKUAs.forEach(function(kua) { allHtml += '<th>' + kua.replace('KUA ','') + '</th>'; });
    allHtml += '<th>JUMLAH</th></tr>';

    var rowNum = 0;
    var grandTotal = {};
    pageKUAs.forEach(function(kua) { grandTotal[kua] = 0; });
    var grandAll = 0;

    Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(function(code) {
      var cfg = BOP_CONFIG.RPD_PARAMETERS[code];
      var codeTotal = {};
      pageKUAs.forEach(function(kua) { codeTotal[kua] = 0; });
      var codeAll = 0;

      cfg.items.forEach(function(item) {
        pageKUAs.forEach(function(kua) {
          var v = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) ? parseFloat(realisasiByKUA[kua][code][item]) : 0;
          codeTotal[kua] += v;
          codeAll += v;
        });
      });

      rowNum++;
      allHtml += '<tr><td>' + rowNum + '</td><td>' + code + '</td><td class="name"><strong>' + cfg.name + '</strong></td>';
      pageKUAs.forEach(function(kua) {
        if (cfg.hasSubItems) { allHtml += '<td></td>'; } else { allHtml += '<td>' + formatCurrency(codeTotal[kua]) + '</td>'; grandTotal[kua] += codeTotal[kua]; }
      });
      if (cfg.hasSubItems) { allHtml += '<td></td>'; } else { allHtml += '<td><strong>' + formatCurrency(codeAll) + '</strong></td>'; grandAll += codeAll; }
      allHtml += '</tr>';

      if (cfg.hasSubItems) {
        cfg.items.forEach(function(item, idx) {
          var prefix = String.fromCharCode(97 + idx);
          rowNum++;
          allHtml += '<tr><td></td><td></td><td class="name">&nbsp;&nbsp;' + prefix + '. ' + item + '</td>';
          var itemAll = 0;
          pageKUAs.forEach(function(kua) {
            var v = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) ? parseFloat(realisasiByKUA[kua][code][item]) : 0;
            allHtml += '<td>' + formatCurrency(v) + '</td>';
            itemAll += v;
            grandTotal[kua] += v;
            grandAll += v;
          });
          allHtml += '<td>' + formatCurrency(itemAll) + '</td></tr>';
        });
      }
    });

    allHtml += '<tr><td colspan="3"><strong>JUMLAH</strong></td>';
    pageKUAs.forEach(function(kua) { allHtml += '<td><strong>' + formatCurrency(grandTotal[kua]) + '</strong></td>'; });
    allHtml += '<td><strong>' + formatCurrency(grandAll) + '</strong></td></tr>';
    allHtml += '</table>';
  }
  allHtml += '</body></html>';

  var blob   = Utilities.newBlob(allHtml, 'text/html');
  var pdf    = blob.getAs('application/pdf');
  var base64 = Utilities.base64Encode(pdf.getBytes());
  return successResponse({ fileData: base64, fileName: 'Laporan_Realisasi_Detail_' + year + '.pdf', mimeType: 'application/pdf' });
}

function exportRealisasiDetailYearExcel(realisasiByKUA, kuaList, year) {
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR_EXCEL] Starting export');
  
  let tsv = `LAPORAN REALISASI DETAIL - TAHUN ${year}\n`;
  tsv += `Kementerian Agama Kabupaten Indramayu\n\n`;
  
  // Header
  tsv += `No\tKode\tUraian`;
  kuaList.forEach(kua => tsv += `\t${kua}`);
  tsv += `\tJUMLAH\n`;
  
  let rowNum = 0;
  let grandTotal = {};
  kuaList.forEach(kua => { grandTotal[kua] = 0; });
  let grandTotalAll = 0;
  
  // Header row
  rowNum++;
  tsv += `${rowNum}\t025.04.WA\tDukungan Manajemen...`;
  kuaList.forEach(() => tsv += `\t`);
  tsv += `\t\n`;
  
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(code => {
    const config = BOP_CONFIG.RPD_PARAMETERS[code];
    
    let codeTotal = {};
    kuaList.forEach(kua => { codeTotal[kua] = 0; });
    let codeTotalAll = 0;
    
    config.items.forEach(item => {
      kuaList.forEach(kua => {
        const value = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) || 0;
        codeTotal[kua] += value;
        codeTotalAll += value;
      });
    });
    
    // Parent row
    rowNum++;
    tsv += `${rowNum}\t${code}\t${config.name}`;
    
    kuaList.forEach(kua => {
      if (config.hasSubItems) {
        tsv += `\t`;
      } else {
        // ✅ CRITICAL: GUNAKAN VALUE ASLI, JANGAN FORMAT!
        tsv += `\t${codeTotal[kua]}`;  // ✅ BUKAN formatNumber()!
        grandTotal[kua] += codeTotal[kua];
      }
    });
    
    if (config.hasSubItems) {
      tsv += `\t\n`;
    } else {
      tsv += `\t${codeTotalAll}\n`;  // ✅ VALUE ASLI
    }
    
    grandTotalAll += codeTotalAll;
    
    // Sub-items
    if (config.hasSubItems) {
      config.items.forEach((item, idx) => {
        const prefix = String.fromCharCode(97 + idx);
        
        rowNum++;
        tsv += `${rowNum}\t\t${prefix}. ${item}`;
        
        let itemTotal = 0;
        kuaList.forEach(kua => {
          const value = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) || 0;
          tsv += `\t${value}`;  // ✅ VALUE ASLI, TIDAK DIFORMAT
          itemTotal += value;
          grandTotal[kua] += value;
        });
        
        tsv += `\t${itemTotal}\n`;
      });
    }
  });
  
  // Grand total
  tsv += `\t\tJUMLAH`;
  kuaList.forEach(kua => {
    tsv += `\t${grandTotal[kua]}`;  // ✅ VALUE ASLI
  });
  tsv += `\t${grandTotalAll}\n`;
  
  const blob = Utilities.newBlob(tsv, 'text/tab-separated-values');
  const base64 = Utilities.base64Encode(blob.getBytes());
  
  return successResponse({
    fileData: base64,
    fileName: `Laporan_Realisasi_Detail_${year}.xls`,
    mimeType: 'application/vnd.ms-excel'
  });
}

function exportRealisasiDetailYearPDF(realisasiByKUA, kuaList, year) {
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR_PDF] Starting PDF export for year: ' + year);
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR_PDF] KUA count: ' + kuaList.length);
  
  // ✅ FIX ISSUE #5: Split ke multiple pages jika KUA terlalu banyak
  const MAX_KUA_PER_PAGE = 10;
  const totalPages = Math.ceil(kuaList.length / MAX_KUA_PER_PAGE);
  
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR_PDF] Will create ' + totalPages + ' page(s)');
  
  let allPagesHTML = '';
  
  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const startIdx = pageNum * MAX_KUA_PER_PAGE;
    const endIdx = Math.min(startIdx + MAX_KUA_PER_PAGE, kuaList.length);
    const pageKUAs = kuaList.slice(startIdx, endIdx);
    
    const pageHTML = generateRealisasiDetailPage(realisasiByKUA, pageKUAs, year, pageNum + 1, totalPages);
    allPagesHTML += pageHTML;
    
    if (pageNum < totalPages - 1) {
      allPagesHTML += '<div style="page-break-after: always;"></div>';
    }
  }
  
  const html = `<html><head><style>
    @page {
      size: A3 landscape;
      margin: 12mm 10mm;
    }
    body { 
      font-family: 'Arial', sans-serif; 
      font-size: 8pt;
      margin: 0;
      padding: 0;
    }
    h3 { 
      text-align: center; 
      margin: 5px 0 3px 0;
      font-size: 13pt;
      font-weight: bold;
    }
    h4 { 
      text-align: center; 
      margin: 0 0 8px 0;
      font-size: 10pt;
      font-weight: normal;
    }
    .page-info {
      text-align: center;
      font-size: 9pt;
      color: #666;
      margin-bottom: 8px;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 8px;
      table-layout: fixed;
    }
    th, td { 
      border: 1px solid #333;
      padding: 4px 3px;
      text-align: center;
      word-wrap: break-word;
      overflow: hidden;
    }
    th { 
      background-color: #dc3545;
      color: white; 
      font-weight: bold;
      font-size: 8pt;
      padding: 5px 3px;
    }
    td {
      font-size: 7pt;
    }
    .left { 
      text-align: left; 
      padding-left: 5px;
    }
    .code { 
      font-weight: bold; 
      font-size: 7pt;
    }
    .subitem { 
      padding-left: 15px; 
      text-align: left;
      font-size: 7pt;
    }
    .total { 
      background-color: #f0f0f0; 
      font-weight: bold; 
    }
    .amount {
      font-family: 'Courier New', monospace;
      text-align: right;
      padding-right: 5px;
    }
    .kua-col {
      font-size: 7pt;
    }
  </style></head><body>
    ${allPagesHTML}
  </body></html>`;
  
  const blob = Utilities.newBlob(html, 'text/html');
  const pdfBlob = blob.getAs('application/pdf');
  const base64 = Utilities.base64Encode(pdfBlob.getBytes());
  
  Logger.log('[EXPORT_REALISASI_DETAIL_YEAR_PDF] Export completed with ' + totalPages + ' page(s)');
  return successResponse({
    fileData: base64,
    fileName: `Laporan_Realisasi_Detail_${year}.pdf`,
    mimeType: 'application/pdf'
  });
}

function generateRealisasiDetailPage(realisasiByKUA, kuaList, year, pageNum, totalPages) {
  let html = `
    <h3>LAPORAN REALISASI DETAIL - TAHUN ${year}</h3>
    <h4>Kementerian Agama Kabupaten Indramayu</h4>
    <div class="page-info">Halaman ${pageNum} dari ${totalPages}</div>
    <table>
      <thead>
        <tr>
          <th style="width: 3%;">No</th>
          <th style="width: 6%;">Kode</th>
          <th style="width: 20%;">Uraian Program/Kegiatan/Output/Komponen</th>`;
  
  const kuaColWidth = Math.floor(65 / kuaList.length);
  kuaList.forEach(kua => {
    const shortName = kua.replace('KUA ', '');
    html += `<th class="kua-col" style="width: ${kuaColWidth}%;">${shortName}</th>`;
  });
  
  html += `<th style="width: 6%;">JUMLAH</th>
        </tr>
      </thead>
      <tbody>`;
  
  let rowNum = 0;
  let grandTotal = {};
  kuaList.forEach(kua => { grandTotal[kua] = 0; });
  let grandTotalAll = 0;
  
  rowNum++;
  html += `<tr>
    <td>${rowNum}</td>
    <td class="code">025.04.WA</td>
    <td class="left">Dukungan Manajemen dan Pelaksanaan Tugas Teknis Lainnya Bimas Islam</td>`;
  kuaList.forEach(() => html += `<td></td>`);
  html += `<td></td></tr>`;
  
  Object.keys(BOP_CONFIG.RPD_PARAMETERS).forEach(code => {
    const config = BOP_CONFIG.RPD_PARAMETERS[code];
    
    let codeTotal = {};
    kuaList.forEach(kua => { codeTotal[kua] = 0; });
    let codeTotalAll = 0;
    
    config.items.forEach(item => {
      kuaList.forEach(kua => {
        const value = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) || 0;
        codeTotal[kua] += value;
        codeTotalAll += value;
      });
    });
    
    html += `<tr>
      <td></td>
      <td class="code">${code}</td>
      <td class="left">${config.name}</td>`;
    
    kuaList.forEach(kua => {
      if (config.hasSubItems) {
        html += `<td></td>`;
      } else {
        html += `<td class="amount">${formatNumber(codeTotal[kua])}</td>`;
        grandTotal[kua] += codeTotal[kua];
      }
    });
    
    if (config.hasSubItems) {
      html += `<td></td></tr>`;
    } else {
      html += `<td class="amount total">${formatNumber(codeTotalAll)}</td></tr>`;
    }
    
    grandTotalAll += codeTotalAll;
    
    if (config.hasSubItems) {
      config.items.forEach((item, idx) => {
        const prefix = String.fromCharCode(97 + idx);
        
        html += `<tr>
          <td></td>
          <td></td>
          <td class="subitem">${prefix}. ${item}</td>`;
        
        let itemTotal = 0;
        kuaList.forEach(kua => {
          const value = (realisasiByKUA[kua] && realisasiByKUA[kua][code] && realisasiByKUA[kua][code][item]) || 0;
          html += `<td class="amount">${formatNumber(value)}</td>`;
          itemTotal += value;
          grandTotal[kua] += value;
        });
        
        html += `<td class="amount">${formatNumber(itemTotal)}</td></tr>`;
      });
    }
  });
  
  html += `<tr class="total">
    <td colspan="3" style="text-align: center; font-weight: bold;">JUMLAH (Halaman ${pageNum})</td>`;
  kuaList.forEach(kua => {
    html += `<td class="amount">${formatNumber(grandTotal[kua])}</td>`;
  });
  html += `<td class="amount" style="font-size: 8pt;">${formatNumber(grandTotalAll)}</td>
  </tr>`;
  
  html += `</tbody></table>`;
  
  return html;
}

function uploadFile(data) {
  const _t0 = Date.now();
  Logger.log('[UPLOAD_FILE] START ' + data.filename + ' (' + data.mimeType + ')');
  
  try {
    // Decode base64 (sekali; ukuran dipakai ulang — tanpa getBytes() berulang)
    const bytes = Utilities.base64Decode(data.fileData);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // ✅ Nama unik: timestamp_namaasli
    const uniqueFilename = Date.now() + '_' + data.filename;
    const fileBlob = Utilities.newBlob(bytes, data.mimeType, uniqueFilename);   // nama langsung benar → tanpa file.setName()

    // ✅ PERFORMA: folder BOP_Uploads/YYYY/MM di-cache ID-nya (sebelumnya 3× getFoldersByName
    //    + hasNext/next di setiap upload). Pembuatan folder baru dilindungi lock agar upload
    //    paralel di awal bulan tidak membuat folder dobel.
    const monthFolder = _getUploadMonthFolder(year, month);

    const file = monthFolder.createFile(fileBlob);

    // Sharing "anyone with link": jangan gagalkan upload bila kebijakan organisasi melarang
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      Logger.log('[UPLOAD_FILE] WARNING: Could not set sharing: ' + sharingError.toString());
    }

    const fileId = file.getId();
    const fileUrl = file.getUrl();

    Logger.log('[UPLOAD_FILE] ✅ ' + uniqueFilename + ' | ' + bytes.length + ' bytes | ' + (Date.now() - _t0) + ' ms');

    return successResponse({
      id: fileId,
      name: uniqueFilename,           // ✅ Unique name
      originalName: data.filename,    // ✅ Original name
      url: fileUrl,
      mimeType: data.mimeType,
      size: bytes.length,
      uploadPath: 'BOP_Uploads/' + year + '/' + month + '/' + uniqueFilename
    });
    
  } catch (error) {
    Logger.log('[UPLOAD_FILE ERROR] ' + error.toString());
    Logger.log('[UPLOAD_FILE ERROR STACK] ' + error.stack);
    return errorResponse('Gagal upload file: ' + error.toString());
  }
}


function updateRPDConfig(data) {
  Logger.log('[UPDATE_RPD_CONFIG] Updating configuration...');
  Logger.log('[UPDATE_RPD_CONFIG] Config data:', JSON.stringify(data));
  
  try {
    const configSheet = getSheet(SHEETS.CONFIG);
    const configs = configSheet.getDataRange().getValues();
    
    // Config sheet structure: A=Key, B=Value, C=Description
    const configKeys = {
      'RPD_STATUS': data.RPD_STATUS || 'Terbuka',
      'REALISASI_STATUS': data.REALISASI_STATUS || 'Terbuka',
      'REALISASI_MAX_FILE_SIZE': data.REALISASI_MAX_FILE_SIZE || 5,
      'REALISASI_MAX_FILES': data.REALISASI_MAX_FILES || 5
    };
    // ✅ BARU — bulan-bulan yang dibuka Admin utk EDIT RPD yang sudah ada
    // (Operator KUA). Disimpan sebagai JSON array string, mis. '["November","Desember"]'.
    // Hanya ditulis kalau memang dikirim, supaya panggilan updateRPDConfig lama
    // (yang tidak tahu field ini) tidak menimpanya jadi kosong secara tidak sengaja.
    if (data.RPD_EDIT_OPEN_MONTHS !== undefined) {
      configKeys['RPD_EDIT_OPEN_MONTHS'] = data.RPD_EDIT_OPEN_MONTHS;
    }
    
    Logger.log('[UPDATE_RPD_CONFIG] Config keys to update:', JSON.stringify(configKeys));
    
    // Update atau insert config
    Object.keys(configKeys).forEach(key => {
      let found = false;
      
      // Cari config yang sudah ada
      for (let i = 1; i < configs.length; i++) {
        if (configs[i][0] === key) {
          // Update existing config
          configSheet.getRange(i + 1, 2).setValue(configKeys[key]);
          Logger.log('[UPDATE_RPD_CONFIG] Updated ' + key + ' = ' + configKeys[key]);
          found = true;
          break;
        }
      }
      
      // Jika tidak ada, tambah baru
      if (!found) {
        const newRow = configs.length + 1;
        configSheet.getRange(newRow, 1).setValue(key);
        configSheet.getRange(newRow, 2).setValue(configKeys[key]);
        configSheet.getRange(newRow, 3).setValue('Auto-created config');
        Logger.log('[UPDATE_RPD_CONFIG] Created new ' + key + ' = ' + configKeys[key]);
      }
    });
    
    Logger.log('[UPDATE_RPD_CONFIG] Configuration updated successfully');
    return successResponse({ message: 'Konfigurasi berhasil diperbarui' });
    
  } catch (error) {
    Logger.log('[UPDATE_RPD_CONFIG ERROR] ' + error.toString());
    return errorResponse('Gagal memperbarui konfigurasi: ' + error.toString());
  }
}
// ===================================================================
// ===== AUTO PAYMENT MODULE =========================================
// ===================================================================

// AutoPaymentConfig sheet: KUA | 522111 | 522112
// AutoPaymentNominal sheet: KUA | Bulan | Tahun | Nominal_522111 | Nominal_522112

var AP_CONFIG_HEADERS = ['KUA', '522111', '522112'];
var AP_NOMINAL_HEADERS = ['KUA', 'Bulan', 'Tahun', 'Nominal_522111', 'Nominal_522112'];
var AP_POS_CODES = ['522111', '522112'];

// ------------------------------------------------------------------
// GET CONFIG - returns { kua: { '522111': bool, '522112': bool } }
// ------------------------------------------------------------------
function getAutoPaymentConfig(data) {
  Logger.log('[GET_AP_CONFIG] Loading Auto Payment Config');
  try {
    const rows = _sheetValues(SHEETS.AUTO_PAYMENT_CONFIG, AP_CONFIG_HEADERS);
    const config = {};

    for (var i = 1; i < rows.length; i++) {
      var kua = rows[i][0];
      if (!kua) continue;
      config[kua] = {
        '522111': rows[i][1] === true || rows[i][1] === 'TRUE',
        '522112': rows[i][2] === true || rows[i][2] === 'TRUE'
      };
    }

    Logger.log('[GET_AP_CONFIG] Loaded ' + Object.keys(config).length + ' KUA configs');
    return successResponse(config);
  } catch (error) {
    Logger.log('[GET_AP_CONFIG ERROR] ' + error.toString());
    return errorResponse('Gagal memuat Auto Payment Config: ' + error.toString());
  }
}

// ------------------------------------------------------------------
// SAVE CONFIG - data.config = { kua: { '522111': bool, '522112': bool } }
// ------------------------------------------------------------------
function saveAutoPaymentConfig(data) {
  Logger.log('[SAVE_AP_CONFIG] Saving Auto Payment Config');
  try {
    const sheet = getOrCreateSheet(SHEETS.AUTO_PAYMENT_CONFIG, AP_CONFIG_HEADERS);
    const config = data.config || {};
    const kuas = Object.keys(config);

    // Clear existing data (keep header)
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, AP_CONFIG_HEADERS.length).clearContent();
    }

    // Write new config
    if (kuas.length > 0) {
      var newRows = kuas.map(function(kua) {
        return [
          kua,
          config[kua]['522111'] === true,
          config[kua]['522112'] === true
        ];
      });
      sheet.getRange(2, 1, newRows.length, AP_CONFIG_HEADERS.length).setValues(newRows);
    }

    Logger.log('[SAVE_AP_CONFIG] Saved ' + kuas.length + ' KUA configs');
    return successResponse({ message: 'Konfigurasi Auto Payment berhasil disimpan' });
  } catch (error) {
    Logger.log('[SAVE_AP_CONFIG ERROR] ' + error.toString());
    return errorResponse('Gagal menyimpan Auto Payment Config: ' + error.toString());
  }
}

// ------------------------------------------------------------------
// GET NOMINAL - data.month, data.year
// returns { kua: { '522111': nominal, '522112': nominal } }
// ------------------------------------------------------------------
function getAutoPaymentNominal(data) {
  Logger.log('[GET_AP_NOMINAL] Month: ' + data.month + ', Year: ' + data.year);
  try {
    const rows = _sheetValues(SHEETS.AUTO_PAYMENT_NOMINAL, AP_NOMINAL_HEADERS);
    const result = {};

    for (var i = 1; i < rows.length; i++) {
      var kua = rows[i][0];
      var month = rows[i][1];
      var year = rows[i][2];
      if (!kua) continue;

      if ((!data.month || month === data.month) && (!data.year || year == data.year)) {
        result[kua] = {
          '522111': parseFloat(rows[i][3]) || 0,
          '522112': parseFloat(rows[i][4]) || 0,
          month: month,
          year: year
        };
      }
    }

    Logger.log('[GET_AP_NOMINAL] Found ' + Object.keys(result).length + ' entries');
    return successResponse(result);
  } catch (error) {
    Logger.log('[GET_AP_NOMINAL ERROR] ' + error.toString());
    return errorResponse('Gagal memuat Auto Payment Nominal: ' + error.toString());
  }
}

// ------------------------------------------------------------------
// GET NOMINAL SETAHUN (1 request menggantikan 12 request per bulan)
// data.year → returns { 'Januari': { kua: {'522111': n, '522112': n} }, 'Februari': {...}, ... }
// ------------------------------------------------------------------
function getAutoPaymentNominalYear(data) {
  Logger.log('[GET_AP_NOMINAL_YEAR] Year: ' + data.year);
  try {
    const rows = _sheetValues(SHEETS.AUTO_PAYMENT_NOMINAL, AP_NOMINAL_HEADERS);
    const result = {};

    for (var i = 1; i < rows.length; i++) {
      var kua = rows[i][0];
      var month = rows[i][1];
      var year = rows[i][2];
      if (!kua || !month) continue;
      if (data.year && year != data.year) continue;

      if (!result[month]) result[month] = {};
      result[month][kua] = {
        '522111': parseFloat(rows[i][3]) || 0,
        '522112': parseFloat(rows[i][4]) || 0,
        month: month,
        year: year
      };
    }

    Logger.log('[GET_AP_NOMINAL_YEAR] Months with data: ' + Object.keys(result).length);
    return successResponse(result);
  } catch (error) {
    Logger.log('[GET_AP_NOMINAL_YEAR ERROR] ' + error.toString());
    return errorResponse('Gagal memuat Auto Payment Nominal (tahunan): ' + error.toString());
  }
}

// ------------------------------------------------------------------
// SAVE NOMINAL - data.month, data.year, data.nominals = { kua: { '522111': num, '522112': num } }
// ------------------------------------------------------------------
function saveAutoPaymentNominal(data) {
  Logger.log('[SAVE_AP_NOMINAL] Month: ' + data.month + ', Year: ' + data.year);
  try {
    const sheet = getOrCreateSheet(SHEETS.AUTO_PAYMENT_NOMINAL, AP_NOMINAL_HEADERS);
    const rows = sheet.getDataRange().getValues();
    const nominals = data.nominals || {};
    const kuas = Object.keys(nominals);

    // Update existing rows or collect what's missing
    var updatedKUAs = {};
    for (var i = 1; i < rows.length; i++) {
      var kua = rows[i][0];
      var month = rows[i][1];
      var year = rows[i][2];
      if (kua && month === data.month && year == data.year && nominals[kua] !== undefined) {
        sheet.getRange(i + 1, 4).setValue(parseFloat(nominals[kua]['522111']) || 0);
        sheet.getRange(i + 1, 5).setValue(parseFloat(nominals[kua]['522112']) || 0);
        updatedKUAs[kua] = true;
      }
    }

    // Append new rows for KUAs not yet in sheet
    var newRows = [];
    kuas.forEach(function(kua) {
      if (!updatedKUAs[kua]) {
        newRows.push([
          kua,
          data.month,
          parseInt(data.year),
          parseFloat(nominals[kua]['522111']) || 0,
          parseFloat(nominals[kua]['522112']) || 0
        ]);
      }
    });
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, AP_NOMINAL_HEADERS.length).setValues(newRows);
    }

    Logger.log('[SAVE_AP_NOMINAL] Saved nominals for ' + kuas.length + ' KUAs');
    return successResponse({ message: 'Nominal Auto Payment berhasil disimpan' });
  } catch (error) {
    Logger.log('[SAVE_AP_NOMINAL ERROR] ' + error.toString());
    return errorResponse('Gagal menyimpan Nominal Auto Payment: ' + error.toString());
  }
}

// ------------------------------------------------------------------
// CALCULATE INCLUDE/EXCLUDE (used by export functions)
// mode: 'include' | 'exclude'
// ------------------------------------------------------------------
function calculateAutoPaymentTotal(realisasis, apConfig, apNominalByKua, mode) {
  var total = 0;
  realisasis.forEach(function(real) {
    var kua = real.kua;
    var cfg = apConfig && apConfig[kua] ? apConfig[kua] : null;
    var nom = apNominalByKua && apNominalByKua[kua] ? apNominalByKua[kua] : {};

    if (!real.data) {
      total += parseFloat(real.total) || 0;
      return;
    }

    var realTotal = 0;
    Object.keys(real.data).forEach(function(code) {
      var isAutoPOS = cfg && cfg[code] === true;
      if (isAutoPOS) {
        if (mode === 'include') {
          realTotal += parseFloat(nom[code] || 0);
        }
        // exclude → add 0 for this POS
      } else {
        var items = real.data[code];
        Object.values(items).forEach(function(val) {
          realTotal += parseFloat(val || 0);
        });
      }
    });

    total += realTotal;
  });
  return total;
}

// =============================================================================
// EXPORT FALLBACK: Realisasi (Approved/Paid) + Fallback ke RPD jika tdk ada
// =============================================================================

// ── HELPER: load AP config & nominal ──────────────────────────────────────────
function _loadAPData(year) {
  var apCfg = {}, apNom = {};
  try {
    var cr = _sheetValuesIfExists(SHEETS.AUTO_PAYMENT_CONFIG);
    if (cr) {
      for (var i = 1; i < cr.length; i++) {
        if (cr[i][0]) apCfg[cr[i][0]] = { '522111': cr[i][1]===true||cr[i][1]==='TRUE', '522112': cr[i][2]===true||cr[i][2]==='TRUE' };
      }
    }
    var nr = _sheetValuesIfExists(SHEETS.AUTO_PAYMENT_NOMINAL);
    if (nr) {
      for (var j = 1; j < nr.length; j++) {
        var nk = nr[j][0], nm = nr[j][1], ny = nr[j][2];
        if (nk && ny == year) {
          if (!apNom[nk]) apNom[nk] = {};
          apNom[nk][nm] = { '522111': parseFloat(nr[j][3])||0, '522112': parseFloat(nr[j][4])||0 };
        }
      }
    }
  } catch(e) { Logger.log('[_loadAPData ERR] ' + e); }
  return { apCfg: apCfg, apNom: apNom };
}

// ── HELPER: hitung total nominal 1 row Realisasi (handle AP) ─────────────────
function _calcRealisasiRowTotal(rRow, apCfg, apNom, apMode) {
  var kua    = rRow[1], month = rRow[2];
  var kuaCfg = apCfg[kua] || null;
  var hasAP  = kuaCfg && (kuaCfg['522111'] || kuaCfg['522112']);
  var total  = 0;
  if (!hasAP || apMode === 'exclude') {
    if (!hasAP) { return parseFloat(rRow[5]) || 0; }
    var rd = {}; try { rd = JSON.parse(rRow[6]||'{}'); } catch(e) {}
    Object.keys(rd).forEach(function(c) { if (kuaCfg[c]) return; Object.values(rd[c]).forEach(function(v){ total += parseFloat(v)||0; }); });
  } else {
    var rd2 = {}; try { rd2 = JSON.parse(rRow[6]||'{}'); } catch(e) {}
    var nomM = (apNom[kua] && apNom[kua][month]) ? apNom[kua][month] : {};
    Object.keys(rd2).forEach(function(c) {
      if (kuaCfg[c]) { total += parseFloat(nomM[c]||0); }
      else { Object.values(rd2[c]).forEach(function(v){ total += parseFloat(v)||0; }); }
    });
  }
  return total;
}

// ── HELPER: agregat detail items 1 row Realisasi ke byKUA[kua][code][item] ────
function _agregateRealisasiRowDetail(rRow, byKUA, apCfg, apNom, apMode) {
  var kua = rRow[1], month = rRow[2];
  if (!byKUA[kua]) byKUA[kua] = {};
  var rd = {}; try { rd = JSON.parse(rRow[6]||'{}'); } catch(e) {}
  var kuaCfg = apCfg[kua]||null, hasAP = kuaCfg&&(kuaCfg['522111']||kuaCfg['522112']);
  var nomM = (apNom[kua]&&apNom[kua][month]) ? apNom[kua][month] : {};
  Object.keys(rd).forEach(function(code) {
    if (!byKUA[kua][code]) byKUA[kua][code] = {};
    var isAP = hasAP && kuaCfg[code] === true;
    Object.keys(rd[code]).forEach(function(item) {
      if (!byKUA[kua][code][item]) byKUA[kua][code][item] = 0;
      var val = 0;
      if (isAP) { if (apMode==='include') val = parseFloat(nomM[code]||0) / Math.max(1, Object.keys(rd[code]).length); }
      else { val = parseFloat(rd[code][item])||0; }
      byKUA[kua][code][item] += val;
    });
  });
}

// ── HELPER: agregat detail items 1 row RPD ke byKUA[kua][code][item] ──────────
function _agregateRPDRowDetail(rpdRow, byKUA) {
  var kua = rpdRow[1];
  if (!byKUA[kua]) byKUA[kua] = {};
  var rpdData = {}; try { rpdData = JSON.parse(rpdRow[5]||'{}'); } catch(e) {}
  Object.keys(rpdData).forEach(function(code) {
    if (!byKUA[kua][code]) byKUA[kua][code] = {};
    Object.keys(rpdData[code]).forEach(function(item) {
      if (!byKUA[kua][code][item]) byKUA[kua][code][item] = 0;
      byKUA[kua][code][item] += parseFloat(rpdData[code][item])||0;
    });
  });
}

// ── EXPORT FALLBACK PER TAHUN (mirip Realisasi per Tahun) ─────────────────────
function exportFallbackPerYear(data) {
  Logger.log('[FALLBACK_PER_YEAR] year='+data.year+' kua='+(data.kua||'all')+' format='+data.format+' apMode='+(data.apMode||'exclude'));
  try {
    var bRows   = getSheet(SHEETS.BUDGET).getDataRange().getValues();
    var rRows   = getSheet(SHEETS.REALISASI).getDataRange().getValues();
    var rpdRows = getSheet(SHEETS.RPD).getDataRange().getValues();
    var apMode  = data.apMode || 'exclude';
    var ap = _loadAPData(data.year);

    // Budget per KUA
    var budgetByKUA = {};
    for (var bi=1; bi<bRows.length; bi++) {
      if (bRows[bi][2] == data.year && (!data.kua || bRows[bi][1]===data.kua)) {
        budgetByKUA[bRows[bi][1]] = parseFloat(bRows[bi][3])||0;
      }
    }

    // Realisasi total per (kua, month)
    var realMap = {}; // "kua|month" → total
    for (var ri=1; ri<rRows.length; ri++) {
      if (rRows[ri][4] != data.year) continue;
      var norm = normalizeStatus(rRows[ri][8]);
      if (norm!=='Approved'&&norm!=='Paid') continue;
      var key = rRows[ri][1]+'|'+rRows[ri][2];
      realMap[key] = (realMap[key]||0) + _calcRealisasiRowTotal(rRows[ri], ap.apCfg, ap.apNom, apMode);
    }

    // RPD total per (kua, month)
    var rpdMap = {}; // "kua|month" → total
    for (var rpi=1; rpi<rpdRows.length; rpi++) {
      if (rpdRows[rpi][3] != data.year) continue;
      var rpKey = rpdRows[rpi][1]+'|'+rpdRows[rpi][2];
      rpdMap[rpKey] = (rpdMap[rpKey]||0) + (parseFloat(rpdRows[rpi][4])||0);
    }

    var kuaList = Object.keys(budgetByKUA).sort();
    var apLabel = apMode==='include' ? 'INCLUDE AUTO PAYMENT' : 'EXCLUDE AUTO PAYMENT';
    var title   = 'LAPORAN REALISASI + RPD FALLBACK - '+apLabel+' - TAHUN '+data.year;
    var kuaNote = data.kua ? ' | KUA: '+data.kua : '';
    var noteRow = 'Keterangan: R = Data Realisasi (Approved/Paid)  |  P = Dari RPD (tidak ada realisasi di bulan tersebut)';

    if (data.format === 'pdf') {
      var sty = 'body{font-family:Arial,sans-serif;font-size:7.5px;}h2{font-size:12px;text-align:center;margin:4px 0;}p.sub{text-align:center;font-size:9px;color:#444;margin:2px 0;}'
              + 'table{width:100%;border-collapse:collapse;margin-top:8px;}th,td{border:1px solid #666;padding:2px 3px;text-align:center;}'
              + 'th{background:#0e7490;color:#fff;font-size:7px;}.r{color:#065f46;font-weight:bold;}.p{color:#92400e;}.tot{background:#f0f4ff;font-weight:bold;}';
      var html = '<html><head><style>'+sty+'</style></head><body>'
               + '<h2>'+title+'</h2><p class="sub">'+kuaNote+noteRow+'</p>'
               + '<table><tr><th>No</th><th>KUA</th><th>Budget</th>';
      MONTHS.forEach(function(m){html+='<th>'+m+'</th>';});
      html += '<th>Total</th><th>Sisa</th></tr>';
      var grandBudget=0, grandTotal=0;
      kuaList.forEach(function(kua, idx) {
        var budget = budgetByKUA[kua]||0; grandBudget+=budget;
        var rowTotal=0;
        html += '<tr><td>'+(idx+1)+'</td><td style="text-align:left">'+kua+'</td><td>'+formatCurrency(budget)+'</td>';
        MONTHS.forEach(function(m) {
          var rKey=kua+'|'+m, val=0, src='';
          if (realMap[rKey]!==undefined) { val=realMap[rKey]; src='R'; }
          else if (rpdMap[rKey]) { val=rpdMap[rKey]; src='P'; }
          rowTotal+=val;
          var cls=src==='R'?' class="r"':src==='P'?' class="p"':'';
          html+='<td'+cls+'>'+(val>0?formatCurrency(val)+' <sup>'+src+'</sup>':'-')+'</td>';
        });
        grandTotal+=rowTotal;
        html+='<td class="tot">'+formatCurrency(rowTotal)+'</td><td class="tot">'+formatCurrency(budget-rowTotal)+'</td></tr>';
      });
      html+='<tr style="background:#dbeafe;font-weight:bold"><td colspan="2">GRAND TOTAL</td><td>'+formatCurrency(grandBudget)+'</td>';
      MONTHS.forEach(function(){html+='<td></td>';});
      html+='<td>'+formatCurrency(grandTotal)+'</td><td>'+formatCurrency(grandBudget-grandTotal)+'</td></tr>';
      html+='</table></body></html>';
      var blob = Utilities.newBlob(html,'text/html').getAs('application/pdf');
      return successResponse({fileData:Utilities.base64Encode(blob.getBytes()),fileName:'Fallback_PerTahun_'+data.year+'.pdf',mimeType:'application/pdf'});
    } else {
      var tsv = title+'\n'+kuaNote+'\n'+noteRow+'\n\nNo\tKUA\tBudget\t'+MONTHS.join('\t')+'\tTotal\tSisa\n';
      var gBudget=0, gTotal=0;
      kuaList.forEach(function(kua, idx) {
        var budget=budgetByKUA[kua]||0; gBudget+=budget;
        var rowTotal=0, cols=[];
        MONTHS.forEach(function(m) {
          var rKey=kua+'|'+m, val=0, src='';
          if (realMap[rKey]!==undefined){val=realMap[rKey];src='R';}
          else if(rpdMap[rKey]){val=rpdMap[rKey];src='P';}
          rowTotal+=val;
          cols.push(val+(src?' ('+src+')':''));
        });
        gTotal+=rowTotal;
        tsv+=(idx+1)+'\t'+kua+'\t'+budget+'\t'+cols.join('\t')+'\t'+rowTotal+'\t'+(budget-rowTotal)+'\n';
      });
      tsv+='GRAND TOTAL\t\t'+gBudget+'\t'+MONTHS.map(function(){return '';}).join('\t')+'\t'+gTotal+'\t'+(gBudget-gTotal)+'\n';
      var xBlob = Utilities.newBlob(tsv,'text/tab-separated-values');
      return successResponse({fileData:Utilities.base64Encode(xBlob.getBytes()),fileName:'Fallback_PerTahun_'+data.year+'.xls',mimeType:'application/vnd.ms-excel'});
    }
  } catch(err) {
    Logger.log('[FALLBACK_PER_YEAR ERR] '+err.toString());
    return errorResponse('Gagal export: '+err.toString());
  }
}

// ── EXPORT FALLBACK DETAIL YEAR (mirip Realisasi Detail Semua KUA) ─────────────
function exportFallbackDetailYear(data) {
  Logger.log('[FALLBACK_DETAIL_YEAR] year='+data.year+' format='+data.format+' apMode='+(data.apMode||'exclude'));
  try {
    var rRows   = getSheet(SHEETS.REALISASI).getDataRange().getValues();
    var rpdRows = getSheet(SHEETS.RPD).getDataRange().getValues();
    var apMode  = data.apMode || 'exclude';
    var ap      = _loadAPData(data.year);

    // Set: "kua|month" yang punya Realisasi (Approved/Paid)
    var hasReal = {};
    for (var ri=1; ri<rRows.length; ri++) {
      if (rRows[ri][4] != data.year) continue;
      var norm = normalizeStatus(rRows[ri][8]);
      if (norm!=='Approved'&&norm!=='Paid') continue;
      hasReal[rRows[ri][1]+'|'+rRows[ri][2]] = true;
    }

    var byKUA = {}, kuaSet = new Set();
    // Pass 1: Realisasi
    for (var ri2=1; ri2<rRows.length; ri2++) {
      if (rRows[ri2][4]!=data.year) continue;
      var n2 = normalizeStatus(rRows[ri2][8]);
      if (n2!=='Approved'&&n2!=='Paid') continue;
      kuaSet.add(rRows[ri2][1]);
      _agregateRealisasiRowDetail(rRows[ri2], byKUA, ap.apCfg, ap.apNom, apMode);
    }
    // Pass 2: RPD fallback untuk (kua, month) tanpa Realisasi
    for (var rpi=1; rpi<rpdRows.length; rpi++) {
      if (rpdRows[rpi][3]!=data.year) continue;
      var rpKey = rpdRows[rpi][1]+'|'+rpdRows[rpi][2];
      if (hasReal[rpKey]) continue;
      kuaSet.add(rpdRows[rpi][1]);
      _agregateRPDRowDetail(rpdRows[rpi], byKUA);
    }

    var sortedKUAs = Array.from(kuaSet).sort();
    if (!sortedKUAs.length) return errorResponse('Tidak ada data untuk tahun '+data.year);
    var apLabel = apMode==='include'?'INCLUDE AP':'EXCLUDE AP';
    var title   = 'REALISASI+RPD FALLBACK DETAIL - '+apLabel+' - TAHUN '+data.year;
    var slug    = 'Fallback_Detail_'+data.year+'_'+apMode;
    if (data.format==='pdf') return _exportRPDDetailPDF(byKUA, sortedKUAs, title, slug);
    return _exportRPDDetailExcel(byKUA, sortedKUAs, title, slug);
  } catch(err) {
    Logger.log('[FALLBACK_DETAIL_YEAR ERR] '+err.toString());
    return errorResponse('Gagal export: '+err.toString());
  }
}

// ── EXPORT FALLBACK DETAIL MONTH (mode Bulanan) ────────────────────────────────
function exportFallbackDetailMonth(data) {
  Logger.log('[FALLBACK_DETAIL_MONTH] year='+data.year+' month='+data.month+' format='+data.format+' apMode='+(data.apMode||'exclude'));
  try {
    var rRows   = getSheet(SHEETS.REALISASI).getDataRange().getValues();
    var rpdRows = getSheet(SHEETS.RPD).getDataRange().getValues();
    var apMode  = data.apMode || 'exclude';
    var ap      = _loadAPData(data.year);

    // Cek kua mana yang punya Realisasi di bulan ini
    var hasReal = {};
    for (var ri=1; ri<rRows.length; ri++) {
      if (rRows[ri][4]!=data.year || rRows[ri][2]!=data.month) continue;
      var norm = normalizeStatus(rRows[ri][8]);
      if (norm!=='Approved'&&norm!=='Paid') continue;
      hasReal[rRows[ri][1]] = true;
    }

    var byKUA = {}, kuaSet = new Set();
    // Pass 1: Realisasi bulan ini
    for (var ri2=1; ri2<rRows.length; ri2++) {
      if (rRows[ri2][4]!=data.year || rRows[ri2][2]!=data.month) continue;
      var n2 = normalizeStatus(rRows[ri2][8]);
      if (n2!=='Approved'&&n2!=='Paid') continue;
      kuaSet.add(rRows[ri2][1]);
      _agregateRealisasiRowDetail(rRows[ri2], byKUA, ap.apCfg, ap.apNom, apMode);
    }
    // Pass 2: RPD fallback untuk KUA tanpa Realisasi bulan ini
    for (var rpi=1; rpi<rpdRows.length; rpi++) {
      if (rpdRows[rpi][3]!=data.year || rpdRows[rpi][2]!=data.month) continue;
      if (hasReal[rpdRows[rpi][1]]) continue;
      kuaSet.add(rpdRows[rpi][1]);
      _agregateRPDRowDetail(rpdRows[rpi], byKUA);
    }

    var sortedKUAs = Array.from(kuaSet).sort();
    if (!sortedKUAs.length) return errorResponse('Tidak ada data untuk '+data.month+' '+data.year);
    var apLabel = apMode==='include'?'INCLUDE AP':'EXCLUDE AP';
    var title   = 'REALISASI+RPD FALLBACK DETAIL - '+apLabel+' - '+data.month+' '+data.year;
    var slug    = 'Fallback_Detail_'+data.year+'_'+data.month+'_'+apMode;
    if (data.format==='pdf') return _exportRPDDetailPDF(byKUA, sortedKUAs, title, slug);
    return _exportRPDDetailExcel(byKUA, sortedKUAs, title, slug);
  } catch(err) {
    Logger.log('[FALLBACK_DETAIL_MONTH ERR] '+err.toString());
    return errorResponse('Gagal export: '+err.toString());
  }
}