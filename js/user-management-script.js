// ===== USER MANAGEMENT SCRIPT =====
// File: user-management-script.js
// Untuk: user-management.html

// ===== GLOBAL STATE =====
let currentUser = null;
let allUsers = [];

// ===== LOAD USERS =====
async function loadUsers() {
    try {
        console.log('[USER] Loading users');
        const users = await apiCall('getUsers');
        allUsers = users || [];
        
        console.log('[USER] Users loaded:', allUsers.length);
        displayUsers();
    } catch (error) {
        console.error('[USER ERROR]', error);
        showNotification(error.message || 'Gagal memuat users', 'error');
    }
}

// ===== DISPLAY USERS =====
function displayUsers() {
    const tbody = document.querySelector('#userTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (allUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Tidak ada data pengguna</td></tr>';
        return;
    }
    
    allUsers.forEach((user, index) => {
        const tr = document.createElement('tr');
        
        // Status badge - FIXED
        const statusBadge = user.status === 'active' || !user.status 
            ? '<span class="badge badge-success">Aktif</span>' 
            : '<span class="badge badge-danger">Nonaktif</span>';
        
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${user.username || '-'}</td>
            <td>${user.name || '-'}</td>
            <td>${user.role || '-'}</td>
            <td>${user.kua || '-'}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="editUser('${user.id}')">Edit</button>
                ${user.username !== 'admin' ? 
                    `<button class="btn btn-sm btn-danger" onclick="confirmDeleteUser('${user.id}', '${user.username}')">Hapus</button>` 
                    : ''}
            </td>
        `;
        
        tbody.appendChild(tr);

        // Reset password hanya tersedia untuk akun Operator KUA.
        if (user.role === 'Operator KUA') {
            const actionCell = tr.querySelector('td:last-child');
            const resetButton = document.createElement('button');
            resetButton.type = 'button';
            resetButton.className = 'btn btn-sm btn-secondary';
            resetButton.textContent = 'Reset Password';
            resetButton.style.marginTop = '4px';
            resetButton.addEventListener('click', () => {
                confirmResetUserPassword(user.id, user.username);
            });
            actionCell.appendChild(resetButton);
        }
    });
}

// Samakan format nama KUA, baik "KUA Anjatan" maupun "Anjatan".
function normalizeKUA(value) {
    return String(value || '')
        .trim()
        .replace(/^KUA\s+/i, '')
        .trim();
}

// Format baku penyimpanan di Google Sheet harus selalu "KUA Nama Kecamatan".
function formatKUA(value) {
    const normalized = normalizeKUA(value);
    return normalized ? `KUA ${normalized}` : '';
}

// Dropdown memakai label singkat, tetapi value tetap menggunakan format baku.
function populateKUAOptions(selectedValue = '') {
    const select = document.getElementById('formKUA');
    if (!select) return;

    const selected = formatKUA(selectedValue);
    const kuaList = [...new Set(
        APP_CONFIG.KUA_LIST
            .map(formatKUA)
            .filter(Boolean)
    )];

    select.innerHTML = '';
    select.add(new Option('Pilih KUA', ''));

    kuaList.forEach(kua => {
        select.add(new Option(normalizeKUA(kua), kua));
    });

    // Jaga data historis agar tetap dapat diedit meskipun tidak ada di konfigurasi.
    if (selected && !kuaList.includes(selected)) {
        select.add(new Option(`${normalizeKUA(selected)} (data lama)`, selected));
    }

    select.value = selected;
}

// ===== MODAL FUNCTIONS =====
function showUserModal(userId = null) {
    if (!document.getElementById('userModal')) {
        createUserModal();
    }

    const form = document.getElementById('userForm');
    const modalTitle = document.getElementById('modalTitle');
    const passwordGroup = document.getElementById('passwordGroup');
    const passwordInput = document.getElementById('formPassword');

    if (userId !== null && userId !== undefined && userId !== '') {
        const user = allUsers.find(u => String(u.id) === String(userId));
        if (!user) return;

        modalTitle.textContent = 'Edit Pengguna';
        document.getElementById('userId').value = user.id;
        document.getElementById('formUsername').value = user.username || '';
        document.getElementById('formName').value = user.name || '';
        document.getElementById('formRole').value = user.role || '';

        // Daftar KUA disiapkan sebelum nilai pengguna lama dipilih.
        populateKUAOptions(user.kua || '');

        // Password tidak diedit dari form. Gunakan aksi Reset Password.
        passwordGroup.style.display = 'none';
        passwordInput.value = '';
        passwordInput.required = false;
    } else {
        modalTitle.textContent = 'Tambah Pengguna';
        form.reset();
        document.getElementById('userId').value = '';

        passwordGroup.style.display = '';
        passwordGroup.querySelector('label').textContent = 'Password *';
        passwordInput.value = '';
        passwordInput.required = true;

        populateKUAOptions();
    }

    // Pastikan tampilan dan validasi KUA mengikuti role yang sedang dipilih.
    toggleKUAField();
    document.getElementById('userModal').classList.add('active');
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('active');
    document.getElementById('userForm').reset();
}

function createUserModal() {
    const modalHTML = `
        <div class="modal" id="userModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="modalTitle">Tambah Pengguna</h3>
                    <button class="close-btn" onclick="closeUserModal()">&times;</button>
                </div>
                <form id="userForm" onsubmit="handleUserSubmit(event)">
                    <input type="hidden" id="userId">
                    
                    <div class="form-group">
                        <label>Username *</label>
                        <input type="text" id="formUsername" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Nama Lengkap *</label>
                        <input type="text" id="formName" required>
                    </div>
                    
                    <div class="form-group" id="passwordGroup">
                        <label>Password *</label>
                        <div class="password-input-group">
                            <input type="password" id="formPassword" required minlength="6">
                            <button type="button" class="password-toggle" onclick="togglePassword('formPassword')">👁️</button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Role *</label>
                        <select id="formRole" required onchange="toggleKUAField()">
                            <option value="">Pilih Role</option>
                            <option value="Admin">Admin</option>
                            <option value="Operator KUA">Operator KUA</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="kuaGroup" style="display: none;">
                        <label>KUA *</label>
                        <select id="formKUA">
                            <option value="">Pilih KUA</option>
                        </select>
                    </div>
                    
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="submit" class="btn" style="flex: 1;">Simpan</button>
                        <button type="button" class="btn btn-secondary" onclick="closeUserModal()" style="flex: 1;">Batal</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function toggleKUAField() {
    const role = document.getElementById('formRole').value;
    const kuaGroup = document.getElementById('kuaGroup');
    const kuaSelect = document.getElementById('formKUA');
    
    if (role === 'Operator KUA') {
        kuaGroup.style.display = 'block';
        kuaSelect.required = true;
    } else {
        kuaGroup.style.display = 'none';
        kuaSelect.required = false;
        kuaSelect.value = '';
    }
}

// ===== SUBMIT HANDLER =====
async function handleUserSubmit(event) {
    event.preventDefault();
    
    const userId = document.getElementById('userId').value;
    const username = document.getElementById('formUsername').value;
    const name = document.getElementById('formName').value;
    const password = document.getElementById('formPassword').value;
    const role = document.getElementById('formRole').value;
    const kua = formatKUA(document.getElementById('formKUA').value);
    
    // Validation
    if (role === 'Operator KUA' && !kua) {
        showNotification('KUA harus dipilih untuk Operator KUA', 'error');
        return;
    }
    
    try {
        const userData = {
            id: userId || null,
            username,
            name,
            role,
            kua: role === 'Operator KUA' ? kua : ''
        };
        
        // Password hanya diisi saat membuat pengguna baru.
        // Untuk pengguna yang sudah ada, gunakan tombol Reset Password.
        if (!userId && password) {
            userData.password = password;
        }
        
        await apiCall('saveUser', userData);
        
        showNotification(userId ? 'User berhasil diupdate' : 'User berhasil ditambahkan', 'success');
        closeUserModal();
        loadUsers();
    } catch (error) {
        showNotification(error.message || 'Gagal menyimpan user', 'error');
    }
}

// ===== DELETE USER =====
function confirmDeleteUser(userId, username) {
    if (confirm(`Apakah Anda yakin ingin menghapus user "${username}"?`)) {
        deleteUser(userId);
    }
}

async function deleteUser(userId) {
    try {
        await apiCall('deleteUser', { id: userId });
        showNotification('User berhasil dihapus', 'success');
        loadUsers();
    } catch (error) {
        showNotification(error.message || 'Gagal menghapus user', 'error');
    }
}

// ===== RESET PASSWORD OPERATOR KUA =====
function confirmResetUserPassword(userId, username) {
    const confirmed = confirm(
        `Reset password Operator KUA "${username}" menjadi "Kua123!"?`
    );

    if (confirmed) {
        resetUserPassword(userId);
    }
}

async function resetUserPassword(userId) {
    const user = allUsers.find(u => String(u.id) === String(userId));

    if (!user || user.role !== 'Operator KUA') {
        showNotification('Reset password hanya tersedia untuk Operator KUA.', 'error');
        return;
    }

    try {
        // Endpoint khusus ini hanya mengubah kolom Password (C) pada Sheet Users.
        // Tidak mengirim atau menulis ulang data profil pengguna.
        await apiCall('resetOperatorPassword', {
            id: user.id
        });

        showNotification(
            `Password ${user.username} berhasil direset menjadi Kua123!`,
            'success'
        );
    } catch (error) {
        showNotification(error.message || 'Gagal mereset password pengguna.', 'error');
    }
}

// ===== EDIT USER =====
function editUser(userId) {
    showUserModal(userId);
}

// ===== NAVIGATION =====
function backToMenu() {
    window.location.href = 'main-menu.html';
}

// ✅ FIXED: Use simple confirm() instead of custom dialog
function logout() {
    if (confirm('Apakah Anda yakin ingin keluar?')) {
        SessionManager.clearUser();
        AppCache.clear(); // Clear cache on logout
        window.location.href = 'index.html';
    }
}

// ===== INITIALIZATION =====
window.addEventListener('DOMContentLoaded', function() {
    console.log('[USER-MGMT] DOM Content Loaded');
    
    // ✅ CRITICAL FIX: Use SessionManager from config.js (window scope)
    currentUser = SessionManager.getCurrentUser();
    
    console.log('[USER-MGMT] Current user:', currentUser);
    
    if (!currentUser) {
        console.log('[USER-MGMT] No user session, redirecting to login');
        showNotification('Sesi Anda telah berakhir. Silakan login kembali.', 'warning');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }
    
    // Only Admin can access
    if (currentUser.role !== 'Admin') {
        console.log('[USER-MGMT] Access denied for role:', currentUser.role);
        showNotification('Akses ditolak. Hanya Admin yang dapat mengakses halaman ini.', 'error');
        setTimeout(() => {
            window.location.href = 'main-menu.html';
        }, 2000);
        return;
    }
    
    console.log('[USER-MGMT] Admin access granted');
    
    // Display user info
    const userNameEl = document.getElementById('userNameDisplay');
    const userRoleEl = document.getElementById('userRoleDisplay');
    
    if (userNameEl) userNameEl.textContent = currentUser.name;
    if (userRoleEl) userRoleEl.textContent = currentUser.role;
    
    // Load users
    loadUsers();
});

// Expose functions to global scope
window.showUserModal = showUserModal;
window.closeUserModal = closeUserModal;
window.toggleKUAField = toggleKUAField;
window.handleUserSubmit = handleUserSubmit;
window.editUser = editUser;
window.confirmDeleteUser = confirmDeleteUser;
window.confirmResetUserPassword = confirmResetUserPassword;
window.backToMenu = backToMenu;
window.logout = logout;