/**
 * Script đồng bộ timestamp trong database
 * Sử dụng để kiểm tra và sửa timestamp đã lưu
 * 
 * CÁCH SỬ DỤNG:
 * 
 * 1. Kiểm tra tình trạng hiện tại (không thay đổi dữ liệu):
 *    node sync-timestamps.js check
 * 
 * 2. Xem trước thay đổi (dry run):
 *    node sync-timestamps.js preview
 * 
 * 3. Chạy migration thực tế (CẨN THẬN!):
 *    node sync-timestamps.js migrate
 * 
 * LƯU Ý:
 * - PostgreSQL TIMESTAMPTZ tự động xử lý timezone conversion
 * - Chỉ cần migration nếu timestamp hiển thị sai múi giờ
 * - Backup database trước khi chạy migrate!
 */

const { checkTimestampStatus, syncTimestamps, closeDatabase } = require('./modules/database');

async function main() {
    const command = process.argv[2] || 'check';
    
    console.log('='.repeat(60));
    console.log('🔧 CÔNG CỤ ĐỒNG BỘ TIMESTAMP');
    console.log('='.repeat(60));
    
    try {
        switch (command) {
            case 'check':
                console.log('\n📋 Chế độ: KIỂM TRA TÌNH TRẠNG\n');
                await checkTimestampStatus();
                break;
                
            case 'preview':
                console.log('\n📋 Chế độ: XEM TRƯỚC (DRY RUN)\n');
                await syncTimestamps({ 
                    dryRun: true,
                    hoursOffset: null // Chỉ xem, không update
                });
                break;
                
            case 'migrate':
                console.log('\n⚠️  CẢNH BÁO: Bạn đang chạy chế độ MIGRATION!\n');
                console.log('Điều này sẽ thay đổi timestamp trong database.');
                console.log('Đảm bảo bạn đã backup database!\n');
                
                // Wait 3 seconds before proceeding
                console.log('Đang bắt đầu sau 3 giây...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // LƯU Ý: Thông thường KHÔNG CẦN migrate vì PostgreSQL tự xử lý
                // Nếu cần, uncomment dòng dưới và set hoursOffset phù hợp
                
                console.log('\n⚠️ MIGRATION BỊ TẮT MẶC ĐỊNH!\n');
                console.log('PostgreSQL TIMESTAMPTZ tự động xử lý timezone conversion.');
                console.log('Timestamp được lưu dạng UTC và hiển thị theo timezone đã set.\n');
                console.log('Nếu timestamp hiển thị đúng khi query, KHÔNG CẦN migrate!\n');
                console.log('Để bật migration, uncomment code trong sync-timestamps.js\n');
                
                // await syncTimestamps({ 
                //     dryRun: false,
                //     hoursOffset: 7 // Cộng thêm 7 giờ nếu data bị lệch UTC
                // });
                
                break;
                
            default:
                console.log('\n❌ Lệnh không hợp lệ!');
                console.log('\nCác lệnh có sẵn:');
                console.log('  check    - Kiểm tra tình trạng timestamp');
                console.log('  preview  - Xem trước thay đổi (không update)');
                console.log('  migrate  - Chạy migration (CẨN THẬN!)');
                console.log('\nVí dụ: node sync-timestamps.js check');
                process.exit(1);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Hoàn tất!');
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('\n❌ Lỗi:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await closeDatabase();
        process.exit(0);
    }
}

// Run main function
main();
