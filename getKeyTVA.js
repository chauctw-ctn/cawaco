const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const URL = "http://camau.dulieuquantrac.com:8906";
const LOGIN_URL = "http://camau.dulieuquantrac.com:8906/index.php?module=users&view=users&task=checklogin";

// Thông tin đăng nhập
const USERNAME = "ctncamau@quantrac.net";
const PASSWORD = "123456789";

async function crawl() {
  try {
    // Tạo jar để quản lý cookies tự động
    const cookieJar = [];
    
    const client = axios.create({
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
      maxRedirects: 5,
      withCredentials: true,
    });

    console.log("🔐 Đăng nhập vào hệ thống...");

    // Bước 1: GET trang login để lấy cookies và form token
    const loginPageRes = await client.get(URL);
    let allCookies = loginPageRes.headers['set-cookie'] || [];
    
    // Parse HTML để lấy form token
    const $login = cheerio.load(loginPageRes.data);
    const formToken = $login('input[name="is_dtool_form"]').val();
    
    console.log(`🔑 Form token: ${formToken}`);

    // Bước 2: POST đăng nhập
    const loginData = new URLSearchParams({
      'fields[email]': USERNAME,
      'fields[password]': PASSWORD,
      'remember_account': 'on',
      'is_dtool_form': formToken
    });

    const loginRes = await client.post('http://camau.dulieuquantrac.com:8906/dang-nhap/', loginData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': allCookies.map(c => c.split(';')[0]).join('; '),
        'Referer': URL,
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

    console.log("✅ Đã gửi form đăng nhập!");
    
    // TEST: Kiểm tra đăng nhập
    console.log("🧪 Đang kiểm tra trạng thái đăng nhập...\n");
    try {
      const testLoginRes = await client.get(URL, {
        headers: {
          'Cookie': cookieString,
          'Referer': URL,
        },
      });
      
      const $test = cheerio.load(testLoginRes.data);
      
      // Kiểm tra các dấu hiệu đăng nhập thành công
      const hasLogoutBtn = $test('a[href*="logout"], a[href*="dang-xuat"]').length > 0;
      const hasUserPanel = $test('div[data-role="panel"]').length > 0;
      const hasLoginForm = $test('form[action*="login"], input[name="fields[email]"]').length > 0;
      
      console.log(`   📊 Status code: ${testLoginRes.status}`);
      console.log(`   🔓 Có nút Logout: ${hasLogoutBtn ? '✅' : '❌'}`);
      console.log(`   👤 Có User panel: ${hasUserPanel ? '✅' : '❌'}`);
      console.log(`   🔐 Còn form Login: ${hasLoginForm ? '❌ (Chưa đăng nhập!)' : '✅'}`);
      
      // Tìm tên user nếu có
      const userInfo = $test('.user-info, .username, .user-name, [class*="user"]').first().text().trim();
      if (userInfo) {
        console.log(`   👤 Thông tin user: ${userInfo.substring(0, 50)}`);
      }
      
      // Lưu HTML để debug
      fs.writeFileSync("test_login.html", testLoginRes.data, "utf8");
      console.log(`   💾 Đã lưu test_login.html\n`);
      
      if (hasLoginForm && !hasLogoutBtn) {
        console.log("⚠️ CẢNH BÁO: Có thể chưa đăng nhập thành công!\n");
      } else {
        console.log("✅ Đăng nhập thành công!\n");
      }
      
    } catch (err) {
      console.error(`❌ Lỗi khi test login: ${err.message}\n`);
    }
    
    console.log("📡 Đang lấy dữ liệu từ trang chủ...\n");

    // Bước 3: Lấy dữ liệu từ trang chủ
    const res = await client.get(URL, {
      headers: {
        'Cookie': cookieString,
        'Referer': URL,
      },
    });

    const html = res.data;
    const $ = cheerio.load(html);

    // Debug: Kiểm tra xem có dữ liệu không
    const segmentCount = $(".segmentData").length;
    console.log(`🔍 Tìm thấy ${segmentCount} segment dữ liệu`);

    if (segmentCount === 0) {
      console.log("\n⚠️ Không tìm thấy .segmentData, thử tìm các element khác...");
      
      // Kiểm tra xem có đăng nhập thành công không
      const loginCheck = $("div[data-role='panel']").text();
      console.log(`Login info: ${loginCheck.substring(0, 100)}`);
      
      // Lưu HTML để debug
      fs.writeFileSync("debug.html", html, "utf8");
      console.log("💾 Đã lưu HTML vào debug.html để kiểm tra");
      
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
      
      console.log(`\n  📍 Đang xử lý: ${stationName} - ${updateTime}`);
      
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

      console.log(`     ✓ Lấy được ${measurements.length} thông số`);

      // Nếu có dữ liệu thì thêm vào mảng
      if (measurements.length > 0) {
        allStations.push({
          station: stationName,
          updateTime: updateTime,
          data: measurements
        });
      }
    });

    // Hiển thị kết quả
    console.log("═".repeat(80));
    console.log("📊 DỮ LIỆU QUAN TRẮC CÀ MAU");
    console.log("═".repeat(80));
    
    allStations.forEach((station, idx) => {
      console.log(`\n${idx + 1}. ${station.station}`);
      console.log(`   ⏰ ${station.updateTime}`);
      console.log("   " + "─".repeat(70));
      
      station.data.forEach(item => {
        const valueStr = item.value.padEnd(15);
        const nameStr = item.name.padEnd(20);
        console.log(`   ${item.stt}. ${nameStr} ${valueStr} ${item.unit}`);
      });
    });

    console.log("\n" + "═".repeat(80));
    console.log(`✅ Tổng số trạm: ${allStations.length}`);
    console.log(`✅ Tổng số thông số: ${allStations.reduce((sum, s) => sum + s.data.length, 0)}`);
    console.log("═".repeat(80));

    // Xuất ra file JSON (optional - không bắt buộc cho production)
    try {
      const outputData = {
        timestamp: new Date().toISOString(),
        totalStations: allStations.length,
        stations: allStations
      };

      fs.writeFileSync("data_quantrac.json", JSON.stringify(outputData, null, 2), "utf8");
      console.log("\n💾 Đã lưu dữ liệu vào file: data_quantrac.json");

      // Xuất ra file CSV
      let csvContent = "STT,Trạm,Thời điểm,Chỉ tiêu,Thời gian,Giá trị,Đơn vị,Giới hạn\n";
      
      allStations.forEach((station, idx) => {
        station.data.forEach(item => {
          csvContent += `${idx + 1},"${station.station}","${station.updateTime}","${item.name}","${item.time}","${item.value}","${item.unit}","${item.limit}"\n`;
        });
      });

      fs.writeFileSync("data_quantrac.csv", csvContent, "utf8");
      console.log("💾 Đã lưu dữ liệu vào file: data_quantrac.csv");
    } catch (fileError) {
      console.warn("⚠️ Không thể lưu file (có thể do quyền ghi):", fileError.message);
      console.log("💡 Dữ liệu vẫn được trả về để lưu vào database");
    }

    return allStations;

  } catch (err) {
    console.error("❌ Lỗi:", err.message);
    if (err.response) {
      console.error("Status:", err.response.status);
    }
    throw err; // Throw error để caller xử lý
  }
}

// Export hàm để server.js có thể import
module.exports = { crawl };

// Chỉ chạy nếu được gọi trực tiếp
if (require.main === module) {
  crawl();
}
