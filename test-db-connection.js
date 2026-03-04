#!/usr/bin/env node

/**
 * Test Database Connection
 * Script để test kết nối PostgreSQL database
 */

// Try to load .env if exists (optional)
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not available or .env doesn't exist, that's ok
}

const { Pool } = require('pg');

console.log('🔍 Testing Database Connection\n');
console.log('═'.repeat(50));

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

console.log('\n📋 Configuration:');
console.log(`   URL: ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`);

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000
});

async function testConnection() {
    try {
        console.log('\n⏳ Connecting to database...');
        
        const client = await pool.connect();
        console.log('✅ Connected successfully!');
        
        const result = await client.query('SELECT version()');
        console.log('\n📊 Database Info:');
        console.log(`   ${result.rows[0].version}`);
        
        // Test creating a simple table
        console.log('\n⏳ Testing table operations...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS test_connection (
                id SERIAL PRIMARY KEY,
                test_time TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Can create tables');
        
        await client.query(`INSERT INTO test_connection (test_time) VALUES (NOW())`);
        console.log('✅ Can insert data');
        
        const testResult = await client.query(`SELECT COUNT(*) FROM test_connection`);
        console.log(`✅ Can query data (${testResult.rows[0].count} test records)`);
        
        await client.query(`DROP TABLE test_connection`);
        console.log('✅ Can drop tables');
        
        client.release();
        
        console.log('\n' + '═'.repeat(50));
        console.log('🎉 All database tests passed!');
        console.log('   Your database is ready for deployment.');
        console.log('═'.repeat(50) + '\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Database connection failed!');
        console.error(`   Error: ${error.message}`);
        
        console.log('\n💡 Troubleshooting:');
        console.log('   1. Check DATABASE_URL is correct');
        console.log('   2. Verify database is accessible');
        console.log('   3. Check SSL settings');
        console.log('   4. Ensure database exists\n');
        
        process.exit(1);
    } finally {
        await pool.end();
    }
}

testConnection();
