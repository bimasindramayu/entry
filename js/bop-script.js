// ===== BOP SCRIPT =====

// ─── DocumentPreviewer (injected at runtime) ─────────────────────────────────
// CSS & JS diambil dari Google Apps Script webApp (bop-dashboard.html menyertakan)
// Inisialisasi previewer khusus verifikasi (lazy, dibuat sekali)
function _getVfyPreviewer() {
    if (window._dpVfyInstance) return window._dpVfyInstance;
    if (typeof DocumentPreviewer === 'undefined') return null;
    window._dpVfyInstance = new DocumentPreviewer({
        googleDriveApiKey : (function() {
            const _cfg = (typeof getLocalCache === 'function') ? getLocalCache('config') : null;
            if (_cfg && _cfg.DRIVE_API_KEY) return _cfg.DRIVE_API_KEY;
            if (typeof MY_DP_CONFIG !== 'undefined' && MY_DP_CONFIG.googleDriveApiKey) return MY_DP_CONFIG.googleDriveApiKey;
            if (typeof GOOGLE_DRIVE_API_KEY !== 'undefined') return GOOGLE_DRIVE_API_KEY;
            return '';
        })(),
        modalId : 'dp-modal-vfy',
        pdfScale: 1.5,
        debug   : false,
        onClose : function() {
            document.querySelectorAll('._dpVfyFileItem.dp-active')
                    .forEach(function(el){ el.classList.remove('dp-active'); });
            // Switch left panel back to centered modal when preview is closed
            if (typeof window._vfySwitchToCenter === 'function') {
                window._vfySwitchToCenter();
            }
        }
    });
    requestAnimationFrame(function() {
        const dpEl = document.getElementById('dp-modal-vfy');
        const dpHeader = document.getElementById('dp-modal-vfy-header');
        const dpContainer = document.getElementById('dp-modal-vfy-container');
        const dpControls = dpEl ? dpEl.querySelector('.dp-controls') : null;
        [dpEl, dpHeader, dpContainer, dpControls].forEach(function(el) {
            if (el) el.style.setProperty('--dp-width', '58%', 'important');
        });
    });
    window._dpVfyInstance.mount();
    return window._dpVfyInstance;
}
// ─────────────────────────────────────────────────────────────────────────────

// Inisialisasi previewer khusus untuk modal "Lihat" Realisasi (Operator KUA).
// Instance terpisah dari _dpVfyInstance supaya tidak saling bentrok konfigurasi/DOM.
function _getViewPreviewer() {
    if (window._dpViewInstance) return window._dpViewInstance;
    if (typeof DocumentPreviewer === 'undefined') return null;
    window._dpViewInstance = new DocumentPreviewer({
        googleDriveApiKey : (function() {
            const _cfg = (typeof getLocalCache === 'function') ? getLocalCache('config') : null;
            if (_cfg && _cfg.DRIVE_API_KEY) return _cfg.DRIVE_API_KEY;
            if (typeof MY_DP_CONFIG !== 'undefined' && MY_DP_CONFIG.googleDriveApiKey) return MY_DP_CONFIG.googleDriveApiKey;
            if (typeof GOOGLE_DRIVE_API_KEY !== 'undefined') return GOOGLE_DRIVE_API_KEY;
            return '';
        })(),
        modalId : 'dp-modal-view',
        pdfScale: 1.5,
        debug   : false,
        onClose : function() {
            document.querySelectorAll('._dpViewFileItem.dp-active')
                    .forEach(function(el){ el.classList.remove('dp-active'); });
            // Switch left panel back to centered modal when preview is closed
            if (typeof window._viewRlsSwitchToCenter === 'function') {
                window._viewRlsSwitchToCenter();
            }
        }
    });
    requestAnimationFrame(function() {
        const dpEl = document.getElementById('dp-modal-view');
        const dpHeader = document.getElementById('dp-modal-view-header');
        const dpContainer = document.getElementById('dp-modal-view-container');
        const dpControls = dpEl ? dpEl.querySelector('.dp-controls') : null;
        [dpEl, dpHeader, dpContainer, dpControls].forEach(function(el) {
            if (el) el.style.setProperty('--dp-width', '58%', 'important');
        });
    });
    window._dpViewInstance.mount();
    return window._dpViewInstance;
}
// ─────────────────────────────────────────────────────────────────────────────

// File: bop-script.js
// Untuk: bop-dashboard.html
// Config & utilities dari config.js

// ===== STATUS CONSTANTS & BACKWARD COMPATIBILITY =====
// Mapping status lama → baru untuk backward compatibility
const STATUS = {
  WAITING:  'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID:     'Paid'
};

/**
 * Normalize status lama ke nilai baru.
 * Data lama: 'Pending', 'Menunggu', 'Menunggu Verifikasi', 'Diterima', 'Ditolak'
 * Data baru: 'Waiting', 'Approved', 'Rejected', 'Paid'
 * @param {string} status
 * @returns {string}
 */
function normalizeStatus(status) {
  const map = {
    'Pending':             STATUS.WAITING,
    'Menunggu':            STATUS.WAITING,
    'Menunggu Verifikasi': STATUS.WAITING,
    'Waiting':             STATUS.WAITING,
    'Diterima':            STATUS.APPROVED,
    'Approved':            STATUS.APPROVED,
    'Ditolak':             STATUS.REJECTED,
    'Rejected':            STATUS.REJECTED,
    'Paid':                STATUS.PAID
  };
  return map[status] || STATUS.WAITING;
}

/**
 * Get badge class berdasarkan status
 * @param {string} status
 * @returns {string}
 */
function getStatusBadgeClass(status) {
  const s = normalizeStatus(status);
  if (s === STATUS.APPROVED) return 'success';
  if (s === STATUS.REJECTED) return 'danger';
  if (s === STATUS.PAID)     return 'info';
  return 'warning'; // Waiting
}

/**
 * Get label tampilan berdasarkan status
 * @param {string} status
 * @returns {string}
 */
function getStatusLabel(status) {
  return normalizeStatus(status);
}

// ===== STATE MANAGEMENT =====
let currentUser = null;
let currentPage = 'dashboardPage';
let editingBudget = null;

let uploadedFiles = [];
let uploadConfig = {
    maxFiles: 10,
    maxFileSize: 10  // MB
};

// ✅ LOCAL CACHE - persisten selama session, tidak ada timeout
const localCache = {
    budgets: null,
    rpds: null,
    realisasis: null,
    dashboardStats: null,
    verifikasi: null,
    riwayat: null,
    lastUpdate: {}
};

// ✅ Function untuk update cache dengan data baru
function updateLocalCache(key, data) {
    localCache[key] = data;
    localCache.lastUpdate[key] = Date.now();
    console.log(`[LOCAL_CACHE] Updated ${key} at ${new Date().toLocaleTimeString()}`);
}

// ✅ Function untuk get cache
function getLocalCache(key) {
    if (localCache[key]) {
        console.log(`[LOCAL_CACHE] Using cached ${key}`);
        return localCache[key];
    }
    console.log(`[LOCAL_CACHE] No cache for ${key}`);
    return null;
}

// ✅ Function untuk clear specific cache
function clearLocalCache(key) {
    if (key) {
        localCache[key] = null;
        delete localCache.lastUpdate[key];
        console.log(`[LOCAL_CACHE] Cleared ${key}`);
    } else {
        // Clear all
        Object.keys(localCache).forEach(k => {
            if (k !== 'lastUpdate') {
                localCache[k] = null;
            }
        });
        localCache.lastUpdate = {};
        console.log(`[LOCAL_CACHE] Cleared ALL cache`);
    }
}

// Replace function startRealisasiPolling: 
function startRealisasiPolling() {
    // ✅ Check config dari window.CACHE_CONFIG
    if (!window.CACHE_CONFIG || !window.CACHE_CONFIG.AUTO_REFRESH_ENABLED) {
        console.log('[POLL] Auto-refresh disabled in config');
        return;
    }
    
    // ✅ Stop any existing poller first
    if (realisasiStatusPoller) {
        clearInterval(realisasiStatusPoller);
        realisasiStatusPoller = null;
    }
    
    if (currentPage === 'realisasiPage') {
        realisasiStatusPoller = setInterval(async () => {
            console.log('[POLL] Checking realisasi status...');
            await loadRealisasis(true);
        }, window.CACHE_CONFIG.AUTO_REFRESH_INTERVAL);
        
        console.log('[POLL] Started with interval:', window.CACHE_CONFIG.AUTO_REFRESH_INTERVAL);
    }
}

// Replace function getCache:
function getCache(cacheKey) {
    // ✅ Check config dari window.CACHE_CONFIG
    if (!window.CACHE_CONFIG || !window.CACHE_CONFIG.ENABLED) {
        console.log(`[CACHE] Cache disabled in config`);
        return null;
    }
    
    if (isCacheValid(cacheKey)) {
        console.log(`[CACHE] Using cached data for ${cacheKey}`);
        return dataCache[cacheKey].data;
    }
    console.log(`[CACHE] Cache MISS for ${cacheKey}`);
    return null;
}

// Replace function setCache:
function setCache(cacheKey, data) {
    // ✅ Check config dari window.CACHE_CONFIG
    if (!window.CACHE_CONFIG || !window.CACHE_CONFIG.ENABLED) {
        console.log(`[CACHE] Cache disabled, not storing ${cacheKey}`);
        return;
    }
    
    dataCache[cacheKey] = {
        ...dataCache[cacheKey],
        data: data,
        timestamp: Date.now()
    };
    console.log(`[CACHE] Set cache for ${cacheKey}`);
}

// ===== INITIALIZATION =====
window.addEventListener('DOMContentLoaded', function() {
    debugLog('BOP', 'Initializing BOP Dashboard');
    
    // Check authentication
    currentUser = SessionManager.getCurrentUser();
    
    if (!currentUser) {
        debugLog('BOP', 'No user session, redirecting to login');
        window.location.href = 'index.html';
        return;
    }
    
    // Initialize dashboard
    showDashboard();
});

// ✅ PRELOAD ALL DATA - dipanggil sekali saat dashboard pertama kali muncul
async function preloadAllData() {
    console.log('[PRELOAD] ========== PRELOADING ALL DATA START ==========');
    console.log('[PRELOAD] User:', currentUser.role, '-', currentUser.kua);
    
    showLoading();
    
    try {
        const currentYear = new Date().getFullYear();
        
        // ✅ Parallel fetch semua data sekaligus untuk performa maksimal
        const promises = [];
        
        // 1. Dashboard Stats
        promises.push(
            apiCall('getDashboardStats', { 
                year: currentYear,
                kua: currentUser.kua,
                role: currentUser.role
            }).then(data => {
                updateLocalCache('dashboardStats', data);
                console.log('[PRELOAD] ✅ Dashboard stats loaded');
                return data;
            })
        );
        
        // 2. Budgets
        if (currentUser.role === 'Admin') {
            promises.push(
                apiCall('getBudgets', { year: currentYear }).then(data => {
                    updateLocalCache('budgets', data);
                    console.log('[PRELOAD] ✅ Budgets loaded:', data.length);
                    return data;
                })
            );
        } else {
            promises.push(
                apiCall('getBudgets', { kua: currentUser.kua }).then(data => {
                    updateLocalCache('budgets', data);
                    console.log('[PRELOAD] ✅ Budgets loaded:', data.length);
                    return data;
                })
            );
        }
        
        // 3. RPDs - ❌ DISABLED AUTO-LOAD untuk Admin (harus manual click Load Data)
        // CATATAN: Operator KUA tetap auto-load untuk kemudahan akses
        if (currentUser.role === 'Admin') {
            console.log('[PRELOAD] ⏭️  RPDs - SKIP (Admin harus klik Load Data)');
        } else {
            promises.push(
                apiCall('getRPDs', { 
                    kua: currentUser.kua, 
                    year: currentYear 
                }).then(data => {
                    updateLocalCache('rpds', sortByMonth(data));
                    console.log('[PRELOAD] ✅ RPDs loaded:', data.length);
                    return data;
                })
            );
        }
        
        // 4. Realisasis (untuk Operator KUA)
        if (currentUser.role === 'Operator KUA') {
            promises.push(
                apiCall('getRealisasis', { 
                    kua: currentUser.kua, 
                    year: currentYear 
                }).then(data => {
                    updateLocalCache('realisasis', sortByMonth(data));
                    console.log('[PRELOAD] ✅ Realisasis loaded:', data.length);
                    return data;
                })
            );
            
            // ✅ Preload config untuk Operator KUA juga (untuk button state)
            promises.push(
                apiCall('getRPDConfig').then(data => {
                    updateLocalCache('config', data);
                    console.log('[PRELOAD] ✅ RPD Config loaded for Operator');
                    return data;
                })
            );
        }
        
        // 5. Verifikasi - ❌ DISABLED AUTO-LOAD untuk Admin (harus manual click Load Data)
        if (currentUser.role === 'Admin') {
            console.log('[PRELOAD] ⏭️  Verifikasi - SKIP (Admin harus klik Load Data)');
            
            // ✅ FIX ISSUE #5: Preload RPD Config untuk Admin
            promises.push(
                apiCall('getRPDConfig').then(data => {
                    updateLocalCache('config', data);
                    console.log('[PRELOAD] ✅ RPD Config loaded');
                    return data;
                })
            );
        }
        
        // ✅ Wait for all data to load
        await Promise.all(promises);
        
        // ===== PRELOAD AP CONFIG & NOMINALS =====
        // Dilakukan SETELAH Promise.all agar data realisasi sudah tersedia.
        // Tujuan: saat user klik Lihat/Edit/Tambah Realisasi atau Verifikasi,
        // _apConfig dan _apNominals sudah ter-cache di sesi — TANPA API call tambahan.
        try {
            // Preload AP Config (untuk semua role)
            await apGetConfig();
            console.log('[PRELOAD] ✅ AP Config preloaded');
            
            // Preload AP Nominal untuk bulan-bulan yang ada di realisasi cache
            const _cachedReal = getLocalCache('realisasis') || [];
            const _monthKeys = new Set();
            _cachedReal.forEach(r => { if (r.month && r.year) _monthKeys.add(`${r.month}|${r.year}`); });
            
            // Preload SEMUA 12 bulan untuk tahun saat ini (agar Tambah Realisasi tidak hit API)
            const _now = new Date();
            const _curYear = _now.getFullYear();
            const _monthNames = ['Januari','Februari','Maret','April','Mei','Juni',
                                 'Juli','Agustus','September','Oktober','November','Desember'];
            // Tambah semua 12 bulan tahun ini
            _monthNames.forEach(m => _monthKeys.add(`${m}|${_curYear}`));
            
            const _nomPromises = [];
            _monthKeys.forEach(mk => {
                const [_m, _y] = mk.split('|');
                _nomPromises.push(apGetNominals(_m, parseInt(_y)));
            });
            await Promise.all(_nomPromises);
            console.log('[PRELOAD] ✅ AP Nominals preloaded for', _monthKeys.size, 'month(s) (all 12 months of', _curYear, ')');
        } catch (_apErr) {
            console.warn('[PRELOAD] AP preload error (non-fatal):', _apErr);
        }
        
        console.log('[PRELOAD] ========== ALL DATA LOADED SUCCESSFULLY ==========');
        console.log('[PRELOAD] Cache status:', {
            dashboardStats: !!localCache.dashboardStats,
            budgets: !!localCache.budgets,
            rpds: !!localCache.rpds,
            realisasis: !!localCache.realisasis,
            verifikasi: !!localCache.verifikasi,
            config: !!localCache.config
        });
        
    } catch (error) {
        console.error('[PRELOAD] Error loading data:', error);
        showNotification('Gagal memuat data: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function showDashboard() {
    console.log('[DASHBOARD] Showing dashboard for:', currentUser);
    
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
        dashboard.classList.add('active');
    }
    
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    
    if (userNameDisplay) userNameDisplay.textContent = currentUser.name;
    if (userRoleDisplay) userRoleDisplay.textContent = currentUser.role;
    
    populateYearFilters();
    buildNavMenu();
    
    // ✅ PRELOAD ALL DATA saat dashboard pertama kali muncul
    preloadAllData().then(() => {
        // Setelah preload selesai, tampilkan dashboard page
        currentPage = 'dashboardPage';
        showPage('dashboardPage');
    });
}

function populateYearFilters() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        years.push(i);
    }

    const yearOptions = years.map(year =>
        `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`
    ).join('');

    // Semua select ID yang perlu diisi dengan opsi tahun
    const yearSelectIds = [
        'dashboardYearFilter',
        'budgetYearFilter',
        'rpdYearFilter',
        'realisasiYearFilter',
        'verifikasiYearFilter',
        'apNominalYear',
        'exportRPDPerYearYear',
        'exportRPDDetailYear',
        'exportRealisasiPerYearYear',
        'exportRealisasiDetailYear',
        'fallbackPerYearYear',
        'fallbackDetailYear',
        'lapTahun'
    ];

    yearSelectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = yearOptions;
    });

    // Override onchange realisasiYearFilter agar fetch data baru
    const realisasiYearFilter = document.getElementById('realisasiYearFilter');
    if (realisasiYearFilter) {
        realisasiYearFilter.onchange = function() { loadRealisasisForYear(); };
    }

    // Verifikasi KUA Filter
    const verifikasiKUAFilter = document.getElementById('verifikasiKUAFilter');
    if (verifikasiKUAFilter) {
        verifikasiKUAFilter.innerHTML = '<option value="">Semua KUA</option>' +
            APP_CONFIG.KUA_LIST.map(kua => `<option value="${kua}">${kua}</option>`).join('');
    }

    const fallbackKua = document.getElementById('fallbackPerYearKua');
    if (fallbackKua) {
        fallbackKua.innerHTML = '<option value="">Semua KUA</option>' +
            APP_CONFIG.KUA_LIST.map(kua => `<option value="${kua}">${kua}</option>`).join('');
    }
}

function getMonthIndex(monthName) {
    return APP_CONFIG.MONTHS.indexOf(monthName);
}

function buildNavMenu() {
    console.log('[NAV] Building navigation menu');
    const navMenu = document.getElementById('navMenu');
    if (!navMenu) return;
    
    let menuItems = [];

    if (currentUser.role === 'Admin') {
        menuItems = [
            { id: 'dashboardPage', label: 'Dashboard' },
            { id: 'budgetingPage', label: 'Budget' },
            { id: 'rpdPage', label: 'Lihat RPD' },
            { id: 'verifikasiPage', label: 'Verifikasi' },
            { id: 'laporanPage', label: 'Laporan' },
            { id: 'autoPaymentPage', label: '⚡ Auto Payment' },
            { id: 'rpdConfigPage', label: 'Konfigurasi' }
        ];
    } else {
        menuItems = [
            { id: 'dashboardPage', label: 'Dashboard' },
            { id: 'rpdPage', label: 'RPD' },
            { id: 'realisasiPage', label: 'Realisasi' }
        ];
    }

    navMenu.innerHTML = `
        <ul>
            ${menuItems.map(item => `
                <li>
                    <button onclick="showPage('${item.id}')" id="nav-${item.id}">
                        ${item.label}
                    </button>
                </li>
            `).join('')}
        </ul>
    `;

    const firstNavBtn = document.getElementById('nav-dashboardPage');
    if (firstNavBtn) firstNavBtn.classList.add('active');
}

// ===== DATA CACHE MANAGEMENT =====
const dataCache = {
    budgets: { data: null, timestamp: null, ttl: 5 * 60 * 1000 }, // 5 menit
    users: { data: null, timestamp: null, ttl: 10 * 60 * 1000 }, // 10 menit
    rpds: { data: null, timestamp: null, ttl: 3 * 60 * 1000 }, // 3 menit
    realisasis: { data: null, timestamp: null, ttl: 2 * 60 * 1000 }, // 2 menit (lebih sering update)
    verifikasi: { data: null, timestamp: null, ttl: 1 * 60 * 1000 }, //1menit
    config: { data: null, timestamp: null, ttl: 15 * 60 * 1000 }, // 15 menit
    dashboardStats: { data: null, timestamp: null, ttl: 2 * 60 * 1000 } // 2 menit
};

function isCacheValid(cacheKey) {
    const cache = dataCache[cacheKey];
    if (!cache.data || !cache.timestamp) return false;
    return (Date.now() - cache.timestamp) < cache.ttl;
}




// Auto-refresh status realisasi setiap 30 detik jika ada yang pending
let realisasiStatusPoller = null;

// ✅ FIX: Store for realisasi objects to avoid embedding large data in HTML attributes
const realisasiDataStore = new Map();

// ✅ FIX: Same pattern as realisasiDataStore — avoids embedding raw JSON (with fields like
// filenames containing apostrophes, e.g. "BOP JUNI'26.pdf") directly inside onclick='...'
// attributes, which breaks the single-quoted attribute and throws
// "Uncaught SyntaxError: Invalid or unexpected token" when the button is clicked.
const rpdDataStore = new Map();
const budgetDataStore = new Map();
const userDataStore = new Map();

// ✅ FIX: Sanitize filename to prevent special characters issues
// Removes/replaces characters that can cause problems in HTML/JS
function sanitizeFileName(fileName) {
    if (!fileName) return fileName;
    
    // Get file extension
    const lastDot = fileName.lastIndexOf('.');
    const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    const ext = lastDot > 0 ? fileName.substring(lastDot) : '';
    
    // Replace problematic characters
    let sanitized = name
        .replace(/'/g, '') // Remove single quotes
        .replace(/"/g, '') // Remove double quotes
        .replace(/`/g, '') // Remove backticks
        .replace(/\\/g, '-') // Replace backslash
        .replace(/\//g, '-') // Replace forward slash
        .replace(/[<>:"|?*]/g, '') // Remove Windows forbidden chars
        .replace(/\s+/g, '_') // Replace spaces with underscore
        .replace(/[^\w\-_.]/g, '') // Remove other special chars except dash, underscore, dot
        .replace(/_+/g, '_') // Replace multiple underscores with single
        .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
    
    // Limit length (keep it reasonable)
    if (sanitized.length > 100) {
        sanitized = sanitized.substring(0, 100);
    }
    
    // Add timestamp prefix to ensure uniqueness
    const timestamp = Date.now();
    const sanitizedFull = `${timestamp}_${sanitized}${ext}`;
    
    console.log('[SANITIZE] Original:', fileName, '→ Sanitized:', sanitizedFull);
    
    return sanitizedFull;
}

function stopRealisasiPolling() {
    if (realisasiStatusPoller) {
        clearInterval(realisasiStatusPoller);
        realisasiStatusPoller = null;
        console.log('[POLL] Stopped realisasi polling');
    }
}

function navigateTo(pageId) {
    console.log('[PAGE] Navigating to:', pageId);
    
    // ✅ Stop polling saat pindah page
    stopRealisasiPolling();
    
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
        currentPage = pageId;
        
        // Load page data
        switch(pageId) {
            case 'dashboardPage':
                loadDashboardStats();
                break;
            case 'budgetPage':
                if (currentUser.role === 'Admin') {
                    loadBudgets();
                }
                break;
            case 'rpdPage':
                loadRPDs();
                break;
            case 'realisasiPage':
                // ✅ FIX: Use cache (false) when navigating, data already preloaded
                loadRealisasis(false);
                // ✅ Start polling HANYA untuk halaman realisasi
                startRealisasiPolling();
                break;
            case 'verifikasiPage':
                if (currentUser.role === 'Admin') {
                    loadVerifikasi();
                }
                break;
        }
    }
}

function showPage(pageId) {
    console.log(`[PAGE] Navigating to: ${pageId}`);
    
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    
    // Remove active from all nav buttons
    document.querySelectorAll('.nav-menu button').forEach(btn => btn.classList.remove('active'));
    
    // Show selected page
    const selectedPage = document.getElementById(pageId);
    if (selectedPage) selectedPage.classList.add('active');
    
    // Add active to selected nav button
    const navButton = document.getElementById('nav-' + pageId);
    if (navButton) {
        navButton.classList.add('active');
    }
    
    currentPage = pageId;
    
    // Stop polling
    stopRealisasiPolling();
    stopVerifikasiAutoRefresh();
    
    // ===== RPD PAGE SETUP =====
    if (pageId === 'rpdPage') {
        const kuaFilter = document.getElementById('rpdKUAFilter');
        const btnCreateRPD = document.getElementById('btnCreateRPD');
        const thKUA = document.querySelectorAll('.th-kua');
        
        if (currentUser.role === 'Admin') {
            if (kuaFilter) {
                kuaFilter.style.display = 'block';
                kuaFilter.innerHTML = '<option value="">Semua KUA</option>' + 
                    APP_CONFIG.KUA_LIST.map(kua => `<option value="${kua}">${kua}</option>`).join('');
                console.log('[RPD] KUA filter populated');
            }
            if (btnCreateRPD) btnCreateRPD.style.display = 'none';
            thKUA.forEach(th => th.style.display = 'table-cell');
            
            // ❌ NO AUTO-LOAD untuk Admin
            console.log('[RPD] Admin - waiting for manual Load Data click');
        } else {
            // Operator
            if (kuaFilter) kuaFilter.style.display = 'none';
            if (btnCreateRPD) btnCreateRPD.style.display = 'inline-block';
            thKUA.forEach(th => th.style.display = 'none');
            
            // ✅ Tampilkan data langsung dari local cache yang sudah di-preload
            // saat Dashboard dibuka — TANPA API call
            const _cachedRPDs = getLocalCache('rpds');
            if (_cachedRPDs && _cachedRPDs.length > 0) {
                rawData.rpds = _cachedRPDs;
                console.log('[RPD] Operator - populated from preloaded cache:', _cachedRPDs.length, 'records');
                displayRPDsFiltered();
            } else {
                // Fallback: cache belum ada (hanya saat pertama kali sebelum preload selesai)
                console.log('[RPD] Operator - cache empty, loading from server...');
                loadRPDsWithFilters();
            }
        }
    }

    // ===== VERIFIKASI PAGE SETUP =====
    if (pageId === 'verifikasiPage') {
        // Populate KUA filter
        const verifikasiKUAFilter = document.getElementById('verifikasiKUAFilter');
        if (verifikasiKUAFilter) {
            verifikasiKUAFilter.innerHTML = '<option value="">Semua KUA</option>' +
                APP_CONFIG.KUA_LIST.map(kua => `<option value="${kua}">${kua}</option>`).join('');
            console.log('[VERIFIKASI] KUA filter populated');
        }
        
        if (currentUser.role === 'Admin') {
            // ❌ NO AUTO-LOAD untuk Admin
            console.log('[VERIFIKASI] Admin - waiting for manual Load Data click');
            startVerifikasiAutoRefresh();
        }
    }
    
    // ===== REALISASI PAGE SETUP =====
    if (pageId === 'realisasiPage') {
        loadRealisasis(false);
        if (currentUser.role === 'Operator KUA') {
            startRealisasiPolling();
            updateRealisasiButtonState();
        }
    }
    
    // ===== BUDGETING PAGE SETUP =====
    if (pageId === 'budgetingPage') {
        loadBudgets(false);
    }
    
    // ===== DASHBOARD PAGE SETUP =====
    if (pageId === 'dashboardPage') {
        loadDashboardStats();
    }
    
    // ===== RPD CONFIG PAGE SETUP =====
    if (pageId === 'rpdConfigPage') {
        loadRPDConfig(false);
    }
    
    // ===== AUTO PAYMENT PAGE SETUP =====
    if (pageId === 'autoPaymentPage') {
        initAutoPaymentPage();
    }
}

// ✅ Helper: sesuaikan totalRealisasi di objek stats dengan nilai include-AP
// untuk Operator KUA. Admin tidak diubah.
function _adjustStatsWithAP(stats) {
    if (!currentUser || currentUser.role === 'Admin' || !_apConfig) return stats;

    const cachedRealisasis = getLocalCache('realisasis') || [];
    const yearFilter = document.getElementById('dashboardYearFilter');
    const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();

    const approvedPaid = cachedRealisasis.filter(r => {
        const s = normalizeStatus(r.status);
        return r.year == year && (s === STATUS.APPROVED || s === STATUS.PAID);
    });

    if (approvedPaid.length === 0) return stats; // tidak ada data → jangan ubah

    const includeTotal = _calcIncludeApTotal(approvedPaid);
    console.log('[DASHBOARD] totalRealisasi adjusted (include AP):', includeTotal);

    // Kembalikan objek baru agar cache asli tidak termodifikasi
    return Object.assign({}, stats, {
        totalRealisasi: includeTotal,
        realisasi: includeTotal
    });
}

// ✅ Helper: hitung include-AP total dari list realisasi (sync, pakai cache _apNominals)
function _calcIncludeApTotal(realisasiList) {
    if (!realisasiList || realisasiList.length === 0) return 0;
    let total = 0;
    realisasiList.forEach(r => {
        const nomKey  = `${r.month}_${r.year}`;
        const nomData = _apNominals[nomKey] || {};
        const kuaNom  = (nomData && nomData[r.kua]) ? nomData[r.kua] : {};
        const { include } = apCalcTotals([r], _apConfig, { [r.kua]: kuaNom });
        total += include;
    });
    return total;
}

async function loadDashboardStats(forceRefresh = false) {
    console.log('[DASHBOARD] Loading stats', { forceRefresh });
    
    // ✅ ALWAYS cek cache dulu
    const cachedData = getLocalCache('dashboardStats');
    if (cachedData && !forceRefresh) {
        console.log('[DASHBOARD] Using cached stats - NO SERVER CALL');
        displayDashboardStats(_adjustStatsWithAP(cachedData));
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[DASHBOARD] Fetching from server...');
        // ❌ NO LOADING SPINNER
        
        try {
            const yearFilter = document.getElementById('dashboardYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            const stats = await apiCall('getDashboardStats', { 
                year: year,
                kua: currentUser.kua,
                role: currentUser.role
            });
            
            console.log('[DASHBOARD] Stats received from server:', stats);
            
            // ✅ FIX #2: Enrich stats dengan rejectedCount & totalRealisasiCount dari cache
            // (server lama mungkin belum mengembalikan field ini)
            const _cachedVerif = getLocalCache('realisasis') || getLocalCache('verifikasi') || [];
            if (_cachedVerif.length > 0) {
                const _yearFilter2 = document.getElementById('dashboardYearFilter');
                const _year2 = _yearFilter2 ? parseInt(_yearFilter2.value) : new Date().getFullYear();
                const _yearData = _cachedVerif.filter(r => r.year == _year2);
                if (_yearData.length > 0) {
                    stats.realisasiRejected  = _yearData.filter(r => normalizeStatus(r.status) === STATUS.REJECTED).length;
                    stats.totalRealisasiCount = _yearData.length;
                    stats.totalRealisasiAllNominal = _yearData.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
                }
            }
            
            // ✅ Update local cache
            updateLocalCache('dashboardStats', stats);
            displayDashboardStats(_adjustStatsWithAP(stats));
        } catch (error) {
            console.error('[DASHBOARD ERROR]', error);
            showNotification('Gagal memuat statistik dashboard', 'error');
        }
    }
}

function displayDashboardStats(stats) {
    console.log('[DASHBOARD] Displaying stats:', stats);
    
    // ✅ FIX: Normalisasi semua numeric values dengan fallback
    const budget = parseFloat(stats.budget) || parseFloat(stats.totalBudget) || 0;
    const totalRPD = parseFloat(stats.totalRPD) || parseFloat(stats.pagu) || 0;
    // totalRealisasi sudah di-adjust include AP oleh caller (loadDashboardStats / updateDashboardFromCache)
    const totalRealisasi = parseFloat(stats.totalRealisasi) || parseFloat(stats.realisasi) || 0;
    const sisaBudget = budget - totalRealisasi;
    
    // ✅ FIX: Handle pending/waiting count — terima semua field yang mungkin
    const waitingCount   = parseInt(stats.realisasiWaiting) || parseInt(stats.pendingVerifikasi) || parseInt(stats.menungguVerifikasi) || 0;
    const approvedCount  = parseInt(stats.realisasiApproved) || 0;
    const rejectedCount  = parseInt(stats.realisasiRejected) || 0;
    const paidCount      = parseInt(stats.realisasiPaid) || 0;
    // Total semua realisasi (semua status)
    const totalRealisasiCount      = parseInt(stats.totalRealisasiCount) || (waitingCount + approvedCount + rejectedCount + paidCount);
    const totalRealisasiAllNominal = parseFloat(stats.totalRealisasiAllNominal) || 0;
    
    console.log('[DASHBOARD] Normalized values:', { 
        budget, 
        totalRPD, 
        totalRealisasi, 
        sisaBudget,
        waitingCount,
        approvedCount,
        paidCount
    });
    
    let statsHtml = '';
    
    if (currentUser.role === 'Admin') {
        // ✅ Admin Dashboard
        statsHtml = `
            <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-info">
                    <div class="stat-label">Total Budget</div>
                    <div class="stat-value">${formatCurrency(budget)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-info">
                    <div class="stat-label">Total RPD</div>
                    <div class="stat-value">${formatCurrency(totalRPD)}</div>
                </div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">✅</div>
                <div class="stat-info">
                    <div class="stat-label">Total Realisasi (Approved)</div>
                    <div class="stat-value">${formatCurrency(totalRealisasi)}</div>
                </div>
            </div>
            <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #138496 100%);">
                <div class="stat-icon">💵</div>
                <div class="stat-info">
                    <div class="stat-label">Total Realisasi All Status</div>
                    <div class="stat-value">${formatCurrency(totalRealisasiAllNominal)}</div>
                </div>
            </div>
            <div class="stat-card" style="background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%);">
                <div class="stat-icon">📋</div>
                <div class="stat-info">
                    <div class="stat-label">Semua Realisasi</div>
                    <div class="stat-value">${totalRealisasiCount} Realisasi</div>
                    <div style="font-size:15px; opacity:0.85; margin-top:4px;">
                        ⏳${waitingCount} &nbsp;✅${approvedCount} &nbsp;❌${rejectedCount} &nbsp;💰${paidCount}
                    </div>
                </div>
            </div>
        `;
    } else {
        // ✅ Operator Dashboard
        statsHtml = `
            <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-info">
                    <div class="stat-label">Budget Tahunan</div>
                    <div class="stat-value">${formatCurrency(budget)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-info">
                    <div class="stat-label">Total RPD</div>
                    <div class="stat-value">${formatCurrency(totalRPD)}</div>
                </div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">✅</div>
                <div class="stat-info">
                    <div class="stat-label">Total Realisasi (Approved)</div>
                    <div class="stat-value">${formatCurrency(totalRealisasi)}</div>
                </div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">⏳</div>
                <div class="stat-info">
                    <div class="stat-label">Menunggu Verifikasi</div>
                    <div class="stat-value">${waitingCount} Realisasi</div>
                </div>
            </div>
            <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #138496 100%);">
                <div class="stat-icon">💵</div>
                <div class="stat-info">
                    <div class="stat-label">Total Paid</div>
                    <div class="stat-value">${paidCount} Realisasi</div>
                </div>
            </div>
            <div class="stat-card ${sisaBudget >= 0 ? '' : 'danger'}">
                <div class="stat-icon">💵</div>
                <div class="stat-info">
                    <div class="stat-label">Sisa Budget</div>
                    <div class="stat-value">${formatCurrency(sisaBudget)}</div>
                </div>
            </div>
        `;
    }
    
    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        statsGrid.innerHTML = statsHtml;
    }
}

// ⭐ NEW: Update dashboard stats by calculating from cache (no API call)
function updateDashboardFromCache() {
    console.log('[DASHBOARD] Recalculating stats from cache - NO API CALL');
    
    try {
        const cachedBudgets = getLocalCache('budgets');
        const cachedRPDs = getLocalCache('rpds');
        const cachedRealisasi = getLocalCache('realisasis');
        
        if (!cachedBudgets || cachedBudgets.length === 0) {
            console.warn('[DASHBOARD] No budget in cache, cannot recalculate');
            return;
        }
        
        // Calculate from cache
        const budget = cachedBudgets[0];
        const budgetTotal = parseFloat(budget.total) || parseFloat(budget.budget) || 0;
        
        // Calculate total RPD from cache
        const currentYear = new Date().getFullYear();
        const filteredRPDs = cachedRPDs ? cachedRPDs.filter(r => {
            const yearMatch = r.year == currentYear;
            const kuaMatch = currentUser.role === 'Admin' || r.kua === currentUser.kua;
            return yearMatch && kuaMatch;
        }) : [];
        
        const totalRPD = filteredRPDs.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
        
        // Calculate total realisasi from cache
        const filteredRealisasi = cachedRealisasi ? cachedRealisasi.filter(r => {
            const yearMatch = r.year == currentYear;
            const kuaMatch = currentUser.role === 'Admin' || r.kua === currentUser.kua;
            return yearMatch && kuaMatch;
        }) : [];
        
        const totalRealisasi = (() => {
            const approvedPaid = filteredRealisasi.filter(r =>
                normalizeStatus(r.status) === STATUS.APPROVED || normalizeStatus(r.status) === STATUS.PAID
            );
            // ✅ Operator KUA: gunakan Include AutoPayment via helper
            if (currentUser && currentUser.role !== 'Admin' && _apConfig && approvedPaid.length > 0) {
                return _calcIncludeApTotal(approvedPaid);
            }
            return approvedPaid.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
        })();
        
        // Count status breakdown
        const waitingCount  = filteredRealisasi.filter(r => normalizeStatus(r.status) === STATUS.WAITING).length;
        const approvedCount = filteredRealisasi.filter(r => normalizeStatus(r.status) === STATUS.APPROVED).length;
        const rejectedCount = filteredRealisasi.filter(r => normalizeStatus(r.status) === STATUS.REJECTED).length;
        const paidCount     = filteredRealisasi.filter(r => normalizeStatus(r.status) === STATUS.PAID).length;
        const totalRealisasiCount = filteredRealisasi.length;

        // Total nominal semua realisasi (semua status)
        const totalRealisasiAllNominal = filteredRealisasi.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
        
        const calculatedStats = {
            budget: budgetTotal,
            totalBudget: budgetTotal,
            totalRPD: totalRPD,
            pagu: totalRPD,
            totalRealisasi: totalRealisasi,
            realisasi: totalRealisasi,
            realisasiWaiting: waitingCount,
            pendingVerifikasi: waitingCount,
            menungguVerifikasi: waitingCount,
            realisasiApproved: approvedCount,
            realisasiRejected: rejectedCount,
            realisasiPaid: paidCount,
            totalRealisasiCount: totalRealisasiCount,
            totalRealisasiAllNominal: totalRealisasiAllNominal
        };
        
        console.log('[DASHBOARD] Calculated stats from cache:', calculatedStats);
        
        // Display the calculated stats
        displayDashboardStats(calculatedStats);
        
    } catch (error) {
        console.error('[DASHBOARD] Error recalculating from cache:', error);
    }
}

// ===== BUDGET MANAGEMENT =====
async function loadBudgets(forceRefresh = false) {
    console.log('[BUDGET] Loading budgets', { forceRefresh });
    
    // ✅ ALWAYS cek cache dulu
    const cachedData = getLocalCache('budgets');
    if (cachedData && !forceRefresh) {
        console.log('[BUDGET] Using cached data - NO SERVER CALL');
        displayBudgets(cachedData);
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[BUDGET] Fetching from server...');
        // ❌ NO LOADING SPINNER
        
        try {
            const yearFilter = document.getElementById('budgetYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            const budgets = await apiCall('getBudgets', { year: year });
            
            // ✅ Update local cache
            updateLocalCache('budgets', budgets);
            displayBudgets(budgets);
        } catch (error) {
            console.error('[BUDGET ERROR]', error);
        }
    }
}

function displayBudgets(budgets) {
    const tbody = document.querySelector('#budgetTable tbody');
    
    // ✅ FIX: Pastikan semua field numeric ada dan valid
    tbody.innerHTML = budgets.map((budget, index) => {
        const budgetTotal = parseFloat(budget.total) || parseFloat(budget.budget) || 0;
        const totalRPD = parseFloat(budget.totalRPD) || parseFloat(budget.pagu) || 0;
        const totalRealisasi = parseFloat(budget.totalRealisasi) || parseFloat(budget.realisasi) || 0;
        const sisaBudget = budgetTotal - totalRealisasi;
        
        // ✅ FIX: Store budget in Map and pass only ID to avoid token errors
        const budgetId = budget.id || `temp-budget-${Date.now()}-${index}`;
        budgetDataStore.set(budgetId, budget);
        
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${budget.kua}</td>
            <td>${budget.year}</td>
            <td>${formatCurrency(budgetTotal)}</td>
            <td>${formatCurrency(totalRPD)}</td>
            <td>${formatCurrency(totalRealisasi)}</td>
            <td>${formatCurrency(sisaBudget)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="editBudget('${budgetId}')">Edit</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function showBudgetModal(budget = null) {
    console.log('[BUDGET MODAL]', budget);
    
    editingBudget = budget;
    
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    const currentYear = new Date().getFullYear();
    const budgetTotal = budget ? (parseFloat(budget.total) || parseFloat(budget.budget) || 0) : 0;
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${budget ? 'Edit Budget' : 'Tambah Budget'}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <form id="budgetForm">
                <div class="form-group">
                    <label>Pilih KUA</label>
                    <select id="budgetKUA" required ${budget ? 'disabled' : ''}>
                        <option value="">-- Pilih KUA --</option>
                        ${APP_CONFIG.KUA_LIST.map(kua => `
                            <option value="${kua}" ${budget && budget.kua === kua ? 'selected' : ''}>${kua}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Tahun Anggaran</label>
                    <select id="budgetYear" required ${budget ? 'disabled' : ''}>
                        ${Array.from({length: 7}, (_, i) => currentYear - 5 + i).map(year => `
                            <option value="${year}" ${budget && budget.year == year ? 'selected' : year === currentYear ? 'selected' : ''}>${year}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Budget Tahunan (Rp)</label>
                    <input type="text" 
                           id="budgetAmount" 
                           class="auto-format-number"
                           required 
                           value="${budgetTotal}" 
                           placeholder="0">
                    <small style="color: #666;">Otomatis terformat dengan separator ribuan</small>
                </div>
                <button type="submit" class="btn">Simpan</button>
            </form>
        </div>
    `;
    
    modal.classList.add('active');
    
    // ✅ Setup auto-format
    setTimeout(() => {
        setupAllAutoFormatInputs('.auto-format-number');
    }, 100);
    
    document.getElementById('budgetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const budgetInput = document.getElementById('budgetAmount');
        // ✅ Parse formatted value
        const rawValue = parseFormattedNumber(budgetInput.value);
        
        const budgetData = {
            id: editingBudget?.id,
            kua: document.getElementById('budgetKUA').value,
            year: parseInt(document.getElementById('budgetYear').value),
            total: rawValue
        };
        
        console.log('[BUDGET FORM] Submitting:', budgetData);
        
        try {
            await apiCall('saveBudget', budgetData);
            showNotification('Budget berhasil disimpan', 'success');
            
            editingBudget = null;
            closeModal();
            
            clearLocalCache('budgets');
            clearLocalCache('dashboardStats');
            
            await Promise.all([
                loadBudgets(true),
                loadDashboardStats(true)
            ]);
            
        } catch (error) {
            console.error('[BUDGET FORM ERROR]', error);
            showNotification(error.message || 'Gagal menyimpan budget', 'error');
        }
    });
}

function editBudget(budgetId) {
    // ✅ FIX: Retrieve budget from Map by ID (see displayBudgets)
    const budget = budgetDataStore.get(budgetId);
    
    if (!budget) {
        console.error('[BUDGET] Budget not found in store:', budgetId);
        showNotification('Data budget tidak ditemukan', 'error');
        return;
    }
    
    showBudgetModal(budget);
}

// ===== USER MANAGEMENT =====
async function loadUsers(forceRefresh = false) {
    console.log('[USER] Loading users');
    
    if (!forceRefresh) {
        const cachedData = getCache('users');
        if (cachedData) {
            displayUsers(cachedData);
            return;
        }
    }
    
    try {
        const users = await apiCall('getUsers');
        setCache('users', users);
        displayUsers(users);
    } catch (error) {
        console.error('[USER ERROR]', error);
    }
}

function displayUsers(users) {
    const tbody = document.querySelector('#userTable tbody');
    tbody.innerHTML = users.map((user, index) => {
        // ✅ FIX: Store user in Map and pass only ID to avoid token errors
        // (e.g. names containing an apostrophe, common in Arabic-transliterated names)
        const userId = user.id || `temp-user-${Date.now()}-${index}`;
        userDataStore.set(userId, user);
        
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${user.username}</td>
            <td>${user.name}</td>
            <td>${user.role}</td>
            <td>${user.kua || '-'}</td>
            <td><span class="badge badge-${user.status === 'Active' ? 'success' : 'danger'}">${user.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="editUser('${userId}')">Edit</button>
                    ${user.status === 'Active' ? `<button class="btn btn-danger btn-sm" onclick="deleteUserConfirm('${user.id}')">Nonaktifkan</button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function showUserModal(user = null) {
    console.log('[USER MODAL]', user);
    let modal = document.getElementById('modal');

    if (!modal) {

        modal = document.createElement('div');

        modal.id = 'modal';

        modal.className = 'modal';

        document.body.appendChild(modal);

    }
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${user ? 'Edit Pengguna' : 'Tambah Pengguna'}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <form id="userForm">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" id="userUsername" required value="${user ? user.username : ''}" ${user ? 'readonly' : ''}>
                </div>
                ${!user ? `
                <div class="form-group">
                    <label>Password</label>
                    <div class="password-input-group">
                        <input type="password" id="userPassword" required minlength="6">
                        <button type="button" class="password-toggle" onclick="togglePassword('userPassword')">👁️</button>
                    </div>
                </div>
                ` : ''}
                <div class="form-group">
                    <label>Nama Lengkap</label>
                    <input type="text" id="userName" required value="${user ? user.name : ''}">
                </div>
                <div class="form-group">
                    <label>Role</label>
                    <select id="userRole" required>
                        <option value="Admin" ${user && user.role === 'Admin' ? 'selected' : ''}>Admin</option>
                        <option value="Operator KUA" ${user && user.role === 'Operator KUA' ? 'selected' : ''}>Operator KUA</option>
                    </select>
                </div>
                <div class="form-group" id="kuaGroup" style="display: ${user && user.role === 'Operator KUA' || !user ? 'block' : 'none'}">
                    <label>KUA</label>
                    <select id="userKUA">
                        <option value="">-- Pilih KUA --</option>
                        ${APP_CONFIG.KUA_LIST.map(kua => `
                            <option value="${kua}" ${user && user.kua === kua ? 'selected' : ''}>${kua}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="userStatus">
                        <option value="Active" ${!user || user.status === 'Active' ? 'selected' : ''}>Aktif</option>
                        <option value="Inactive" ${user && user.status === 'Inactive' ? 'selected' : ''}>Nonaktif</option>
                    </select>
                </div>
                <button type="submit" class="btn">Simpan</button>
            </form>
        </div>
    `;
    
    modal.classList.add('active');
    
    document.getElementById('userRole').addEventListener('change', function() {
        document.getElementById('kuaGroup').style.display = this.value === 'Operator KUA' ? 'block' : 'none';
    });
    
    document.getElementById('userForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[USER] Saving user');
        
        const role = document.getElementById('userRole').value;
        const kua = document.getElementById('userKUA').value;
        
        if (role === 'Operator KUA' && !kua) {
            showNotification('Pilih KUA untuk Operator', 'warning');
            return;
        }
        
        try {
            await apiCall('saveUser', {
                id: user ? user.id : null,
                username: document.getElementById('userUsername').value,
                password: user ? null : document.getElementById('userPassword').value,
                name: document.getElementById('userName').value,
                role: role,
                kua: role === 'Operator KUA' ? kua : '',
                status: document.getElementById('userStatus').value,
                adminId: currentUser.id,
                adminUsername: currentUser.username
            });
            
            showNotification('Pengguna berhasil disimpan', 'success');
            closeModal();
            loadUsers();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}

async function saveBudget(data) {
    console.log('[SAVE_BUDGET] Starting save process');
    
    try {
        // Panggil API untuk save budget
        await apiCall('saveBudget', {
            id: data.id || null,
            kua: data.kua,
            year: data.year,
            budget: data.budget,
            userId: currentUser.id,
            username: currentUser.username
        });
        
        // ✅ STEP 1: Hapus cache yang terkait dengan budget
        console.log('[SAVE_BUDGET] Invalidating related cache');
        clearLocalCache('budgets');        // Hapus cache budgets
        clearLocalCache('dashboardStats'); // Hapus cache dashboard stats
        
        // ✅ STEP 2: Tutup modal
        closeModal();
        
        // ✅ STEP 3: Reload data dengan FORCE REFRESH (bypass cache)
        console.log('[SAVE_BUDGET] Reloading fresh data');
        await loadBudgets(true);           // true = force refresh dari server
        await loadDashboardStats(true);    // true = force refresh dari server
        
        // ✅ STEP 4: Tampilkan notifikasi sukses
        showNotification('Budget berhasil disimpan', 'success');
        
    } catch (error) {
        console.error('[SAVE_BUDGET ERROR]', error);
        showNotification(error.message, 'error');
    }
}

async function saveUser(data) {
    console.log('[SAVE_USER] Starting save process');
    
    try {
        const role = document.getElementById('userRole').value;
        const kua = document.getElementById('userKUA').value;
        
        if (role === 'Operator KUA' && !kua) {
            showNotification('Pilih KUA untuk Operator', 'warning');
            return;
        }
        
        // Panggil API untuk save user
        await apiCall('saveUser', {
            id: data ? data.id : null,
            username: document.getElementById('userUsername').value,
            password: data ? null : document.getElementById('userPassword').value,
            name: document.getElementById('userName').value,
            role: role,
            kua: role === 'Operator KUA' ? kua : '',
            status: document.getElementById('userStatus').value,
            adminId: currentUser.id,
            adminUsername: currentUser.username
        });
        
        // ✅ STEP 1: Hapus cache users
        console.log('[SAVE_USER] Invalidating users cache');
        clearLocalCache('users');
        
        // ✅ STEP 2: Tutup modal
        closeModal();
        
        // ✅ STEP 3: Reload data dengan FORCE REFRESH
        console.log('[SAVE_USER] Reloading fresh data');
        await loadUsers(true); // true = force refresh
        
        // ✅ STEP 4: Notifikasi
        showNotification('Pengguna berhasil disimpan', 'success');
        
    } catch (error) {
        console.error('[SAVE_USER ERROR]', error);
        showNotification(error.message, 'error');
    }
}

function editUser(userId) {
    // ✅ FIX: Retrieve user from Map by ID (see displayUsers)
    const user = userDataStore.get(userId);
    
    if (!user) {
        console.error('[USER] User not found in store:', userId);
        showNotification('Data pengguna tidak ditemukan', 'error');
        return;
    }
    
    showUserModal(user);
}

async function deleteUserConfirm(userId) {
    if (confirm('Yakin ingin menonaktifkan pengguna ini?')) {
        console.log('[DELETE_USER] Deleting user:', userId);
        
        try {
            await apiCall('deleteUser', {
                id: userId,
                adminId: currentUser.id,
                adminUsername: currentUser.username
            });
            
            // ✅ Hapus cache dan reload
            clearLocalCache('users');
            await loadUsers(true);
            
            showNotification('Pengguna berhasil dinonaktifkan', 'success');
        } catch (error) {
            console.error('[DELETE_USER ERROR]', error);
            showNotification(error.message, 'error');
        }
    }
}

// ===== RPD APP_CONFIG =====
// ✅ BARU — status centang checklist "Bulan Dibuka utk Edit RPD", diakses dari
// atribut onchange inline pada #rpdEditMonthsGrid (lihat displayRPDConfig / saveConfig).
let _rpdEditMonthsChecked = {};

async function loadRPDConfig(forceRefresh = false) {
    console.log('[CONFIG] Loading RPD & Realisasi config', { forceRefresh });
    
    // ✅ FIX ISSUE #5: Cek local cache dulu (sudah di-preload)
    const cachedData = getLocalCache('config');
    if (cachedData && !forceRefresh) {
        console.log('[CONFIG] Using cached config - NO SERVER CALL');
        displayRPDConfig(cachedData);
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[CONFIG] Fetching from server...');
        
        try {
            const config = await apiCall('getRPDConfig');
            console.log('[CONFIG] Config received from server:', config);
            
            // ✅ Update local cache
            updateLocalCache('config', config);
            
            displayRPDConfig(config);
        } catch (error) {
            console.error('[CONFIG ERROR]', error);
            showNotification('Gagal memuat konfigurasi', 'error');
        }
    }
}

function displayRPDConfig(config) {
    console.log('[CONFIG] Displaying config:', config);
    
    const rpdStatusEl = document.getElementById('rpdStatus');
    const realisasiStatusEl = document.getElementById('realisasiStatus');
    const maxFileSizeEl = document.getElementById('realisasiMaxFileSize');
    const maxFilesEl = document.getElementById('realisasiMaxFiles');
    
    if (rpdStatusEl) {
        rpdStatusEl.value = config.RPD_STATUS || 'open';
        console.log('[CONFIG] Set RPD Status to:', rpdStatusEl.value);
    } else {
        console.error('[CONFIG] rpdStatus element not found!');
    }
    
    if (realisasiStatusEl) {
        realisasiStatusEl.value = config.REALISASI_STATUS || 'open';
        console.log('[CONFIG] Set Realisasi Status to:', realisasiStatusEl.value);
    } else {
        console.error('[CONFIG] realisasiStatus element not found!');
    }
    
    if (maxFileSizeEl) {
        maxFileSizeEl.value = config.REALISASI_MAX_FILE_SIZE || '5';
        console.log('[CONFIG] Set Max File Size to:', maxFileSizeEl.value);
    } else {
        console.error('[CONFIG] realisasiMaxFileSize element not found!');
    }
    
    if (maxFilesEl) {
        maxFilesEl.value = config.REALISASI_MAX_FILES || '10';
        console.log('[CONFIG] Set Max Files to:', maxFilesEl.value);
    } else {
        console.error('[CONFIG] realisasiMaxFiles element not found!');
    }

    // ✅ BARU — Render checklist bulan (RPD_EDIT_OPEN_MONTHS): searchable,
    // custom checkbox (lihat .search-checklist-* di bop-styles.css).
    const monthsGrid = document.getElementById('rpdEditMonthsGrid');
    const monthsSearch = document.getElementById('rpdEditMonthsSearch');
    if (monthsGrid) {
        let openMonths = [];
        try { openMonths = JSON.parse(config.RPD_EDIT_OPEN_MONTHS || '[]'); } catch (e) { openMonths = []; }

        // Status centang per bulan disimpan di luar DOM supaya tidak hilang
        // ketika list difilter ulang oleh kotak pencarian.
        _rpdEditMonthsChecked = {};
        APP_CONFIG.MONTHS.forEach(m => { _rpdEditMonthsChecked[m] = openMonths.includes(m); });

        const renderMonthsList = (filterText) => {
            const q = (filterText || '').trim().toLowerCase();
            const visible = APP_CONFIG.MONTHS.filter(m => !q || m.toLowerCase().includes(q));
            monthsGrid.innerHTML = visible.length ? visible.map(m => `
                <label class="search-checklist-row">
                    <input type="checkbox" class="rpd-edit-month-cb" value="${m}"
                        ${_rpdEditMonthsChecked[m] ? 'checked' : ''}
                        onchange="_rpdEditMonthsChecked['${m}'] = this.checked">
                    <span class="search-checklist-box"></span>
                    <span class="search-checklist-label">${m}</span>
                </label>
            `).join('') : '<div class="search-checklist-empty">Bulan tidak ditemukan</div>';
        };

        renderMonthsList('');
        if (monthsSearch) {
            monthsSearch.value = '';
            monthsSearch.oninput = () => renderMonthsList(monthsSearch.value);
        }
        console.log('[CONFIG] Set RPD Edit Open Months to:', openMonths);
    } else {
        console.error('[CONFIG] rpdEditMonthsGrid element not found!');
    }
}

async function saveRPDConfig() {
    console.log('[SAVE_CONFIG] Starting save process');
    
    try {
        await apiCall('saveRPDConfig', {
            rpdStatus: document.getElementById('rpdStatus').value,
            realisasiStatus: document.getElementById('realisasiStatus').value,
            realisasiMaxFileSize: document.getElementById('realisasiMaxFileSize').value,
            realisasiMaxFiles: document.getElementById('realisasiMaxFiles').value,
            userId: currentUser.id,
            username: currentUser.username
        });
        
        // ✅ Hapus cache config
        console.log('[SAVE_CONFIG] Invalidating config cache');
        clearLocalCache('config');
        
        showNotification('Konfigurasi berhasil disimpan', 'success');
        
    } catch (error) {
        console.error('[SAVE_CONFIG ERROR]', error);
        showNotification(error.message, 'error');
    }
}

// ===== RPD MANAGEMENT =====
async function loadRPDs(forceRefresh = false) {
    console.log('[RPD] Loading RPDs', { forceRefresh });
    
    // ✅ ALWAYS cek cache dulu
    const cachedData = getLocalCache('rpds');
    if (cachedData && !forceRefresh) {
        console.log('[RPD] Using cached data - NO SERVER CALL');
        displayRPDs(cachedData);
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[RPD] Fetching from server...');
        // ❌ NO LOADING SPINNER
        
        try {
            const yearFilter = document.getElementById('rpdYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            let rpds;
            
            if (currentUser.role === 'Admin') {
                // ✅ Admin - Get all KUA RPDs
                rpds = await apiCall('getRPDs', { year: year });
                
                // ✅ FIX ISSUE #4: Apply KUA filter untuk Admin
                const kuaFilter = document.getElementById('rpdKUAFilter');
                if (kuaFilter && kuaFilter.value) {
                    const selectedKUA = kuaFilter.value;
                    console.log('[RPD] Filtering by KUA:', selectedKUA);
                    rpds = rpds.filter(rpd => rpd.kua === selectedKUA);
                }
            } else {
                // Operator - Get only own KUA
                rpds = await apiCall('getRPDs', { kua: currentUser.kua, year: year });
            }
            
            rpds = sortByMonth(rpds);
            
            // ✅ Update local cache
            updateLocalCache('rpds', rpds);
            displayRPDs(rpds);
        } catch (error) {
            console.error('[RPD ERROR]', error);
        }
    }
}

function displayRPDs(rpds) {
    const tbody = document.querySelector('#rpdTable tbody');
    const thKUA = document.querySelectorAll('.th-kua');
    
    // ✅ FIX: READ FILTER VALUE (termasuk bulan)
    const kuaFilter = document.getElementById('rpdKUAFilter');
    const monthFilter = document.getElementById('rpdMonthFilter');
    const yearFilter = document.getElementById('rpdYearFilter');
    
    const selectedKUA = kuaFilter ? kuaFilter.value : '';
    const selectedMonth = monthFilter ? monthFilter.value : '';
    const selectedYear = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
    
    console.log('[RPD] Displaying with filters:', {
        kua: selectedKUA,
        month: selectedMonth,
        year: selectedYear,
        role: currentUser.role
    });
    
    // ✅ APPLY FILTERS (termasuk bulan)
    let filteredData = rpds.filter(rpd => {
        let passKUA = !selectedKUA || rpd.kua === selectedKUA;
        let passMonth = !selectedMonth || rpd.month === selectedMonth;
        let passYear = !selectedYear || rpd.year == selectedYear;
        
        return passKUA && passMonth && passYear;
    });
    
    console.log('[RPD] Filtered from', rpds.length, 'to', filteredData.length, 'records');
    
    if (filteredData.length === 0) {
        const colSpan = currentUser.role === 'Admin' ? '7' : '6';
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center;">Belum ada data RPD</td></tr>`;
        return;
    }
    
    let totalNominal = 0;
    
    // ✅ FIX: Edit RPD memakai RPD_EDIT_OPEN_MONTHS, BUKAN RPD_STATUS.
    // RPD_STATUS hanya berlaku untuk tambah RPD baru (lihat showRPDModal).
    const _rpdCfg = getLocalCache('config');
    let _rpdEditOpenMonths = [];
    try { _rpdEditOpenMonths = JSON.parse((_rpdCfg && _rpdCfg.RPD_EDIT_OPEN_MONTHS) || '[]'); } catch (e) { _rpdEditOpenMonths = []; }

    const rows = filteredData.map((rpd, index) => {
        totalNominal += parseFloat(rpd.total || 0);
        
        // ✅ FIX: Store rpd in Map and pass only ID to avoid token errors
        // (raw JSON in onclick breaks if any text field contains an apostrophe)
        const rpdId = rpd.id || `temp-rpd-${Date.now()}-${index}`;
        rpdDataStore.set(rpdId, rpd);
        
        // ✅ KUA column visibility based on role
        const kuaColumn = currentUser.role === 'Admin' ? 
            `<td>${rpd.kua || '-'}</td>` : '';

        // ✅ FIX: Edit button mengikuti bulan yang dibuka Admin utk edit
        // (RPD_EDIT_OPEN_MONTHS) — sama persis dengan yang dicek server saat
        // submit, supaya tombol tidak pernah "kelihatan ada tapi ditolak".
        const _canEdit = currentUser.role !== 'Admin'
            && _rpdEditOpenMonths.includes(rpd.month);
        
        return `
        <tr>
            <td>${index + 1}</td>
            ${kuaColumn}
            <td>${rpd.month || '-'}</td>
            <td>${rpd.year || '-'}</td>
            <td>${formatCurrency(rpd.total || 0)}</td>
            <td>${rpd.createdAt ? formatDate(rpd.createdAt) : '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="viewRPD('${rpdId}')">Lihat</button>
                    ${_canEdit ? `<button class="btn btn-sm" onclick="editRPD('${rpdId}')">Edit</button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    const kuaTotalColumn = currentUser.role === 'Admin' ? '<td></td>' : '';
    
    const totalRow = `
        <tr style="background: #f8f9fa; font-weight: bold;">
            <td></td>
            ${kuaTotalColumn}
            <td colspan="2" style="text-align: right;">TOTAL:</td>
            <td>${formatCurrency(totalNominal)}</td>
            <td colspan="2"></td>
        </tr>
    `;
    
    tbody.innerHTML = rows + totalRow;
    console.log('[RPD] Displayed', filteredData.length, 'records, Total:', formatCurrency(totalNominal));
}

// Handler untuk filter KUA change (Admin only)
function onRPDKUAFilterChange() {
    console.log('[RPD] KUA filter changed');
    
    const cachedData = getCache('rpds');
    const kuaFilter = document.getElementById('rpdKUAFilter');
    const selectedKUA = kuaFilter ? kuaFilter.value : '';
    
    if (cachedData && selectedKUA === '') {
        // If "All KUA" selected and we have cache, use it
        displayRPDs(cachedData);
    } else {
        // Otherwise reload from server
        loadRPDs(true);
    }
}

// ===== NEW: Load RPDs with Filters Function =====
async function loadRPDsWithFilters() {
    console.log('[RPD] Loading RPDs with filters...');
    showLoading();
    
    try {
        const yearFilter = document.getElementById('rpdYearFilter');
        const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
        
        let rpds;
        
        if (currentUser.role === 'Admin') {
            // Admin - Get all KUA RPDs
            rpds = await apiCall('getRPDs', { year: year });
        } else {
            // Operator - Get only own KUA
            rpds = await apiCall('getRPDs', { kua: currentUser.kua, year: year });
        }
        
        rpds = sortByMonth(rpds);
        
        // Update local cache
        updateLocalCache('rpds', rpds);
        
        // Display dengan filter yang sudah dipilih
        displayRPDs(rpds);
        
        hideLoading();
        showNotification('Data RPD berhasil dimuat', 'success');
    } catch (error) {
        hideLoading();
        console.error('[RPD ERROR]', error);
        showNotification('Gagal memuat data RPD', 'error');
    }
}

// ===== NEW: Sort RPD Table Function =====
let rpdSortState = {
    column: -1,
    ascending: true
};

function sortRPDTable(columnIndex) {
    console.log('[RPD SORT] Sorting column', columnIndex);
    
    const tbody = document.querySelector('#rpdTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr:not(:last-child)')); // Exclude total row
    
    if (rows.length === 0 || (rows.length === 1 && rows[0].textContent.includes('Klik tombol'))) {
        return; // No data to sort
    }
    
    // Determine sort direction
    if (rpdSortState.column === columnIndex) {
        rpdSortState.ascending = !rpdSortState.ascending;
    } else {
        rpdSortState.column = columnIndex;
        rpdSortState.ascending = true;
    }
    
    // Adjust column index for Admin (has KUA column)
    let actualColumnIndex = columnIndex;
    if (currentUser.role === 'Admin' && columnIndex > 0) {
        actualColumnIndex = columnIndex;
    } else if (currentUser.role !== 'Admin' && columnIndex > 0) {
        actualColumnIndex = columnIndex; // No adjustment needed
    }
    
    // Month order for sorting
    const monthOrder = {
        'Januari': 1, 'Februari': 2, 'Maret': 3, 'April': 4,
        'Mei': 5, 'Juni': 6, 'Juli': 7, 'Agustus': 8,
        'September': 9, 'Oktober': 10, 'November': 11, 'Desember': 12
    };
    
    // Sort rows
    rows.sort((a, b) => {
        let aValue, bValue;
        
        // Get cell content based on column
        const aCells = a.querySelectorAll('td');
        const bCells = b.querySelectorAll('td');
        
        if (currentUser.role === 'Admin') {
            // For Admin: 0=No, 1=KUA, 2=Bulan, 3=Tahun, 4=Total, 5=Dibuat
            switch(columnIndex) {
                case 0: // No
                    aValue = parseInt(aCells[0].textContent);
                    bValue = parseInt(bCells[0].textContent);
                    break;
                case 1: // KUA
                    aValue = aCells[1].textContent.trim();
                    bValue = bCells[1].textContent.trim();
                    break;
                case 2: // Bulan
                    aValue = monthOrder[aCells[2].textContent.trim()] || 0;
                    bValue = monthOrder[bCells[2].textContent.trim()] || 0;
                    break;
                case 3: // Tahun
                    aValue = parseInt(aCells[3].textContent);
                    bValue = parseInt(bCells[3].textContent);
                    break;
                case 4: // Total
                    aValue = parseFloat(aCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                    bValue = parseFloat(bCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                    break;
                case 5: // Dibuat
                    aValue = new Date(aCells[5].textContent.trim()).getTime() || 0;
                    bValue = new Date(bCells[5].textContent.trim()).getTime() || 0;
                    break;
            }
        } else {
            // For Operator: 0=No, 1=Bulan, 2=Tahun, 3=Total, 4=Dibuat
            switch(columnIndex) {
                case 0: // No
                    aValue = parseInt(aCells[0].textContent);
                    bValue = parseInt(bCells[0].textContent);
                    break;
                case 2: // Bulan
                    aValue = monthOrder[aCells[1].textContent.trim()] || 0;
                    bValue = monthOrder[bCells[1].textContent.trim()] || 0;
                    break;
                case 3: // Tahun
                    aValue = parseInt(aCells[2].textContent);
                    bValue = parseInt(bCells[2].textContent);
                    break;
                case 4: // Total
                    aValue = parseFloat(aCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                    bValue = parseFloat(bCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                    break;
                case 5: // Dibuat
                    aValue = new Date(aCells[4].textContent.trim()).getTime() || 0;
                    bValue = new Date(bCells[4].textContent.trim()).getTime() || 0;
                    break;
            }
        }
        
        // Compare
        if (aValue < bValue) return rpdSortState.ascending ? -1 : 1;
        if (aValue > bValue) return rpdSortState.ascending ? 1 : -1;
        return 0;
    });
    
    // Re-append rows (this will reorder them)
    const totalRow = tbody.querySelector('tr:last-child');
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
        // Update No column
        row.querySelector('td:first-child').textContent = index + 1;
        tbody.appendChild(row);
    });
    
    // Re-append total row
    if (totalRow) {
        tbody.appendChild(totalRow);
    }
    
    console.log('[RPD SORT] Sorted', rows.length, 'rows by column', columnIndex, 'ascending:', rpdSortState.ascending);
}


async function showRPDModal(rpd = null) {
    console.log('[RPD MODAL]', rpd);
    
    // Check if config allows RPD input (tanpa loading)
    try {
        const config = await apiCall('getRPDConfig');
        const isEditMode = !!(rpd && rpd.id);

        // ✅ FIX: RPD_STATUS hanya berlaku untuk TAMBAH RPD baru — bukan edit.
        if (!isEditMode && config.RPD_STATUS === 'closed' && currentUser.role !== 'Admin') {
            showNotification('Pengisian RPD sedang ditutup', 'warning');
            return;
        }

        // ✅ Edit RPD yang sudah ada memakai gate-nya sendiri (RPD_EDIT_OPEN_MONTHS),
        // TIDAK bergantung pada RPD_STATUS sama sekali.
        if (isEditMode && currentUser.role !== 'Admin') {
            let openMonths = [];
            try { openMonths = JSON.parse(config.RPD_EDIT_OPEN_MONTHS || '[]'); } catch (e) { openMonths = []; }
            if (!openMonths.includes(rpd.month)) {
                showNotification('Edit RPD bulan ' + rpd.month + ' sedang ditutup oleh Admin.', 'warning');
                return;
            }
        }
    } catch (error) {
        console.error('[RPD ERROR] Failed to check config', error);
    }

    // ✅ OPTIMIZED: Get budget info dari cache dan hitung totalRPD dari rpdTable
    let budgetInfo = { budget: 0, totalRPD: 0, sisaRPD: 0 };
    try {
        console.log('[RPD MODAL] Getting budget info from cache...');
        
        // Get budget dari cache (budget NEVER changes, always in cache)
        const cachedBudgets = getLocalCache('budgets');
        
        if (cachedBudgets && cachedBudgets.length > 0) {
            const budget = cachedBudgets[0];
            const budgetTotal = parseFloat(budget.total) || parseFloat(budget.budget) || 0;
            
            // ⭐ OPTIMIZED: Hitung totalRPD dari data RPD yang sudah di-load di rpdTable
            const cachedRPDs = getLocalCache('rpds');
            let calculatedTotalRPD = 0;
            
            if (cachedRPDs && cachedRPDs.length > 0) {
                // Filter RPDs sesuai dengan user dan year yang sedang aktif
                const currentYear = new Date().getFullYear();
                const filteredRPDs = cachedRPDs.filter(r => {
                    const yearMatch = r.year == currentYear;
                    const kuaMatch = currentUser.role === 'Admin' || r.kua === currentUser.kua;
                    return yearMatch && kuaMatch;
                });
                
                // Calculate total dari filtered RPDs
                calculatedTotalRPD = filteredRPDs.reduce((sum, r) => {
                    return sum + (parseFloat(r.total) || 0);
                }, 0);
                
                console.log('[RPD MODAL] Calculated totalRPD from table:', {
                    totalRPDs: filteredRPDs.length,
                    calculatedTotal: calculatedTotalRPD
                });
            }
            
            budgetInfo = {
                budget: budgetTotal,
                totalRPD: calculatedTotalRPD,
                sisaRPD: budgetTotal - calculatedTotalRPD
            };
            
            console.log('[RPD MODAL] Budget info from cache + calculated RPD:', budgetInfo);
        } else {
            console.warn('[RPD MODAL] No budget in cache - budget should have been loaded at startup!');
        }
    } catch (error) {
        console.error('[RPD ERROR] Failed to get budget:', error);
    }

    // ✅ BARU — Info per pos akun: Total RPD setahun & Total Realisasi setahun
    // (Approved/Paid) yang sudah pernah disubmit, supaya operator punya
    // konteks saat merevisi RPD bulan ini.
    let posInfoHTML = '';
    try {
        const _posYear = (rpd && rpd.year) ? rpd.year : new Date().getFullYear();
        const _posMonth = (rpd && rpd.month) ? rpd.month : '';
        const _posKua = currentUser.role === 'Admin' ? (rpd ? rpd.kua : currentUser.kua) : currentUser.kua;
        const posCtx = await _getRealisasiPosLimitContext(_posKua, _posMonth, _posYear, null);

        const posRows = [];
        Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
            param.items.forEach(item => {
                const rpdSetahun = (posCtx.rpdAnnual[code] && posCtx.rpdAnnual[code][item]) ? posCtx.rpdAnnual[code][item] : 0;
                const realSetahun = (posCtx.used[code] && posCtx.used[code][item]) ? posCtx.used[code][item] : 0;
                const label = item === 'Nominal' ? param.name : `${param.name} — ${item}`;
                posRows.push(`
                    <tr>
                        <td style="padding:6px 8px;">${label}</td>
                        <td style="padding:6px 8px; text-align:right;">${formatCurrency(rpdSetahun)}</td>
                        <td style="padding:6px 8px; text-align:right;">${formatCurrency(realSetahun)}</td>
                    </tr>
                `);
            });
        });

        posInfoHTML = `
            <div class="summary-box" style="max-height:220px; overflow-y:auto;">
                <div style="font-weight:600; margin-bottom:8px;">Rincian per Pos Akun (Tahun ${_posYear})</div>
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead>
                        <tr style="border-bottom:2px solid #dee2e6;">
                            <th style="text-align:left; padding:6px 8px;">Pos Akun</th>
                            <th style="text-align:right; padding:6px 8px;">Total RPD Setahun</th>
                            <th style="text-align:right; padding:6px 8px;">Total Realisasi Setahun</th>
                        </tr>
                    </thead>
                    <tbody>${posRows.join('')}</tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('[RPD ERROR] Failed to get per-pos info:', error);
    }

    // Create modal if doesn't exist
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // ✅ FIX: Prepare RPD data dengan benar
    const rpdData = rpd && rpd.data ? rpd.data : {};
    console.log('[RPD MODAL] RPD data:', rpdData);
    
    const currentYear = new Date().getFullYear();
    
    // ✅ FIX: Build parameters HTML dengan logging detail
    let parametersHTML = '';
    
    Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
        console.log('[RPD MODAL] Building HTML for code:', code, 'param:', param);
        
        parametersHTML += `
            <div class="rpd-item">
                <h4>${code} - ${param.name}</h4>
        `;
        
        param.items.forEach((item, itemIndex) => {
            // ✅ FIX: Define value BEFORE using it
            const itemValue = rpdData[code] && rpdData[code][item] ? rpdData[code][item] : 0;
            const inputId = `rpd_${code}_${item.replace(/\s+/g, '_')}`;
            
            console.log(`[RPD MODAL] Item ${itemIndex}: ${item}, value:`, itemValue);
            
            parametersHTML += `
                <div class="rpd-subitem">
                    <label>${item}</label>
                    <input type="text" 
                           id="${inputId}"
                           class="rpd-input auto-format-number"
                           data-code="${code}" 
                           data-item="${item}" 
                           value="${itemValue}" 
                           placeholder="0">
                </div>
            `;
        });
        
        parametersHTML += `</div>`;
    });
    
    console.log('[RPD MODAL] Parameters HTML built successfully');
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px;">
            <div class="modal-header">
                <h3>${rpd ? 'Edit RPD' : 'Buat RPD Baru'}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            
            <div class="summary-box">
                <div class="summary-item">
                    <span>Budget Tahunan:</span>
                    <strong>${formatCurrency(budgetInfo.budget)}</strong>
                </div>
                <div class="summary-item">
                    <span>Total RPD yang Sudah Disubmit:</span>
                    <strong>${formatCurrency(budgetInfo.totalRPD)}</strong>
                </div>
                <div class="summary-item">
                    <span>Sisa Nominal RPD:</span>
                    <strong id="sisaNominalRPDInfo" style="color: #28a745;">${formatCurrency(budgetInfo.sisaRPD)}</strong>
                </div>
            </div>

            ${posInfoHTML}
            
            <form id="rpdForm" data-edit-mode="${rpd ? 'true' : 'false'}" data-existing-rpd-total="${rpd ? (rpd.total || 0) : 0}">
                <div class="form-group">
                    <label>Bulan</label>
                    <select id="rpdMonth" required ${rpd ? 'disabled' : ''}>
                        <option value="">-- Pilih Bulan --</option>
                        ${APP_CONFIG.MONTHS.map((month, index) => {
                            const _isPastMonth = !rpd && (
                                currentYear < new Date().getFullYear() ||
                                (currentYear === new Date().getFullYear() && index < new Date().getMonth())
                            );
                            const _sel = rpd && rpd.month === month ? 'selected' : '';
                            return `<option value="${month}" ${_sel} ${_isPastMonth ? 'disabled style="color:#bbb;"' : ''}>${month}${_isPastMonth ? ' (lewat)' : ''}</option>`;
                        }).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Tahun</label>
                    <select id="rpdYear" required ${rpd ? 'disabled' : ''}>
                        ${Array.from({length: 7}, (_, i) => currentYear - 5 + i).map(year => `
                            <option value="${year}" ${rpd && rpd.year == year ? 'selected' : year === currentYear ? 'selected' : ''}>${year}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div id="rpdParameters">
                    ${parametersHTML}
                </div>
                
                <div class="summary-box">
                    <div class="summary-item">
                        <span>Total RPD:</span>
                        <strong id="rpdTotal">${formatCurrency(0)}</strong>
                    </div>
                </div>
                
                <button type="submit" class="btn">Simpan RPD</button>
            </form>
        </div>
    `;
    
    modal.classList.add('active');
    
    // ✅ Setup auto-format untuk semua inputs
    console.log('[RPD MODAL] Setting up auto-format for inputs...');
    setTimeout(() => {
        setupAllAutoFormatInputs('.auto-format-number');
        
        // Calculate total on input change
        const inputs = document.querySelectorAll('.rpd-input');
        console.log('[RPD MODAL] Found', inputs.length, 'rpd-input elements');
        
        inputs.forEach((input, index) => {
            console.log('[RPD MODAL] Attaching listener to input', index + 1, ':', input.id);
            input.addEventListener('input', function() {
                calculateRPDTotal();
                modalHasChanges = true; // ✅ Track changes
            });
        });
        
        calculateRPDTotal();
    }, 100);
    
    // ✅ Reset modalHasChanges
    modalHasChanges = false;
    
    // Form submit handler
    document.getElementById('rpdForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[RPD] Submitting RPD form');
        
        const month = document.getElementById('rpdMonth').value;
        const year = document.getElementById('rpdYear').value;
        
        // ✅ UPDATED VALIDATION: Check for duplicate month, past month, and config status
        if (!rpd || !rpd.id) {
            // Cek bulan sudah lewat (untuk Operator KUA saja)
            if (currentUser.role !== 'Admin') {
                const _submitMonthIdx = APP_CONFIG.MONTHS.indexOf(month);
                const _submitYear = parseInt(year);
                const _now = new Date();
                const _isPastSubmit = _submitYear < _now.getFullYear() ||
                    (_submitYear === _now.getFullYear() && _submitMonthIdx < _now.getMonth());
                if (_isPastSubmit) {
                    showNotification('Tidak dapat mengisi RPD untuk bulan yang sudah lewat (' + month + ' ' + year + ').', 'warning');
                    return;
                }
            }

            // For NEW RPD, check duplicate month
            const cachedRPDs = getLocalCache('rpds') || [];
            const isDuplicate = cachedRPDs.some(existingRPD => 
                existingRPD.month === month && 
                existingRPD.year == year &&
                existingRPD.kua === currentUser.kua
            );
            
            if (isDuplicate) {
                showNotification('RPD untuk bulan ' + month + ' ' + year + ' sudah ada. Tidak boleh duplicate.', 'error');
                return;
            }
            
            // Check config status
            try {
                const config = await apiCall('getRPDConfig');
                if (config.RPD_STATUS === 'closed' && currentUser.role !== 'Admin') {
                    showNotification('Pengisian RPD sedang ditutup', 'warning');
                    return;
                }
            } catch (error) {
                console.error('[RPD VALIDATION] Failed to check config', error);
            }
        }
        
        // ✅ Kumpulkan data RPD dengan parse formatted values
        const rpdData = {};
        let total = 0;
        
        console.log('[RPD] Collecting data from inputs...');
        
        Object.keys(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(code => {
            rpdData[code] = {};
            const items = document.querySelectorAll(`.rpd-input[data-code="${code}"]`);
            
            console.log(`[RPD] Processing code ${code}, found ${items.length} inputs`);
            
            items.forEach((input, index) => {
                const item = input.dataset.item;
                // ✅ Parse formatted value
                const value = parseFormattedNumber(input.value);
                rpdData[code][item] = value;
                total += value;
                
                console.log(`[RPD] ${code} - ${item}: ${input.value} → ${value}`);
            });
        });
        
        console.log('[RPD] Final data collected:', rpdData);
        console.log('[RPD] Total:', total);
        
        if (total === 0) {
            showNotification('Total RPD tidak boleh 0. Silakan isi nominal untuk minimal satu item.', 'warning');
            return;
        }

        // ✅ BARU — Guard terakhir sebelum submit (jaga-jaga kalau submit terpicu
        // lewat Enter, bukan klik tombol yang sudah di-disable). Pemblokir yang
        // sebenarnya (otoritatif) tetap di server.
        if (currentUser.role !== 'Admin') {
            const cachedRPDs2 = getLocalCache('rpds') || [];
            const isEdit2 = !!(rpd && rpd.id);
            const baseline2 = cachedRPDs2
                .filter(r => r.year == year && (currentUser.role === 'Admin' || r.kua === currentUser.kua))
                .reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
            const oldTotal2 = isEdit2 ? (parseFloat(rpd.total) || 0) : 0;
            const newAnnual2 = baseline2 - oldTotal2 + total;
            const budgetTotal2 = budgetInfo.budget || 0;
            if (newAnnual2 > budgetTotal2) {
                showNotification(
                    'Total RPD setahun (' + formatCurrency(newAnnual2) + ') melebihi Budget tahunan (' +
                    formatCurrency(budgetTotal2) + '). Silakan kurangi nominal.', 'error'
                );
                return;
            }
        }
        
        try {
            const submitData = {
                id: rpd?.id || null,
                kua: currentUser.kua,
                month: month,
                year: parseInt(year),
                total: total,
                data: rpdData,
                userId: currentUser.id,
                username: currentUser.username,
                role: currentUser.role // ✅ FIX: sebelumnya tidak dikirim — dibutuhkan server utk skip Admin dari guard bulan-edit & budget
            };
            
            console.log('[RPD FORM] Submitting to API:', submitData);
            
            await apiCall('saveRPD', submitData);
            
            showNotification('RPD berhasil disimpan', 'success');
            
            // ⭐ OPTIMIZED: Only clear RPD cache (budget never changes!)
            clearLocalCache('rpds');
            
            // Clear Smart Cache untuk RPD saja
            if (window.SmartCacheManager) {
                SmartCacheManager.invalidateType('RPDS');
                // Budget TIDAK di-invalidate karena tidak berubah
                // Dashboard stats akan di-recalculate dari cache
            }
            
            modalHasChanges = false; // ✅ Reset changes flag
            closeModal(true); // ✅ Skip confirmation karena sudah saved
            
            // ✅ OPTIMIZED: Hanya reload RPDs, dashboard akan recalculate
            await loadRPDs(true);
            
            // ⭐ PENTING: Recalculate dashboard stats dari cache tanpa API call
            updateDashboardFromCache();
            
        } catch (error) {
            console.error('[RPD FORM ERROR]', error);
            showNotification(error.message, 'error');
        }
    });
}

// Find rpdForm submit handler

async function submitRPD(e) {
  e.preventDefault();
  
  // ✅ Collect data properly
  const rpdData = {};
  let total = 0;
  
  Object.keys(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(code => {
    rpdData[code] = {};
    APP_CONFIG.BOP.RPD_PARAMETERS[code].items.forEach(item => {
      const inputId = `rpd_${code}_${item.replace(/\s+/g, '_')}`;
      const value = parseFloat(document.getElementById(inputId)?.value) || 0;
      rpdData[code][item] = value;
      total += value;
    });
  });
  
  const submitData = {
    id: editingRPD?.id,
    kua: currentUser.kua,
    userId: currentUser.id,
    month: document.getElementById('rpdMonth').value,
    year: document.getElementById('rpdYear').value,
    data: rpdData,  // ✅ This is the nested object
    total: total
  };
  
  console.log('[RPD FORM] Submitting:', JSON.stringify(submitData).substring(0, 200));
  
  try {
    const result = await apiCall('saveRPD', submitData);
    showNotification(result.message || 'RPD berhasil disimpan', 'success');
    closeModal();
    loadRPDs();
  } catch (error) {
    console.error('[RPD FORM ERROR]', error);
    showNotification(error.message || 'Gagal menyimpan RPD', 'error');
  }
}

function calculateRPDTotal() {
    let total = 0;
    
    console.log('[CALCULATE_RPD_TOTAL] Starting calculation...');
    
    Object.keys(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(code => {
        const items = document.querySelectorAll(`.rpd-input[data-code="${code}"]`);
        
        items.forEach(input => {
            // ✅ Parse formatted value
            const value = parseFormattedNumber(input.value);
            total += value;
            
            console.log(`[CALCULATE_RPD_TOTAL] ${input.id}: ${input.value} → ${value}`);
        });
    });
    
    console.log('[CALCULATE_RPD_TOTAL] Total:', total);
    
    const totalElement = document.getElementById('rpdTotal');
    if (totalElement) {
        totalElement.textContent = formatCurrency(total);
    }
    
    // ✅ UPDATE SUMMARY BOX - Update sisa nominal RPD secara real-time
    updateRPDSummaryBox(total);
}

// ✅ NEW FUNCTION: Update summary box dengan total RPD yang sedang diinput
function updateRPDSummaryBox(currentTotal) {
    const budgetTahunanEl = document.querySelector('.summary-box .summary-item:nth-child(1) strong');
    const totalRPDEl = document.querySelector('.summary-box .summary-item:nth-child(2) strong');
    const sisaNominalEl = document.querySelector('.summary-box .summary-item:nth-child(3) strong');
    
    if (!budgetTahunanEl || !totalRPDEl || !sisaNominalEl) {
        console.log('[UPDATE_SUMMARY] Summary elements not found');
        return;
    }
    
    // Get current budget tahunan (tetap)
    const budgetTahunanText = budgetTahunanEl.textContent.replace(/[^\d]/g, '');
    const budgetTahunan = parseFloat(budgetTahunanText) || 0;
    
    // Get form data
    const form = document.getElementById('rpdForm');
    const isEdit = form?.dataset?.editMode === 'true';
    const existingRPDTotal = parseFloat(form?.dataset?.existingRpdTotal || 0);
    
    console.log('[UPDATE_SUMMARY] Form data:', { isEdit, existingRPDTotal });
    
    // ⭐ OPTIMIZED: Hitung baseline total RPD dari data RPD yang sudah di-cache
    const cachedRPDs = getLocalCache('rpds');
    let baselineTotalRPD = 0;
    
    if (cachedRPDs && cachedRPDs.length > 0) {
        // Filter RPDs sesuai dengan user dan year yang sedang aktif
        const currentYear = new Date().getFullYear();
        const filteredRPDs = cachedRPDs.filter(r => {
            const yearMatch = r.year == currentYear;
            const kuaMatch = currentUser.role === 'Admin' || r.kua === currentUser.kua;
            return yearMatch && kuaMatch;
        });
        
        // Calculate total dari filtered RPDs
        baselineTotalRPD = filteredRPDs.reduce((sum, r) => {
            return sum + (parseFloat(r.total) || 0);
        }, 0);
        
        console.log('[UPDATE_SUMMARY] Baseline total RPD calculated from table:', {
            totalRPDs: filteredRPDs.length,
            baselineTotalRPD
        });
    }
    
    // ✅ Calculate new total RPD
    let newTotalRPD;
    if (isEdit) {
        // Edit mode: totalRPD = baseline - existing + current
        newTotalRPD = baselineTotalRPD - existingRPDTotal + currentTotal;
        console.log('[UPDATE_SUMMARY] EDIT MODE:', {
            baselineTotalRPD,
            existingRPDTotal,
            currentTotal,
            calculation: `${baselineTotalRPD} - ${existingRPDTotal} + ${currentTotal} = ${newTotalRPD}`
        });
    } else {
        // New mode: totalRPD = baseline + current
        newTotalRPD = baselineTotalRPD + currentTotal;
        console.log('[UPDATE_SUMMARY] NEW MODE:', {
            baselineTotalRPD,
            currentTotal,
            calculation: `${baselineTotalRPD} + ${currentTotal} = ${newTotalRPD}`
        });
    }
    
    // Calculate sisa
    const sisaNominal = budgetTahunan - newTotalRPD;
    
    console.log('[UPDATE_SUMMARY] Final:', {
        budgetTahunan,
        newTotalRPD,
        sisaNominal
    });
    
    // Update display dengan warna
    totalRPDEl.textContent = formatCurrency(newTotalRPD);
    sisaNominalEl.textContent = formatCurrency(sisaNominal);
    
    // ✅ Add visual feedback jika melebihi budget
    if (sisaNominal < 0) {
        sisaNominalEl.style.color = '#dc3545'; // Red
        totalRPDEl.style.color = '#dc3545'; // Red
    } else if (sisaNominal < budgetTahunan * 0.1) {
        // Warning jika sisa < 10%
        sisaNominalEl.style.color = '#ffc107'; // Yellow
        totalRPDEl.style.color = '#333'; // Default
    } else {
        sisaNominalEl.style.color = '#28a745'; // Green
        totalRPDEl.style.color = '#333'; // Default
    }

    // ✅ BARU — Blokir submit sungguhan (bukan cuma warna) kalau total RPD
    // setahun melebihi Budget. Admin dikecualikan (sama seperti di server).
    if (currentUser && currentUser.role !== 'Admin') {
        const isOverBudget = sisaNominal < 0;
        const submitBtn = document.querySelector('#rpdForm button[type="submit"]');
        let warningBanner = document.getElementById('rpdBudgetOverWarning');

        if (isOverBudget) {
            if (!warningBanner) {
                warningBanner = document.createElement('div');
                warningBanner.id = 'rpdBudgetOverWarning';
                warningBanner.className = 'budget-over-warning';
                const summaryBoxes = document.querySelectorAll('#modal .summary-box');
                const firstSummaryBox = summaryBoxes[0];
                if (firstSummaryBox) firstSummaryBox.insertAdjacentElement('afterend', warningBanner);
            }
            warningBanner.innerHTML = `
                ⚠️ <strong>Total RPD setahun melebihi Budget!</strong>
                Kelebihan: <strong>${formatCurrency(Math.abs(sisaNominal))}</strong>
                — Kurangi nominal agar tidak melebihi Budget tahunan
                <strong>${formatCurrency(budgetTahunan)}</strong>.
            `;
            warningBanner.style.display = 'block';
            if (submitBtn) submitBtn.disabled = true;
        } else {
            if (warningBanner) warningBanner.style.display = 'none';
            if (submitBtn) submitBtn.disabled = false;
        }
    }
}

function viewRPD(rpdId) {
    // ✅ FIX: Retrieve rpd from Map by ID (see displayRPDs / displayRPDsFiltered)
    const rpd = rpdDataStore.get(rpdId);
    
    if (!rpd) {
        console.error('[RPD] RPD not found in store:', rpdId);
        showNotification('Data RPD tidak ditemukan', 'error');
        return;
    }
    
    console.log('[RPD] Viewing RPD:', rpd);
    
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // ✅ FIX ISSUE #2: Format detail dengan logic yang sama seperti realisasi
    let detailHTML = '';
    Object.entries(rpd.data).forEach(([code, items]) => {
        const param = APP_CONFIG.BOP.RPD_PARAMETERS[code];
        
        const itemsArray = Object.entries(items);
        const hasMultipleItems = itemsArray.length > 1;
        const onlyNominal = itemsArray.length === 1 && itemsArray[0][0] === 'Nominal';
        
        console.log(`[RPD] ${code} - ${param.name}:`, {
            itemsCount: itemsArray.length,
            hasMultipleItems,
            onlyNominal,
            items: items
        });
        
        detailHTML += `<div class="rpd-item">`;
        
        if (onlyNominal) {
            // ✅ Jika hanya "Nominal", tampilkan value langsung di samping nama akun
            const nominalValue = items['Nominal'];
            detailHTML += `
                <div class="rpd-subitem">
                    <span style="font-weight: 600; color: #333;">${code} - ${param.name}</span>
                    <strong style="font-size: 16px; color: #667eea;">${formatCurrency(nominalValue)}</strong>
                </div>
            `;
        } else if (hasMultipleItems) {
            // ✅ Jika ada breakdown, jangan tampilkan total parent
            detailHTML += `<h4>${code} - ${param.name}</h4>`;
            
            itemsArray.forEach(([item, value]) => {
                detailHTML += `
                    <div class="rpd-subitem">
                        <span>${item}</span>
                        <strong>${formatCurrency(value)}</strong>
                    </div>
                `;
            });
        } else {
            detailHTML += `<h4>${code} - ${param.name}</h4>`;
            itemsArray.forEach(([item, value]) => {
                detailHTML += `
                    <div class="rpd-subitem">
                        <span>${item}</span>
                        <strong>${formatCurrency(value)}</strong>
                    </div>
                `;
            });
        }
        
        detailHTML += `</div>`;
    });
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h3>Detail RPD - ${rpd.month} ${rpd.year}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            ${detailHTML}
            <div class="summary-box">
                <div class="summary-item">
                    <span>Total RPD:</span>
                    <strong>${formatCurrency(rpd.total)}</strong>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.add('active');
}

function editRPD(rpdId) {
    // ✅ FIX: Retrieve rpd from Map by ID (see displayRPDs / displayRPDsFiltered)
    const rpd = rpdDataStore.get(rpdId);
    
    if (!rpd) {
        console.error('[RPD] RPD not found in store:', rpdId);
        showNotification('Data RPD tidak ditemukan', 'error');
        return;
    }
    
    showRPDModal(rpd);
}

// ===== REALISASI MANAGEMENT =====
async function loadRealisasisForYear() {
    // ✅ Dipanggil dari year filter onchange — selalu fetch tahun baru dari server
    const yearFilter = document.getElementById('realisasiYearFilter');
    const newYear = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    
    if (newYear === currentYear) {
        // Tahun saat ini: cek cache
        const cachedData = getLocalCache('realisasis');
        if (cachedData) {
            console.log('[REALISASI YEAR FILTER] Same year, using cache');
            displayRealisasis(cachedData);
            if (currentUser.role === 'Operator KUA') updateRealisasiButtonState();
            return;
        }
    }
    
    // Tahun berbeda atau cache kosong: fetch dari server
    console.log('[REALISASI YEAR FILTER] Fetching year:', newYear);
    try {
        const realisasis = await apiCall('getRealisasis', { kua: currentUser.kua, year: newYear });
        const sorted = sortByMonth(realisasis);
        if (newYear === currentYear) {
            updateLocalCache('realisasis', sorted); // hanya cache tahun saat ini
        }
        displayRealisasis(sorted);
        if (currentUser.role === 'Operator KUA') updateRealisasiButtonState();
    } catch (error) {
        console.error('[REALISASI YEAR FILTER ERROR]', error);
        showNotification('Gagal memuat data realisasi', 'error');
    }
}

async function loadRealisasis(forceRefresh = false) {
    console.log('[REALISASI] Loading realisasis', { forceRefresh });
    
    // ✅ ALWAYS cek cache dulu
    const cachedData = getLocalCache('realisasis');
    if (cachedData && !forceRefresh) {
        console.log('[REALISASI] Using cached data - NO SERVER CALL');
        displayRealisasis(cachedData);
        
        // ✅ Update button state ONCE jika operator (menggunakan cached config)
        if (currentUser.role === 'Operator KUA') {
            updateRealisasiButtonState();
        }
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[REALISASI] Fetching from server...');
        // ❌ NO LOADING SPINNER
        
        try {
            const yearFilter = document.getElementById('realisasiYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            let realisasis = await apiCall('getRealisasis', { kua: currentUser.kua, year: year });
            realisasis = sortByMonth(realisasis);
            
            // ✅ Update local cache
            updateLocalCache('realisasis', realisasis);
            displayRealisasis(realisasis);
            
            // ✅ Update button state AFTER displaying data
            if (currentUser.role === 'Operator KUA') {
                updateRealisasiButtonState();
            }
        } catch (error) {
            console.error('[REALISASI ERROR]', error);
        }
    }
}

async function updateRealisasiButtonState() {
    const btnCreateRealisasi = document.getElementById('btnCreateRealisasi');
    
    if (!btnCreateRealisasi) return;
    
    const status = await checkRealisasiStatus();
    
    if (status === 'closed') {
        btnCreateRealisasi.disabled = true;
        btnCreateRealisasi.style.opacity = '0.5';
        btnCreateRealisasi.style.cursor = 'not-allowed';
        btnCreateRealisasi.title = 'Pengisian Realisasi ditutup oleh Admin';
        
        console.log('[REALISASI] Button disabled - status closed');
    } else {
        btnCreateRealisasi.disabled = false;
        btnCreateRealisasi.style.opacity = '1';
        btnCreateRealisasi.style.cursor = 'pointer';
        btnCreateRealisasi.title = 'Tambah Realisasi';
        
        console.log('[REALISASI] Button enabled - status open');
    }
}

function displayRealisasis(realisasis) {
    const tbody = document.querySelector('#realisasiTable tbody');
    let totalNominal = 0;
    
    // ✅ Operator KUA: kolom Total menggunakan nilai Include AutoPayment
    const isOperator = currentUser && currentUser.role !== 'Admin';
    
    console.log('[DISPLAY_REALISASIS] Displaying', realisasis.length, 'records');
    
    const rows = realisasis.map((real, index) => {
        // ✅ Hitung nilai yang ditampilkan di kolom Total
        let displayTotal;
        if (isOperator && _apConfig) {
            // Ambil nominal AP untuk bulan & tahun ini dari cache _apNominals
            const nomKey  = `${real.month}_${real.year}`;
            const nomData = _apNominals[nomKey] || {};
            // _apNominals[key] bisa berstruktur { KUA: { code: n } } atau flat { code: n }
            const kuaNom  = (nomData && nomData[real.kua]) ? nomData[real.kua] : {};
            const { include } = apCalcTotals([real], _apConfig, { [real.kua]: kuaNom });
            displayTotal = include;
        } else {
            displayTotal = parseFloat(real.total || 0);
        }
        totalNominal += displayTotal;
        
        let statusClass = getStatusBadgeClass(real.status);
        let statusText = getStatusLabel(real.status);
        
        // ✅ FIX: Store realisasi in Map and pass only ID to avoid token errors
        // (same pattern as displayVerifikasi / realisasiDataStore)
        const realisasiId = real.id || `temp-${Date.now()}-${index}`;
        realisasiDataStore.set(realisasiId, real);
        
        console.log('[DISPLAY_REALISASIS] Row', index + 1, ':', {
            id: realisasiId,
            month: real.month,
            year: real.year,
            total: real.total,
            displayTotal: displayTotal,
            status: real.status,
            files: real.files ? real.files.length : 0
        });
        
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${real.month || '-'}</td>
            <td>${real.year || '-'}</td>
            <td>${formatCurrency(displayTotal)}</td>
            <td><span class="badge badge-${statusClass}">${statusText}</span></td>
            <td>${real.createdAt ? formatDate(real.createdAt) : '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="viewRealisasi('${realisasiId}')">Lihat</button>
                    ${(normalizeStatus(real.status) === STATUS.WAITING || normalizeStatus(real.status) === STATUS.REJECTED) && currentUser.role !== 'Admin' ? 
                        `<button class="btn btn-sm" onclick="editRealisasi('${realisasiId}')">Edit</button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    const totalRow = `
        <tr style="background: #f8f9fa; font-weight: bold;">
            <td colspan="3" style="text-align: right;">TOTAL:</td>
            <td>${formatCurrency(totalNominal)}</td>
            <td colspan="3"></td>
        </tr>
    `;
    
    tbody.innerHTML = rows + totalRow;
}

async function showRealisasiModal(realisasi = null) {
    console.log('[REALISASI MODAL] Opening modal, editing:', !!realisasi);
    console.log('[REALISASI MODAL] Realisasi data:', realisasi);
    
    // ✅ Reset modalHasChanges
    modalHasChanges = false;
    
    // Check status untuk new realisasi
    if (!realisasi && currentUser.role === 'Operator KUA') {
        const status = await checkRealisasiStatus();
        
        if (status === 'closed') {
            showNotification('Pengisian Realisasi saat ini ditutup oleh Admin', 'warning');
            return;
        }
    }
    
    // ✅ Load upload config
    await loadUploadConfig();
    
    // ✅ Hitung ulang konteks batas RPD (sisa anggaran per pos) setiap modal dibuka,
    // supaya tidak memakai angka lama dari pembukaan modal sebelumnya.
    _posLimitCache = null;
    _posLimitCacheKey = '';
    
    // ✅ PERBAIKAN: Reset uploadedFiles (harus pakai 'let' di global, bukan 'const')
    uploadedFiles = [];
    
    // Get modal - FIXED: menggunakan let agar bisa di-reassign
    let modal = document.getElementById('realisasiModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'realisasiModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // ✅ Get budget info - fetch dari server jika cache kosong atau 0
    let realisasiBudgetInfo = { budget: 0, totalRealisasi: 0, sisaBudget: 0 };
    
    try {
        const cachedBudgets = getLocalCache('budgets');
        const cachedRealisasis = getLocalCache('realisasis');
        
        if (cachedBudgets && cachedBudgets.length > 0) {
            const yearFilter = document.getElementById('realisasiYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            const currentBudget = cachedBudgets.find(b => b.year == year);
            const budgetTotal = currentBudget ? currentBudget.budget : 0;
            
            // Hitung total realisasi dari cache — include Approved & Paid
            const totalRealisasi = cachedRealisasis
                ? cachedRealisasis
                    .filter(r => (normalizeStatus(r.status) === STATUS.APPROVED || normalizeStatus(r.status) === STATUS.PAID) && r.id !== realisasi?.id)
                    .reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0)
                : 0;
            
            realisasiBudgetInfo = {
                budget: budgetTotal,
                totalRealisasi: totalRealisasi,
                sisaBudget: budgetTotal - totalRealisasi
            };
            
            console.log('[REALISASI MODAL] Budget info from cache:', realisasiBudgetInfo);
        }
        
        // ✅ PERBAIKAN: Jika cache kosong atau budget = 0, fetch dari server
        if (!cachedBudgets || cachedBudgets.length === 0 || realisasiBudgetInfo.budget === 0) {
            console.log('[REALISASI MODAL] Cache empty or budget = 0, fetching fresh data...');
            
            const freshBudgets = currentUser.role === 'Admin' 
                ? await apiCall('getBudgets', { year: new Date().getFullYear() })
                : await apiCall('getBudgets', { kua: currentUser.kua });
            
            if (freshBudgets && freshBudgets.length > 0) {
                // Update cache
                updateLocalCache('budgets', freshBudgets);
                
                const yearFilter = document.getElementById('realisasiYearFilter');
                const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
                
                const currentBudget = freshBudgets.find(b => b.year == year);
                const budgetTotal = currentBudget ? (parseFloat(currentBudget.budget) || parseFloat(currentBudget.total) || 0) : 0;
                
                // Fetch realisasis juga jika cache kosong
                let freshRealisasis = cachedRealisasis;
                if (!cachedRealisasis || cachedRealisasis.length === 0) {
                    freshRealisasis = currentUser.role === 'Admin'
                        ? await apiCall('getRealisasis', { year: new Date().getFullYear() })
                        : await apiCall('getRealisasis', { kua: currentUser.kua, year: new Date().getFullYear() });
                    
                    if (freshRealisasis) {
                        updateLocalCache('realisasis', freshRealisasis);
                    }
                }
                
                // Hitung total realisasi
                const totalRealisasi = freshRealisasis
                    ? freshRealisasis
                        .filter(r => (normalizeStatus(r.status) === STATUS.APPROVED || normalizeStatus(r.status) === STATUS.PAID) && r.id !== realisasi?.id)
                        .reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0)
                    : 0;
                
                realisasiBudgetInfo = {
                    budget: budgetTotal,
                    totalRealisasi: totalRealisasi,
                    sisaBudget: budgetTotal - totalRealisasi
                };
                
                console.log('[REALISASI MODAL] Budget info from fresh fetch:', realisasiBudgetInfo);
            }
        }
    } catch (error) {
        console.error('[REALISASI MODAL ERROR]', error);
        showNotification('Gagal memuat data budget', 'error');
    }
    
    // ✅ Get available RPDs - fetch dari server jika cache kosong
    let availableRPDs = [];
    try {
        let cachedRPDs = getLocalCache('rpds');
        let cachedRealisasis = getLocalCache('realisasis');
        
        // ✅ PERBAIKAN: Jika cache RPD kosong, fetch dari server
        if (!cachedRPDs || cachedRPDs.length === 0) {
            console.log('[REALISASI MODAL] RPD cache empty, fetching fresh data...');
            
            const freshRPDs = currentUser.role === 'Admin'
                ? await apiCall('getRPDs', { year: new Date().getFullYear() })
                : await apiCall('getRPDs', { kua: currentUser.kua, year: new Date().getFullYear() });
            
            if (freshRPDs && freshRPDs.length > 0) {
                cachedRPDs = freshRPDs;
                updateLocalCache('rpds', sortByMonth(freshRPDs));
                console.log('[REALISASI MODAL] Fresh RPDs fetched:', freshRPDs.length);
            }
        }
        
        console.log('[REALISASI MODAL] Loading RPDs from cache/fresh');
        
        if (Array.isArray(cachedRPDs)) {
            // Filter RPDs yang valid
            let validRPDs = cachedRPDs.filter(rpd => rpd && rpd.month && rpd.year);
            
            // ✅ FILTER OUT bulan yang sudah ada realisasinya (untuk tambah baru)
            if (!realisasi && cachedRealisasis) {
                const yearFilter = document.getElementById('realisasiYearFilter');
                const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
                
                console.log('[REALISASI MODAL] Existing realisasis from cache:', cachedRealisasis.length);
                
                // Buat set dari bulan yang sudah ada realisasinya
                const usedMonths = new Set(
                    cachedRealisasis.map(r => `${r.month}-${r.year}`)
                );
                
                console.log('[REALISASI MODAL] Used months:', Array.from(usedMonths));
                
                // Filter out RPD yang bulannya sudah ada realisasi
                availableRPDs = validRPDs.filter(rpd => {
                    const monthKey = `${rpd.month}-${rpd.year}`;
                    const isAvailable = !usedMonths.has(monthKey);
                    
                    if (!isAvailable) {
                        console.log('[REALISASI MODAL] Filtering out month:', monthKey, '- already has realisasi');
                    }
                    
                    return isAvailable;
                });
                
                console.log('[REALISASI MODAL] Available RPDs after filtering:', availableRPDs.length);
            } else {
                // Untuk edit, pakai semua RPD
                availableRPDs = validRPDs;
            }
            
            console.log('[REALISASI MODAL] Found RPDs:', availableRPDs.length);
        } else {
            console.warn('[REALISASI MODAL] RPDs not in cache');
            availableRPDs = [];
        }
                    
        
    } catch (error) {
        console.error('[REALISASI MODAL ERROR]', error);
        showNotification('Gagal memuat data RPD: ' + error.message, 'warning');
    }
    
    if (!realisasi && availableRPDs.length === 0) {
        showNotification('Belum ada RPD yang dibuat untuk tahun ini. Silakan buat RPD terlebih dahulu.', 'warning');
        return;
    }
    
    // Build Modal HTML
    const currentYear = new Date().getFullYear();
    let monthOptions = '';
    
    if (realisasi) {
        // ✅ Untuk edit, cari RPD yang sesuai dengan bulan realisasi
        const matchingRPD = availableRPDs.find(rpd => 
            rpd.month === realisasi.month && rpd.year == realisasi.year
        );
        
        if (matchingRPD) {
            // Gunakan data dari RPD
            monthOptions = `<option value="${matchingRPD.id}" data-month="${matchingRPD.month}" data-year="${matchingRPD.year}" data-rpd-data='${JSON.stringify(matchingRPD.data)}' selected>${matchingRPD.month} ${matchingRPD.year}</option>`;
        } else {
            // Fallback: gunakan data dari realisasi itu sendiri
            monthOptions = `<option value="${realisasi.rpdId || ''}" data-month="${realisasi.month}" data-year="${realisasi.year}" data-rpd-data='${JSON.stringify(realisasi.data)}' selected>${realisasi.month} ${realisasi.year}</option>`;
        }
    } else {
        // Untuk tambah baru, tampilkan daftar RPD yang tersedia (yang belum ada realisasinya)
        if (availableRPDs.length > 0) {
            monthOptions = availableRPDs.map(rpd => 
                `<option value="${rpd.id}" data-month="${rpd.month}" data-year="${rpd.year}" data-rpd-data='${JSON.stringify(rpd.data)}'>${rpd.month} ${rpd.year}</option>`
            ).join('');
        } else {
            monthOptions = '<option value="">Tidak ada RPD tersedia</option>';
        }
    }
    
    // ✅ FIX #1: Build parameters HTML with auto-format-number class
    let parametersHTML = '';
    const realisasiData = realisasi ? realisasi.data : {};
    
    if (realisasi && realisasi.data) {
        Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
            parametersHTML += `
                <div class="rpd-item">
                    <h4>${code} - ${param.name}</h4>
            `;
            
            param.items.forEach(item => {
                const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
                const value = realisasiData[code] && realisasiData[code][item] ? realisasiData[code][item] : 0;
                
                parametersHTML += `
                    <div class="rpd-subitem">
                        <label>${item}</label>
                        <input type="text" 
                            id="${inputId}"
                            class="realisasi-input auto-format-number"
                            data-code="${code}"
                            data-item="${item}"
                            value="${value}" 
                            placeholder="0">
                    </div>
                `;
            });
            
            parametersHTML += `</div>`;
        });
    }
    
    // ✅ Get existing files
    let existingFiles = [];
    
    if (realisasi && realisasi.files) {
        console.log('[REALISASI MODAL] Raw files data:', realisasi.files);
        console.log('[REALISASI MODAL] Files type:', typeof realisasi.files);
        
        if (Array.isArray(realisasi.files)) {
            existingFiles = realisasi.files;
        } else if (typeof realisasi.files === 'string') {
            try {
                existingFiles = JSON.parse(realisasi.files);
            } catch (e) {
                console.error('[REALISASI MODAL] Error parsing files:', e);
            }
        }
        
        // Filter valid files
        existingFiles = existingFiles.filter(f => f && f.fileName && f.fileUrl);
        
        console.log('[REALISASI MODAL] Final existingFiles:', existingFiles);
        console.log('[REALISASI MODAL] Existing files count:', existingFiles.length);
    }
    
    console.log('[REALISASI MODAL] Final existingFiles:', existingFiles);
    console.log('[REALISASI MODAL] Existing files count:', existingFiles.length);
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header">
                <h3>${realisasi ? 'Edit' : 'Tambah'} Realisasi</h3>
                <button class="btn-close" onclick="closeRealisasiModal()">×</button>
            </div>
            
            <form id="realisasiForm" data-editing-id="${realisasi ? realisasi.id : ''}" data-kua="${realisasi ? (realisasi.kua || '') : (currentUser.kua || '')}">
                <div class="modal-body">
                    
                    <!-- Info Budget -->
                    <div class="info-box">
                        <div class="info-item">
                            <span>Anggaran:</span>
                            <strong id="budgetInfo">${formatCurrency(realisasiBudgetInfo.budget)}</strong>
                        </div>
                        <div class="info-item">
                            <span>Total Realisasi (Approved+Paid):</span>
                            <strong id="totalRealisasiInfo">${formatCurrency(realisasiBudgetInfo.totalRealisasi)}</strong>
                        </div>
                        <div class="info-item">
                            <span>Sisa Budget:</span>
                            <strong id="sisaBudgetInfo">${formatCurrency(realisasiBudgetInfo.sisaBudget)}</strong>
                        </div>
                    </div>
                    <!-- AP Include/Exclude placeholder — diisi setelah RPD dipilih -->
                    <div id="apModalSummary" style="display:none; margin-top:10px;"></div>
                    
                    <!-- Pilih RPD (WAJIB) -->
                    <div class="form-group">
                        <label>Pilih RPD <span class="required">*</span></label>
                        <select id="realisasiRPD" required onchange="loadRPDDataFromSelect()" ${realisasi ? 'disabled' : ''}>
                            <option value="">-- Pilih RPD Bulan --</option>
                            ${monthOptions}
                        </select>
                        ${realisasi ? '<input type="hidden" id="realisasiRPDValue" value="' + (realisasi.rpdId || '') + '">' : ''}
                        <small style="color: #666; display: block; margin-top: 5px;">
                            ${realisasi ? 'Bulan tidak dapat diubah saat edit realisasi' : 'Pilih RPD bulan untuk menampilkan form input realisasi'}
                        </small>
                    </div>
                    
                    <!-- Hidden fields for month/year (akan diisi otomatis dari RPD) -->
                    <input type="hidden" id="realisasiMonth" value="">
                    <input type="hidden" id="realisasiYear" value="">
                    
                    <!-- Realisasi Items (will be populated when RPD selected) -->
                    <div id="realisasiParameters"></div>
                    
                    <!-- Total -->
                    <div class="total-section">
                        <h4>Total Realisasi: <span id="realisasiTotalDisplay">Rp 0</span></h4>
                    </div>
                    
                    <!-- ✅ FILE UPLOAD SECTION -->
                    <div class="file-upload-section">
                        <h4 style="margin-bottom: 15px;">Lampiran Dokumen LPJ (Laporan Pertanggung Jawaban)</h4>
                        
                        <div class="upload-info" style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                            <p style="margin: 0; font-size: 13px; color: #666;">
                                <i class="fas fa-info-circle"></i>
                                Maksimal <strong>${uploadConfig.maxFiles} file</strong>, 
                                ukuran per file maksimal <strong>${uploadConfig.maxFileSize} MB</strong>.
                                Format yang didukung: PDF, JPG, PNG, GIF.
                                <span id="fileCount" style="float: right; font-weight: bold;">0 / ${uploadConfig.maxFiles} file</span>
                            </p>
                        </div>
                        
                        <!-- Existing Files (for edit) -->
                        <div id="existingFilesContainer"></div>
                        
                        <!-- File Input -->
                        <div class="form-group">
                            <label>
                                <i class="fas fa-upload"></i> Upload File Baru
                            </label>
                            <input 
                                type="file" 
                                id="realisasiFileInput" 
                                accept=".pdf,.jpg,.jpeg,.png,.gif"
                                multiple
                                onchange="handleFileInputChange(event)"
                                style="display: block; width: 100%; padding: 10px; border: 2px dashed #ddd; border-radius: 4px; cursor: pointer;">
                            <small style="color: #999; display: block; margin-top: 5px;">
                                Klik atau drag & drop file untuk upload (bisa pilih multiple files)
                            </small>
                        </div>
                        
                        <!-- Uploaded Files Display -->
                        <div id="uploadedFilesContainer" style="margin-top: 15px;">
                            <p style="color: #999; font-size: 14px;">Belum ada file yang dipilih</p>
                        </div>
                    </div>
                    
                    <!-- Hidden input untuk existing files -->
                    <input type="hidden" id="existingFilesData" value='${JSON.stringify(existingFiles)}'>
                    
                </div>
                
                <div class="modal-footer">
                    <button type="button" class="btn" onclick="closeRealisasiModal()">Batal</button>
                    <button type="submit" class="btn btn-success">Simpan</button>
                </div>
            </form>
        </div>
    `;
    
    modal.classList.add('active');

    // ✅ FIX #1: Build existing files HTML dengan preview dan tombol hapus
    if (existingFiles.length > 0) {
        displayExistingFiles(existingFiles);
    }

    updateFileCount();

    // ✅ FIX #1: Setup auto-format untuk semua input
    setTimeout(() => {
        console.log('[REALISASI MODAL] ========== SETUP AUTO-FORMAT START ==========');
        setupAllAutoFormatInputs('.auto-format-number');
        
        const inputs = document.querySelectorAll('.realisasi-input');
        inputs.forEach(input => {
            input.addEventListener('input', calculateRealisasiTotal);
        });
        
        calculateRealisasiTotal();
    }, 150);

    
    // Event Handlers
    if (realisasi) {
        // Untuk edit: load RPD data langsung
        setTimeout(() => {
            loadRPDDataFromSelect();
            
            // Populate existing realisasi values
            if (realisasi.data) {
                Object.entries(realisasi.data).forEach(([code, items]) => {
                    Object.entries(items).forEach(([item, value]) => {
                        const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
                        const input = document.getElementById(inputId);
                        if (input) {
                            input.value = value;
                            // Trigger format
                            input.dispatchEvent(new Event('input'));
                        }
                    });
                });
            }
        }, 200);
    } else if (availableRPDs.length > 0) {
        // Untuk tambah baru: select RPD pertama otomatis
        setTimeout(() => {
            const selectRPD = document.getElementById('realisasiRPD');
            if (selectRPD && selectRPD.options.length > 1) {
                selectRPD.selectedIndex = 1; // Select first RPD
                loadRPDDataFromSelect();
            }
        }, 100);
    }
    
    // ✅ FIX #1: Updated form submit handler dengan existing files
    const form = document.getElementById('realisasiForm');
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        console.log('[REALISASI FORM] Form submitted');
        
        const monthSelect = document.getElementById('realisasiMonth');
        const yearInput = document.getElementById('realisasiYear');
        
        const month = monthSelect.value;
        const year = parseInt(yearInput.value);
        
        console.log('[REALISASI FORM] Month:', month, 'Year:', year);
        
        if (!month || !year) {
            showNotification('Bulan dan Tahun harus diisi', 'error');
            return;
        }
        
        // Collect data
        const realisasiData = {};
        let total = 0;
        
        Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
            realisasiData[code] = {};
            
            param.items.forEach(item => {
                const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
                const input = document.getElementById(inputId);
                
                if (input) {
                    const value = parseFormattedNumber(input.value);
                    realisasiData[code][item] = value;
                    total += value;
                }
            });
        });
        
        console.log('[REALISASI FORM] Data collected:', { realisasiData, total });
        
        // ✅ VALIDASI BUDGET: Operator KUA tidak boleh melebihi sisa budget tahunan
        if (currentUser && currentUser.role === 'Operator KUA') {
            const sisaBudgetEl = document.getElementById('sisaBudgetInfo');
            const budgetEl = document.getElementById('budgetInfo');
            const sisaBudgetRaw = sisaBudgetEl ? parseFormattedNumber(sisaBudgetEl.textContent) : 0;
            const budgetRaw = budgetEl ? parseFormattedNumber(budgetEl.textContent) : 0;

            if (budgetRaw > 0 && total > sisaBudgetRaw) {
                const selisih = total - sisaBudgetRaw;
                showNotification(
                    `Total realisasi ${formatCurrency(total)} melebihi sisa budget ${formatCurrency(sisaBudgetRaw)} (kelebihan: ${formatCurrency(selisih)}). Silakan kurangi nominal.`,
                    'error'
                );
                console.warn('[REALISASI FORM] Budget exceeded:', { total, sisaBudget: sisaBudgetRaw, selisih });
                return;
            }
        }
        // Check if there are any files (existing or new)
        let hasFiles = false;
        
        const existingFilesInput = document.getElementById('existingFilesData');
        if (existingFilesInput && existingFilesInput.value) {
            try {
                const existing = JSON.parse(existingFilesInput.value);
                if (Array.isArray(existing) && existing.length > 0) {
                    hasFiles = true;
                }
            } catch (e) {
                console.error('[REALISASI FORM] Error parsing existing files:', e);
            }
        }
        
        // Check new uploaded files
        if (uploadedFiles.length > 0) {
            hasFiles = true;
        }
        
        if (!hasFiles) {
            showNotification('Upload Dokumen LPJ wajib diisi. Silakan upload minimal 1 file.', 'error');
            return;
        }
        
        // ✅ FIX ISSUE #1: Handle files properly
        let allFiles = [];
        
        // 1. Get existing files
        if (existingFilesInput && existingFilesInput.value) {
            try {
                const existing = JSON.parse(existingFilesInput.value);
                if (Array.isArray(existing)) {
                    allFiles = [...existing];
                    console.log('[REALISASI FORM] Keeping existing files:', allFiles.length);
                }
            } catch (e) {
                console.error('[REALISASI FORM] Error parsing existing files:', e);
            }
        }
        
        // 2. Upload new files
        if (uploadedFiles.length > 0) {
            console.log('[REALISASI FORM] Uploading new files:', uploadedFiles.length);
            
            for (let i = 0; i < uploadedFiles.length; i++) {
                const file = uploadedFiles[i];
                console.log('[REALISASI FORM] Uploading file', (i + 1), ':', file.fileName);
                
                try {
                    const uploadResult = await apiCall('uploadFile', {
                        filename: file.fileName,
                        fileData: file.fileData,
                        mimeType: file.mimeType
                    });
                    
                    console.log('[REALISASI FORM] File uploaded:', uploadResult);
                    
                    // ✅ Build proper file object
                    const fileObj = {
                        fileId: uploadResult.id || uploadResult.fileId || '',
                        fileName: uploadResult.originalName || file.fileName,
                        uniqueName: uploadResult.name || file.fileName,
                        fileUrl: uploadResult.url || uploadResult.fileUrl || '',
                        mimeType: uploadResult.mimeType || file.mimeType,
                        size: uploadResult.fileSize || file.fileSize || 0,
                        uploadPath: uploadResult.uploadPath || ''
                    };
                    
                    console.log('[REALISASI FORM] File object:', fileObj);
                    
                    // Validate
                    if (fileObj.fileName && fileObj.fileUrl) {
                        allFiles.push(fileObj);
                        console.log('[REALISASI FORM] File added to array');
                    } else {
                        console.error('[REALISASI FORM] Invalid file object:', fileObj);
                    }
                    
                } catch (error) {
                    console.error('[REALISASI FORM] Upload error:', error);
                    showNotification('Gagal upload file: ' + file.fileName, 'error');
                    return;
                }
            }
        }
        
        console.log('[REALISASI FORM] Total files to submit:', allFiles.length);
        console.log('[REALISASI FORM] Files array:', allFiles);
        
        // ✅ CRITICAL: Validate all files have required fields
        const validFiles = allFiles.filter(f => {
            const isValid = f && f.fileName && f.fileUrl;
            if (!isValid) {
                console.error('[REALISASI FORM] Invalid file filtered out:', f);
            }
            return isValid;
        });
        
        if (validFiles.length !== allFiles.length) {
            console.warn('[REALISASI FORM] Some files were invalid and filtered out');
            console.warn('[REALISASI FORM] Valid files:', validFiles.length, '/ Total:', allFiles.length);
        }
        
        // Prepare submission data
        const submissionData = {
            id: realisasi ? realisasi.id : null,
            kua: currentUser.kua,
            month: month,
            year: year,
            data: realisasiData,
            total: total,
            files: allFiles,  // ✅ Send all files
            userId: currentUser.id,
            username: currentUser.username,
            role: currentUser.role   // ✅ Sertakan role agar server bisa validasi budget
        };
        
        console.log('[REALISASI FORM] Submitting:', submissionData);
        console.log('[REALISASI FORM] Files count:', submissionData.files.length);
        
        try {
            await apiCall('saveRealisasi', submissionData);
            
            showNotification('Realisasi berhasil disimpan', 'success');
            
            // Reset
            uploadedFiles = [];
            
            // Close modal dengan benar
            closeRealisasiModal();
            
            // Reload data
            await loadRealisasis(true);
            await loadDashboardStats(true);
            
        } catch (error) {
            console.error('[REALISASI FORM ERROR]', error);
            showNotification('Gagal menyimpan: ' + error.message, 'error');
        }
    });
}

function removeExistingFile(index) {
    console.log('[REMOVE_FILE] Removing file at index:', index);
    
    const existingFilesInput = document.getElementById('existingFilesData');
    if (!existingFilesInput) {
        console.error('[REMOVE_FILE] existingFilesData input not found');
        return;
    }
    
    try {
        let files = JSON.parse(existingFilesInput.value);
        console.log('[REMOVE_FILE] Current files:', files);
        
        // Remove file at index
        const removedFile = files.splice(index, 1);
        console.log('[REMOVE_FILE] Removed file:', removedFile);
        
        // Update hidden input
        existingFilesInput.value = JSON.stringify(files);
        
        console.log('[REMOVE_FILE] Remaining files:', files);
        showNotification('File dihapus dari daftar upload', 'info');
        
        // Re-render existing files display
        displayExistingFiles(files);
        updateFileCount();
        
    } catch (e) {
        console.error('[REMOVE_FILE] Error:', e);
        showNotification('Gagal menghapus file', 'error');
    }
}

function previewFile(file) {
    console.log('[PREVIEW_FILE] Opening preview for:', file.fileName);
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.style.zIndex = '10001';
    
    let previewContent = '';
    
    if (file.mimeType === 'application/pdf') {
        // PDF Preview
        const pdfUrl = file.fileUrl || file.url;
        
        if (pdfUrl) {
            const embedUrl = pdfUrl.replace('/view', '/preview');
            previewContent = `
                <iframe 
                    src="${embedUrl}" 
                    style="width: 100%; height: 600px; border: none;"
                    frameborder="0">
                </iframe>
            `;
        } else {
            previewContent = '<p>URL file tidak tersedia</p>';
        }
        
    } else if (file.mimeType && file.mimeType.startsWith('image/')) {
        // Image Preview
        const imageUrl = file.fileUrl || file.url;
        
        if (imageUrl) {
            // Convert Google Drive URL to direct image URL
            let directUrl = imageUrl;
            
            if (imageUrl.includes('drive.google.com')) {
                const fileId = imageUrl.match(/[-\w]{25,}/)?.[0];
                if (fileId) {
                    directUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
                }
            }
            
            previewContent = `
                <img 
                    src="${directUrl}" 
                    style="max-width: 100%; max-height: 600px; object-fit: contain;"
                    alt="${file.fileName}">
            `;
        } else {
            previewContent = '<p>URL file tidak tersedia</p>';
        }
    } else {
        previewContent = '<p>Preview tidak tersedia untuk tipe file ini</p>';
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow: auto;">
            <div class="modal-header">
                <h3>${file.fileName}</h3>
                <button class="btn-close" onclick="this.closest('.modal').remove()">×</button>
            </div>
            <div class="modal-body" style="padding: 20px; text-align: center;">
                ${previewContent}
            </div>
            <div class="modal-footer">
                <a href="${file.fileUrl || file.url}" target="_blank" class="btn">
                    <i class="fas fa-external-link-alt"></i> Buka di Tab Baru
                </a>
                <button class="btn" onclick="this.closest('.modal').remove()">Tutup</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function loadRPDDataFromSelect() {
    console.log('[LOAD_RPD_DATA_FROM_SELECT] Loading RPD data from select');
    
    const selectRPD = document.getElementById('realisasiRPD');
    const selectedOption = selectRPD.options[selectRPD.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) {
        console.warn('[LOAD_RPD_DATA_FROM_SELECT] No RPD selected');
        // Clear parameters
        const parametersDiv = document.getElementById('realisasiParameters');
        if (parametersDiv) {
            parametersDiv.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Pilih RPD untuk menampilkan form input</p>';
        }
        return;
    }
    
    // Set hidden month and year fields
    const month = selectedOption.dataset.month;
    const year = selectedOption.dataset.year;
    
    document.getElementById('realisasiMonth').value = month;
    document.getElementById('realisasiYear').value = year;
    
    console.log('[LOAD_RPD_DATA_FROM_SELECT] Month:', month, 'Year:', year);
    
    try {
        const rpdData = JSON.parse(selectedOption.dataset.rpdData);
        console.log('[LOAD_RPD_DATA_FROM_SELECT] RPD data loaded:', rpdData);
        
        // Build parameters HTML with RPD data
        let parametersHTML = '<h4 style="margin: 20px 0 15px 0; color: #333;">Input Realisasi per Akun</h4>';
        
        Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
            parametersHTML += `
                <div class="rpd-item">
                    <h4>${code} - ${param.name}</h4>
            `;
            
            param.items.forEach(item => {
                const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
                const rpdValue = rpdData[code] && rpdData[code][item] ? rpdData[code][item] : 0;
                
                parametersHTML += `
                    <div class="rpd-subitem realisasi-subitem">
                        <label style="margin: 0;">${item}</label>
                        <div style="text-align: right; padding: 10px; background: #e9ecef; border-radius: 6px;">
                            <small style="display: block; color: #666; font-size: 11px;">Anggaran RPD</small>
                            <strong style="color: #333; font-size: 14px;">${formatCurrency(rpdValue)}</strong>
                        </div>
                        <div class="sisa-box"
                             data-code="${code}"
                             data-item="${item}"
                             data-input-id="${inputId}">
                            <small class="sisa-label">Sisa Anggaran (Setahun)</small>
                            <strong class="sisa-value">...</strong>
                            <span class="sisa-note"></span>
                        </div>
                        <input type="text" 
                               id="${inputId}"
                               class="realisasi-input auto-format-number"
                               data-code="${code}"
                               data-item="${item}"
                               data-rpd-value="${rpdValue}"
                               value="0" 
                               placeholder="Input Realisasi"
                               style="text-align: right;">
                    </div>
                `;
            });
            
            parametersHTML += `</div>`;
        });
        
        // Update the parameters section
        const parametersDiv = document.getElementById('realisasiParameters');
        if (parametersDiv) {
            parametersDiv.innerHTML = parametersHTML;
            
            // Setup auto-format untuk input baru
            setTimeout(() => {
                console.log('[LOAD_RPD_DATA_FROM_SELECT] Setting up auto-format for new inputs');
                setupAllAutoFormatInputs('.auto-format-number');
                
                // Attach listeners to new inputs
                const inputs = document.querySelectorAll('.realisasi-input');
                inputs.forEach(input => {
                    input.addEventListener('input', calculateRealisasiTotal);
                    // ✅ Update field "Sisa Anggaran (Setahun)" setiap ada perubahan input
                    input.addEventListener('input', updateRealisasiSisaFields);
                    // Auto-update AP summary on every keystroke
                    input.addEventListener('input', () => {
                        if (month && year && currentUser && currentUser.kua) {
                            apRenderFormModalSummary(currentUser.kua, month, parseInt(year));
                        }
                    });
                });
                
                calculateRealisasiTotal();
                updateRealisasiSisaFields();
                
                // ✅ Auto Payment: disable POS aktif jika ada config
                if (month && year && currentUser && currentUser.kua) {
                    apApplyToForm(currentUser.kua, month, parseInt(year)).then(() => {
                        apRenderFormModalSummary(currentUser.kua, month, parseInt(year));
                    }).catch(() => {});
                }
            }, 100);
        }
        
    } catch (error) {
        console.error('[LOAD_RPD_DATA_FROM_SELECT ERROR]', error);
        showNotification('Gagal memuat data RPD', 'error');
    }
}

function loadRPDDataForRealisasi() {
    console.log('[LOAD_RPD_DATA] Loading RPD data for selected month');
    
    const selectMonth = document.getElementById('realisasiMonth');
    const selectedOption = selectMonth.options[selectMonth.selectedIndex];
    
    if (!selectedOption || !selectedOption.dataset.rpdData) {
        console.warn('[LOAD_RPD_DATA] No RPD data in selected option');
        return;
    }
    
    try {
        const rpdData = JSON.parse(selectedOption.dataset.rpdData);
        console.log('[LOAD_RPD_DATA] RPD data loaded:', rpdData);
        
        // Build parameters HTML with RPD data
        let parametersHTML = '';
        
        Object.entries(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(([code, param]) => {
            parametersHTML += `
                <div class="rpd-item">
                    <h4>${code} - ${param.name}</h4>
            `;
            
            param.items.forEach(item => {
                const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
                const rpdValue = rpdData[code] && rpdData[code][item] ? rpdData[code][item] : 0;
                
                parametersHTML += `
                    <div class="rpd-subitem" style="grid-template-columns: 2fr 1fr 1fr; gap: 10px;">
                        <label>${item}</label>
                        <div style="text-align: right; padding: 10px; background: #e9ecef; border-radius: 6px;">
                            <small style="display: block; color: #666; font-size: 11px;">RPD</small>
                            <strong style="color: #333;">${formatCurrency(rpdValue)}</strong>
                        </div>
                        <input type="text" 
                               id="${inputId}"
                               class="realisasi-input auto-format-number"
                               data-code="${code}"
                               data-item="${item}"
                               value="0" 
                               placeholder="Realisasi">
                    </div>
                `;
            });
            
            parametersHTML += `</div>`;
        });
        
        // Update the parameters section
        const parametersDiv = document.getElementById('realisasiParameters');
        if (parametersDiv) {
            parametersDiv.innerHTML = parametersHTML;
            
            // ✅ FIX #3: Setup auto-format untuk input baru
            setTimeout(() => {
                console.log('[LOAD_RPD_DATA] Setting up auto-format for new inputs');
                setupAllAutoFormatInputs('.auto-format-number');
                
                // Attach listeners to new inputs
                const inputs = document.querySelectorAll('.realisasi-input');
                const apKua2   = currentUser && currentUser.kua;
                const rMonth2  = selectedOption.dataset.month || selectedOption.value || '';
                const rYear2   = parseInt(selectedOption.dataset.year || new Date().getFullYear());
                inputs.forEach(input => {
                    input.addEventListener('input', calculateRealisasiTotal);
                    input.addEventListener('input', () => {
                        if (apKua2 && rMonth2) apRenderFormModalSummary(apKua2, rMonth2, rYear2);
                    });
                });
                
                calculateRealisasiTotal();
                
                // ✅ Auto Payment: disable POS aktif jika ada config
                if (apKua2 && rMonth2) {
                    apApplyToForm(apKua2, rMonth2, rYear2).then(() => {
                        apRenderFormModalSummary(apKua2, rMonth2, rYear2);
                    }).catch(() => {});
                }
            }, 100);
        }
        
    } catch (error) {
        console.error('[LOAD_RPD_DATA ERROR]', error);
        showNotification('Gagal memuat data RPD', 'error');
    }
}

async function submitRealisasi(e) {
  e.preventDefault();
  
  showLoading();
  
  try {
    // Collect realisasi data
    const realisasiData = {};
    let total = 0;
    
    Object.keys(APP_CONFIG.BOP.RPD_PARAMETERS).forEach(code => {
      realisasiData[code] = {};
      APP_CONFIG.BOP.RPD_PARAMETERS[code].items.forEach(item => {
        const inputId = `realisasi_${code}_${item.replace(/\s+/g, '_')}`;
        const value = parseFloat(document.getElementById(inputId)?.value) || 0;
        realisasiData[code][item] = value;
        total += value;
      });
    });
    
    // Handle file uploads
    // ✅ FIX: form tidak punya elemen #realisasiFiles (dulu selalu throw di sini).
    // File yang sudah dipilih user sudah di-base64-kan & ditampung di global
    // `uploadedFiles` oleh handleFileInputChange() saat file dipilih — upload
    // ke Drive dilakukan di sini, saat submit.
    const files = [];
    for (const f of uploadedFiles) {
      const uploadResult = await apiCall('uploadFile', {
        filename: sanitizeFileName(f.fileName), // ✅ FIX: Sanitize filename
        fileData: f.fileData,
        mimeType: f.mimeType,
        originalName: f.fileName // Keep original for display purposes
      });
      files.push(uploadResult);
    }
    // Gabungkan dengan file lama yang tidak dihapus (mode edit)
    const existingFilesInput = document.getElementById('existingFilesData');
    let existingFiles = [];
    if (existingFilesInput && existingFilesInput.value) {
      try { existingFiles = JSON.parse(existingFilesInput.value) || []; } catch (e) { existingFiles = []; }
    }
    const allFiles = existingFiles.concat(files);
    
    // Submit realisasi
    // ✅ FIX: id realisasi yang sedang diedit dibaca dari atribut data-editing-id
    // pada <form id="realisasiForm"> (global `editingRealisasi` sebelumnya tidak
    // pernah didefinisikan sehingga baris ini selalu throw ReferenceError).
    const formEl = document.getElementById('realisasiForm');
    const editingId = formEl?.dataset.editingId || undefined;
    const submitData = {
      id: editingId,
      kua: currentUser.kua,
      userId: currentUser.id,
      username: currentUser.username, // ✅ FIX: sebelumnya tidak dikirim, kolom Username selalu kosong
      role: currentUser.role,         // ✅ FIX: dibutuhkan agar validasi budget/RPD di server tahu Admin vs Operator KUA
      month: document.getElementById('realisasiMonth').value,
      year: document.getElementById('realisasiYear')?.value || new Date().getFullYear(),
      data: realisasiData,
      total: total,
      files: allFiles
    };
    
    console.log('[REALISASI FORM] Submitting with', allFiles.length, 'files');
    
    const result = await apiCall('saveRealisasi', submitData);
    
    hideLoading();
    showNotification(result.message || 'Realisasi berhasil disimpan', 'success');
    uploadedFiles = []; // ✅ reset agar tidak terbawa ke form berikutnya
    closeModal();
    loadRealisasis();
    
  } catch (error) {
    hideLoading();
    console.error('[REALISASI FORM ERROR]', error);
    showNotification(error.message || 'Gagal menyimpan realisasi', 'error');
  }
}

async function continueToRealisasiForm() {
    console.log('[REALISASI] Continuing to form');
    
    const select = document.getElementById('selectRPDMonth');
    if (!select || !select.value) {
        showNotification('Pilih bulan terlebih dahulu', 'warning');
        return;
    }
    
    const selectedOption = select.options[select.selectedIndex];
    const rpd = JSON.parse(selectedOption.dataset.rpd);
    
    console.log('[REALISASI] Selected RPD:', rpd);
    
    // Close current modal and show form
    await showRealisasiForm(rpd, null);
}

async function showRealisasiForm(rpd, realisasi = null) {
    console.log('[REALISASI FORM] Showing form for RPD:', rpd);
    console.log('[REALISASI FORM] Existing realisasi:', realisasi);
    
    // Get max file info from config
    let maxFileSize = '5';
    let maxFiles = '10';
    try {
        const config = await apiCall('getRPDConfig');
        maxFileSize = config.REALISASI_MAX_FILE_SIZE || '5';
        maxFiles = config.REALISASI_MAX_FILES || '10';
    } catch (error) {
        console.warn('[REALISASI] Failed to get config for file info');
    }
    
    // Create modal if doesn't exist
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px;">
            <div class="modal-header">
                <h3>${realisasi ? 'Edit' : 'Buat'} Realisasi - ${rpd.month} ${rpd.year}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            
            <form id="realisasiForm">
                <div class="summary-box" id="realisasiBudgetInfo"></div>
                <div id="realisasiParameters"></div>
                
                <div class="form-group">
                    <label>Upload Dokumen Pendukung (Opsional)</label>
                    <div class="file-upload" id="fileUploadArea">
                        <p>📎 Klik untuk upload file</p>
                        <small>Format: PDF, JPG, PNG | Maksimal ${maxFileSize}MB per file, maksimal ${maxFiles} file</small>
                    </div>
                    <input type="file" id="fileInput" multiple accept=".pdf,.jpg,.jpeg,.png" style="display: none;">
                    <div class="file-list" id="fileList"></div>
                </div>
                
                <div class="summary-box">
                    <div class="summary-item">
                        <span>Total Realisasi:</span>
                        <strong id="realisasiTotal">${formatCurrency(0)}</strong>
                    </div>
                </div>
                
                <button type="submit" class="btn">💾 Simpan Realisasi</button>
            </form>
        </div>
    `;
    
    modal.classList.add('active');
    
    // Reset uploaded files if new realisasi
    if (!realisasi) {
        uploadedFiles = [];
    }
    
    // Load form content
    await showRealisasiInputs(rpd, realisasi);
}

async function showRealisasiEditForm(rpd, realisasi) {
    console.log('[REALISASI EDIT] Loading edit form for:', realisasi.id);
    console.log('[REALISASI EDIT] Realisasi object:', realisasi);
    console.log('[REALISASI EDIT] Files in realisasi:', realisasi.files);
    
    // RESET uploadedFiles SEBELUM membuat modal
    uploadedFiles = [];
    
    // RESTORE files JIKA ada
    if (realisasi.files && Array.isArray(realisasi.files) && realisasi.files.length > 0) {
        console.log('[FILE] Restoring existing files:', realisasi.files.length);
        
        uploadedFiles = realisasi.files.map(file => {
            if (file && file.fileName && file.fileId) {
                return {
                    fileId: file.fileId,
                    fileName: file.fileName,
                    fileUrl: file.fileUrl,
                    mimeType: file.mimeType || 'application/octet-stream',
                    size: file.size || 0
                };
            }
            return null;
        }).filter(f => f !== null);
        
        console.log('[FILE] Files restored successfully:', uploadedFiles.length);
    }
    
    // Use the same form function
    await showRealisasiForm(rpd, realisasi);
}

async function showRealisasiInputs(rpd, realisasi = null) {
    console.log('[REALISASI] Showing inputs for RPD:', rpd);
    console.log('[REALISASI] Existing realisasi data:', realisasi);
    console.log('[FILE] Current uploadedFiles length:', uploadedFiles.length);
    
    // Get budget and realisasi info
    let realisasiBudgetInfo = { 
        budget: 0, 
        totalRealisasi: 0, 
        sisaBudget: 0 
    };
    
    try {
        const yearFilter = document.getElementById('realisasiYearFilter');
        const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
        
        const budgets = await apiCall('getBudgets', { 
            kua: currentUser.kua, 
            year: year 
        });
        
        if (budgets && budgets.length > 0) {
            const budget = budgets[0];
            
            // ✅ FIX: Normalisasi field yang tidak konsisten
            const budgetTotal = parseFloat(budget.total) || parseFloat(budget.budget) || 0;
            const totalRealisasi = parseFloat(budget.totalRealisasi) || parseFloat(budget.realisasi) || 0;
            
            realisasiBudgetInfo = {
                budget: budgetTotal,
                totalRealisasi: totalRealisasi,
                sisaBudget: budgetTotal - totalRealisasi
            };
            
            console.log('[REALISASI MODAL] Budget info:', realisasiBudgetInfo);
        }
    } catch (error) {
        console.error('[REALISASI ERROR] Failed to get budget:', error);
    }
    
    document.getElementById('realisasiBudgetInfo').innerHTML = `
        <div class="summary-item">
            <span>Budget Tahunan:</span>
            <strong>${formatCurrency(budgetInfo.budget)}</strong>
        </div>
        <div class="summary-item">
            <span>Nominal RPD ${rpd.month}:</span>
            <strong>${formatCurrency(rpd.total)}</strong>
        </div>
        <div class="summary-item">
            <span>Sisa Budget Tahunan:</span>
            <strong>${formatCurrency(budgetInfo.sisaBudget)}</strong>
        </div>
    `;
    
    const realisasiData = realisasi ? realisasi.data : {};
    let parametersHTML = '';
    
    Object.entries(rpd.data).forEach(([code, items]) => {
        const param = APP_CONFIG.BOP.RPD_PARAMETERS[code];
        parametersHTML += `<div class="rpd-item">
            <h4>${code} - ${param.name}</h4>`;
        
        Object.entries(items).forEach(([item, rpdValue]) => {
            const realValue = realisasiData[code] && realisasiData[code][item] ? realisasiData[code][item] : 0;
            parametersHTML += `
                <div class="rpd-subitem" style="grid-template-columns: 2fr 1fr 1fr; gap: 10px;">
                    <label>${item}</label>
                    <div style="text-align: right; padding: 10px; background: #e9ecef; border-radius: 6px;">
                        <small style="display: block; color: #666; font-size: 11px;">RPD</small>
                        <strong style="color: #333;">${formatCurrency(rpdValue)}</strong>
                    </div>
                    <input type="number" 
                        class="realisasi-input" 
                        data-code="${code}" 
                        data-item="${item}" 
                        value="${realValue}" 
                        min="0"
                        step="1000"
                        placeholder="Realisasi">
                </div>
            `;
        });
        
        parametersHTML += `</div>`;
    });
    
    document.getElementById('realisasiParameters').innerHTML = parametersHTML;
    
    // Calculate total on input change
    const inputs = document.querySelectorAll('.realisasi-input');
    inputs.forEach(input => {
        input.addEventListener('input', calculateRealisasiTotal);
        // Auto-update AP summary on every keystroke
        input.addEventListener('input', () => {
            if (realisasi && realisasi.kua && realisasi.month && realisasi.year) {
                apRenderFormModalSummary(realisasi.kua, realisasi.month, realisasi.year);
            }
        });
    });
    calculateRealisasiTotal();
    
    // ✅ Auto Payment: disable POS aktif saat edit
    setTimeout(() => {
        if (realisasi && realisasi.kua && realisasi.month && realisasi.year) {
            apApplyToForm(realisasi.kua, realisasi.month, realisasi.year).then(() => {
                apRenderFormModalSummary(realisasi.kua, realisasi.month, realisasi.year);
            }).catch(() => {});
        }
    }, 150);
    
    // Display existing files dengan preview
    console.log('[FILE] Displaying files, count:', uploadedFiles.length);
    displayUploadedFilesWithPreview();
    
    // Setup file input - PERBAIKAN DI SINI
    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');
    
    console.log('[FILE] File upload area found:', fileUploadArea !== null);
    console.log('[FILE] File input element found:', fileInput !== null);
    
    if (fileUploadArea && fileInput) {
        // Remove old event listeners by cloning
        const newFileUploadArea = fileUploadArea.cloneNode(true);
        const newFileInput = fileInput.cloneNode(true);
        
        fileUploadArea.parentNode.replaceChild(newFileUploadArea, fileUploadArea);
        fileInput.parentNode.replaceChild(newFileInput, fileInput);
        
        // Add click event to upload area
        newFileUploadArea.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[FILE] Upload area clicked');
            newFileInput.click();
        });
        
        // Add change event to file input
        newFileInput.addEventListener('change', function(e) {
            console.log('[FILE] File input change event triggered');
            console.log('[FILE] Files selected:', e.target.files.length);
            handleFileUpload(e);
        });
        
        console.log('[FILE] Event listeners attached successfully');
    } else {
        console.error('[FILE ERROR] File upload elements not found!');
    }
    
    // Form submit handler
    const realisasiForm = document.getElementById('realisasiForm');
    console.log('[FORM] Form element found:', realisasiForm !== null);

    if (realisasiForm) {
        // Remove existing listener by cloning
        const newForm = realisasiForm.cloneNode(true);
        realisasiForm.parentNode.replaceChild(newForm, realisasiForm);
        
        // Re-attach all event listeners to inputs in new form
        const newInputs = newForm.querySelectorAll('.realisasi-input');
        newInputs.forEach(input => {
            input.addEventListener('input', function() {
                calculateRealisasiTotal();
                modalHasChanges = true; // ✅ Track changes
            });
        });
        
        // Re-attach file upload listeners
        const newFileUploadArea2 = newForm.querySelector('#fileUploadArea');
        const newFileInput2 = newForm.querySelector('#fileInput');
        
        if (newFileUploadArea2 && newFileInput2) {
            newFileUploadArea2.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('[FILE] Upload area clicked (form clone)');
                newFileInput2.click();
            });
            
            newFileInput2.addEventListener('change', function(e) {
                console.log('[FILE] File input change (form clone)');
                handleFileUpload(e);
            });
        }
        
        // Add submit handler
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[REALISASI] ========== FORM SUBMIT START ==========');
            console.log('[REALISASI] Submitting realisasi form');
            console.log('[FILE] Total files to submit:', uploadedFiles.length);
            
            const realisasiDataToSave = {};
            let total = 0;
            
            newForm.querySelectorAll('.realisasi-input').forEach(input => {
                const code = input.dataset.code;
                const item = input.dataset.item;
                const value = parseFloat(input.value) || 0;
                
                if (!realisasiDataToSave[code]) realisasiDataToSave[code] = {};
                realisasiDataToSave[code][item] = value;
                total += value;
            });
            
            try {
                let newStatus = realisasi ? normalizeStatus(realisasi.status) : STATUS.WAITING;
                if (realisasi && normalizeStatus(realisasi.status) === STATUS.REJECTED) {
                    newStatus = STATUS.WAITING;
                    console.log('[REALISASI] Status changed from Rejected to Waiting');
                }
                
                // Upload files to Google Drive first
                const uploadedFileIds = [];
                
                if (uploadedFiles.length > 0) {
                    console.log('[FILE] Uploading', uploadedFiles.length, 'files to Google Drive');
                    showLoading();
                    
                    for (let i = 0; i < uploadedFiles.length; i++) {
                        const file = uploadedFiles[i];
                        
                        // Skip files yang sudah ada fileId
                        if (file.fileId) {
                            console.log(`[FILE] File ${i + 1} already uploaded:`, file.fileName);
                            uploadedFileIds.push({
                                fileId: file.fileId,
                                fileName: file.fileName,
                                fileUrl: file.fileUrl,
                                mimeType: file.mimeType,
                                size: file.size
                            });
                            continue;
                        }
                        
                        // Upload file baru
                        console.log(`[FILE] Uploading file ${i + 1}/${uploadedFiles.length}:`, file.fileName);
                        
                        try {
                            const uploadResult = await apiCall('uploadFile', {
                                fileName: file.fileName,
                                fileData: file.fileData,
                                mimeType: file.mimeType,
                                kua: currentUser.kua,
                                month: rpd.month,
                                year: rpd.year
                            });
                            
                            console.log(`[FILE] Upload successful:`, uploadResult);
                            
                            uploadedFileIds.push({
                                fileId: uploadResult.fileId,
                                fileName: uploadResult.fileName,
                                fileUrl: uploadResult.fileUrl,
                                mimeType: file.mimeType,
                                size: file.size
                            });
                        } catch (uploadError) {
                            console.error(`[FILE] Upload failed for ${file.fileName}:`, uploadError);
                            hideLoading();
                            showNotification(`Gagal upload file ${file.fileName}: ${uploadError.message}`, 'error');
                            return;
                        }
                    }
                    
                    hideLoading();
                    console.log('[FILE] All files uploaded successfully:', uploadedFileIds.length);
                }
                
                console.log('[REALISASI] Preparing data to send...');
                
                const payload = {
                    id: realisasi ? realisasi.id : null,
                    kua: currentUser.kua,
                    userId: currentUser.id,
                    username: currentUser.username,
                    role: currentUser.role,
                    month: rpd.month,
                    year: rpd.year,
                    rpdId: rpd.id,
                    realisasiData: realisasiDataToSave,
                    total: total,
                    files: uploadedFileIds,
                    status: newStatus
                };
                
                await apiCall('saveRealisasi', payload);
                
                console.log('[REALISASI] Save successful');
                
                // ✅ STEP 1: Hapus cache yang terkait
                console.log('[SAVE_REALISASI] Invalidating related cache');
                clearLocalCache('realisasis');     // Hapus cache realisasi
                clearLocalCache('dashboardStats'); // Hapus cache dashboard
                
                // ✅ STEP 2: Tutup modal
                closeModal();
                
                // ✅ STEP 3: Reload dengan FORCE REFRESH
                console.log('[SAVE_REALISASI] Reloading fresh data');
                await loadRealisasis(true);        // Force refresh realisasi
                await loadDashboardStats(true);    // Force refresh dashboard
                
                // ✅ STEP 4: Notifikasi
                showNotification('Realisasi berhasil disimpan', 'success');
                
                // ✅ Close modal without confirmation
                modalHasChanges = false; // Reset changes flag
                closeRealisasiModal(true); // Skip confirmation karena sudah saved
                
                console.log('[REALISASI] ========== FORM SUBMIT END ==========');
                
            } catch (error) {
                console.error('[REALISASI ERROR] Save failed:', error);
                console.log('[REALISASI] ========== FORM SUBMIT END (ERROR) ==========');
                showNotification(error.message, 'error');
            }
        });
        
        console.log('[FORM] Submit listener attached');        
    } else {
        console.error('[FORM ERROR] Form element not found!');
    }
}

// Tambahkan fungsi baru ini setelah fungsi displayUploadedFiles
function displayUploadedFilesWithPreview() {
    console.log('[FILE] ========== DISPLAY FILES WITH PREVIEW START ==========');
    const fileList = document.getElementById('fileList');
    console.log('[FILE] File list element:', fileList);
    
    if (!fileList) {
        console.error('[FILE ERROR] File list element not found!');
        console.log('[FILE] ========== DISPLAY FILES END (ERROR) ==========');
        return;
    }
    
    console.log('[FILE] Current uploadedFiles array length:', uploadedFiles.length);
    console.log('[FILE] Files to display:', uploadedFiles);
    
    if (uploadedFiles.length === 0) {
        console.log('[FILE] No files to display');
        fileList.innerHTML = '<p style="color: #999; font-style: italic; padding: 10px;">Belum ada file yang diupload</p>';
    } else {
        const html = uploadedFiles.map((file, index) => {
            if (!file || !file.fileName) {
                console.warn(`[FILE] Invalid file at index ${index}`);
                return '';
            }
            
            console.log(`[FILE] Creating HTML for file ${index}:`, file.fileName);
            
            const isImage = file.mimeType && file.mimeType.startsWith('image/');
            const isPDF = file.mimeType === 'application/pdf';
            const hasFileId = !!file.fileId; // File sudah diupload ke Drive
            
            let previewHTML = '';
            
            if (hasFileId) {
                // File dari Drive - gunakan preview URL
                const previewUrl = getDrivePreviewUrl(file.fileUrl, file.mimeType);
                console.log(`[FILE] Preview URL for ${file.fileName}:`, previewUrl);
                
                if (isImage) {
                    previewHTML = `
                        <div style="width: 100%; text-align: center; margin-top: 10px;">
                            <img src="${previewUrl}" 
                                alt="${file.fileName}" 
                                style="max-width: 100%; max-height: 300px; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
                                onclick="window.open('${file.fileUrl}', '_blank')"
                                onerror="this.onerror=null; this.src='https://drive.google.com/uc?export=view&id=${file.fileId || file.fileUrl.match(/[-\\w]{25,}/)?.[0]}'; if(this.complete && this.naturalHeight === 0) { this.style.display='none'; this.nextElementSibling.style.display='block'; }">
                            <div style="display: none; margin-top: 10px; padding: 10px; background: #e3f2fd; border-radius: 6px;">
                                <p style="color: #1976d2; margin: 0 0 10px 0; font-size: 12px;">🖼️ Preview tidak dapat dimuat</p>
                                <button type="button" class="btn btn-sm btn-info" onclick="window.open('${file.fileUrl}', '_blank')">Buka di Google Drive</button>
                            </div>
                        </div>
                    `;
                } else if (isPDF) {
                    previewHTML = `
                        <div style="width: 100%; margin-top: 10px;">
                            <iframe src="${previewUrl}" 
                                    style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 8px;"
                                    onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                            </iframe>
                            <div style="display: none; background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                <p style="color: #666; margin: 0 0 10px 0;">📄 File PDF</p>
                                <button type="button" class="btn btn-sm" onclick="window.open('${file.fileUrl}', '_blank')">Buka PDF</button>
                            </div>
                        </div>
                    `;
                }
            } else {
                // File baru yang belum diupload - preview dari base64
                if (isImage && file.fileData) {
                    previewHTML = `
                        <div style="width: 100%; text-align: center; margin-top: 10px;">
                            <img src="data:${file.mimeType};base64,${file.fileData}" 
                                alt="${file.fileName}" 
                                style="max-width: 100%; max-height: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        </div>
                    `;
                } else if (isPDF) {
                    previewHTML = `
                        <p style="color: #666; font-style: italic; margin-top: 10px; font-size: 12px;">
                            📄 Preview PDF akan tersedia setelah disimpan
                        </p>
                    `;
                }
            }
            
            return `
                <div class="file-item" style="flex-direction: column; align-items: flex-start; padding: 15px; margin-bottom: 15px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                        <div>
                            <span style="font-weight: 500;">📎 ${file.originalName || file.fileName}</span>
                            <small style="display: block; color: #666; margin-top: 5px;">
                                ${((file.size || 0) / 1024).toFixed(2)} KB
                                ${hasFileId ? '<span style="color: #28a745; margin-left: 10px;">✓ Tersimpan</span>' : '<span style="color: #ffc107; margin-left: 10px;">⚠ Belum tersimpan</span>'}
                            </small>
                        </div>
                        <div style="display: flex; gap: 5px;">
                            ${hasFileId ? `
                                <button type="button" class="btn btn-sm btn-info" onclick="window.open('${file.fileUrl}', '_blank')">Buka</button>
                            ` : ''}
                            <button type="button" class="btn btn-danger btn-sm" onclick="removeFileConfirm(${index})">Hapus</button>
                        </div>
                    </div>
                    ${previewHTML}
                </div>
            `;
        }).filter(html => html !== '').join('');
        
        console.log('[FILE] Setting fileList innerHTML');
        fileList.innerHTML = html;
        console.log('[FILE] File list updated with', uploadedFiles.length, 'files');
    }
    
    console.log('[FILE] ========== DISPLAY FILES WITH PREVIEW END ==========');
}

// ✅ BARU (v2 — per item, bukan per kode) — Cache konteks batas RPD untuk form
// realisasi yang sedang terbuka. Dihitung ulang hanya kalau KUA / bulan /
// tahun / (mode edit) berubah — bukan setiap keystroke.
//
// PENTING: sebagian kode akun (mis. 521111) punya beberapa item di dalamnya
// (ATK Kantor, Jamuan Tamu, dst). Konteks ini disimpan PER ITEM, bukan
// digabung per kode, supaya pos yang sudah lewat pagu tidak "tertutupi" oleh
// sisa pagu item lain dalam kode yang sama.
let _posLimitCache    = null;
let _posLimitCacheKey = '';

/**
 * Ambil (atau hitung ulang bila konteks berubah) total RPD setahun per
 * (kode,item), total realisasi Approved/Paid yang sudah terpakai setahun per
 * (kode,item) (AP-aware), dan data RPD bulan yang sedang diisi per (kode,item).
 * Dipakai untuk peringatan real-time di form — pemblokir yang sebenarnya
 * (otoritatif) ada di server (lihat _validateRealisasiAgainstRPD di
 * code-bop-enhanced.gs).
 */
async function _getRealisasiPosLimitContext(kua, month, year, excludeId) {
    const key = `${kua}|${month}|${year}|${excludeId || ''}`;
    if (_posLimitCache && _posLimitCacheKey === key) return _posLimitCache;

    let allRpds = getLocalCache('rpds');
    if (!allRpds) {
        try { allRpds = await apiCall('getRPDs', { kua, year }); } catch (e) { allRpds = []; }
    }
    let allReal = getLocalCache('realisasis');
    if (!allReal) {
        try { allReal = await apiCall('getRealisasis', { kua, year }); } catch (e) { allReal = []; }
    }
    allRpds = allRpds || [];
    allReal = allReal || [];

    // RPD setahun per (kode,item) + data RPD bulan berjalan per (kode,item)
    const rpdAnnual = {};    // rpdAnnual[code][item] = sum setahun
    let rpdMonthData = null; // {code:{item:val}} khusus bulan yg sedang diisi
    allRpds.forEach(r => {
        if (r.kua !== kua || String(r.year) !== String(year)) return;
        Object.entries(r.data || {}).forEach(([code, items]) => {
            if (!rpdAnnual[code]) rpdAnnual[code] = {};
            Object.entries(items).forEach(([item, v]) => {
                rpdAnnual[code][item] = (rpdAnnual[code][item] || 0) + (parseFloat(v) || 0);
            });
        });
        if (r.month === month) rpdMonthData = r.data || {};
    });

    // AP config + nominal per bulan yang relevan (utk konversi realisasi historis yg AP-aktif)
    const apCfg    = await apGetConfig();
    const kuaApCfg = apCfg[kua] || null;
    const relevantMonths = [...new Set(
        allReal.filter(r => r.kua === kua && String(r.year) === String(year)
                          && (normalizeStatus(r.status) === STATUS.APPROVED || normalizeStatus(r.status) === STATUS.PAID)
                          && r.id !== excludeId)
               .map(r => r.month)
    )];
    const nomByMonth = {};
    for (const m of relevantMonths) {
        try {
            const nomData = await apGetNominals(m, year);
            nomByMonth[m] = (nomData && nomData[kua]) ? nomData[kua] : {};
        } catch (e) { nomByMonth[m] = {}; }
    }

    // Total realisasi Approved/Paid yang sudah terpakai setahun, per (kode,item) (AP-aware)
    const used = {}; // used[code][item] = sum
    allReal.forEach(r => {
        if (r.kua !== kua || String(r.year) !== String(year)) return;
        if (normalizeStatus(r.status) !== STATUS.APPROVED && normalizeStatus(r.status) !== STATUS.PAID) return;
        if (r.id === excludeId) return;
        const nom = nomByMonth[r.month] || {};
        Object.entries(r.data || {}).forEach(([code, items]) => {
            const isAP = kuaApCfg && kuaApCfg[code] === true;
            if (!used[code]) used[code] = {};
            Object.keys(items).forEach(item => {
                const v = isAP
                    ? (parseFloat(nom[code] || 0) || 0) // kode AP selalu 1 item ("Nominal")
                    : (parseFloat(items[item]) || 0);
                used[code][item] = (used[code][item] || 0) + v;
            });
        });
    });

    _posLimitCache    = { rpdAnnual, used, rpdMonthData };
    _posLimitCacheKey = key;
    return _posLimitCache;
}

/** Label pos akun yang enak dibaca — sama seperti _posLabel di backend. */
function _posLabelClient(code, item) {
    const param = APP_CONFIG.BOP.RPD_PARAMETERS[code];
    const codeName = param ? param.name : code;
    return item === 'Nominal' ? codeName : `${codeName} — ${item}`;
}

/**
 * ✅ BARU — Isi field "Sisa Anggaran (Setahun)" di setiap pos akun pada form
 * realisasi (#realisasiModal):
 *
 *     Sisa = total RPD setahun pos tsb − total realisasi (Approved/Paid) pos tsb
 *
 * Nilai bisa NEGATIF (mis. RPD setahun Rp 0 tapi realisasi Jan–Jul sudah
 * Rp 690.000 → sisa −Rp 690.000). Realisasi yang sedang diedit tidak ikut
 * dihitung (excludeId), dan angka "setelah input ini" ikut berubah saat
 * operator mengetik.
 *
 * Sumber angka sama persis dengan validasi di server
 * (_validateRealisasiAgainstRPD), jadi yang terlihat di sini = yang dipakai
 * untuk memblokir simpan.
 */
async function updateRealisasiSisaFields() {
    const boxes = document.querySelectorAll('#realisasiParameters .sisa-box');
    if (!boxes.length) return;

    const formEl    = document.getElementById('realisasiForm');
    const excludeId = formEl?.dataset.editingId || null;
    const kua       = formEl?.dataset.kua || (currentUser && currentUser.kua) || '';
    const month     = document.getElementById('realisasiMonth')?.value;
    const year      = document.getElementById('realisasiYear')?.value || new Date().getFullYear();

    if (!kua || !month) {
        boxes.forEach(b => {
            const v = b.querySelector('.sisa-value');
            if (v) v.textContent = '-';
        });
        return;
    }

    let ctx, apCfg, apNomBulan = {};
    try {
        ctx   = await _getRealisasiPosLimitContext(kua, month, year, excludeId);
        apCfg = (await apGetConfig()) || {};
        // Nominal SAKTI bulan yang sedang diisi (per kode) — ikut mengurangi Sisa
        if (apCfg[kua]) {
            const nomData = await apGetNominals(month, year);
            apNomBulan = (nomData && nomData[kua]) ? nomData[kua] : {};
        }
    } catch (e) {
        console.warn('[SISA_FIELDS] Gagal memuat konteks (non-fatal):', e);
        boxes.forEach(b => {
            const v = b.querySelector('.sisa-value');
            if (v) v.textContent = 'N/A';
        });
        return;
    }

    const negativePos = [];
    boxes.forEach(box => {
        const code  = box.dataset.code;
        const item  = box.dataset.item;
        const input = document.getElementById(box.dataset.inputId);
        const valEl  = box.querySelector('.sisa-value');
        const noteEl = box.querySelector('.sisa-note');

        // Pos Auto Payment (SAKTI): input manual dikunci, tetapi nominal SAKTI bulan ini
        // tetap dihitung sebagai realisasi:
        //   Sisa = RPD setahun − realisasi sebelumnya (AP-aware) − nominal SAKTI bulan ini
        if (apCfg[kua] && apCfg[kua][code] === true) {
            const capAP   = (ctx.rpdAnnual[code] && ctx.rpdAnnual[code][item]) || 0;
            const usedAP  = (ctx.used[code] && ctx.used[code][item]) || 0;
            const saktiNom = parseFloat(apNomBulan[code] || 0) || 0;
            const sisaAP  = capAP - usedAP - saktiNom;

            let stateAP = 'ok';
            let noteAP  = 'Dibayar via SAKTI: ' + formatCurrency(saktiNom);
            if (sisaAP < 0)        { stateAP = 'over';  noteAP += ' — melebihi RPD setahun'; }
            else if (sisaAP === 0) { stateAP = 'empty'; }

            box.className = 'sisa-box sisa-' + stateAP;
            box.title = `RPD setahun ${formatCurrency(capAP)} − realisasi sebelumnya ${formatCurrency(usedAP)} − SAKTI bulan ini ${formatCurrency(saktiNom)} = ${formatCurrency(sisaAP)}`;
            valEl.textContent  = formatCurrency(sisaAP);
            noteEl.textContent = noteAP;

            // Sama dengan server: hanya diblokir bila ada nominal SAKTI yang diajukan
            if (saktiNom > 0 && sisaAP < 0) negativePos.push(_posLabelClient(code, item));
            return;
        }

        const cap     = (ctx.rpdAnnual[code] && ctx.rpdAnnual[code][item]) || 0;
        const used    = (ctx.used[code] && ctx.used[code][item]) || 0;
        const sisa    = cap - used;                                   // bisa negatif
        const entered = input ? parseFormattedNumber(input.value) : 0;
        const after   = sisa - entered;

        let state = 'ok';
        let note  = '';
        if (sisa < 0) {
            state = 'over';
            note  = 'Sudah melebihi RPD setahun — tidak dapat direalisasikan';
        } else if (sisa === 0) {
            state = 'empty';
            note  = 'Anggaran pos ini sudah habis';
        }
        if (entered > 0) {
            if (after < 0) state = 'over';
        }

        box.className = 'sisa-box sisa-' + state;
        box.title = `RPD setahun ${formatCurrency(cap)} − realisasi ${formatCurrency(used)} = ${formatCurrency(sisa)}`;
        valEl.textContent = formatCurrency(sisa);
        // Angka dibungkus .nowrap agar tanda minus tidak terpisah dari "Rp ..." saat teks turun baris
        if (entered > 0) {
            noteEl.innerHTML = `Setelah input ini:<br><span class="nowrap">${formatCurrency(after)}</span>`;
        } else {
            noteEl.textContent = note;
        }

        // Kumpulkan pos yang masih minus (sisa saat ini < 0 atau setelah input < 0)
        if (after < 0) negativePos.push(_posLabelClient(code, item));

        if (input && !input.disabled) {
            input.classList.toggle('input-over-limit', entered > 0 && after < 0);
        }
    });

    _applySisaSubmitLock(formEl, negativePos);
}

/**
 * Nonaktifkan tombol submit selama masih ada pos yang minus, dan tampilkan
 * alasannya. Status disimpan di form.dataset.sisaBlocked supaya
 * calculateRealisasiTotal() tidak meng-enable tombol lagi.
 */
function _applySisaSubmitLock(formEl, negativePos) {
    if (!formEl) return;
    const submitBtn  = formEl.querySelector('button[type="submit"]');
    const wasBlocked = formEl.dataset.sisaBlocked === '1';
    const blocked    = negativePos.length > 0;
    formEl.dataset.sisaBlocked = blocked ? '1' : '0';

    let warn = document.getElementById('sisaBlockWarning');
    if (blocked) {
        if (!warn) {
            warn = document.createElement('div');
            warn.id = 'sisaBlockWarning';
            warn.className = 'budget-over-warning';
            const totalSection = document.querySelector('.total-section');
            if (totalSection) totalSection.insertAdjacentElement('afterend', warn);
        }
        if (warn) {
            warn.innerHTML = '⛔ <strong>Realisasi tidak dapat disimpan mohon konsultasikan ke bendahara, karena sisa anggaran setahun minus untuk pos:</strong><br>' +
                negativePos.map(n => `• ${n}`).join('<br>');
            warn.style.display = 'block';
        }
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.title = 'Ada pos dengan sisa anggaran minus';
        }
    } else {
        if (warn) warn.style.display = 'none';
        if (submitBtn) submitBtn.removeAttribute('title');
        // Lepas kunci: biarkan validasi total/budget menentukan status tombol
        if (wasBlocked) {
            if (submitBtn) submitBtn.disabled = false; // Admin: tidak ada guard lain
            calculateRealisasiTotal();               // Operator KUA: guard budget/RPD menentukan ulang
        }
    }
}

async function calculateRealisasiTotal() {
    let total = 0;
    
    console.log('[CALCULATE_REALISASI_TOTAL] Starting calculation...');
    
    const inputs = document.querySelectorAll('.realisasi-input');
    const byPos = []; // ✅ BARU — [{code,item,value}] per pos akun pada form ini
    inputs.forEach((input, index) => {
        // ✅ Parse formatted value
        const value = parseFormattedNumber(input.value);
        total += value;
        if (input.dataset.code && input.dataset.item) {
            byPos.push({ code: input.dataset.code, item: input.dataset.item, value });
        }
        
        console.log(`[CALCULATE_REALISASI_TOTAL] Input ${index + 1} (${input.id}): ${input.value} → ${value}`);
    });
    
    console.log('[CALCULATE_REALISASI_TOTAL] Total:', total);
    
    // ✅ FIX: Update correct element ID
    const totalElement = document.getElementById('realisasiTotalDisplay');
    if (totalElement) {
        totalElement.textContent = formatCurrency(total);
        console.log('[CALCULATE_REALISASI_TOTAL] Display updated:', formatCurrency(total));
    } else {
        console.warn('[CALCULATE_REALISASI_TOTAL] Element realisasiTotalDisplay not found!');
    }

    // ✅ BUDGET & RPD GUARD: Real-time warning untuk Operator KUA
    if (currentUser && currentUser.role === 'Operator KUA') {
        const sisaBudgetEl = document.getElementById('sisaBudgetInfo');
        const totalSection = document.querySelector('.total-section');
        const submitBtn = document.querySelector('#realisasiForm button[type="submit"]');

        // Ambil sisa budget dari info-box (sudah dihitung sebelum modal dibuka)
        const sisaBudgetRaw = sisaBudgetEl
            ? parseFormattedNumber(sisaBudgetEl.textContent)
            : 0;

        // Bandingkan: total input sekarang vs sisa budget
        const isOverBudget = total > sisaBudgetRaw && sisaBudgetRaw > 0;

        // ✅ BARU — RULE 1 & 2: cek terhadap RPD, PER POS AKUN (kode+item),
        // bukan digabung. Ini hanya peringatan dini di client; pemblokir yang
        // sebenarnya (otoritatif, tidak bisa dilewati) ada di server.
        let annualMessages = []; // Rule 1: melebihi sisa RPD setahun
        let monthMessages  = []; // Rule 2: melebihi RPD bulan berjalan
        const kua      = currentUser.kua;
        const month    = document.getElementById('realisasiMonth')?.value;
        const year     = document.getElementById('realisasiYear')?.value || new Date().getFullYear();
        const formElRT = document.getElementById('realisasiForm');
        const excludeIdRT = formElRT?.dataset.editingId || null;

        if (kua && month) {
            try {
                const ctx = await _getRealisasiPosLimitContext(kua, month, year, excludeIdRT);

                byPos.forEach(({ code, item, value }) => {
                    if (value <= 0) return;
                    const label = _posLabelClient(code, item);

                    // Rule 2: nominal pos ini vs RPD pos ini bulan berjalan
                    if (ctx.rpdMonthData) {
                        const capBulan = (ctx.rpdMonthData[code] && ctx.rpdMonthData[code][item] !== undefined)
                            ? (parseFloat(ctx.rpdMonthData[code][item]) || 0) : 0;
                        if (value > capBulan) {
                            monthMessages.push(`${label}: RPD bulan ${month} ${formatCurrency(capBulan)}, diajukan ${formatCurrency(value)}`);
                        }
                    }

                    // Rule 1: (sudah terpakai setahun + diajukan) vs RPD pos ini setahun
                    const cap  = (ctx.rpdAnnual[code] && ctx.rpdAnnual[code][item] !== undefined) ? (ctx.rpdAnnual[code][item] || 0) : 0;
                    const used = (ctx.used[code] && ctx.used[code][item] !== undefined) ? (ctx.used[code][item] || 0) : 0;
                    if (used + value > cap) {
                        const sisa = cap - used; // bisa negatif bila pos sudah melebihi RPD setahun
                        annualMessages.push(`${label}: sisa RPD setahun ${formatCurrency(sisa)}, diajukan ${formatCurrency(value)}`);
                    }
                });
            } catch (e) {
                console.warn('[CALCULATE_REALISASI_TOTAL] Cek batas RPD gagal (non-fatal):', e);
            }
        }

        const isBlocked = isOverBudget || monthMessages.length > 0 || annualMessages.length > 0;

        // Update tampilan total section
        if (totalSection) {
            totalSection.classList.toggle('over-budget', isBlocked);
        }

        // Tampilkan/sembunyikan banner peringatan di bawah total
        let warningBanner = document.getElementById('budgetOverWarning');
        if (isBlocked) {
            if (!warningBanner) {
                warningBanner = document.createElement('div');
                warningBanner.id = 'budgetOverWarning';
                warningBanner.className = 'budget-over-warning';
                if (totalSection) {
                    totalSection.insertAdjacentElement('afterend', warningBanner);
                }
            }
            let html = '';
            if (isOverBudget) {
                const selisih = total - sisaBudgetRaw;
                html += `⚠️ <strong>Total melebihi sisa budget!</strong>
                    Kelebihan: <strong>${formatCurrency(selisih)}</strong>
                    — Kurangi nominal agar tidak melebihi sisa budget
                    <strong>${formatCurrency(sisaBudgetRaw)}</strong>.<br>`;
            }
            if (monthMessages.length > 0) {
                html += `⚠️ <strong>Melebihi RPD bulan ${month} untuk pos berikut:</strong><br>` +
                        monthMessages.map(m => `• ${m}`).join('<br>') + '<br>';
            }
            if (annualMessages.length > 0) {
                html += `⚠️ <strong>Melebihi sisa RPD setahun untuk pos berikut:</strong><br>` +
                        annualMessages.map(m => `• ${m}`).join('<br>');
            }
            warningBanner.innerHTML = html;
            warningBanner.style.display = 'block';
            if (submitBtn) submitBtn.disabled = true;
        } else {
            if (warningBanner) warningBanner.style.display = 'none';
            // ✅ Tetap terkunci bila masih ada pos minus (lihat _applySisaSubmitLock)
            if (submitBtn) submitBtn.disabled = (formElRT?.dataset.sisaBlocked === '1');
        }
    }
}

async function handleFileUpload(e) {
    console.log('[FILE] ========== FILE UPLOAD START ==========');
    console.log('[FILE] Event type:', e.type);
    console.log('[FILE] Files selected:', e.target.files.length);
    console.log('[FILE] Current uploadedFiles length BEFORE processing:', uploadedFiles.length);
    
    const files = e.target.files;
    
    if (files.length === 0) {
        console.warn('[FILE] No files selected');
        console.log('[FILE] ========== FILE UPLOAD END (NO FILES) ==========');
        return;
    }
    
    // Get config for max file size
    let maxSize = 5 * 1024 * 1024; // Default 5MB
    let maxFiles = 10; // Default 10 files
    
    try {
        const config = await apiCall('getRPDConfig');
        if (config.REALISASI_MAX_FILE_SIZE) {
            maxSize = parseInt(config.REALISASI_MAX_FILE_SIZE) * 1024 * 1024;
        }
        if (config.REALISASI_MAX_FILES) {
            maxFiles = parseInt(config.REALISASI_MAX_FILES);
        }
    } catch (error) {
        console.warn('[FILE] Failed to get config, using default values');
    }
    
    // Check total files limit
    if (uploadedFiles.length + files.length > maxFiles) {
        showNotification(`Maksimal ${maxFiles} file yang dapat diupload`, 'warning');
        console.log('[FILE] ========== FILE UPLOAD END (TOO MANY FILES) ==========');
        return;
    }
    
    let processedCount = 0;
    
    // Process each file
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`[FILE] Processing file ${i + 1}/${files.length}:`, file.name);
        console.log(`[FILE] File size: ${file.size} bytes (${(file.size / 1024).toFixed(2)} KB)`);
        console.log(`[FILE] File type: ${file.type}`);
        
        if (file.size > maxSize) {
            console.warn(`[FILE] File too large: ${file.name}`);
            showNotification(`File ${file.name} terlalu besar (maksimal ${maxSize / 1024 / 1024}MB)`, 'warning');
            continue;
        }
        
        try {
            const base64Data = await readFileAsBase64(file);
            console.log(`[FILE] Successfully read file: ${file.name}`);
            console.log(`[FILE] Base64 length: ${base64Data.length} characters`);

            // ✅ Rename file: File Realisasi_{Nama KUA}_{bulan}_{urut}.{ext}
            const ext = file.name.includes('.')
                ? file.name.substring(file.name.lastIndexOf('.'))
                : '';
            const kuaName = (currentUser && currentUser.kua)
                ? currentUser.kua.replace(/\s+/g, '_')
                : 'KUA';
            const bulan = (() => {
                const el = document.getElementById('realisasiMonth');
                return (el && el.value) ? el.value.replace(/\s+/g, '_') : 'Unknown';
            })();
            // Nomor urut = jumlah file yang sudah ada + jumlah yang sudah diproses di batch ini + 1
            const urut = uploadedFiles.length + processedCount + 1;
            const renamedFileName = `File_Realisasi_${kuaName}_${bulan}_${urut}${ext}`;

            console.log(`[FILE] Renamed: ${file.name} → ${renamedFileName}`);

            const fileObject = {
                fileName: renamedFileName,
                originalName: file.name,
                fileData: base64Data,
                mimeType: file.type,
                size: file.size
            };
            
            uploadedFiles.push(fileObject);
            processedCount++;
            
            console.log(`[FILE] File added to uploadedFiles array`);
            console.log(`[FILE] Current uploadedFiles length: ${uploadedFiles.length}`);
        } catch (error) {
            console.error(`[FILE ERROR] Error reading file ${file.name}:`, error);
            showNotification(`Gagal membaca file ${file.name}`, 'error');
        }
    }
    
    console.log('[FILE] Total files processed:', processedCount);
    console.log('[FILE] Total uploadedFiles now:', uploadedFiles.length);
    
    // Display files
    displayUploadedFilesWithPreview();
    
    if (processedCount > 0) {
        showNotification(`${processedCount} file berhasil ditambahkan`, 'success');
    }
    
    // Reset input
    e.target.value = '';
    console.log('[FILE] File input value reset');
    console.log('[FILE] ========== FILE UPLOAD END ==========');
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(event) {
            const base64Data = event.target.result.split(',')[1];
            resolve(base64Data);
        };
        
        reader.onerror = function(error) {
            reject(error);
        };
        
        reader.readAsDataURL(file);
    });
}

function displayUploadedFiles() {
    console.log('[DISPLAY_FILES] Displaying uploaded files:', uploadedFiles.length);
    
    const container = document.getElementById('uploadedFilesContainer');
    
    if (!container) {
        console.error('[DISPLAY_FILES] Container not found');
        return;
    }
    
    if (uploadedFiles.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 14px;">Belum ada file yang dipilih</p>';
        return;
    }
    
    let html = '<div class="uploaded-files-list">';
    
    uploadedFiles.forEach((file, index) => {
        html += `
            <div class="uploaded-file-item" data-temp-id="${file.tempId}">
                <div class="file-info">
                    <i class="fas fa-file${file.mimeType === 'application/pdf' ? '-pdf' : '-image'}"></i>
                    <div class="file-details">
                        <div class="file-name">${file.fileName}</div>
                        <div class="file-size">${formatFileSize(file.fileSize)}</div>
                    </div>
                </div>
                <button 
                    type="button" 
                    class="btn-remove-file" 
                    onclick="removeUploadedFile('${file.tempId}')"
                    title="Hapus file">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    });
    
    html += '</div>';
    
    container.innerHTML = html;
    
    // Update file count
    updateFileCount();
}

function removeUploadedFile(tempId) {
    console.log('[REMOVE_FILE] Removing file with tempId:', tempId);
    
    const index = uploadedFiles.findIndex(f => f.tempId === tempId);
    
    if (index !== -1) {
        const removed = uploadedFiles.splice(index, 1)[0];
        console.log('[REMOVE_FILE] File removed:', removed.fileName);
        
        displayUploadedFiles();
        
        showNotification(`File ${removed.fileName} dihapus`, 'success');
    }
}

function removeFileConfirm(index) {
    const file = uploadedFiles[index];
    
    if (!file) {
        console.warn('[FILE] File not found at index:', index);
        return;
    }
    
    // ✅ FIX: Get fileName from the file object, use original name if available for display
    const displayName = file.originalName || file.fileName || 'file';
    
    let message = `Hapus file "${displayName}"?`;
    if (file && file.fileId) {
        message += '\n\nCatatan: File akan dihapus dari daftar (file di Google Drive tetap ada).';
    }
    
    if (confirm(message)) {
        removeFile(index);
    }
}

function removeFile(index) {
    console.log('[FILE] ========== REMOVE FILE START ==========');
    console.log('[FILE] Removing file at index:', index);
    console.log('[FILE] File to remove:', uploadedFiles[index]);
    console.log('[FILE] Current uploadedFiles length:', uploadedFiles.length);
    
    uploadedFiles.splice(index, 1);
    
    console.log('[FILE] File removed');
    console.log('[FILE] New uploadedFiles length:', uploadedFiles.length);
    console.log('[FILE] Remaining files:', uploadedFiles.map(f => f.fileName));
    
    displayUploadedFilesWithPreview();
    console.log('[FILE] ========== REMOVE FILE END ==========');
}

function viewRealisasi(realisasiId) {
    // ✅ FIX: Retrieve realisasi from Map by ID (see displayRealisasis)
    const realisasi = realisasiDataStore.get(realisasiId);
    
    if (!realisasi) {
        console.error('[VIEW_REALISASI] Realisasi not found in store:', realisasiId);
        showNotification('Data realisasi tidak ditemukan', 'error');
        return;
    }
    
    console.log('[VIEW_REALISASI] Opening detail view');
    console.log('[VIEW_REALISASI] Realisasi data:', realisasi);
    console.log('[VIEW_REALISASI] Files:', realisasi.files);
    
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // Safe element ID from arbitrary string (removes all non-alphanumeric except dash)
    const safeId = (s) => s.replace(/[^a-zA-Z0-9]/g, '-');
    
    // ✅ FIX BUG #3: Format detail dengan RPD comparison inline
    let detailHTML = '';
    Object.entries(realisasi.data).forEach(([code, items]) => {
        const param = APP_CONFIG.BOP.RPD_PARAMETERS[code];
        
        const itemsArray = Object.entries(items);
        const onlyNominal = itemsArray.length === 1 && itemsArray[0][0] === 'Nominal';
        
        detailHTML += `<div class="rpd-item" data-code="${code}">`;
        
        // AP context untuk SAKTI badge
        const _dCfg = _apConfig && realisasi.kua && _apConfig[realisasi.kua] ? _apConfig[realisasi.kua] : {};
        const _dNomData = _apNominals[`${realisasi.month}_${realisasi.year}`] || {};
        const _dNom = (_dNomData && _dNomData[realisasi.kua]) ? _dNomData[realisasi.kua] : {};
        const _dSaktiNom = _dCfg[code] ? parseFloat(_dNom[code] || 0) : null;
        const _dSaktiBadge = _dSaktiNom !== null
            ? `<div style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:4px 12px;border-radius:20px;font-size:12px;margin:0 0 8px 0;font-weight:500;">
                ⚡ Total pembayaran melalui SAKTI: <strong>${formatCurrency(_dSaktiNom)}</strong>
               </div>`
            : '';

        if (onlyNominal) {
            const nominalValue = items['Nominal'];
            detailHTML += `
                ${_dSaktiBadge}
                <div class="rpd-subitem" style="align-items:center; flex-wrap:wrap; gap:6px;">
                    <span style="font-weight:600; color:#333; flex:1;">${code} — ${param.name}</span>
                    <div style="text-align:right; min-width:160px;">
                        <div style="font-size:11px; color:#999; margin-bottom:2px;">Realisasi</div>
                        <strong style="font-size:15px; color:#667eea;">${formatCurrency(nominalValue)}</strong>
                        <div id="rpd-cmp-${code}-${safeId('Nominal')}" style="font-size:11px; color:#aaa; margin-top:3px;">
                            <span style="color:#c0c4cc;">Memuat data RPD…</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            detailHTML += `<h4>${code} — ${param.name}</h4>${_dSaktiBadge}`;
            itemsArray.forEach(([item, value]) => {
                const sid = safeId(item);
                detailHTML += `
                    <div class="rpd-subitem" style="align-items:flex-end; flex-wrap:wrap; gap:4px;">
                        <span style="flex:1;">${item}</span>
                        <div style="text-align:right; min-width:160px;">
                            <div style="font-size:11px; color:#999; margin-bottom:2px;">Realisasi</div>
                            <strong>${formatCurrency(value)}</strong>
                            <div id="rpd-cmp-${code}-${sid}" style="font-size:11px; color:#aaa; margin-top:3px;">
                                <span style="color:#c0c4cc;">Memuat data RPD…</span>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        detailHTML += `</div>`;
    });
    
    let statusClass = getStatusBadgeClass(realisasi.status);
    if (normalizeStatus(realisasi.status) === STATUS.APPROVED) statusClass = 'success';
    else if (normalizeStatus(realisasi.status) === STATUS.REJECTED) statusClass = 'danger';
    else if (normalizeStatus(realisasi.status) === STATUS.PAID) statusClass = 'info';
    
    // ✅ FIX BUG #2: Parse files dan buat preview seperti di Detail Verifikasi
    let files = [];
    if (realisasi.files) {
        console.log('[VIEW_REALISASI] Raw files:', realisasi.files);
        console.log('[VIEW_REALISASI] Files type:', typeof realisasi.files);
        
        if (typeof realisasi.files === 'string' && realisasi.files.trim() !== '') {
            try {
                files = JSON.parse(realisasi.files);
                console.log('[VIEW_REALISASI] Parsed files from string:', files);
            } catch (e) {
                console.error('[VIEW_REALISASI] Error parsing files:', e);
                files = [];
            }
        } else if (Array.isArray(realisasi.files)) {
            files = realisasi.files;
            console.log('[VIEW_REALISASI] Files already array');
        }
        
        if (!Array.isArray(files)) {
            console.warn('[VIEW_REALISASI] files is not array, resetting');
            files = [];
        }
        
        // Filter out invalid files
        files = files.filter(file => {
            const isValid = file && (file.fileName || file.uniqueName) && (file.fileUrl || file.fileId);
            if (!isValid) {
                console.warn('[VIEW_REALISASI] Invalid file filtered out:', file);
            }
            return isValid;
        });
        
        console.log('[VIEW_REALISASI] Valid files after filter:', files.length);
    }
    
    console.log('[VIEW_REALISASI] Files array length:', files.length);
    
    // ✅ Preview dokumen sekarang pakai DocumentPreviewer yang sama dengan Admin
    // (zoom/pan/rotate via pdf.js) — bukan iframe/img manual lagi.
    // Daftar file ditampilkan di kiri, klik untuk membuka preview di panel kanan.
    const _viewFilesList = files;
    const _viewHasFiles = _viewFilesList.length > 0;

    function _viewFileIcon(mime) {
        if (!mime) return '📎';
        if (mime.startsWith('image/')) return '🖼️';
        if (mime === 'application/pdf') return '📄';
        return '📎';
    }

    const _viewFilesListHTML = _viewHasFiles
        ? _viewFilesList.map(function(f, idx) {
            const _name = f.originalName || f.fileName || f.uniqueName;
            const _icon = _viewFileIcon(f.mimeType);
            const _size = f.size ? ' · ' + formatFileSize(f.size) : '';
            return '<div class="_dpViewFileItem" data-idx="' + idx + '" style="' +
                'display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;' +
                'cursor:pointer;margin-bottom:6px;">' +
                '<span style="font-size:18px;flex-shrink:0;">' + _icon + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-weight:600;font-size:12px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _name + '">' + _name + '</div>' +
                    '<div style="font-size:10px;color:#999;margin-top:2px;">' + (f.mimeType || 'file') + _size + '</div>' +
                '</div>' +
                '<button class="_dpViewPreviewBtn" data-idx="' + idx + '" ' +
                    'style="background:#667eea;color:white;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0;white-space:nowrap;">👁️ Preview</button>' +
            '</div>';
        }).join('')
        : '<div style="color:#999;font-size:12px;font-style:italic;padding:8px;">Tidak ada dokumen pendukung</div>';
    
    modal.innerHTML = `
        <!-- ╔══════════════════════════════════════════╗
             ║  VIEW MODAL — split view (Operator KUA)   ║
             ║  Kiri 42% (info) · Kanan 58% (DP panel)  ║
             ╚══════════════════════════════════════════╝ -->

        <!-- ── OVERLAY PENUH ── -->
        <div id="_viewRlsOverlay" style="
            position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:8990;
        "></div>

        <!-- ── PANEL KIRI — responsive: split(42% left) ↔ center(600px) ── -->
        <div id="_viewRlsLeftPanel" style="
            position:fixed; z-index:9010;
            display:flex; flex-direction:column; overflow:hidden;
            background:#f7f8ff;
            transition: left .3s ease, width .3s ease, top .3s ease, bottom .3s ease,
                        transform .3s ease, border-radius .3s ease, box-shadow .3s ease;
            left:0; top:0; bottom:0; width:42%;
            border-right:1px solid #e0e4f0;
            box-shadow:4px 0 20px rgba(0,0,0,.15);
            border-radius:0;
        ">
            <!-- Header gradient -->
            <div style="
                flex:0 0 auto; padding:12px 16px;
                background:linear-gradient(135deg,#667eea,#764ba2);
                display:flex; align-items:center; justify-content:space-between; gap:10px;
            ">
                <div style="min-width:0;">
                    <div style="font-size:17px;font-weight:700;color:white;line-height:1.3;">📄 Detail Realisasi</div>
                    <div style="font-size:14px;color:rgba(255,255,255,.85);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        🏢 ${realisasi.kua || '-'} &nbsp;·&nbsp; 📅 ${realisasi.month || 'Unknown'} ${realisasi.year || ''}
                    </div>
                </div>
                <button class="close-btn" onclick="closeModal()" style="
                    flex-shrink:0; width:30px; height:30px; border-radius:50%;
                    background:rgba(255,255,255,.2); border:none;
                    color:white; font-size:18px; cursor:pointer; line-height:1;
                ">&times;</button>
            </div>

            <!-- Scrollable body -->
            <div style="flex:1 1 0; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px;
                 scrollbar-width:thin; scrollbar-color:#c1c9e0 #f7f8ff;">

                <!-- Status & info -->
                <div class="summary-box" style="margin:0;">
                    <div class="summary-item">
                        <span>Status:</span>
                        <span class="badge badge-${statusClass}">${getStatusLabel(realisasi.status)}</span>
                    </div>
                    ${realisasi.verifiedBy ? `
                    <div class="summary-item">
                        <span>Diverifikasi Oleh:</span>
                        <span>${realisasi.verifiedBy}</span>
                    </div>
                    ` : ''}
                    ${realisasi.verifiedAt ? `
                    <div class="summary-item">
                        <span>Tanggal Verifikasi:</span>
                        <span>${formatDate(realisasi.verifiedAt)}</span>
                    </div>
                    ` : ''}
                    ${realisasi.notes ? `
                    <div class="summary-item" style="flex-direction: column; align-items: flex-start;">
                        <span style="margin-bottom: 5px;">Catatan:</span>
                        <span style="padding: 10px; background: #f8f9fa; border-radius: 6px; width: 100%;">${realisasi.notes}</span>
                    </div>
                    ` : ''}
                </div>

                <!-- Data Pos & Nominal -->
                <div class="rpd-item">
                    <h4>📊 Data Pos &amp; Nominal</h4>
                </div>
                ${detailHTML}

                <!-- Total -->
                <div class="rpd-item">
                    <div class="rpd-subitem">
                        <span>Total Realisasi</span>
                        <strong style="color:#667eea;">${formatCurrency(realisasi.total)}</strong>
                    </div>
                </div>

                <!-- AP Summary (diisi async) -->
                <div id="viewRpdApDetail"></div>

                <!-- Dokumen Pendukung -->
                <div class="rpd-item">
                    <h4>📁 Dokumen Pendukung${_viewHasFiles ? ' (' + _viewFilesList.length + ')' : ''}</h4>
                    ${_viewFilesListHTML}
                </div>

                <div style="height:16px;"></div>
            </div>
        </div>

        <style>
            ._dpViewFileItem {
                background: rgba(102,126,234,.06) !important;
                border-color: rgba(102,126,234,.2) !important;
                transition: background .15s, border-color .15s !important;
            }
            ._dpViewFileItem:hover { background: rgba(102,126,234,.14) !important; border-color: rgba(102,126,234,.4) !important; }
            ._dpViewFileItem.dp-active { background: rgba(102,126,234,.2) !important; border-color: #667eea !important; }
            ._dpViewPreviewBtn:hover { opacity: .85 !important; }
            /* Split mode — DP takes right 58% */
            #dp-modal-view {
                width: 58% !important;
                box-shadow: none !important;
                border-left: 1px solid #e0e4f0 !important;
                transition: opacity .25s ease, transform .25s ease !important;
            }
            #dp-modal-view-header,
            #dp-modal-view-container,
            #dp-modal-view .dp-controls {
                width: 58% !important;
            }
            /* Center mode — hide DP smoothly */
            #dp-modal-view.dp-hidden {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateX(60px) !important;
            }
        </style>
    `;

    modal.classList.add('active');

    // ── Split ↔ Center helpers ────────────────────────────────────────────────
    const _viewLeftPanel = document.getElementById('_viewRlsLeftPanel');

    const _VIEW_SPLIT_STYLE = {
        left:'0', top:'0', bottom:'0', width:'42%',
        height:'', transform:'none', borderRadius:'0',
        borderRight:'1px solid #e0e4f0',
        boxShadow:'4px 0 20px rgba(0,0,0,.15)',
        maxHeight:''
    };
    const _VIEW_CENTER_STYLE = {
        left:'50%', top:'50%', bottom:'auto', width:'min(860px, 92vw)',
        height:'min(92vh, 920px)',
        transform:'translateX(-50%) translateY(-50%)',
        borderRadius:'16px',
        borderRight:'none',
        boxShadow:'0 24px 64px rgba(0,0,0,.35)',
        maxHeight:'92vh'
    };

    function _applyViewPanelStyle(styles) {
        if (!_viewLeftPanel) return;
        Object.assign(_viewLeftPanel.style, styles);
    }

    window._viewRlsSwitchToCenter = function() {
        _applyViewPanelStyle(_VIEW_CENTER_STYLE);
        const dp = document.getElementById('dp-modal-view');
        if (dp) dp.classList.add('dp-hidden');
    };

    window._viewRlsSwitchToSplit = function() {
        _applyViewPanelStyle(_VIEW_SPLIT_STYLE);
        const dp = document.getElementById('dp-modal-view');
        if (dp) dp.classList.remove('dp-hidden');
    };
    // ─────────────────────────────────────────────────────────────────────────

    function _dpViewOpenFile(idx) {
        const f = _viewFilesList[idx];
        if (!f) return;

        const previewer = _getViewPreviewer();
        if (!previewer) {
            window.open(f.fileUrl, '_blank');
            return;
        }

        const _dName = f.originalName || f.fileName;

        // Switch to split view first, then open file
        window._viewRlsSwitchToSplit();

        // Highlight active item
        modal.querySelectorAll('._dpViewFileItem').forEach(function(el) {
            el.classList.toggle('dp-active', parseInt(el.getAttribute('data-idx')) === idx);
        });

        previewer.open(f.fileUrl, _dName);
    }

    // Bind preview buttons/cards + auto-open first file
    setTimeout(() => {
        modal.querySelectorAll('._dpViewPreviewBtn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const idx = parseInt(this.getAttribute('data-idx'));
                _dpViewOpenFile(idx);
            });
        });
        modal.querySelectorAll('._dpViewFileItem').forEach(function(item) {
            item.addEventListener('click', function() {
                const idx = parseInt(this.getAttribute('data-idx'));
                _dpViewOpenFile(idx);
            });
        });

        if (_viewFilesList.length > 0) {
            // Auto-open first file → starts in split mode
            _dpViewOpenFile(0);
        } else {
            // No files → start in center mode
            window._viewRlsSwitchToCenter();
        }
    }, 150);

    // Async: inject RPD detail + AP summary
    setTimeout(() => {
        _injectViewRealisasiExtras(realisasi).catch(() => {});
    }, 80);
}

async function _injectViewRealisasiExtras(realisasi) {
    // --- Fetch RPD data ---
    let rpdData = null;
    try {
        const cachedRPDs = getLocalCache('rpds') || [];
        rpdData = cachedRPDs.find(r =>
            r.kua === realisasi.kua &&
            r.month === realisasi.month &&
            r.year == realisasi.year
        );
        if (!rpdData) {
            const rpds = await apiCall('getRPDs', { kua: realisasi.kua, year: realisasi.year });
            rpdData = (rpds || []).find(r => r.month === realisasi.month && r.year == realisasi.year);
        }
    } catch (e) { /* RPD tidak tersedia */ }

    // --- Inject RPD nominal directly into each rpd-item via data-code attribute ---
    // We use the data-code attribute set on each .rpd-item div to find the right element,
    // then append RPD comparison rows under each existing rpd-subitem.
    if (rpdData && rpdData.data) {
        // Pos SAKTI: input manual = 0, jadi realisasi sebenarnya adalah nominal SAKTI bulan ini
        let _apCfgKua = null, _apNomKua = {};
        try {
            await apGetConfig();
            _apCfgKua = (_apConfig && _apConfig[realisasi.kua]) ? _apConfig[realisasi.kua] : null;
            if (_apCfgKua) {
                const _nd = await apGetNominals(realisasi.month, realisasi.year);
                _apNomKua = (_nd && _nd[realisasi.kua]) ? _nd[realisasi.kua] : {};
            }
        } catch (e) { /* abaikan: fallback ke perhitungan biasa */ }

        document.querySelectorAll('.rpd-item[data-code]').forEach(itemEl => {
            const code = itemEl.dataset.code;
            const rpdItems = rpdData.data[code];
            const realItems = (realisasi.data && realisasi.data[code]) ? realisasi.data[code] : {};
            if (!rpdItems) return;

            // Find all rpd-subitem divs in this rpd-item
            const subitems = itemEl.querySelectorAll('.rpd-subitem');
            
            // Build a map of item -> RPD value from rpdData
            // Iterate APP_CONFIG items in order so positions align
            const codeParam = (APP_CONFIG.BOP.RPD_PARAMETERS || {})[code];
            const itemNames = codeParam ? codeParam.items : Object.keys(rpdItems);

            itemNames.forEach((item, idx) => {
                const rpd     = parseFloat(rpdItems[item] || 0);
                const isAPPos = !!(_apCfgKua && _apCfgKua[code] === true);
                const realVal = isAPPos
                    ? (parseFloat(_apNomKua[code] || 0) || 0)   // nominal SAKTI bulan ini
                    : parseFloat(realItems[item] || 0);
                const sisa    = rpd - realVal;
                const siColor = sisa >= 0 ? '#28a745' : '#dc3545';
                const siLabel = sisa >= 0 ? 'Sisa' : 'Melebihi';

                // Find the matching subitem by position or by id
                let subEl = null;
                const safeId = (s) => s.replace(/[^a-zA-Z0-9]/g, '-');
                subEl = document.getElementById(`rpd-cmp-${code}-${safeId(item)}`);
                
                if (subEl) {
                    subEl.innerHTML = `<span style="color:#667eea;font-weight:600;">RPD: ${formatCurrency(rpd)}</span>
                        &nbsp;·&nbsp;<span style="color:${siColor};font-weight:600;">${siLabel}: ${formatCurrency(Math.abs(sisa))}</span>`;
                } else if (subitems[idx]) {
                    // Fallback: inject into subitem by position
                    let cmpDiv = subitems[idx].querySelector('.rpd-cmp-injected');
                    if (!cmpDiv) {
                        cmpDiv = document.createElement('div');
                        cmpDiv.className = 'rpd-cmp-injected';
                        cmpDiv.style.cssText = 'font-size:11px;margin-top:3px;text-align:right;';
                        const valueEl = subitems[idx].querySelector('strong, div[style*="text-align:right"]');
                        if (valueEl) valueEl.appendChild(cmpDiv);
                        else subitems[idx].appendChild(cmpDiv);
                    }
                    cmpDiv.innerHTML = `<span style="color:#667eea;font-weight:600;">RPD: ${formatCurrency(rpd)}</span>
                        &nbsp;·&nbsp;<span style="color:${siColor};font-weight:600;">${siLabel}: ${formatCurrency(Math.abs(sisa))}</span>`;
                }
            });
        });

        // Also clear any remaining "Memuat..." placeholders
        document.querySelectorAll('[id^="rpd-cmp-"]').forEach(el => {
            if (el.querySelector('span[style*="c0c4cc"]') || el.innerHTML.includes('Memuat')) {
                el.innerHTML = '<span style="color:#ccc;font-size:10px;">RPD: tidak tersedia</span>';
            }
        });
    } else {
        // No RPD data - clear all loading placeholders
        document.querySelectorAll('[id^="rpd-cmp-"]').forEach(el => {
            el.innerHTML = '<span style="color:#ccc;font-size:10px;">RPD: tidak tersedia</span>';
        });
    }

    // --- AP Summary ---
    const container = document.getElementById('viewRpdApDetail');
    if (!container) return;

    await apGetConfig();
    const kua = realisasi.kua;
    const cfg  = _apConfig && _apConfig[kua] ? _apConfig[kua] : null;
    if (!cfg || !AP_POS.some(code => cfg[code])) {
        container.innerHTML = '';
        return;
    }

    const nomData = await apGetNominals(realisasi.month, realisasi.year);
    const nom     = (nomData && nomData[kua]) ? nomData[kua] : {};
    const totals  = apCalcTotals([realisasi], _apConfig, { [kua]: nom });

    const apItems = AP_POS.filter(code => cfg[code]).map(code =>
        `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #e0e7ff;">
            <span style="color:#555;">⚡ ${AP_POS_NAMES[code]}</span>
            <strong style="color:#667eea;">${formatCurrency(parseFloat(nom[code]||0))}</strong>
        </div>`
    ).join('');

    // ✅ Operator KUA: hanya tampilkan Include AutoPayment
    // ✅ Admin (halaman Verifikasi): tampilkan keduanya (include & exclude)
    const isOperatorView = currentUser && currentUser.role !== 'Admin';

    const totalBoxesHTML = isOperatorView
        // Operator KUA — satu kotak: Include AutoPayment saja
        ? `<div style="background:white;border-radius:8px;padding:14px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.06);">
                <div style="font-size:11px;color:#28a745;font-weight:700;margin-bottom:4px;">✅ Total Termasuk Tagihan Otomatis</div>
                <div style="font-size:20px;font-weight:800;color:#28a745;">${formatCurrency(totals.include)}</div>
                <div style="font-size:10px;color:#999;margin-top:4px;">Angka pengeluaran sesungguhnya</div>
            </div>`
        // Admin — dua kotak: Include & Exclude
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div style="background:white;border-radius:8px;padding:14px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.06);">
                    <div style="font-size:11px;color:#28a745;font-weight:700;margin-bottom:4px;">✅ Total Termasuk Tagihan Otomatis</div>
                    <div style="font-size:20px;font-weight:800;color:#28a745;">${formatCurrency(totals.include)}</div>
                    <div style="font-size:10px;color:#999;margin-top:4px;">Angka pengeluaran sesungguhnya</div>
                </div>
                <div style="background:white;border-radius:8px;padding:14px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.06);">
                    <div style="font-size:11px;color:#dc3545;font-weight:700;margin-bottom:4px;">⬜ Total Tanpa Tagihan Otomatis</div>
                    <div style="font-size:20px;font-weight:800;color:#dc3545;">${formatCurrency(totals.exclude)}</div>
                    <div style="font-size:10px;color:#999;margin-top:4px;">Hanya pos yang diinput manual</div>
                </div>
            </div>`;

    container.innerHTML = `
    <div style="background:linear-gradient(135deg,#f0f4ff,#e8f4fd);border:2px solid #667eea;
                border-radius:12px;padding:16px;margin-top:16px;">
        <div style="font-weight:700;color:#667eea;margin-bottom:6px;font-size:14px;">⚡ Tagihan Otomatis (Auto Payment)</div>
        <p style="font-size:12px;color:#666;margin:0 0 10px;">
            Beberapa pos dibayar otomatis oleh Admin, bukan diinput manual oleh KUA.
        </p>
        ${apItems}
        <div style="margin-top:12px;">
            ${totalBoxesHTML}
        </div>
    </div>`;
}
function editRealisasi(realisasiId) {
    // ✅ FIX: Retrieve realisasi from Map by ID (see displayRealisasis)
    const realisasi = realisasiDataStore.get(realisasiId);
    
    if (!realisasi) {
        console.error('[EDIT_REALISASI] Realisasi not found in store:', realisasiId);
        showNotification('Data realisasi tidak ditemukan', 'error');
        return;
    }
    
    showRealisasiModal(realisasi);
}

// ===== VERIFIKASI MANAGEMENT (UPDATED WITH CACHE) =====
async function loadVerifikasi(forceRefresh = false) {
    console.log('[VERIFIKASI] Loading verifikasi', { forceRefresh });
    
    // ✅ ALWAYS cek cache dulu
    const cachedData = getLocalCache('verifikasi');
    if (cachedData && !forceRefresh) {
        console.log('[VERIFIKASI] Using cached data - NO SERVER CALL');
        displayVerifikasi(cachedData);
        return;
    }
    
    // ✅ Only fetch dari server jika force refresh atau belum ada cache
    if (forceRefresh || !cachedData) {
        console.log('[VERIFIKASI] Fetching from server...');
        // ❌ NO LOADING SPINNER
        
        try {
            const yearFilter = document.getElementById('verifikasiYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            // Get all realisasis for the year
            let realisasis = await apiCall('getRealisasis', { year: year });
            
            // ✅ Update local cache
            updateLocalCache('verifikasi', realisasis);
            
            displayVerifikasi(realisasis);
            
        } catch (error) {
            console.error('[VERIFIKASI ERROR]', error);
        }
    }
}

// ✅ Fungsi baru untuk display verifikasi (separated from loading)
function displayVerifikasi(realisasis) {
    const tbody = document.querySelector('#verifikasiTable tbody');
    
    // ✅ FIX: READ FILTER VALUES (termasuk bulan)
    const kuaFilter = document.getElementById('verifikasiKUAFilter');
    const monthFilter = document.getElementById('verifikasiMonthFilter');
    const statusFilter = document.getElementById('verifikasiStatusFilter');
    const yearFilter = document.getElementById('verifikasiYearFilter');
    
    const selectedKUA = kuaFilter ? kuaFilter.value : '';
    const selectedMonth = monthFilter ? monthFilter.value : '';
    const selectedStatus = statusFilter ? statusFilter.value : '';
    const selectedYear = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
    
    console.log('[VERIFIKASI] Displaying data with filters:', {
        kua: selectedKUA,
        month: selectedMonth,
        status: selectedStatus,
        year: selectedYear
    });
    
    // ✅ APPLY FILTERS (termasuk bulan)
    let filteredData = realisasis.filter(real => {
        let passKUA = !selectedKUA || real.kua === selectedKUA;
        let passMonth = !selectedMonth || real.month === selectedMonth;
        let passStatus = !selectedStatus || normalizeStatus(real.status) === selectedStatus;
        let passYear = !selectedYear || real.year == selectedYear;
        
        return passKUA && passMonth && passStatus && passYear;
    });
    
    console.log('[VERIFIKASI] Filtered from', realisasis.length, 'to', filteredData.length, 'records');
    
    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Tidak ada data realisasi yang perlu diverifikasi</td></tr>';
        console.log('[VERIFIKASI] No data to display');
        return;
    }
    
    let totalNominal = 0;
    
    const rows = filteredData.map((real, index) => {
        // ✅ Hitung include-AP total per baris (sync, _apNominals sudah preloaded)
        // sehingga kolom Total dan baris TOTAL konsisten dengan summary "Include AP"
        let rowTotal;
        if (_apConfig) {
            const nomKey  = `${real.month}_${real.year}`;
            const nomData = _apNominals[nomKey] || {};
            const kuaNom  = (nomData && nomData[real.kua]) ? nomData[real.kua] : {};
            const { include } = apCalcTotals([real], _apConfig, { [real.kua]: kuaNom });
            rowTotal = include;
        } else {
            rowTotal = parseFloat(real.total || 0);
        }
        totalNominal += rowTotal;
        
        let statusClass = getStatusBadgeClass(real.status);
        let statusText = getStatusLabel(real.status);
        
        // ✅ FIX: Store realisasi in Map and pass only ID to avoid token errors
        const realisasiId = real.id || `temp-${Date.now()}-${index}`;
        realisasiDataStore.set(realisasiId, real);
        
        console.log('[VERIFIKASI] Row', index + 1, ':', {
            id: realisasiId,
            kua: real.kua,
            month: real.month,
            year: real.year,
            total: real.total,
            rowTotal: rowTotal,
            status: real.status,
            files: real.files ? real.files.length : 0
        });
        
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${real.kua || '-'}</td>
            <td>${real.month || '-'}</td>
            <td>${real.year || '-'}</td>
            <td>${formatCurrency(rowTotal)}</td>
            <td>${real.createdAt ? formatDate(real.createdAt) : '-'}</td>
            <td><span class="badge badge-${statusClass}">${statusText}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="verifyRealisasi('${realisasiId}')">Verifikasi</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    const totalRow = `
        <tr style="background: #f8f9fa; font-weight: bold;">
            <td colspan="4" style="text-align: right;">TOTAL:</td>
            <td>${formatCurrency(totalNominal)}</td>
            <td colspan="3"></td>
        </tr>
    `;
    
    tbody.innerHTML = rows + totalRow;
    console.log('[VERIFIKASI] Displayed', filteredData.length, 'records, Total:', formatCurrency(totalNominal));
}

// ✅ Handler untuk filter changes (gunakan cache, hanya re-display)
function onVerifikasiFilterChange() {
    console.log('[VERIFIKASI] Filter changed');
    
    const cachedData = getCache('verifikasi');
    
    if (cachedData) {
        // Jika ada cache, update filters dan re-display
        const kuaFilter = document.getElementById('verifikasiKUAFilter');
        const statusFilter = document.getElementById('verifikasiStatusFilter');
        const yearFilter = document.getElementById('verifikasiYearFilter');
        
        const newFilters = {
            kua: kuaFilter ? kuaFilter.value : '',
            status: statusFilter ? statusFilter.value : '',
            year: yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear()
        };
        
        // Jika year berubah, perlu reload dari server
        if (newFilters.year !== cachedData.filters.year) {
            console.log('[VERIFIKASI] Year changed, force refresh');
            loadVerifikasi(true);
        } else {
            // Jika hanya KUA atau Status yang berubah, cukup re-display
            console.log('[VERIFIKASI] Only filter changed, using cache');
            displayVerifikasi(cachedData.realisasis, newFilters);
            
            // Update cached filters
            cachedData.filters = newFilters;
        }
    } else {
        // Jika tidak ada cache, load dari server
        console.log('[VERIFIKASI] No cache, loading from server');
        loadVerifikasi(true);
    }
}

// ===== NEW: Load Verifikasi with Filters Function =====
async function loadVerifikasiWithFilters() {
    console.log('[VERIFIKASI] Loading verifikasi with filters...');
    showLoading();
    
    try {
        const yearFilter = document.getElementById('verifikasiYearFilter');
        const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
        
        // Get all realisasis for the year
        let realisasis = await apiCall('getRealisasis', { year: year });
        
        // Update local cache
        updateLocalCache('verifikasi', realisasis);
        
        // Display dengan filter yang sudah dipilih
        displayVerifikasi(realisasis);
        
        hideLoading();
        showNotification('Data verifikasi berhasil dimuat', 'success');
    } catch (error) {
        hideLoading();
        console.error('[VERIFIKASI ERROR]', error);
        showNotification('Gagal memuat data verifikasi', 'error');
    }
}

// ===== NEW: Sort Verifikasi Table Function =====
let verifikasiSortState = {
    column: -1,
    ascending: true
};

function sortVerifikasiTable(columnIndex) {
    console.log('[VERIFIKASI SORT] Sorting column', columnIndex);
    
    const tbody = document.querySelector('#verifikasiTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr:not(:last-child)')); // Exclude total row
    
    if (rows.length === 0 || (rows.length === 1 && rows[0].textContent.includes('Klik tombol'))) {
        return; // No data to sort
    }
    
    // Determine sort direction
    if (verifikasiSortState.column === columnIndex) {
        verifikasiSortState.ascending = !verifikasiSortState.ascending;
    } else {
        verifikasiSortState.column = columnIndex;
        verifikasiSortState.ascending = true;
    }
    
    // Month order for sorting
    const monthOrder = {
        'Januari': 1, 'Februari': 2, 'Maret': 3, 'April': 4,
        'Mei': 5, 'Juni': 6, 'Juli': 7, 'Agustus': 8,
        'September': 9, 'Oktober': 10, 'November': 11, 'Desember': 12
    };
    
    // Sort rows
    rows.sort((a, b) => {
        let aValue, bValue;
        
        const aCells = a.querySelectorAll('td');
        const bCells = b.querySelectorAll('td');
        
        // For Verifikasi: 0=No, 1=KUA, 2=Bulan, 3=Tahun, 4=Total, 5=Dibuat, 6=Status
        switch(columnIndex) {
            case 0: // No
                aValue = parseInt(aCells[0].textContent);
                bValue = parseInt(bCells[0].textContent);
                break;
            case 1: // KUA
                aValue = aCells[1].textContent.trim();
                bValue = bCells[1].textContent.trim();
                break;
            case 2: // Bulan
                aValue = monthOrder[aCells[2].textContent.trim()] || 0;
                bValue = monthOrder[bCells[2].textContent.trim()] || 0;
                break;
            case 3: // Tahun
                aValue = parseInt(aCells[3].textContent);
                bValue = parseInt(bCells[3].textContent);
                break;
            case 4: // Total
                aValue = parseFloat(aCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                bValue = parseFloat(bCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                break;
            case 5: // Dibuat
                aValue = new Date(aCells[5].textContent.trim()).getTime() || 0;
                bValue = new Date(bCells[5].textContent.trim()).getTime() || 0;
                break;
            case 6: // Status
                aValue = aCells[6].textContent.trim();
                bValue = bCells[6].textContent.trim();
                break;
        }
        
        // Compare
        if (aValue < bValue) return verifikasiSortState.ascending ? -1 : 1;
        if (aValue > bValue) return verifikasiSortState.ascending ? 1 : -1;
        return 0;
    });
    
    // Re-append rows (this will reorder them)
    const totalRow = tbody.querySelector('tr:last-child');
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
        // Update No column
        row.querySelector('td:first-child').textContent = index + 1;
        tbody.appendChild(row);
    });
    
    // Re-append total row
    if (totalRow) {
        tbody.appendChild(totalRow);
    }
    
    console.log('[VERIFIKASI SORT] Sorted', rows.length, 'rows by column', columnIndex, 'ascending:', verifikasiSortState.ascending);
}


// ===== VERIFIKASI REALISASI (UPDATED) =====
async function verifyRealisasi(realisasiId) {
    // ✅ FIX: Retrieve realisasi from Map by ID
    const realisasi = realisasiDataStore.get(realisasiId);
    
    if (!realisasi) {
        console.error('[VERIFIKASI] Realisasi not found in store:', realisasiId);
        showNotification('Data realisasi tidak ditemukan', 'error');
        return;
    }
    
    console.log('[VERIFIKASI] Verifying realisasi:', realisasi);
    console.log('[VERIFIKASI] Files in realisasi:', realisasi.files);
    
    // ✅ Ambil data RPD dari local cache — untuk Admin, fetch on-demand jika belum ada
    let rpdData = null;
    let rpdTotal = 0;
    
    const cachedRPDs = getLocalCache('rpds');
    
    // Cek apakah cache RPD sudah punya data KUA yang dimaksud
    const hasRPDForKUA = cachedRPDs && Array.isArray(cachedRPDs) && 
        cachedRPDs.some(r => r.kua === realisasi.kua);
    
    if (hasRPDForKUA) {
        console.log('[VERIFIKASI] Using cached RPDs:', cachedRPDs.length, 'records');
        
        // Cari RPD dengan KUA, bulan, dan tahun yang sama
        rpdData = cachedRPDs.find(rpd => 
            rpd.kua === realisasi.kua &&
            rpd.month === realisasi.month && 
            rpd.year == realisasi.year
        );
        
        if (rpdData) {
            rpdTotal = parseFloat(rpdData.total || 0);
            console.log('[VERIFIKASI] Found matching RPD from cache:', rpdData);
        } else {
            console.log('[VERIFIKASI] No matching RPD for', realisasi.kua, realisasi.month, realisasi.year);
        }
        
        // Lanjut tampilkan modal
        showVerifyModal(realisasi, rpdData, rpdTotal);
        
    } else {
        // ✅ Admin: RPD belum di-cache untuk KUA ini, fetch on-demand
        console.log('[VERIFIKASI] RPDs not in cache for KUA:', realisasi.kua, '— fetching...');
        showLoading();
        
        try {
            const rpds = await apiCall('getRPDs', { 
                kua: realisasi.kua, 
                year: realisasi.year 
            });
            
            // Gabungkan ke cache yang ada (tanpa replace seluruh cache)
            const existingRPDs = cachedRPDs || [];
            const mergedRPDs = [...existingRPDs.filter(r => r.kua !== realisasi.kua), ...rpds];
            updateLocalCache('rpds', mergedRPDs);
            
            rpdData = rpds.find(rpd => 
                rpd.month === realisasi.month && 
                rpd.year == realisasi.year
            );
            
            if (rpdData) {
                rpdTotal = parseFloat(rpdData.total || 0);
                console.log('[VERIFIKASI] RPD fetched on-demand:', rpdData);
            }
        } catch (e) {
            console.warn('[VERIFIKASI] Failed to fetch RPDs on-demand:', e);
        }
        
        hideLoading();
        showVerifyModal(realisasi, rpdData, rpdTotal);
    }
}

// ✅ Extracted: build & show verify modal (called after RPD lookup, sync or async)
function showVerifyModal(realisasi, rpdData, rpdTotal) {
    let modal = document.getElementById('modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // AP context untuk badge SAKTI di rpd-item
    const _vCfg = _apConfig && realisasi.kua && _apConfig[realisasi.kua] ? _apConfig[realisasi.kua] : {};
    const _vNomData = _apNominals[`${realisasi.month}_${realisasi.year}`] || {};
    const _vNom = (_vNomData && _vNomData[realisasi.kua]) ? _vNomData[realisasi.kua] : {};

    // ✅ FIX: "Total Realisasi" & "Selisih" di panel kiri harus pakai nilai Include AP.
    // realisasi.total (dari Sheet) adalah nilai Exclude AP — pos yang statusnya
    // auto-payment tidak ikut dijumlah manual, jadi harus ditambah nominal SAKTI-nya
    // dulu (apCalcTotals) supaya perbandingan dengan Total RPD apple-to-apple.
    const _vfyTotalRealisasi = apCalcTotals([realisasi], _apConfig, { [realisasi.kua]: _vNom }).include;

    let detailHTML = '';
    Object.entries(realisasi.data).forEach(([code, items]) => {
        const param = APP_CONFIG.BOP.RPD_PARAMETERS[code];
        const _saktiNom = _vCfg[code] ? parseFloat(_vNom[code] || 0) : null;
        const _saktiBadge = _saktiNom !== null
            ? `<div style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:4px 12px;border-radius:20px;font-size:12px;margin-bottom:8px;font-weight:500;">
                ⚡ Total pembayaran melalui SAKTI: <strong>${formatCurrency(_saktiNom)}</strong>
               </div>`
            : '';
        detailHTML += `<div class="rpd-item">
            <h4>${code} - ${param.name}</h4>${_saktiBadge}`;
        
        Object.entries(items).forEach(([item, realisasiValue]) => {
            // ✅ Cari nilai RPD untuk item yang sama (dari cache)
            let rpdValue = 0;
            let rpdHTML = '';
            
            if (rpdData && rpdData.data && rpdData.data[code] && rpdData.data[code][item]) {
                rpdValue = parseFloat(rpdData.data[code][item]) || 0;
            }
            
            // Hitung selisih
            const diff = rpdValue - realisasiValue;
            const diffColor = diff >= 0 ? '#28a745' : '#dc3545';
            
            rpdHTML = `
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <small style="color: #666; font-size: 11px;">Realisasi:</small>
                        <strong style="color: #333;">${formatCurrency(realisasiValue)}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <small style="color: #666; font-size: 11px;">RPD:</small>
                        <strong style="color: #667eea;">${formatCurrency(rpdValue)}</strong>
                    </div>
                    ${diff !== 0 ? `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <small style="color: #666; font-size: 11px;">Selisih:</small>
                        <strong style="color: ${diffColor}; font-size: 13px;">${formatCurrency(diff)}</strong>
                    </div>
                    ` : ''}
                </div>
            `;
            
            detailHTML += `<div class="rpd-subitem" style="align-items: flex-start;">
                <span>${item}</span>
                ${rpdHTML}
            </div>`;
        });
        
        detailHTML += `</div>`;
    });
    
    // ✅ FIX: Parse files dengan benar
    let files = realisasi.files;
    
    // Jika files adalah string, parse dulu
    if (typeof files === 'string' && files.trim() !== '') {
        try {
            files = JSON.parse(files);
            console.log('[VERIFIKASI] Files parsed from string:', files);
        } catch (e) {
            console.error('[VERIFIKASI] Error parsing files:', e);
            files = [];
        }
    }
    
    // ✅ FIX: Build files HTML dengan validasi yang benar
    let filesHTML = files.map(file => {
        const isImage = file.mimeType && file.mimeType.startsWith('image/');
        const previewUrl = getDrivePreviewUrl(file.fileUrl, file.mimeType);
        
        return `
            <div class="file-item">
                <strong>📎 ${file.fileName}</strong>
                <button onclick="window.open('${file.fileUrl}', '_blank')">Buka File</button>
                
                ${isImage ? `
                    <img src="${previewUrl}" 
                         style="max-width: 100%; max-height: 400px;"
                         onclick="window.open('${file.fileUrl}', '_blank')">
                ` : `
                    <p>Preview tidak tersedia. Klik "Buka File" untuk melihat.</p>
                `}
            </div>
        `;
    }).join('');

    if (Array.isArray(files) && files.length > 0) {
        console.log('[VERIFIKASI] Processing files for display:', files.length);
        
        filesHTML = `
            <div class="rpd-item">
                <h4>Dokumen Pendukung (${files.length} file)</h4>
                ${files.map((file, index) => {
                    console.log(`[VERIFIKASI] File ${index + 1}:`, file);
                    
                    if (!file || !file.fileName) {
                        return `<div class="file-item">
                            <span>⚠️ File tidak valid</span>
                        </div>`;
                    }
                    
                    const isImage = file.mimeType && file.mimeType.startsWith('image/');
                    const isPDF = file.mimeType === 'application/pdf';
                    const previewUrl = getDrivePreviewUrl(file.fileUrl, file.mimeType);
                    const fileId = file.fileId || file.fileUrl.match(/[-\w]{25,}/)?.[0];
                    
                    // ✅ FIX: Use originalName if available (backward compatible)
                    const displayName = file.originalName || file.fileName;
                    
                    console.log(`[VERIFIKASI] Preview URL for ${displayName}:`, previewUrl);
                    
                    return `
                        <div class="file-item" style="flex-direction: column; align-items: flex-start; padding: 15px; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 10px;">
                                <span style="font-weight: 500;">📎 ${displayName}</span>
                                <span class="file-size">(${formatFileSize(file.size)})</span>
                                <div style="display: flex; gap: 5px;">
                                    <button type="button" class="btn btn-sm" onclick="window.open('${file.fileUrl}', '_blank')">Buka</button>
                                    <button type="button" class="btn btn-sm btn-info" onclick="downloadDriveFile('${file.fileUrl}', '${displayName}')">Download</button>
                                </div>
                            </div>
                            ${isImage ? `
                                <div class="image-viewer-container" id="viewer-${index}">
                                    <div class="image-viewer-controls">
                                        <button type="button" class="viewer-btn" onclick="zoomIn('viewer-${index}')" title="Zoom In">
                                            <span style="font-size: 18px;">➕</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="zoomOut('viewer-${index}')" title="Zoom Out">
                                            <span style="font-size: 18px;">➖</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="rotateImage('viewer-${index}')" title="Rotate">
                                            <span style="font-size: 18px;">↻</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="resetImage('viewer-${index}')" title="Reset">
                                            <span style="font-size: 16px;">⟲</span>
                                        </button>
                                        <span class="zoom-level" id="zoom-level-${index}">100%</span>
                                    </div>
                                    <div class="image-viewer-wrapper" id="wrapper-${index}">
                                        <img src="${previewUrl}" 
                                            alt="${displayName}" 
                                            class="image-viewer-img"
                                            id="img-${index}"
                                            data-zoom="1"
                                            data-rotation="0"
                                            data-pan-x="0"
                                            data-pan-y="0"
                                            draggable="false"
                                            onerror="this.onerror=null; this.src='https://drive.google.com/uc?export=view&id=${fileId}'; if(this.complete && this.naturalHeight === 0) { this.closest('.image-viewer-container').style.display='none'; this.closest('.image-viewer-container').nextElementSibling.style.display='block'; }">
                                    </div>
                                    <div class="image-viewer-hint">
                                        💡 Gunakan scroll mouse untuk zoom, drag untuk panning
                                    </div>
                                </div>
                                <div style="display: none; margin-top: 10px; padding: 15px; background: #e3f2fd; border-radius: 8px; text-align: center;">
                                    <p style="color: #1976d2; margin: 0 0 10px 0;">🖼️ Gambar sedang dimuat atau tidak dapat ditampilkan</p>
                                    <button type="button" class="btn btn-sm btn-info" onclick="window.open('${file.fileUrl}', '_blank')">Buka di Google Drive</button>
                                </div>
                            ` : isPDF ? `
                                <div class="pdf-viewer-container" id="pdf-viewer-${index}">
                                    <div class="image-viewer-controls">
                                        <button type="button" class="viewer-btn" onclick="zoomInPDF('pdf-viewer-${index}')" title="Zoom In">
                                            <span style="font-size: 18px;">➕</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="zoomOutPDF('pdf-viewer-${index}')" title="Zoom Out">
                                            <span style="font-size: 18px;">➖</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="rotatePDF('pdf-viewer-${index}')" title="Rotate">
                                            <span style="font-size: 18px;">↻</span>
                                        </button>
                                        <button type="button" class="viewer-btn" onclick="resetPDF('pdf-viewer-${index}')" title="Reset">
                                            <span style="font-size: 16px;">⟲</span>
                                        </button>
                                        <span class="zoom-level" id="zoom-level-pdf-${index}">100%</span>
                                    </div>
                                    <div class="pdf-viewer-wrapper" id="pdf-wrapper-${index}">
                                        <div class="pdf-content" 
                                             id="pdf-content-${index}"
                                             data-zoom="1"
                                             data-rotation="0"
                                             data-pan-x="0"
                                             data-pan-y="0"
                                             style="transform-origin: center center; transition: transform 0.2s ease-out; cursor: grab;">
                                            <iframe src="${previewUrl}" 
                                                    id="pdf-iframe-${index}"
                                                    style="width: 100%; height: 600px; border: 1px solid #ddd; border-radius: 8px; pointer-events: auto;"
                                                    onerror="this.style.display='none'; this.closest('.pdf-viewer-container').nextElementSibling.style.display='block';">
                                            </iframe>
                                        </div>
                                    </div>
                                    <div class="image-viewer-hint">
                                        💡 Gunakan scroll mouse untuk zoom, drag untuk panning, klik tombol untuk rotate
                                    </div>
                                </div>
                                <div style="display: none; background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <p style="color: #666; margin: 0 0 10px 0;">📄 File PDF</p>
                                    <p style="color: #999; font-size: 12px; margin: 0 0 15px 0;">Jika preview tidak muncul, silakan buka di tab baru</p>
                                    <button type="button" class="btn btn-sm" onclick="window.open('${file.fileUrl}', '_blank')">Buka PDF di Tab Baru</button>
                                </div>
                            ` : `
                                <p style="color: #666; font-style: italic; margin-top: 10px;">
                                    📄 Preview tidak tersedia untuk tipe file ini. 
                                    <button type="button" class="btn btn-sm" onclick="window.open('${file.fileUrl}', '_blank')">Buka file</button>
                                </p>
                            `}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else {
        console.log('[VERIFIKASI] No files to display');
        filesHTML = `
            <div class="rpd-item">
                <h4>Dokumen Pendukung</h4>
                <p style="color: #999; font-style: italic; padding: 15px;">Tidak ada dokumen pendukung</p>
            </div>
        `;
    }
    
    // ── Prepare files list ──
    const _vfyFilesList = Array.isArray(files) ? files.filter(function(f){ return f && f.fileName; }) : [];
    const _hasFiles = _vfyFilesList.length > 0;

    // Build file list HTML for left panel
    function _fileIcon(mime) {
        if (!mime) return '📎';
        if (mime.startsWith('image/')) return '🖼️';
        if (mime === 'application/pdf') return '📄';
        return '📎';
    }

    const _filesListHTML = _hasFiles
        ? _vfyFilesList.map(function(f, idx) {
            const _name = f.originalName || f.fileName;
            const _icon = _fileIcon(f.mimeType);
            const _size = f.size ? ' · ' + formatFileSize(f.size) : '';
            return '<div class="_dpVfyFileItem" data-idx="' + idx + '" style="' +
                'display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;' +
                'cursor:pointer;margin-bottom:6px;">' +
                '<span style="font-size:18px;flex-shrink:0;">' + _icon + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-weight:600;font-size:12px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _name + '">' + _name + '</div>' +
                    '<div style="font-size:10px;color:#999;margin-top:2px;">' + (f.mimeType || 'file') + _size + '</div>' +
                '</div>' +
                '<button class="_dpVfyPreviewBtn" data-idx="' + idx + '" ' +
                    'style="background:#667eea;color:white;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0;white-space:nowrap;">👁️ Preview</button>' +
            '</div>';
        }).join('')
        : '<div style="color:#999;font-size:12px;font-style:italic;padding:8px;">Tidak ada dokumen pendukung</div>';

    modal.innerHTML = `
        <!-- ╔══════════════════════════════════════════╗
             ║  VERIFY MODAL — full-screen split view   ║
             ║  Kiri 42% (dark) · Kanan 58% (DP panel) ║
             ╚══════════════════════════════════════════╝ -->

        <!-- ── OVERLAY PENUH ── -->
        <div id="_vfyOverlay" style="
            position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:8990;
        "></div>

        <!-- ── PANEL KIRI — responsive: split(42% left) ↔ center(600px) ── -->
        <div id="_vfyLeftPanel" style="
            position:fixed; z-index:9010;
            display:flex; flex-direction:column; overflow:hidden;
            background:#f7f8ff;
            transition: left .3s ease, width .3s ease, top .3s ease, bottom .3s ease,
                        transform .3s ease, border-radius .3s ease, box-shadow .3s ease;
            left:0; top:0; bottom:0; width:42%;
            border-right:1px solid #e0e4f0;
            box-shadow:4px 0 20px rgba(0,0,0,.15);
            border-radius:0;
        ">
            <!-- Header gradient sama seperti modal verifikasi sebelumnya -->
            <div style="
                flex:0 0 auto; padding:12px 16px;
                background:linear-gradient(135deg,#667eea,#764ba2);
                display:flex; align-items:center; justify-content:space-between; gap:10px;
            ">
                <div style="min-width:0;">
                    <div style="font-size:17px;font-weight:700;color:white;line-height:1.3;">🔍 Verifikasi Realisasi</div>
                    <div style="font-size:14px;color:rgba(255,255,255,.85);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        🏢 ${realisasi.kua} &nbsp;·&nbsp; 📅 ${realisasi.month} ${realisasi.year} &nbsp;·&nbsp; ${realisasi.status}
                    </div>
                </div>
                <button class="close-btn" onclick="closeModal()" style="
                    flex-shrink:0; width:30px; height:30px; border-radius:50%;
                    background:rgba(255,255,255,.2); border:none;
                    color:white; font-size:18px; cursor:pointer; line-height:1;
                ">&times;</button>
            </div>

            <!-- Scrollable body -->
            <div style="flex:1 1 0; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px;
                 scrollbar-width:thin; scrollbar-color:#c1c9e0 #f7f8ff;">

                <!-- Data Pos & Nominal -->
                <div class="rpd-item">
                    <h4>📊 Data Pos &amp; Nominal</h4>
                </div>
                ${detailHTML}

                <!-- Ringkasan Total -->
                <div class="rpd-item">
                    <div class="rpd-subitem">
                        <span>Total RPD</span>
                        <strong>${rpdData ? formatCurrency(rpdTotal) : '<span style="color:#bbb">—</span>'}</strong>
                    </div>
                    <div class="rpd-subitem">
                        <span>Total Realisasi</span>
                        <strong style="color:#667eea;">${formatCurrency(_vfyTotalRealisasi)}</strong>
                    </div>
                    ${rpdData ? `<div class="rpd-subitem">
                        <span>Selisih (RPD − Realisasi)</span>
                        <strong style="color:${rpdTotal >= _vfyTotalRealisasi ? '#28a745' : '#dc3545'};">
                            ${formatCurrency(rpdTotal - _vfyTotalRealisasi)}
                        </strong>
                    </div>` : ''}
                </div>

                <!-- AP Summary -->
                <div id="apSummaryPlaceholder"></div>

                <!-- Dokumen Pendukung -->
                <div class="rpd-item">
                    <h4>📁 Dokumen Pendukung${_hasFiles ? ' (' + _vfyFilesList.length + ')' : ''}</h4>
                    ${_filesListHTML}
                </div>

                <!-- Form Verifikasi -->
                <div class="rpd-item">
                    <h4>✏️ Tindakan Verifikasi</h4>
                    <form id="verifyForm" style="margin-top:8px;">
                        <div style="margin-bottom:12px;">
                            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px;">Status</label>
                            <select id="verifyStatus" required style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                                <option value="Waiting"  ${normalizeStatus(realisasi.status) === 'Waiting'  ? 'selected' : ''}>⏳ Waiting</option>
                                <option value="Approved" ${normalizeStatus(realisasi.status) === 'Approved' ? 'selected' : ''}>✅ Approved</option>
                                <option value="Rejected" ${normalizeStatus(realisasi.status) === 'Rejected' ? 'selected' : ''}>❌ Rejected</option>
                                <option value="Paid"     ${normalizeStatus(realisasi.status) === 'Paid'     ? 'selected' : ''}>💰 Paid</option>
                            </select>
                        </div>
                        <div style="margin-bottom:12px;">
                            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px;">Catatan</label>
                            <textarea id="verifyNotes" rows="3"
                                placeholder="Tambahkan catatan jika diperlukan"
                                style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit;"
                            >${realisasi.notes || ''}</textarea>
                        </div>
                        <button type="submit" class="btn" style="width:100%;padding:10px;font-size:15px;font-weight:600;">
                            💾 Simpan Verifikasi
                        </button>
                    </form>
                </div>

                <div style="height:16px;"></div>
            </div>
        </div>

        <style>
            ._dpVfyFileItem {
                background: rgba(102,126,234,.06) !important;
                border-color: rgba(102,126,234,.2) !important;
                transition: background .15s, border-color .15s !important;
            }
            ._dpVfyFileItem:hover { background: rgba(102,126,234,.14) !important; border-color: rgba(102,126,234,.4) !important; }
            ._dpVfyFileItem.dp-active { background: rgba(102,126,234,.2) !important; border-color: #667eea !important; }
            ._dpVfyPreviewBtn:hover { opacity: .85 !important; }
            /* Split mode — DP takes right 58% */
            #dp-modal-vfy {
                width: 58% !important;
                box-shadow: none !important;
                border-left: 1px solid #e0e4f0 !important;
                transition: opacity .25s ease, transform .25s ease !important;
            }
            #dp-modal-vfy-header,
            #dp-modal-vfy-container,
            #dp-modal-vfy .dp-controls {
                width: 58% !important;
            }
            /* Center mode — hide DP smoothly */
            #dp-modal-vfy.dp-hidden {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateX(60px) !important;
            }
        </style>
    `;
    
    modal.classList.add('active');

    // ── Split ↔ Center helpers ────────────────────────────────────────────────
    const _leftPanel = document.getElementById('_vfyLeftPanel');

    // Styles for each mode
    const _SPLIT_STYLE = {
        left:'0', top:'0', bottom:'0', width:'42%',
        height:'', transform:'none', borderRadius:'0',
        borderRight:'1px solid #e0e4f0',
        boxShadow:'4px 0 20px rgba(0,0,0,.15)',
        maxHeight:''
    };
    const _CENTER_STYLE = {
        left:'50%', top:'50%', bottom:'auto', width:'min(860px, 92vw)',
        height:'min(92vh, 920px)',
        transform:'translateX(-50%) translateY(-50%)',
        borderRadius:'16px',
        borderRight:'none',
        boxShadow:'0 24px 64px rgba(0,0,0,.35)',
        maxHeight:'92vh'
    };

    function _applyPanelStyle(styles) {
        if (!_leftPanel) return;
        Object.assign(_leftPanel.style, styles);
    }

    window._vfySwitchToCenter = function() {
        _applyPanelStyle(_CENTER_STYLE);
        const dp = document.getElementById('dp-modal-vfy');
        if (dp) dp.classList.add('dp-hidden');
    };

    window._vfySwitchToSplit = function() {
        _applyPanelStyle(_SPLIT_STYLE);
        const dp = document.getElementById('dp-modal-vfy');
        if (dp) dp.classList.remove('dp-hidden');
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Initialize image and PDF viewers
    setTimeout(() => {
        // ✅ AP Summary
        apRenderVerifyModalSummary(realisasi).catch(() => {});

        // ✅ Bind file preview buttons → open DocumentPreviewer
        modal.querySelectorAll('._dpVfyPreviewBtn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const idx = parseInt(this.getAttribute('data-idx'));
                _dpVfyOpenFile(idx);
            });
        });
        // Also clicking the whole file item card opens preview
        modal.querySelectorAll('._dpVfyFileItem').forEach(function(item) {
            item.addEventListener('click', function() {
                const idx = parseInt(this.getAttribute('data-idx'));
                _dpVfyOpenFile(idx);
            });
        });

        if (_vfyFilesList.length > 0) {
            // Auto-open first file → starts in split mode
            _dpVfyOpenFile(0);
        } else {
            // No files → start in center mode
            window._vfySwitchToCenter();
        }

    }, 150);

    function _dpVfyOpenFile(idx) {
        const filesList = _vfyFilesList;
        const f = filesList[idx];
        if (!f) return;

        const previewer = _getVfyPreviewer();
        if (!previewer) {
            window.open(f.fileUrl, '_blank');
            return;
        }

        const _dName = f.originalName || f.fileName;

        // Switch to split view first, then open file
        window._vfySwitchToSplit();

        // Highlight active item
        modal.querySelectorAll('._dpVfyFileItem').forEach(function(el) {
            el.classList.toggle('dp-active', parseInt(el.getAttribute('data-idx')) === idx);
        });

        previewer.open(f.fileUrl, _dName);
    }
    
    document.getElementById('verifyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[VERIFIKASI] Submitting verification');
        
        try {
            await apiCall('updateRealisasiStatus', {
                id: realisasi.id,
                status: document.getElementById('verifyStatus').value,
                notes: document.getElementById('verifyNotes').value,
                verifiedBy: currentUser.name,
                adminId: currentUser.id,
                adminUsername: currentUser.username
            });
            
            // Invalidate cache yang terkait
            clearLocalCache('verifikasi');
            clearLocalCache('realisasis');
            clearLocalCache('dashboardStats');
            
            closeModal();
            
            // Reload dengan force refresh
            await loadVerifikasi(true);
            await loadDashboardStats(true);
            
            showNotification('Status realisasi berhasil diperbarui', 'success');
            
        } catch (error) {
            console.error('[VERIFY_REALISASI ERROR]', error);
            showNotification(error.message, 'error');
        }
    });
}

// ===== EXPORT FUNCTIONS =====
async function exportData(type) {
    console.log(`[EXPORT] Exporting ${type} data`);
    
    let yearFilter, year, kua;
    
    switch(type) {
        case 'budget':
            yearFilter = document.getElementById('budgetYearFilter');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = currentUser.role === 'Admin' ? null : currentUser.kua;
            break;
        case 'rpd':
            yearFilter = document.getElementById('rpdYearFilter');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = currentUser.role === 'Admin' ? null : currentUser.kua;
            break;
        case 'realisasi':
            yearFilter = document.getElementById('realisasiYearFilter');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = currentUser.role === 'Admin' ? null : currentUser.kua;
            break;
    }
    
    try {
        const actionName = type === 'budget' ? 'exportBudget' : 
                        type === 'rpd' ? 'exportRPD' : 
                        'exportRealisasi';
        
        const result = await apiCall(actionName, {
            year: year,
            kua: kua
        });
        
        // Download langsung ke local
        const exportUrl = `https://docs.google.com/spreadsheets/d/${result.fileId}/export?format=xlsx`;
        await downloadFile(exportUrl, result.fileName + '.xlsx');
        
        showNotification(`Export ${type} berhasil! File sedang didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal export ${type}: ${error.message}`, 'error');
    }
}

// ===== DOWNLOAD & EXPORT FUNCTIONS =====
// Download Realisasi Bulanan (untuk Operator)
async function downloadRealisasiBulanan(realisasi, format) {
    console.log(`[DOWNLOAD] Downloading realisasi ${realisasi.id} as ${format}`);
    
    try {
        const result = await apiCall('downloadRealisasiBulanan', {
            id: realisasi.id,
            format: format,
            userId: currentUser.id,
            username: currentUser.username
        });
        
        // Download file dari base64
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`${format.toUpperCase()} berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

// Export Enhanced untuk Admin
async function exportDataEnhanced(type, format) {
    console.log(`[EXPORT] Exporting ${type} as ${format}`);
    
    let yearFilter, year, kuaFilter, kua;
    
    switch(type) {
        case 'budget':
            yearFilter = document.getElementById('budgetYearFilter');
            kuaFilter = document.getElementById('budgetKUAFilterExport');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = kuaFilter ? kuaFilter.value : null;
            break;
        case 'rpd':
            yearFilter = document.getElementById('rpdYearFilter');
            kuaFilter = document.getElementById('rpdKUAFilterExport');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = kuaFilter ? kuaFilter.value : null;
            break;
        case 'realisasi':
            yearFilter = document.getElementById('realisasiYearFilter');
            kuaFilter = document.getElementById('realisasiKUAFilterExport');
            year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            kua = kuaFilter ? kuaFilter.value : null;
            break;
    }
    
    try {
        const actionName = type === 'budget' ? 'exportBudgetEnhanced' : 
                        type === 'rpd' ? 'exportRPDEnhanced' : 
                        'exportRealisasiEnhanced';
        
        const result = await apiCall(actionName, {
            year: year,
            kua: kua,
            format: format
        });
        
        // Download file dari base64
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Export ${type} berhasil!`, 'success');
    } catch (error) {
        showNotification(`Gagal export: ${error.message}`, 'error');
    }
}

// Helper function untuk download file dari base64
function downloadBase64File(base64Data, fileName, mimeType) {
    console.log(`[DOWNLOAD] Downloading ${fileName}`);
    
    try {
        // Decode base64 to binary
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        
        // Create blob
        const blob = new Blob([byteArray], { type: mimeType });
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        // Cleanup
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        console.log(`[DOWNLOAD] Success: ${fileName}`);
    } catch (error) {
        console.error('[DOWNLOAD ERROR]', error);
        showNotification('Gagal download file', 'error');
    }
}

// Show Export Modal (untuk Admin)
function showExportModal(type) {
    console.log(`[EXPORT MODAL] Type: ${type}`);
    
    let modal = document.getElementById('modal');

    
    if (!modal) {

    
        modal = document.createElement('div');

    
        modal.id = 'modal';

    
        modal.className = 'modal';

    
        document.body.appendChild(modal);

    
    }
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        years.push(i);
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h3>Export ${type.toUpperCase()}</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            
            <form id="exportForm">
                <div class="form-group">
                    <label>Tahun</label>
                    <select id="${type}YearFilterExport" required>
                        ${years.map(year => `
                            <option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label>KUA (Opsional - Kosongkan untuk semua KUA)</label>
                    <select id="${type}KUAFilterExport">
                        <option value="">Semua KUA</option>
                        ${APP_CONFIG.KUA_LIST.map(kua => `
                            <option value="${kua}">${kua}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Format</label>
                    <select id="exportFormat" required>
                        <option value="excel">Excel (.xlsx)</option>
                        <option value="pdf">PDF (.pdf)</option>
                    </select>
                </div>
                
                <button type="submit" class="btn">Download</button>
            </form>
        </div>
    `;
    
    modal.classList.add('active');
    
    document.getElementById('exportForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const format = document.getElementById('exportFormat').value;
        closeModal();
        await exportDataEnhanced(type, format);
    });
}

// ===== MODAL HELPERS =====

function sortByMonth(data) {
    return data.sort((a, b) => {
        const monthIndexA = APP_CONFIG.MONTHS.indexOf(a.month);
        const monthIndexB = APP_CONFIG.MONTHS.indexOf(b.month);
        return monthIndexA - monthIndexB;
    });
}

function getDrivePreviewUrl(fileUrl, mimeType) {
    console.log('[PREVIEW] Getting preview URL for:', fileUrl, mimeType);
    
    if (!fileUrl) {
        console.warn('[PREVIEW] No file URL provided');
        return '';
    }
    
    // Extract file ID from Google Drive URL
    let fileId = '';
    
    // Pattern 1: https://drive.google.com/file/d/FILE_ID/view
    const pattern1 = /\/file\/d\/([^/]+)/;
    const match1 = fileUrl.match(pattern1);
    
    if (match1) {
        fileId = match1[1];
    } else {
        // Pattern 2: https://drive.google.com/open?id=FILE_ID
        const pattern2 = /[?&]id=([^&]+)/;
        const match2 = fileUrl.match(pattern2);
        
        if (match2) {
            fileId = match2[1];
        } else {
            // Pattern 3: Already just the file ID
            if (fileUrl.length > 20 && !fileUrl.includes('/')) {
                fileId = fileUrl;
            }
        }
    }
    
    console.log('[PREVIEW] Extracted file ID:', fileId);
    
    if (!fileId) {
        console.warn('[PREVIEW] Could not extract file ID');
        return fileUrl;
    }
    
    // ✅ FIX: Untuk image, gunakan direct image URL (tidak perlu iframe)
    if (mimeType && mimeType.startsWith('image/')) {
        // Direct image URL yang tidak kena CSP
        const imageUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        console.log('[PREVIEW] Image URL:', imageUrl);
        return imageUrl;
    }
    
    // ✅ FIX: Untuk PDF, gunakan embedded viewer (might have CSP issues)
    if (mimeType === 'application/pdf') {
        const pdfUrl = `https://drive.google.com/file/d/${fileId}/preview`;
        console.log('[PREVIEW] PDF URL:', pdfUrl);
        return pdfUrl;
    }
    
    // Default: direct download link
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log('[PREVIEW] Download URL:', downloadUrl);
    return downloadUrl;
}

function downloadDriveFile(url, filename) {
    // Extract file ID from URL
    const fileIdMatch = url.match(/[-\w]{25,}/);
    if (!fileIdMatch) {
        window.open(url, '_blank');
        return;
    }
    
    const fileId = fileIdMatch[0];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.target = '_blank';
    link.click();
}

// ✅ FIX ISSUE #1 & #3: Custom confirmation modal
let modalHasChanges = false;

// ✅ Create custom confirmation dialog
function showConfirmDialog(message, onConfirm, onCancel) {
    // Remove existing confirm dialog if any
    const existingDialog = document.getElementById('customConfirmDialog');
    if (existingDialog) {
        existingDialog.remove();
    }
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.id = 'customConfirmDialog';
    dialog.className = 'custom-confirm-overlay';
    dialog.innerHTML = `
        <div class="custom-confirm-dialog">
            <div class="custom-confirm-icon">⚠️</div>
            <div class="custom-confirm-message">${message}</div>
            <div class="custom-confirm-buttons">
                <button class="custom-confirm-btn custom-confirm-cancel" id="confirmCancelBtn">Batal</button>
                <button class="custom-confirm-btn custom-confirm-yes" id="confirmYesBtn">Ya, Tutup</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Add event listeners
    document.getElementById('confirmYesBtn').addEventListener('click', function() {
        dialog.remove();
        if (onConfirm) onConfirm();
    });
    
    document.getElementById('confirmCancelBtn').addEventListener('click', function() {
        dialog.remove();
        if (onCancel) onCancel();
    });
    
    // Close on overlay click
    dialog.addEventListener('click', function(e) {
        if (e.target === dialog) {
            dialog.remove();
            if (onCancel) onCancel();
        }
    });
    
    // Focus on Yes button
    setTimeout(() => {
        document.getElementById('confirmYesBtn').focus();
    }, 100);
}

function closeModal(skipConfirmation = false) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    
    // ✅ Check if modal has form
    const hasForm = modal.querySelector('form');
    
    // ✅ If has form and not skipping, ask for confirmation
    if (hasForm && !skipConfirmation && modalHasChanges) {
        showConfirmDialog(
            'Anda memiliki perubahan yang belum disimpan. Yakin ingin menutup?',
            function() {
                // User confirmed
                modal.classList.remove('active');
                modal.innerHTML = '';
                modalHasChanges = false;
                
                // ✅ Restart polling jika masih di halaman realisasi
                if (currentPage === 'realisasiPage') {
                    startRealisasiPolling();
                }
            },
            function() {
                // User cancelled - do nothing
            }
        );
        return;
    }
    
    // Close modal without confirmation
    modal.classList.remove('active');
    modal.innerHTML = '';
    modalHasChanges = false;
    // Also close DP previewer if open (Admin Verifikasi / Operator Lihat Realisasi)
    if (window._dpVfyInstance && window._dpVfyInstance._isOpen()) {
        window._dpVfyInstance.close();
    }
    if (window._dpViewInstance && window._dpViewInstance._isOpen()) {
        window._dpViewInstance.close();
    }
    
    // ✅ Restart polling jika masih di halaman realisasi
    if (currentPage === 'realisasiPage') {
        startRealisasiPolling();
    }
}

function closeRealisasiModal(skipConfirmation = false) {
    const modal = document.getElementById('realisasiModal');
    if (!modal) return;
    
    // ✅ Check if modal has form
    const hasForm = modal.querySelector('form');
    
    // ✅ If has form and not skipping, ask for confirmation
    if (hasForm && !skipConfirmation && modalHasChanges) {
        showConfirmDialog(
            'Anda memiliki perubahan yang belum disimpan. Yakin ingin menutup?',
            function() {
                // User confirmed
                modal.classList.remove('active');
                modal.remove();
                modalHasChanges = false;
                uploadedFiles = [];
                
                // Restart polling jika masih di halaman realisasi
                if (currentPage === 'realisasiPage') {
                    startRealisasiPolling();
                }
            },
            function() {
                // User cancelled - do nothing
            }
        );
        return;
    }
    
    // Close modal without confirmation
    modal.classList.remove('active');
    modal.remove();
    modalHasChanges = false;
    uploadedFiles = [];
    
    // Restart polling jika masih di halaman realisasi
    if (currentPage === 'realisasiPage') {
        startRealisasiPolling();
    }
}

// Click outside modal to close
window.addEventListener('load', function() {
    let modal = document.getElementById('modal');

    if (!modal) {

        modal = document.createElement('div');

        modal.id = 'modal';

        modal.className = 'modal';

        document.body.appendChild(modal);

    }
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });
    }
});

// ===== INITIALIZATION =====
// window.addEventListener('DOMContentLoaded', function() {
//     console.log('[INIT] Application initializing...');
    
//     // Check if user is already logged in
//     const storedUser = sessionStorage.getItem('user');
//     if (storedUser) {
//         console.log('[INIT] Found stored user session');
//         currentUser = JSON.parse(storedUser);
//         showDashboard();
//     } else {
//         console.log('[INIT] No stored session, showing login page');
//     }
// });

// Prevent form submission on Enter key in number inputs
document.addEventListener('keypress', function(e) {
    if (e.target && e.target.type === 'number' && e.key === 'Enter') {
        e.preventDefault();
    }
});

console.log('[APP] Application loaded successfully');

function initializeReportsPage() {
    console.log('[REPORTS] Initializing reports page');
    
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        years.push(i);
    }
    
    const yearOptions = years.map(year => 
        `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`
    ).join('');
    
    const kuaOptions = APP_CONFIG.KUA_LIST.map(kua => 
        `<option value="${kua}">${kua}</option>`
    ).join('');
    
    // Populate all year selects
    ['rpdYearOnly', 'rpdDetailYear', 'realisasiYearOnly', 'realisasiDetailYearOnly'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.innerHTML = yearOptions;
    });
    
    // Populate KUA selects
    ['rpdYearKUA', 'realisasiYearKUA'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.innerHTML = '<option value="">Semua KUA</option>' + kuaOptions;
        }
    });
    
    console.log('[REPORTS] Reports page initialized');
}

async function downloadRPDDetailYear(format) {
    console.log(`[REPORTS] Downloading RPD Detail Year as ${format}`);
    
    const year = document.getElementById('rpdDetailYear').value;
    
    if (!year) {
        showNotification('Pilih tahun terlebih dahulu', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('exportRPDDetailYear', {
            year: year,
            format: format
        });
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan RPD Detail berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

// Realisasi Per Bulan (menggabungkan All dan Selected)
async function downloadRealisasiPerMonth(format) {
    console.log(`[REPORTS] Downloading Realisasi Per Month as ${format}`);
    
    const kua = document.getElementById('realisasiMonthKUA').value;
    const year = document.getElementById('realisasiMonthYear').value;
    const month = document.getElementById('realisasiMonth').value;
    
    if (!year || !month) {
        showNotification('Pilih tahun dan bulan terlebih dahulu', 'warning');
        return;
    }
    
    try {
        let result;
        
        if (kua) {
            // KUA Tertentu
            result = await apiCall('exportRealisasiSelectedPerMonth', {
                kua: kua,
                year: year,
                month: month,
                format: format
            });
        } else {
            // Semua KUA
            result = await apiCall('exportRealisasiAllPerMonth', {
                year: year,
                month: month,
                format: format
            });
        }
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan Realisasi berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

async function downloadRealisasiDetailMonth(format) {
    console.log(`[REPORTS] Downloading Realisasi Detail Month as ${format}`);
    
    const year = document.getElementById('realisasiDetailYear').value;
    const month = document.getElementById('realisasiDetailMonth').value;
    
    if (!year || !month) {
        showNotification('Pilih tahun dan bulan terlebih dahulu', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('exportRealisasiAllDetailPerMonth', {
            year: year,
            month: month,
            format: format
        });
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan Realisasi Detail berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

async function downloadRPDPerMonth(format) {
    console.log(`[REPORTS] Downloading RPD Per Month as ${format}`);
    
    const kua = document.getElementById('rpdMonthKUA').value;
    const year = document.getElementById('rpdMonthYear').value;
    const month = document.getElementById('rpdMonth').value;
    
    if (!year || !month) {
        showNotification('Pilih tahun dan bulan terlebih dahulu', 'warning');
        return;
    }
    
    try {
        let result;
        
        if (kua) {
            // KUA Tertentu
            result = await apiCall('exportRPDSelectedPerMonth', {
                kua: kua,
                year: year,
                month: month,
                format: format
            });
        } else {
            // Semua KUA
            result = await apiCall('exportRPDAllPerMonth', {
                year: year,
                month: month,
                format: format
            });
        }
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan RPD berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

async function downloadRPDPerYear(format) {
    console.log(`[REPORTS] Downloading RPD Per Year as ${format}`);
    
    const kua = document.getElementById('rpdYearKUA').value;
    const year = document.getElementById('rpdYearOnly').value;
    
    if (!year) {
        showNotification('Pilih tahun terlebih dahulu', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('exportRPDPerYear', {
            kua: kua || null,
            year: year,
            format: format
        });
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan RPD berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

// Realisasi Per Year (NEW)
async function downloadRealisasiPerYear(format) {
    console.log(`[REPORTS] Downloading Realisasi Per Year as ${format}`);
    
    const kua = document.getElementById('realisasiYearKUA').value;
    const year = document.getElementById('realisasiYearOnly').value;
    
    if (!year) {
        showNotification('Pilih tahun terlebih dahulu', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('exportRealisasiPerYear', {
            kua: kua || null,
            year: year,
            format: format
        });
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan Realisasi berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

// Realisasi Detail Year (NEW)
async function downloadRealisasiDetailYear(format) {
    console.log(`[REPORTS] Downloading Realisasi Detail Year as ${format}`);
    
    const year = document.getElementById('realisasiDetailYearOnly').value;
    
    if (!year) {
        showNotification('Pilih tahun terlebih dahulu', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('exportRealisasiDetailYear', {
            year: year,
            format: format
        });
        
        downloadBase64File(result.fileData, result.fileName, result.mimeType);
        showNotification(`Laporan Realisasi Detail berhasil didownload`, 'success');
    } catch (error) {
        showNotification(`Gagal download: ${error.message}`, 'error');
    }
}

// ===== AUTO-REFRESH FOR ADMIN VERIFIKASI =====
let verifikasiAutoRefresh = null;

function startVerifikasiAutoRefresh() {
    // Auto refresh setiap 2 menit untuk halaman verifikasi admin
    verifikasiAutoRefresh = setInterval(async () => {
        console.log('[AUTO-REFRESH] Refreshing verifikasi data...');
        
        // Cek apakah ada realisasi "Waiting" yang baru
        const cachedData = getCache('verifikasi');
        
        if (cachedData) {
            // Get fresh data
            const yearFilter = document.getElementById('verifikasiYearFilter');
            const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
            
            try {
                const freshData = await apiCall('getRealisasis', { year: year });
                
                // Count pending verifications
                const oldPending = cachedData.realisasis.filter(r => normalizeStatus(r.status) === STATUS.WAITING).length;
                const newPending = freshData.filter(r => normalizeStatus(r.status) === STATUS.WAITING).length;
                
                // Jika ada yang baru, tampilkan notifikasi
                if (newPending > oldPending) {
                    const diff = newPending - oldPending;
                    showNotification(`Ada ${diff} realisasi baru yang menunggu verifikasi! 🔔`, 'info');
                }
                
                // Update cache
                setCache('verifikasi', {
                    realisasis: freshData,
                    filters: cachedData.filters
                });
                
                // Re-display dengan filter yang sama
                displayVerifikasi(freshData, cachedData.filters);
                
            } catch (error) {
                console.error('[AUTO-REFRESH ERROR]', error);
            }
        }
    }, 2 * 60 * 1000); // 2 menit
}

function stopVerifikasiAutoRefresh() {
    if (verifikasiAutoRefresh) {
        clearInterval(verifikasiAutoRefresh);
        verifikasiAutoRefresh = null;
    }
}
// ===== EXPORT FUNCTIONS =====

// 1. Download RPD per Tahun
async function downloadRPDPerYear(format) {
    const kua = document.getElementById('exportRPDPerYearKua').value;
    const year = document.getElementById('exportRPDPerYearYear').value;
    
    try {
        showLoading();
        const result = await apiCall('exportRPDPerYear', {
            kua: kua,
            year: parseInt(year),
            format: format
        });
        
        // Use downloadFile from config.js which handles base64
        window.window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification('File berhasil diunduh', 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// 2. Download RPD Detail Year / Month (Tahunan & Bulanan)
async function downloadRPDDetailYear(format) {
    const mode  = (document.getElementById('exportRPDDetailMode') || {}).value || 'tahunan';
    const year  = document.getElementById('exportRPDDetailYear').value;
    const month = (document.getElementById('exportRPDDetailMonth') || {}).value || '';

    if (!year) { showNotification('Pilih tahun terlebih dahulu', 'warning'); return; }
    if (mode === 'bulanan' && !month) { showNotification('Pilih bulan terlebih dahulu', 'warning'); return; }

    try {
        showLoading();
        const action  = mode === 'bulanan' ? 'exportRPDDetailMonth' : 'exportRPDDetailYear';
        const payload = { year: parseInt(year), format };
        if (mode === 'bulanan') payload.month = month;
        const result = await apiCall(action, payload);
        window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification('File berhasil diunduh', 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// 3. Download Realisasi per Tahun
async function downloadRealisasiPerYear(format) {
    const kua  = document.getElementById('exportRealisasiPerYearKua').value;
    const year = document.getElementById('exportRealisasiPerYearYear').value;
    const apMode = (document.getElementById('exportRealisasiAPMode') || {}).value || 'exclude';
    
    try {
        showLoading();
        const result = await apiCall('exportRealisasiPerYear', {
            kua: kua,
            year: parseInt(year),
            format: format,
            apMode: apMode
        });
        window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification(`File berhasil diunduh (${apMode === 'include' ? 'Include' : 'Exclude'} Auto Payment)`, 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// 4. Download Realisasi Detail Year / Month (Tahunan & Bulanan)
async function downloadRealisasiDetailYear(format) {
    const mode   = (document.getElementById('exportRealisasiDetailMode') || {}).value || 'tahunan';
    const year   = document.getElementById('exportRealisasiDetailYear').value;
    const month  = (document.getElementById('exportRealisasiDetailMonth') || {}).value || '';
    const apMode = (document.getElementById('exportRealisasiDetailAPMode') || {}).value || 'exclude';

    if (!year) { showNotification('Pilih tahun terlebih dahulu', 'warning'); return; }
    if (mode === 'bulanan' && !month) { showNotification('Pilih bulan terlebih dahulu', 'warning'); return; }

    try {
        showLoading();
        const action  = mode === 'bulanan' ? 'exportRealisasiDetailMonth' : 'exportRealisasiDetailYear';
        const payload = { year: parseInt(year), format, apMode };
        if (mode === 'bulanan') payload.month = month;
        const result = await apiCall(action, payload);
        window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification(`File berhasil diunduh (${apMode === 'include' ? 'Include' : 'Exclude'} Auto Payment)`, 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Toggle visibility bulan untuk RPD Detail
function toggleRPDDetailMonthFilter() {
    const mode  = (document.getElementById('exportRPDDetailMode') || {}).value;
    const group = document.getElementById('exportRPDDetailMonthGroup');
    if (group) group.style.display = mode === 'bulanan' ? 'block' : 'none';
}

// Toggle visibility bulan untuk Realisasi Detail
function toggleRealisasiDetailMonthFilter() {
    const mode  = (document.getElementById('exportRealisasiDetailMode') || {}).value;
    const group = document.getElementById('exportRealisasiDetailMonthGroup');
    if (group) group.style.display = mode === 'bulanan' ? 'block' : 'none';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatNumberInput(input) {
    // Get raw value (tanpa separator)
    let value = input.value.replace(/\./g, '');
    
    // Parse as number
    let numValue = parseInt(value) || 0;
    
    // Format dengan separator ribuan
    let formatted = numValue.toLocaleString('id-ID');
    
    // Set ke input
    input.value = formatted;
    
    // Store raw value di data attribute
    input.dataset.rawValue = numValue;
}

function getRawNumberValue(input) {
    if (input.dataset.rawValue) {
        return parseInt(input.dataset.rawValue) || 0;
    }
    return parseInt(input.value.replace(/\./g, '')) || 0;
}

function setupNumberInputFormatting() {
    // Setup untuk semua input type="number" yang ada class untuk formatting
    document.querySelectorAll('input[type="number"].format-currency').forEach(input => {
        // Format on blur (when user leaves input)
        input.addEventListener('blur', function() {
            formatNumberInput(this);
        });
        
        // Remove formatting on focus (agar mudah edit)
        input.addEventListener('focus', function() {
            let raw = this.dataset.rawValue || this.value.replace(/\./g, '');
            this.value = raw;
        });
        
        // Prevent non-numeric input
        input.addEventListener('keypress', function(e) {
            if (e.key && !/[0-9]/.test(e.key)) {
                e.preventDefault();
            }
        });
    });
}

function formatWithSeparator(value) {
    console.log('[FORMAT] Input value:', value);
    
    // Remove all non-numeric characters
    const cleaned = value.replace(/\D/g, '');
    console.log('[FORMAT] Cleaned value:', cleaned);
    
    if (!cleaned) {
        console.log('[FORMAT] Empty value, returning 0');
        return '0';
    }
    
    // Convert to number and format with thousand separator
    const number = parseInt(cleaned);
    const formatted = number.toLocaleString('id-ID');
    
    console.log('[FORMAT] Formatted value:', formatted);
    return formatted;
}

function parseFormattedNumber(formattedValue) {
    const cleaned = formattedValue.replace(/\D/g, '');
    const number = parseInt(cleaned) || 0;
    console.log('[PARSE] Input:', formattedValue, '→ Output:', number);
    return number;
}

function setupAutoFormatInput(input) {
    console.log('[SETUP_FORMAT] Setting up auto-format for input:', input.id);
    
    // Store original value
    let lastValue = input.value || '0';
    
    // Format on input (real-time)
    input.addEventListener('input', function(e) {
        console.log('[INPUT_EVENT] Input changed, raw value:', this.value);
        
        // Get cursor position before formatting
        const cursorPosition = this.selectionStart;
        const oldLength = this.value.length;
        
        // Format the value
        const formatted = formatWithSeparator(this.value);
        
        // Set formatted value
        this.value = formatted;
        
        // Calculate new cursor position
        const newLength = formatted.length;
        const lengthDiff = newLength - oldLength;
        let newCursorPosition = cursorPosition + lengthDiff;
        
        // Adjust cursor position if we added/removed separators
        if (lengthDiff > 0) {
            // Separator added, move cursor after separator
            newCursorPosition = cursorPosition + lengthDiff;
        }
        
        // Set cursor position
        this.setSelectionRange(newCursorPosition, newCursorPosition);
        
        console.log('[INPUT_EVENT] Formatted value:', formatted);
        console.log('[INPUT_EVENT] Cursor position:', cursorPosition, '→', newCursorPosition);
        
        lastValue = formatted;
    });
    
    // Prevent non-numeric input
    input.addEventListener('keypress', function(e) {
        const char = String.fromCharCode(e.which);
        if (!/[0-9]/.test(char)) {
            console.log('[KEYPRESS] Blocking non-numeric char:', char);
            e.preventDefault();
        }
    });
    
    // Format on blur (cleanup)
    input.addEventListener('blur', function() {
        console.log('[BLUR] Cleaning up value:', this.value);
        this.value = formatWithSeparator(this.value);
    });
    
    // Format initial value
    if (input.value) {
        input.value = formatWithSeparator(input.value);
        console.log('[SETUP_FORMAT] Initial value formatted:', input.value);
    }
}

function setupAllAutoFormatInputs(selector = '.auto-format-number') {
    console.log('[SETUP_ALL_FORMAT] Setting up auto-format for selector:', selector);
    
    const inputs = document.querySelectorAll(selector);
    console.log('[SETUP_ALL_FORMAT] Found', inputs.length, 'inputs');
    
    inputs.forEach((input, index) => {
        console.log('[SETUP_ALL_FORMAT] Processing input', index + 1, ':', input.id || input.name);
        setupAutoFormatInput(input);
    });
}

async function saveConfig() {
    console.log('[SAVE_CONFIG] Saving configuration...');
    
    try {
        const rpdStatusEl = document.getElementById('rpdStatus');
        const realisasiStatusEl = document.getElementById('realisasiStatus');
        const maxFileSizeEl = document.getElementById('realisasiMaxFileSize');
        const maxFilesEl = document.getElementById('realisasiMaxFiles');

        // Check dulu
        if (!rpdStatusEl || !realisasiStatusEl) {
            console.error('[SAVE_CONFIG] Elements not found!');
            showNotification('Form konfigurasi tidak ditemukan', 'error');
            return;
        }

        const configData = {
            RPD_STATUS: rpdStatusEl.value,
            REALISASI_STATUS: realisasiStatusEl.value,
            REALISASI_MAX_FILE_SIZE: parseInt(maxFileSizeEl.value) || 5,
            REALISASI_MAX_FILES: parseInt(maxFilesEl.value) || 10,
            // ✅ FIX: baca dari _rpdEditMonthsChecked (state), bukan dari DOM —
            // kalau kotak pencarian sedang memfilter list, bulan yang sudah
            // dicentang tapi sedang tersembunyi tidak akan ke-skip.
            RPD_EDIT_OPEN_MONTHS: JSON.stringify(
                Object.keys(_rpdEditMonthsChecked).filter(m => _rpdEditMonthsChecked[m])
            )
        };

        console.log('[SAVE_CONFIG] Config data to save:', configData);

        // Call API to save
        await apiCall('updateRPDConfig', configData);

        // ✅ FIX: Set cache dengan data yang baru di-save
        // Ini memastikan saat user pindah halaman dan kembali, config masih tetap
        console.log('[SAVE_CONFIG] Setting cache with new config data');
        setCache('config', configData);

        console.log('[SAVE_CONFIG] Configuration saved successfully');
        showNotification('Konfigurasi berhasil disimpan', 'success');
        
    } catch (error) {
        console.error('[SAVE_CONFIG ERROR]', error);
        showNotification('Gagal menyimpan konfigurasi: ' + error.message, 'error');
    }
}

async function checkRealisasiStatus() {
    console.log('[CONFIG_CHECK] Checking realisasi status');
    
    // ✅ Try cache first
    const cachedConfig = getLocalCache('config');
    if (cachedConfig) {
        console.log('[CONFIG_CHECK] Using cached config');
        const status = cachedConfig.REALISASI_STATUS || 'open';
        console.log('[CONFIG_CHECK] Realisasi status:', status);
        return status;
    }
    
    // ✅ Fetch if no cache
    try {
        const configData = await apiCall('getRPDConfig');
        console.log('[CONFIG_CHECK] Config fetched from server:', configData);
        
        // Update cache
        updateLocalCache('config', configData);
        
        const status = configData.REALISASI_STATUS || 'open';
        console.log('[CONFIG_CHECK] Realisasi status:', status);
        
        return status;
    } catch (error) {
        console.error('[CONFIG_CHECK ERROR]', error);
        return 'open'; // Default to open on error
    }
}

async function loadUploadConfig() {
    console.log('[UPLOAD_CONFIG] Loading upload configuration');
    
    // ✅ Try cache first
    const cachedConfig = getLocalCache('config');
    if (cachedConfig) {
        console.log('[UPLOAD_CONFIG] Using cached config');
        uploadConfig.maxFiles = parseInt(cachedConfig.REALISASI_MAX_FILES) || 10;
        uploadConfig.maxFileSize = parseInt(cachedConfig.REALISASI_MAX_FILE_SIZE) || 10;
        console.log('[UPLOAD_CONFIG] Configuration loaded from cache:', uploadConfig);
        return uploadConfig;
    }
    
    // ✅ Fetch if no cache
    try {
        const configData = await apiCall('getRPDConfig');
        
        // Update cache
        updateLocalCache('config', configData);
        
        uploadConfig.maxFiles = parseInt(configData.REALISASI_MAX_FILES) || 10;
        uploadConfig.maxFileSize = parseInt(configData.REALISASI_MAX_FILE_SIZE) || 10;
        
        console.log('[UPLOAD_CONFIG] Configuration loaded from server:', uploadConfig);
        
        return uploadConfig;
    } catch (error) {
        console.error('[UPLOAD_CONFIG ERROR]', error);
        return uploadConfig;
    }
}

function validateFile(file) {
    console.log('[VALIDATE_FILE] Checking file:', file.name, formatFileSize(file.size));
    
    // Check file size
    const maxSizeBytes = uploadConfig.maxFileSize * 1024 * 1024;
    
    if (file.size > maxSizeBytes) {
        return {
            valid: false,
            error: `Ukuran file ${file.name} (${formatFileSize(file.size)}) melebihi batas maksimal ${uploadConfig.maxFileSize} MB`
        };
    }
    
    // Check file type (optional - allow PDF and images)
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif'
    ];
    
    if (!allowedTypes.includes(file.type)) {
        return {
            valid: false,
            error: `Tipe file ${file.name} tidak didukung. Hanya PDF dan gambar (JPG, PNG, GIF) yang diperbolehkan.`
        };
    }
    
    console.log('[VALIDATE_FILE] File valid:', file.name);
    
    return { valid: true };
}

async function handleFileInputChange(event) {
    console.log('[FILE_INPUT] File input changed');
    
    const files = Array.from(event.target.files);
    console.log('[FILE_INPUT] Selected files:', files.length);
    
    if (files.length === 0) {
        console.log('[FILE_INPUT] No files selected');
        return;
    }
    
    // Get existing files count
    const existingFilesInput = document.getElementById('existingFilesData');
    let existingCount = 0;
    
    if (existingFilesInput && existingFilesInput.value) {
        try {
            const existing = JSON.parse(existingFilesInput.value);
            existingCount = Array.isArray(existing) ? existing.length : 0;
        } catch (e) {
            console.log('[FILE_INPUT] No existing files');
        }
    }
    
    const totalCount = existingCount + uploadedFiles.length + files.length;
    
    // Check max files limit
    if (totalCount > uploadConfig.maxFiles) {
        showNotification(
            `Maksimal ${uploadConfig.maxFiles} file. Anda sudah memiliki ${existingCount + uploadedFiles.length} file.`,
            'error'
        );
        event.target.value = '';
        return;
    }
    
    // Process each file
    for (const file of files) {
        // Validate
        const validation = validateFile(file);
        
        if (!validation.valid) {
            showNotification(validation.error, 'error');
            continue;
        }
        
        // Convert to base64
        try {
            const base64 = await fileToBase64(file);
            
            const fileObj = {
                fileName: file.name,
                fileData: base64,
                mimeType: file.type,
                fileSize: file.size,
                tempId: Date.now() + Math.random()  // Temporary ID for UI
            };
            
            uploadedFiles.push(fileObj);
            
            console.log('[FILE_INPUT] File added:', file.name, formatFileSize(file.size));
            
        } catch (error) {
            console.error('[FILE_INPUT] Error reading file:', file.name, error);
            showNotification(`Gagal membaca file: ${file.name}`, 'error');
        }
    }
    
    // Clear input
    event.target.value = '';
    
    // Update UI
    displayUploadedFiles();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = () => {
            // Remove data URL prefix
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        
        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsDataURL(file);
    });
}

function updateFileCount() {
    const countEl = document.getElementById('fileCount');
    
    if (countEl) {
        const existingFilesInput = document.getElementById('existingFilesData');
        let existingCount = 0;
        
        if (existingFilesInput && existingFilesInput.value) {
            try {
                const existing = JSON.parse(existingFilesInput.value);
                existingCount = Array.isArray(existing) ? existing.length : 0;
            } catch (e) {}
        }
        
        const totalCount = existingCount + uploadedFiles.length;
        
        countEl.textContent = `${totalCount} / ${uploadConfig.maxFiles} file`;
        countEl.style.color = totalCount >= uploadConfig.maxFiles ? '#dc3545' : '#666';
    }
}

function displayExistingFiles(existingFiles) {
    console.log('[DISPLAY_EXISTING] Displaying existing files:', existingFiles.length);
    
    const container = document.getElementById('existingFilesContainer');
    
    if (!container) {
        console.error('[DISPLAY_EXISTING] Container not found');
        return;
    }
    
    if (!existingFiles || existingFiles.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<div class="existing-files-section" style="margin-bottom: 15px;">';
    html += '<h4 style="margin-bottom: 10px; font-size: 14px; color: #666;">File Sudah Terupload:</h4>';
    html += '<div class="existing-files-list">';
    
    existingFiles.forEach((file, index) => {
        const fileIcon = file.mimeType === 'application/pdf' ? '📄' : '🖼️';
        
        html += `
            <div class="existing-file-item" id="existing-file-${index}" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f0f8ff; border: 1px solid #d0e8ff; border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                    <span style="font-size: 24px;">${fileIcon}</span>
                    <div>
                        <div style="font-weight: 500; color: #333; font-size: 14px;">${file.fileName}</div>
                        <div style="font-size: 12px; color: #666;">${formatFileSize(file.size || 0)}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button 
                        type="button" 
                        onclick='previewFile(${JSON.stringify(file).replace(/'/g, "&#39;")})' 
                        title="Preview"
                        style="background: #667eea; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        👁️ Preview
                    </button>
                    <button 
                        type="button" 
                        onclick="removeExistingFile(${index})" 
                        title="Hapus"
                        style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        🗑️ Hapus
                    </button>
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    container.innerHTML = html;
}

function displayUploadedFiles() {
    console.log('[DISPLAY_UPLOADED] Displaying uploaded files:', uploadedFiles.length);
    
    const container = document.getElementById('uploadedFilesContainer');
    
    if (!container) {
        console.error('[DISPLAY_UPLOADED] Container not found');
        return;
    }
    
    if (uploadedFiles.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 14px;">Belum ada file yang dipilih</p>';
        updateFileCount();
        return;
    }
    
    let html = '<div class="uploaded-files-section">';
    html += '<h4 style="margin-bottom: 10px; font-size: 14px; color: #666;">File Baru Dipilih:</h4>';
    html += '<div class="uploaded-files-list">';
    
    uploadedFiles.forEach((file, index) => {
        const fileIcon = file.mimeType === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image';
        
        html += `
            <div class="uploaded-file-item" id="uploaded-file-${index}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas ${fileIcon}" style="font-size: 24px; color: #667eea;"></i>
                    <div>
                        <div style="font-weight: 500; color: #333;">${file.fileName}</div>
                        <div style="font-size: 12px; color: #666;">${formatFileSize(file.fileSize)}</div>
                    </div>
                </div>
                <button 
                    type="button" 
                    class="btn-delete-file" 
                    onclick="removeUploadedFile(${index})" 
                    title="Hapus"
                    style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-trash"></i> Hapus
                </button>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    container.innerHTML = html;
    updateFileCount();
}

function removeUploadedFile(index) {
    console.log('[REMOVE_UPLOADED] Removing file at index:', index);
    
    if (index < 0 || index >= uploadedFiles.length) {
        console.error('[REMOVE_UPLOADED] Invalid index:', index);
        return;
    }
    
    const removedFile = uploadedFiles.splice(index, 1);
    console.log('[REMOVE_UPLOADED] Removed file:', removedFile[0].fileName);
    
    showNotification('File dihapus dari daftar', 'info');
    
    // Update UI
    displayUploadedFiles();
}

// ===== IMAGE VIEWER FUNCTIONS (ZOOM, ROTATE, PAN) =====

/**
 * Initialize image viewer with pan and zoom capabilities
 */
function initImageViewer(viewerId) {
    const wrapper = document.getElementById(`wrapper-${viewerId.replace('viewer-', '')}`);
    const img = document.getElementById(`img-${viewerId.replace('viewer-', '')}`);
    
    if (!wrapper || !img) return;
    
    let isPanning = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    
    // Mouse wheel zoom
    wrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        adjustZoom(viewerId, delta);
    }, { passive: false });
    
    // Touch/trackpad zoom (pinch gesture)
    let initialDistance = 0;
    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            initialDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
        }
    });
    
    wrapper.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const currentDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            
            const delta = (currentDistance - initialDistance) * 0.01;
            adjustZoom(viewerId, delta);
            initialDistance = currentDistance;
        }
    }, { passive: false });
    
    // Pan with mouse
    img.addEventListener('mousedown', (e) => {
        isPanning = true;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        img.style.cursor = 'grabbing';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        
        currentX = e.clientX - startX;
        currentY = e.clientY - startY;
        
        img.setAttribute('data-pan-x', currentX);
        img.setAttribute('data-pan-y', currentY);
        updateImageTransform(viewerId);
    });
    
    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            img.style.cursor = 'grab';
        }
    });
    
    // Pan with touch
    let touchStartX = 0, touchStartY = 0;
    img.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX - currentX;
            touchStartY = e.touches[0].clientY - currentY;
        }
    });
    
    img.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            currentX = e.touches[0].clientX - touchStartX;
            currentY = e.touches[0].clientY - touchStartY;
            
            img.setAttribute('data-pan-x', currentX);
            img.setAttribute('data-pan-y', currentY);
            updateImageTransform(viewerId);
        }
    }, { passive: false });
    
    // Set initial cursor
    img.style.cursor = 'grab';
}

/**
 * Zoom in image
 */
function zoomIn(viewerId) {
    adjustZoom(viewerId, 0.25);
}

/**
 * Zoom out image
 */
function zoomOut(viewerId) {
    adjustZoom(viewerId, -0.25);
}

/**
 * Adjust zoom level
 */
function adjustZoom(viewerId, delta) {
    const img = document.getElementById(`img-${viewerId.replace('viewer-', '')}`);
    if (!img) return;
    
    let currentZoom = parseFloat(img.getAttribute('data-zoom')) || 1;
    currentZoom += delta;
    
    // Limit zoom range: 0.25x to 5x
    currentZoom = Math.max(0.25, Math.min(5, currentZoom));
    
    img.setAttribute('data-zoom', currentZoom);
    updateImageTransform(viewerId);
    updateZoomLevel(viewerId, currentZoom);
}

/**
 * Rotate image 90 degrees clockwise
 */
function rotateImage(viewerId) {
    const img = document.getElementById(`img-${viewerId.replace('viewer-', '')}`);
    if (!img) return;
    
    let currentRotation = parseFloat(img.getAttribute('data-rotation')) || 0;
    currentRotation += 90;
    if (currentRotation >= 360) currentRotation = 0;
    
    img.setAttribute('data-rotation', currentRotation);
    updateImageTransform(viewerId);
}

/**
 * Reset image to original state
 */
function resetImage(viewerId) {
    const img = document.getElementById(`img-${viewerId.replace('viewer-', '')}`);
    if (!img) return;
    
    img.setAttribute('data-zoom', '1');
    img.setAttribute('data-rotation', '0');
    img.setAttribute('data-pan-x', '0');
    img.setAttribute('data-pan-y', '0');
    
    updateImageTransform(viewerId);
    updateZoomLevel(viewerId, 1);
}

/**
 * Update image transform based on current zoom, rotation, and pan
 */
function updateImageTransform(viewerId) {
    const img = document.getElementById(`img-${viewerId.replace('viewer-', '')}`);
    if (!img) return;
    
    const zoom = parseFloat(img.getAttribute('data-zoom')) || 1;
    const rotation = parseFloat(img.getAttribute('data-rotation')) || 0;
    const panX = parseFloat(img.getAttribute('data-pan-x')) || 0;
    const panY = parseFloat(img.getAttribute('data-pan-y')) || 0;
    
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`;
}

/**
 * Update zoom level display
 */
function updateZoomLevel(viewerId, zoom) {
    const zoomLabel = document.getElementById(`zoom-level-${viewerId.replace('viewer-', '')}`);
    if (zoomLabel) {
        zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }
}

/**
 * Initialize all image viewers in modal
 */
function initAllImageViewers() {
    // Find all image viewer containers
    const viewers = document.querySelectorAll('.image-viewer-container');
    viewers.forEach((viewer) => {
        initImageViewer(viewer.id);
    });
}

// Auto-initialize viewers when modal is shown
// This is called after modal content is set
const originalShowModal = typeof showModal !== 'undefined' ? showModal : null;
if (originalShowModal) {
    window.showModal = function(...args) {
        originalShowModal.apply(this, args);
        setTimeout(initAllImageViewers, 100);
    };
}

// Expose to window
window.downloadRPDPerYear = downloadRPDPerYear;
window.downloadRPDDetailYear = downloadRPDDetailYear;
window.toggleRPDDetailMonthFilter = toggleRPDDetailMonthFilter;
window.toggleRealisasiDetailMonthFilter = toggleRealisasiDetailMonthFilter;

// ── FALLBACK: Realisasi + RPD Fallback per Tahun ──────────────────────────────
async function downloadFallbackPerYear(format) {
    const kua    = (document.getElementById('fallbackPerYearKua') || {}).value || '';
    const year   = document.getElementById('fallbackPerYearYear').value;
    const apMode = (document.getElementById('fallbackPerYearAPMode') || {}).value || 'exclude';
    if (!year) { showNotification('Pilih tahun terlebih dahulu', 'warning'); return; }
    try {
        showLoading();
        const result = await apiCall('exportFallbackPerYear', { year: parseInt(year), kua, format, apMode });
        window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification('File berhasil diunduh', 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally { hideLoading(); }
}

// ── FALLBACK: Realisasi + RPD Fallback Detail (Tahunan/Bulanan) ───────────────
async function downloadFallbackDetail(format) {
    const mode   = (document.getElementById('fallbackDetailMode') || {}).value || 'tahunan';
    const year   = document.getElementById('fallbackDetailYear').value;
    const month  = (document.getElementById('fallbackDetailMonth') || {}).value || '';
    const apMode = (document.getElementById('fallbackDetailAPMode') || {}).value || 'exclude';
    if (!year) { showNotification('Pilih tahun terlebih dahulu', 'warning'); return; }
    if (mode === 'bulanan' && !month) { showNotification('Pilih bulan terlebih dahulu', 'warning'); return; }
    try {
        showLoading();
        const action  = mode === 'bulanan' ? 'exportFallbackDetailMonth' : 'exportFallbackDetailYear';
        const payload = { year: parseInt(year), format, apMode };
        if (mode === 'bulanan') payload.month = month;
        const result = await apiCall(action, payload);
        window.downloadFile(result.fileData, result.fileName, result.mimeType);
        showNotification('File berhasil diunduh', 'success');
    } catch (error) {
        showNotification('Gagal mengunduh file: ' + error.message, 'error');
    } finally { hideLoading(); }
}

function toggleFallbackDetailMonthFilter() {
    const mode  = (document.getElementById('fallbackDetailMode') || {}).value;
    const group = document.getElementById('fallbackDetailMonthGroup');
    if (group) group.style.display = mode === 'bulanan' ? 'block' : 'none';
}

window.downloadRealisasiDetailYear = downloadRealisasiDetailYear;
window.downloadFallbackPerYear       = downloadFallbackPerYear;
window.downloadFallbackDetail        = downloadFallbackDetail;
window.toggleFallbackDetailMonthFilter = toggleFallbackDetailMonthFilter;

// ===== LAPORAN UNIFIED CONTROLLER =====
const _LAP = {
    jenis:  'per-tahun',  // 'per-tahun' | 'detail'
    sumber: 'rpd'         // 'rpd' | 'realisasi' | 'fallback'
};

const _LAP_DESC = {
    rpd:       'Data RPD yang telah diinput KUA',
    realisasi: 'Data Realisasi yang sudah Approved atau Paid',
    fallback:  'Menggunakan Realisasi jika ada, RPD jika bulan tersebut belum ada realisasi'
};

function _lapSyncHiddenSelects() {
    const y = (document.getElementById('lapTahun')  || {}).value || '';
    const m = (document.getElementById('lapBulan')  || {}).value || '';
    const mode   = (document.getElementById('lapMode')   || {}).value || 'tahunan';
    const kua    = (document.getElementById('lapKua')    || {}).value || '';
    const apMode = (document.getElementById('lapAPMode') || {}).value || 'exclude';
    // Sync all legacy hidden selects so old download functions still work
    [['exportRPDPerYearYear','exportRPDDetailYear','exportRealisasiPerYearYear',
      'exportRealisasiDetailYear','fallbackPerYearYear','fallbackDetailYear']].flat()
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = y; });
    [['exportRPDPerYearKua','exportRealisasiPerYearKua','fallbackPerYearKua']].flat()
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = kua; });
    [['exportRPDDetailMode','exportRealisasiDetailMode','fallbackDetailMode']].flat()
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = mode; });
    [['exportRPDDetailMonth','exportRealisasiDetailMonth','fallbackDetailMonth']].flat()
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = m; });
    [['exportRealisasiAPMode','exportRealisasiDetailAPMode','fallbackPerYearAPMode','fallbackDetailAPMode']].flat()
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = apMode; });
}

function _lapUpdateUI() {
    const isDetail   = _LAP.jenis  === 'detail';
    const isRPDOnly  = _LAP.sumber === 'rpd';
    const mode       = (document.getElementById('lapMode') || {}).value || 'tahunan';
    const isBulanan  = isDetail && mode === 'bulanan';

    // Show/hide rows
    const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? 'flex' : 'none'; };
    show('lapModeRow',  isDetail);
    show('lapBulanRow', isBulanan);
    show('lapKuaRow',   !isDetail);
    show('lapAPRow',    !isRPDOnly);

    // Segmented button active states — Jenis
    const btnPerTahun = document.getElementById('lapJenisPerTahun');
    const btnDetail   = document.getElementById('lapJenisDetail');
    if (btnPerTahun && btnDetail) {
        btnPerTahun.style.background = !isDetail ? '#3b5bdb' : '#f8f9ff';
        btnPerTahun.style.color      = !isDetail ? '#fff'    : '#555';
        btnDetail.style.background   =  isDetail ? '#3b5bdb' : '#f8f9ff';
        btnDetail.style.color        =  isDetail ? '#fff'    : '#555';
    }
    // Segmented button active states — Sumber
    ['rpd','realisasi','fallback'].forEach(s => {
        const ids = {rpd:'lapSrcRPD', realisasi:'lapSrcRealisasi', fallback:'lapSrcFallback'};
        const btn = document.getElementById(ids[s]);
        if (btn) { btn.style.background = _LAP.sumber===s ? '#3b5bdb':'#f8f9ff'; btn.style.color = _LAP.sumber===s ? '#fff':'#555'; }
    });
    // Description
    const desc = document.getElementById('lapSumberDesc');
    if (desc) desc.textContent = _LAP_DESC[_LAP.sumber] || '';
}

function setLaporanJenis(j) {
    _LAP.jenis = j;
    _lapUpdateUI();
}
function setLaporanSumber(s) {
    _LAP.sumber = s;
    _lapUpdateUI();
}
function onLaporanModeChange() {
    _lapUpdateUI();
}

async function downloadLaporan(format) {
    if (typeof APP_CONFIG !== 'undefined' &&
        APP_CONFIG.FEATURES &&
        APP_CONFIG.FEATURES.LAPORAN_DOWNLOAD === false) {

        // Simulasi delay seperti sedang menghubungi server
        showLoading();
        await new Promise(r => setTimeout(r, 1800));
        hideLoading();

        const overlay = document.createElement('div');
        overlay.id = '_lapErrorOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
          <div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.35);">
            <div style="font-size:48px;margin-bottom:12px;">❌</div>
            <h3 style="margin:0 0 8px;color:#c0392b;font-size:18px;">Error</h3>
            <p style="color:#555;font-size:13px;margin:0 0 6px;">Gagal terhubung ke layanan ekspor laporan.</p>
            <p style="color:#888;font-size:12px;margin:0 0 20px;background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;">
              <strong>Error 402:</strong> API quota exceeded.
            </p>
            <button onclick="document.getElementById('_lapErrorOverlay').remove()"
              style="background:#3b5bdb;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer;">
              Tutup
            </button>
          </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        return;
    }

    _lapSyncHiddenSelects();
    const { jenis, sumber } = _LAP;
    if      (jenis === 'per-tahun' && sumber === 'rpd')        await downloadRPDPerYear(format);
    else if (jenis === 'detail'    && sumber === 'rpd')        await downloadRPDDetailYear(format);
    else if (jenis === 'per-tahun' && sumber === 'realisasi')  await downloadRealisasiPerYear(format);
    else if (jenis === 'detail'    && sumber === 'realisasi')  await downloadRealisasiDetailYear(format);
    else if (jenis === 'per-tahun' && sumber === 'fallback')   await downloadFallbackPerYear(format);
    else if (jenis === 'detail'    && sumber === 'fallback')   await downloadFallbackDetail(format);
}

window.setLaporanJenis    = setLaporanJenis;
window.setLaporanSumber   = setLaporanSumber;
window.onLaporanModeChange = onLaporanModeChange;
window.downloadLaporan    = downloadLaporan;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        // Populate lapTahun and lapKua
        const lapTahun = document.getElementById('lapTahun');
        if (lapTahun && lapTahun.options.length === 0) {
            const cy = new Date().getFullYear();
            for (let i = cy-5; i <= cy+1; i++) {
                const opt = document.createElement('option');
                opt.value = i; opt.text = i;
                if (i === cy) opt.selected = true;
                lapTahun.appendChild(opt);
            }
        }
        const lapKua = document.getElementById('lapKua');
        if (lapKua && lapKua.options.length <= 1 && typeof APP_CONFIG !== 'undefined') {
            APP_CONFIG.KUA_LIST.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k; opt.text = k;
                lapKua.appendChild(opt);
            });
        }
        _lapUpdateUI();
    }, 300);
});
window.downloadRealisasiPerYear = downloadRealisasiPerYear;
window.downloadRealisasiDetailYear = downloadRealisasiDetailYear;
window.loadRPDDataFromSelect = loadRPDDataFromSelect;
window.updateRealisasiSisaFields = updateRealisasiSisaFields;
window.closeRealisasiModal = closeRealisasiModal;
window.removeUploadedFile = removeUploadedFile;
window.removeExistingFile = removeExistingFile;
window.handleFileInputChange = handleFileInputChange;

// ===== NEW: Expose Load Data & Sort Functions =====
window.loadRPDsWithFilters = loadRPDsWithFilters;
window.loadRealisasisForYear = loadRealisasisForYear;
window.loadVerifikasiWithFilters = loadVerifikasiWithFilters;
window.sortRPDTable = sortRPDTable;
window.sortVerifikasiTable = sortVerifikasiTable;

// Image Viewer Functions
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.rotateImage = rotateImage;
window.resetImage = resetImage;
window.initImageViewer = initImageViewer;
window.initAllImageViewers = initAllImageViewers;

// ===== PDF VIEWER FUNCTIONS =====

/**
 * Zoom in PDF
 */
function zoomInPDF(viewerId) {
    adjustZoomPDF(viewerId, 0.25);
}

/**
 * Zoom out PDF
 */
function zoomOutPDF(viewerId) {
    adjustZoomPDF(viewerId, -0.25);
}

/**
 * Adjust PDF zoom level
 */
function adjustZoomPDF(viewerId, delta) {
    const pdfContent = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-content-').replace('view-pdf-viewer-', 'view-pdf-content-')}`);
    if (!pdfContent) return;
    
    let currentZoom = parseFloat(pdfContent.getAttribute('data-zoom')) || 1;
    currentZoom += delta;
    
    // Limit zoom range: 0.5x to 3x
    currentZoom = Math.max(0.5, Math.min(3, currentZoom));
    
    pdfContent.setAttribute('data-zoom', currentZoom);
    updatePDFTransform(viewerId);
    updateZoomLevelPDF(viewerId, currentZoom);
}

/**
 * Rotate PDF 90 degrees clockwise
 */
function rotatePDF(viewerId) {
    const pdfContent = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-content-').replace('view-pdf-viewer-', 'view-pdf-content-')}`);
    if (!pdfContent) return;
    
    let currentRotation = parseFloat(pdfContent.getAttribute('data-rotation')) || 0;
    currentRotation += 90;
    if (currentRotation >= 360) currentRotation = 0;
    
    pdfContent.setAttribute('data-rotation', currentRotation);
    updatePDFTransform(viewerId);
}

/**
 * Reset PDF to original state
 */
function resetPDF(viewerId) {
    const pdfContent = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-content-').replace('view-pdf-viewer-', 'view-pdf-content-')}`);
    if (!pdfContent) return;
    
    pdfContent.setAttribute('data-zoom', '1');
    pdfContent.setAttribute('data-rotation', '0');
    pdfContent.setAttribute('data-pan-x', '0');
    pdfContent.setAttribute('data-pan-y', '0');
    
    updatePDFTransform(viewerId);
    updateZoomLevelPDF(viewerId, 1);
}

/**
 * Update PDF transform based on current zoom, rotation, and pan
 */
function updatePDFTransform(viewerId) {
    const pdfContent = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-content-').replace('view-pdf-viewer-', 'view-pdf-content-')}`);
    if (!pdfContent) return;
    
    const zoom = parseFloat(pdfContent.getAttribute('data-zoom')) || 1;
    const rotation = parseFloat(pdfContent.getAttribute('data-rotation')) || 0;
    const panX = parseFloat(pdfContent.getAttribute('data-pan-x')) || 0;
    const panY = parseFloat(pdfContent.getAttribute('data-pan-y')) || 0;
    
    pdfContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`;
}

/**
 * Update zoom level display for PDF
 */
function updateZoomLevelPDF(viewerId, zoom) {
    const zoomLabel = document.getElementById(`zoom-level-${viewerId.replace('pdf-viewer-', 'pdf-').replace('view-pdf-viewer-', 'view-pdf-')}`);
    if (zoomLabel) {
        zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }
}

/**
 * Initialize PDF viewer with pan and zoom support
 */
function initPDFViewer(viewerId) {
    const wrapper = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-wrapper-').replace('view-pdf-viewer-', 'view-pdf-wrapper-')}`);
    const pdfContent = document.getElementById(`${viewerId.replace('pdf-viewer-', 'pdf-content-').replace('view-pdf-viewer-', 'view-pdf-content-')}`);
    
    if (!wrapper || !pdfContent) return;
    
    let isPanning = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    
    // Mouse wheel zoom
    wrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        adjustZoomPDF(viewerId, delta);
    }, { passive: false });
    
    // Pan with mouse (on PDF content wrapper, not iframe)
    pdfContent.addEventListener('mousedown', (e) => {
        // Only allow panning if not clicking on iframe itself
        if (e.target === pdfContent) {
            isPanning = true;
            startX = e.clientX - currentX;
            startY = e.clientY - currentY;
            pdfContent.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        
        currentX = e.clientX - startX;
        currentY = e.clientY - startY;
        
        pdfContent.setAttribute('data-pan-x', currentX);
        pdfContent.setAttribute('data-pan-y', currentY);
        updatePDFTransform(viewerId);
    });
    
    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            pdfContent.style.cursor = 'grab';
        }
    });
    
    // Pan with touch
    let touchStartX = 0, touchStartY = 0;
    pdfContent.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX - currentX;
            touchStartY = e.touches[0].clientY - currentY;
        }
    });
    
    pdfContent.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            currentX = e.touches[0].clientX - touchStartX;
            currentY = e.touches[0].clientY - touchStartY;
            
            pdfContent.setAttribute('data-pan-x', currentX);
            pdfContent.setAttribute('data-pan-y', currentY);
            updatePDFTransform(viewerId);
        }
    }, { passive: false });
    
    // Set initial cursor
    pdfContent.style.cursor = 'grab';
}

/**
 * Initialize all PDF viewers in modal
 */
function initAllPDFViewers() {
    const viewers = document.querySelectorAll('.pdf-viewer-container');
    viewers.forEach((viewer) => {
        initPDFViewer(viewer.id);
    });
}

// PDF Viewer Functions
window.zoomInPDF = zoomInPDF;
window.zoomOutPDF = zoomOutPDF;
window.rotatePDF = rotatePDF;
window.resetPDF = resetPDF;
window.initPDFViewer = initPDFViewer;
window.initAllPDFViewers = initAllPDFViewers;// ===== BOP SCRIPT - ROMBAK TOTAL SISTEM FILTER =====
// File: bop-script-fixed.js
// Sistem baru dengan raw data storage dan filter yang lebih reliable

// ===== GLOBAL RAW DATA STORAGE =====
const rawData = {
    rpds: [],
    verifikasi: [],
    budgets: []
};

// ===== MONTH ORDER FOR SORTING =====
const MONTH_ORDER = {
    'Januari': 1, 'Februari': 2, 'Maret': 3, 'April': 4,
    'Mei': 5, 'Juni': 6, 'Juli': 7, 'Agustus': 8,
    'September': 9, 'Oktober': 10, 'November': 11, 'Desember': 12
};

// ===== SORT STATE =====
const sortState = {
    rpd: { column: -1, ascending: true },
    verifikasi: { column: -1, ascending: true },
    budget: { column: -1, ascending: true }
};

// ===== FUNGSI UMUM: APPLY FILTER =====
function applyFilters(data, filters) {
    return data.filter(item => {
        for (let key in filters) {
            const filterValue = filters[key];
            if (!filterValue) continue;
            // Untuk filter status, gunakan normalizeStatus agar backward compatible
            if (key === 'status') {
                if (normalizeStatus(item[key]) !== filterValue) return false;
            } else if (item[key] !== filterValue) {
                return false;
            }
        }
        return true;
    });
}

// ===== RPD: LOAD DATA WITH FILTERS =====
async function loadRPDsWithFilters() {
    console.log('[RPD] Loading with filters...');
    
    const yearFilter = document.getElementById('rpdYearFilter');
    const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
    
    // ✅ Cek local cache dulu — jika sudah ada dan tahunnya sama, gunakan cache
    const _localRPDs = getLocalCache('rpds');
    if (_localRPDs && _localRPDs.length > 0) {
        // Verify cache is for the same year (check first record)
        const _cacheYear = _localRPDs[0] && _localRPDs[0].year ? parseInt(_localRPDs[0].year) : null;
        if (!_cacheYear || _cacheYear === year) {
            rawData.rpds = _localRPDs;
            console.log('[RPD] Using preloaded cache (no API call) -', _localRPDs.length, 'records');
            displayRPDsFiltered();
            return; // ← STOP: tidak perlu ke server
        }
    }
    
    // Cache miss atau tahun berbeda → fetch dari server
    showLoading();
    try {
        let rpds;
        if (currentUser.role === 'Admin') {
            rpds = await apiCall('getRPDs', { year: year });
        } else {
            rpds = await apiCall('getRPDs', { kua: currentUser.kua, year: year });
        }
        rawData.rpds = sortByMonth(rpds);
        updateLocalCache('rpds', rawData.rpds);
        displayRPDsFiltered();
        hideLoading();
        showNotification('Data RPD berhasil dimuat', 'success');
    } catch (error) {
        hideLoading();
        console.error('[RPD ERROR]', error);
        showNotification('Gagal memuat data RPD', 'error');
    }
}

// ===== RPD: DISPLAY FILTERED =====
function displayRPDsFiltered() {
    const tbody = document.querySelector('#rpdTable tbody');
    
    // Ambil filter values
    const kuaFilter = document.getElementById('rpdKUAFilter');
    const monthFilter = document.getElementById('rpdMonthFilter');
    const yearFilter = document.getElementById('rpdYearFilter');
    
    const filters = {};
    if (kuaFilter && kuaFilter.value) filters.kua = kuaFilter.value;
    if (monthFilter && monthFilter.value) filters.month = monthFilter.value;
    if (yearFilter && yearFilter.value) filters.year = parseInt(yearFilter.value);
    
    console.log('[RPD] Applying filters:', filters);
    
    // Apply filters
    let filteredData = applyFilters(rawData.rpds, filters);
    
    console.log('[RPD] Filtered:', filteredData.length, 'records');
    
    if (filteredData.length === 0) {
        const colSpan = currentUser.role === 'Admin' ? '7' : '6';
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center;">Belum ada data RPD</td></tr>`;
        return;
    }
    
    // Calculate total
    let totalNominal = 0;
    
    // ✅ FIX: Edit RPD memakai RPD_EDIT_OPEN_MONTHS, BUKAN RPD_STATUS.
    const _rpdCfg2 = getLocalCache('config');
    let _rpdEditOpenMonths2 = [];
    try { _rpdEditOpenMonths2 = JSON.parse((_rpdCfg2 && _rpdCfg2.RPD_EDIT_OPEN_MONTHS) || '[]'); } catch (e) { _rpdEditOpenMonths2 = []; }

    const rows = filteredData.map((rpd, index) => {
        totalNominal += parseFloat(rpd.total || 0);
        
        // ✅ FIX: Store rpd in Map and pass only ID to avoid token errors
        const rpdId = rpd.id || `temp-rpd-${Date.now()}-${index}`;
        rpdDataStore.set(rpdId, rpd);
        const kuaColumn = currentUser.role === 'Admin' ? `<td>${rpd.kua || '-'}</td>` : '';

        // ✅ FIX: sama seperti displayRPDs — ikuti RPD_EDIT_OPEN_MONTHS
        const _canEdit2 = currentUser.role !== 'Admin' && _rpdEditOpenMonths2.includes(rpd.month);
        
        return `
        <tr>
            <td>${index + 1}</td>
            ${kuaColumn}
            <td>${rpd.month || '-'}</td>
            <td>${rpd.year || '-'}</td>
            <td>${formatCurrency(rpd.total || 0)}</td>
            <td>${rpd.createdAt ? formatDate(rpd.createdAt) : '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="viewRPD('${rpdId}')">Lihat</button>
                    ${_canEdit2 ? `<button class="btn btn-sm" onclick="editRPD('${rpdId}')">Edit</button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    const kuaTotalColumn = currentUser.role === 'Admin' ? '<td></td>' : '';
    
    const totalRow = `
        <tr style="background: #f8f9fa; font-weight: bold;">
            <td></td>
            ${kuaTotalColumn}
            <td colspan="2" style="text-align: right;">TOTAL:</td>
            <td>${formatCurrency(totalNominal)}</td>
            <td colspan="2"></td>
        </tr>
    `;
    
    tbody.innerHTML = rows + totalRow;
    console.log('[RPD] Displayed', filteredData.length, 'records, Total:', formatCurrency(totalNominal));
}

// ===== RPD: SORT TABLE =====
function sortRPDTable(columnIndex) {
    console.log('[RPD SORT] Column', columnIndex);
    
    const tbody = document.querySelector('#rpdTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr:not(:last-child)'));
    
    if (rows.length === 0 || (rows.length === 1 && rows[0].textContent.includes('Klik tombol'))) {
        return;
    }
    
    // Toggle sort direction
    if (sortState.rpd.column === columnIndex) {
        sortState.rpd.ascending = !sortState.rpd.ascending;
    } else {
        sortState.rpd.column = columnIndex;
        sortState.rpd.ascending = true;
    }
    
    // Sort
    rows.sort((a, b) => {
        const aCells = a.querySelectorAll('td');
        const bCells = b.querySelectorAll('td');
        let aValue, bValue;
        
        if (currentUser.role === 'Admin') {
            // Admin: 0=No, 1=KUA, 2=Bulan, 3=Tahun, 4=Total, 5=Dibuat
            switch(columnIndex) {
                case 0: aValue = parseInt(aCells[0].textContent); bValue = parseInt(bCells[0].textContent); break;
                case 1: aValue = aCells[1].textContent.trim(); bValue = bCells[1].textContent.trim(); break;
                case 2: aValue = MONTH_ORDER[aCells[2].textContent.trim()] || 0; bValue = MONTH_ORDER[bCells[2].textContent.trim()] || 0; break;
                case 3: aValue = parseInt(aCells[3].textContent); bValue = parseInt(bCells[3].textContent); break;
                case 4: aValue = parseFloat(aCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
                case 5: aValue = new Date(aCells[5].textContent.trim()).getTime() || 0; bValue = new Date(bCells[5].textContent.trim()).getTime() || 0; break;
            }
        } else {
            // Operator: 0=No, 1=Bulan, 2=Tahun, 3=Total, 4=Dibuat
            switch(columnIndex) {
                case 0: aValue = parseInt(aCells[0].textContent); bValue = parseInt(bCells[0].textContent); break;
                case 2: aValue = MONTH_ORDER[aCells[1].textContent.trim()] || 0; bValue = MONTH_ORDER[bCells[1].textContent.trim()] || 0; break;
                case 3: aValue = parseInt(aCells[2].textContent); bValue = parseInt(bCells[2].textContent); break;
                case 4: aValue = parseFloat(aCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
                case 5: aValue = new Date(aCells[4].textContent.trim()).getTime() || 0; bValue = new Date(bCells[4].textContent.trim()).getTime() || 0; break;
            }
        }
        
        if (aValue < bValue) return sortState.rpd.ascending ? -1 : 1;
        if (aValue > bValue) return sortState.rpd.ascending ? 1 : -1;
        return 0;
    });
    
    // Re-render
    const totalRow = tbody.querySelector('tr:last-child');
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
        row.querySelector('td:first-child').textContent = index + 1;
        tbody.appendChild(row);
    });
    if (totalRow) tbody.appendChild(totalRow);
    
    console.log('[RPD SORT] Done, direction:', sortState.rpd.ascending ? 'ASC' : 'DESC');
}

// ===== VERIFIKASI: LOAD DATA WITH FILTERS =====
async function loadVerifikasiWithFilters() {
    console.log('[VERIFIKASI] Loading with filters...');
    showLoading();
    
    try {
        const yearFilter = document.getElementById('verifikasiYearFilter');
        const year = yearFilter ? parseInt(yearFilter.value) : new Date().getFullYear();
        
        let realisasis = await apiCall('getRealisasis', { year: year });
        
        // Simpan ke raw data
        rawData.verifikasi = realisasis;
        
        // Display dengan filter yang dipilih
        displayVerifikasiFiltered();
        
        hideLoading();
        showNotification('Data verifikasi berhasil dimuat', 'success');
        
        // ===== PREFETCH RPDs + AP DATA untuk semua KUA di verifikasi =====
        // Tujuan: klik tombol Verifikasi tidak perlu API call lagi (data sudah di cache)
        try {
            // Kumpulkan unique KUA + month yang ada
            const _vKUAs  = new Set(realisasis.map(r => r.kua).filter(Boolean));
            const _vMonths = new Set(realisasis.map(r => r.month && r.year ? `${r.month}|${r.year}` : null).filter(Boolean));
            
            const _prefetchPromises = [];
            
            // Prefetch RPDs per KUA (merge ke existing cache)
            _vKUAs.forEach(kua => {
                const _cachedRPDs = getLocalCache('rpds') || [];
                const _hasKUA = _cachedRPDs.some(r => r.kua === kua);
                if (!_hasKUA) {
                    _prefetchPromises.push(
                        apiCall('getRPDs', { kua: kua, year: year }).then(rpds => {
                            const _existing = getLocalCache('rpds') || [];
                            const _merged   = [..._existing.filter(r => r.kua !== kua), ...rpds];
                            updateLocalCache('rpds', _merged);
                            rawData.rpds = sortByMonth(_merged);
                            console.log('[VERIFIKASI PREFETCH] RPDs cached for KUA:', kua);
                        }).catch(() => {})
                    );
                }
            });
            
            // Prefetch AP Config + Nominals
            _prefetchPromises.push(apGetConfig());
            _vMonths.forEach(mk => {
                const [_vm, _vy] = mk.split('|');
                _prefetchPromises.push(apGetNominals(_vm, parseInt(_vy)));
            });
            
            Promise.all(_prefetchPromises).then(() => {
                console.log('[VERIFIKASI PREFETCH] ✅ All RPDs + AP data prefetched,', _vKUAs.size, 'KUAs,', _vMonths.size, 'months');
            }).catch(() => {});
        } catch (_pErr) {
            console.warn('[VERIFIKASI PREFETCH] Error (non-fatal):', _pErr);
        }
    } catch (error) {
        hideLoading();
        console.error('[VERIFIKASI ERROR]', error);
        showNotification('Gagal memuat data verifikasi', 'error');
    }
}

// ===== VERIFIKASI: DISPLAY FILTERED =====
function displayVerifikasiFiltered() {
    const tbody = document.querySelector('#verifikasiTable tbody');
    
    // Ambil filter values
    const kuaFilter = document.getElementById('verifikasiKUAFilter');
    const monthFilter = document.getElementById('verifikasiMonthFilter');
    const statusFilter = document.getElementById('verifikasiStatusFilter');
    const yearFilter = document.getElementById('verifikasiYearFilter');
    
    const filters = {};
    if (kuaFilter && kuaFilter.value) filters.kua = kuaFilter.value;
    if (monthFilter && monthFilter.value) filters.month = monthFilter.value;
    if (statusFilter && statusFilter.value) filters.status = statusFilter.value;
    if (yearFilter && yearFilter.value) filters.year = parseInt(yearFilter.value);
    
    console.log('[VERIFIKASI] Applying filters:', filters);
    
    // Apply filters
    let filteredData = applyFilters(rawData.verifikasi, filters);
    
    console.log('[VERIFIKASI] Filtered:', filteredData.length, 'records');
    
    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Tidak ada data realisasi</td></tr>';
        return;
    }
    
    // Calculate total
    let totalNominal = 0;
    
    const rows = filteredData.map((real, index) => {
        totalNominal += parseFloat(real.total || 0);
        
        let statusClass = getStatusBadgeClass(real.status);
        let statusText = getStatusLabel(real.status);
        
        const realisasiId = real.id || `temp-${Date.now()}-${index}`;
        realisasiDataStore.set(realisasiId, real);
        
        return `
        <tr>
            <td>${index + 1}</td>
            <td>${real.kua || '-'}</td>
            <td>${real.month || '-'}</td>
            <td>${real.year || '-'}</td>
            <td>${formatCurrency(real.total || 0)}</td>
            <td>${real.createdAt ? formatDate(real.createdAt) : '-'}</td>
            <td><span class="badge badge-${statusClass}">${statusText}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm" onclick="verifyRealisasi('${realisasiId}')">Verifikasi</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
    
    // ✅ FIX #1: Beri ID pada sel total agar dapat diupdate oleh apRenderVerifikasiSummary
    const totalRow = `
        <tr style="background: #f8f9fa; font-weight: bold;" id="verifikasiTotalRow">
            <td colspan="4" style="text-align: right;" id="verifikasiTotalLabel">TOTAL:</td>
            <td id="verifikasiTotalValue">${formatCurrency(totalNominal)}</td>
            <td colspan="3"></td>
        </tr>
    `;
    
    tbody.innerHTML = rows + totalRow;
    console.log("[VERIFIKASI] Displayed", filteredData.length, "records, Total:", formatCurrency(totalNominal));
    // ✅ Auto Payment: tampilkan summary Include/Exclude, lalu sinkronkan total row
    apRenderVerifikasiSummary(filteredData).catch(() => {});
}

// ===== VERIFIKASI: SORT TABLE =====
function sortVerifikasiTable(columnIndex) {
    console.log('[VERIFIKASI SORT] Column', columnIndex);
    
    const tbody = document.querySelector('#verifikasiTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr:not(:last-child)'));
    
    if (rows.length === 0 || (rows.length === 1 && rows[0].textContent.includes('Klik tombol'))) {
        return;
    }
    
    // Toggle sort direction
    if (sortState.verifikasi.column === columnIndex) {
        sortState.verifikasi.ascending = !sortState.verifikasi.ascending;
    } else {
        sortState.verifikasi.column = columnIndex;
        sortState.verifikasi.ascending = true;
    }
    
    // Sort
    rows.sort((a, b) => {
        const aCells = a.querySelectorAll('td');
        const bCells = b.querySelectorAll('td');
        let aValue, bValue;
        
        // 0=No, 1=KUA, 2=Bulan, 3=Tahun, 4=Total, 5=Dibuat, 6=Status
        switch(columnIndex) {
            case 0: aValue = parseInt(aCells[0].textContent); bValue = parseInt(bCells[0].textContent); break;
            case 1: aValue = aCells[1].textContent.trim(); bValue = bCells[1].textContent.trim(); break;
            case 2: aValue = MONTH_ORDER[aCells[2].textContent.trim()] || 0; bValue = MONTH_ORDER[bCells[2].textContent.trim()] || 0; break;
            case 3: aValue = parseInt(aCells[3].textContent); bValue = parseInt(bCells[3].textContent); break;
            case 4: aValue = parseFloat(aCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
            case 5: aValue = new Date(aCells[5].textContent.trim()).getTime() || 0; bValue = new Date(bCells[5].textContent.trim()).getTime() || 0; break;
            case 6: aValue = aCells[6].textContent.trim(); bValue = bCells[6].textContent.trim(); break;
        }
        
        if (aValue < bValue) return sortState.verifikasi.ascending ? -1 : 1;
        if (aValue > bValue) return sortState.verifikasi.ascending ? 1 : -1;
        return 0;
    });
    
    // Re-render
    const totalRow = tbody.querySelector('tr:last-child');
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
        row.querySelector('td:first-child').textContent = index + 1;
        tbody.appendChild(row);
    });
    if (totalRow) tbody.appendChild(totalRow);
    
    console.log('[VERIFIKASI SORT] Done, direction:', sortState.verifikasi.ascending ? 'ASC' : 'DESC');
}

// ===== BUDGET: SORT TABLE =====
function sortBudgetTable(columnIndex) {
    console.log('[BUDGET SORT] Column', columnIndex);
    
    const tbody = document.querySelector('#budgetTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    if (rows.length === 0) return;
    
    // Toggle sort direction
    if (sortState.budget.column === columnIndex) {
        sortState.budget.ascending = !sortState.budget.ascending;
    } else {
        sortState.budget.column = columnIndex;
        sortState.budget.ascending = true;
    }
    
    // Sort
    rows.sort((a, b) => {
        const aCells = a.querySelectorAll('td');
        const bCells = b.querySelectorAll('td');
        let aValue, bValue;
        
        // 0=No, 1=KUA, 2=Tahun, 3=Budget, 4=TotalRPD, 5=TotalRealisasi, 6=SisaBudget
        switch(columnIndex) {
            case 0: aValue = parseInt(aCells[0].textContent); bValue = parseInt(bCells[0].textContent); break;
            case 1: aValue = aCells[1].textContent.trim(); bValue = bCells[1].textContent.trim(); break;
            case 2: aValue = parseInt(aCells[2].textContent); bValue = parseInt(bCells[2].textContent); break;
            case 3: aValue = parseFloat(aCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[3].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
            case 4: aValue = parseFloat(aCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[4].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
            case 5: aValue = parseFloat(aCells[5].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[5].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
            case 6: aValue = parseFloat(aCells[6].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; bValue = parseFloat(bCells[6].textContent.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0; break;
        }
        
        if (aValue < bValue) return sortState.budget.ascending ? -1 : 1;
        if (aValue > bValue) return sortState.budget.ascending ? 1 : -1;
        return 0;
    });
    
    // Re-render
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
        row.querySelector('td:first-child').textContent = index + 1;
        tbody.appendChild(row);
    });
    
    console.log('[BUDGET SORT] Done, direction:', sortState.budget.ascending ? 'ASC' : 'DESC');
}

// ===== EXPOSE TO WINDOW =====
window.loadRPDsWithFilters = loadRPDsWithFilters;
window.displayRPDsFiltered = displayRPDsFiltered;
window.sortRPDTable = sortRPDTable;

window.loadVerifikasiWithFilters = loadVerifikasiWithFilters;
window.displayVerifikasiFiltered = displayVerifikasiFiltered;
window.sortVerifikasiTable = sortVerifikasiTable;

window.sortBudgetTable = sortBudgetTable;

console.log('[BOP FIXED] ✅ New filter system loaded');
// =====================================================================
// =================== AUTO PAYMENT MODULE =============================
// =====================================================================
// Fitur ini sepenuhnya backward-compatible:
//  - Jika KUA tidak punya AP config → sistem berjalan seperti biasa
//  - Data realisasi lama tidak diubah
//  - Semua perubahan hanya pada layer perhitungan/tampilan

const AP_POS = ['522111', '522112'];
const AP_POS_NAMES = {
    '522111': 'Belanja Langganan Listrik',
    '522112': 'Belanja Langganan Telepon / Internet'
};

// Session-level cache — diisi sekali per sesi
let _apConfig   = null;  // { 'KUA Xyz': { '522111': true/false, '522112': true/false } }
let _apNominals = {};    // { 'BulanTahun': { 'KUA Xyz': { '522111': 0, '522112': 0 } } }

// ------------------------------------------------------------------
// CORE HELPERS
// ------------------------------------------------------------------
/** Ambil config AP (lazy-load, cache sesi) */
async function apGetConfig() {
    if (_apConfig !== null) return _apConfig;
    try {
        const raw = await apiCall('getAutoPaymentConfig', {});
        _apConfig = raw || {};
    } catch (e) {
        console.warn('[AP] getAutoPaymentConfig failed:', e);
        _apConfig = {};
    }
    return _apConfig;
}

/** Reset cache config (misal setelah save) */
function apInvalidateConfig() { _apConfig = null; }

/** Apakah POS kode `code` aktif untuk KUA ini? */
function apIsActive(kua, code) {
    if (!_apConfig || !_apConfig[kua]) return false;
    return _apConfig[kua][code] === true;
}

/** KUA-KUA yang punya setidaknya satu POS AP aktif */
function apGetActiveKUAs() {
    if (!_apConfig) return [];
    return Object.keys(_apConfig).filter(kua =>
        AP_POS.some(code => _apConfig[kua][code] === true)
    );
}

/** Ambil nominal AP untuk bulan+tahun (lazy-load, cache sesi) */
async function apGetNominals(month, year) {
    const key = `${month}_${year}`;
    if (_apNominals[key]) return _apNominals[key];
    try {
        const raw = await apiCall('getAutoPaymentNominal', { month, year });
        _apNominals[key] = raw || {};
    } catch (e) {
        console.warn('[AP] getAutoPaymentNominal failed:', e);
        _apNominals[key] = {};
    }
    return _apNominals[key];
}

/** Parse angka dari input (handle dot/comma separator) */
function apParseNumber(str) {
    if (typeof str === 'number') return str;
    return parseFloat((str || '').toString().replace(/\./g, '').replace(',', '.')) || 0;
}

/**
 * Hitung total Include & Exclude Auto Payment untuk sebuah list realisasi
 * @param {Array}  realisasiList
 * @param {Object} cfg       - _apConfig
 * @param {Object} nomByKUA  - { KUA: { '522111': n, '522112': n } }
 */
function apCalcTotals(realisasiList, cfg, nomByKUA) {
    let include = 0, exclude = 0;
    (realisasiList || []).forEach(real => {
        const kua  = real.kua;
        const kuaCfg = cfg && cfg[kua] ? cfg[kua] : null;
        const nom    = nomByKUA && nomByKUA[kua] ? nomByKUA[kua] : {};

        if (!real.data || !kuaCfg) {
            // KUA tanpa AP config → both mode pakai nilai manual
            const t = parseFloat(real.total || 0);
            include += t; exclude += t;
            return;
        }

        let incT = 0, excT = 0;
        Object.entries(real.data).forEach(([code, items]) => {
            const isAuto = kuaCfg[code] === true;
            const manualSum = Object.values(items).reduce((s, v) => s + (parseFloat(v) || 0), 0);
            if (isAuto) {
                incT += parseFloat(nom[code] || 0);  // include → nominal admin
                excT += 0;                            // exclude → 0
            } else {
                incT += manualSum;
                excT += manualSum;
            }
        });
        include += incT; exclude += excT;
    });
    return { include, exclude };
}

// ------------------------------------------------------------------
// PAGE INIT & TAB SWITCHING
// ------------------------------------------------------------------
function initAutoPaymentPage() {
    console.log('[AP] Initializing Auto Payment page');
    // Populate bulan dropdown
    const monthSel = document.getElementById('apNominalMonth');
    if (monthSel && monthSel.options.length <= 1) {
        const curMonth = APP_CONFIG.MONTHS[new Date().getMonth()];
        APP_CONFIG.MONTHS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            if (m === curMonth) opt.selected = true;
            monthSel.appendChild(opt);
        });
    }
    switchAPTab('config');
}

function switchAPTab(tab) {
    document.getElementById('apTabConfig').style.display  = tab === 'config'  ? 'block' : 'none';
    document.getElementById('apTabNominal').style.display = tab === 'nominal' ? 'block' : 'none';
    document.getElementById('tabConfigBtn').className  = tab === 'config'  ? 'btn btn-sm'           : 'btn btn-sm btn-secondary';
    document.getElementById('tabNominalBtn').className = tab === 'nominal' ? 'btn btn-sm'           : 'btn btn-sm btn-secondary';
}

// ------------------------------------------------------------------
// TAB 1: CONFIG
// ------------------------------------------------------------------
async function loadAPConfig() {
    console.log('[AP] Loading config...');
    showLoading();
    try {
        const raw = await apiCall('getAutoPaymentConfig', {});
        _apConfig = raw || {};

        const tbody = document.querySelector('#apConfigTable tbody');
        if (!tbody) { hideLoading(); return; }

        tbody.innerHTML = APP_CONFIG.KUA_LIST.map(kua => {
            const cfg = _apConfig[kua] || {};
            return `<tr>
                <td>${kua}</td>
                <td style="text-align:center;">
                    <input type="checkbox" data-kua="${kua}" data-code="522111" class="ap-cfg-cb"
                        ${cfg['522111'] ? 'checked' : ''}>
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" data-kua="${kua}" data-code="522112" class="ap-cfg-cb"
                        ${cfg['522112'] ? 'checked' : ''}>
                </td>
            </tr>`;
        }).join('');

        hideLoading();
        showNotification('Config Auto Payment berhasil dimuat', 'success');
    } catch (e) {
        hideLoading();
        console.error('[AP] loadAPConfig error:', e);
    }
}

async function saveAPConfig() {
    const checkboxes = document.querySelectorAll('.ap-cfg-cb');
    if (checkboxes.length === 0) {
        showNotification('Load data terlebih dahulu sebelum menyimpan', 'warning');
        return;
    }

    const newCfg = {};
    checkboxes.forEach(cb => {
        const kua = cb.dataset.kua, code = cb.dataset.code;
        if (!newCfg[kua]) newCfg[kua] = { '522111': false, '522112': false };
        newCfg[kua][code] = cb.checked;
    });

    try {
        await apiCall('saveAutoPaymentConfig', { config: newCfg });
        _apConfig = newCfg;  // update cache
        showNotification('Konfigurasi Auto Payment berhasil disimpan ✅', 'success');
    } catch (e) { console.error('[AP] saveAPConfig error:', e); }
}

// ------------------------------------------------------------------
// TAB 2: INPUT NOMINAL
// ------------------------------------------------------------------
async function loadAPNominal() {
    const month = document.getElementById('apNominalMonth').value;
    const year  = document.getElementById('apNominalYear').value;
    if (!month || !year) {
        showNotification('Pilih bulan dan tahun terlebih dahulu', 'warning');
        return;
    }

    // Pastikan config ter-load
    await apGetConfig();
    const activeKUAs = apGetActiveKUAs();
    if (activeKUAs.length === 0) {
        showNotification('Belum ada KUA dengan Auto Payment aktif. Atur Config terlebih dahulu.', 'info');
        return;
    }

    showLoading();
    try {
        const raw = await apiCall('getAutoPaymentNominal', { month, year });
        const nomData = raw || {};
        const key = `${month}_${year}`;
        _apNominals[key] = nomData;

        _renderAPNominalTable(activeKUAs, month, year, nomData);
        hideLoading();
        showNotification('Nominal Auto Payment berhasil dimuat', 'success');
    } catch (e) {
        hideLoading();
        console.error('[AP] loadAPNominal error:', e);
    }
}

function _renderAPNominalTable(activeKUAs, month, year, nomData) {
    const tbody = document.querySelector('#apNominalTable tbody');
    if (!tbody) return;

    let grandTotal = 0;
    tbody.innerHTML = activeKUAs.map(kua => {
        const cfg = _apConfig[kua] || {};
        const nom = nomData[kua] || {};
        const v1  = cfg['522111'] ? (parseFloat(nom['522111']) || 0) : null;
        const v2  = cfg['522112'] ? (parseFloat(nom['522112']) || 0) : null;
        const rowTotal = (v1 || 0) + (v2 || 0);
        grandTotal += rowTotal;

        const inputStyle = 'text-align:right; width:140px; border:1px solid #ddd; border-radius:6px; padding:6px 10px;';
        const cell1 = cfg['522111']
            ? `<input type="text" class="ap-nom-inp auto-format-number" data-kua="${kua}" data-code="522111"
                   value="${v1}" style="${inputStyle}" oninput="apUpdateRowTotal(this)">`
            : `<span style="color:#999; font-size:12px;">—</span>`;
        const cell2 = cfg['522112']
            ? `<input type="text" class="ap-nom-inp auto-format-number" data-kua="${kua}" data-code="522112"
                   value="${v2}" style="${inputStyle}" oninput="apUpdateRowTotal(this)">`
            : `<span style="color:#999; font-size:12px;">—</span>`;

        return `<tr>
            <td>${kua}</td>
            <td style="text-align:right;">${cell1}</td>
            <td style="text-align:right;">${cell2}</td>
            <td style="text-align:right; font-weight:bold;" id="apRow_${kua.replace(/[\s/]/g,'_')}">${formatCurrency(rowTotal)}</td>
        </tr>`;
    }).join('');

    document.getElementById('apNominalGrandTotal').textContent = formatCurrency(grandTotal);
    document.getElementById('apNominalFooter').style.display = 'block';

    setTimeout(() => {
        if (typeof setupAllAutoFormatInputs === 'function') {
            setupAllAutoFormatInputs('.ap-nom-inp');
        }
        document.querySelectorAll('.ap-nom-inp').forEach(inp => inp.addEventListener('input', apRecalcGrand));
    }, 80);
}

function apUpdateRowTotal(inp) {
    const kua   = inp.dataset.kua;
    const rowEl = document.getElementById('apRow_' + kua.replace(/[\s/]/g, '_'));
    if (!rowEl) return;
    let total = 0;
    document.querySelectorAll(`.ap-nom-inp[data-kua="${kua}"]`).forEach(i => total += apParseNumber(i.value));
    rowEl.textContent = formatCurrency(total);
}

function apRecalcGrand() {
    let grand = 0;
    document.querySelectorAll('.ap-nom-inp').forEach(inp => grand += apParseNumber(inp.value));
    const el = document.getElementById('apNominalGrandTotal');
    if (el) el.textContent = formatCurrency(grand);
}

async function saveAPNominal() {
    const month = document.getElementById('apNominalMonth').value;
    const year  = document.getElementById('apNominalYear').value;
    if (!month || !year) { showNotification('Pilih bulan dan tahun', 'warning'); return; }

    const inputs = document.querySelectorAll('.ap-nom-inp');
    if (inputs.length === 0) { showNotification('Load data dulu sebelum menyimpan', 'warning'); return; }

    const nominals = {};
    inputs.forEach(inp => {
        const kua = inp.dataset.kua, code = inp.dataset.code;
        const val = apParseNumber(inp.value);
        if (val < 0) { showNotification('Nominal tidak boleh negatif', 'error'); return; }
        if (!nominals[kua]) nominals[kua] = { '522111': 0, '522112': 0 };
        nominals[kua][code] = val;
    });

    try {
        await apiCall('saveAutoPaymentNominal', { month, year, nominals });
        // Update cache
        const key = `${month}_${year}`;
        if (!_apNominals[key]) _apNominals[key] = {};
        Object.assign(_apNominals[key], nominals);
        showNotification('Nominal Auto Payment berhasil disimpan ✅', 'success');
    } catch (e) { console.error('[AP] saveAPNominal error:', e); }
}

// ------------------------------------------------------------------
// INTEGRASI FORM REALISASI (Operator) — Disable input POS aktif
// ------------------------------------------------------------------
async function apApplyToForm(kua, month, year) {
    if (!kua || !month || !year) return;
    await apGetConfig();
    const cfg = _apConfig[kua];
    if (!cfg) return;  // Tidak ada AP config untuk KUA ini → skip

    const hasSomeActive = AP_POS.some(code => cfg[code] === true);
    if (!hasSomeActive) return;

    const nomData = await apGetNominals(month, year);
    const nom     = (nomData && nomData[kua]) ? nomData[kua] : {};

    AP_POS.forEach(code => {
        if (!cfg[code]) return;
        const apNom = parseFloat(nom[code] || 0);

        // Disable semua input dengan data-code ini
        document.querySelectorAll(`.realisasi-input[data-code="${code}"]`).forEach(inp => {
            inp.value    = apNom;
            inp.disabled = true;
            inp.style.cssText = 'background:#e8f4fd; color:#4a6cf7; font-weight:bold; text-align:right; border:2px solid #667eea; border-radius:6px;';
            inp.title = `Auto Payment: ${formatCurrency(apNom)} (ditetapkan Admin)`;
            if (inp.classList.contains('auto-format-number')) {
                inp.value = apNom.toLocaleString('id-ID');
            }
        });

        // Tambahkan badge info di header POS
        document.querySelectorAll('.rpd-item').forEach(item => {
            const h4 = item.querySelector('h4');
            if (h4 && h4.textContent.includes(code) && !item.querySelector('.ap-badge')) {
                const badge = document.createElement('div');
                badge.className = 'ap-badge';
                badge.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#667eea,#764ba2); color:white; padding:5px 12px; border-radius:20px; font-size:12px; margin-bottom:10px; font-weight:500;';
                badge.innerHTML = `⚡ Total pembayaran melalui SAKTI: <strong>${formatCurrency(apNom)}</strong>`;
                h4.insertAdjacentElement('afterend', badge);
            }
        });
    });

    calculateRealisasiTotal();
}

// ------------------------------------------------------------------
// INTEGRASI VERIFIKASI — Tampilkan total Include/Exclude di bawah tabel
// ------------------------------------------------------------------
async function apRenderVerifikasiSummary(filteredData) {
    await apGetConfig();
    const activeKUAs = apGetActiveKUAs();
    if (activeKUAs.length === 0) {
        // Tidak ada AP → hapus summary jika ada
        const el = document.getElementById('apVerifikasiSummary');
        if (el) el.remove();
        return;
    }

    // Ambil semua bulan+tahun unik dari data terfilter
    const monthYearPairs = [...new Set(
        filteredData.map(r => `${r.month}_${r.year}`)
    )];

    // Kumpulkan semua nominal yang diperlukan
    const allNom = {};
    for (const pair of monthYearPairs) {
        const [month, year] = pair.split('_');
        const nomData = await apGetNominals(month, year);
        // Merge ke allNom per KUA (aggregate per month jika multiple)
        Object.entries(nomData).forEach(([kua, codes]) => {
            if (!allNom[kua]) allNom[kua] = { '522111': 0, '522112': 0 };
            AP_POS.forEach(code => {
                allNom[kua][code] += parseFloat(codes[code] || 0);
            });
        });
    }

    const { include, exclude } = apCalcTotals(filteredData, _apConfig, allNom);

    // ✅ FIX #1: Sinkronkan TOTAL row di tabel dengan nilai Include AP
    // Agar kolom TOTAL di verifikasiTable konsisten dengan apVerifikasiSummary Include AP
    const totalValueEl = document.getElementById('verifikasiTotalValue');
    const totalLabelEl = document.getElementById('verifikasiTotalLabel');
    if (totalValueEl) {
        totalValueEl.textContent = formatCurrency(include);
        totalValueEl.style.color = '#28a745';
    }
    if (totalLabelEl) {
        totalLabelEl.innerHTML = 'TOTAL <small style="font-weight:normal; font-size:11px; color:#667eea;">(Include AP)</small>:';
    }

    // Render / update summary block
    let summaryEl = document.getElementById('apVerifikasiSummary');
    if (!summaryEl) {
        summaryEl = document.createElement('div');
        summaryEl.id = 'apVerifikasiSummary';
        const table = document.getElementById('verifikasiTable');
        if (table) table.insertAdjacentElement('afterend', summaryEl);
    }

    summaryEl.innerHTML = `
        <div style="background:linear-gradient(135deg,#f0f4ff,#e8f4fd); border:2px solid #667eea;
                    border-radius:12px; padding:16px; margin-top:16px; display:grid;
                    grid-template-columns:1fr 1fr; gap:12px; align-items:center;">
            <div style="grid-column:1/-1; font-weight:700; color:#667eea; font-size:14px;">
                ⚡ Total Auto Payment — Perhitungan
            </div>
            <div style="background:white; border-radius:8px; padding:12px; text-align:center; box-shadow:0 2px 6px rgba(0,0,0,.07);">
                <div style="font-size:11px; color:#666; margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px;">Include Auto Payment</div>
                <div style="font-size:20px; font-weight:800; color:#28a745;">${formatCurrency(include)}</div>
                <div style="font-size:10px; color:#999; margin-top:3px;">Manual non-auto + Nominal Admin</div>
            </div>
            <div style="background:white; border-radius:8px; padding:12px; text-align:center; box-shadow:0 2px 6px rgba(0,0,0,.07);">
                <div style="font-size:11px; color:#666; margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px;">Exclude Auto Payment</div>
                <div style="font-size:20px; font-weight:800; color:#dc3545;">${formatCurrency(exclude)}</div>
                <div style="font-size:10px; color:#999; margin-top:3px;">Hanya pos manual non-auto</div>
            </div>
        </div>`;
}

// ------------------------------------------------------------------
// INTEGRASI MODAL VERIFIKASI — Tampilkan summary AP
// ------------------------------------------------------------------
async function apRenderVerifyModalSummary(realisasi) {
    await apGetConfig();
    const kua = realisasi.kua;
    const cfg  = _apConfig && _apConfig[kua] ? _apConfig[kua] : null;
    if (!cfg) return;
    const hasSome = AP_POS.some(code => cfg[code] === true);
    if (!hasSome) return;

    const nomData = await apGetNominals(realisasi.month, realisasi.year);
    const nom     = (nomData && nomData[kua]) ? nomData[kua] : {};

    const { include, exclude } = apCalcTotals([realisasi], _apConfig, { [kua]: nom });

    const placeholder = document.getElementById('apSummaryPlaceholder');
    if (!placeholder) return;

    placeholder.innerHTML = `
        <div style="background:linear-gradient(135deg,#f0f4ff,#e8f4fd); border:2px solid #667eea;
                    border-radius:12px; padding:16px; margin-top:12px;">
            <div style="font-weight:700; color:#667eea; margin-bottom:10px; font-size:14px;">
                ⚡ Perhitungan Auto Payment
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div style="background:white; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:11px; color:#666; margin-bottom:4px;">Include AP</div>
                    <div style="font-size:18px; font-weight:800; color:#28a745;">${formatCurrency(include)}</div>
                    <div style="font-size:10px; color:#999; margin-top:2px;">Manual + Nominal Admin</div>
                </div>
                <div style="background:white; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:11px; color:#666; margin-bottom:4px;">Exclude AP</div>
                    <div style="font-size:18px; font-weight:800; color:#dc3545;">${formatCurrency(exclude)}</div>
                    <div style="font-size:10px; color:#999; margin-top:2px;">Non-auto saja</div>
                </div>
            </div>
            <div style="margin-top:10px; font-size:11px; color:#555;">
                ${AP_POS.filter(code => cfg[code]).map(code => `
                    📌 <strong>${AP_POS_NAMES[code]}:</strong> ${formatCurrency(parseFloat(nom[code]||0))}
                `).join('&emsp;')}
            </div>
        </div>`;
}

// ------------------------------------------------------------------
// INTEGRASI FORM TAMBAH/EDIT REALISASI — Tampilkan summary AP
// ------------------------------------------------------------------
async function apRenderFormModalSummary(kua, month, year) {
    const container = document.getElementById('apModalSummary');
    if (!container) return;
    await apGetConfig();
    const cfg = _apConfig && _apConfig[kua] ? _apConfig[kua] : null;
    if (!cfg || !AP_POS.some(code => cfg[code])) {
        container.style.display = 'none';
        return;
    }
    const nomData = await apGetNominals(month, year);
    const nom     = (nomData && nomData[kua]) ? nomData[kua] : {};
    
    // Build a fake realisasi from current inputs to calc totals
    const fakeReal = { kua, month, year, data: {}, total: 0 };
    document.querySelectorAll('.realisasi-input').forEach(inp => {
        const code = inp.dataset.code, item = inp.dataset.item;
        if (!code || !item) return;
        if (!fakeReal.data[code]) fakeReal.data[code] = {};
        const v = parseFloat(inp.value.replace(/\./g,'').replace(',','.')) || 0;
        fakeReal.data[code][item] = v;
        fakeReal.total += v;
    });
    
    const totals = apCalcTotals([fakeReal], _apConfig, { [kua]: nom });
    
    container.style.display = 'block';
    container.innerHTML = `
        <div style="background:linear-gradient(135deg,#f0f4ff,#e8f4fd); border:2px solid #667eea;
                    border-radius:10px; padding:14px;">
            <div style="font-weight:700; color:#667eea; margin-bottom:8px; font-size:13px;">⚡ Kalkulasi Auto Payment</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div style="background:white; border-radius:6px; padding:10px; text-align:center;">
                    <div style="font-size:10px; color:#666; margin-bottom:3px;">Include AP</div>
                    <div style="font-size:16px; font-weight:800; color:#28a745;">${formatCurrency(totals.include)}</div>
                </div>
                <div style="background:white; border-radius:6px; padding:10px; text-align:center;">
                    <div style="font-size:10px; color:#666; margin-bottom:3px;">Exclude AP</div>
                    <div style="font-size:16px; font-weight:800; color:#dc3545;">${formatCurrency(totals.exclude)}</div>
                </div>
            </div>

        </div>`;
}

// ------------------------------------------------------------------
// EXPOSE TO WINDOW
// ------------------------------------------------------------------
window.switchAPTab      = switchAPTab;
window.loadAPConfig     = loadAPConfig;
window.saveAPConfig     = saveAPConfig;
window.loadAPNominal    = loadAPNominal;
window.saveAPNominal    = saveAPNominal;
window.apUpdateRowTotal = apUpdateRowTotal;

console.log('[AUTO_PAYMENT] ✅ Auto Payment module loaded');