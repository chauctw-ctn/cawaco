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
    
    const dropdownUsername = document.getElementById('dropdown-username');
    const dropdownRole = document.getElementById('dropdown-role');
    const addUserBtn = document.getElementById('add-user-btn');
    
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
    const manageUsersBtn = document.getElementById('manage-users-btn');
    if (manageUsersBtn) {
        manageUsersBtn.style.display = userRole === 'admin' ? 'flex' : 'none';
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
    
    // Setup form submissions
    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleChangePassword);
    }
    
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', handleAddUser);
    }
    
    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            hideModal('change-password-modal');
            hideModal('add-user-modal');
            hideModal('manage-users-modal');
            hideModal('delete-user-modal');
            userToDelete = null;
        }
    });
});
