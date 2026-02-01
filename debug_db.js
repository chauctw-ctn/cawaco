const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'water_monitoring.db');
const db = new sqlite3.Database(dbPath);

// Query để kiểm tra dữ liệu TVA trong 60 phút qua
const cutoffTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();

console.log('🔍 Kiểm tra dữ liệu TVA trong 60 phút qua');
console.log('Cutoff time:', cutoffTime);
console.log('Current time:', new Date().toISOString());
console.log('');

// Kiểm tra một vài trạm cụ thể
const query = `
SELECT 
    station_name,
    parameter_name,
    value,
    timestamp
FROM tva_data
WHERE timestamp >= ?
AND station_name IN (
    'NHÀ MÁY SỐ 2 - GIẾNG SỐ 2',
    'NHÀ MÁY SỐ 2 - GIẾNG SỐ 3',
    'TRẠM BƠM 23',
    'TRẠM BƠM 27'
)
ORDER BY station_name, parameter_name, timestamp DESC
LIMIT 200
`;

db.all(query, [cutoffTime], (err, rows) => {
    if (err) {
        console.error('❌ Lỗi query:', err);
        db.close();
        return;
    }
    
    console.log(`📊 Tìm thấy ${rows.length} bản ghi\n`);
    
    // Group by station and parameter
    const grouped = {};
    rows.forEach(row => {
        const key = `${row.station_name}|${row.parameter_name}`;
        if (!grouped[key]) {
            grouped[key] = {
                station: row.station_name,
                parameter: row.parameter_name,
                values: []
            };
        }
        grouped[key].values.push({
            value: row.value,
            timestamp: row.timestamp
        });
    });
    
    // Display summary
    Object.keys(grouped).forEach(key => {
        const group = grouped[key];
        const uniqueValues = [...new Set(group.values.map(v => v.value))];
        
        console.log(`📍 ${group.station} - ${group.parameter}`);
        console.log(`   Tổng số bản ghi: ${group.values.length}`);
        console.log(`   Số giá trị khác nhau: ${uniqueValues.length}`);
        console.log(`   Trạng thái: ${uniqueValues.length > 1 ? '✅ ONLINE (có thay đổi)' : '❌ OFFLINE (không thay đổi)'}`);
        console.log(`   Các giá trị:`);
        
        uniqueValues.forEach(val => {
            const count = group.values.filter(v => v.value === val).length;
            console.log(`      ${val} (xuất hiện ${count} lần)`);
        });
        
        console.log(`   5 bản ghi gần nhất:`);
        group.values.slice(0, 5).forEach(v => {
            console.log(`      ${v.value} @ ${v.timestamp}`);
        });
        console.log('');
    });
    
    db.close();
});
