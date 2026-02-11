// Debug timezone của PostgreSQL
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

async function debugTimezone() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        },
        options: '-c TimeZone=Asia/Ho_Chi_Minh'
    });

    try {
        console.log('🔍 Debugging PostgreSQL timezone...\n');
        
        // Check current timezone
        const tz = await pool.query('SHOW timezone');
        console.log('📍 Current PostgreSQL timezone:', tz.rows[0].TimeZone);
        
        // Get current timestamp in different formats
        const times = await pool.query(`
            SELECT 
                NOW() as now,
                CURRENT_TIMESTAMP as current_timestamp,
                LOCALTIMESTAMP as localtimestamp,
                NOW() AT TIME ZONE 'UTC' as utc,
                NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh' as vietnam
        `);
        
        console.log('\n⏰ PostgreSQL timestamps:');
        console.log('   NOW():               ', times.rows[0].now);
        console.log('   CURRENT_TIMESTAMP:   ', times.rows[0].current_timestamp);
        console.log('   LOCALTIMESTAMP:      ', times.rows[0].localtimestamp);
        console.log('   UTC:                 ', times.rows[0].utc);
        console.log('   Vietnam (GMT+7):     ', times.rows[0].vietnam);
        
        console.log('\n⏰ System times (Node.js):');
        const now = new Date();
        console.log('   Node.js UTC:         ', now.toISOString());
        console.log('   Node.js Vietnam:     ', now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
        
        // Try setting timezone explicitly
        console.log('\n🔧 Trying to set timezone explicitly...');
        await pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        const tz2 = await pool.query('SHOW timezone');
        console.log('📍 Timezone after SET:', tz2.rows[0].TimeZone);
        
        const times2 = await pool.query('SELECT NOW() as now');
        console.log('⏰ NOW() after SET:', times2.rows[0].now);
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

debugTimezone();
