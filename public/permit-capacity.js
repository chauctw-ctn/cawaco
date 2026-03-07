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
            // Try to get error details from response
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.message) {
                    errorMessage = errorData.message;
                }
                if (errorData.error) {
                    errorMessage += ` (${errorData.error})`;
                }
            } catch (e) {
                // Response not JSON or empty
            }
            throw new Error(errorMessage);
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
            const errorMsg = result.message || 'Không thể tải dữ liệu';
            const errorDetail = result.error ? ` Chi tiết: ${result.error}` : '';
            throw new Error(errorMsg + errorDetail);
        }
    } catch (error) {
        console.error('❌ Error loading capacity data:', error);
        console.error('Error stack:', error.stack);
        
        // Show detailed error message
        let userMessage = 'Không thể tải dữ liệu công suất. Vui lòng thử lại sau.';
        if (error.message && !error.message.includes('Failed to fetch')) {
            userMessage += '\n\nChi tiết lỗi: ' + error.message;
        } else if (error.message && error.message.includes('Failed to fetch')) {
            userMessage += '\n\nMất kết nối với máy chủ. Vui lòng kiểm tra kết nối mạng.';
        }
        
        showError(userMessage);
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
                <td colspan="7" style="text-align: center; padding: 40px; color: #9ca3af;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                    <div>Không có dữ liệu công suất</div>
                </td>
            </tr>
        `;
        return;
    }
    
    // Sort by permit first, then by station name
    const sortedData = [...tableData].sort((a, b) => {
        // Define permit order
        const permitOrder = {
            '35/gp-btnmt 15/01/2025': 1,
            '36/gp-btnmt 15/01/2025': 2,
            '391/gp-bnnmt 19/09/2025': 3,
            '393/gp-bnnmt 22/09/2025': 4
        };
        
        const permitA = permitOrder[a.permit] || 999;
        const permitB = permitOrder[b.permit] || 999;
        
        if (permitA !== permitB) {
            return permitA - permitB;
        }
        
        // Within same permit, sort by station name
        return a.stationName.localeCompare(b.stationName);
    });
    
    // Group data by permit
    const groupedData = {};
    sortedData.forEach(row => {
        if (!groupedData[row.permit]) {
            groupedData[row.permit] = [];
        }
        groupedData[row.permit].push(row);
    });
    
    // Render rows with merged permit cells
    let globalRowNumber = 1;
    Object.entries(groupedData).forEach(([permit, rows]) => {
        // Get permit class for color-coding
        const permitClass = getPermitClass(permit);
        
        rows.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.className = permitClass;
            
            // STT column
            const sttTd = document.createElement('td');
            sttTd.textContent = globalRowNumber++;
            tr.appendChild(sttTd);
            
            // Permit column (merged for all rows with same permit)
            if (index === 0) {
                const permitTd = document.createElement('td');
                permitTd.textContent = getShortPermitLabel(permit);
                permitTd.rowSpan = rows.length;
                permitTd.className = 'permit-cell';
                permitTd.style.verticalAlign = 'middle';
                permitTd.style.fontWeight = 'bold';
                tr.appendChild(permitTd);
            }
            
            // Station name column (standardized)
            const stationTd = document.createElement('td');
            stationTd.className = 'station-name';
            stationTd.style.textAlign = 'left';
            stationTd.textContent = standardizeStationName(row.stationName, permit);
            tr.appendChild(stationTd);
            
            // Monthly capacity column
            const monthlyTd = document.createElement('td');
            monthlyTd.className = 'capacity-value';
            monthlyTd.style.textAlign = 'center';
            monthlyTd.textContent = `${formatNumber(row.monthlyCapacity)} ${row.unit}`;
            tr.appendChild(monthlyTd);
            
            // Current capacity column
            const currentTd = document.createElement('td');
            currentTd.className = 'capacity-value';
            currentTd.style.textAlign = 'center';
            currentTd.textContent = `${formatNumber(row.currentCapacity)} ${row.unit}`;
            tr.appendChild(currentTd);
            
            // Previous day capacity column
            const previousDayTd = document.createElement('td');
            previousDayTd.className = 'capacity-value';
            previousDayTd.style.textAlign = 'center';
            previousDayTd.textContent = `${formatNumber(row.previousDayCapacity)} ${row.unit}`;
            tr.appendChild(previousDayTd);
            
            // Today capacity column
            const todayTd = document.createElement('td');
            todayTd.className = 'capacity-value';
            todayTd.style.textAlign = 'center';
            todayTd.textContent = `${formatNumber(row.todayCapacity)} ${row.unit}`;
            tr.appendChild(todayTd);
            
            tbody.appendChild(tr);
        });
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
 * Standardize station names based on permit
 * - Permit 393: "NHÀ MÁY 1 - GIẾNG SỐ X"
 * - Permit 36: "NHÀ MÁY 2 - GIẾNG SỐ X"
 * - Other permits: "GIẾNG SỐ X"
 */
function standardizeStationName(stationName, permit) {
    if (!stationName) return '';
    
    const name = stationName.trim().toUpperCase();
    
    // Extract well number from various formats
    let wellNum = null;
    let factoryNum = null;
    
    // Pattern 1: GS1NM1, GS1_NM1, GS2NM2 (with factory)
    const nmPattern1 = /G[S]?(\d+)[_\s-]*NM(\d+)/i;
    const nmMatch1 = name.match(nmPattern1);
    if (nmMatch1) {
        wellNum = nmMatch1[1];
        factoryNum = nmMatch1[2];
    }
    
    // Pattern 2: "NHÀ MÁY SỐ 1 - GIẾNG SỐ 1" or similar variations
    if (!wellNum) {
        const nmPattern2 = /(?:NHA\s*MAY|NHÀ\s*MÁY)[\s\S]*?(\d+)[\s\S]*?(?:GIENG|GIẾNG)[\s\S]*(\d+)/i;
        const nmMatch2 = name.match(nmPattern2);
        if (nmMatch2) {
            factoryNum = nmMatch2[1];
            wellNum = nmMatch2[2];
        }
    }
    
    // Pattern 3: "GIẾNG SỐ 1 NHÀ MÁY 1" (reversed order)
    if (!wellNum) {
        const nmPattern3 = /(?:GIENG|GIẾNG)[\s\S]*(\d+)[\s\S]*?(?:NHA\s*MAY|NHÀ\s*MÁY)[\s\S]*(\d+)/i;
        const nmMatch3 = name.match(nmPattern3);
        if (nmMatch3) {
            wellNum = nmMatch3[1];
            factoryNum = nmMatch3[2];
        }
    }
    
    // If we found a factory number, format according to permit
    if (factoryNum && wellNum) {
        if (permit === '393/gp-bnnmt 22/09/2025') {
            return `NHÀ MÁY 1 - GIẾNG SỐ ${wellNum}`;
        } else if (permit === '36/gp-btnmt 15/01/2025') {
            return `NHÀ MÁY 2 - GIẾNG SỐ ${wellNum}`;
        }
    }
    
    // Pattern 4: Simple wells - G1, G12, GIẾNG 1, GIENG SO 1, TRAM BOM 1, etc.
    if (!wellNum) {
        const wellPattern = /(?:G|GIENG|GIẾNG|TRAM\s*BOM)[\s-]*(?:SO|SỐ)?[\s-]*(\d+)/i;
        const wellMatch = name.match(wellPattern);
        if (wellMatch) {
            wellNum = wellMatch[1];
        }
    }
    
    // Format simple well names
    if (wellNum && !factoryNum) {
        return `GIẾNG SỐ ${wellNum}`;
    }
    
    // If no pattern matches, return original name
    return stationName;
}

/**
 * Get short permit label (e.g., "GP 35", "GP 391")
 */
function getShortPermitLabel(permit) {
    if (!permit) return '';
    const match = permit.match(/^(\d+)\//);
    return match ? `GP ${match[1]}` : permit;
}

/**
 * Get permit CSS class for color-coding
 */
function getPermitClass(permit) {
    if (!permit) return '';
    if (permit.includes('35/gp-btnmt')) return 'permit-35';
    if (permit.includes('36/gp-btnmt')) return 'permit-36';
    if (permit.includes('391/gp-bnnmt')) return 'permit-391';
    if (permit.includes('393/gp-bnnmt')) return 'permit-393';
    return '';
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
    // Only reveal the data wrapper after loading finishes
    const dataWrapper = document.getElementById('data-wrapper');
    if (dataWrapper && !show) {
        dataWrapper.style.display = 'block';
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
