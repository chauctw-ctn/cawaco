// Smooth page transition để header không bị nhảy khi chuyển trang
(function() {
    'use strict';

    // Thêm smooth transition khi chuyển trang
    function smoothPageTransition(url) {
        // Collapse dashboard menu nếu đang mở
        const dashboardBtn = document.getElementById('dashboard-btn');
        const dashboardContent = document.getElementById('dashboard-content');
        if (dashboardBtn && dashboardContent) {
            dashboardBtn.classList.remove('expanded');
            dashboardBtn.classList.remove('active');
            dashboardContent.classList.remove('active');
            dashboardContent.style.display = 'none';
        }
        
        // Close user dropdown if open
        const userDropdown = document.getElementById('user-dropdown');
        const userMenuBtn = document.getElementById('user-menu-btn');
        if (userDropdown) userDropdown.classList.remove('show');
        if (userMenuBtn) userMenuBtn.classList.remove('active');
        
        // Thêm class transitioning
        document.body.classList.add('page-transitioning');
        
        // Đợi animation hoàn thành rồi chuyển trang
        setTimeout(() => {
            window.location.href = url;
        }, 200);
    }

    // Hàm kiểm tra nếu link là internal link
    function isInternalLink(link) {
        const href = link.getAttribute('href');
        if (!href) return false;
        
        // Bỏ qua nếu có target="_blank" hoặc external link
        if (link.hasAttribute('target')) return false;
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
            return false;
        }
        
        // Internal nếu là .html hoặc relative path
        return href.endsWith('.html') || href.startsWith('/') || href.startsWith('./');
    }

    // Use event delegation để bắt link clicks (kể cả sidebar load sau)
    document.addEventListener('click', function(e) {
        // Tìm thẻ <a> gần nhất (trong trường hợp click vào child element)
        const link = e.target.closest('a');
        
        if (!link) return;
        
        // Kiểm tra nếu là internal link
        if (isInternalLink(link)) {
            e.preventDefault();
            const href = link.getAttribute('href');
            smoothPageTransition(href);
        }
    }, true); // Use capture phase để bắt sớm

    // Intercept tất cả link clicks để thêm smooth transition
    document.addEventListener('DOMContentLoaded', function() {
        // Add loading class immediately
        document.body.classList.add('loading');

        // Xử lý nút "back" của browser
        window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
                document.body.classList.remove('page-transitioning');
                document.body.classList.remove('loading');
            }
        });
        
        console.log('✅ Page transition handler initialized with event delegation');
    });

    // Export để sử dụng programmatically
    window.smoothNavigate = smoothPageTransition;
})();
