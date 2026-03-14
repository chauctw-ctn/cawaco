// Authentication utilities
const AUTH_API = {
    login: '/api/login',
    logout: '/api/logout',
    verify: '/api/verify',
    changePassword: '/api/change-password',
    addUser: '/api/add-user',
    getUsers: '/api/users',
    deleteUser: '/api/delete-user'
};

let currentUser = null;
let userToDelete = null;

// Check if user is authenticated and redirect to login if not
async function requireAuth() {
    const token = localStorage.getItem('authToken');
    
    // Skip auth check if on login page
    if (window.location.pathname.includes('login.html')) {
        return;
    }
    
    if (!token) {
        // Not logged in, redirect to login page
        window.location.href = '/login.html';
        return;
    }
    
    // Verify token with server
    try {
        const response = await fetch(AUTH_API.verify, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const result = await response.json();
        
        if (!result.success) {
            // Token invalid, clear and redirect to login
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
            localStorage.removeItem('userRole');
            window.location.href = '/login.html';
        } else {
            // Store user info
            currentUser = result.user;
            localStorage.setItem('username', result.user.username);
            localStorage.setItem('userRole', result.user.role);
        }
    } catch (error) {
        console.error('Auth verification error:', error);
        // On error, redirect to login
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('userRole');
        window.location.href = '/login.html';
    }
}

// Update UI with user info
function updateUserUI() {
    const username = localStorage.getItem('username');
    const userRole = localStorage.getItem('userRole');
    
    const usernameDisplay = document.getElementById('username-display');
    const dropdownUsername = document.getElementById('dropdown-username');
    const dropdownRole = document.getElementById('dropdown-role');
    const addUserBtn = document.getElementById('add-user-btn');
    const manageUsersBtn = document.getElementById('manage-users-btn');
    const telegramConfigBtn = document.getElementById('telegram-config-btn');
    
    // Update username displays
    if (usernameDisplay) {
        usernameDisplay.textContent = username || '';
    }
    
    if (dropdownUsername) {
        dropdownUsername.textContent = username || 'Người dùng';
    }
    
    if (dropdownRole) {
        const roleText = userRole === 'admin' ? 'Quản trị viên' : 'Người dùng';
        dropdownRole.textContent = roleText;
    }
    
    // Show/hide add user button based on role
    if (addUserBtn) {
        addUserBtn.style.display = userRole === 'admin' ? 'flex' : 'none';
    }
    
    // Show/hide manage users button based on role
    if (manageUsersBtn) {
        manageUsersBtn.style.display = userRole === 'admin' ? 'flex' : 'none';
    }
    
    // Show/hide telegram config button based on role
    if (telegramConfigBtn) {
        telegramConfigBtn.style.display = userRole === 'admin' ? 'flex' : 'none';
    }
}

// Toggle dropdown menu
function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    const menuBtn = document.getElementById('user-menu-btn');
    
    if (dropdown && menuBtn) {
        dropdown.classList.toggle('show');
        menuBtn.classList.toggle('active');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menuContainer = document.querySelector('.user-menu-container');
    const dropdown = document.getElementById('user-dropdown');
    const menuBtn = document.getElementById('user-menu-btn');
    
    if (menuContainer && !menuContainer.contains(e.target)) {
        if (dropdown) dropdown.classList.remove('show');
        if (menuBtn) menuBtn.classList.remove('active');
    }
});

// Show modal
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide modal
function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        // Clear form and error messages
        const form = modal.querySelector('form');
        const error = modal.querySelector('.modal-error');
        if (form) form.reset();
        if (error) error.classList.remove('show');
    }
}

// Show error in modal
function showModalError(modalId, message) {
    const modal = document.getElementById(modalId);
    if (modal) {
        const error = modal.querySelector('.modal-error');
        if (error) {
            error.textContent = message;
            error.classList.add('show');
        }
    }
}

// Handle change password
async function handleChangePassword(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (newPassword !== confirmPassword) {
        showModalError('change-password-modal', 'Mật khẩu mới không khớp');
        return;
    }
    
    if (newPassword.length < 6) {
        showModalError('change-password-modal', 'Mật khẩu phải có ít nhất 6 ký tự');
        return;
    }
    
    const token = localStorage.getItem('authToken');
    
    try {
        const response = await fetch(AUTH_API.changePassword, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Đổi mật khẩu thành công!');
            hideModal('change-password-modal');
        } else {
            showModalError('change-password-modal', result.message || 'Đổi mật khẩu thất bại');
        }
    } catch (error) {
        console.error('Change password error:', error);
        showModalError('change-password-modal', 'Có lỗi xảy ra. Vui lòng thử lại');
    }
}

// Handle add user
async function handleAddUser(e) {
    e.preventDefault();
    
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    
    if (username.length < 3) {
        showModalError('add-user-modal', 'Tên đăng nhập phải có ít nhất 3 ký tự');
        return;
    }
    
    if (password.length < 6) {
        showModalError('add-user-modal', 'Mật khẩu phải có ít nhất 6 ký tự');
        return;
    }
    
    const token = localStorage.getItem('authToken');
    
    try {
        const response = await fetch(AUTH_API.addUser, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                username,
                password,
                role
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Thêm người dùng thành công!');
            hideModal('add-user-modal');
            // Refresh user list if manage users modal is open
            const manageUsersModal = document.getElementById('manage-users-modal');
            if (manageUsersModal && manageUsersModal.classList.contains('show')) {
                loadUserList();
            }
        } else {
            showModalError('add-user-modal', result.message || 'Thêm người dùng thất bại');
        }
    } catch (error) {
        console.error('Add user error:', error);
        showModalError('add-user-modal', 'Có lỗi xảy ra. Vui lòng thử lại');
    }
}

// Load user list
async function loadUserList() {
    const container = document.getElementById('users-list-container');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">Đang tải...</div>';
    
    const token = localStorage.getItem('authToken');
    
    try {
        const response = await fetch(AUTH_API.getUsers, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const result = await response.json();
        
        if (result.success && result.users) {
            if (result.users.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">Chưa có người dùng</div>';
                return;
            }
            
            const currentUsername = localStorage.getItem('username');
            
            let html = '<div class="user-list">';
            result.users.forEach(user => {
                const isCurrentUser = user.name === currentUsername;
                const roleText = user.role === 'admin' ? 'Quản trị viên' : 'Người dùng';
                
                html += `
                    <div class="user-item">
                        <div class="user-item-info">
                            <div class="user-item-name">
                                ${user.name}
                                ${isCurrentUser ? '<span style="color: #0066cc; font-size: 12px;">(Bạn)</span>' : ''}
                            </div>
                            <div class="user-item-role">${roleText} • ${user.username}</div>
                        </div>
                        <div class="user-item-actions">
                            ${!isCurrentUser ? `
                                <button class="btn-icon danger" onclick="showDeleteUserConfirmation('${user.username}', '${user.name}')" title="Xóa">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        <line x1="10" y1="11" x2="10" y2="17"></line>
                                        <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #dc2626;">Không thể tải danh sách người dùng</div>';
        }
    } catch (error) {
        console.error('Load users error:', error);
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #dc2626;">Có lỗi xảy ra khi tải danh sách</div>';
    }
}

// Show delete user confirmation
function showDeleteUserConfirmation(username, displayName) {
    userToDelete = username;
    const message = document.getElementById('delete-user-message');
    if (message) {
        message.textContent = `Bạn có chắc chắn muốn xóa người dùng "${displayName}"?`;
    }
    showModal('delete-user-modal');
}

// Handle delete user
async function handleDeleteUser() {
    if (!userToDelete) return;
    
    const token = localStorage.getItem('authToken');
    
    try {
        const response = await fetch(AUTH_API.deleteUser, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                username: userToDelete
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Đã xóa người dùng thành công!');
            hideModal('delete-user-modal');
            userToDelete = null;
            // Reload user list
            loadUserList();
        } else {
            showModalError('delete-user-modal', result.message || 'Xóa người dùng thất bại');
        }
    } catch (error) {
        console.error('Delete user error:', error);
        showModalError('delete-user-modal', 'Có lỗi xảy ra. Vui lòng thử lại');
    }
}

// Logout function
async function logout() {
    const token = localStorage.getItem('authToken');
    
    try {
        await fetch(AUTH_API.logout, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    // Clear local storage
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    localStorage.removeItem('userRole');
    
    // Redirect to login page
    window.location.href = '/login.html';
}

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for header to be loaded first (buttons are in the header)
    await new Promise(resolve => {
        if (document.querySelector('header')) {
            resolve();
        } else {
            document.addEventListener('headerLoaded', resolve, { once: true });
        }
    });
    
    // Require authentication first
    await requireAuth();
    
    // Update UI with user info
    updateUserUI();
    
    // Setup dropdown menu
    const userMenuBtn = document.getElementById('user-menu-btn');
    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', toggleUserMenu);
    }
    
    // Setup logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // Setup change password button
    const changePasswordBtn = document.getElementById('change-password-btn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            toggleUserMenu(); // Close dropdown
            showModal('change-password-modal');
        });
    }
    
    // Setup add user button
    const addUserBtn = document.getElementById('add-user-btn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            toggleUserMenu(); // Close dropdown
            showModal('add-user-modal');
        });
    }
    
    // Setup manage users button
    const manageUsersBtn = document.getElementById('manage-users-btn');
    if (manageUsersBtn) {
        manageUsersBtn.addEventListener('click', () => {
            toggleUserMenu(); // Close dropdown
            showModal('manage-users-modal');
            loadUserList();
        });
    }
    
    // Setup modal close buttons
    const closeChangePassword = document.getElementById('close-change-password');
    if (closeChangePassword) {
        closeChangePassword.addEventListener('click', () => hideModal('change-password-modal'));
    }
    
    const cancelChangePassword = document.getElementById('cancel-change-password');
    if (cancelChangePassword) {
        cancelChangePassword.addEventListener('click', () => hideModal('change-password-modal'));
    }
    
    const closeAddUser = document.getElementById('close-add-user');
    if (closeAddUser) {
        closeAddUser.addEventListener('click', () => hideModal('add-user-modal'));
    }
    
    const cancelAddUser = document.getElementById('cancel-add-user');
    if (cancelAddUser) {
        cancelAddUser.addEventListener('click', () => hideModal('add-user-modal'));
    }
    
    const closeManageUsers = document.getElementById('close-manage-users');
    if (closeManageUsers) {
        closeManageUsers.addEventListener('click', () => hideModal('manage-users-modal'));
    }
    
    const closeDeleteUser = document.getElementById('close-delete-user');
    if (closeDeleteUser) {
        closeDeleteUser.addEventListener('click', () => {
            hideModal('delete-user-modal');
            userToDelete = null;
        });
    }
    
    const cancelDeleteUser = document.getElementById('cancel-delete-user');
    if (cancelDeleteUser) {
        cancelDeleteUser.addEventListener('click', () => {
            hideModal('delete-user-modal');
            userToDelete = null;
        });
    }
    
    const confirmDeleteUser = document.getElementById('confirm-delete-user');
    if (confirmDeleteUser) {
        confirmDeleteUser.addEventListener('click', handleDeleteUser);
    }
    
    // Setup telegram config button
    const telegramConfigBtn = document.getElementById('telegram-config-btn');
    if (telegramConfigBtn) {
        telegramConfigBtn.addEventListener('click', async () => {
            toggleUserMenu(); // Close dropdown
            await loadTelegramConfigToModal();
            showModal('telegram-config-modal');
        });
    }
    
    // Setup telegram config modal buttons
    const closeTelegramConfig = document.getElementById('close-telegram-config');
    if (closeTelegramConfig) {
        closeTelegramConfig.addEventListener('click', () => {
            hideModal('telegram-config-modal');
            resetTelegramModal();
        });
    }
    
    const cancelTelegramConfig = document.getElementById('cancel-telegram-config');
    if (cancelTelegramConfig) {
        cancelTelegramConfig.addEventListener('click', () => {
            hideModal('telegram-config-modal');
            resetTelegramModal();
        });
    }
    
    const testTelegramBtn = document.getElementById('test-telegram-btn');
    if (testTelegramBtn) {
        testTelegramBtn.addEventListener('click', handleTestTelegram);
    }
    
    const telegramConfigForm = document.getElementById('telegram-config-form');
    if (telegramConfigForm) {
        telegramConfigForm.addEventListener('submit', handleSaveTelegramConfig);
    }
    
    // Setup form submissions
    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleChangePassword);
    }

    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', handleAddUser);
    }
});

// Load Telegram config to modal
async function loadTelegramConfigToModal() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch('/api/telegram/config', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                const enabledCheckbox = document.getElementById('telegram-enabled');
                const botTokenInput = document.getElementById('telegram-bot-token');
                const chatIdInput = document.getElementById('telegram-chat-id');
                const refreshIntervalInput = document.getElementById('telegram-refresh-interval');
                const delayThresholdInput = document.getElementById('telegram-delay-threshold');
                
                if (enabledCheckbox) enabledCheckbox.checked = data.config.enabled;
                
                // Handle Bot Token field display
                const tokenIsSet = data.config.botToken === '***set***';
                if (botTokenInput) {
                    botTokenInput.value = ''; // Clear input
                    botTokenInput.placeholder = tokenIsSet ? 'Để trống nếu không muốn đổi token' : 'Nhập Bot Token từ @BotFather';
                    
                    // Update label to show token status
                    const tokenLabel = botTokenInput.parentElement.querySelector('label');
                    const tokenSmall = botTokenInput.parentElement.querySelector('small');
                    if (tokenLabel && tokenIsSet) {
                        tokenLabel.innerHTML = 'Bot Token: <span style="color: #059669; font-weight: 600; font-size: 13px;">✓ Đã cấu hình</span>';
                    } else if (tokenLabel) {
                        tokenLabel.textContent = 'Bot Token:';
                    }
                    if (tokenSmall && tokenIsSet) {
                        tokenSmall.innerHTML = '<span style="color: #059669;">✓ Bot Token đã được lưu trên server (dùng chung cho tất cả các trang)</span><br><span style="color: #6b7280;">Chỉ nhập vào đây nếu muốn đổi sang token khác</span>';
                    } else if (tokenSmall) {
                        tokenSmall.innerHTML = '<span style="color: #dc2626;">⚠ Chưa có Bot Token. Lấy từ @BotFather trên Telegram</span>';
                    }
                }
                
                if (chatIdInput) chatIdInput.value = data.config.chatId || '';
                if (refreshIntervalInput) refreshIntervalInput.value = data.config.refreshInterval || 15;
                if (delayThresholdInput) delayThresholdInput.value = data.config.delayThreshold || 60;

                // Populate alert-minutes checkboxes
                const alertMinutes = Array.isArray(data.config.alertMinutes)
                    ? data.config.alertMinutes
                    : [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
                document.querySelectorAll('.alert-minute-cb').forEach(cb => {
                    cb.checked = alertMinutes.includes(parseInt(cb.value));
                });

                // Wire up Select All / Clear All buttons
                const selectAllBtn = document.getElementById('alert-minutes-select-all');
                const clearAllBtn  = document.getElementById('alert-minutes-clear-all');
                if (selectAllBtn) {
                    selectAllBtn.onclick = () => document.querySelectorAll('.alert-minute-cb').forEach(cb => { cb.checked = true; });
                }
                if (clearAllBtn) {
                    clearAllBtn.onclick = () => document.querySelectorAll('.alert-minute-cb').forEach(cb => { cb.checked = false; });
                }

                // Update the getUpdates link dynamically
                const getChatIdLink = document.getElementById('get-chat-id-link');
                if (getChatIdLink) {
                    if (tokenIsSet) {
                        // Token is set server-side; use a proxy endpoint to avoid exposing the token
                        getChatIdLink.href = '/api/telegram/getupdates';
                        getChatIdLink.textContent = 'Xem Chat ID';
                        getChatIdLink.style.pointerEvents = 'auto';
                        getChatIdLink.style.opacity = '1';
                    } else {
                        // No token set yet
                        getChatIdLink.href = '#';
                        getChatIdLink.textContent = 'Cần cấu hình Bot Token trước';
                        getChatIdLink.style.pointerEvents = 'none';
                        getChatIdLink.style.opacity = '0.5';
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error loading Telegram config:', error);
    }
}

// Handle save Telegram config
async function handleSaveTelegramConfig(e) {
    e.preventDefault();
    
    const enabledCheckbox = document.getElementById('telegram-enabled');
        const botTokenInput = document.getElementById('telegram-bot-token');
        const chatIdInput = document.getElementById('telegram-chat-id');
        const refreshIntervalInput = document.getElementById('telegram-refresh-interval');
        const delayThresholdInput = document.getElementById('telegram-delay-threshold');
        
        try {
            const token = localStorage.getItem('authToken');
            if (!token) {
                throw new Error('Chưa đăng nhập');
            }
            
            const enabled = enabledCheckbox.checked;
            const botToken = botTokenInput ? botTokenInput.value.trim() : '';
            const chatId = chatIdInput ? chatIdInput.value.trim() : '';
        const refreshInterval = parseInt(refreshIntervalInput.value);
        const delayThreshold = parseInt(delayThresholdInput.value);

        // Collect selected alert minutes from checkboxes
        const alertMinutes = Array.from(document.querySelectorAll('.alert-minute-cb:checked'))
            .map(cb => parseInt(cb.value))
            .filter(v => !isNaN(v));
        
        // Validate
        if (enabled && !chatId) {
            throw new Error('Vui lòng nhập Chat ID để bật cảnh báo');
        }
        
        if (isNaN(refreshInterval) || refreshInterval < 15) {
            throw new Error('Chu kỳ quét tối thiểu là 15 phút');
        }
        
        if (isNaN(delayThreshold) || delayThreshold < 1) {
            throw new Error('Độ trễ offline tối thiểu là 1 phút');
        }
        
        const response = await fetch('/api/telegram/config', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                enabled: enabled,
                botToken: botToken || undefined,
                chatId: chatId,
                refreshInterval: refreshInterval,
                delayThreshold: delayThreshold,
                alertMinutes: alertMinutes
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Không thể lưu cấu hình');
        }
        
        // Close modal
        hideModal('telegram-config-modal');
        
        // Reload page to apply new settings if on databtn page
        if (window.location.pathname.includes('databtn.html')) {
            window.location.reload();
        }
        
    } catch (error) {
        console.error('Error saving Telegram config:', error);
        showModalError('telegram-config-modal', error.message || 'Không thể lưu cấu hình');
    }
}

// Handle test Telegram connection
async function handleTestTelegram() {
    const chatIdInput = document.getElementById('telegram-chat-id');
    const testResult = document.getElementById('test-telegram-result');
    const testBtn = document.getElementById('test-telegram-btn');
    
    try {
        if (testResult) {
            testResult.textContent = '';
            testResult.style.color = '#6b7280';
        }
        
        const chatId = chatIdInput.value.trim();
        
        if (!chatId) {
            throw new Error('Vui lòng nhập Chat ID trước khi test');
        }
        
        // Disable button while testing
        if (testBtn) {
            testBtn.disabled = true;
            testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Đang gửi...';
        }
        
        if (testResult) testResult.textContent = '⏳ Đang gửi tin nhắn test...';
        
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('Chưa đăng nhập');
        }
        
        const response = await fetch('/api/telegram/test', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatId: chatId
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Không thể gửi tin nhắn test');
        }
        
        // Success
        if (testResult) {
            testResult.textContent = '✅ ' + data.message;
            testResult.style.color = '#059669';
        }
        
    } catch (error) {
        console.error('Error testing Telegram:', error);
        if (testResult) {
            testResult.textContent = '❌ ' + (error.message || 'Không thể gửi tin nhắn test');
            testResult.style.color = '#dc2626';
        }
    } finally {
        // Re-enable button
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Gửi tin nhắn test';
        }
    }
}

// Reset Telegram modal to clean state
function resetTelegramModal() {
    const botTokenInput = document.getElementById('telegram-bot-token');
    const testResult = document.getElementById('test-telegram-result');
    
    // Clear bot token input
    if (botTokenInput) {
        botTokenInput.value = '';
    }
    
    // Clear test result
    if (testResult) {
        testResult.textContent = '';
    }
    
    // Reset label to default (will be updated when modal opens again)
    const tokenLabel = botTokenInput?.parentElement.querySelector('label');
    if (tokenLabel) {
        tokenLabel.textContent = 'Bot Token:';
    }
}
