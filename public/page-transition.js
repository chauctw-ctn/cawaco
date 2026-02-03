// Smooth page transition để header không bị nhảy khi chuyển trang
(function() {
    'use strict';

    // Thêm smooth transition khi chuyển trang
    function smoothPageTransition(url) {
        // Thêm class transitioning
        document.body.classList.add('page-transitioning');
        
        // Đợi animation hoàn thành rồi chuyển trang
        setTimeout(() => {
            window.location.href = url;
        }, 200);
    }

    // Intercept tất cả link clicks để thêm smooth transition
    document.addEventListener('DOMContentLoaded', function() {
        // Fade in khi trang load
        document.body.style.opacity = '0';
        setTimeout(() => {
            document.body.style.opacity = '1';
        }, 10);

        // Tìm tất cả các link nội bộ
        const links = document.querySelectorAll('a[href^="/"]:not([target="_blank"]), a[href$=".html"]:not([target="_blank"])');
        
        links.forEach(link => {
            link.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                
                // Chỉ áp dụng cho link nội bộ
                if (href && !href.startsWith('http') && !this.hasAttribute('target')) {
                    e.preventDefault();
                    smoothPageTransition(href);
                }
            });
        });

        // Xử lý nút "back" của browser
        window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
                document.body.classList.remove('page-transitioning');
                document.body.style.opacity = '1';
            }
        });
    });

    // Export để sử dụng programmatically
    window.smoothNavigate = smoothPageTransition;
})();
