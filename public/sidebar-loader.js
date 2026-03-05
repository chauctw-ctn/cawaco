// Sidebar Loader - Load sidebar HTML and set active menu item
(async function loadSidebar() {
    try {
        const response = await fetch('sidebar.html');
        if (!response.ok) {
            throw new Error(`Failed to load sidebar: ${response.status}`);
        }
        const html = await response.text();
        
        // Insert sidebar before main content or at the beginning of body
        const main = document.querySelector('main');
        const header = document.querySelector('header');
        
        if (header) {
            header.insertAdjacentHTML('afterend', html);
        } else if (main) {
            main.insertAdjacentHTML('beforebegin', html);
        } else {
            document.body.insertAdjacentHTML('afterbegin', html);
        }
        
        // Set active menu item based on current page
        setActiveMenuItem();
        
        console.log('✅ Sidebar loaded successfully');
        
        // Dispatch event to notify sidebar is loaded
        document.dispatchEvent(new Event('sidebarLoaded'));
        
    } catch (error) {
        console.error('❌ Error loading sidebar:', error);
    }
})();

/**
 * Set active class to current page menu item
 */
function setActiveMenuItem() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    // Remove all active classes first
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active class to current page
    let activeMenuItem = null;
    
    if (currentPage === 'index.html' || currentPage === '' || currentPage === '/') {
        activeMenuItem = document.getElementById('return-map-btn');
    } else if (currentPage === 'scada.html') {
        activeMenuItem = document.getElementById('scada-btn');
    } else if (currentPage === 'stats.html') {
        activeMenuItem = document.getElementById('stats-toggle-btn');
    } else if (currentPage === 'databtn.html') {
        activeMenuItem = document.getElementById('databtn-btn');
        // For databtn page, also expand the filter dropdown
        const databtnMenuExpandable = document.getElementById('databtn-menu-expandable');
        const databtnFilterContent = document.getElementById('databtn-filter-content');
        if (databtnMenuExpandable && databtnFilterContent) {
            databtnMenuExpandable.classList.add('expanded');
            databtnFilterContent.classList.add('active');
        }
    }
    
    if (activeMenuItem) {
        activeMenuItem.classList.add('active');
        console.log(`✅ Active menu item set: ${currentPage}`);
    }
}
