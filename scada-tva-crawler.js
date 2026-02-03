const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { formatChannelData, groupByStation } = require("./tva-channel-mapping");

// Thông tin hệ thống SCADA
const SCADA_URL = "http://14.161.36.253:86";
const LOGIN_URL = `${SCADA_URL}/Scada/Login.aspx`;
const USERNAME = "cncamau";
const PASSWORD = "cm123456";

/**
 * Crawl dữ liệu từ hệ thống SCADA TVA
 * @returns {Promise<Array>} Danh sách trạm và dữ liệu
 */
async function crawlScadaTVA() {
    try {
        console.log("🔐 [SCADA] Đang đăng nhập vào hệ thống SCADA...");
        
        const client = axios.create({
            timeout: 30000,
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
        const loginPageRes = await client.get(LOGIN_URL);
        
        // Lấy cookies
        let cookies = loginPageRes.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
        
        // Parse HTML để lấy ViewState và EventValidation (ASP.NET)
        const $ = cheerio.load(loginPageRes.data);
        const viewState = $('input[name="__VIEWSTATE"]').val();
        const eventValidation = $('input[name="__EVENTVALIDATION"]').val();
        const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val();
        
        console.log("🔑 [SCADA] ViewState:", viewState ? "✅" : "❌");
        console.log("🔑 [SCADA] EventValidation:", eventValidation ? "✅" : "❌");
        
        if (!viewState) {
            throw new Error("Không thể lấy ViewState từ trang login");
        }

        // Bước 2: POST đăng nhập (Rapid SCADA)
        console.log("🔓 [SCADA] Đang gửi thông tin đăng nhập...");
        
        const loginData = new URLSearchParams({
            '__VIEWSTATE': viewState,
            '__VIEWSTATEGENERATOR': viewStateGenerator || '',
            '__EVENTVALIDATION': eventValidation || '',
            'txtUsername': USERNAME,
            'txtPassword': PASSWORD,
            'btnLogin': 'Login'
        });

        const loginRes = await client.post(LOGIN_URL, loginData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieString,
                'Referer': LOGIN_URL,
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 400,
        });

        // Cập nhật cookies sau khi login
        if (loginRes.headers['set-cookie']) {
            cookies = [...cookies, ...loginRes.headers['set-cookie']];
        }
        
        const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
        console.log("✅ [SCADA] Đã đăng nhập thành công!");
        
        // Kiểm tra URL sau khi login (có thể đã redirect)
        const finalUrl = loginRes.request?.res?.responseUrl || loginRes.config?.url || LOGIN_URL;
        console.log(`📍 [SCADA] URL sau login: ${finalUrl}`);

        // Bước 3: Thử các URL dashboard phổ biến (Rapid SCADA)
        console.log("📊 [SCADA] Đang tìm trang dữ liệu...");
        
        const possibleUrls = [
            finalUrl.includes('/Scada/') && !finalUrl.includes('Login') ? finalUrl : null,
            `${SCADA_URL}/`,
            `${SCADA_URL}/MainData.aspx`,
            `${SCADA_URL}/Scada/`,
            `${SCADA_URL}/Scada/MainData.aspx`,
            `${SCADA_URL}/Scada/TableView.aspx`,
            `${SCADA_URL}/Scada/SchemeView.aspx`,
            `${SCADA_URL}/Scada/EventTableView.aspx`,
            `${SCADA_URL}/Scada/Main.aspx`,
            `${SCADA_URL}/Scada/Index.aspx`,
        ].filter(Boolean);
        
        let dashboardRes = null;
        let dashboardUrl = null;
        
        for (const url of possibleUrls) {
            try {
                console.log(`   🔍 Thử: ${url}`);
                const testRes = await client.get(url, {
                    headers: {
                        'Cookie': sessionCookie,
                        'Referer': LOGIN_URL,
                    },
                    timeout: 10000,
                });
                
                if (testRes.status === 200 && testRes.data.length > 100) {
                    console.log(`   ✅ Tìm thấy trang dữ liệu: ${url}`);
                    dashboardRes = testRes;
                    dashboardUrl = url;
                    break;
                }
            } catch (err) {
                console.log(`   ❌ ${url} - ${err.response?.status || 'timeout'}`);
            }
        }
        
        if (!dashboardRes) {
            throw new Error('Không tìm thấy trang dữ liệu hợp lệ. Vui lòng kiểm tra URL thủ công.');
        }

        // Lưu HTML để debug
        fs.writeFileSync('debug_scada_page.html', dashboardRes.data, 'utf-8');
        console.log("💾 [SCADA] Đã lưu HTML vào debug_scada_page.html để phân tích");

        // Parse dữ liệu từ dashboard
        const $dashboard = cheerio.load(dashboardRes.data);
        const stations = [];

        // Tìm các views có sẵn (Rapid SCADA)
        console.log("🔍 [SCADA] Đang tìm các views...");
        const views = [];
        
        $dashboard('a.node[data-script*="loadView"]').each((i, elem) => {
            const text = $dashboard(elem).find('.text').text().trim();
            const script = $dashboard(elem).attr('data-script') || '';
            const viewIdMatch = script.match(/viewID=(\d+)/);
            const urlMatch = script.match(/["']([^"']+)["']/);
            
            if (viewIdMatch && urlMatch) {
                views.push({
                    id: viewIdMatch[1],
                    name: text,
                    url: urlMatch[1],
                });
            }
        });
        
        console.log(`📊 [SCADA] Tìm thấy ${views.length} views:`);
        views.forEach(v => console.log(`   - ${v.name} (ID: ${v.id})`));
        
        // ⚡ PHƯƠNG ÁN 1: Lấy dữ liệu realtime từ API JSON (NHANH NHẤT - ƯU TIÊN)
        try {
            console.log("\n🚀 [SCADA] Đang lấy dữ liệu từ API JSON endpoint (ưu tiên)...");
            
            const realtimeData = await getRealtimeDataFromAPI(sessionCookie, 16);
            
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
        } catch (apiError) {
            console.log("⚠️ [SCADA API] Không lấy được dữ liệu từ API, chuyển sang HTML parsing...");
            console.error("   Lỗi:", apiError.message);
            
            // Fallback: Lấy dữ liệu từ Table views (HTML Parsing)
            for (const view of views) {
                if (view.url.includes('Table.aspx')) {
                    console.log(`\n📊 [SCADA HTML] Đang lấy dữ liệu từ: ${view.name}`);
                    
                    try {
                        const tableUrl = `${SCADA_URL}${view.url}`;
                        console.log(`   URL: ${tableUrl}`);
                        
                        const tableRes = await client.get(tableUrl, {
                            headers: {
                                'Cookie': sessionCookie,
                                'Referer': dashboardUrl,
                            },
                            timeout: 15000,
                        });
                        
                        // Lưu HTML table để debug
                        fs.writeFileSync(`debug_table_${view.id}.html`, tableRes.data, 'utf-8');
                        console.log(`   💾 Đã lưu vào debug_table_${view.id}.html`);
                        
                        const $table = cheerio.load(tableRes.data);
                        
                        // Tìm bảng dữ liệu
                        const tables = $table('table').length;
                        console.log(`   📊 Tìm thấy ${tables} bảng`);
                        
                        // Parse bảng lớn nhất
                        let maxRows = 0;
                        let selectedTable = null;
                        
                        $table('table').each((j, table) => {
                            const rows = $table(table).find('tr').length;
                            if (rows > maxRows) {
                                maxRows = rows;
                                selectedTable = table;
                            }
                        });
                        
                        if (selectedTable && maxRows > 1) {
                            console.log(`   ✅ Phân tích bảng có ${maxRows} dòng`);
                            
                            // Lấy headers
                            const headers = [];
                            $table(selectedTable).find('tr').first().find('th, td').each((k, cell) => {
                                headers.push($table(cell).text().trim());
                            });
                            
                            console.log(`   📋 Headers: ${headers.join(' | ')}`);
                            
                            // Lấy data rows
                            $table(selectedTable).find('tr').slice(1).each((k, row) => {
                                const cells = $table(row).find('td');
                                if (cells.length > 0) {
                                    const rowData = {};
                                    const rawData = [];
                                    
                                    cells.each((l, cell) => {
                                        const value = $table(cell).text().trim();
                                        rawData.push(value);
                                        
                                        if (headers[l]) {
                                            rowData[headers[l]] = value;
                                        }
                                    });
                                    
                                    if (rawData.some(d => d.length > 0)) {
                                        stations.push({
                                            id: rawData[0] || `${view.id}_${k}`,
                                            name: rawData[1] || rawData[0] || 'Unknown',
                                            view: view.name,
                                            viewId: view.id,
                                            data: rowData,
                                            rawData: rawData,
                                        });
                                    }
                                }
                            });
                            
                            console.log(`   ✅ Đã lấy ${stations.length} dòng dữ liệu từ ${view.name}`);
                        }
                        
                    } catch (err) {
                        console.error(`   ❌ Lỗi lấy dữ liệu từ ${view.name}:`, err.message);
                    }
                }
            }
        }

        // Kiểm tra kết quả
        if (stations.length === 0) {
            console.log("\n🔍 [SCADA] Không tìm thấy dữ liệu từ API và HTML parsing");
        }

        console.log(`\n✅ [SCADA] Đã lấy được ${stations.length} kênh dữ liệu`);
        
        // Group dữ liệu theo trạm
        const groupedStations = groupByStation(stations);
        
        // Lưu dữ liệu vào file JSON
        const outputData = {
            timestamp: new Date().toISOString(),
            source: "SCADA_TVA",
            method: stations.some(s => s.view === 'API_REALTIME') ? 'API_JSON' : 'HTML_PARSING',
            totalChannels: stations.length,
            totalStations: Object.keys(groupedStations).length,
            channels: stations,
            stationsGrouped: groupedStations,
        };
        
        fs.writeFileSync('data_scada_tva.json', JSON.stringify(outputData, null, 2), 'utf-8');
        console.log("💾 [SCADA] Đã lưu dữ liệu vào data_scada_tva.json");
        console.log(`   📊 ${stations.length} channels nhóm thành ${Object.keys(groupedStations).length} trạm`);
        
        return stations;

    } catch (error) {
        console.error("❌ [SCADA] Lỗi khi crawl dữ liệu:", error.message);
        
        // Chi tiết lỗi
        if (error.response) {
            console.error("   📍 Status:", error.response.status);
            console.error("   📍 URL:", error.config?.url);
        }
        
        throw error;
    }
}

/**
 * Lấy dữ liệu realtime từ API JSON endpoint của Rapid SCADA
 * @param {string} sessionCookie - Session cookie sau khi login
 * @param {number} viewID - View ID (16 = TRANG CHỦ)
 * @returns {Promise<Object>} Dữ liệu realtime từ API
 */
async function getRealtimeDataFromAPI(sessionCookie, viewID = 16) {
    try {
        console.log(`\n🔌 [SCADA API] Đang lấy dữ liệu realtime từ API JSON (viewID=${viewID})...`);
        
        const client = axios.create({
            timeout: 15000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
            },
        });

        const timestamp = Date.now();
        const apiUrl = `${SCADA_URL}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;
        const params = {
            cnlNums: ' ',
            viewIDs: ' ',
            viewID: viewID,
            _: timestamp
        };

        const response = await client.get(apiUrl, {
            params: params,
            headers: {
                'Cookie': sessionCookie,
                'Referer': `${SCADA_URL}/Scada/View.aspx`,
            },
        });

        // Parse JSON response
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
        
    } catch (error) {
        console.error(`❌ [SCADA API] Lỗi lấy dữ liệu API:`, error.message);
        throw error;
    }
}

/**
 * Lấy chi tiết dữ liệu của một trạm
 * @param {string} stationId - ID của trạm
 * @returns {Promise<Object>} Dữ liệu chi tiết trạm
 */
async function getStationDetail(stationId) {
    try {
        console.log(`🔍 [SCADA] Đang lấy chi tiết trạm ${stationId}...`);
        
        // Login trước
        const client = axios.create({
            timeout: 30000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        });

        // TODO: Implement login và lấy chi tiết trạm
        // Phụ thuộc vào cấu trúc URL và API của hệ thống SCADA
        
        const detailUrl = `${SCADA_URL}/Scada/StationDetail.aspx?id=${stationId}`;
        // ... implement logic lấy chi tiết
        
        return {};
        
    } catch (error) {
        console.error(`❌ [SCADA] Lỗi lấy chi tiết trạm ${stationId}:`, error.message);
        throw error;
    }
}

// Test nếu chạy trực tiếp
if (require.main === module) {
    console.log("🧪 [SCADA] Chạy test crawl dữ liệu SCADA TVA...\n");
    
    crawlScadaTVA()
        .then(stations => {
            console.log("\n✅ Kết quả:");
            console.log(`   📊 Số trạm: ${stations.length}`);
            if (stations.length > 0) {
                console.log("\n📋 Trạm đầu tiên:");
                console.log(JSON.stringify(stations[0], null, 2));
            }
        })
        .catch(error => {
            console.error("\n❌ Lỗi:", error.message);
            process.exit(1);
        });
}

module.exports = {
    crawlScadaTVA,
    getStationDetail,
    getRealtimeDataFromAPI,
};
