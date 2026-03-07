/**
 * Test script for permit-capacity API endpoint
 */
const axios = require('axios');

async function testAPI() {
    try {
        console.log('🧪 Testing /api/permit-capacity endpoint...\n');
        
        // First, login to get token
        console.log('1. Logging in...');
        const loginResponse = await axios.post('http://localhost:3000/api/login', {
            username: 'admin',
            password: 'admin123'
        });
        
        if (!loginResponse.data.success) {
            console.error('❌ Login failed:', loginResponse.data.message);
            return;
        }
        
        const token = loginResponse.data.token;
        console.log('✅ Login successful, token:', token.substring(0, 20) + '...\n');
        
        // Test permit-capacity API
        console.log('2. Calling /api/permit-capacity...');
        const response = await axios.get('http://localhost:3000/api/permit-capacity', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 60000 // 60 seconds timeout
        });
        
        if (response.data.success) {
            console.log('✅ API call successful!\n');
            console.log('Response data:');
            console.log('- Total Permits:', response.data.totalPermits);
            console.log('- Total Stations:', response.data.totalStations);
            console.log('- Grand Total Capacity:', response.data.grandTotalCapacity, 'm³');
            console.log('\nPermit details:');
            
            Object.keys(response.data.data).forEach(permit => {
                const permitData = response.data.data[permit];
                console.log(`\n📋 ${permit}:`);
                console.log(`   - Stations with data: ${permitData.stationsWithData}`);
                console.log(`   - Total capacity: ${permitData.totalCapacity} ${permitData.unit}`);
                if (permitData.stationDetails && permitData.stationDetails.length > 0) {
                    console.log(`   - Stations:`);
                    permitData.stationDetails.forEach(station => {
                        console.log(`     • ${station.stationName}: ${station.totalFlow} ${station.unit}`);
                    });
                }
            });
            
            console.log('\n✅ Test PASSED!');
        } else {
            console.error('❌ API returned error:', response.data.message);
        }
        
    } catch (error) {
        console.error('❌ Test FAILED!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Error:', error.response.data);
        } else {
            console.error('Error:', error.message);
            console.error(error.stack);
        }
    }
}

testAPI();
