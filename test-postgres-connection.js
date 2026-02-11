// Test PostgreSQL connection
const { pool, initDatabase } = require('./database');

async function testConnection() {
    try {
        console.log('🔄 Testing PostgreSQL connection...');
        
        // Test basic query
        const result = await pool.query('SELECT NOW() as current_time');
        console.log('✅ Connection successful!');
        console.log('📅 Database time:', result.rows[0].current_time);
        
        // Initialize database tables
        console.log('\n🔄 Initializing database tables...');
        await initDatabase();
        console.log('✅ Database tables initialized!');
        
        // Test query stations table
        const stationsResult = await pool.query('SELECT COUNT(*) as count FROM stations');
        console.log(`📊 Current stations count: ${stationsResult.rows[0].count}`);
        
        // Close connection
        await pool.end();
        console.log('\n✅ Test completed successfully!');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

testConnection();
