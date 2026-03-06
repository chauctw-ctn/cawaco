// Databtn.js - Hiển thị dữ liệu giấy phép từ API

let currentData = [];
let lastUpdateTime = null;
let allPermits = []; // Danh sách tất cả giấy phép
let autoRefreshInterval = null; // Auto refresh timer
let statusCheckInterval = null; // Status check timer for periodic alerts
let refreshIntervalMinutes = 15; // Default 15 minutes (from Telegram config)
let delayThresholdMinutes = 60; // Default 60 minutes (from Telegram config)
let alertRepeatIntervalMinutes = 1; // Default 1 minute - repeat offline alerts

// Table header filters
let allStations = []; // Danh sách tất cả tên trạm
let selectedStations = new Set(); // Các trạm được chọn
let selectedPermits = new Set(); // Các giấy phép được chọn
let selectedStatuses = new Set(['online', 'offline']); // Các trạng thái được chọn

// Telegram alert tracking
let stationStatusMap = {}; // Track previous status of each station
let telegramConfig = null; // Telegram configuration
let pendingOfflineAlerts = new Set(); // Stations to alert on next check cycle
let isFirstCheck = true; // Track if this is the first check after page load
const ALERT_HISTORY_KEY = 'telegram_alert_history'; // localStorage key for alert history

/**
 * Format timestamp to Vietnamese date/time
 */
function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Format delay time in Vietnamese
 */
function formatDelay(minutes) {
    if (!minutes && minutes !== 0) return 'N/A';
    
    if (minutes < 60) {
        return `${minutes} phút`;
    } else if (minutes < 1440) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return remainingMinutes > 0 
            ? `${hours} giờ ${remainingMinutes} phút`
            : `${hours} giờ`;
    } else {
        const days = Math.floor(minutes / 1440);
        const remainingHours = Math.floor((minutes % 1440) / 60);
        return remainingHours > 0
            ? `${days} ngày ${remainingHours} giờ`
            : `${days} ngày`;
    }
}

/**
 * Create status badge HTML
 */
function createStatusBadge(delayMinutes) {
    const isOnline = delayMinutes <= delayThresholdMinutes;
    const statusClass = isOnline ? 'status-online' : 'status-offline';
    const statusText = isOnline ? '✅ Bình thường' : '❌ Chưa gửi dữ liệu';
    return `<span class="status-badge ${statusClass}">${statusText}</span>`;
}

/**
 * Show loading state
 */
function showLoading() {
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const tableBody = document.getElementById('table-body');
    
    if (loading) loading.style.display = 'block';
    if (errorMessage) errorMessage.style.display = 'none';
    if (tableBody) tableBody.innerHTML = '';
}

/**
 * Hide loading state
 */
function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
}

/**
 * Show error message
 */
function showError(message) {
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
}

/**
 * Update last update time display
 */
function updateLastUpdateDisplay() {
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl && lastUpdateTime) {
        lastUpdateEl.textContent = `Cập nhật lần cuối: ${formatDateTime(lastUpdateTime)}`;
    }
}

/**
 * Fetch Telegram configuration
 */
async function fetchTelegramConfig() {
    try {
        console.log('📡 Fetching Telegram config...');
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.log('⚠️ No auth token found');
            return;
        }
        
        const response = await fetch('/api/telegram/config', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('📥 Telegram config response:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('📋 Telegram config data:', data);
            
            if (data.success) {
                telegramConfig = data.config;
                
                // Load configuration values
                if (telegramConfig.refreshInterval) {
                    refreshIntervalMinutes = Math.max(15, parseInt(telegramConfig.refreshInterval));
                }
                if (telegramConfig.delayThreshold) {
                    delayThresholdMinutes = Math.max(1, parseInt(telegramConfig.delayThreshold));
                }
                if (telegramConfig.alertRepeatInterval) {
                    alertRepeatIntervalMinutes = Math.max(1, parseInt(telegramConfig.alertRepeatInterval));
                }
                
                console.log('✅ Telegram config loaded:', {
                    enabled: telegramConfig.enabled,
                    refreshInterval: refreshIntervalMinutes,
                    delayThreshold: delayThresholdMinutes,
                    alertRepeatInterval: alertRepeatIntervalMinutes
                });
            }
        }
    } catch (error) {
        console.error('❌ Error fetching Telegram config:', error);
    }
}

/**
 * Get alert history from localStorage
 */
function getAlertHistory() {
    try {
        const history = localStorage.getItem(ALERT_HISTORY_KEY);
        const parsed = history ? JSON.parse(history) : {};
        console.log('📖 Alert history loaded:', Object.keys(parsed).length, 'stations');
        return parsed;
    } catch (error) {
        console.error('❌ Error reading alert history:', error);
        return {};
    }
}

/**
 * Save alert history to localStorage
 */
function saveAlertHistory(history) {
    try {
        localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(history));
        console.log('💾 Alert history saved:', Object.keys(history).length, 'stations');
    } catch (error) {
        console.error('❌ Error saving alert history:', error);
    }
}

/**
 * Check if should send alert for station
 * Returns: { shouldSend: boolean, reason: string }
 */
function shouldSendAlert(station, newStatus, delayMinutes) {
    const history = getAlertHistory();
    const stationHistory = history[station];
    const now = Date.now();
    
    console.log(`🔍 shouldSendAlert check for ${station}:`, {
        newStatus,
        delayMinutes,
        hasHistory: !!stationHistory,
        alertRepeatIntervalMinutes
    });
    
    // First time seeing this station - send alert
    if (!stationHistory) {
        console.log(`✅ ${station}: First alert (no history)`);
        return { shouldSend: true, reason: 'first_alert' };
    }
    
    const { lastAlertTime, lastAlertStatus } = stationHistory;
    const minutesSinceLastAlert = (now - lastAlertTime) / (1000 * 60);
    
    console.log(`📊 ${station} alert history:`, {
        lastAlertStatus,
        minutesSinceLastAlert: minutesSinceLastAlert.toFixed(2),
        threshold: alertRepeatIntervalMinutes
    });
    
    // Status changed - always send alert
    if (lastAlertStatus !== newStatus) {
        console.log(`✅ ${station}: Status changed from ${lastAlertStatus} to ${newStatus}`);
        return { shouldSend: true, reason: 'status_changed' };
    }
    
    // Station is offline and enough time has passed since last alert - send periodic reminder
    if (newStatus === 'offline' && minutesSinceLastAlert >= alertRepeatIntervalMinutes) {
        console.log(`✅ ${station}: Periodic reminder (${minutesSinceLastAlert.toFixed(2)} min >= ${alertRepeatIntervalMinutes} min)`);
        return { shouldSend: true, reason: 'periodic_reminder' };
    }
    
    // Otherwise, don't send
    if (newStatus === 'offline') {
        console.log(`⏳ ${station}: Too soon for periodic alert (${minutesSinceLastAlert.toFixed(2)} min < ${alertRepeatIntervalMinutes} min)`);
    } else {
        console.log(`ℹ️ ${station}: Online and no change, no alert needed`);
    }
    return { shouldSend: false, reason: 'too_soon' };
}

/**
 * Record alert in history
 */
function recordAlert(station, status) {
    const history = getAlertHistory();
    const alertInfo = {
        lastAlertTime: Date.now(),
        lastAlertStatus: status
    };
    history[station] = alertInfo;
    saveAlertHistory(history);
    console.log(`💾 Recorded alert for ${station}:`, alertInfo);
}

/**
 * Send Telegram alert for station status change
 */
async function sendTelegramAlert(station, status, measurementTime, delayMinutes, reason = '') {
    try {
        console.log(`📤 sendTelegramAlert called for ${station}:`, { status, delayMinutes, reason });
        
        // Check if Telegram is enabled
        if (!telegramConfig || !telegramConfig.enabled) {
            console.log(`❌ Telegram not enabled:`, { hasConfig: !!telegramConfig, enabled: telegramConfig?.enabled });
            return;
        }
        
        console.log(`✅ Telegram is enabled, checking if should send...`);
        
        // Check if should send alert (prevent spam)
        const alertCheck = shouldSendAlert(station, status, delayMinutes);
        if (!alertCheck.shouldSend) {
            console.log(`⏭️ Skipping alert for ${station}: ${alertCheck.reason}`);
            return;
        }
        
        console.log(`🚀 Sending alert for ${station}: ${status} (${alertCheck.reason})`);
        
        // Send alert
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.log('⚠️ No auth token for sending alert');
            return;
        }
        
        const response = await fetch('/api/telegram/alert', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                station: station,
                status: status,
                measurementTime: measurementTime,
                delayMinutes: delayMinutes
            })
        });
        
        console.log(`📨 Alert API response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`📨 Alert API response data:`, data);
            
            if (data.success) {
                // Record this alert to prevent duplicate/spam
                recordAlert(station, status);
                console.log(`✅ Sent Telegram alert for ${station}: ${status} (${alertCheck.reason})`);
            } else {
                console.error(`❌ Alert API returned success=false:`, data);
            }
        } else {
            console.error(`❌ Alert API returned error status: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Error sending Telegram alert:', error);
    }
}

/**
 * Check and send alerts for station status changes
 * This recalculates delays based on current time
 */
function checkStationStatusChanges() {
    console.log(`\n🔔 ===== checkStationStatusChanges called at ${new Date().toLocaleString('vi-VN')} =====`);
    console.log(`Telegram config:`, { 
        hasConfig: !!telegramConfig, 
        enabled: telegramConfig?.enabled,
        alertRepeatIntervalMinutes,
        isFirstCheck 
    });
    
    if (!telegramConfig || !telegramConfig.enabled) {
        console.log(`❌ Telegram not enabled, skipping status check`);
        return;
    }
    
    if (currentData.length === 0) {
        console.log(`⚠️ No data available for status check`);
        return;
    }
    
    console.log(`✅ Telegram enabled, checking ${currentData.length} data points`);
    
    // Group data by station and recalculate delays
    const stationData = {};
    const now = Date.now();
    
    currentData.forEach(row => {
        const station = row.station || 'N/A';
        if (!stationData[station]) {
            // Recalculate delay based on current time
            const measurementTime = new Date(row.measurementTime).getTime();
            const currentDelayMinutes = Math.floor((now - measurementTime) / (1000 * 60));
            
            stationData[station] = {
                station: station,
                delayMinutes: currentDelayMinutes,
                measurementTime: row.measurementTime
            };
        } else {
            // Keep the maximum delay for this station
            const measurementTime = new Date(row.measurementTime).getTime();
            const currentDelayMinutes = Math.floor((now - measurementTime) / (1000 * 60));
            
            if (currentDelayMinutes > stationData[station].delayMinutes) {
                stationData[station].delayMinutes = currentDelayMinutes;
                stationData[station].measurementTime = row.measurementTime;
            }
        }
    });
    
    console.log(`📊 Grouped into ${Object.keys(stationData).length} stations`);
    
    // Check each station for status changes
    Object.values(stationData).forEach(data => {
        const station = data.station;
        const isOnline = data.delayMinutes <= delayThresholdMinutes;
        const currentStatus = isOnline ? 'online' : 'offline';
        const previousStatus = stationStatusMap[station];
        const measurementTime = data.measurementTime; // Get measurement time
        const delayMinutes = data.delayMinutes; // Get delay in minutes
        
        console.log(`\n🏢 Checking station: ${station}`);
        console.log(`   Current: ${currentStatus} (delay: ${delayMinutes} min)`);
        console.log(`   Previous: ${previousStatus || 'none'}`);
        console.log(`   isFirstCheck: ${isFirstCheck}`);
        
        // First check after page reload - just initialize, DO NOT send any alerts
        if (isFirstCheck) {
            console.log(`ℹ️ Station ${station} initialized: ${currentStatus} (no alert on first check)`);
        }
        // Normal operation - check for status changes or periodic alerts
        else {
            // Status changed or periodic check needed
            if (previousStatus !== undefined) {
                // Status changed from online to offline
                if (previousStatus === 'online' && currentStatus === 'offline') {
                    console.log(`🔔 Station ${station} went offline`);
                    sendTelegramAlert(station, 'offline', measurementTime, delayMinutes, 'status_change');
                }
                // Status changed from offline to online
                else if (previousStatus === 'offline' && currentStatus === 'online') {
                    console.log(`🔔 Station ${station} came back online`);
                    sendTelegramAlert(station, 'online', measurementTime, delayMinutes, 'status_change');
                }
                // Status unchanged but still offline - check if periodic alert needed
                else if (currentStatus === 'offline') {
                    console.log(`🔄 Station ${station} still offline, checking if periodic alert needed...`);
                    sendTelegramAlert(station, 'offline', measurementTime, delayMinutes, 'periodic_check');
                }
                else {
                    console.log(`✅ Station ${station} still online, no alert needed`);
                }
            }
            // First time tracking this station in this session (after initial page load)
            else {
                console.log(`🆕 First time tracking ${station} in this session`);
                // Only send alert if station is offline, let history prevent spam
                if (currentStatus === 'offline') {
                    sendTelegramAlert(station, currentStatus, measurementTime, delayMinutes, 'first_in_session');
                } else {
                    console.log(`ℹ️ Station ${station} is online, no alert needed`);
                }
            }
        }
        
        // Update status map
        stationStatusMap[station] = currentStatus;
    });
    
    // Mark that first check is complete
    if (isFirstCheck) {
        isFirstCheck = false;
        console.log(`✅ First check complete. Alert history will prevent spam on reload.`);
        console.log(`🔄 Next checks will evaluate status changes and periodic alerts.`);
    }
    
    console.log(`===== End checkStationStatusChanges =====\n`);
}

// Removed setupStatusCheckInterval - alerts are now sent only after data fetch/update

/**
 * Setup auto refresh
 */
function setupAutoRefresh() {
    // Clear existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        console.log('🔄 Cleared existing auto refresh interval');
    }
    
    // Set new interval (convert minutes to milliseconds)
    autoRefreshInterval = setInterval(() => {
        console.log('⏰ Auto refresh triggered');
        fetchData();
    }, refreshIntervalMinutes * 60 * 1000);
    
    console.log(`✅ Auto refresh set to ${refreshIntervalMinutes} minutes (${refreshIntervalMinutes * 60} seconds)`);
}

/**
 * Setup status check interval for periodic alerts
 * This checks status and sends alerts independently from data refresh
 */
function setupStatusCheckInterval() {
    // Clear existing interval
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        console.log('🔄 Cleared existing status check interval');
    }
    
    // Only setup if Telegram is enabled
    if (!telegramConfig || !telegramConfig.enabled) {
        console.log('⚠️ Telegram not enabled, skipping status check interval setup');
        return;
    }
    
    // Validate alertRepeatIntervalMinutes
    const intervalMinutes = Math.max(1, alertRepeatIntervalMinutes || 1);
    const intervalMs = intervalMinutes * 60 * 1000;
    
    console.log(`⚙️ Setting up status check interval: ${intervalMinutes} minutes (${intervalMs}ms)`);
    
    // Set new interval for status checks (convert minutes to milliseconds)
    statusCheckInterval = setInterval(() => {
        console.log('⏰ Periodic status check triggered at', new Date().toLocaleString('vi-VN'));
        checkStationStatusChanges();
    }, intervalMs);
    
    console.log(`✅ Status check interval set to ${intervalMinutes} minutes (${intervalMinutes * 60} seconds)`);
    console.log(`📅 Next check will run at: ${new Date(Date.now() + intervalMs).toLocaleString('vi-VN')}`);
}

/**
 * Fetch data from API
 */
async function fetchData() {
    try {
        console.log('🔄 Fetching permit data...');
        showLoading();
        
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('Chưa đăng nhập');
        }
        
        const response = await fetch('/api/permit-data', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Token hết hạn, chuyển về trang login
                localStorage.removeItem('authToken');
                window.location.href = '/login.html';
                return;
            }
            throw new Error(`Lỗi tải dữ liệu: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Không thể lấy dữ liệu');
        }
        
        currentData = data.data || [];
        lastUpdateTime = Date.now();
        
        // Extract unique permits for filter
        extractPermits();
        
        console.log(`📊 Fetched ${currentData.length} data points`);
        
        // Check for station status changes and send alerts
        checkStationStatusChanges();
        
        hideLoading();
        renderTable();
        updateLastUpdateDisplay();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        hideLoading();
        showError(error.message || 'Không thể tải dữ liệu. Vui lòng thử lại.');
    }
}

/**
 * Extract unique permits from data
 */
function extractPermits() {
    const permitSet = new Set();
    const stationSet = new Set();
    
    currentData.forEach(row => {
        if (row.permit) {
            permitSet.add(row.permit);
        }
        if (row.station) {
            stationSet.add(row.station);
        }
    });
    
    allPermits = Array.from(permitSet).sort();
    allStations = Array.from(stationSet).sort();
    
    // Initialize selections if empty
    if (selectedStations.size === 0) {
        selectedStations = new Set(allStations);
    }
    if (selectedPermits.size === 0) {
        selectedPermits = new Set(allPermits);
    }
    
    updatePermitFilter();
}

/**
 * Create table header with filter dropdowns
 */
function createTableHeader() {
    const thead = document.querySelector('#data-table thead');
    if (!thead) return;
    
    thead.innerHTML = `
        <tr>
            <th>STT</th>
            <th>
                <div class="th-filter-container">
                    <span>TÊN TRẠM</span>
                    <button class="th-filter-button" data-filter="station" title="Lọc tên trạm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                        </svg>
                    </button>
                </div>
                <div class="th-filter-dropdown" data-filter="station"></div>
            </th>
            <th>THÔNG SỐ ĐO</th>
            <th>GIÁ TRỊ</th>
            <th>ĐƠN VỊ</th>
            <th>THỜI GIAN ĐO</th>
            <th>ĐỘ TRỄ</th>
            <th>
                <div class="th-filter-container">
                    <span>TRẠNG THÁI</span>
                    <button class="th-filter-button" data-filter="status" title="Lọc trạng thái">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                        </svg>
                    </button>
                </div>
                <div class="th-filter-dropdown" data-filter="status"></div>
            </th>
            <th>
                <div class="th-filter-container">
                    <span>GIẤY PHÉP</span>
                    <button class="th-filter-button" data-filter="permit" title="Lọc giấy phép">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                        </svg>
                    </button>
                </div>
                <div class="th-filter-dropdown" data-filter="permit"></div>
            </th>
        </tr>
    `;
    
    // Setup filter dropdowns
    setupHeaderFilters();
}

/**
 * Setup header filter dropdowns
 */
function setupHeaderFilters() {
    // Station filter
    setupFilterDropdown('station', allStations, selectedStations);
    
    // Status filter
    setupFilterDropdown('status', ['online', 'offline'], selectedStatuses, (value) => {
        return value === 'online' ? '✅ Bình thường' : '❌ Chưa gửi dữ liệu';
    });
    
    // Permit filter
    setupFilterDropdown('permit', allPermits, selectedPermits);
}

/**
 * Setup individual filter dropdown
 */
function setupFilterDropdown(filterType, items, selectedItems, labelFormatter = null) {
    const button = document.querySelector(`.th-filter-button[data-filter="${filterType}"]`);
    const dropdown = document.querySelector(`.th-filter-dropdown[data-filter="${filterType}"]`);
    
    if (!button || !dropdown) return;
    
    // Create dropdown content
    let dropdownHTML = '';
    
    // Add search box for station and permit filters
    if (filterType === 'station' || filterType === 'permit') {
        dropdownHTML += `
            <input type="text" class="th-filter-search" placeholder="Tìm kiếm..." data-filter="${filterType}">
        `;
    }
    
    dropdownHTML += '<div class="th-filter-options" data-filter="' + filterType + '">';
    
    items.forEach(item => {
        const isChecked = selectedItems.has(item);
        const displayLabel = labelFormatter ? labelFormatter(item) : item;
        const itemId = `filter-${filterType}-${item.replace(/\s+/g, '-')}`;
        
        dropdownHTML += `
            <div class="th-filter-option">
                <input type="checkbox" id="${itemId}" value="${item}" ${isChecked ? 'checked' : ''}>
                <label for="${itemId}">${displayLabel}</label>
            </div>
        `;
    });
    
    dropdownHTML += '</div>';
    
    // Add action buttons
    dropdownHTML += `
        <div class="th-filter-actions">
            <button class="th-filter-btn th-filter-btn-select-all" data-filter="${filterType}">Chọn tất cả</button>
            <button class="th-filter-btn th-filter-btn-clear" data-filter="${filterType}">Bỏ chọn</button>
        </div>
        <div class="th-filter-actions" style="margin-top: 4px;">
            <button class="th-filter-btn th-filter-btn-apply" data-filter="${filterType}" style="background: #0066cc; color: white; width: 100%;">Áp dụng</button>
        </div>
    `;
    
    dropdown.innerHTML = dropdownHTML;
    
    // Update button active state
    updateFilterButtonState(filterType, selectedItems, items);
    
    // Toggle dropdown on button click
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');
        
        // Check if any other dropdown is open before closing
        const otherDropdownWasOpen = Array.from(document.querySelectorAll('.th-filter-dropdown.show'))
            .some(d => d !== dropdown);
        
        // Close all other dropdowns
        document.querySelectorAll('.th-filter-dropdown.show').forEach(d => {
            if (d !== dropdown) {
                d.classList.remove('show');
            }
        });
        document.querySelectorAll('.th-filter-button.active').forEach(b => {
            if (b !== button) b.classList.remove('active');
        });
        
        // Re-render if closing another dropdown to apply its filters
        if (otherDropdownWasOpen) {
            renderTable();
        }
        
        // Toggle current dropdown
        if (isOpen) {
            dropdown.classList.remove('show');
            button.classList.remove('active');
            // Re-render table when closing dropdown
            renderTable();
        } else {
            // Calculate position for fixed dropdown
            const buttonRect = button.getBoundingClientRect();
            const dropdownWidth = 250; // min-width from CSS
            
            // Position dropdown below button, centered
            dropdown.style.top = `${buttonRect.bottom + 8}px`;
            dropdown.style.left = `${buttonRect.left + (buttonRect.width / 2) - (dropdownWidth / 2)}px`;
            
            // Check if dropdown goes off-screen to the right
            const rightEdge = buttonRect.left + (buttonRect.width / 2) + (dropdownWidth / 2);
            if (rightEdge > window.innerWidth) {
                dropdown.style.left = `${window.innerWidth - dropdownWidth - 10}px`;
            }
            
            // Check if dropdown goes off-screen to the left
            const leftEdge = buttonRect.left + (buttonRect.width / 2) - (dropdownWidth / 2);
            if (leftEdge < 0) {
                dropdown.style.left = '10px';
            }
            
            dropdown.classList.add('show');
            button.classList.add('active');
        }
    });
    
    // Handle checkbox changes
    const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const value = checkbox.value;
            if (checkbox.checked) {
                selectedItems.add(value);
            } else {
                selectedItems.delete(value);
            }
            updateFilterButtonState(filterType, selectedItems, items);
            // Don't close dropdown or re-render immediately
            // Just update button state - will re-render when dropdown closes
        });
    });
    
    // Handle search
    const searchInput = dropdown.querySelector('.th-filter-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const options = dropdown.querySelectorAll('.th-filter-option');
            
            options.forEach(option => {
                const label = option.querySelector('label').textContent.toLowerCase();
                if (label.includes(searchTerm)) {
                    option.style.display = 'flex';
                } else {
                    option.style.display = 'none';
                }
            });
        });
    }
    
    // Handle "Select All" button
    const selectAllBtn = dropdown.querySelector('.th-filter-btn-select-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            checkboxes.forEach(cb => {
                cb.checked = true;
                selectedItems.add(cb.value);
            });
            updateFilterButtonState(filterType, selectedItems, items);
            // Don't close dropdown or re-render immediately
        });
    }
    
    // Handle "Clear" button
    const clearBtn = dropdown.querySelector('.th-filter-btn-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            checkboxes.forEach(cb => {
                cb.checked = false;
                selectedItems.delete(cb.value);
            });
            updateFilterButtonState(filterType, selectedItems, items);
            // Don't close dropdown or re-render immediately
        });
    }
    
    // Handle "Apply" button
    const applyBtn = dropdown.querySelector('.th-filter-btn-apply');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            dropdown.classList.remove('show');
            button.classList.remove('active');
            updateFilterButtonState(filterType, selectedItems, items);
            // Re-render table with new filters
            renderTable();
        });
    }
}

/**
 * Update filter button active state
 */
function updateFilterButtonState(filterType, selectedItems, allItems) {
    const button = document.querySelector(`.th-filter-button[data-filter="${filterType}"]`);
    if (!button) return;
    
    // Show active state if not all items are selected
    if (selectedItems.size < allItems.length) {
        button.classList.add('active');
    } else {
        button.classList.remove('active');
    }
}

/**
 * Close all filter dropdowns when clicking outside
 */
document.addEventListener('click', (e) => {
    if (!e.target.closest('.th-filter-container') && !e.target.closest('.th-filter-dropdown')) {
        const wasOpen = document.querySelector('.th-filter-dropdown.show');
        
        document.querySelectorAll('.th-filter-dropdown.show').forEach(d => {
            d.classList.remove('show');
        });
        document.querySelectorAll('.th-filter-button.active').forEach(b => {
            const filterType = b.getAttribute('data-filter');
            const dropdown = document.querySelector(`.th-filter-dropdown[data-filter="${filterType}"]`);
            if (dropdown && !dropdown.classList.contains('show')) {
                // Only remove active if dropdown is closed
                // Keep active if filter is actually applied
                let selectedItems, allItems;
                if (filterType === 'station') {
                    selectedItems = selectedStations;
                    allItems = allStations;
                } else if (filterType === 'permit') {
                    selectedItems = selectedPermits;
                    allItems = allPermits;
                } else if (filterType === 'status') {
                    selectedItems = selectedStatuses;
                    allItems = ['online', 'offline'];
                }
                updateFilterButtonState(filterType, selectedItems, allItems);
            }
        });
        
        // Re-render table if a dropdown was closed
        if (wasOpen) {
            renderTable();
        }
    }
});

/**
 * Close dropdowns on scroll or resize
 */
function closeAllDropdowns() {
    const wasOpen = document.querySelector('.th-filter-dropdown.show');
    
    document.querySelectorAll('.th-filter-dropdown.show').forEach(d => {
        d.classList.remove('show');
    });
    document.querySelectorAll('.th-filter-button').forEach(b => {
        const filterType = b.getAttribute('data-filter');
        let selectedItems, allItems;
        if (filterType === 'station') {
            selectedItems = selectedStations;
            allItems = allStations;
        } else if (filterType === 'permit') {
            selectedItems = selectedPermits;
            allItems = allPermits;
        } else if (filterType === 'status') {
            selectedItems = selectedStatuses;
            allItems = ['online', 'offline'];
        }
        updateFilterButtonState(filterType, selectedItems, allItems);
    });
    
    // Re-render table if a dropdown was closed
    if (wasOpen) {
        renderTable();
    }
}

/**
 * Update permit filter checkboxes
 */
function updatePermitFilter() {
    const permitCheckboxes = document.getElementById('permit-checkboxes');
    if (!permitCheckboxes) return;
    
    // Keep "Tất cả" checkbox
    const allCheckbox = permitCheckboxes.querySelector('#permit-all');
    const allCheckboxHTML = allCheckbox ? allCheckbox.parentElement.outerHTML : '';
    
    // Clear and rebuild
    permitCheckboxes.innerHTML = allCheckboxHTML;
    
    // Add permit checkboxes
    allPermits.forEach(permit => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'permit-checkbox';
        checkbox.value = permit;
        checkbox.checked = true; // Default all checked
        
        const span = document.createElement('span');
        span.textContent = permit;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        permitCheckboxes.appendChild(label);
    });
    
    // Attach event listeners
    attachFilterListeners();
}

/**
 * Attach event listeners to filter checkboxes
 */
function attachFilterListeners() {
    const permitCheckboxes = document.getElementById('permit-checkboxes');
    if (!permitCheckboxes) return;
    
    const allCheckbox = document.getElementById('permit-all');
    const permitCheckboxList = permitCheckboxes.querySelectorAll('.permit-checkbox');
    const offlineCheckbox = document.getElementById('filter-offline');
    
    // "Tất cả" checkbox handler
    if (allCheckbox) {
        allCheckbox.addEventListener('change', function() {
            permitCheckboxList.forEach(cb => {
                cb.checked = this.checked;
            });
            renderTable();
        });
    }
    
    // Individual permit checkboxes handler
    permitCheckboxList.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            // Update "Tất cả" checkbox state
            if (allCheckbox) {
                const allChecked = Array.from(permitCheckboxList).every(cb => cb.checked);
                allCheckbox.checked = allChecked;
            }
            renderTable();
        });
    });
    
    // Offline filter checkbox handler
    if (offlineCheckbox) {
        offlineCheckbox.addEventListener('change', function() {
            renderTable();
        });
    }
}

/**
 * Filter data by selected permits and offline status
 */
function getFilteredData() {
    const permitCheckboxes = document.getElementById('permit-checkboxes');
    const offlineCheckbox = document.getElementById('filter-offline');
    
    let filteredData = currentData;
    
    // Filter by header filters first (station, permit, status)
    filteredData = filteredData.filter(row => {
        // Filter by station
        if (!selectedStations.has(row.station)) {
            return false;
        }
        
        // Filter by permit
        if (!selectedPermits.has(row.permit)) {
            return false;
        }
        
        // Filter by status
        const delayMinutes = row.delayMinutes || 0;
        const status = delayMinutes <= delayThresholdMinutes ? 'online' : 'offline';
        if (!selectedStatuses.has(status)) {
            return false;
        }
        
        return true;
    });
    
    // Also apply sidebar filters if they exist (for backwards compatibility)
    if (permitCheckboxes) {
        // Filter by offline status from sidebar
        if (offlineCheckbox && offlineCheckbox.checked) {
            filteredData = filteredData.filter(row => {
                const delayMinutes = row.delayMinutes || 0;
                return delayMinutes > delayThresholdMinutes;
            });
        }
        
        const allCheckbox = document.getElementById('permit-all');
        
        // If "Tất cả" is not checked in sidebar, filter by sidebar permit selection
        if (allCheckbox && !allCheckbox.checked) {
            const sidebarSelectedPermits = [];
            const permitCheckboxList = permitCheckboxes.querySelectorAll('.permit-checkbox:checked');
            permitCheckboxList.forEach(cb => {
                sidebarSelectedPermits.push(cb.value);
            });
            
            if (sidebarSelectedPermits.length > 0) {
                filteredData = filteredData.filter(row => sidebarSelectedPermits.includes(row.permit));
            }
        }
    }
    
    return filteredData;
}

/**
 * Render table with data
 */
function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    
    // Create/update table header with filters
    createTableHeader();
    
    tbody.innerHTML = '';
    
    const filteredData = getFilteredData();
    
    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: #9ca3af;">
                    Không có dữ liệu
                </td>
            </tr>
        `;
        return;
    }
    
    // Group data by station
    const groupedData = {};
    filteredData.forEach(row => {
        const station = row.station || 'N/A';
        if (!groupedData[station]) {
            groupedData[station] = [];
        }
        groupedData[station].push(row);
    });
    
    let stationNumber = 0;
    
    // Render each station group
    Object.keys(groupedData).sort().forEach(station => {
        const rows = groupedData[station];
        stationNumber++;
        
        // Determine color class for this station group (cycle through 8 colors)
        const colorClass = `station-group-${(stationNumber - 1) % 8}`;
        
        // Number of rows for this station (for rowspan)
        const rowCount = rows.length;
        
        // Data rows for this station
        rows.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.className = colorClass;
            
            const delayMinutes = row.delayMinutes || 0;
            
            // For first row of station: add STT, TÊN TRẠM, and GIẤY PHÉP with rowspan
            // For subsequent rows: skip these columns (they are merged)
            if (index === 0) {
                tr.innerHTML = `
                    <td rowspan="${rowCount}">${stationNumber}</td>
                    <td rowspan="${rowCount}">${row.station || 'N/A'}</td>
                    <td>${row.parameter || 'N/A'}</td>
                    <td>${row.value !== null && row.value !== undefined ? row.value : 'N/A'}</td>
                    <td>${row.unit || 'N/A'}</td>
                    <td>${formatDateTime(row.measurementTime)}</td>
                    <td>${formatDelay(delayMinutes)}</td>
                    <td>${createStatusBadge(delayMinutes)}</td>
                    <td rowspan="${rowCount}">${row.permit || 'N/A'}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${row.parameter || 'N/A'}</td>
                    <td>${row.value !== null && row.value !== undefined ? row.value : 'N/A'}</td>
                    <td>${row.unit || 'N/A'}</td>
                    <td>${formatDateTime(row.measurementTime)}</td>
                    <td>${formatDelay(delayMinutes)}</td>
                    <td>${createStatusBadge(delayMinutes)}</td>
                `;
            }
            
            tbody.appendChild(tr);
        });
    });
}

/**
 * Initialize page
 */
async function initializePage() {
    console.log('🚀 Initializing databtn page...');
    
    // Fetch Telegram configuration first (this loads all settings)
    await fetchTelegramConfig();
    
    console.log('⚙️ Setting up sidebar filter expandable menu...');
    
    // Setup sidebar filter expandable menu
    const databtnMenuExpandable = document.getElementById('databtn-menu-expandable');
    const databtnBtn = document.getElementById('databtn-btn');
    const databtnExpandArrow = document.getElementById('databtn-expand-arrow');
    const databtnFilterContent = document.getElementById('databtn-filter-content');
    
    if (databtnMenuExpandable && databtnBtn && databtnFilterContent) {
        console.log('Setting up dropdown toggle...');
        
        // Expand filter on databtn page by default
        databtnMenuExpandable.classList.add('expanded');
        databtnFilterContent.classList.add('active');
        
        // Toggle filter dropdown when clicking the menu item
        const toggleDropdown = function(e) {
            console.log('Dropdown clicked!');
            e.preventDefault();
            e.stopPropagation();
            
            // Toggle expanded state
            const isExpanded = databtnMenuExpandable.classList.contains('expanded');
            console.log('Current state:', isExpanded ? 'expanded' : 'collapsed');
            
            if (isExpanded) {
                databtnMenuExpandable.classList.remove('expanded');
                databtnFilterContent.classList.remove('active');
                console.log('Collapsing dropdown');
            } else {
                databtnMenuExpandable.classList.add('expanded');
                databtnFilterContent.classList.add('active');
                console.log('Expanding dropdown');
            }
        };
        
        databtnBtn.addEventListener('click', toggleDropdown);
        
        // Also allow clicking on the arrow or the entire expandable area
        if (databtnExpandArrow) {
            databtnExpandArrow.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                toggleDropdown(e);
            });
        }
    } else {
        console.error('Dropdown elements not found:', {
            databtnMenuExpandable: !!databtnMenuExpandable,
            databtnBtn: !!databtnBtn,
            databtnFilterContent: !!databtnFilterContent
        });
    }
    
    // Setup scroll and resize handlers for dropdowns
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        tableContainer.addEventListener('scroll', closeAllDropdowns);
    }
    window.addEventListener('resize', closeAllDropdowns);
    
    // Load initial data
    console.log('📊 Loading initial data...');
    fetchData();
    
    // Setup auto refresh
    setupAutoRefresh();
    
    // Setup status check interval for periodic alerts
    setupStatusCheckInterval();
    
    console.log('✅ Databtn page initialization complete');
}

/**
 * Setup Telegram configuration modal
 */
function setupTelegramConfigModal() {
    const telegramConfigBtn = document.getElementById('telegram-config-btn');
    const telegramConfigModal = document.getElementById('telegram-config-modal');
    const closeTelegramConfig = document.getElementById('close-telegram-config');
    const cancelTelegramConfig = document.getElementById('cancel-telegram-config');
    const telegramConfigForm = document.getElementById('telegram-config-form');
    const telegramConfigError = document.getElementById('telegram-config-error');
    const testTelegramBtn = document.getElementById('test-telegram-btn');
    
    // Open modal
    if (telegramConfigBtn) {
        telegramConfigBtn.addEventListener('click', async function() {
            // Load current config
            await loadTelegramConfigToModal();
            telegramConfigModal.style.display = 'flex';
        });
    }
    
    // Test Telegram button
    if (testTelegramBtn) {
        testTelegramBtn.addEventListener('click', async function() {
            await testTelegramConnection();
        });
    }
    
    // Close modal handlers
    [closeTelegramConfig, cancelTelegramConfig].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', function() {
                telegramConfigModal.style.display = 'none';
                telegramConfigError.textContent = '';
                const testResult = document.getElementById('test-telegram-result');
                if (testResult) testResult.textContent = '';
            });
        }
    });
    
    // Close on outside click
    telegramConfigModal?.addEventListener('click', function(e) {
        if (e.target === telegramConfigModal) {
            telegramConfigModal.style.display = 'none';
            telegramConfigError.textContent = '';
            const testResult = document.getElementById('test-telegram-result');
            if (testResult) testResult.textContent = '';
        }
    });
    
    // Handle form submit
    if (telegramConfigForm) {
        telegramConfigForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await saveTelegramConfig();
        });
    }
}

/**
 * Load Telegram config to modal
 */
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
                const chatIdInput = document.getElementById('telegram-chat-id');
                const refreshIntervalInput = document.getElementById('telegram-refresh-interval');
                const delayThresholdInput = document.getElementById('telegram-delay-threshold');
                const alertRepeatInput = document.getElementById('telegram-alert-repeat');
                
                if (enabledCheckbox) enabledCheckbox.checked = data.config.enabled;
                if (chatIdInput) chatIdInput.value = data.config.chatId || '';
                if (refreshIntervalInput) refreshIntervalInput.value = data.config.refreshInterval || 15;
                if (delayThresholdInput) delayThresholdInput.value = data.config.delayThreshold || 60;
                if (alertRepeatInput) alertRepeatInput.value = data.config.alertRepeatInterval || 1;
            }
        }
    } catch (error) {
        console.error('Error loading Telegram config:', error);
    }
}

/**
 * Save Telegram config
 */
async function saveTelegramConfig() {
    const enabledCheckbox = document.getElementById('telegram-enabled');
    const chatIdInput = document.getElementById('telegram-chat-id');
    const refreshIntervalInput = document.getElementById('telegram-refresh-interval');
    const delayThresholdInput = document.getElementById('telegram-delay-threshold');
    const alertRepeatInput = document.getElementById('telegram-alert-repeat');
    const telegramConfigError = document.getElementById('telegram-config-error');
    const telegramConfigModal = document.getElementById('telegram-config-modal');
    
    try {
        telegramConfigError.textContent = '';
        
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('Chưa đăng nhập');
        }
        
        const enabled = enabledCheckbox.checked;
        const chatId = chatIdInput.value.trim();
        const refreshInterval = parseInt(refreshIntervalInput.value);
        const delayThreshold = parseInt(delayThresholdInput.value);
        const alertRepeat = parseInt(alertRepeatInput.value);
        
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
        
        if (isNaN(alertRepeat) || alertRepeat < 1) {
            throw new Error('Chu kỳ nhắc lại cảnh báo tối thiểu là 1 phút');
        }
        
        const response = await fetch('/api/telegram/config', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                enabled: enabled,
                chatId: chatId,
                refreshInterval: refreshInterval,
                delayThreshold: delayThreshold,
                alertRepeatInterval: alertRepeat
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Không thể lưu cấu hình');
        }
        
        // Update local config
        telegramConfig = data.config;
        refreshIntervalMinutes = refreshInterval;
        delayThresholdMinutes = delayThreshold;
        alertRepeatIntervalMinutes = alertRepeat;
        
        // Restart intervals with new settings
        setupAutoRefresh();
        setupStatusCheckInterval();
        
        // Re-render table with new threshold
        renderTable();
        
        // Close modal
        telegramConfigModal.style.display = 'none';
        
        // Show success message
        alert('Đã lưu cấu hình Telegram thành công!');
        
    } catch (error) {
        console.error('Error saving Telegram config:', error);
        telegramConfigError.textContent = error.message || 'Không thể lưu cấu hình';
    }
}

/**
 * Test Telegram connection
 */
async function testTelegramConnection() {
    const chatIdInput = document.getElementById('telegram-chat-id');
    const testResult = document.getElementById('test-telegram-result');
    const testBtn = document.getElementById('test-telegram-btn');
    const telegramConfigError = document.getElementById('telegram-config-error');
    
    try {
        telegramConfigError.textContent = '';
        testResult.textContent = '';
        testResult.style.color = '#6b7280';
        
        const chatId = chatIdInput.value.trim();
        
        if (!chatId) {
            throw new Error('Vui lòng nhập Chat ID trước khi test');
        }
        
        // Disable button while testing
        testBtn.disabled = true;
        testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Đang gửi...';
        testResult.textContent = '⏳ Đang gửi tin nhắn test...';
        
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
        testResult.textContent = '✅ ' + data.message;
        testResult.style.color = '#059669';
        
    } catch (error) {
        console.error('Error testing Telegram:', error);
        testResult.textContent = '❌ ' + (error.message || 'Không thể gửi tin nhắn test');
        testResult.style.color = '#dc2626';
    } finally {
        // Re-enable button
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Gửi tin nhắn test';
        }
    }
}

// Initialize Telegram modal after header is loaded
function initializeTelegramModal() {
    // Wait for header to be loaded (telegram button is in the header)
    if (document.getElementById('telegram-config-btn')) {
        setupTelegramConfigModal();
    } else {
        // If telegram button doesn't exist yet, wait for headerLoaded event
        document.addEventListener('headerLoaded', function() {
            setupTelegramConfigModal();
        }, { once: true });
    }
}

// Call initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTelegramModal);
} else {
    initializeTelegramModal();
}

// Export for manual initialization after auth
window.initializeDataPage = initializePage;
