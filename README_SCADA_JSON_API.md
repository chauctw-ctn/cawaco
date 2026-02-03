# 📡 SCADA TVA JSON API - Tài liệu

## ✨ Cập nhật mới (Feb 2026)

**Phương pháp mới:** Sử dụng **JSON API endpoint** thay vì HTML parsing

### So sánh phương pháp

| Tiêu chí | API JSON ⚡ | HTML Parsing (cũ) |
|----------|-----------|-------------------|
| **Tốc độ** | ~3 giây | ~15 giây |
| **Độ tin cậy** | Cao | Trung bình |
| **Dữ liệu** | Realtime values | Historical table |
| **Bảo trì** | Dễ | Khó (thay đổi UI) |

---

## 🔌 JSON API Endpoint

```
GET /Scada/ClientApiSvc.svc/GetCurCnlDataExt
```

### Parameters

| Param | Value | Mô tả |
|-------|-------|-------|
| `cnlNums` | ` ` (space) | Channel numbers (space = all) |
| `viewIDs` | ` ` (space) | View IDs (space = all) |
| `viewID` | `16` | View hiện tại (16 = TRANG CHỦ) |
| `_` | timestamp | Cache buster |

### Response Format

```json
{
  "d": "{\"Success\":true,\"ErrorMessage\":\"\",\"Data\":[{\"CnlNum\":2902,\"Val\":30.34,\"Stat\":1,\"Text\":\"30.34\",\"TextWithUnit\":\"30.34\",\"Color\":\"Black\"}]}"
}
```

Lưu ý: Response có **nested JSON string** trong field `d`.

---

## 📊 Channel Mapping (25 channels → 8 stations)

### Giếng nước (4 stations)

#### G5_NM1 - GIẾNG G5 NHÀ MÁY 1
- **2902**: Mực Nước (m)
- **2904**: Lưu Lượng (m³/h)
- **2905**: Tổng Lưu Lượng (m³)

#### G6_NM1 - GIẾNG G6 NHÀ MÁY 1
- **2907**: Mực Nước (m)
- **2909**: Lưu Lượng (m³/h)
- **2910**: Tổng Lưu Lượng (m³)

#### G7_NM1 - GIẾNG G7 NHÀ MÁY 1
- **2912**: Mực Nước (m)
- **2914**: Lưu Lượng (m³/h)
- **2915**: Tổng Lưu Lượng (m³)

#### G8_NM2 - GIẾNG G8 NHÀ MÁY 2
- **2917**: Mực Nước (m)
- **2919**: Lưu Lượng (m³/h)
- **2920**: Tổng Lưu Lượng (m³)

### Quan trắc (4 stations)

#### QT1 - QUAN TRẮC QT1
- **2922**: Độ pH (pH)
- **2923**: Mực Nước (m)

#### QT2 - QUAN TRẮC QT2
- **2925**: Độ pH (pH)
- **2926**: Mực Nước (m)
- **2927**: Độ Dẫn Điện (µS/cm)

#### QT3 - QUAN TRẮC QT3
- **2928**: Độ pH (pH)
- **2929**: Mực Nước (m)
- **2930**: Độ Dẫn Điện (µS/cm)
- **2931**: TDS (mg/L)

#### QT4 - QUAN TRẮC QT4
- **2932**: Độ pH (pH)
- **2933**: Mực Nước (m)
- **2934**: Độ Dẫn Điện (µS/cm)
- **2935**: TDS (mg/L)

---

## 💾 Output Data Format

### File: `data_scada_tva.json`

```json
{
  "timestamp": "2026-02-03T12:51:29.386Z",
  "source": "SCADA_TVA",
  "method": "API_JSON",
  "totalChannels": 25,
  "totalStations": 8,
  "channels": [
    {
      "id": "G5_NM1_MỰC_NƯỚC",
      "name": "GIẾNG G5 NHÀ MÁY 1",
      "station": "G5_NM1",
      "parameter": "MỰC_NƯỚC",
      "parameterName": "Mực Nước",
      "channelNumber": 2902,
      "value": 30.40,
      "displayText": "30.40",
      "unit": "m",
      "status": "Online",
      "color": "Black",
      "group": "GIẾNG",
      "view": "API_REALTIME",
      "viewId": "16"
    }
  ],
  "stationsGrouped": {
    "G5_NM1": {
      "station": "G5_NM1",
      "stationName": "GIẾNG G5 NHÀ MÁY 1",
      "group": "GIẾNG",
      "parameters": [
        {
          "parameter": "MỰC_NƯỚC",
          "parameterName": "Mực Nước",
          "value": 30.40,
          "displayText": "30.40",
          "unit": "m",
          "status": "Online",
          "color": "Black",
          "channelNumber": 2902
        }
      ]
    }
  }
}
```

---

## 🚀 Sử dụng

### Crawl dữ liệu

```bash
# Test crawler
node -e "const { crawlScadaTVA } = require('./scada-tva-crawler.js'); crawlScadaTVA().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"

# Kết quả
# ✅ [SCADA] Đã lấy được 25 kênh dữ liệu
# 💾 [SCADA] Đã lưu dữ liệu vào data_scada_tva.json
#    📊 25 channels nhóm thành 8 trạm
```

### API Endpoints (Express server)

```javascript
// GET /api/scada/stations - Realtime crawl (~3s)
// GET /api/scada/cached - Đọc cache nhanh (~50ms)
// GET /api/scada/station/:id - Chi tiết 1 trạm
// POST /api/scada/update - Cập nhật thủ công (admin)

// Ví dụ
const response = await fetch('http://localhost:3000/api/scada/cached');
const data = await response.json();

console.log(data.stationsGrouped.G5_NM1);
// {
//   station: "G5_NM1",
//   stationName: "GIẾNG G5 NHÀ MÁY 1",
//   parameters: [...]
// }
```

---

## 🔧 Files

- **scada-tva-crawler.js** - Main crawler với API JSON
- **tva-channel-mapping.js** - Channel → Station mapping
- **data_scada_tva.json** - Cached data
- **README_SCADA_JSON_API.md** - File này

---

## 📝 Notes

### Login Flow
1. GET `/Scada/Login.aspx` → lấy ViewState, EventValidation
2. POST credentials → nhận session cookie
3. GET API endpoint với session cookie

### API Request
```javascript
const axios = require('axios');

const response = await axios.get(
  'http://14.161.36.253:86/Scada/ClientApiSvc.svc/GetCurCnlDataExt',
  {
    params: {
      cnlNums: ' ',
      viewIDs: ' ',
      viewID: 16,
      _: Date.now()
    },
    headers: {
      'Cookie': sessionCookie,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }
);

const data = JSON.parse(response.data.d);
console.log(data.Data); // Array of 25 channels
```

### Data Processing
```javascript
const { formatChannelData, groupByStation } = require('./tva-channel-mapping');

// Format 1 channel
const formatted = formatChannelData({
  CnlNum: 2902,
  Val: 30.40,
  Stat: 1,
  Text: "30.40",
  TextWithUnit: "30.40",
  Color: "Black"
});
// => { station: "G5_NM1", parameter: "MỰC_NƯỚC", ... }

// Group channels theo trạm
const grouped = groupByStation(channelsArray);
// => { G5_NM1: {...}, G6_NM1: {...}, ... }
```

---

## ⚠️ Fallback HTML Parsing

Nếu API JSON lỗi, crawler tự động chuyển sang HTML parsing:

```
⚠️ [SCADA API] Không lấy được dữ liệu từ API, chuyển sang HTML parsing...
📊 [SCADA HTML] Đang lấy dữ liệu từ: BÁO CÁO
```

HTML parsing vẫn hoạt động nhưng:
- Chậm hơn (15s vs 3s)
- Dữ liệu từ table views (không realtime)
- Dễ lỗi khi thay đổi giao diện

---

## 🎯 Migration Checklist

- [x] Tạo JSON API endpoint function
- [x] Tạo channel mapping (25 channels → 8 stations)
- [x] Ưu tiên API JSON trong crawler
- [x] Fallback HTML parsing
- [x] Update output format (channels + stationsGrouped)
- [x] Test và verify data
- [ ] Deploy lên Render
- [ ] Update frontend để hiển thị grouped stations

---

**Cập nhật:** 03/02/2026  
**Phiên bản:** 2.0 (JSON API)
