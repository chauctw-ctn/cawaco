// Test timestamp GMT+7

/**
 * Lấy timestamp hiện tại theo múi giờ GMT+7 (Hồ Chí Minh)
 */
function getVietnamTimestamp() {
    const now = new Date();
    // Chuyển sang GMT+7 (Hồ Chí Minh)
    const vietnamTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return vietnamTime.toISOString();
}

// Test
console.log('🕒 Testing timestamp GMT+7:');
console.log('');

const utcNow = new Date();
const vietnamTimestamp = getVietnamTimestamp();

console.log('UTC Time:      ', utcNow.toISOString());
console.log('Vietnam Time:  ', vietnamTimestamp);
console.log('');

// Parse and display
const vnDate = new Date(vietnamTimestamp);
console.log('Vietnam Date Object:', vnDate);
console.log('Hour (UTC):          ', vnDate.getUTCHours(), ':00');
console.log('');

// Tạo cách hiển thị rõ ràng hơn
const nowLocal = new Date();
const vnTimeOffset = nowLocal.getTimezoneOffset() + (7 * 60); // Offset to GMT+7
const vnTime = new Date(nowLocal.getTime() + (vnTimeOffset * 60 * 1000));

console.log('📅 Current time information:');
console.log('Local time:    ', nowLocal.toString());
console.log('UTC time:      ', nowLocal.toUTCString());
console.log('Vietnam time:  ', vnTime.toString());
console.log('Vietnam ISO:   ', getVietnamTimestamp());
