// Databtn.js - Hiển thị dữ liệu giấy phép từ API

let currentData = [];
let lastUpdateTime = null;
let allPermits = []; // Danh sách tất cả giấy phép
let autoRefreshInterval = null; // Auto refresh timer
let statusCheckInterval = null; // Status check timer for Telegram alerts
let refreshIntervalMinutes = 15; // Default 15 minutes (from Telegram config)
let delayThresholdMinutes = 60; // Default 60 minutes (from Telegram config)
let alertCooldownMinutes = 5; // Default 5 minutes (from Telegram config)

// Telegram alert tracking
let stationStatusMap = {}; // Track previous status of each station
let lastAlertTime = {}; // Track last alert time for each station
let telegramConfig = null; // Telegram configuration

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
    const statusText = isOnline ? '✅ Online' : '❌ Mất kết nối';
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
                telegramConfig = data.config;
                
                // Load configuration values
                if (telegramConfig.refreshInterval) {
                    refreshIntervalMinutes = Math.max(15, parseInt(telegramConfig.refreshInterval));
                }
                if (telegramConfig.delayThreshold) {
                    delayThresholdMinutes = Math.max(1, parseInt(telegramConfig.delayThreshold));
                }
                if (telegramConfig.alertCooldown) {
                    alertCooldownMinutes = Math.max(1, parseInt(telegramConfig.alertCooldown));
                }
                
                // Setup status check interval after loading config
                setupStatusCheckInterval();
            }
        }
    } catch (error) {
        console.error('Error fetching Telegram config:', error);
    }
}

/**
 * Send Telegram alert for station status change
 */
async function sendTelegramAlert(station, status, measurementTime, delayMinutes) {
    try {
        // Check if Telegram is enabled
        if (!telegramConfig || !telegramConfig.enabled) {
            return;
        }
        
        // Check cooldown period
        const now = Date.now();
        const lastAlert = lastAlertTime[station];
        const cooldownMs = alertCooldownMinutes * 60 * 1000;
        if (lastAlert && (now - lastAlert) < cooldownMs) {
            console.log(`⏳ Skipping alert for ${station} - cooldown period`);
            return;
        }
        
        // Send alert
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
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
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                console.log(`✅ Sent Telegram alert for ${station}: ${status}`);
                lastAlertTime[station] = now;
            }
        }
    } catch (error) {
        console.error('Error sending Telegram alert:', error);
    }
}

/**
 * Check and send alerts for station status changes
 * This recalculates delays based on current time
 */
function checkStationStatusChanges() {
    if (!telegramConfig || !telegramConfig.enabled) {
        return;
    }
    
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
    
    // Check each station for status changes
    Object.values(stationData).forEach(data => {
        const station = data.station;
        const isOnline = data.delayMinutes <= delayThresholdMinutes;
        const currentStatus = isOnline ? 'online' : 'offline';
        const previousStatus = stationStatusMap[station];
        const measurementTime = data.measurementTime; // Get measurement time
        const delayMinutes = data.delayMinutes; // Get delay in minutes
        
        // If this is the first time seeing this station
        if (previousStatus === undefined) {
            // If station is offline on first check, send alert
            if (currentStatus === 'offline') {
                console.log(`🔔 Station ${station} is offline (initial check)`);
                sendTelegramAlert(station, 'offline', measurementTime, delayMinutes);
            }
        }
        // If status changed from online to offline, send alert
        else if (previousStatus === 'online' && currentStatus === 'offline') {
            console.log(`🔔 Station ${station} went offline`);
            sendTelegramAlert(station, 'offline', measurementTime, delayMinutes);
        }
        // If status changed from offline to online, send alert
        else if (previousStatus === 'offline' && currentStatus === 'online') {
            console.log(`🔔 Station ${station} came back online`);
            sendTelegramAlert(station, 'online', measurementTime, delayMinutes);
        }
        
        // Update status map
        stationStatusMap[station] = currentStatus;
    });
}

/**
 * Setup periodic status checking for Telegram alerts
 * This runs independently of data fetching to catch status changes in real-time
 */
function setupStatusCheckInterval() {
    // Clear existing interval
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    
    // Only setup if Telegram is enabled
    if (!telegramConfig || !telegramConfig.enabled) {
        return;
    }
    
    // Check status every alertCooldownMinutes
    statusCheckInterval = setInterval(() => {
        if (telegramConfig && telegramConfig.enabled && currentData.length > 0) {
            console.log('⏰ Running periodic status check...');
            checkStationStatusChanges();
        }
    }, alertCooldownMinutes * 60 * 1000);
    
    console.log(`✅ Status check interval set to ${alertCooldownMinutes} minutes`);
}

/**
 * Setup auto refresh
 */
function setupAutoRefresh() {
    // Clear existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Set new interval (convert minutes to milliseconds)
    autoRefreshInterval = setInterval(() => {
        fetchData();
    }, refreshIntervalMinutes * 60 * 1000);
    
    console.log(`✅ Auto refresh set to ${refreshIntervalMinutes} minutes`);
}

/**
 * Fetch data from API
 */
async function fetchData() {
    try {
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
    currentData.forEach(row => {
        if (row.permit) {
            permitSet.add(row.permit);
        }
    });
    allPermits = Array.from(permitSet).sort();
    updatePermitFilter();
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
    if (!permitCheckboxes) return currentData;
    
    let filteredData = currentData;
    
    // Filter by offline status first
    if (offlineCheckbox && offlineCheckbox.checked) {
        filteredData = filteredData.filter(row => {
            const delayMinutes = row.delayMinutes || 0;
            return delayMinutes > delayThresholdMinutes; // Offline if delay > threshold
        });
    }
    
    const allCheckbox = document.getElementById('permit-all');
    
    // If "Tất cả" is checked, return filtered data
    if (allCheckbox && allCheckbox.checked) {
        return filteredData;
    }
    
    // Get selected permits
    const selectedPermits = [];
    const permitCheckboxList = permitCheckboxes.querySelectorAll('.permit-checkbox:checked');
    permitCheckboxList.forEach(cb => {
        selectedPermits.push(cb.value);
    });
    
    // If no permits selected, return empty
    if (selectedPermits.length === 0) {
        return [];
    }
    
    // Filter data by selected permits
    return filteredData.filter(row => selectedPermits.includes(row.permit));
}

/**
 * Render table with data
 */
function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    
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
        
        // Data rows for this station
        rows.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.className = colorClass;
            
            const delayMinutes = row.delayMinutes || 0;
            
            // STT: chỉ hiển thị ở dòng đầu tiên của mỗi trạm
            const sttContent = index === 0 ? stationNumber : '';
            
            // Tên trạm: chỉ hiển thị ở dòng đầu tiên
            const stationContent = index === 0 ? (row.station || 'N/A') : '';
            
            // Giấy phép: chỉ hiển thị ở dòng đầu tiên
            const permitContent = index === 0 ? (row.permit || 'N/A') : '';
            
            tr.innerHTML = `
                <td>${sttContent}</td>
                <td>${stationContent}</td>
                <td>${row.parameter || 'N/A'}</td>
                <td>${row.value !== null && row.value !== undefined ? row.value : 'N/A'}</td>
                <td>${row.unit || 'N/A'}</td>
                <td>${formatDateTime(row.measurementTime)}</td>
                <td>${formatDelay(delayMinutes)}</td>
                <td>${createStatusBadge(delayMinutes)}</td>
                <td>${permitContent}</td>
            `;
            
            tbody.appendChild(tr);
        });
    });
}

/**
 * Initialize page
 */
async function initializePage() {
    // Fetch Telegram configuration first (this loads all settings)
    await fetchTelegramConfig();
    
    // Setup sidebar filter expandable menu
    const databtnMenuExpandable = document.getElementById('databtn-menu-expandable');
    const databtnBtn = document.getElementById('databtn-btn');
    const databtnExpandArrow = document.getElementById('databtn-expand-arrow');
    const databtnFilterContent = document.getElementById('databtn-filter-content');
    
    if (databtnBtn && databtnFilterContent) {
        // Expand filter on databtn page by default
        databtnMenuExpandable.classList.add('expanded');
        databtnFilterContent.classList.add('active');
        
        // Toggle filter dropdown
        databtnBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            databtnMenuExpandable.classList.toggle('expanded');
            databtnFilterContent.classList.toggle('active');
        });
    }
    

    
    // Load initial data
    fetchData();
    
    // Setup auto refresh
    setupAutoRefresh();
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
                const alertCooldownInput = document.getElementById('telegram-alert-cooldown');
                
                if (enabledCheckbox) enabledCheckbox.checked = data.config.enabled;
                if (chatIdInput) chatIdInput.value = data.config.chatId || '';
                if (refreshIntervalInput) refreshIntervalInput.value = data.config.refreshInterval || 15;
                if (delayThresholdInput) delayThresholdInput.value = data.config.delayThreshold || 60;
                if (alertCooldownInput) alertCooldownInput.value = data.config.alertCooldown || 5;
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
    const alertCooldownInput = document.getElementById('telegram-alert-cooldown');
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
        const alertCooldown = parseInt(alertCooldownInput.value);
        
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
        
        if (isNaN(alertCooldown) || alertCooldown < 1) {
            throw new Error('Chu kỳ cảnh báo tối thiểu là 1 phút');
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
                alertCooldown: alertCooldown
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
        alertCooldownMinutes = alertCooldown;
        
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

// Initialize Telegram modal when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTelegramConfigModal);
} else {
    setupTelegramConfigModal();
}

// Export for manual initialization after auth
window.initializeDataPage = initializePage;
