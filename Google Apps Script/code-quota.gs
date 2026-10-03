// ===== API QUOTA MANAGEMENT =====
// File: code-quota.gs
// Version: 2.0 — self-diagnosing, auto-init, robust locking
//
// ── WIRING IN code-main.gs (doPost switch) ───────────────────────────
//   Replace:
//     case 'saveRealisasi':
//     case 'verifyRealisasi':
//     case 'deleteRealisasi':
//       result = handleBOPAction(action, data);
//       break;
//
//   With:
//     case 'saveRealisasi':
//       result = withQuotaCheck(action, data, function(){ return handleBOPAction(action, data); });
//       break;
//     case 'verifyRealisasi':
//       result = withQuotaCheck(action, data, function(){ return handleBOPAction(action, data); });
//       break;
//     case 'deleteRealisasi':
//       result = withQuotaCheck(action, data, function(){ return handleBOPAction(action, data); });
//       break;
//     case 'getApiQuota':
//       result = getApiQuota(data);
//       break;
//
// ── SPREADSHEET SETUP ────────────────────────────────────────────────
//   Sheet name : Config
//   Column A   : API_QUOTA
//   Column B   : <number, e.g. 100>
//
//   If the row does not exist, call initQuota() once from the
//   Apps Script editor (Run → initQuota) to create it automatically.
// ─────────────────────────────────────────────────────────────────────

var QUOTA_CONFIG_KEY  = 'API_QUOTA';
var QUOTA_SHEET_NAME  = 'Config';
var QUOTA_DEFAULT_VAL = 0;          // value used when row is first created

// ── DIAGNOSTIC: run this once from the Apps Script editor ────────────
/**
 * Open Apps Script editor → Run → initQuota
 * Creates the API_QUOTA row if missing, then logs the current value.
 */
function initQuota() {
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(QUOTA_SHEET_NAME);

  if (!sheet) {
    Logger.log('[QUOTA_INIT] ✗ Sheet "' + QUOTA_SHEET_NAME + '" not found! Create it first.');
    return;
  }

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === QUOTA_CONFIG_KEY) {
      Logger.log('[QUOTA_INIT] ✓ Row already exists. Current value: ' + rows[i][1]);
      return;
    }
  }

  // Row does not exist — append it
  sheet.appendRow([QUOTA_CONFIG_KEY, QUOTA_DEFAULT_VAL]);
  Logger.log('[QUOTA_INIT] ✓ Created row: ' + QUOTA_CONFIG_KEY + ' = ' + QUOTA_DEFAULT_VAL);
  Logger.log('[QUOTA_INIT] ⚠ Set column B to your desired quota (e.g. 100) in the Config sheet.');
}

// ── DIAGNOSTIC: test the full decrement path ─────────────────────────
/**
 * Open Apps Script editor → Run → testQuotaDecrement
 * Decrements quota by 1 and logs the result.
 * Safe to run — just like a real API call would.
 */
function testQuotaDecrement() {
  Logger.log('[QUOTA_TEST] ── Running testQuotaDecrement ──');
  var before = _readRawQuota();
  Logger.log('[QUOTA_TEST] Quota BEFORE: ' + before);
  var result = _decrementApiQuota();
  var after  = _readRawQuota();
  Logger.log('[QUOTA_TEST] Quota AFTER : ' + after);
  Logger.log('[QUOTA_TEST] exceeded=' + result.exceeded + '  quota=' + result.quota);
  if (before === after && !result.exceeded) {
    Logger.log('[QUOTA_TEST] ✗ WRITE DID NOT PERSIST — check sheet permissions or SS_ID.');
  } else {
    Logger.log('[QUOTA_TEST] ✓ Write successful.');
  }
}

/** Raw read without any business logic — for diagnostics only */
function _readRawQuota() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(QUOTA_SHEET_NAME);
    if (!sheet) return 'SHEET_NOT_FOUND';
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === QUOTA_CONFIG_KEY) {
        return rows[i][1];
      }
    }
    return 'ROW_NOT_FOUND';
  } catch (e) {
    return 'ERROR: ' + e.toString();
  }
}

// ── INTERNAL HELPERS ─────────────────────────────────────────────────

/**
 * Returns the sheet object, always using the authoritative SS_ID.
 * Does NOT use the global getSheet() wrapper so quota logic is
 * fully self-contained and immune to override conflicts.
 */
function _getConfigSheet() {
  var ss    = (typeof _getSS === 'function') ? _getSS() : SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(QUOTA_SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet "' + QUOTA_SHEET_NAME + '" not found in spreadsheet ' + SS_ID);
  }
  return sheet;
}

// ── PUBLIC: read quota ────────────────────────────────────────────────
/**
 * Action: getApiQuota
 * Response: { quota: <number> }
 */
function getApiQuota(data) {
  Logger.log('[QUOTA] getApiQuota called');
  try {
    var sheet = _getConfigSheet();
    var rows  = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === QUOTA_CONFIG_KEY) {
        var q = parseInt(rows[i][1], 10);
        if (isNaN(q) || q < 0) q = 0;
        Logger.log('[QUOTA] Current quota: ' + q);
        return successResponse({ quota: q });
      }
    }

    // Row missing — auto-create with 0
    Logger.log('[QUOTA] ⚠ API_QUOTA row not found → auto-creating with value 0');
    sheet.appendRow([QUOTA_CONFIG_KEY, 0]);
    return successResponse({ quota: 0 });

  } catch (err) {
    Logger.log('[QUOTA ERROR] getApiQuota: ' + err.toString());
    return errorResponse('Failed to read quota: ' + err.toString());
  }
}

// ── ATOMIC DECREMENT ─────────────────────────────────────────────────
/**
 * Atomically reads and decrements the quota.
 * Uses Script-level Lock to prevent race conditions.
 *
 * @returns {{ exceeded: boolean, quota: number }}
 *   exceeded=true  → quota was 0, call MUST be blocked
 *   exceeded=false → decrement done; quota = new remaining value
 *
 * IMPORTANT: This function NEVER silently swallows errors.
 * If it cannot read/write the sheet it returns exceeded=true so
 * the call is blocked rather than sneaking through.
 */
function _decrementApiQuota() {
  // ── TAHAP 1 (SEBELUM lock): siapkan sheet & lokasi baris kuota ──────────────
  // ✅ PERFORMA: lock global ini dipakai SEMUA operator yang menyimpan. Sebelumnya lock dipegang
  //    selama openById + baca seluruh sheet + tulis + flush (±1–2 dtk) sehingga 31 operator
  //    yang menyimpan bersamaan saling antre sampai timeout. Sekarang di dalam lock hanya:
  //    baca 1 baris (2 sel) → tulis 1 sel → flush.
  var sheet, row;   // row = nomor baris sheet (1-based)
  try {
    sheet = _getConfigSheet();
    row   = _findQuotaRow(sheet);
  } catch (prepErr) {
    Logger.log('[QUOTA] ✗ Prepare error: ' + prepErr.toString() + ' → BLOCKING call');
    return { exceeded: true, quota: 0 };
  }

  if (row === -1) {
    // Baris belum ada — buat (dengan nilai 0) lalu blok, sama seperti sebelumnya
    try {
      Logger.log('[QUOTA] ✗ API_QUOTA row not found → auto-creating with 0 and blocking');
      sheet.appendRow([QUOTA_CONFIG_KEY, 0]);
    } catch (e) { Logger.log('[QUOTA] ✗ Could not create row: ' + e.toString()); }
    return { exceeded: true, quota: 0 };
  }

  // ── TAHAP 2: lock minimal ───────────────────────────────────────────────────
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(15000);
  } catch (lockErr) {
    Logger.log('[QUOTA] ✗ LockService error: ' + lockErr.toString() + ' → BLOCKING call');
    return { exceeded: true, quota: 0 };
  }

  if (!acquired) {
    Logger.log('[QUOTA] ✗ Could not acquire lock (timeout 15s) → BLOCKING call');
    return { exceeded: true, quota: 0 };
  }

  try {
    // Baca ulang 2 sel DI DALAM lock (nilai terbaru) + pastikan baris belum bergeser
    var cells = sheet.getRange(row, 1, 1, 2).getValues()[0];
    if (String(cells[0]).trim() !== QUOTA_CONFIG_KEY) {
      row = _findQuotaRow(sheet);
      if (row === -1) {
        Logger.log('[QUOTA] ✗ API_QUOTA row vanished → BLOCKING call');
        return { exceeded: true, quota: 0 };
      }
      cells = sheet.getRange(row, 1, 1, 2).getValues()[0];
    }

    var current = parseInt(cells[1], 10);
    if (isNaN(current)) current = 0;

    // Hard floor: repair any negative value
    if (current < 0) {
      Logger.log('[QUOTA] ⚠ Negative quota detected (' + current + ') → repairing to 0');
      sheet.getRange(row, 2).setValue(0);
      SpreadsheetApp.flush();
      return { exceeded: true, quota: 0 };
    }

    if (current === 0) {
      Logger.log('[QUOTA] ✗ Quota exhausted (0) → blocking');
      return { exceeded: true, quota: 0 };
    }

    var next = current - 1;   // guaranteed ≥ 0 because current ≥ 1
    sheet.getRange(row, 2).setValue(next);
    SpreadsheetApp.flush();   // force immediate write before releasing lock

    Logger.log('[QUOTA] ✓ Decremented: ' + current + ' → ' + next);
    return { exceeded: false, quota: next };

  } catch (err) {
    // IO / formula error — BLOCK the call so failures are visible
    Logger.log('[QUOTA] ✗ Error during decrement: ' + err.toString() + ' → BLOCKING call');
    return { exceeded: true, quota: 0 };
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}

/**
 * Cari nomor baris (1-based) key API_QUOTA. Hanya membaca kolom A.
 * Hasil di-hint ke CacheService supaya request berikutnya cukup memverifikasi 1 baris.
 * @returns {number} nomor baris, atau -1 bila belum ada
 */
function _findQuotaRow(sheet) {
  var cache = null, hint = -1;
  try {
    cache = CacheService.getScriptCache();
    var h = cache.get('quota:row');
    if (h) hint = parseInt(h, 10);
  } catch (e) { cache = null; }

  if (hint > 1) {
    try {
      if (String(sheet.getRange(hint, 1).getValue()).trim() === QUOTA_CONFIG_KEY) return hint;
    } catch (e) { /* hint di luar jangkauan sheet → scan */ }
  }

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var colA = sheet.getRange(1, 1, lastRow, 1).getValues();
    for (var i = 1; i < colA.length; i++) {
      if (String(colA[i][0]).trim() === QUOTA_CONFIG_KEY) {
        if (cache) { try { cache.put('quota:row', String(i + 1), 21600); } catch (e) {} }
        return i + 1;
      }
    }
  }
  return -1;
}

// ── MIDDLEWARE WRAPPER ────────────────────────────────────────────────
/**
 * Use in doPost() switch to gate any action behind the quota.
 *
 *   case 'saveRealisasi':
 *     result = withQuotaCheck(action, data, function(){ return handleBOPAction(action, data); });
 *     break;
 *
 * On quota exhausted the caller receives:
 *   { success: false, quotaExceeded: true, message: '...', quota: 0 }
 *
 * On success, result.data._remainingQuota is set so the frontend can
 * update its counter without an extra round-trip.
 */
function withQuotaCheck(action, data, fn) {
  Logger.log('[QUOTA] withQuotaCheck called for action: "' + action + '"');

  var qr = _decrementApiQuota();
  Logger.log('[QUOTA] _decrementApiQuota result: exceeded=' + qr.exceeded + ' quota=' + qr.quota);

  if (qr.exceeded) {
    Logger.log('[QUOTA] ✗ Blocking "' + action + '" — quota exhausted');
    return {
      success:       false,
      message:       'API quota has been exhausted. Please contact the administrator to refill the quota in the Config sheet (key: API_QUOTA).',
      quotaExceeded: true,
      quota:         0
    };
  }

  Logger.log('[QUOTA] ✓ Allowing "' + action + '" — remaining quota: ' + qr.quota);

  var result;
  try {
    result = fn();
  } catch (err) {
    Logger.log('[QUOTA] fn() threw error: ' + err.toString());
    return errorResponse('Error in ' + action + ': ' + err.toString());
  }

  // Attach remaining quota to successful responses
  if (result && result.success && qr.quota >= 0) {
    if (result.data === null || result.data === undefined) {
      result.data = {};
    }
    if (typeof result.data === 'object' && !Array.isArray(result.data)) {
      result.data._remainingQuota = qr.quota;
    }
  }

  return result;
}