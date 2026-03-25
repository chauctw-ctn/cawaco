// Header component được sử dụng chung cho tất cả các trang
function createHeader(pageTitle = '') {
    return `
    <header class="header">
        <div class="header-content">
            <button class="menu-btn" id="menu-btn">☰</button>
            <div class="logo-section">
                <img src="logo.png" alt="Logo" class="header-logo">
                <div class="company-info">
                    <h1 class="company-name">CÔNG TY CỔ PHẦN CẤP NƯỚC CÀ MAU</h1>
                    <p class="company-address">204 Quang Trung, P. Tân Thành, Cà Mau</p>
                    <p class="company-contact"><span class="contact-label">Hotline:</span> 02903 836 360</p>
                </div>
            </div>
            <nav class="main-nav">
                <a href="index.html" class="nav-link">🏠 Trang chủ</a>
                <a href="scada.html" class="nav-link">Scada Giếng Quan Trắc</a>
                <a href="stats.html" class="nav-link">📊 Thống kê</a>
            </nav>
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
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour12: false
        });
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = timeString;
        }
    }
    updateTime();
    setInterval(updateTime, 1000);

    // Sidebar toggle
    const menuBtn = document.getElementById('menu-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mapElement = document.getElementById('map');
    const scadaMain = document.getElementById('scada-main');
    const mainContent = document.querySelector('main.container');
    const statsMain = document.querySelector('main:not(.container):not(.scada-main)'); // Stats page main

    // Restore sidebar state from localStorage without transition on page load
    if (sidebar) {
        const savedState = localStorage.getItem('sidebarOpen');
        const shouldOpen = savedState === 'true';
        
        // Disable transitions temporarily
        sidebar.classList.add('no-transition');
        
        // Set initial state immediately
        sidebar.classList.toggle('active', shouldOpen);
        sidebar.classList.toggle('hidden', !shouldOpen);
        
        // Update other elements
        if (mapElement) mapElement.classList.toggle('with-sidebar', shouldOpen);
        if (scadaMain) scadaMain.classList.toggle('with-sidebar', shouldOpen);
        if (mainContent) mainContent.classList.toggle('with-sidebar', shouldOpen);
        if (statsMain) {
            statsMain.classList.toggle('with-sidebar', shouldOpen);
            statsMain.classList.toggle('sidebar-hidden', !shouldOpen);
        }
        
        // Re-enable transitions and show page
        requestAnimationFrame(() => {
            setTimeout(() => {
                sidebar.classList.remove('no-transition');
                // Remove loading class to show page
                document.body.classList.remove('loading');
            }, 20);
        });
    } else {
        // If no sidebar, just remove loading class
        document.body.classList.remove('loading');
    }

    function requestMapResize() {
        // Leaflet map instance is created in map.js; keep this resilient.
        const leafletMap = (typeof window !== 'undefined' && (window.map || window.leafletMap)) || null;
        if (leafletMap && leafletMap.invalidateSize) {
            leafletMap.invalidateSize();
        }
    }

    function applySidebarState(open) {
        if (sidebar) {
            sidebar.classList.toggle('active', open);
            // Keep legacy state consistent if any code still uses it
            sidebar.classList.toggle('hidden', !open);
        }

        // Only show overlay on mobile
        if (sidebarOverlay) {
            const showOverlay = open && window.innerWidth <= 768;
            sidebarOverlay.classList.toggle('active', showOverlay);
            sidebarOverlay.classList.toggle('show', showOverlay);
        }

        // Toggle with-sidebar class for layout adjustment
        if (mapElement) mapElement.classList.toggle('with-sidebar', open);
        if (scadaMain) scadaMain.classList.toggle('with-sidebar', open);
        if (mainContent) mainContent.classList.toggle('with-sidebar', open);
        
        // Handle stats page main element
        if (statsMain) {
            statsMain.classList.toggle('with-sidebar', open);
            statsMain.classList.toggle('sidebar-hidden', !open);
        }

        localStorage.setItem('sidebarOpen', String(open));

        // Notify pages/components (e.g., Leaflet map) to reflow
        window.dispatchEvent(new CustomEvent('sidebar:toggled', { detail: { open } }));

        // Resize SCADA viewport if on SCADA page
        if (typeof fitScadaViewport === 'function') {
            setTimeout(fitScadaViewport, 50);
        }

        // Resize after CSS transition ends
        setTimeout(requestMapResize, 350);
    }

    function toggleSidebar() {
        const currentlyOpen = !!(sidebar && sidebar.classList.contains('active'));
        applySidebarState(!currentlyOpen);
    }

    if (menuBtn) {
        menuBtn.addEventListener('click', toggleSidebar);
    }
    
    // Close sidebar when clicking overlay
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => applySidebarState(false));
    }

    // User menu toggle and logout handled by auth.js
    // No need to add listeners here
    
    // Display user info - let auth.js handle this completely
    // Auth.js will call updateUserUI() after authentication completes
    // No need to do anything here as auth.js DOMContentLoaded runs and calls updateUserUI
}

// Export cho các trang khác sử dụng
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createHeader, initializeHeader };
}
