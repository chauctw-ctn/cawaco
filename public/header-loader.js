// Header Loader - Load header HTML automatically
(async function loadHeader() {
    try {
        const response = await fetch('header.html');
        if (!response.ok) {
            throw new Error(`Failed to load header: ${response.status}`);
        }
        const html = await response.text();
        
        // Insert header at the beginning of body
        document.body.insertAdjacentHTML('afterbegin', html);
        
        console.log('✅ Header loaded successfully');
        
        // Dispatch event to notify header is loaded
        document.dispatchEvent(new Event('headerLoaded'));
        
    } catch (error) {
        console.error('❌ Error loading header:', error);
    }
})();
