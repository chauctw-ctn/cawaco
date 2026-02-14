/**
 * SCADA Data Collection Module
 * Module thu thập dữ liệu từ hệ thống SCADA-TVA
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const config = require('../../config');
const { formatChannelData, groupByStation, TVA_CHANNEL_MAPPING } = require("../../tva-channel-mapping");

/**
 * Crawl dữ liệu từ hệ thống SCADA TVA
 * @returns {Promise<Array>} Danh sách trạm và dữ liệu
 */
async function crawlScadaTVA() {
    try {
        console.log("🔐 [SCADA] Đang đăng nhập vào hệ thống SCADA...");
        
        const client = axios.create({
            timeout: config.scada.timeout,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
            },
            maxRedirects: 10,
            withCredentials: true,
        });

        // Bước 1: GET trang login để lấy ViewState và cookies
        console.log("📄 [SCADA] Đang lấy form login...");
        const loginPageRes = await client.get(config.scada.loginUrl);
        
        let cookies = loginPageRes.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
        
        // Parse HTML để lấy ViewState (ASP.NET)
        const $ = cheerio.load(loginPageRes.data);
        const viewState = $('input[name="__VIEWSTATE"]').val();
        const eventValidation = $('input[name="__EVENTVALIDATION"]').val();
        const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val();
        
        console.log("🔑 [SCADA] ViewState:", viewState ? "✅" : "❌");
        
        if (!viewState) {
            throw new Error("Không thể lấy ViewState từ trang login");
        }

        // Bước 2: POST đăng nhập
        console.log("🔓 [SCADA] Đang gửi thông tin đăng nhập...");
        
        const loginData = new URLSearchParams({
            '__VIEWSTATE': viewState,
            '__VIEWSTATEGENERATOR': viewStateGenerator || '',
            '__EVENTVALIDATION': eventValidation || '',
            'txtUsername': config.scada.username,
            'txtPassword': config.scada.password,
            'btnLogin': 'Login'
        });

        const loginRes = await client.post(config.scada.loginUrl, loginData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieString,
                'Referer': config.scada.loginUrl,
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 400,
        });

        if (loginRes.headers['set-cookie']) {
            cookies = [...cookies, ...loginRes.headers['set-cookie']];
        }
        
        const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
        console.log("✅ [SCADA] Đã đăng nhập thành công!");

        // Bước 3: Warm up view cache trước khi gọi API
        const warmUpViewCache = async (viewID) => {
            try {
                const url = `${config.scada.url}/Scada/View.aspx?viewID=${viewID}`;
                await client.get(url, {
                    headers: {
                        'Cookie': sessionCookie,
                        'Referer': `${config.scada.url}/Scada/View.aspx`,
                    },
                    timeout: 15000,
                });
                console.log(`✅ [SCADA] View cache warmed (viewID=${viewID})`);
            } catch (e) {
                console.log(`⚠️ [SCADA] Warm-up failed (viewID=${viewID}): ${e.response?.status || e.message}`);
            }
        };

        await warmUpViewCache(16);

        // Bước 4: Lấy dữ liệu realtime từ API JSON
        console.log("\n🚀 [SCADA] Đang lấy dữ liệu từ API JSON endpoint...");
        
        let realtimeData = [];

        try {
            realtimeData = await getRealtimeDataFromAPI(sessionCookie, 16, client);
        } catch (viewErr) {
            console.log("⚠️ [SCADA API] View-based API failed, trying channel-based API...");
            
            const channelNums = Object.keys(TVA_CHANNEL_MAPPING)
                .map(k => parseInt(k, 10))
                .filter(n => Number.isFinite(n))
                .sort((a, b) => a - b);

            realtimeData = await getRealtimeDataFromAPIByChannels(sessionCookie, channelNums, client);
        }

        const stations = [];
        
        if (realtimeData && realtimeData.length > 0) {
            console.log(`✅ [SCADA API] Lấy được ${realtimeData.length} kênh dữ liệu realtime`);
            
            // Format dữ liệu với channel mapping
            realtimeData.forEach(item => {
                const formatted = formatChannelData(item);
                
                stations.push({
                    id: `${formatted.station}_${formatted.parameter}`,
                    name: formatted.stationName,
                    station: formatted.station,
                    parameter: formatted.parameter,
                    parameterName: formatted.parameterName,
                    channelNumber: formatted.channelNumber,
                    value: formatted.value,
                    displayText: formatted.displayText,
                    unit: formatted.unit,
                    status: formatted.status,
                    color: formatted.color,
                    group: formatted.group,
                    view: 'API_REALTIME',
                    viewId: '16',
                });
            });
            
            console.log(`✅ [SCADA API] Đã lấy ${stations.length} kênh từ API JSON`);
        }

        if (stations.length === 0) {
            console.log("\n🔍 [SCADA] Không tìm thấy dữ liệu từ API");
        }

        console.log(`\n✅ [SCADA] Đã lấy được ${stations.length} kênh dữ liệu`);
        
        // Group dữ liệu theo trạm
        const groupedStations = groupByStation(stations);
        
        // Lưu dữ liệu vào file JSON
        const outputData = {
            timestamp: new Date().toISOString(),
            source: "SCADA_TVA",
            method: 'API_JSON',
            totalChannels: stations.length,
            totalStations: Object.keys(groupedStations).length,
            channels: stations,
            stationsGrouped: groupedStations,
        };
        
        fs.writeFileSync('data_scada_tva.json', JSON.stringify(outputData, null, 2), 'utf-8');
        console.log("💾 [SCADA] Đã lưu dữ liệu vào data_scada_tva.json");
        
        return stations;

    } catch (error) {
        console.error("❌ [SCADA] Lỗi khi crawl dữ liệu:", error.message);
        throw error;
    }
}

/**
 * Lấy dữ liệu realtime từ API JSON theo danh sách channel numbers
 */
async function getRealtimeDataFromAPIByChannels(sessionCookie, channelNums, client) {
    if (!Array.isArray(channelNums) || channelNums.length === 0) return [];

    console.log(`\n🔌 [SCADA API] Đang lấy dữ liệu realtime theo channelNums (${channelNums.length} kênh)...`);

    const timestamp = Date.now();
    const apiUrl = `${config.scada.url}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;
    const params = {
        cnlNums: JSON.stringify(channelNums),
        viewIDs: '[]',
        _: timestamp,
    };

    const response = await client.get(apiUrl, {
        params,
        headers: {
            'Cookie': sessionCookie,
            'Referer': `${config.scada.url}/Scada/View.aspx`,
        },
    });

    if (response.data && response.data.d) {
        const data = JSON.parse(response.data.d);
        if (data.Success) {
            console.log(`✅ [SCADA API] Channel-based: ${data.Data.length} kênh`);
            return data.Data;
        }
        throw new Error(`API Error: ${data.ErrorMessage}`);
    }

    throw new Error('Invalid API response format');
}

/**
 * Lấy dữ liệu realtime từ API JSON endpoint
 */
async function getRealtimeDataFromAPI(sessionCookie, viewID = 16, client) {
    console.log(`\n🔌 [SCADA API] Đang lấy dữ liệu realtime từ API JSON (viewID=${viewID})...`);

    const timestamp = Date.now();
    const apiUrl = `${config.scada.url}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;
    const params = {
        cnlNums: '',
        viewIDs: '',
        viewID: viewID,
        _: timestamp
    };

    const response = await client.get(apiUrl, {
        params: params,
        headers: {
            'Cookie': sessionCookie,
            'Referer': `${config.scada.url}/Scada/View.aspx`,
        },
    });

    if (response.data && response.data.d) {
        const data = JSON.parse(response.data.d);
        
        if (data.Success) {
            console.log(`✅ [SCADA API] Lấy được ${data.Data.length} kênh dữ liệu`);
            return data.Data;
        } else {
            throw new Error(`API Error: ${data.ErrorMessage}`);
        }
    }
    
    throw new Error('Invalid API response format');
}

/**
 * Lấy dữ liệu SCADA với retry logic
 */
async function getSCADADataWithRetry(maxRetries = null) {
    const retries = maxRetries || config.scada.maxRetries;
    let lastError = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔄 [SCADA] Lần thử ${attempt}/${retries}`);
            const data = await crawlScadaTVA();
            return data;
        } catch (error) {
            lastError = error;
            console.error(`❌ [SCADA] Lần thử ${attempt} thất bại:`, error.message);
            
            if (attempt < retries) {
                console.log(`⏳ [SCADA] Đợi ${config.scada.retryDelay / 1000}s trước khi thử lại...`);
                await new Promise(resolve => setTimeout(resolve, config.scada.retryDelay));
            }
        }
    }
    
    throw new Error(`[SCADA] Thất bại sau ${retries} lần thử: ${lastError?.message}`);
}

/**
 * Lấy dữ liệu đã group theo trạm từ file cache
 */
function getGroupedStations() {
    try {
        if (fs.existsSync('data_scada_tva.json')) {
            const fileData = JSON.parse(fs.readFileSync('data_scada_tva.json', 'utf8'));
            
            const dataAge = Date.now() - new Date(fileData.timestamp).getTime();
            const tenMinutes = 10 * 60 * 1000;
            
            if (dataAge < tenMinutes && fileData.stationsGrouped) {
                return fileData.stationsGrouped;
            }
        }
    } catch (error) {
        console.error('⚠️ [SCADA] Lỗi đọc file cache:', error.message);
    }
    
    return {};
}

module.exports = {
    crawlScadaTVA,
    getSCADADataWithRetry,
    getGroupedStations,
    getRealtimeDataFromAPI
};
