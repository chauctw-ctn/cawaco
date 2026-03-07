// permit-capacity.js - Frontend logic for permit capacity page

let capacityData = null;
let lastUpdateTime = null;

/**
 * Initialize the capacity page
 */
function initializeCapacityPage() {
    console.log('Initializing permit capacity page...');
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    loadCapacityData();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleRefresh);
    }
}

/**
 * Load capacity data from API
 */
async function loadCapacityData() {
    console.log('🔄 Loading capacity data...');
    showLoading(true);
    hideError();
    
    try {
        const token = localStorage.getItem('token');
        console.log('📝 Token:', token ? token.substring(0, 30) + '...' : 'NO TOKEN');
        
        const response = await fetch('/api/permit-capacity', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('📡 Response status:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('📊 API Result:', result);
        
        if (result.success) {
            capacityData = result;  // Store the full result object
            lastUpdateTime = new Date(result.timestamp);
            console.log('✅ Data loaded successfully:', {
                totalPermits: result.totalPermits,
                totalStations: result.totalStations,
                grandTotalCapacity: result.grandTotalCapacity
            });
            renderCapacityData(capacityData);
            updateLastUpdateTime();
        } else {
            throw new Error(result.message || 'Không thể tải dữ liệu');
        }
    } catch (error) {
        console.error('❌ Error loading capacity data:', error);
        console.error('Error stack:', error.stack);
        showError('Không thể tải dữ liệu công suất. Vui lòng thử lại sau.');
    } finally {
        showLoading(false);
    }
}

/**
 * Handle refresh button click
 */
async function handleRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn.classList.contains('loading')) {
        return; // Already refreshing
    }
    
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    
    try {
        await loadCapacityData();
    } finally {
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
    }
}

/**
 * Render capacity data
 */
function renderCapacityData(data) {
    console.log('🎨 Rendering capacity data:', data);
    if (!data) {
        console.error('❌ No data to render');
        return;
    }
    
    // Update summary cards
    console.log('📋 Updating summary cards...');
    updateSummaryCards(data);
    
    // Render table
    console.log('📑 Rendering table...', (data.tableData || []).length, 'rows');
    renderCapacityTable(data.tableData);
    
    console.log('✅ Rendering complete');
}

/**
 * Update summary cards with permit-specific totals
 */
function updateSummaryCards(data) {
    if (!data || !data.tableData) {
        console.error('❌ No data for summary cards');
        return;
    }
    
    // Group by permit and calculate totals
    const permitTotals = {
        '35/gp-btnmt 15/01/2025': { monthly: 0, current: 0 },
        '36/gp-btnmt 15/01/2025': { monthly: 0, current: 0 },
        '391/gp-bnnmt 19/09/2025': { monthly: 0, current: 0 },
        '393/gp-bnnmt 22/09/2025': { monthly: 0, current: 0 }
    };
    
    let totalMonthly = 0;
    let totalCurrent = 0;
    
    // Sum up capacities by permit
    data.tableData.forEach(row => {
        const permit = row.permit;
        if (permitTotals[permit]) {
            permitTotals[permit].monthly += row.monthlyCapacity || 0;
            permitTotals[permit].current += row.currentCapacity || 0;
        }
        totalMonthly += row.monthlyCapacity || 0;
        totalCurrent += row.currentCapacity || 0;
    });
    
    // Update permit 35
    updateElement('permit-35-monthly', formatNumber(permitTotals['35/gp-btnmt 15/01/2025'].monthly) + ' m³');
    updateElement('permit-35-current', formatNumber(permitTotals['35/gp-btnmt 15/01/2025'].current) + ' m³');
    
    // Update permit 36
    updateElement('permit-36-monthly', formatNumber(permitTotals['36/gp-btnmt 15/01/2025'].monthly) + ' m³');
    updateElement('permit-36-current', formatNumber(permitTotals['36/gp-btnmt 15/01/2025'].current) + ' m³');
    
    // Update permit 391
    updateElement('permit-391-monthly', formatNumber(permitTotals['391/gp-bnnmt 19/09/2025'].monthly) + ' m³');
    updateElement('permit-391-current', formatNumber(permitTotals['391/gp-bnnmt 19/09/2025'].current) + ' m³');
    
    // Update permit 393
    updateElement('permit-393-monthly', formatNumber(permitTotals['393/gp-bnnmt 22/09/2025'].monthly) + ' m³');
    updateElement('permit-393-current', formatNumber(permitTotals['393/gp-bnnmt 22/09/2025'].current) + ' m³');
    
    // Update totals
    updateElement('total-monthly', formatNumber(totalMonthly) + ' m³');
    updateElement('total-current', formatNumber(totalCurrent) + ' m³');
}

/**
 * Helper function to update element text content
 */
function updateElement(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text;
    }
}

/**
 * Render capacity table
 */
function renderCapacityTable(tableData) {
    const tbody = document.getElementById('capacity-table-body');
    if (!tbody) {
        console.error('❌ Table body not found');
        return;
    }
    
    tbody.innerHTML = '';
    
    if (!tableData || tableData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: #9ca3af;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                    <div>Không có dữ liệu công suất</div>
                </td>
            </tr>
        `;
        return;
    }
    
    // Render each station row
    tableData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.stt}</td>
            <td class="station-name">${row.stationName}</td>
            <td>${row.permit}</td>
            <td class="capacity-value">${formatNumber(row.monthlyCapacity)} ${row.unit}</td>
            <td class="capacity-value">${formatNumber(row.currentCapacity)} ${row.unit}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Format number with thousand separators
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    // Round to nearest integer to ensure no decimal places
    const rounded = Math.round(Number(num));
    return rounded.toLocaleString('vi-VN', { 
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

/**
 * Update last update time display
 */
function updateLastUpdateTime() {
    const lastUpdateEl = document.getElementById('last-update');
    if (!lastUpdateEl || !lastUpdateTime) return;
    
    const formattedTime = lastUpdateTime.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    lastUpdateEl.textContent = `Cập nhật lúc: ${formattedTime}`;
}

/**
 * Show/hide loading state
 */
function showLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = show ? 'block' : 'none';
    }
}

/**
 * Show error message
 */
function showError(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

/**
 * Hide error message
 */
function hideError() {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.style.display = 'none';
    }
}

// Export for use in HTML
window.initializeCapacityPage = initializeCapacityPage;
