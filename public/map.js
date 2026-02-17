// Global variables
let map;
let markers = [];
let allStations = [];
let currentFilter = 'all';
let offlineTimeoutMinutes = 60; // Default 60 minutes
let serverTimestamp = null; // Server timestamp for consistent offline calculation

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = 'AIzaSyAyK0kR6vJbz16MxVEkYat34RKSALeLGrw_';

function createStationIcon(station) {
    const offline = isStationOffline(station);
    // Sử dụng PS_GR.gif cho trạm online, DIS.gif cho trạm offline
    const iconUrl = offline ? 'DIS.gif' : 'PS_GR.gif';
    
    return L.icon({
        iconUrl: iconUrl,
        iconSize: [32, 32],      // Kích thước icon
        iconAnchor: [16, 32],    // Điểm neo (giữa đáy icon)
        popupAnchor: [0, -32]    // Vị trí popup xuất hiện (phía trên icon)
    });
}

function enablePopupWheelZoom(popupEl) {
    if (!popupEl || !map) return;
    const content = popupEl.querySelector('.leaflet-popup-content');
    if (!content) return;

    // Remove existing handler if any (avoid stacking)
    if (content._popupWheelZoomHandler) {
        L.DomEvent.off(content, 'wheel', content._popupWheelZoomHandler);
        content._popupWheelZoomHandler = null;
    }

    const handler = function (e) {
        const delta = e.deltaY || e.detail || e.wheelDelta;
        const zoomDelta = delta > 0 ? -1 : 1;
        map.setZoom(map.getZoom() + zoomDelta);
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
    };

    content._popupWheelZoomHandler = handler;
    L.DomEvent.on(content, 'wheel', handler);
}

/**
 * Format date to dd/mm/yyyy HH:mm:ss theo GMT+7 (Việt Nam)
 */
function formatDateTime(date) {
    const d = new Date(date);
    // Format theo timezone Việt Nam (GMT+7)
    const formatter = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    return formatter.format(d);
}

/**
 * Load offline timeout from localStorage
 */
function loadOfflineTimeout() {
    const saved = localStorage.getItem('offlineTimeoutMinutes');
    if (saved) {
        offlineTimeoutMinutes = parseInt(saved);
        const input = document.getElementById('offline-timeout');
        if (input) {
            input.value = offlineTimeoutMinutes;
        }
    }
}

/**
 * Save offline timeout to localStorage
 */
function saveOfflineTimeout(minutes) {
    offlineTimeoutMinutes = minutes;
    localStorage.setItem('offlineTimeoutMinutes', minutes);
    console.log(`Offline timeout updated to ${minutes} minutes`);
    
    // Reload data from server with new timeout to recalculate hasValueChange
    loadStations();
}

/**
 * Check if station is offline (no value changes within configured time period)
 * Server determines this based on:
 * 1. Time since last data log in SQL
 * 2. Whether there are value changes within timeout period
 * If time > timeout AND no value changes → OFFLINE
 */
function isStationOffline(station) {
    // Server already calculated hasValueChange based on SQL data and timeout
    // Trust the server's calculation
    if (station.hasValueChange === false) {
        console.log(`   ❌ OFFLINE - ${station.name}: No value changes or data too old`);
        return true;
    }
    
    if (station.hasValueChange === true) {
        console.log(`   ✅ ONLINE - ${station.name}: Has value changes`);
        return false;
    }
    
    // Fallback: if hasValueChange is undefined, check timestamp
    const checkTime = station.lastUpdateInDB || station.updateTime;
    
    if (!checkTime) {
        console.log(`   ❌ OFFLINE - ${station.name}: No update time`);
        return true;
    }
    
    const updateTime = new Date(checkTime);
    // Use server timestamp if available, otherwise use client time
    const now = serverTimestamp ? new Date(serverTimestamp) : new Date();
    
    // Check if date is valid
    if (isNaN(updateTime.getTime())) {
        console.log(`   ❌ OFFLINE - ${station.name}: Invalid updateTime (${checkTime})`);
        return true;
    }
    
    const diffMinutes = (now - updateTime) / (1000 * 60);
    
    const status = diffMinutes > offlineTimeoutMinutes ? 'OFFLINE' : 'ONLINE';
    console.log(`   ${status === 'OFFLINE' ? '❌' : '✅'} ${status} - ${station.name}: Fallback check - ${diffMinutes.toFixed(2)} min since last update`);
    
    return diffMinutes > offlineTimeoutMinutes;
}

/**
 * Khởi tạo Leaflet Map
 */
function initMap() {
    // Tọa độ trung tâm Cà Mau
    const center = [9.177, 105.15];
    
    // Detect if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Tạo map với OpenStreetMap - optimized for mobile
    map = L.map('map', {
        scrollWheelZoom: true,
        wheelPxPerZoomLevel: 120,
        tap: isMobile,
        tapTolerance: 15,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: !isMobile,
        dragging: true,
        zoomControl: true,
        attributionControl: true
    }).setView(center, 16);

    // Expose for other scripts (e.g., header.js) to invalidate size
    window.map = map;
    window.leafletMap = map;
    
    // Tạo custom panes với z-index phù hợp để marker nằm trên labels và tooltips
    // Default panes: overlayPane(400), shadowPane(500), markerPane(600), tooltipPane(650), popupPane(700)
    
    // Custom tooltip pane với z-index thấp hơn marker
    map.createPane('customTooltipPane');
    map.getPane('customTooltipPane').style.zIndex = 615; // Thấp hơn marker để không che marker
    
    // Custom marker pane với z-index cao hơn để nằm trên labels và tooltips
    map.createPane('markerOnTopPane');
    map.getPane('markerOnTopPane').style.zIndex = 620; // Cao hơn tooltips để marker luôn hiển thị rõ
    
    // Tạo các tile layer miễn phí (không cần token)
    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });
    
    const cartoDBPositron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const cartoDBDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const cartoDBVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const esriWorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
    });
    
    const openTopoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        maxZoom: 17
    });
    
    const esriWorldStreetMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19
    });
    
    // Google Maps tile layers
    const googleRoadmap = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=' + GOOGLE_MAPS_API_KEY, {
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    
    const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=' + GOOGLE_MAPS_API_KEY, {
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=' + GOOGLE_MAPS_API_KEY, {
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    
    const googleTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&key=' + GOOGLE_MAPS_API_KEY, {
        attribution: '&copy; <a href="https://www.google.com/maps">Google Maps</a>',
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    
    // Thêm layer mặc định (Google Terrain)
    googleTerrain.addTo(map);
    
    // Thêm layer control để chọn loại bản đồ
    const baseMaps = {
        "OpenStreetMap": openStreetMap,
        "Google Roadmap": googleRoadmap,
        "Google Satellite": googleSatellite,
        "Google Hybrid": googleHybrid,
        "Google Terrain": googleTerrain,
        "CartoDB Positron (Sáng)": cartoDBPositron,
        "CartoDB Dark (Tối)": cartoDBDark,
        "CartoDB Voyager (Đầy màu)": cartoDBVoyager,
        "ESRI Satellite (Ảnh vệ tinh)": esriWorldImagery,
        "ESRI Street Map": esriWorldStreetMap,
        "OpenTopoMap (Địa hình)": openTopoMap
    };
    
    L.control.layers(baseMaps, null, {
        position: 'topright',
        collapsed: true
    }).addTo(map);
    
    // Fix: Cho phép zoom khi chuột ở trong popup
    map.on('popupopen', function(e) {
        const popupContainer = e.popup.getElement();
        if (popupContainer) {
            // Xóa class leaflet-container để không chặn scroll
            const popupContent = popupContainer.querySelector('.leaflet-popup-content-wrapper');
            if (popupContent) {
                L.DomEvent.off(popupContent, 'mousewheel');
                L.DomEvent.off(popupContent, 'MozMousePixelScroll');
            }
        }
    });
    
    // Tải dữ liệu ban đầu
    loadStations();
    
    // Setup event listeners
    setupEventListeners();
}

/**
 * Tải dữ liệu các trạm từ API
 */
async function loadStations() {
    showLoading(true);
    
    try {
        // Include timeout parameter in request
        const response = await fetch(`/api/stations?timeout=${offlineTimeoutMinutes}`);
        const data = await response.json();
        
        if (data.success) {
            allStations = data.stations;
            serverTimestamp = data.timestamp; // Store server timestamp
            updateStats(data.stations);
            displayMarkers(data.stations);
            
            // Hiển thị thời gian cập nhật
            console.log(`✅ Đã tải ${data.totalStations} trạm - Cập nhật lúc: ${formatDateTime(data.timestamp)}`);
        } else {
            console.error('Lỗi tải dữ liệu:', data.error);
            alert('Không thể tải dữ liệu trạm: ' + data.error);
        }
    } catch (error) {
        console.error('Lỗi kết nối:', error);
        alert('Không thể kết nối đến server');
    } finally {
        showLoading(false);
    }
}

/**
 * Làm mới dữ liệu các trạm (cập nhật popup đang mở mà không tạo lại markers)
 */
async function refreshStations() {
    try {
        // Include timeout parameter in request
        const response = await fetch(`/api/stations?timeout=${offlineTimeoutMinutes}`);
        const data = await response.json();
        
        if (data.success) {
            // Cập nhật allStations
            allStations = data.stations;
            serverTimestamp = data.timestamp; // Store server timestamp
            updateStats(data.stations);
            
            // Cập nhật dữ liệu + popup/icon/tooltip cho markers (kể cả popup đang đóng)
            markers.forEach(marker => {
                // Tìm station data mới cho marker này
                const newStationData = allStations.find(s => String(s.id) === String(marker.stationId));
                
                if (newStationData) {
                    // Cập nhật station data trong marker
                    marker.stationData = newStationData;

                    // Update marker icon (online/offline + type)
                    try {
                        marker.setIcon(createStationIcon(newStationData));
                    } catch (e) {
                        // ignore icon update failures
                    }

                    // Update tooltip content + class (online/offline)
                    try {
                        const offline = isStationOffline(newStationData);
                        const labelClass = offline ? 'station-label offline' : 'station-label';
                        if (marker.getTooltip()) {
                            marker.unbindTooltip();
                        }
                        marker.bindTooltip(newStationData.name, {
                            permanent: true,
                            direction: 'top',
                            offset: [0, -8],
                            className: labelClass,
                            pane: 'customTooltipPane'  // Sử dụng custom pane
                        });
                        if (!marker.isPopupOpen()) marker.openTooltip();
                    } catch (e) {
                        // ignore tooltip update failures
                    }

                    // Always update popup content so next open shows latest data
                    try {
                        const newContent = createPopupContent(newStationData);
                        const popup = marker.getPopup();
                        if (popup) popup.setContent(newContent);
                    } catch (e) {
                        // ignore popup update failures
                    }
                    
                    // Nếu popup đang mở, cập nhật nội dung
                    if (marker.isPopupOpen()) {
                        // Re-bind wheel-zoom handler after DOM content changed
                        setTimeout(() => {
                            const popup = marker.getPopup();
                            const popupEl = popup ? popup.getElement() : null;
                            enablePopupWheelZoom(popupEl);
                        }, 50);
                    }
                }
            });
            
            console.log(`🔄 Làm mới dữ liệu: ${data.totalStations} trạm - ${formatDateTime(data.timestamp)}`);
        }
    } catch (error) {
        console.error('Lỗi làm mới dữ liệu:', error);
    }
}

/**
 * Hiển thị markers trên bản đồ
 */
function displayMarkers(stations) {
    // Xóa markers cũ
    clearMarkers();
    
    // Sắp xếp stations: offline trước, online sau
    // Điều này đảm bảo offline markers được vẽ sau (lên trên) online markers
    const sortedStations = [...stations].sort((a, b) => {
        const aOffline = isStationOffline(a);
        const bOffline = isStationOffline(b);
        // Online (false) trước, Offline (true) sau để offline vẽ lên trên
        return aOffline === bOffline ? 0 : (aOffline ? 1 : -1);
    });
    
    // Tạo mảng lưu tọa độ
    const bounds = [];
    
    // Tạo markers mới
    sortedStations.forEach(station => {
        if (!station.lat || !station.lng) return;
        
        const position = [station.lat, station.lng];
        
        // Thêm vào bounds
        bounds.push(position);
        
        // Check if station is offline
        const offline = isStationOffline(station);

        // Tạo custom icon
        const customIcon = createStationIcon(station);
        
        // Tạo marker với custom pane để nằm trên labels
        const marker = L.marker(position, { 
            icon: customIcon,
            pane: 'markerOnTopPane'  // Sử dụng custom pane với z-index cao
        }).addTo(map);
        
        // Lưu thông tin station vào marker
        marker.stationId = station.id;
        marker.stationName = station.name;
        marker.stationData = station; // Lưu toàn bộ data để cập nhật sau
        
        // Tạo label (tooltip) hiển thị luôn với custom pane
        const labelClass = offline ? 'station-label offline' : 'station-label';
        const tooltip = marker.bindTooltip(station.name, {
            permanent: true,
            direction: 'top',
            offset: [0, -8],
            className: labelClass,
            pane: 'customTooltipPane'  // Sử dụng custom pane với z-index thấp hơn marker
        });
        
        // Tạo popup content (có tên trạm)
        const popupContent = createPopupContent(station);
        
        // Bind popup chỉ hiện khi click
        const popup = marker.bindPopup(popupContent, {
            className: 'custom-popup',
            maxWidth: 280,
            closeButton: true,
            autoClose: false,
            closeOnClick: false
        });
        
        // Lưu popup reference vào marker
        marker.popupInstance = marker.getPopup();
        
        // Ẩn tooltip khi popup mở
        marker.on('popupopen', function() {
            this.closeTooltip();
            // Cập nhật checkbox tương ứng
            updateStationCheckbox(station.id, true);
            
            // FIX: Cho phép zoom bằng scroll wheel khi chuột ở trong popup
            setTimeout(() => {
                const popupEl = this.getPopup().getElement();
                enablePopupWheelZoom(popupEl);
            }, 50);
        });
        
        // Hiện lại tooltip khi popup đóng
        marker.on('popupclose', function() {
            this.openTooltip();
            // Cập nhật checkbox tương ứng
            updateStationCheckbox(station.id, false);
        });
        
        markers.push(marker);
    });
    
    // Auto zoom vừa khít tất cả trạm
    if (bounds.length > 0) {
        map.fitBounds(bounds, {
            padding: [10, 10],
            maxZoom: 16
        });
    }
}

/**
 * Tạo nội dung popup giống hình mẫu
 */
function createPopupContent(station) {
    const stationType = station.type.toLowerCase();
    const stationClass = stationType;
    
    // Check if station is offline
    const offline = isStationOffline(station);
    
    // Format update time to dd/mm/yyyy HH:mm:ss
    // Sử dụng timestamp từ database (created_at) để đồng bộ với bảng thống kê dữ liệu
    let formattedUpdateTime = 'N/A';
    
    // timestamp từ server đã được convert về GMT+7 từ created_at
    const dbTimestamp = station.timestamp;
    
    if (dbTimestamp) {
        try {
            const updateDate = new Date(dbTimestamp);
            if (!isNaN(updateDate.getTime())) {
                formattedUpdateTime = formatDateTime(updateDate);
            } else if (station.updateTime) {
                formattedUpdateTime = station.updateTime;
            }
        } catch (e) {
            formattedUpdateTime = station.updateTime || 'N/A';
        }
    } else if (station.updateTime) {
        // Fallback: use pre-formatted updateTime
        formattedUpdateTime = station.updateTime;
    }
    
    // Add offline status
    const statusHtml = offline 
        ? '<div class="popup-status offline">⚠️ OFFLINE</div>' 
        : '<div class="popup-status online">✓ ONLINE</div>';
    
    let html = `
        <div class="station-popup ${stationClass}">
            <div class="popup-header">${station.name}</div>
            ${statusHtml}
            <div class="popup-time">${formattedUpdateTime}</div>
            <div class="popup-data">
    `;
    
    // Kiểm tra xem có thông số mực nước và lưu lượng không
    let hasWaterLevel = false;
    let hasFlowRate = false;
    const displayedParams = new Set(); // Tránh hiển thị trùng lặp
    
    // Hiển thị các thông số
    if (station.data && station.data.length > 0) {
        station.data.forEach(param => {
            // Làm ngắn tên thông số và xác định thông số chất lượng nước
            let shortName = param.name;
            const paramNameLower = param.name.toLowerCase();
            let isWaterQuality = false;
            let qualityClass = '';
            const paramValue = parseFloat(param.value);
            
            // Phân loại parameter dựa trên TÊN và GIÁ TRỊ
            // Kiểm tra "tổng lưu lượng" trước để tránh trùng với "lưu lượng"
            if (paramNameLower.includes('tổng') && paramNameLower.includes('lưu lượng')) {
                shortName = 'Tổng LL';
                // Hiển thị Tổng LL trong popup
            }
            else if (paramNameLower.includes('tổng ll') || (paramNameLower.includes('tổng') && !isNaN(paramValue) && paramValue > 1000)) {
                // Tổng LL - hiển thị
                shortName = 'Tổng LL';
            }
            else if (paramNameLower.includes('lưu lượng')) {
                shortName = 'Lưu lượng';
                hasFlowRate = true;
            }
            else if (paramNameLower.includes('áp lực') || paramNameLower.includes('ap luc')) {
                shortName = 'Áp lực';
            }
            else if (paramNameLower.includes('chỉ số')) {
                shortName = 'Chỉ số đh';
            }
            else if (paramNameLower.includes('mực nước') || paramNameLower.includes('muc nuoc')) {
                shortName = 'Mực nước';
                hasWaterLevel = true;
            }
            else if (paramNameLower.includes('nhiệt độ') || paramNameLower.includes('nhiet do')) {
                shortName = 'Nhiệt độ';
            }
            // Thông số chất lượng nước
            else if (paramNameLower.includes('ph')) {
                shortName = 'pH';
                isWaterQuality = true;
                const value = parseFloat(param.value);
                if (!isNaN(value)) {
                    if (value >= 6.5 && value <= 8.5) qualityClass = 'good';
                    else qualityClass = 'warning';
                }
            }
            else if (paramNameLower.includes('tds')) {
                shortName = 'TDS';
                isWaterQuality = true;
                const value = parseFloat(param.value);
                if (!isNaN(value)) {
                    if (value <= 1000) qualityClass = 'good';
                    else if (value <= 1500) qualityClass = 'warning';
                    else qualityClass = 'danger';
                }
            }
            else if (paramNameLower.includes('amoni')) {
                shortName = 'Amoni';
                isWaterQuality = true;
                const value = parseFloat(param.value);
                if (!isNaN(value)) {
                    if (value <= 3) qualityClass = 'good';
                    else qualityClass = 'warning';
                }
            }
            else if (paramNameLower.includes('nitrat')) {
                shortName = 'Nitrat';
                isWaterQuality = true;
                const value = parseFloat(param.value);
                if (!isNaN(value)) {
                    if (value <= 15) qualityClass = 'good';
                    else qualityClass = 'warning';
                }
            }
            
            // Kiểm tra duplicate trước khi hiển thị - chỉ dựa vào shortName để tránh trùng lặp
            if (displayedParams.has(shortName)) {
                return; // Skip duplicate
            }
            displayedParams.add(shortName);
            
            const valueClass = isWaterQuality ? `water-quality ${qualityClass}` : stationClass;
            const qualityIcon = isWaterQuality && qualityClass === 'good' ? '✓' : 
                               isWaterQuality && qualityClass === 'warning' ? '⚠' : 
                               isWaterQuality && qualityClass === 'danger' ? '✕' : '';
            
            html += `
                <div class="data-row">
                    <span class="data-label">${shortName}</span>
                    <span class="data-value ${valueClass}">${qualityIcon} ${param.value} ${param.unit}</span>
                </div>
            `;
        });
    } else {
        html += '<div class="no-data">Không có dữ liệu</div>';
    }
    
    html += `
            </div>`;
    
    // Thêm nút xem biểu đồ nếu có ít nhất 1 thông số
    const availableParams = [];
    if (hasWaterLevel) availableParams.push({ name: 'Mực nước', unit: 'm' });
    if (hasFlowRate) availableParams.push({ name: 'Lưu lượng', unit: 'm³/h' });
    
    // Debug logging
    console.log(`Station ${station.name}: hasWaterLevel=${hasWaterLevel}, hasFlowRate=${hasFlowRate}, availableParams=`, availableParams);
    
    if (availableParams.length > 0) {
        const paramsJson = JSON.stringify(availableParams).replace(/"/g, '&quot;');
        html += `
            <div class="popup-actions">
                <button class="chart-btn" onclick='showMultiParameterChart("${station.id}", "${station.name.replace(/"/g, '&quot;')}", ${paramsJson})'
                    style="width: 100%; padding: 8px 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
                    font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;
                    transition: all 0.2s;" 
                    onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(102,126,234,0.4)'"
                    onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="20" x2="12" y2="10"/>
                        <line x1="18" y1="20" x2="18" y2="4"/>
                        <line x1="6" y1="20" x2="6" y2="16"/>
                    </svg>
                    <span>Xem biểu đồ</span>
                </button>
            </div>`;
    }
    
    html += `
        </div>
    `;
    
    return html;
}

/**
 * Xóa tất cả markers
 */
function clearMarkers() {
    markers.forEach(marker => marker.remove());
    markers = [];
}

/**
 * Cập nhật thống kê và group counts
 */
function updateStats(stations) {
    const onlineStations = stations.filter(s => !isStationOffline(s));
    const offlineStations = stations.filter(s => isStationOffline(s));
    
    // Update station group stats
    const mqttStations = stations.filter(s => s.type === 'MQTT');
    const tvaStations = stations.filter(s => s.type === 'TVA');
    const scadaStations = stations.filter(s => s.type === 'SCADA');
    
    // Calculate online/offline for each group
    const mqttOnline = mqttStations.filter(s => !isStationOffline(s)).length;
    const tvaOnline = tvaStations.filter(s => !isStationOffline(s)).length;
    const scadaOnline = scadaStations.filter(s => !isStationOffline(s)).length;
    
    // Update group counts in filter labels
    const allCountEl = document.getElementById('all-count');
    const tvaCountEl = document.getElementById('tva-count');
    const mqttCountEl = document.getElementById('mqtt-count');
    const scadaCountEl = document.getElementById('scada-count');
    
    if (allCountEl) allCountEl.textContent = `(${onlineStations.length}/${stations.length})`;
    if (tvaCountEl) tvaCountEl.textContent = `(${tvaOnline}/${tvaStations.length})`;
    if (mqttCountEl) mqttCountEl.textContent = `(${mqttOnline}/${mqttStations.length})`;
    if (scadaCountEl) scadaCountEl.textContent = `(${scadaOnline}/${scadaStations.length})`;
    
    // Populate station checkbox list
    populateStationCheckboxList(stations);
}

/**
 * Populate danh sách checkbox trạm trong map dropdown
 */
function populateStationCheckboxList(stations) {
    // Populate map dropdown only
    const listContainer = document.getElementById('station-checkbox-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    stations.forEach(station => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'station-checkbox';
        checkbox.value = station.id;
        checkbox.dataset.stationId = station.id;
        
        let iconColor = 'mqtt';
        if (station.type === 'TVA') iconColor = 'tva';
        else if (station.type === 'SCADA') iconColor = 'scada';
        
        const span = document.createElement('span');
        span.innerHTML = `<span class="filter-dot ${iconColor}"></span> ${station.name}`;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        listContainer.appendChild(label);
        
        // Event listener cho checkbox
        checkbox.addEventListener('change', (e) => {
            handleStationCheckboxChange(station.id, e.target.checked);
            updateStationAllCheckbox();
            updateStationDropdownDisplay();
        });
    });
    
    // Setup event listener cho checkbox "Tất cả"
    const stationAllCheckbox = document.getElementById('station-all-checkbox');
    
    if (stationAllCheckbox) {
        // Remove old listeners
        const newCheckbox = stationAllCheckbox.cloneNode(true);
        stationAllCheckbox.parentNode.replaceChild(newCheckbox, stationAllCheckbox);
        
        newCheckbox.addEventListener('change', (e) => {
            handleStationAllCheckboxChange(e.target.checked);
        });
    }
    
    updateStationDropdownDisplay();
}

/**
 * Cập nhật text hiển thị của dropdown trên map
 */
function updateStationDropdownDisplay() {
    const displayText = document.querySelector('#station-display .selected-text');
    if (!displayText) return;
    
    const checkboxes = document.querySelectorAll('.station-checkbox:checked');
    const count = checkboxes.length;
    const totalStations = document.querySelectorAll('.station-checkbox').length;
    
    if (count === 0) {
        displayText.textContent = 'Chọn trạm...';
    } else if (count === totalStations) {
        displayText.textContent = 'Tất cả trạm';
    } else if (count === 1) {
        const stationName = checkboxes[0].parentElement.querySelector('span:last-child').textContent.trim();
        displayText.textContent = stationName;
    } else {
        displayText.textContent = `Đã chọn ${count} trạm`;
    }
}

/**
 * Xử lý khi check/uncheck checkbox "Tất cả"
 */
function handleStationAllCheckboxChange(isChecked) {
    const checkboxes = document.querySelectorAll('.station-checkbox');
    
    checkboxes.forEach(checkbox => {
        if (checkbox.checked !== isChecked) {
            checkbox.checked = isChecked;
            const stationId = checkbox.dataset.stationId;
            handleStationCheckboxChange(stationId, isChecked);
        }
    });
    
    updateStationDropdownDisplay();
}

/**
 * Cập nhật trạng thái checkbox "Tất cả" dựa trên các checkbox trạm
 */
function updateStationAllCheckbox() {
    const stationAllCheckbox = document.getElementById('station-all-checkbox');
    if (!stationAllCheckbox) return;
    
    const checkboxes = document.querySelectorAll('.station-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
    
    // Nếu tất cả đều checked thì check "Tất cả", ngược lại thì uncheck
    stationAllCheckbox.checked = checkboxes.length > 0 && checkboxes.length === checkedCheckboxes.length;
}

/**
 * Xử lý khi check/uncheck checkbox trạm
 */
function handleStationCheckboxChange(stationId, isChecked) {
    // Tìm marker tương ứng
    const marker = markers.find(m => m.stationId === stationId);
    if (!marker) return;
    
    if (isChecked) {
        // Mở popup của trạm
        marker.openPopup();
    } else {
        // Đóng popup
        marker.closePopup();
    }
}

/**
 * Cập nhật trạng thái checkbox khi popup mở/đóng
 */
function updateStationCheckbox(stationId, isChecked) {
    const checkbox = document.querySelector(`.station-checkbox[data-station-id="${stationId}"]`);
    if (checkbox) {
        checkbox.checked = isChecked;
    }
}

/**
 * Lọc trạm theo dropdown status filter
 */
function filterStations() {
    const statusFilter = document.getElementById('status-filter');
    
    if (!statusFilter) {
        displayMarkers(allStations);
        return;
    }
    
    const filterValue = statusFilter.value;
    let filteredStations = [];
    
    switch(filterValue) {
        case 'all':
            filteredStations = allStations;
            break;
        case 'online':
            filteredStations = allStations.filter(s => !isStationOffline(s));
            break;
        case 'offline':
            filteredStations = allStations.filter(s => isStationOffline(s));
            break;
        default:
            filteredStations = allStations;
    }
    
    displayMarkers(filteredStations);
}

/**
 * Hiển thị/ẩn loading
 */
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar');
    const mapElement = document.getElementById('map');

    // Sidebar is controlled globally by header.js; just react and resize the map.
    window.addEventListener('sidebar:toggled', () => {
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 360);
    });

    // Also invalidate on actual container resize (covers edge cases)
    if (mapElement && 'ResizeObserver' in window) {
        let resizeRaf = 0;
        const ro = new ResizeObserver(() => {
            if (!map) return;
            cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => map.invalidateSize());
        });
        ro.observe(mapElement);
    }
    
    // Dashboard button - Toggle filters visibility
    const dashboardBtn = document.getElementById('dashboard-btn');
    const dashboardContent = document.getElementById('dashboard-content');
    if (dashboardBtn && dashboardContent) {
        dashboardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            dashboardBtn.classList.toggle('expanded');
            dashboardContent.classList.toggle('active');
        });
    }
    
    // Stats toggle button - redirect to stats page
    const statsToggleBtn = document.getElementById('stats-toggle-btn');
    if (statsToggleBtn) {
        statsToggleBtn.addEventListener('click', () => {
            if (window.smoothNavigate) {
                window.smoothNavigate('/stats.html');
            } else {
                window.location.href = '/stats.html';
            }
        });
    }
    
    // Station dropdown toggle
    const stationDisplay = document.getElementById('station-display');
    const stationDropdown = document.getElementById('station-dropdown');
    
    if (stationDisplay && stationDropdown) {
        stationDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            stationDropdown.classList.toggle('show');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!stationDropdown.contains(e.target) && !stationDisplay.contains(e.target)) {
                stationDropdown.classList.remove('show');
            }
        });
    }
    
    // Status filter dropdown event listener
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            filterStations();
        });
    }
    
    // Offline timeout input handler
    const offlineTimeoutInput = document.getElementById('offline-timeout');
    if (offlineTimeoutInput) {
        // Load saved timeout
        loadOfflineTimeout();
        
        // Handle changes
        offlineTimeoutInput.addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 1) {
                value = 1;
                e.target.value = 1;
            } else if (value > 1440) {
                value = 1440;
                e.target.value = 1440;
            }
            saveOfflineTimeout(value);
        });
    }
    
    // Handle window resize for overlay visibility
    window.addEventListener('resize', () => {
        // Keep overlay state consistent with header.js behavior
        if (!sidebarOverlay || !sidebar) return;
        const open = sidebar.classList.contains('active');
        const showOverlay = open && window.innerWidth <= 768;
        sidebarOverlay.classList.toggle('active', showOverlay);
        sidebarOverlay.classList.toggle('show', showOverlay);
        if (map) map.invalidateSize();
    });
    
    // Auto refresh dữ liệu mỗi 30 giây (MQTT realtime) và mỗi 2 phút (TVA)
    setInterval(() => {
        console.log('🔄 Tự động làm mới dữ liệu...');
        refreshStations();
    }, 30 * 1000); // 30 giây
    
    // Group filter checkboxes
    setupGroupFilters();
}

/**
 * Setup bộ lọc theo nhóm
 */
function setupGroupFilters() {
    // Group filter elements
    const filterAll = document.getElementById('filter-all');
    const filterTva = document.getElementById('filter-tva');
    const filterMqtt = document.getElementById('filter-mqtt');
    const filterScada = document.getElementById('filter-scada');
    
    if (!filterAll || !filterTva || !filterMqtt || !filterScada) return;
    
    // Xử lý checkbox "Tất cả nhóm"
    filterAll.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        filterTva.checked = isChecked;
        filterMqtt.checked = isChecked;
        filterScada.checked = isChecked;
        applyGroupFilters();
    });
    
    // Xử lý các checkbox nhóm riêng lẻ
    [filterTva, filterMqtt, filterScada].forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            // Cập nhật trạng thái checkbox "Tất cả"
            filterAll.checked = filterTva.checked && filterMqtt.checked && filterScada.checked;
            applyGroupFilters();
        });
    });
}

/**
 * Áp dụng bộ lọc theo nhóm
 */
function applyGroupFilters() {
    // Group filter elements
    const filterTva = document.getElementById('filter-tva');
    const filterMqtt = document.getElementById('filter-mqtt');
    const filterScada = document.getElementById('filter-scada');
    
    if (!filterTva || !filterMqtt || !filterScada) {
        displayMarkers(allStations);
        return;
    }
    
    const showTva = filterTva.checked;
    const showMqtt = filterMqtt.checked;
    const showScada = filterScada.checked;
    
    // Lọc trạm theo nhóm
    let filteredStations = allStations.filter(station => {
        if (station.type === 'TVA' && showTva) return true;
        if (station.type === 'MQTT' && showMqtt) return true;
        if (station.type === 'SCADA' && showScada) return true;
        return false;
    });
    
    // Cập nhật danh sách checkbox trong map dropdown
    populateStationCheckboxList(filteredStations);
    
    // Hiển thị markers
    displayMarkers(filteredStations);
}

/**
 * Cập nhật thời gian hiện tại
 */
function updateCurrentTime() {
    const currentTimeElement = document.getElementById('current-time');
    if (currentTimeElement) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        currentTimeElement.textContent = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }
}

// Khởi tạo map khi DOM ready
document.addEventListener('DOMContentLoaded', function() {
    initMap();
});

/**
 * Helper function to format date to dd/mm/yyyy
 */
function formatDateToDDMMYYYY(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Helper function to parse dd/mm/yyyy to yyyy-mm-dd
 */
function parseDDMMYYYYToYYYYMMDD(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const day = parts[0];
    const month = parts[1];
    const year = parts[2];
    return `${year}-${month}-${day}`;
}

/**
 * Global variables for chart
 */
let currentChart = null;
let currentChartStationId = null;
let currentChartStationName = null;
let currentChartParameter = null;
let currentChartUnit = null;
let currentAvailableParameters = [];

/**
 * Show multi-parameter chart modal
 */
function showMultiParameterChart(stationId, stationName, availableParams) {
    currentChartStationId = stationId;
    currentChartStationName = stationName;
    currentAvailableParameters = availableParams;
    
    const modal = document.getElementById('chart-modal');
    const modalTitle = document.getElementById('chart-modal-title');
    const startDateInput = document.getElementById('chart-start-date');
    const endDateInput = document.getElementById('chart-end-date');
    const parametersContainer = document.getElementById('chart-parameters');
    
    if (!modal || !modalTitle || !startDateInput || !endDateInput || !parametersContainer) {
        console.error('Chart modal elements not found');
        return;
    }
    
    // Set modal title
    modalTitle.textContent = `Biểu đồ dữ liệu - ${stationName}`;
    
    // Create parameter checkboxes
    parametersContainer.innerHTML = '';
    availableParams.forEach((param, index) => {
        const checkbox = document.createElement('label');
        checkbox.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px 12px; background: #f3f4f6; border-radius: 6px; font-size: 14px;';
        checkbox.innerHTML = `
            <input type="checkbox" class="param-checkbox" value="${param.name}" data-unit="${param.unit}" 
                checked 
                style="width: 18px; height: 18px; cursor: pointer;">
            <span>${param.name} (${param.unit})</span>
        `;
        parametersContainer.appendChild(checkbox);
    });
    
    // Set default dates (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    endDateInput.value = formatDateToDDMMYYYY(endDate);
    startDateInput.value = formatDateToDDMMYYYY(startDate);
    
    // Show modal
    modal.style.display = 'block';
    
    // Initialize Flatpickr for date inputs
    if (typeof flatpickr !== 'undefined') {
        flatpickr(startDateInput, {
            dateFormat: 'd/m/Y',
            defaultDate: startDateInput.value,
            allowInput: true,
            locale: {
                firstDayOfWeek: 1
            }
        });
        
        flatpickr(endDateInput, {
            dateFormat: 'd/m/Y',
            defaultDate: endDateInput.value,
            allowInput: true,
            locale: {
                firstDayOfWeek: 1
            }
        });
    }
    
    // Auto-load chart with default dates
    setTimeout(() => loadChartData(), 100);
}

/**
 * Show parameter chart modal (water level, flow rate, etc.) - backward compatibility
 */
function showParameterChart(stationId, stationName, parameterName, unit) {
    showMultiParameterChart(stationId, stationName, [{ name: parameterName, unit: unit }]);
}

// Backward compatibility - keep old function name
function showWaterLevelChart(stationId, stationName) {
    showParameterChart(stationId, stationName, 'Mực nước', 'm');
}

/**
 * Load chart data from API
 */
async function loadChartData() {
    const startDateInput = document.getElementById('chart-start-date');
    const endDateInput = document.getElementById('chart-end-date');
    const chartLoading = document.getElementById('chart-loading');
    const chartError = document.getElementById('chart-error');
    const chartContainer = document.getElementById('chart-container');
    
    if (!startDateInput || !endDateInput) return;
    
    const startDateStr = startDateInput.value;
    const endDateStr = endDateInput.value;
    
    if (!startDateStr || !endDateStr) {
        chartError.textContent = 'Vui lòng chọn khoảng thời gian';
        return;
    }
    
    // Validate format dd/mm/yyyy
    const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    if (!datePattern.test(startDateStr) || !datePattern.test(endDateStr)) {
        chartError.textContent = 'Định dạng ngày không đúng. Vui lòng nhập dd/mm/yyyy';
        return;
    }
    
    // Parse dates from dd/mm/yyyy to yyyy-mm-dd
    const startDate = parseDDMMYYYYToYYYYMMDD(startDateStr);
    const endDate = parseDDMMYYYYToYYYYMMDD(endDateStr);
    
    // Validate dates
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        chartError.textContent = 'Ngày không hợp lệ';
        return;
    }
    
    if (startDateObj > endDateObj) {
        chartError.textContent = 'Ngày bắt đầu phải nhỏ hơn ngày kết thúc';
        return;
    }
    
    // Get selected parameters
    const selectedParams = [];
    document.querySelectorAll('.param-checkbox:checked').forEach(checkbox => {
        selectedParams.push({
            name: checkbox.value,
            unit: checkbox.getAttribute('data-unit')
        });
    });
    
    if (selectedParams.length === 0) {
        chartError.textContent = 'Vui lòng chọn ít nhất 1 thông số';
        return;
    }
    
    chartError.textContent = '';
    chartLoading.style.display = 'block';
    chartContainer.style.display = 'none';
    
    try {
        // Fetch data for all selected parameters
        const allData = [];
        
        for (const param of selectedParams) {
            const params = new URLSearchParams({
                stations: currentChartStationId,
                parameter: param.name,
                startDate: startDate,
                endDate: endDate,
                limit: 10000
            });
            
            const response = await fetch(`/api/stats?${params.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Không thể tải dữ liệu');
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Lỗi không xác định');
            }
            
            if (result.data && result.data.length > 0) {
                // Lọc dữ liệu: Nếu parameter là "Lưu lượng", chỉ lấy giá trị <= 1000
                // để tránh lấy nhầm data của "Tổng lưu lượng"
                let filteredData = result.data;
                if (param.name === 'Lưu lượng') {
                    filteredData = result.data.filter(record => {
                        const value = parseFloat(record.value);
                        const paramName = (record.parameter_name || '').toLowerCase();
                        
                        // Loại bỏ nếu:
                        // 1. Giá trị > 1000 (gần như chắc chắn là Tổng LL)
                        // 2. Parameter name có chứa "tổng"
                        if (!isNaN(value) && value > 1000) {
                            console.log(`Filtering out large flow value: ${value} from ${record.station_name}`);
                            return false;
                        }
                        if (paramName.includes('tổng')) {
                            console.log(`Filtering out "Tổng" parameter: ${record.parameter_name}`);
                            return false;
                        }
                        
                        return true;
                    });
                    
                    console.log(`Lưu lượng data: ${result.data.length} records -> ${filteredData.length} after filtering`);
                }
                
                if (filteredData.length > 0) {
                    allData.push({
                        parameter: param.name,
                        unit: param.unit,
                        data: filteredData
                    });
                }
            }
        }
        
        if (allData.length === 0) {
            chartError.textContent = 'Không có dữ liệu trong khoảng thời gian này';
            chartLoading.style.display = 'none';
            return;
        }
        
        // Display chart
        displayMultiParameterChart(allData);
        
        chartLoading.style.display = 'none';
        chartContainer.style.display = 'block';
        
    } catch (error) {
        console.error('Error loading chart data:', error);
        chartError.textContent = 'Lỗi tải dữ liệu: ' + error.message;
        chartLoading.style.display = 'none';
    }
}

/**
 * Process data for chart
 */
function processChartData(data) {
    // Sort by timestamp
    data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const labels = [];
    const values = [];
    
    data.forEach(record => {
        const date = new Date(record.timestamp);
        const label = formatDateTime(date);
        labels.push(label);
        values.push(record.value);
    });
    
    return { labels, values };
}

/**
 * Display multi-parameter chart using Chart.js
 */
function displayMultiParameterChart(allData) {
    const canvas = document.getElementById('water-level-chart');
    
    if (!canvas) {
        console.error('Chart canvas not found');
        return;
    }
    
    // Destroy existing chart if any
    if (currentChart) {
        currentChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    // Define colors for different parameters
    const paramColors = {
        'Mực nước': { border: 'rgb(59, 130, 246)', bg: 'rgba(59, 130, 246, 0.1)' },
        'Lưu lượng': { border: 'rgb(239, 68, 68)', bg: 'rgba(239, 68, 68, 0.1)' },
        'Nhiệt độ': { border: 'rgb(239, 68, 68)', bg: 'rgba(239, 68, 68, 0.1)' },
        'Áp lực': { border: 'rgb(168, 85, 247)', bg: 'rgba(168, 85, 247, 0.1)' }
    };
    
    // Collect all unique timestamps
    const allTimestamps = new Set();
    allData.forEach(paramData => {
        paramData.data.forEach(record => {
            allTimestamps.add(record.timestamp);
        });
    });
    
    // Sort timestamps
    const sortedTimestamps = Array.from(allTimestamps).sort();
    const labels = sortedTimestamps.map(ts => formatDateTime(new Date(ts)));
    
    // Create datasets
    const datasets = allData.map(paramData => {
        const color = paramColors[paramData.parameter] || { 
            border: 'rgb(107, 114, 128)', 
            bg: 'rgba(107, 114, 128, 0.1)' 
        };
        
        // Create data array aligned with timestamps
        const dataValues = sortedTimestamps.map(ts => {
            const record = paramData.data.find(r => r.timestamp === ts);
            return record ? record.value : null;
        });
        
        return {
            label: `${paramData.parameter} (${paramData.unit})`,
            data: dataValues,
            borderColor: color.border,
            backgroundColor: color.bg,
            borderWidth: 2,
            tension: 0.4,
            fill: false,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: color.border,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: true
        };
    });
    
    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 12
                        },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: {
                        size: 13,
                        family: 'Inter, sans-serif'
                    },
                    bodyFont: {
                        size: 12,
                        family: 'Inter, sans-serif'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 11
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 10
                        },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            }
        }
    });
}

/**
 * Display chart using Chart.js - single parameter (backward compatibility)
 */
function displayChart(chartData) {
    const canvas = document.getElementById('water-level-chart');
    
    if (!canvas) {
        console.error('Chart canvas not found');
        return;
    }
    
    // Destroy existing chart if any
    if (currentChart) {
        currentChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    // Chọn màu dựa trên loại thông số
    let borderColor = 'rgb(59, 130, 246)'; // Màu xanh dương mặc định
    let backgroundColor = 'rgba(59, 130, 246, 0.1)';
    
    if (currentChartParameter && currentChartParameter.toLowerCase().includes('lưu lượng')) {
        borderColor = 'rgb(239, 68, 68)'; // Màu đỏ cho lưu lượng
        backgroundColor = 'rgba(239, 68, 68, 0.1)';
    } else if (currentChartParameter && currentChartParameter.toLowerCase().includes('nhiệt')) {
        borderColor = 'rgb(239, 68, 68)'; // Màu đỏ cho nhiệt độ
        backgroundColor = 'rgba(239, 68, 68, 0.1)';
    }
    
    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: `${currentChartParameter} (${currentChartUnit})`,
                data: chartData.values,
                borderColor: borderColor,
                backgroundColor: backgroundColor,
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: borderColor,
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: {
                        size: 13,
                        family: 'Inter, sans-serif'
                    },
                    bodyFont: {
                        size: 12,
                        family: 'Inter, sans-serif'
                    },
                    callbacks: {
                        label: function(context) {
                            return `${currentChartParameter}: ${context.parsed.y} ${currentChartUnit}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 11
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    title: {
                        display: true,
                        text: `${currentChartParameter} (${currentChartUnit})`,
                        font: {
                            family: 'Inter, sans-serif',
                            size: 12,
                            weight: 'bold'
                        }
                    }
                },
                x: {
                    ticks: {
                        font: {
                            family: 'Inter, sans-serif',
                            size: 10
                        },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            }
        }
    });
}

// Initialize chart modal event listeners
(function() {
    const initChartModal = () => {
        const chartModal = document.getElementById('chart-modal');
        const closeChartModal = document.getElementById('close-chart-modal');
        const loadChartBtn = document.getElementById('load-chart-btn');
        
        if (closeChartModal) {
            closeChartModal.addEventListener('click', () => {
                if (chartModal) {
                    chartModal.style.display = 'none';
                    if (currentChart) {
                        currentChart.destroy();
                        currentChart = null;
                    }
                }
            });
        }
        
        if (chartModal) {
            chartModal.addEventListener('click', (e) => {
                if (e.target === chartModal) {
                    chartModal.style.display = 'none';
                    if (currentChart) {
                        currentChart.destroy();
                        currentChart = null;
                    }
                }
            });
        }
        
        if (loadChartBtn) {
            loadChartBtn.addEventListener('click', loadChartData);
        }
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChartModal);
    } else {
        initChartModal();
    }
})();

// Make functions available globally
window.showWaterLevelChart = showWaterLevelChart;
window.showParameterChart = showParameterChart;
window.showMultiParameterChart = showMultiParameterChart;
