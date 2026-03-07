/**
 * TVA Data Collection Module
 * Module thu thập dữ liệu từ hệ thống TVA (Quan Trắc)
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const config = require('../../config');

const DATA_QUANTRAC_PATH = path.join(__dirname, '../../data_quantrac.json');

/**
 * Thu thập dữ liệu từ hệ thống TVA
 * @returns {Promise<Array>} Danh sách trạm và dữ liệu
 */
async function crawlTVAData() {
    try {
        console.log("🔐 [TVA] Đang đăng nhập vào hệ thống TVA...");
        
        const cookieJar = [];
        
        const client = axios.create({
            timeout: config.tva.timeout,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
            },
            maxRedirects: 5,
            withCredentials: true,
        });

        // Bước 1: GET trang login để lấy cookies và form token
        const loginPageRes = await client.get(config.tva.url);
        let allCookies = loginPageRes.headers['set-cookie'] || [];
        
        // Parse HTML để lấy form token
        const $login = cheerio.load(loginPageRes.data);
        const formToken = $login('input[name="is_dtool_form"]').val();
        
        console.log(`🔑 [TVA] Form token: ${formToken ? '✅' : '❌'}`);

        // Bước 2: POST đăng nhập
        const loginData = new URLSearchParams({
            'fields[email]': config.tva.username,
            'fields[password]': config.tva.password,
            'remember_account': 'on',
            'is_dtool_form': formToken
        });

        const loginRes = await client.post(`${config.tva.url}/dang-nhap/`, loginData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': allCookies.map(c => c.split(';')[0]).join('; '),
                'Referer': config.tva.url,
            },
        });

        // Lấy cookies từ response
        if (loginRes.headers['set-cookie']) {
            allCookies = [...allCookies, ...loginRes.headers['set-cookie']];
        }

        // Tạo cookie string
        const cookieMap = {};
        allCookies.forEach(cookie => {
            const [nameValue] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            if (name && value) {
                cookieMap[name.trim()] = value.trim();
            }
        });
        
        const cookieString = Object.entries(cookieMap)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');

        console.log("✅ [TVA] Đã hoàn tất đăng nhập");
        
        // Bước 3: Lấy dữ liệu từ trang chủ
        console.log("📡 [TVA] Đang lấy dữ liệu từ trang chủ...");

        const res = await client.get(config.tva.url, {
            headers: {
                'Cookie': cookieString,
                'Referer': config.tva.url,
            },
        });

        const html = res.data;
        const $ = cheerio.load(html);

        const segmentCount = $(".segmentData").length;
        console.log(`🔍 [TVA] Tìm thấy ${segmentCount} segment dữ liệu`);

        if (segmentCount === 0) {
            console.log("⚠️ [TVA] Không tìm thấy dữ liệu");
            return [];
        }

        const allStations = [];

        // Duyệt qua từng segmentData (mỗi trạm/giếng)
        $(".segmentData").each((index, segment) => {
            const $segment = $(segment);
            
            // Lấy tên trạm
            const stationName = $segment.find(".headerChart").first().text().trim();
            
            // Lấy thời điểm cập nhật
            const updateTime = $segment.find(".headerNow").first().text().trim().replace("Thời điểm: ", "");
            
            // Lấy dữ liệu từ Table 1 (giá trị hiện tại)
            const measurements = [];
            
            $segment.find(".left .table .row").each((i, row) => {
                const $row = $(row);
                
                // Bỏ qua header row
                if ($row.hasClass("header")) return;
                
                const cols = $row.find(".col");
                if (cols.length >= 5) {
                    const measurement = {
                        stt: $(cols[0]).text().trim(),
                        name: $(cols[1]).text().trim(),
                        time: $(cols[2]).text().trim(),
                        value: $(cols[3]).text().trim(),
                        unit: $(cols[4]).text().trim(),
                        limit: $(cols[5]) ? $(cols[5]).text().trim() : ""
                    };
                    
                    // Chỉ lấy nếu có dữ liệu hợp lệ
                    if (measurement.name && measurement.value) {
                        measurements.push(measurement);
                    }
                }
            });

            // Nếu có dữ liệu thì thêm vào mảng
            if (measurements.length > 0) {
                allStations.push({
                    station: stationName,
                    updateTime: updateTime,
                    data: measurements
                });
                console.log(`  📍 [TVA] ${stationName}: ${measurements.length} thông số`);
            }
        });

        console.log(`✅ [TVA] Đã lấy ${allStations.length} trạm, ${allStations.reduce((sum, s) => sum + s.data.length, 0)} thông số`);

        // Lưu vào file JSON (optional)
        try {
            const outputData = {
                timestamp: new Date().toISOString(),
                totalStations: allStations.length,
                stations: allStations
            };

            fs.writeFileSync(DATA_QUANTRAC_PATH, JSON.stringify(outputData, null, 2), "utf8");
        } catch (fileError) {
            console.warn("⚠️ [TVA] Không thể lưu file:", fileError.message);
        }

        return allStations;

    } catch (err) {
        console.error("❌ [TVA] Lỗi:", err.message);
        if (err.response) {
            console.error("[TVA] Status:", err.response.status);
        }
        throw err;
    }
}

/**
 * Lấy dữ liệu TVA với retry logic
 * @param {number} maxRetries - Số lần thử lại tối đa
 * @returns {Promise<Array>} Danh sách trạm và dữ liệu
 */
async function getTVADataWithRetry(maxRetries = null) {
    const retries = maxRetries || config.tva.maxRetries;
    let lastError = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔄 [TVA] Lần thử ${attempt}/${retries}`);
            const data = await crawlTVAData();
            return data;
        } catch (error) {
            lastError = error;
            console.error(`❌ [TVA] Lần thử ${attempt} thất bại:`, error.message);
            
            if (attempt < retries) {
                console.log(`⏳ [TVA] Đợi ${config.tva.retryDelay / 1000}s trước khi thử lại...`);
                await new Promise(resolve => setTimeout(resolve, config.tva.retryDelay));
            }
        }
    }
    
    throw new Error(`[TVA] Thất bại sau ${retries} lần thử: ${lastError?.message}`);
}

module.exports = {
    crawlTVAData,
    getTVADataWithRetry
};
