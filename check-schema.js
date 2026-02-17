/**
 * Script kiểm tra schema của các bảng database
 */

const db = require('./modules/database');

async function checkSchema() {
    console.log('🔍 KIỂM TRA SCHEMA DATABASE...\n');
    
    try {
        const tables = ['tva_data', 'mqtt_data', 'scada_data'];
        
        for (const table of tables) {
            console.log(`\n📋 Bảng: ${table}`);
            console.log('='.repeat(60));
            
            const result = await db.pool.query(`
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            
            console.log('\nCác cột:');
            result.rows.forEach(col => {
                console.log(`  - ${col.column_name}`);
                console.log(`    Type: ${col.data_type}`);
                console.log(`    Nullable: ${col.is_nullable}`);
                console.log(`    Default: ${col.column_default || 'none'}`);
            });
            
            // Kiểm tra xem có cột timestamp không
            const hasTimestamp = result.rows.some(col => col.column_name === 'timestamp');
            const hasCreatedAt = result.rows.some(col => col.column_name === 'created_at');
            
            console.log(`\n✅ Có cột 'created_at': ${hasCreatedAt}`);
            console.log(`${hasTimestamp ? '⚠️' : '✅'} Có cột 'timestamp': ${hasTimestamp}`);
            
            if (hasTimestamp) {
                console.log('🔴 CẢNH BÁO: Bảng vẫn còn cột timestamp!');
            }
        }
        
        // Kiểm tra dữ liệu mẫu
        console.log('\n\n📊 KIỂM TRA DỮ LIỆU MẪU...');
        console.log('='.repeat(60));
        
        for (const table of tables) {
            console.log(`\n${table}:`);
            const sampleResult = await db.pool.query(`
                SELECT * FROM ${table}
                ORDER BY created_at DESC
                LIMIT 1
            `);
            
            if (sampleResult.rows.length > 0) {
                const row = sampleResult.rows[0];
                console.log('  Columns:', Object.keys(row).join(', '));
                
                // Check if timestamp column exists in data
                if ('timestamp' in row) {
                    console.log('  ⚠️ CẢNH BÁO: Dữ liệu có trường timestamp!');
                }
                if ('created_at' in row) {
                    console.log('  ✅ Dữ liệu có trường created_at:', row.created_at);
                }
            } else {
                console.log('  (Chưa có dữ liệu)');
            }
        }
        
        console.log('\n\n✅ HOÀN THÀNH KIỂM TRA!\n');
        
    } catch (error) {
        console.error('❌ LỖI:', error.message);
        console.error(error.stack);
    } finally {
        await db.closeDatabase();
        process.exit(0);
    }
}

checkSchema();
