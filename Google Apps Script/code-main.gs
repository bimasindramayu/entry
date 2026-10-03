// ===== GOOGLE APPS SCRIPT - MAIN (FIXED WITH CORS SUPPORT) =====
// File: code-main.gs
// Deskripsi: Handler utama dan fungsi-fungsi umum untuk login, user management

// ===== KONFIGURASI SPREADSHEET =====
const SS_ID = '1yz9IeOW9WSDRM9JHwBHYtwi5xmA9hIxJVFPX9G10pNw';

// ✅ FIX: Add doGet for CORS preflight
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'OK', message: 'API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== MAIN HANDLER WITH CORS SUPPORT =====
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    Logger.log(`[${new Date().toISOString()}] Action: ${action}`);
    // ✅ FIX: Jangan log seluruh payload — Logger GAS melempar Exception jika > ~8KB
    // Akibatnya doPost gagal dan export mengembalikan semua data dari sheet
    var _logSafe = { action: data.action };
    if (data.type)    _logSafe.type    = data.type;
    if (data.filters) _logSafe.filters = data.filters;
    if (data.customData) _logSafe.customData_count = Array.isArray(data.customData) ? data.customData.length : '?';
    if (data.kua)     _logSafe.kua     = data.kua;
    if (data.format)  _logSafe.format  = data.format;
    Logger.log('Payload summary: ' + JSON.stringify(_logSafe));
    
    let result;
    
    // Route ke fungsi yang sesuai
    switch(action) {
      // Authentication & User Management
      case 'login':
        result = handleLogin(data);
        break;
      case 'changePassword':
        result = changePassword(data);
        break;
      case 'getUsers':
        result = getUsers(data);
        break;
      case 'saveUser':
        result = saveUser(data);
        break;
      case 'deleteUser':
        result = deleteUser(data);
        break;
      case 'updateRPDConfig':
        result = updateRPDConfig(data);
        break;
      
      // ── Quota Management ──────────────────────────────────────────
      case 'getApiQuota':
        result = getApiQuota(data);
        break;

      // ── Quota-tracked BOP Actions (decrement quota before executing)
      case 'saveRealisasi':
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;
      case 'updateRealisasiStatus':   // ← verifikasi realisasi memakai action ini
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;
      case 'verifyRealisasi':
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;
      case 'deleteRealisasi':
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;
      case 'saveRPD':   // ← termasuk edit RPD oleh Admin/Operator KUA
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;
      case 'saveAutoPaymentNominal':
        result = withQuotaCheck(action, data, function() { return handleBOPAction(action, data); });
        break;

      // BOP Actions
      case 'getBudgets':
      case 'saveBudget':
      case 'deleteBudget':
      case 'getRPDConfig':
      case 'saveRPDConfig':
      case 'getRPDs':
      case 'deleteRPD':
      case 'getRealisasis':
      case 'uploadFile':
      case 'getDashboardStats':
      case 'exportBudget':
      case 'exportRPD':
      case 'exportRealisasi':
      case 'downloadRealisasiBulanan':
      case 'exportBudgetEnhanced':
      case 'exportRPDEnhanced':
      case 'exportRealisasiEnhanced':
      case 'exportRPDAllPerMonth':
      case 'exportRPDSelectedPerMonth':
      case 'exportRPDAllDetailYear':
      case 'exportRealisasiAllPerMonth':
      case 'exportRealisasiSelectedPerMonth':
      case 'exportRealisasiAllDetailPerMonth':
      case 'exportRPDPerYear':
      case 'exportRPDDetailYear':
      case 'exportRPDDetailAllYear':
      case 'exportRealisasiPerYear':
      case 'exportRealisasiDetailYear':
      case 'exportRealisasiDetailAllYear':
      case 'exportRPDDetailMonth':
      case 'exportRealisasiDetailMonth':
      case 'exportFallbackPerYear':
      case 'exportFallbackDetailYear':
      case 'exportFallbackDetailMonth':
      case 'getAutoPaymentConfig':
      case 'saveAutoPaymentConfig':
      case 'getAutoPaymentNominal':
      case 'getAutoPaymentNominalYear':
      case 'getBopBootstrap':
        // Delegate ke BOP module
        result = handleBOPAction(action, data);
        break;
      
      // BMN Actions
      case 'getBMNStats':
      case 'getBMNData':
      case 'saveBMN':
      case 'uploadBMNPhoto':
      case 'getBMNVerifikasi':
      case 'updateBMNVerifikasi':
      case 'getBMNRiwayat':
      case 'exportLaporanBMN':
      case 'getBMNConfig':
      case 'getBMNSettings':
      case 'saveBMNSetting':
        // Delegate ke BMN module
        result = handleBMNAction(action, data);
        break;
      
      // NIKAH Actions
      case 'getNikahStats':
      case 'getNikahData':
      case 'saveNikahData':
      case 'getNikahMonthStatus':
      case 'toggleNikahMonthStatus':
      case 'getKUAInfo':
      case 'updateKUAInfo':
      case 'getAllKUAInfo':
      case 'exportNikahExcel':
      case 'cleanupExportFile':
      case 'exportNikahPDF':
        // Delegate ke NIKAH module
        result = handleNikahAction(action, data);
        break;

      //SUPERVISI
      case 'getSupervisiFiles':
        return ContentService
          .createTextOutput(JSON.stringify(handleGetSupervisiFiles(data)))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getSupervisiData':
        return ContentService
          .createTextOutput(JSON.stringify(handleGetSupervisiData(data)))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getStokData':
        return ContentService
          .createTextOutput(JSON.stringify(handleGetStokData(data)))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getDuplikatData':
        return ContentService
          .createTextOutput(JSON.stringify(handleGetDuplikatData(data)))
          .setMimeType(ContentService.MimeType.JSON);
      
      default:
        Logger.log(`[ERROR] Unknown action: ${action}`);
        result = { success: false, message: 'Action tidak dikenal' };
    }
    
    // ✅ PERFORMA: aksi tulis → naikkan versi cache BOP agar pembacaan berikutnya selalu segar.
    //    Dilakukan SESUDAH penulisan selesai & SEBELUM respons dikirim ke client.
    try { if (typeof _bopInvalidateForAction === 'function') _bopInvalidateForAction(action); } catch (_ce) {}

    // ✅ FIX: Convert result to proper response format with CORS
    // return createCORSResponse(result);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('[doPost ERROR] ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ✅ NEW: Create response with CORS headers
function createCORSResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  
  // Note: Apps Script doesn't support custom headers in ContentService
  // CORS must be configured in deployment settings
  return output;
}

// ===== RESPONSE HELPERS (UPDATED) =====
function successResponse(data) {
  Logger.log(`[SUCCESS] Response data type: ${typeof data}`);
  // ✅ FIX: Return plain object, not ContentService
  return { success: true, data: data };
}

function errorResponse(message) {
  Logger.log(`[ERROR RESPONSE] ${message}`);
  // ✅ FIX: Return plain object, not ContentService
  return { success: false, message: message };
}

// ===== DATABASE HELPERS =====
// ✅ PERFORMA: objek Spreadsheet di-memo per eksekusi. Sebelumnya openById() dipanggil
//    di SETIAP getSheet() (belasan kali per request) → lambat & boros kuota.
var _SS_MEMO = null;
function _getSS() {
  if (_SS_MEMO) return _SS_MEMO;
  _SS_MEMO = SpreadsheetApp.openById(SS_ID);
  return _SS_MEMO;
}

function getSheet(sheetName) {
  const ss = _getSS();
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    Logger.log(`[INFO] Creating new sheet: ${sheetName}`);
    sheet = ss.insertSheet(sheetName);
    initializeSheet(sheet, sheetName);
  }
  
  return sheet;
}

function initializeSheet(sheet, sheetName) {
  let headers = [];
  
  const SHEETS = {
    USERS: 'Users',
    BUDGET: 'Budget',
    RPD: 'RPD',
    REALISASI: 'Realisasi',
    LOGS: 'Logs',
    CONFIG: 'Config'
  };
  
  const BMN_SHEETS = {
    BMN_DATA: 'BMN_Data',
    BMN_RIWAYAT: 'BMN_Riwayat',
    BMN_CONFIG: 'BMN_Config'
  };
  
  const NIKAH_SHEETS = {
    NIKAH_DATA: 'Nikah_Data',
    NIKAH_STATUS: 'Nikah_Status',
    KUA_INFO: 'KUA_Info'
  };
  
  switch(sheetName) {
    case SHEETS.USERS:
      headers = ['ID', 'Username', 'Password', 'Name', 'Role', 'KUA', 'Created', 'Updated'];
      break;
    case SHEETS.BUDGET:
      headers = ['ID', 'KUA', 'Year', 'Total', 'Pagu', 'Realisasi', 'Created', 'Updated'];
      break;
    case SHEETS.RPD:
      headers = ['ID', 'KUA', 'UserID', 'Month', 'Year', 'Data', 'Total', 'Created', 'Updated'];
      break;
    case SHEETS.REALISASI:
      headers = ['ID', 'KUA', 'UserID', 'Month', 'Year', 'RPD_ID', 'Data', 'Total', 'Status', 'Catatan', 'Files', 'Created', 'Updated'];
      break;
    case BMN_SHEETS.BMN_DATA:
      headers = ['ID', 'KUA', 'Jenis', 'Nama', 'Merk', 'Tahun', 'Kondisi', 'Nilai', 'Status', 'Keterangan', 'Photos', 'Created', 'Updated'];
      break;
    case BMN_SHEETS.BMN_RIWAYAT:
      headers = ['ID', 'BMN_ID', 'Action', 'Description', 'UserID', 'Timestamp'];
      break;
    case NIKAH_SHEETS.NIKAH_DATA:
      headers = ['ID', 'KUA', 'Month', 'Year', 'Jumlah', 'UserID', 'Created', 'Updated'];
      break;
    case NIKAH_SHEETS.NIKAH_STATUS:
      headers = ['KUA', 'Month', 'Year', 'Status', 'Updated'];
      break;
    case NIKAH_SHEETS.KUA_INFO:
      headers = ['KUA', 'Kepala_KUA', 'NIP', 'Updated'];
      break;
  }
  
  if (headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// ✅ HELPER: Safe date conversion
function safeDate(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString();
  } catch (error) {
    Logger.log('[SAFE_DATE ERROR] ' + error.toString() + ' for value: ' + value);
    return '';
  }
}

// ===== USER MANAGEMENT =====
function handleLogin(data) {
  Logger.log('[LOGIN] Attempting login for: ' + data.username);
  
  try {
    const sheet = getSheet('Users');
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === data.username && rows[i][2] === data.password) {
        const user = {
          id: rows[i][0],
          username: rows[i][1],
          name: rows[i][3],
          role: rows[i][4],
          kua: rows[i][5] || ''
        };
        
        Logger.log('[LOGIN] Success for: ' + data.username);
        return successResponse(user);
      }
    }
    
    Logger.log('[LOGIN] Failed for: ' + data.username);
    return errorResponse('Username atau password salah');
  } catch (error) {
    Logger.log('[LOGIN ERROR] ' + error.toString());
    return errorResponse('Login gagal: ' + error.toString());
  }
}

function changePassword(data) {
  Logger.log('[CHANGE_PASSWORD] User: ' + data.username);
  
  try {
    const sheet = getSheet('Users');
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === data.username && rows[i][2] === data.oldPassword) {
        sheet.getRange(i + 1, 3).setValue(data.newPassword);
        sheet.getRange(i + 1, 8).setValue(new Date());
        
        Logger.log('[CHANGE_PASSWORD] Success for: ' + data.username);
        return successResponse({ message: 'Password berhasil diubah' });
      }
    }
    
    Logger.log('[CHANGE_PASSWORD] Failed - wrong old password');
    return errorResponse('Password lama salah');
  } catch (error) {
    Logger.log('[CHANGE_PASSWORD ERROR] ' + error.toString());
    return errorResponse('Gagal mengubah password: ' + error.toString());
  }
}

function getUsers(data) {
  Logger.log('[GET_USERS]');
  
  try {
    const sheet = getSheet('Users');
    const rows = sheet.getDataRange().getValues();
    const users = [];
    
    for (let i = 1; i < rows.length; i++) {
      // ✅ FIX: Use safeDate helper for date conversion
      users.push({
        id: rows[i][0],
        username: rows[i][1],
        name: rows[i][3],
        role: rows[i][4],
        kua: rows[i][5] || '',
        created: safeDate(rows[i][6]),
        updated: safeDate(rows[i][7])
      });
    }
    
    Logger.log('[GET_USERS] Found: ' + users.length);
    return successResponse(users);
  } catch (error) {
    Logger.log('[GET_USERS ERROR] ' + error.toString());
    return errorResponse('Gagal memuat users: ' + error.toString());
  }
}

function saveUser(data) {
  Logger.log('[SAVE_USER] ID: ' + (data.id || 'new'));
  
  try {
    const sheet = getSheet('Users');
    const rows = sheet.getDataRange().getValues();
    const now = new Date();
    
    if (data.id) {
      // Update existing
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.id) {
          sheet.getRange(i + 1, 2).setValue(data.username);
          sheet.getRange(i + 1, 4).setValue(data.name);
          sheet.getRange(i + 1, 5).setValue(data.role);
          sheet.getRange(i + 1, 6).setValue(data.kua || '');
          sheet.getRange(i + 1, 8).setValue(now);
          
          if (data.password) {
            sheet.getRange(i + 1, 3).setValue(data.password);
          }
          
          Logger.log('[SAVE_USER] Updated: ' + data.id);
          return successResponse({ message: 'User berhasil diupdate', id: data.id });
        }
      }
      return errorResponse('User tidak ditemukan');
    } else {
      // Check duplicate username
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] === data.username) {
          return errorResponse('Username sudah digunakan');
        }
      }
      
      // Create new
      const id = 'USR-' + Date.now();
      sheet.appendRow([
        id,
        data.username,
        data.password,
        data.name,
        data.role,
        data.kua || '',
        now,
        now
      ]);
      
      Logger.log('[SAVE_USER] Created: ' + id);
      return successResponse({ message: 'User berhasil dibuat', id: id });
    }
  } catch (error) {
    Logger.log('[SAVE_USER ERROR] ' + error.toString());
    return errorResponse('Gagal menyimpan user: ' + error.toString());
  }
}

function deleteUser(data) {
  Logger.log('[DELETE_USER] ID: ' + data.id);
  
  try {
    const sheet = getSheet('Users');
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.deleteRow(i + 1);
        Logger.log('[DELETE_USER] Deleted: ' + data.id);
        return successResponse({ message: 'User berhasil dihapus' });
      }
    }
    
    return errorResponse('User tidak ditemukan');
  } catch (error) {
    Logger.log('[DELETE_USER ERROR] ' + error.toString());
    return errorResponse('Gagal menghapus user: ' + error.toString());
  }
}

// ===== LOGGING =====
function logAction(action, userId, details) {
  try {
    const sheet = getSheet('Logs');
    sheet.appendRow([
      new Date(),
      action,
      userId,
      details
    ]);
  } catch (error) {
    Logger.log('[LOG_ACTION ERROR] ' + error.toString());
  }
}