// ===== GOOGLE APPS SCRIPT - BOP MODULE ENHANCED =====
// File: code-bop-enhanced.gs
// Version: 5.0 - Multi-user optimized with Lock Service
// Features: Lock Service, Optimistic Locking, Batch Operations, Retry Mechanism

// ===== STATUS BACKWARD COMPATIBILITY =====
/**
 * Normalize status lama ke nilai baru.
 * Data lama: 'Pending', 'Menunggu', 'Menunggu Verifikasi', 'Diterima', 'Ditolak'
 * Data baru: 'Waiting', 'Approved', 'Rejected', 'Paid'
 */
function normalizeStatusEnhanced(status) {
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

// ===== LOCK SERVICE IMPLEMENTATION =====

/**
 * Acquire lock dengan retry mechanism
 * @param {string} lockKey - Unique key untuk lock
 * @param {number} maxWaitSeconds - Maximum waktu tunggu (default: 30s)
 * @return {GoogleAppsScript.Lock.Lock|null} - Lock object atau null
 */
 
function acquireLock(lockKey, maxWaitSeconds) {
  maxWaitSeconds = maxWaitSeconds || 30;
  
  try {
    const lock = LockService.getDocumentLock();
    const acquired = lock.tryLock(maxWaitSeconds * 1000);
    
    if (acquired) {
      Logger.log('[LOCK] ✓ Acquired lock for: ' + lockKey);
      return lock;
    } else {
      Logger.log('[LOCK] ✗ Failed to acquire lock for: ' + lockKey);
      return null;
    }
  } catch (error) {
    Logger.log('[LOCK ERROR] ' + error.toString());
    return null;
  }
}

/**
 * Release lock
 */
function releaseLock(lock) {
  if (lock) {
    try {
      lock.releaseLock();
      Logger.log('[LOCK] Released lock');
    } catch (error) {
      Logger.log('[LOCK RELEASE ERROR] ' + error.toString());
    }
  }
}

/**
 * Execute function dengan lock protection
 */
function executeWithLock(lockKey, fn, maxWaitSeconds) {
  const lock = acquireLock(lockKey, maxWaitSeconds);
  
  if (!lock) {
    return errorResponse('Sistem sedang sibuk, silakan coba lagi dalam beberapa saat');
  }
  
  try {
    const result = fn();
    return result;
  } catch (error) {
    Logger.log('[EXECUTE_WITH_LOCK ERROR] ' + error.toString());
    return errorResponse('Terjadi kesalahan: ' + error.toString());
  } finally {
    releaseLock(lock);
  }
}

// ===== OPTIMISTIC LOCKING =====

/**
 * Validate concurrent update menggunakan timestamps
 */
function validateOptimisticLock(data, existingUpdatedAt) {
  if (!data.lastUpdatedAt) {
    return true; // First time update, no conflict
  }
  
  const clientTimestamp = new Date(data.lastUpdatedAt).getTime();
  const dbTimestamp = new Date(existingUpdatedAt).getTime();
  
  if (clientTimestamp < dbTimestamp) {
    Logger.log('[OPTIMISTIC_LOCK] ⚠️ Conflict detected! Client: ' + clientTimestamp + ', DB: ' + dbTimestamp);
    return false;
  }
  
  return true;
}

// ===== ENHANCED SAVE OPERATIONS =====

/**
 * ✅ BARU — Ambil satu nilai dari sheet Config berdasarkan key.
 */
function _getConfigValue(key) {
  try {
    const rows = _sheetValues(SHEETS.CONFIG);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === key) return rows[i][1];
    }
  } catch (e) {
    Logger.log('[GET_CONFIG_VALUE ERROR] ' + e.toString());
  }
  return null;
}

/**
 * ✅ BARU — Total Budget (Pagu) tahunan utk satu KUA+tahun. 0 kalau tidak ada baris Budget-nya.
 */
function _getBudgetTotalForKUA(kua, year) {
  try {
    const rows = _sheetValues(SHEETS.BUDGET);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === kua && rows[i][2] == year) {
        return parseFloat(rows[i][3]) || 0;
      }
    }
  } catch (e) {
    Logger.log('[GET_BUDGET_TOTAL ERROR] ' + e.toString());
  }
  return 0;
}

/**
 * Save RPD dengan lock protection dan optimistic locking
 * ✅ Prevents race conditions
 * ✅ Validates concurrent updates
 * ✅ Returns updated timestamp
 * ✅ BARU — Khusus Operator KUA (Admin dilewati):
 *    - Edit RPD yang sudah ada hanya boleh utk bulan yang dibuka Admin
 *      (Config: RPD_EDIT_OPEN_MONTHS).
 *    - Total RPD setahun (akumulasi 12 bulan) tidak boleh melebihi Budget
 *      tahunan KUA tsb.
 */
function saveRPDEnhanced(data) {
  Logger.log('[SAVE_RPD_ENHANCED] KUA: ' + data.kua + ', Month: ' + data.month + ', Year: ' + data.year);
  
  const lockKey = 'RPD_' + data.kua + '_' + data.month + '_' + data.year;
  
  return executeWithLock(lockKey, function() {
    _memoStart();   // ✅ PERFORMA: tiap sheet dibaca sekali selama lock dipegang (dibersihkan di finally)
    try {
      const sheet = getSheet(SHEETS.RPD);
      const rows = _sheetValues(SHEETS.RPD);
      const now = new Date();

      // ✅ BARU — Cari dulu row yang cocok (kua+month+year) SEBELUM menulis
      // apa pun, supaya kita tahu ini create atau edit, dan tahu oldTotal-nya,
      // untuk keperluan validasi di bawah.
      let foundIndex = -1;
      let oldTotal   = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] === data.kua &&
            rows[i][2] === data.month &&
            rows[i][3] == data.year) {
          foundIndex = i;
          oldTotal   = parseFloat(rows[i][4]) || 0;
          break;
        }
      }
      const isEdit = foundIndex >= 0;

      // ✅ BARU — Validasi khusus Operator KUA (Admin dilewati)
      if (data.role !== 'Admin') {
        // Rule A: EDIT RPD yang sudah ada hanya boleh kalau bulannya
        // termasuk dalam daftar yang dibuka Admin.
        if (isEdit) {
          let openMonths = [];
          try { openMonths = JSON.parse(_getConfigValue('RPD_EDIT_OPEN_MONTHS') || '[]'); } catch (e) { openMonths = []; }
          if (openMonths.indexOf(data.month) === -1) {
            Logger.log('[SAVE_RPD_ENHANCED] ⛔ Edit RPD bulan ' + data.month + ' belum dibuka Admin');
            return errorResponse('Edit RPD bulan ' + data.month + ' sedang ditutup. Hubungi Admin untuk membuka periode edit bulan ini di menu Konfigurasi.');
          }
        }

        // Rule B: total RPD setahun (semua bulan, termasuk yang sedang
        // disimpan ini) tidak boleh melebihi Budget tahunan KUA ini.
        const budgetTotal   = _getBudgetTotalForKUA(data.kua, data.year);
        const currentAnnual = calculateTotalRPD(data.kua, data.year); // masih termasuk oldTotal row ini kalau edit
        const newAnnual     = currentAnnual - oldTotal + (parseFloat(data.total) || 0);
        if (newAnnual > budgetTotal) {
          const sisaUntukBulanIni = Math.max(0, budgetTotal - (currentAnnual - oldTotal));
          Logger.log('[SAVE_RPD_ENHANCED] ⛔ Total RPD setahun (' + newAnnual + ') melebihi Budget (' + budgetTotal + ')');
          return errorResponse(
            'Total RPD setahun (Rp ' + newAnnual.toLocaleString('id-ID') + ') melebihi Budget tahunan (Rp ' +
            budgetTotal.toLocaleString('id-ID') + '). Sisa yang tersedia untuk bulan ' + data.month + ': Rp ' +
            sisaUntukBulanIni.toLocaleString('id-ID') + '.'
          );
        }
      }

      if (isEdit) {
        const i = foundIndex;

        // ✅ Optimistic lock validation
        if (!validateOptimisticLock(data, rows[i][7])) {
          return errorResponse('Data sudah diubah oleh user lain. Silakan refresh dan coba lagi.');
        }
        
        // Update existing RPD — ✅ 2 penulisan (E:F dan H:J) menggantikan 5 setValue terpisah
        sheet.getRange(i + 1, 5, 1, 2).setValues([[parseFloat(data.total) || 0, JSON.stringify(data.data)]]);
        sheet.getRange(i + 1, 8, 1, 3).setValues([[now, data.userId, data.username]]);
        
        Logger.log('[SAVE_RPD_ENHANCED] ✓ Updated RPD at row: ' + (i + 1));
        
        return successResponse({ 
          message: 'RPD berhasil diupdate',
          id: rows[i][0],
          updatedAt: now.toISOString()
        });
      }
      
      // Create new RPD
      const id = 'RPD-' + Utilities.getUuid();
      const newRow = [
        id,
        data.kua,
        data.month,
        data.year,
        parseFloat(data.total) || 0,
        JSON.stringify(data.data),
        now,
        now,
        data.userId,
        data.username
      ];
      
      sheet.appendRow(newRow);
      Logger.log('[SAVE_RPD_ENHANCED] ✓ Created new RPD: ' + id);
      
      return successResponse({ 
        message: 'RPD berhasil disimpan',
        id: id,
        updatedAt: now.toISOString()
      });
      
    } catch (error) {
      Logger.log('[SAVE_RPD_ENHANCED ERROR] ' + error.toString());
      return errorResponse('Gagal menyimpan RPD: ' + error.toString());
    } finally {
      _memoStop();
    }
  }, 30);
}

/**
 * ✅ BARU (v2 — per item, bukan per kode) — Validasi realisasi terhadap RPD,
 * khusus Operator KUA (Admin dilewati).
 *
 * PENTING: sebagian kode akun (mis. 521111 "Belanja Operasional Perkantoran")
 * punya beberapa item di dalamnya (ATK Kantor, Jamuan Tamu, Pramubakti, Alat
 * Rumah Tangga Kantor). Validasi ini dihitung PER ITEM, bukan digabung per
 * kode — karena RPD & pagu tiap item pada dasarnya berdiri sendiri-sendiri.
 * (v1 sebelumnya salah: menjumlahkan semua item dalam satu kode jadi satu
 * angka, sehingga pos yang sudah lewat pagu bisa "tertutupi" oleh sisa pagu
 * item lain dalam kode yang sama.)
 *
 * Rule 1 (per item, akumulasi 1 tahun):
 *   total realisasi Approved+Paid item itu sepanjang tahun (tidak termasuk
 *   row yang sedang diedit) + nominal yang diajukan sekarang untuk item itu,
 *   TIDAK BOLEH melebihi total RPD item itu sepanjang tahun (akumulasi 12 bulan).
 *
 * Rule 2 (per item, RPD bulan berjalan):
 *   nominal yang diajukan sekarang untuk item itu TIDAK BOLEH melebihi RPD
 *   item itu pada bulan yang sama (kua+month+year yang sama).
 *
 * AP-aware: untuk kode yang AutoPayment aktif (522111/522112 — keduanya
 * kode single-item "Nominal"), nominal yang dihitung adalah AutoPaymentNominal
 * bulan terkait — bukan input manual.
 *
 * Menggunakan ulang helper yang sudah ada di code-bop.gs:
 * _loadAPData, _agregateRPDRowDetail, _agregateRealisasiRowDetail, BOP_CONFIG.
 *
 * @param {Object} data      payload dari client: {kua, month, year, data:{code:{item:val}}}
 * @param {String} excludeId id realisasi yang sedang diedit (dikecualikan dari akumulasi "sudah terpakai"), atau falsy jika realisasi baru
 * @return {String|null}     pesan error (Bahasa Indonesia) jika melanggar, null jika lolos
 */
function _validateRealisasiAgainstRPD(data, excludeId) {
  try {
    var kua   = data.kua;
    var year  = data.year;
    var month = data.month;
    var submittedData = data.data || {};

    // ── AP config & nominal AutoPayment bulan berjalan ──────────────
    var apInfo   = _loadAPData(year);
    var kuaApCfg = apInfo.apCfg[kua] || null;
    var hasAP    = kuaApCfg && (kuaApCfg['522111'] || kuaApCfg['522112']);
    var nomMonth = (apInfo.apNom[kua] && apInfo.apNom[kua][month]) ? apInfo.apNom[kua][month] : {};

    // ── Nominal yang diajukan sekarang, per (kode,item) — AP-aware ──
    var incoming = {}; // incoming[code][item] = amount
    Object.keys(submittedData).forEach(function(code) {
      var isAP = hasAP && kuaApCfg[code] === true;
      incoming[code] = {};
      Object.keys(submittedData[code] || {}).forEach(function(item) {
        incoming[code][item] = isAP
          ? (parseFloat(nomMonth[code] || 0) || 0) // kode AP selalu 1 item ("Nominal")
          : (parseFloat(submittedData[code][item]) || 0);
      });
    });

    // ── Kumpulkan RPD 1 tahun (semua bulan) per (kode,item); ────────
    // ── sekaligus simpan data RPD bulan yang sama secara utuh ───────
    var rpdRows  = _sheetValues(SHEETS.RPD);
    var rpdAnnualByKUA = {};
    var rpdMonthData   = null; // {code:{item:val}} khusus bulan yg sedang diisi
    for (var i = 1; i < rpdRows.length; i++) {
      if (rpdRows[i][1] !== kua || rpdRows[i][3] != year) continue;
      _agregateRPDRowDetail(rpdRows[i], rpdAnnualByKUA);
      if (rpdRows[i][2] === month) {
        try { rpdMonthData = JSON.parse(rpdRows[i][5] || '{}'); } catch (e) { rpdMonthData = {}; }
      }
    }
    var rpdAnnual = rpdAnnualByKUA[kua] || {}; // {code:{item:sumSetahun}}

    // ── RULE 2: per (kode,item), nominal yang diajukan vs RPD bulan yang sama ──
    var violations2 = [];
    if (rpdMonthData !== null) {
      Object.keys(incoming).forEach(function(code) {
        Object.keys(incoming[code]).forEach(function(item) {
          var addNow = incoming[code][item];
          if (addNow <= 0) return;
          var capBulan = (rpdMonthData[code] && rpdMonthData[code][item] !== undefined)
            ? (parseFloat(rpdMonthData[code][item]) || 0) : 0;
          if (addNow > capBulan) {
            violations2.push(
              _posLabel(code, item) + ': RPD bulan ' + month + ' Rp ' + capBulan.toLocaleString('id-ID') +
              ', diajukan Rp ' + addNow.toLocaleString('id-ID')
            );
          }
        });
      });
    }
    if (violations2.length > 0) {
      return 'Nominal melebihi RPD bulan ' + month + ' untuk pos berikut:\n• ' + violations2.join('\n• ');
    }

    // ── Kumpulkan realisasi Approved/Paid 1 tahun, per (kode,item) ──
    // ── (AP-aware, exclude row yang sedang diedit) ──────────────────
    var realRows  = _sheetValues(SHEETS.REALISASI);
    var usedByKUA = {};
    for (var j = 1; j < realRows.length; j++) {
      if (realRows[j][1] !== kua || realRows[j][4] != year) continue;
      if (excludeId && realRows[j][0] === excludeId) continue;
      var st = normalizeStatusEnhanced(realRows[j][8]);
      if (st !== 'Approved' && st !== 'Paid') continue;
      _agregateRealisasiRowDetail(realRows[j], usedByKUA, apInfo.apCfg, apInfo.apNom, 'include');
    }
    var used = usedByKUA[kua] || {}; // {code:{item:sudahTerpakaiSetahun}}

    // ── RULE 1: per (kode,item), (sudah terpakai + diajukan) <= RPD setahun item itu ──
    var violations1 = [];
    Object.keys(incoming).forEach(function(code) {
      Object.keys(incoming[code]).forEach(function(item) {
        var addNow = incoming[code][item];
        if (addNow <= 0) return; // tidak ada nominal utk item ini pada submission ini
        var cap = (rpdAnnual[code] && rpdAnnual[code][item] !== undefined) ? (rpdAnnual[code][item] || 0) : 0;
        var usd = (used[code] && used[code][item] !== undefined) ? (used[code][item] || 0) : 0;
        if (usd + addNow > cap) {
          var sisa = Math.max(0, cap - usd);
          violations1.push(
            _posLabel(code, item) + ': RPD 1 tahun Rp ' + cap.toLocaleString('id-ID') +
            ', sudah terealisasi Rp ' + usd.toLocaleString('id-ID') +
            ', sisa Rp ' + sisa.toLocaleString('id-ID') +
            ', diajukan Rp ' + addNow.toLocaleString('id-ID')
          );
        }
      });
    });

    if (violations1.length > 0) {
      return 'Nominal melebihi sisa RPD setahun untuk pos berikut:\n• ' + violations1.join('\n• ');
    }

    return null; // lolos semua validasi

  } catch (e) {
    Logger.log('[VALIDATE_REALISASI_RPD ERROR] ' + e.toString());
    return null; // fail-open: error internal pada validasi tidak boleh memblokir submit
  }
}

/**
 * Label pos akun yang enak dibaca utk pesan error.
 * Kode dengan 1 item ("Nominal", mis. Listrik/Telepon/Air) cukup ditampilkan
 * nama kodenya saja; kode dengan beberapa item ditampilkan "NamaKode — Item".
 */
function _posLabel(code, item) {
  var param = BOP_CONFIG.RPD_PARAMETERS[code];
  var codeName = param ? param.name : code;
  if (item === 'Nominal') return codeName;
  return codeName + ' — ' + item;
}

/**
 * Save Realisasi dengan lock protection dan validation
 * ✅ Prevents duplicate realisasi for same month
 * ✅ Validates status before update
 * ✅ Optimistic locking for concurrent updates
 */
function saveRealisasiEnhanced(data) {
  Logger.log('[SAVE_REALISASI_ENHANCED] KUA: ' + data.kua + ', Month: ' + data.month + ', Year: ' + data.year);
  
  const lockKey = 'REALISASI_' + data.kua + '_' + data.month + '_' + data.year;
  
  return executeWithLock(lockKey, function() {
    _memoStart();   // ✅ PERFORMA: Realisasi/RPD/Budget/AP dibaca SEKALI selama lock (sebelumnya 3–4× per sheet)
    try {
      const sheet = getSheet(SHEETS.REALISASI);
      const rows = _sheetValues(SHEETS.REALISASI);
      const now = new Date();
      
      if (data.id) {
        // Update existing realisasi
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0] === data.id) {
            
            // ✅ Optimistic lock validation
            if (!validateOptimisticLock(data, rows[i][12])) {
              return errorResponse('Data sudah diubah oleh user lain. Silakan refresh dan coba lagi.');
            }
            
            // ✅ Validate status - hanya Waiting/Rejected yang bisa diedit
            const currentStatus = rows[i][8];
            const normalizedStatus = normalizeStatusEnhanced(currentStatus);
            if (normalizedStatus === 'Approved' || normalizedStatus === 'Paid') {
              return errorResponse('Realisasi dengan status ' + normalizedStatus + ' tidak dapat diubah.');
            }

            // ✅ BARU — Validasi terhadap RPD (per pos akun setahun + RPD bulan berjalan),
            // khusus Operator KUA. Row yang sedang diedit dikecualikan dari akumulasi.
            if (data.role !== 'Admin') {
              const rpdViolation = _validateRealisasiAgainstRPD(data, data.id);
              if (rpdViolation) {
                Logger.log('[SAVE_REALISASI_ENHANCED] ⛔ RPD validation failed (update): ' + rpdViolation);
                return errorResponse(rpdViolation);
              }
            }
            
            // Update realisasi
            // ✅ CORRECT COLUMN INDICES (1-based):
            // C(3)=Bulan, D(4)=RPD_ID, E(5)=Tahun, F(6)=Total, G(7)=Data, H(8)=Files, L(12)=UpdatedAt
            // ✅ PERFORMA: C..I ditulis dalam SATU setValues (sebelumnya 7 setValue terpisah) + L
            sheet.getRange(i + 1, 3, 1, 7).setValues([[
              data.month,                          // C: Bulan
              data.rpdId || '',                    // D: RPD ID
              data.year,                           // E: Tahun
              parseFloat(data.total) || 0,         // F: Total ✅
              JSON.stringify(data.data || {}),     // G: Data
              JSON.stringify(data.files || []),    // H: Files ✅
              'Waiting'                            // I: Status reset
            ]]);
            sheet.getRange(i + 1, 12).setValue(now.toISOString());              // L: Updated At ✅
            
            Logger.log('[SAVE_REALISASI_ENHANCED] ✓ Updated realisasi: ' + data.id);
            
            return successResponse({ 
              message: 'Realisasi berhasil diupdate',
              id: data.id,
              updatedAt: now.toISOString()
            });
          }
        }
        
        return errorResponse('Realisasi tidak ditemukan');
        
      } else {
        // Create new realisasi
        
        // ✅ Validate: Check for duplicates
        // C (index 2) = Bulan, E (index 4) = Tahun
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][1] === data.kua && 
              rows[i][2] === data.month && 
              rows[i][4] == data.year) {
            return errorResponse('Realisasi untuk bulan ini sudah ada. Silakan edit yang sudah ada.');
          }
        }
        
        // ✅ Validate: Nominal tidak boleh melebihi sisa budget tahunan (khusus Operator KUA)
        if (data.role === 'Operator KUA' || !data.role || data.role !== 'Admin') {
          try {
            const budgetRows   = _sheetValues(SHEETS.BUDGET);
            let annualBudget   = 0;
            for (let i = 1; i < budgetRows.length; i++) {
              if (budgetRows[i][1] === data.kua && budgetRows[i][2] == data.year) {
                annualBudget = parseFloat(budgetRows[i][3]) || 0;
                break;
              }
            }
            if (annualBudget > 0) {
              const totalApprovedPaid = calculateTotalRealisasi(data.kua, data.year);
              const sisaBudget        = annualBudget - totalApprovedPaid;
              const incomingTotal     = parseFloat(data.total) || 0;
              if (incomingTotal > sisaBudget) {
                const selisih = incomingTotal - sisaBudget;
                Logger.log('[SAVE_REALISASI_ENHANCED] ⛔ Budget exceeded: total=' + incomingTotal +
                           ', sisa=' + sisaBudget + ', selisih=' + selisih);
                return errorResponse(
                  'Total realisasi (Rp ' + incomingTotal.toLocaleString('id-ID') + ') melebihi sisa budget tahunan ' +
                  '(Rp ' + sisaBudget.toLocaleString('id-ID') + '). ' +
                  'Kelebihan: Rp ' + selisih.toLocaleString('id-ID') + '.'
                );
              }
            }
          } catch (budgetErr) {
            Logger.log('[SAVE_REALISASI_ENHANCED] Budget check error (non-fatal): ' + budgetErr.toString());
          }
        }

        // ✅ BARU — Validasi terhadap RPD (per pos akun setahun + RPD bulan berjalan),
        // khusus Operator KUA.
        if (data.role !== 'Admin') {
          const rpdViolation = _validateRealisasiAgainstRPD(data, null);
          if (rpdViolation) {
            Logger.log('[SAVE_REALISASI_ENHANCED] ⛔ RPD validation failed (create): ' + rpdViolation);
            return errorResponse(rpdViolation);
          }
        }
        
        const id = 'REA-' + Date.now();
        
        // ✅ CORRECT COLUMN ORDER:
        // A(1)=ID | B(2)=KUA | C(3)=Bulan | D(4)=RPD_ID | E(5)=Tahun | F(6)=Total
        // G(7)=Data | H(8)=Files | I(9)=Status | J(10)=Notes
        // K(11)=CreatedAt | L(12)=UpdatedAt | M(13)=VerifiedAt
        // N(14)=UserID | O(15)=Username | P(16)=VerifiedBy
        const newRow = [
          id,                              // A: ID
          data.kua,                        // B: KUA
          data.month,                      // C: Bulan ✅
          data.rpdId || '',                // D: RPD ID ✅
          data.year,                       // E: Tahun ✅
          parseFloat(data.total) || 0,     // F: Total ✅
          JSON.stringify(data.data || {}), // G: Data (JSON)
          JSON.stringify(data.files || []),// H: Files (JSON) ✅
          'Waiting',                       // I: Status
          '',                              // J: Notes
          now.toISOString(),               // K: Created At
          now.toISOString(),               // L: Updated At
          '',                              // M: Verified At
          data.userId || '',               // N: User ID ✅
          data.username || '',             // O: Username ✅
          ''                               // P: Verified By
        ];
        
        sheet.appendRow(newRow);
        Logger.log('[SAVE_REALISASI_ENHANCED] ✓ Created new realisasi: ' + id);
        
        return successResponse({ 
          message: 'Realisasi berhasil disimpan',
          id: id,
          updatedAt: now.toISOString()
        });
      }
      
    } catch (error) {
      Logger.log('[SAVE_REALISASI_ENHANCED ERROR] ' + error.toString());
      return errorResponse('Gagal menyimpan realisasi: ' + error.toString());
    } finally {
      _memoStop();
    }
  }, 30);
}

/**
 * Verify Realisasi dengan lock protection
 * ✅ Prevents double verification
 * ✅ Validates current status
 */
function verifyRealisasiEnhanced(data) {
  Logger.log('[VERIFY_REALISASI_ENHANCED] ID: ' + data.id + ', Status: ' + data.status);
  
  const lockKey = 'VERIFY_REALISASI_' + data.id;
  
  return executeWithLock(lockKey, function() {
    try {
      const sheet = getSheet(SHEETS.REALISASI);
      const rows = sheet.getDataRange().getValues();
      const now = new Date();
      
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.id) {
          
          // ✅ Validate current status
          const currentStatus = rows[i][8];
          if (normalizeStatusEnhanced(currentStatus) !== 'Waiting') {
            return errorResponse('Realisasi ini sudah diverifikasi sebelumnya dengan status: ' + currentStatus);
          }
          
          // Update status and notes
          sheet.getRange(i + 1, 9, 1, 2).setValues([[data.status, data.catatan || '']]);   // I:J sekaligus
          sheet.getRange(i + 1, 13).setValue(now);
          
          Logger.log('[VERIFY_REALISASI_ENHANCED] ✓ Verified: ' + data.id + ' -> ' + data.status);
          
          return successResponse({ 
            message: 'Realisasi berhasil diverifikasi',
            id: data.id
          });
        }
      }
      
      return errorResponse('Realisasi tidak ditemukan');
      
    } catch (error) {
      Logger.log('[VERIFY_REALISASI_ENHANCED ERROR] ' + error.toString());
      return errorResponse('Gagal verifikasi realisasi: ' + error.toString());
    }
  }, 30);
}

// ===== BATCH OPERATIONS =====

/**
 * Get multiple RPDs dengan efficient filtering
 * ✅ Single query for multiple filters
 * ✅ Reduced read operations
 */
function getRPDsBatch(filters) {
  Logger.log('[GET_RPDS_BATCH] Filters: ' + JSON.stringify(filters));
  
  try {
    const sheet = getSheet(SHEETS.RPD);
    const rows = sheet.getDataRange().getValues();
    const rpds = [];
    
    // Pre-process filters
    const kuaList = filters.kuas || [];
    const yearList = filters.years || [];
    const monthList = filters.months || [];
    
    const filterByKUA = kuaList.length > 0;
    const filterByYear = yearList.length > 0;
    const filterByMonth = monthList.length > 0;
    
    // ✅ Single loop with smart filtering
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Skip if filters don't match
      if (filterByKUA && !kuaList.includes(row[1])) continue;
      if (filterByYear && !yearList.includes(row[3])) continue;
      if (filterByMonth && !monthList.includes(row[2])) continue;
      
      // Parse data
      let rpdData = {};
      try {
        rpdData = JSON.parse(row[5] || '{}');
      } catch (e) {
        Logger.log('[GET_RPDS_BATCH] Parse error at row ' + (i+1));
      }
      
      rpds.push({
        id: row[0],
        kua: row[1],
        month: row[2],
        year: row[3],
        total: parseFloat(row[4]) || 0,
        data: rpdData,
        createdAt: safeFormatDate(row[6]),
        updatedAt: safeFormatDate(row[7]),
        userId: row[8],
        username: row[9]
      });
    }
    
    Logger.log('[GET_RPDS_BATCH] ✓ Found: ' + rpds.length + ' RPDs');
    return successResponse(rpds);
    
  } catch (error) {
    Logger.log('[GET_RPDS_BATCH ERROR] ' + error.toString());
    return errorResponse('Gagal memuat RPD: ' + error.toString());
  }
}

/**
 * Get dashboard stats dengan optimized single-pass calculation
 * ✅ Reads each sheet only once
 * ✅ Calculates all stats in single loop
 */
function getDashboardStatsOptimized(data) {
  Logger.log('[GET_DASHBOARD_STATS_OPT] KUA: ' + data.kua + ', Year: ' + data.year);
  
  try {
    const year = data.year || new Date().getFullYear();
    const kua = data.kua;
    
    // ✅ Get all sheets data once
    const budgetRows = _sheetValues(SHEETS.BUDGET);
    const rpdRows = _sheetValues(SHEETS.RPD);
    const realisasiRows = _sheetValues(SHEETS.REALISASI);
    
    // Initialize stats
    let stats = {
      totalBudget: 0,
      totalRPD: 0,
      totalRealisasi: 0,
      sisaBudget: 0,
      realisasiWaiting: 0,
      realisasiApproved: 0,
      realisasiRejected: 0,
      realisasiPaid: 0
    };
    
    // ✅ Calculate budget (single loop)
    for (let i = 1; i < budgetRows.length; i++) {
      if ((!kua || budgetRows[i][1] === kua) && budgetRows[i][2] == year) {
        stats.totalBudget += parseFloat(budgetRows[i][3]) || 0;
      }
    }
    
    // ✅ Calculate RPD (single loop)
    for (let i = 1; i < rpdRows.length; i++) {
      if ((!kua || rpdRows[i][1] === kua) && rpdRows[i][3] == year) {
        stats.totalRPD += parseFloat(rpdRows[i][4]) || 0;
      }
    }
    
    // ✅ Calculate realisasi (single loop)
    // A=ID(0), B=KUA(1), C=Bulan(2), D=RPD_ID(3), E=Tahun(4), F=Total(5), G=Data(6), H=Files(7), I=Status(8)
    for (let i = 1; i < realisasiRows.length; i++) {
      if ((!kua || realisasiRows[i][1] === kua) && realisasiRows[i][4] == year) {
        const total = parseFloat(realisasiRows[i][5]) || 0;  // ✅ F: Total (index 5, bukan 7)
        const status = realisasiRows[i][8];                  // ✅ I: Status (index 8)
        
        if (normalizeStatusEnhanced(status) === 'Approved') {
          stats.totalRealisasi += total;
          stats.realisasiApproved++;
        } else if (normalizeStatusEnhanced(status) === 'Paid') {
          stats.totalRealisasi += total;  // Paid juga masuk total realisasi
          stats.realisasiPaid++;
        } else if (normalizeStatusEnhanced(status) === 'Waiting') {
          stats.realisasiWaiting++;
        } else if (normalizeStatusEnhanced(status) === 'Rejected') {
          stats.realisasiRejected++;
        }
      }
    }
    
    stats.sisaBudget = stats.totalBudget - stats.totalRealisasi;
    // ✅ Alias fields agar frontend kompatibel dengan semua field names
    stats.budget = stats.totalBudget;
    stats.pagu = stats.totalRPD;
    stats.realisasi = stats.totalRealisasi;
    stats.pendingVerifikasi = stats.realisasiWaiting;
    stats.menungguVerifikasi = stats.realisasiWaiting;
    
    Logger.log('[GET_DASHBOARD_STATS_OPT] ✓ Stats calculated');
    return successResponse(stats);
    
  } catch (error) {
    Logger.log('[GET_DASHBOARD_STATS_OPT ERROR] ' + error.toString());
    return errorResponse('Gagal memuat stats: ' + error.toString());
  }
}

// ===== RETRY MECHANISM =====

/**
 * Execute function dengan automatic retry on failure
 * ✅ Exponential backoff
 * ✅ Configurable retry attempts
 */
function executeWithRetry(fn, maxRetries, delayMs) {
  maxRetries = maxRetries || 3;
  delayMs = delayMs || 1000;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      Logger.log('[RETRY] Attempt ' + attempt + ' of ' + maxRetries);
      return fn();
    } catch (error) {
      lastError = error;
      Logger.log('[RETRY] Attempt ' + attempt + ' failed: ' + error.toString());
      
      if (attempt < maxRetries) {
        Utilities.sleep(delayMs);
        delayMs *= 2; // Exponential backoff
      }
    }
  }
  
  Logger.log('[RETRY] ✗ All attempts failed');
  return errorResponse('Operasi gagal setelah ' + maxRetries + ' percobaan: ' + lastError.toString());
}

/**
 * Save RPD dengan retry mechanism
 */
function saveRPDWithRetry(data) {
  return executeWithRetry(function() {
    return saveRPDEnhanced(data);
  }, 3, 1000);
}

/**
 * Save Realisasi dengan retry mechanism
 */
function saveRealisasiWithRetry(data) {
  return executeWithRetry(function() {
    return saveRealisasiEnhanced(data);
  }, 3, 1000);
}

// ===== PERFORMANCE MONITORING =====

const PerformanceMonitor = {
  
  /**
   * Log operation dengan timing information
   */
  logOperation(operation, kua, startTime, success) {
    try {
      const endTime = new Date().getTime();
      const duration = endTime - startTime;
      
      const sheet = getSheet('Performance_Log');
      
      // Initialize sheet if needed
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(['Timestamp', 'Operation', 'KUA', 'Duration (ms)', 'Success']);
        sheet.setFrozenRows(1);
      }
      
      sheet.appendRow([
        new Date(),
        operation,
        kua || 'N/A',
        duration,
        success ? 'YES' : 'NO'
      ]);
      
      Logger.log('[PERF] ' + operation + ' completed in ' + duration + 'ms');
      
      // Alert if slow (> 5 seconds)
      if (duration > 5000) {
        Logger.log('[PERF WARNING] ⚠️ Slow operation: ' + operation + ' (' + duration + 'ms)');
      }
      
    } catch (error) {
      Logger.log('[PERF_LOG ERROR] ' + error.toString());
    }
  },
  
  /**
   * Log concurrent access attempt
   */
  logConcurrentAccess(operation, kua, lockAcquired) {
    try {
      const sheet = getSheet('Concurrent_Access_Log');
      
      // Initialize sheet if needed
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(['Timestamp', 'Operation', 'KUA', 'Lock Acquired']);
        sheet.setFrozenRows(1);
      }
      
      sheet.appendRow([
        new Date(),
        operation,
        kua || 'N/A',
        lockAcquired ? 'YES' : 'NO'
      ]);
      
      if (!lockAcquired) {
        Logger.log('[CONCURRENT] ⚠️ Lock contention: ' + operation + ' for ' + kua);
      }
      
    } catch (error) {
      Logger.log('[CONCURRENT_LOG ERROR] ' + error.toString());
    }
  }
};

// ===== WRAPPER FUNCTIONS WITH MONITORING =====

function saveRPDEnhancedWithMonitoring(data) {
  const startTime = new Date().getTime();
  const lockKey = 'RPD_' + data.kua + '_' + data.month + '_' + data.year;
  
  const lock = acquireLock(lockKey, 30);
  PerformanceMonitor.logConcurrentAccess('saveRPD', data.kua, lock !== null);
  
  if (!lock) {
    PerformanceMonitor.logOperation('saveRPD', data.kua, startTime, false);
    return errorResponse('Sistem sedang sibuk, silakan coba lagi');
  }
  
  try {
    const result = saveRPDEnhanced(data);
    PerformanceMonitor.logOperation('saveRPD', data.kua, startTime, result.success);
    return result;
  } finally {
    releaseLock(lock);
  }
}

function saveRealisasiEnhancedWithMonitoring(data) {
  const startTime = new Date().getTime();
  const lockKey = 'REALISASI_' + data.kua + '_' + data.month + '_' + data.year;
  
  const lock = acquireLock(lockKey, 30);
  PerformanceMonitor.logConcurrentAccess('saveRealisasi', data.kua, lock !== null);
  
  if (!lock) {
    PerformanceMonitor.logOperation('saveRealisasi', data.kua, startTime, false);
    return errorResponse('Sistem sedang sibuk, silakan coba lagi');
  }
  
  try {
    const result = saveRealisasiEnhanced(data);
    PerformanceMonitor.logOperation('saveRealisasi', data.kua, startTime, result.success);
    return result;
  } finally {
    releaseLock(lock);
  }
}

// ===== EXPORT ENHANCED FUNCTIONS =====
// These will be called from handleBOPActionEnhanced in code-main.gs