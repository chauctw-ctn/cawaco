/**
 * Test script to send Telegram message
 * Usage: node test-telegram.js
 */

const axios = require('axios');

const BOT_TOKEN = '8705883687:AAEx3A1Y3VshJG1R4Si9syxQsOFX9RSQVu0';
const CHAT_ID = '8023101268';

async function testTelegram() {
    try {
        console.log('📤 Sending test message to Telegram...');
        console.log(`   Bot Token: ${BOT_TOKEN.substring(0, 20)}...`);
        console.log(`   Chat ID: ${CHAT_ID}`);
        
        const dateTime = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        
        const message = `🧪 TEST CẢNH BÁO TELEGRAM

📍 Trạm: TEST_STATION
📡 ❌ Offline
🕒 Thời gian đo: ${dateTime}
⏱️ Thời gian chậm gửi dữ liệu: 65 phút
🕒 Thời gian gửi cảnh báo: ${dateTime}

✅ Kết nối Telegram thành công!`;
        
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const response = await axios.post(telegramUrl, {
            chat_id: CHAT_ID,
            text: message
        }, {
            timeout: 10000
        });
        
        if (response.data.ok) {
            console.log('✅ Message sent successfully!');
            console.log('   Message ID:', response.data.result.message_id);
            console.log('   Check your Telegram app!');
        } else {
            console.error('❌ Failed to send message');
            console.error('   Response:', response.data);
        }
        
    } catch (error) {
        console.error('❌ Error sending Telegram message:');
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Error:', error.response.data?.description || error.response.data);
        } else {
            console.error('   Error:', error.message);
        }
    }
}

testTelegram();
