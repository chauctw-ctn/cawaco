/**
 * Script xóa các cột timestamp và update_time cũ
 * Chỉ giữ lại cột created_at
 */

const db = require('./modules/database');

async function cleanupColumns() {
    console.log('🧹 BẮT ĐẦU DỌN DẸP CÁC CỘT CŨ...\n');
    
    const client = await db.pool.connect();
    
    try {
        const tables = ['tva_data', 'mqtt_data', 'scada_data'];
        
        for (const table of tables) {
            console.log(`\n📋 Xử lý bảng: ${table}`);
            console.log('='.repeat(60));
            
            // Check if columns exist
            const columnsResult = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1 
                AND column_name IN ('timestamp', 'update_time')
            `, [table]);
            
            const existingColumns = columnsResult.rows.map(r => r.column_name);
            console.log('Các cột tồn tại cần xóa:', existingColumns.join(', ') || 'không có');
            
            // Drop timestamp column if exists
            if (existingColumns.includes('timestamp')) {
                console.log('  🗑️ Đang xóa cột timestamp...');
                await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS timestamp`);
                console.log('  ✅ Đã xóa cột timestamp');
            }
            
            // Drop update_time column if exists
            if (existingColumns.includes('update_time')) {
                console.log('  🗑️ Đang xóa cột update_time...');
                await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS update_time`);
                console.log('  ✅ Đã xóa cột update_time');
            }
            
            // Verify created_at exists
            const createdAtCheck = await client.query(`
                SELECT column_name, data_type, column_default
                FROM information_schema.columns 
                WHERE table_name = $1 
                AND column_name = 'created_at'
            `, [table]);
            
            if (createdAtCheck.rows.length > 0) {
                const col = createdAtCheck.rows[0];
                console.log(`  ✅ Cột created_at tồn tại:`);
                console.log(`     Type: ${col.data_type}`);
                console.log(`     Default: ${col.column_default}`);
            } else {
                console.log('  ❌ Cột created_at KHÔNG tồn tại!');
            }
            
            // Show final schema
            const finalSchema = await client.query(`
                SELECT column_name, data_type
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            
            console.log('\n  📋 Schema sau khi dọn dẹp:');
            finalSchema.rows.forEach(col => {
                const icon = col.column_name === 'created_at' ? '✅' : '  ';
                console.log(`    ${icon} ${col.column_name} (${col.data_type})`);
            });
        }
        
        console.log('\n\n✅ HOÀN THÀNH DỌN DẸP!\n');
        
    } catch (error) {
        console.error('❌ LỖI:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await db.closeDatabase();
        process.exit(0);
    }
}

cleanupColumns();
