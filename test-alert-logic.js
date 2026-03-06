/**
 * Test script to verify alert logic
 * Run: node test-alert-logic.js
 */

// Simulate alert history and logic
const ALERT_HISTORY_KEY = 'telegram_alert_history';
let alertRepeatIntervalMinutes = 1;
let delayThresholdMinutes = 60;

// Mock localStorage
const localStorage = {
    data: {},
    getItem(key) {
        return this.data[key] || null;
    },
    setItem(key, value) {
        this.data[key] = value;
    }
};

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

function saveAlertHistory(history) {
    try {
        localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(history));
        console.log('💾 Alert history saved:', Object.keys(history).length, 'stations');
    } catch (error) {
        console.error('❌ Error saving alert history:', error);
    }
}

function shouldSendAlert(station, newStatus, delayMinutes) {
    const history = getAlertHistory();
    const stationHistory = history[station];
    const now = Date.now();
    
    console.log(`\n🔍 shouldSendAlert check for ${station}:`, {
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

// Test scenarios
console.log('\n=== TEST SCENARIO 1: First alert for new station ===');
let result = shouldSendAlert('Station_A', 'offline', 120);
console.log('Result:', result);
if (result.shouldSend) {
    recordAlert('Station_A', 'offline');
}

console.log('\n=== TEST SCENARIO 2: Check immediately after (should skip) ===');
result = shouldSendAlert('Station_A', 'offline', 125);
console.log('Result:', result);

console.log('\n=== TEST SCENARIO 3: Wait 1.5 minutes and check again ===');
// Simulate 1.5 minutes passing
setTimeout(() => {
    result = shouldSendAlert('Station_A', 'offline', 130);
    console.log('Result:', result);
    if (result.shouldSend) {
        recordAlert('Station_A', 'offline');
    }
    
    console.log('\n=== TEST SCENARIO 4: Station comes back online ===');
    result = shouldSendAlert('Station_A', 'online', 5);
    console.log('Result:', result);
    if (result.shouldSend) {
        recordAlert('Station_A', 'online');
    }
    
    console.log('\n=== TEST SCENARIO 5: Another offline station ===');
    result = shouldSendAlert('Station_B', 'offline', 150);
    console.log('Result:', result);
    if (result.shouldSend) {
        recordAlert('Station_B', 'offline');
    }
    
    console.log('\n=== Final alert history ===');
    console.log(JSON.stringify(getAlertHistory(), null, 2));
    
}, 1500); // Wait 1.5 seconds (simulating 1.5 minutes)

console.log('\n⏱️ Waiting 1.5 seconds to simulate time passing...\n');
