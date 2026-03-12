// Databtn.js - Hiển thị dữ liệu giấy phép từ API

let currentData = [];
let lastUpdateTime = null;
let allPermits = []; // Danh sách tất cả giấy phép
let autoRefreshInterval = null; // Auto refresh timer
let statusCheckInterval = null; // Status check timer for periodic alerts
let refreshIntervalMinutes = 15; // Default 15 minutes (from Telegram config)
let delayThresholdMinutes = 60; // Default 60 minutes (from Telegram config)
let alertRepeatIntervalMinutes = 60; // Default 60 minutes - repeat offline alerts (changed from 1 to 60)
let hasLoadedDataOnce = false; // Đánh dấu đã tải dữ liệu từ API ít nhất 1 lần

// Table header filters
let allStations = []; // Danh sách tất cả tên trạm
let selectedStations = new Set(); // Các trạm được chọn
let selectedPermits = new Set(); // Các giấy phép được chọn
let selectedStatuses = new Set(['online', 'offline']); // Các trạng thái được chọn

// Telegram alert tracking
let stationStatusMap = {}; // Track previous status of each station
let telegramConfig = null; // Telegram configuration
let pendingOfflineAlerts = new Set(); // Track in-flight station alerts to prevent duplicate sends
let isStatusCheckRunning = false; // Prevent overlapping status checks
const ALERT_HISTORY_KEY = 'telegram_alert_history'; // localStorage key for alert history

/**
 * Format timestamp to Vietnamese date/time (Vietnam timezone)
 */
function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * Format value to dd/MM/yyyy HH:mm:ss for history popup (Vietnam timezone).
 */
function formatHistoryPopupDateTime(value) {
    if (!value) return 'N/A';

    let date = null;

    if (typeof value === 'number' && Number.isFinite(value)) {
        date = new Date(value);
    } else if (typeof value === 'string') {
        const trimmedValue = value.trim();
        const normalizedValue = trimmedValue.replace(',', '');
        const localDateMatch = normalizedValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);

        if (localDateMatch) {
            const [, day, month, year, hour, minute, second] = localDateMatch;
            date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
        } else {
            const parsedMs = getMeasurementTimestampMs(trimmedValue);
            if (parsedMs !== null) {
                date = new Date(parsedMs);
            }
        }
    }

    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 'N/A';
    }

    // Format theo múi giờ Việt Nam (UTC+7)
    return date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/\//g, '/').replace(',', '');
}

/**
 * Resolve a valid timestamp for history popup rows.
 */
function getValidHistoryTimestampMs(row) {
    if (!row) return null;

    const nowMs = Date.now();

    const candidateValues = [row.timestamp, row.measurementTime, row.time];

    for (const value of candidateValues) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value > 0 && value <= nowMs) {
                return value;
            }
            continue;
        }

        if (typeof value === 'string') {
            const trimmedValue = value.trim();
            if (!trimmedValue || trimmedValue.toUpperCase() === 'N/A') {
                continue;
            }

            const normalizedValue = trimmedValue.replace(',', '');
            const localDateMatch = normalizedValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);

            if (localDateMatch) {
                const [, day, month, year, hour, minute, second] = localDateMatch;
                const localMs = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
                if (!Number.isNaN(localMs) && localMs > 0 && localMs <= nowMs) {
                    return localMs;
                }
            }

            const parsedMs = getMeasurementTimestampMs(trimmedValue);
            if (parsedMs !== null && parsedMs > 0 && parsedMs <= nowMs) {
                return parsedMs;
            }
        }
    }

    return null;
}

/**
 * Filter history rows to only those with a valid timestamp.
 */
function getValidHistoryRows(data) {
    return (data || [])
        .map(row => {
            const validTimestampMs = getValidHistoryTimestampMs(row);
            return validTimestampMs === null
                ? null
                : {
                    ...row,
                    validTimestampMs
                };
        })
        .filter(Boolean);
}

/**
 * Update history modal header from MONRE data.
 */
function updateHistoryModalHeader(data, fallbackStationName) {
    const modalTitle = document.getElementById('history-modal-title');
    const stationInfoEl = document.getElementById('history-modal-station-info');
    const timeRangeEl = document.getElementById('history-modal-time-range');

    if (modalTitle) {
        modalTitle.textContent = 'LỊCH SỬ DỮ LIỆU';
    }

    const stationName = data[0]?.station_name || data[0]?.station || fallbackStationName || 'N/A';
    const projectName = data[0]?.project || 'N/A';

    if (stationInfoEl) {
        stationInfoEl.textContent = `Công trình: ${projectName} - Trạm quan trắc: ${stationName}`;
    }

    if (timeRangeEl) {
        if (data.length === 0) {
            timeRangeEl.textContent = 'Từ thời điểm: N/A - Đến thời điểm: N/A';
            return;
        }

        const sortedRows = [...data].sort((a, b) => a.validTimestampMs - b.validTimestampMs);
        const fromTime = formatHistoryPopupDateTime(sortedRows[0].validTimestampMs);
        const toTime = formatHistoryPopupDateTime(sortedRows[sortedRows.length - 1].validTimestampMs);
        timeRangeEl.textContent = `Từ thời điểm: ${fromTime} - Đến thời điểm: ${toTime}`;
    }
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
 * Tính độ trễ (phút) theo thời gian đo và thời gian hiện tại.
 * Ưu tiên measurementTime; nếu không hợp lệ thì fallback về row.delayMinutes hoặc 0.
 */
function getEffectiveDelayMinutes(row) {
    const nowMs = Date.now();

    if (row && row.measurementTime) {
        let measurementMs = null;

        if (typeof row.measurementTime === 'number') {
            measurementMs = row.measurementTime;
        } else {
            const parsed = Date.parse(row.measurementTime);
            if (!Number.isNaN(parsed)) {
                measurementMs = parsed;
            }
        }

        if (measurementMs !== null && measurementMs <= nowMs) {
            const diffMinutes = Math.floor((nowMs - measurementMs) / (1000 * 60));
            if (diffMinutes >= 0) return diffMinutes;
        }
    }

    // Fallback: dùng delayMinutes từ API nếu có, ngược lại 0
    if (row && typeof row.delayMinutes === 'number' && isFinite(row.delayMinutes) && row.delayMinutes >= 0) {
        return row.delayMinutes;
    }

    return 0;
}

/**
 * Parse measurement time to timestamp milliseconds.
 */
function getMeasurementTimestampMs(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build station status for Telegram from the latest measurement of each station.
 */
function buildStationStatusData(rows) {
    const stationData = {};

    rows.forEach(row => {
        const station = row.station || 'N/A';
        const effectiveDelay = getEffectiveDelayMinutes(row);
        const rowTimestampMs = getMeasurementTimestampMs(row?.measurementTime);
        const existing = stationData[station];

        if (!existing) {
            stationData[station] = {
                station,
                delayMinutes: effectiveDelay,
                measurementTime: row.measurementTime,
                rowTimestampMs,
                permit: row.permit || null
            };
            return;
        }

        const hasNewerMeasurement = rowTimestampMs !== null && (existing.rowTimestampMs === null || rowTimestampMs > existing.rowTimestampMs);
        const useLowerDelayFallback = rowTimestampMs === null && existing.rowTimestampMs === null && effectiveDelay < existing.delayMinutes;

        if (hasNewerMeasurement || useLowerDelayFallback) {
            stationData[station] = {
                station,
                delayMinutes: effectiveDelay,
                measurementTime: row.measurementTime,
                rowTimestampMs,
                permit: row.permit || existing.permit || null
            };
        }
    });

    return stationData;
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
    const dataWrapper = document.getElementById('data-wrapper');
    
    if (loading) loading.style.display = 'block';
    if (errorMessage) errorMessage.style.display = 'none';
    if (dataWrapper) dataWrapper.style.display = 'none';
    if (tableBody) tableBody.innerHTML = '';
}

/**
 * Hide loading state
 */
function hideLoading() {
    const loading = document.getElementById('loading');
    const dataWrapper = document.getElementById('data-wrapper');
    if (loading) loading.style.display = 'none';
    if (dataWrapper) dataWrapper.style.display = 'block';
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
                    console.log(`🔔 Alert repeat interval updated to: ${alertRepeatIntervalMinutes} minutes`);
                }
                
                console.log('✅ Telegram config loaded:', {
                    enabled: telegramConfig.enabled,
                    refreshInterval: refreshIntervalMinutes + ' min',
                    delayThreshold: delayThresholdMinutes + ' min',
                    alertRepeatInterval: alertRepeatIntervalMinutes + ' min'
                });
                
                // Log current alert history size
                const history = getAlertHistory();
                console.log(`📝 Current alert history: ${Object.keys(history).length} stations tracked`);
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
 * Clear alert history for a specific station or all stations
 * Usage from browser console:
 *   - clearAlertHistory('QT1NM2') - clear for specific station
 *   - clearAlertHistory() - clear all
 */
function clearAlertHistory(stationName = null) {
    try {
        if (stationName) {
            const history = getAlertHistory();
            if (history[stationName]) {
                delete history[stationName];
                saveAlertHistory(history);
                console.log(`✅ Cleared alert history for station: ${stationName}`);
                console.log(`   ℹ️  Next check will immediately send alert if station is offline`);
            } else {
                console.log(`⚠️  No alert history found for station: ${stationName}`);
            }
        } else {
            localStorage.removeItem(ALERT_HISTORY_KEY);
            console.log('✅ Cleared all alert history');
            console.log(`   ℹ️  Next check will treat all stations as new and send alerts for offline stations`);
        }
    } catch (error) {
        console.error('❌ Error clearing alert history:', error);
    }
}

/**
 * View alert history from console
 * Usage: viewAlertHistory() or viewAlertHistory('QT1NM2')
 */
function viewAlertHistory(stationName = null) {
    const history = getAlertHistory();
    if (stationName) {
        if (history[stationName]) {
            const info = history[stationName];
            const lastAlertTime = new Date(info.lastAlertTime);
            const minutesAgo = (Date.now() - info.lastAlertTime) / (1000 * 60);
            console.log(`📊 Alert history for ${stationName}:`, {
                lastAlertStatus: info.lastAlertStatus,
                lastAlertTime: lastAlertTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
                minutesAgo: minutesAgo.toFixed(2) + ' minutes ago',
                nextAlertAfter: alertRepeatIntervalMinutes + ' minutes from last alert',
                canSendNow: minutesAgo >= alertRepeatIntervalMinutes
            });
        } else {
            console.log(`ℹ️  No alert history for station: ${stationName}`);
        }
    } else {
        console.log(`📚 Alert history (${Object.keys(history).length} stations):`, history);
        console.log(`\n💡 TIP: Use viewAlertHistory('STATION_NAME') to see details for specific station`);
        console.log(`💡 TIP: Use clearAlertHistory('STATION_NAME') to reset a station's alert timer`);
        console.log(`💡 TIP: Use clearAlertHistory() to reset all alert timers`);
    }
}

// Make functions available globally for console access
window.clearAlertHistory = clearAlertHistory;
window.viewAlertHistory = viewAlertHistory;

/**
 * Check if should send alert for station.
 * Condition: station is offline (chưa gửi dữ liệu) AND current VN time (minutes from midnight)
 * is divisible by alertRepeatIntervalMinutes.
 * Returns: { shouldSend: boolean, reason: string }
 */
function shouldSendAlert(station, newStatus, delayMinutes) {
    console.log(`🔍 shouldSendAlert check for ${station}:`, {
        newStatus,
        delayMinutes,
        alertRepeatIntervalMinutes
    });

    if (newStatus !== 'offline') {
        console.log(`ℹ️ ${station}: Online, no alert needed`);
        return { shouldSend: false, reason: 'online' };
    }

    // Check if current Vietnam time (minutes from midnight) is divisible by alertRepeatInterval
    const now = new Date();
    const vnTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit' });
    const [hours, minutes] = vnTimeStr.split(':').map(Number);
    const minutesFromMidnight = hours * 60 + minutes;
    const isRepeatTime = alertRepeatIntervalMinutes > 0 && (minutesFromMidnight % alertRepeatIntervalMinutes === 0);

    console.log(`📊 ${station} time check:`, {
        vnTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        minutesFromMidnight,
        alertRepeatIntervalMinutes,
        isRepeatTime
    });

    if (isRepeatTime) {
        // Check alert history to prevent duplicate sends within the same minute
        const history = getAlertHistory();
        const lastAlert = history[station];
        if (lastAlert && lastAlert.lastAlertStatus === 'offline') {
            const msSinceLast = now.getTime() - lastAlert.lastAlertTime;
            // If alert was sent less than 2 minutes ago, skip (same cycle)
            if (msSinceLast < 2 * 60 * 1000) {
                console.log(`⏭️ ${station}: Already alerted ${(msSinceLast / 1000).toFixed(0)}s ago, skip duplicate`);
                return { shouldSend: false, reason: 'duplicate_in_cycle' };
            }
        }
        console.log(`✅ ${station}: Offline + current time divisible by ${alertRepeatIntervalMinutes} min → send alert`);
        return { shouldSend: true, reason: 'offline_repeat_time' };
    }

    console.log(`⏭️ ${station}: Offline but current time not divisible by ${alertRepeatIntervalMinutes} min`);
    return { shouldSend: false, reason: 'not_repeat_time' };
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
async function sendTelegramAlert(station, status, measurementTime, delayMinutes, permit, reason = '') {
    const alertKey = `${station}:${status}`;

    try {
        console.log(`📤 sendTelegramAlert called for ${station}:`, { status, delayMinutes, reason });

        if (pendingOfflineAlerts.has(alertKey)) {
            console.log(`⏭️ Alert already in flight for ${alertKey}, skipping duplicate request`);
            return;
        }

        pendingOfflineAlerts.add(alertKey);
        
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
                delayMinutes: delayMinutes,
                permit: permit || null
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
    } finally {
        pendingOfflineAlerts.delete(alertKey);
    }
}

/**
 * Check and send alerts for station status changes
 * This recalculates delays based on current time
 */
async function checkStationStatusChanges() {
    console.log(`\n🔔 ===== checkStationStatusChanges called at ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} =====`);

    if (isStatusCheckRunning) {
        console.log('⏭️ Previous status check is still running, skip overlapping run');
        return;
    }
    
    if (!telegramConfig || !telegramConfig.enabled) {
        console.log(`❌ Telegram not enabled, skipping status check`);
        return;
    }

    if (!hasLoadedDataOnce) {
        console.log('⏭️ Skipping status check: data has not been loaded from API yet');
        return;
    }

    const sourceData = currentData;

    if (!sourceData || sourceData.length === 0) {
        console.log('⚠️ No data available for status check');
        return;
    }

    console.log(`✅ Telegram enabled, checking ${sourceData.length} data points`);

    isStatusCheckRunning = true;

    try {
        // Group by station, find newest measurement per station
        const stationData = buildStationStatusData(sourceData);

        const stationCount = Object.keys(stationData).length;
        const offlineStations = Object.values(stationData)
            .filter(s => s.delayMinutes > delayThresholdMinutes)
            .map(s => ({ station: s.station, delayMinutes: s.delayMinutes }));

        console.log(`📊 Grouped into ${stationCount} stations, chưa gửi dữ liệu: ${offlineStations.length}`);

        // Check each station - send alert if offline and current time divisible by repeat interval
        for (const data of Object.values(stationData)) {
            const station = data.station;
            const isOnline = data.delayMinutes <= delayThresholdMinutes;
            const currentStatus = isOnline ? 'online' : 'offline';
            const measurementTime = data.measurementTime;
            const delayMinutes = data.delayMinutes;
            const permit = data.permit || null;

            // Only alert for offline stations (chưa gửi dữ liệu)
            if (currentStatus === 'offline') {
                await sendTelegramAlert(station, 'offline', measurementTime, delayMinutes, permit, 'offline_check');
            }

            stationStatusMap[station] = currentStatus;
        }
    } finally {
        isStatusCheckRunning = false;
    }
    
    console.log(`===== End checkStationStatusChanges =====\n`);
}

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
        console.log('   Telegram config:', telegramConfig);
        return;
    }
    
    // Fixed check interval: 1 minute (check frequently to detect changes quickly)
    // The alert repeat interval (alertRepeatIntervalMinutes) is used separately in shouldSendAlert()
    const CHECK_INTERVAL_MINUTES = 1;
    const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;
    
    console.log(`⚙️ Setting up status check interval: ${CHECK_INTERVAL_MINUTES} minute(s)`);
    console.log(`   Alert repeat interval: ${alertRepeatIntervalMinutes} minute(s)`);
    console.log(`   Telegram enabled: ${telegramConfig.enabled}`);
    console.log(`   Telegram chatId: ${telegramConfig.chatId}`);
    
    // Set new interval for status checks (convert minutes to milliseconds)
    statusCheckInterval = setInterval(() => {
        console.log('⏰ Periodic status check triggered at', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
        console.log('   Current data length:', currentData?.length || 0);
        console.log('   Has loaded data once:', hasLoadedDataOnce);
        void checkStationStatusChanges();
    }, intervalMs);
    
    console.log(`✅ Status check interval set to ${CHECK_INTERVAL_MINUTES} minute(s)`);
    console.log(`📅 Next check will run at: ${new Date(Date.now() + intervalMs).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
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
        
        const response = await fetch(`/api/permit-data?_t=${Date.now()}`, {
            cache: 'no-store',
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
        
        // Extract unique permits for filter (MUST be called before setting hasLoadedDataOnce)
        extractPermits();
        
        // Mark as loaded after extractPermits so initialization logic works correctly
        hasLoadedDataOnce = true;
        
        console.log(`📊 Fetched ${currentData.length} data points`);
        
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
    
    // Initialize selections ONLY on first load (when hasLoadedDataOnce is false)
    // This allows user to deselect all items without auto-resetting
    if (!hasLoadedDataOnce) {
        // No longer filtering by station - removed selectedStations initialization
        if (selectedPermits.size === 0) {
            selectedPermits = new Set(allPermits);
        }
    }
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
            <th>TÊN TRẠM</th>
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
    
    // Add search box for permit filter
    if (filterType === 'permit') {
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
        
        // Check if THIS dropdown is currently open BEFORE any modifications
        const isOpen = dropdown.classList.contains('show');
        
        // Check if any other dropdown is open
        const otherDropdownWasOpen = Array.from(document.querySelectorAll('.th-filter-dropdown.show'))
            .some(d => d !== dropdown);
        
        // Close all dropdowns
        document.querySelectorAll('.th-filter-dropdown.show').forEach(d => {
            d.classList.remove('show');
        });
        document.querySelectorAll('.th-filter-button.active').forEach(b => {
            b.classList.remove('active');
        });
        
        // Re-render if closing another dropdown to apply its filters
        if (otherDropdownWasOpen) {
            renderTable();
        }
        
        // Toggle current dropdown - if it was already open, keep it closed
        if (isOpen) {
            // Already open, so just keep it closed (already closed above)
            renderTable();
        } else {
            // Not open, so open it
            // Calculate position for fixed dropdown
            const buttonRect = button.getBoundingClientRect();
            const dropdownWidth = 250; // min-width from CSS

            // Position dropdown below button, centered (initial guess)
            dropdown.style.top = `${buttonRect.bottom + 8}px`;
            dropdown.style.left = `${buttonRect.left + (buttonRect.width / 2) - (dropdownWidth / 2)}px`;

            // Ensure dropdown stays within horizontal viewport
            const rightEdge = buttonRect.left + (buttonRect.width / 2) + (dropdownWidth / 2);
            if (rightEdge > window.innerWidth) {
                dropdown.style.left = `${window.innerWidth - dropdownWidth - 10}px`;
            }
            const leftEdge = buttonRect.left + (buttonRect.width / 2) - (dropdownWidth / 2);
            if (leftEdge < 0) {
                dropdown.style.left = '10px';
            }

            // Hiển thị tạm để đo chiều cao thực tế
            dropdown.classList.add('show');
            button.classList.add('active');

            const dropdownRect = dropdown.getBoundingClientRect();

            // Nếu dropdown bị tràn ra ngoài cạnh dưới màn hình (hay gặp trên mobile),
            // thì đẩy nó lên trên sao cho luôn nhìn thấy được toàn bộ
            if (dropdownRect.bottom > window.innerHeight - 10) {
                const newTop = Math.max(10, window.innerHeight - dropdownRect.height - 10);
                dropdown.style.top = `${newTop}px`;
            }

            // Nếu dropdown bị che phía trên (nằm sát mép trên), đẩy xuống một chút
            if (dropdownRect.top < 10) {
                dropdown.style.top = '10px';
            }
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
            // Get visible checkboxes (after search filter)
            const visibleCheckboxes = Array.from(checkboxes).filter(cb => {
                const option = cb.closest('.th-filter-option');
                return option && option.style.display !== 'none';
            });
            
            visibleCheckboxes.forEach(cb => {
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
            // Clear ALL items, not just visible ones
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
 * Filter data by selected permits and offline status
 */
function getFilteredData() {
    let filteredData = currentData;
    
    // ONLY use header dropdown filters (permit, status)
    // If selectedItems.size === 0, show nothing
    filteredData = filteredData.filter(row => {
        // Filter by permit - if none selected, show nothing
        if (selectedPermits.size === 0 || !selectedPermits.has(row.permit)) {
            return false;
        }
        
        // Filter by status - if none selected, show nothing
        const delayMinutes = getEffectiveDelayMinutes(row);
        const status = delayMinutes <= delayThresholdMinutes ? 'online' : 'offline';
        if (selectedStatuses.size === 0 || !selectedStatuses.has(status)) {
            return false;
        }
        
        return true;
    });
    
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
            
            // Độ trễ hiển thị: tính theo (thời gian đo → thời gian hiện tại)
            const delayMinutes = getEffectiveDelayMinutes(row);
            
            // For first row of station: add STT, TÊN TRẠM, and GIẤY PHÉP with rowspan
            // For subsequent rows: skip these columns (they are merged)
            if (index === 0) {
                tr.innerHTML = `
                    <td rowspan="${rowCount}">${stationNumber}</td>
                    <td rowspan="${rowCount}" class="station-name">${row.station || 'N/A'}</td>
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
    
    // Make station names clickable after rendering
    makeStationNamesClickable();
}

/**
 * Initialize page
 */
async function initializePage() {
    console.log('🚀 Initializing databtn page...');
    
    // Fetch Telegram configuration first (this loads all settings)
    await fetchTelegramConfig();
    
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
    
    // Setup station history modal
    setupStationHistoryModal();
    
    console.log('✅ Databtn page initialization complete');
}

// ============================================
// STATION HISTORY MODAL
// ============================================

/**
 * Open station history modal
 */
async function openStationHistoryModal(stationName) {
    const modal = document.getElementById('station-history-modal');
    const loading = document.getElementById('history-loading');
    const error = document.getElementById('history-error');
    const tableContainer = document.getElementById('history-table-container');
    const tableBody = document.getElementById('history-table-body');
    
    if (!modal) return;
    
    // Show modal
    modal.style.display = 'flex';
    
    updateHistoryModalHeader([], stationName);
    
    // Show loading
    if (loading) loading.style.display = 'block';
    if (error) error.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'none';
    if (tableBody) tableBody.innerHTML = '';
    
    try {
        // Fetch history data (last 7 days)
        const token = localStorage.getItem('authToken');
        if (!token) {
            throw new Error('Vui lòng đăng nhập lại');
        }
        
        const response = await fetch(`/api/station-history/${encodeURIComponent(stationName)}?days=7`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Không thể lấy dữ liệu lịch sử');
        }
        
        // Hide loading
        if (loading) loading.style.display = 'none';
        
        // Show table
        if (tableContainer) tableContainer.style.display = 'block';

        const validHistoryData = getValidHistoryRows(result.data);
        updateHistoryModalHeader(validHistoryData, stationName);
        
        // Render history data
        renderHistoryTable(validHistoryData);
        
    } catch (err) {
        console.error('Error fetching station history:', err);
        
        // Hide loading
        if (loading) loading.style.display = 'none';
        
        // Show error
        if (error) {
            error.textContent = err.message || 'Không thể lấy dữ liệu lịch sử';
            error.style.display = 'block';
        }
    }
}

/**
 * Render history data in table
 */
function renderHistoryTable(data) {
    const tableBody = document.getElementById('history-table-body');
    const tableHead = document.querySelector('#history-table thead');
    if (!tableBody || !tableHead) return;
    
    tableBody.innerHTML = '';

    const validHistoryData = getValidHistoryRows(data);

    if (data && validHistoryData.length !== data.length) {
        console.warn(`Skipped ${data.length - validHistoryData.length} history rows due to invalid MONRE timestamp`);
    }
    
    if (validHistoryData.length === 0) {
        // Reset header to default
        tableHead.innerHTML = `
            <tr>
                <th>STT</th>
                <th>Thời gian đo</th>
                <th>Thông số</th>
                <th>Giá trị</th>
                <th>Đơn vị</th>
            </tr>
        `;
        
        tableBody.innerHTML = `
            <tr>
                <td colspan="100" style="text-align: center; padding: 40px; color: #9ca3af;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; display: block; opacity: 0.5;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <div style="font-size: 14px; font-weight: 500;">Không có dữ liệu lịch sử hợp lệ</div>
                    <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Các bản ghi có timestamp không hợp lệ đã được bỏ qua</div>
                </td>
            </tr>
        `;
        return;
    }
    
    // Group data by timestamp
    const groupedByTime = {};
    const parameters = new Set();
    const parameterUnits = {}; // Store units for each parameter
    
    validHistoryData.forEach(row => {
        // Always normalize popup time to dd/MM/yyyy HH:mm:ss
        const timeKey = formatHistoryPopupDateTime(row.validTimestampMs);
        
        const paramName = row.parameter_name || row.parameter || '-';
        
        if (!groupedByTime[timeKey]) {
            groupedByTime[timeKey] = {
                timestamp: row.validTimestampMs,
                time: timeKey,
                parameters: {}
            };
        }
        
        groupedByTime[timeKey].parameters[paramName] = {
            value: row.value,
            unit: row.unit
        };
        
        parameters.add(paramName);
        
        // Store unit for this parameter
        if (row.unit && !parameterUnits[paramName]) {
            parameterUnits[paramName] = row.unit;
        }
    });
    
    // Convert to array and sort by timestamp descending
    const timePoints = Object.values(groupedByTime).sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
    });
    
    // Get sorted parameters list
    const sortedParams = Array.from(parameters).sort();
    
    // Create dynamic table header
    let headerHTML = '<tr><th>STT</th><th>Thời gian đo</th>';
    sortedParams.forEach(param => {
        const unit = parameterUnits[param] || '';
        const headerText = unit ? `${param}<br><span style="font-size: 11px; font-weight: 400;">(${unit})</span>` : param;
        headerHTML += `<th>${headerText}</th>`;
    });
    headerHTML += '</tr>';
    tableHead.innerHTML = headerHTML;
    
    // Render each time point as a row
    timePoints.forEach((timePoint, index) => {
        const tr = document.createElement('tr');
        
        let rowHTML = `
            <td>${index + 1}</td>
            <td>${timePoint.time}</td>
        `;
        
        // Add value for each parameter
        sortedParams.forEach(param => {
            const paramData = timePoint.parameters[param];
            
            if (paramData && paramData.value !== null && paramData.value !== undefined) {
                // Format value with proper number formatting
                let formattedValue = paramData.value;
                
                if (typeof paramData.value === 'number') {
                    // Check if it's a large number (>= 1000) to use thousand separator
                    if (Math.abs(paramData.value) >= 1000) {
                        formattedValue = paramData.value.toLocaleString('vi-VN', { 
                            minimumFractionDigits: 0, 
                            maximumFractionDigits: 2 
                        });
                    } else {
                        formattedValue = paramData.value.toLocaleString('vi-VN', { 
                            minimumFractionDigits: 0, 
                            maximumFractionDigits: 2 
                        });
                    }
                } else {
                    // Try to parse string as number
                    const numValue = parseFloat(paramData.value);
                    if (!isNaN(numValue)) {
                        if (Math.abs(numValue) >= 1000) {
                            formattedValue = numValue.toLocaleString('vi-VN', { 
                                minimumFractionDigits: 0, 
                                maximumFractionDigits: 2 
                            });
                        } else {
                            formattedValue = numValue.toLocaleString('vi-VN', { 
                                minimumFractionDigits: 0, 
                                maximumFractionDigits: 2 
                            });
                        }
                    }
                }
                
                rowHTML += `<td style="text-align: right;">${formattedValue}</td>`;
            } else {
                rowHTML += `<td style="text-align: center; color: #9ca3af;">-</td>`;
            }
        });
        
        tr.innerHTML = rowHTML;
        tableBody.appendChild(tr);
    });
}

/**
 * Setup station history modal
 */
function setupStationHistoryModal() {
    const modal = document.getElementById('station-history-modal');
    const closeBtn = document.getElementById('close-history-modal');
    
    if (!modal) return;
    
    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    });
}

/**
 * Make station names clickable in table
 */
function makeStationNamesClickable() {
    const tableBody = document.getElementById('table-body');
    if (!tableBody) return;
    
    // Find all station name cells (second column, with station-name class)
    const stationCells = tableBody.querySelectorAll('td.station-name');
    
    stationCells.forEach(cell => {
        const stationName = cell.textContent.trim();
        
        // Make clickable
        cell.style.cursor = 'pointer';
        cell.style.color = '#0066cc';
        cell.style.textDecoration = 'underline';
        cell.title = `Xem lịch sử dữ liệu của ${stationName}`;
        
        // Add click event
        cell.addEventListener('click', () => {
            openStationHistoryModal(stationName);
        });
    });
}

// Export for manual initialization after auth
window.initializeDataPage = initializePage;
