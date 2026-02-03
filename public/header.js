// Header component được sử dụng chung cho tất cả các trang
function createHeader(pageTitle = '') {
    return `
    <header class="header">
        <div class="header-content">
            <button class="menu-btn" id="menu-btn">☰</button>
            <div class="logo-section">
                <div class="company-info">
                    <h1 class="company-name">CÔNG TY CỔ PHẦN CẤP NƯỚC CÀ MAU</h1>
                    <p class="company-address">204 Quang Trung, P. Tân Thành, Cà Mau</p>
                    <p class="company-contact"><span class="contact-label">Hotline:</span> 02903 836 360</p>
                </div>
            </div>
            <div class="current-time-section">
                <span id="current-time"></span>
            </div>
            <div class="auth-section">
                <span id="username-display"></span>
                <div class="user-menu-container">
                    <button id="user-menu-btn" class="user-menu-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        <svg class="arrow-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </button>
                    <div class="user-dropdown" id="user-dropdown">
                        <div class="user-info">
                            <strong id="dropdown-username"></strong>
                            <span id="dropdown-role"></span>
                        </div>
                        <div class="dropdown-divider"></div>
                        <button class="dropdown-item" id="change-password-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            Đổi mật khẩu
                        </button>
                        <button class="dropdown-item logout-btn" id="logout-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                                <polyline points="16 17 21 12 16 7"/>
                                <line x1="21" y1="12" x2="9" y2="12"/>
                            </svg>
                            Đăng xuất
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </header>
    `;
}

// Khởi tạo header và các event listeners
function initializeHeader() {
    // Update time
    function updateTime() {
        const now = new Date();
        const timeString = now.toLocaleString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = timeString;
        }
    }
    updateTime();
    setInterval(updateTime, 1000);

    // User menu toggle
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    
    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu-container')) {
                userDropdown.classList.remove('show');
            }
        });
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            localStorage.removeItem('role');
            window.location.href = '/login.html';
        });
    }

    // Display user info
    const username = localStorage.getItem('username');
    const role = localStorage.getItem('role');
    const usernameDisplay = document.getElementById('username-display');
    const dropdownUsername = document.getElementById('dropdown-username');
    const dropdownRole = document.getElementById('dropdown-role');

    if (usernameDisplay) usernameDisplay.textContent = username || '';
    if (dropdownUsername) dropdownUsername.textContent = username || '';
    if (dropdownRole) {
        const roleText = role === 'admin' ? 'Quản trị viên' : 'Người dùng';
        dropdownRole.textContent = roleText;
    }
}

// Export cho các trang khác sử dụng
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createHeader, initializeHeader };
}
