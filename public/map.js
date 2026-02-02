// Global variables
let map;
let markers = [];
let allStations = [];
let currentFilter = 'all';
let offlineTimeoutMinutes = 60; // Default 60 minutes

/**
 * Format date to dd/mm/yyyy HH:mm:ss
 */
function formatDateTime(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
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
    
    // Refresh markers to apply new timeout
    if (allStations.length > 0) {
        displayMarkers(allStations);
    }
}

/**
 * Check if station is offline (no value changes within configured time period)
 * Uses hasValueChange flag from server (based on SQL analysis)
 */
function isStationOffline(station) {
    // Debug: log station data
    console.log(`🔍 Checking station: ${station.name}, hasValueChange=${station.hasValueChange}, lastUpdateInDB=${station.lastUpdateInDB}`);
    
    // Check if station has value changes within the timeout period
    // hasValueChange is calculated by server based on distinct values in timeframe
    if (station.hasValueChange === false) {
        console.log(`   ❌ OFFLINE - No value changes in last ${offlineTimeoutMinutes}min`);
        return true;
    }
    
    if (station.hasValueChange === true) {
        console.log(`   ✅ ONLINE - Has value changes`);
        return false;
    }
    
    // Fallback: check if lastUpdateInDB exists
    const checkTime = station.lastUpdateInDB || station.updateTime;
    
    if (!checkTime) {
        console.log(`   ❌ OFFLINE - No update time`);
        return true;
    }
    
    const updateTime = new Date(checkTime);
    const now = new Date();
    
    // Check if date is valid
    if (isNaN(updateTime.getTime())) {
        console.log(`   ❌ OFFLINE - Invalid updateTime (${checkTime})`);
        return true;
    }
    
    const diffMinutes = (now - updateTime) / (1000 * 60);
    
    const status = diffMinutes > offlineTimeoutMinutes ? 'OFFLINE' : 'ONLINE';
    console.log(`   ${status === 'OFFLINE' ? '❌' : '✅'} ${status} - Fallback check - diffMinutes=${diffMinutes.toFixed(2)}`);
    
    return diffMinutes > offlineTimeoutMinutes;
}

/**
 * Khởi tạo Leaflet Map
 */
function initMap() {
    // Tọa độ trung tâm Cà Mau
    const center = [9.177, 105.15];
    
    // Tạo map với OpenStreetMap
    map = L.map('map', {
        scrollWheelZoom: true,
        wheelPxPerZoomLevel: 120
    }).setView(center, 16);
    
    // Thêm tile layer OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 20
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
            updateStats(data.stations);
            
            // Cập nhật nội dung popup cho từng marker đang mở
            markers.forEach(marker => {
                // Tìm station data mới cho marker này
                const newStationData = allStations.find(s => s.id === marker.stationId);
                
                if (newStationData) {
                    // Cập nhật station data trong marker
                    marker.stationData = newStationData;
                    
                    // Nếu popup đang mở, cập nhật nội dung
                    if (marker.isPopupOpen()) {
                        const newContent = createPopupContent(newStationData);
                        marker.getPopup().setContent(newContent);
                        
                        // Fix zoom cho popup sau khi update content
                        setTimeout(() => {
                            const popupEl = marker.getPopup().getElement();
                            if (popupEl) {
                                const parent = popupEl.parentElement;
                                if (parent) {
                                    L.DomEvent.off(parent, 'wheel');
                                    L.DomEvent.off(parent, 'mousewheel');
                                    L.DomEvent.off(popupEl, 'wheel');
                                    L.DomEvent.off(popupEl, 'mousewheel');
                                }
                            }
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
    
    // Tạo mảng lưu tọa độ
    const bounds = [];
    
    // Tạo markers mới
    stations.forEach(station => {
        if (!station.lat || !station.lng) return;
        
        const position = [station.lat, station.lng];
        
        // Thêm vào bounds
        bounds.push(position);
        
        // Check if station is offline
        const offline = isStationOffline(station);
        
        // Tạo custom icon
        const iconColor = offline ? '#dc2626' : (station.type === 'TVA' ? '#10b981' : '#fbbf24');
        const blinkClass = offline ? 'blink' : '';
        const customIcon = L.divIcon({
            className: `custom-marker ${blinkClass}`,
            html: `<div class="marker-dot ${blinkClass}" style="background-color: ${iconColor}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        
        // Tạo marker
        const marker = L.marker(position, { icon: customIcon }).addTo(map);
        
        // Lưu thông tin station vào marker
        marker.stationId = station.id;
        marker.stationName = station.name;
        marker.stationData = station; // Lưu toàn bộ data để cập nhật sau
        
        // Tạo label (tooltip) hiển thị luôn
        const labelClass = offline ? 'station-label offline' : 'station-label';
        const tooltip = marker.bindTooltip(station.name, {
            permanent: true,
            direction: 'top',
            offset: [0, -8],
            className: labelClass
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
                if (popupEl) {
                    const content = popupEl.querySelector('.leaflet-popup-content');
                    if (content) {
                        // Enable scroll propagation để map có thể zoom
                        L.DomEvent.on(content, 'wheel', function(e) {
                            // Tính toán zoom mới
                            const delta = e.deltaY || e.detail || e.wheelDelta;
                            const zoomDelta = delta > 0 ? -1 : 1;
                            map.setZoom(map.getZoom() + zoomDelta);
                            L.DomEvent.preventDefault(e);
                            L.DomEvent.stopPropagation(e);
                        });
                    }
                }
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
    let formattedUpdateTime = 'N/A';
    if (station.updateTime) {
        try {
            // Try to parse the date (handles both ISO and other formats)
            const updateDate = new Date(station.updateTime);
            if (!isNaN(updateDate.getTime())) {
                formattedUpdateTime = formatDateTime(updateDate);
            } else {
                // If parsing fails, try to use the string as is
                formattedUpdateTime = station.updateTime;
            }
        } catch (e) {
            // If any error, use the string as is
            formattedUpdateTime = station.updateTime || 'N/A';
        }
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
    
    // Hiển thị các thông số
    if (station.data && station.data.length > 0) {
        station.data.forEach(param => {
            // Làm ngắn tên thông số
            let shortName = param.name;
            if (param.name.includes('Áp lực') || param.name.includes('Ap luc')) shortName = 'Áp lực';
            else if (param.name.includes('Lưu lượng')) shortName = 'Lưu lượng';
            else if (param.name.includes('Chỉ số')) shortName = 'Chỉ số đh';
            else if (param.name.includes('Mực nước')) shortName = 'Mực nước';
            else if (param.name.includes('Nhiệt độ')) shortName = 'Nhiệt độ';
            else if (param.name.includes('Tổng')) shortName = 'Tổng LL';
            
            html += `
                <div class="data-row">
                    <span class="data-label">${shortName}</span>
                    <span class="data-value ${stationClass}">${param.value} ${param.unit}</span>
                </div>
            `;
        });
    } else {
        html += '<div class="no-data">Không có dữ liệu</div>';
    }
    
    html += `
            </div>
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
 * Cập nhật thống kê
 */
function updateStats(stations) {
    const onlineStations = stations.filter(s => !isStationOffline(s));
    const offlineStations = stations.filter(s => isStationOffline(s));
    
    document.getElementById('online-count').textContent = onlineStations.length;
    document.getElementById('offline-count').textContent = offlineStations.length;
    document.getElementById('total-count').textContent = stations.length;
    
    // Populate station checkbox list
    populateStationCheckboxList(stations);
}

/**
 * Populate danh sách checkbox trạm trong sidebar
 */
function populateStationCheckboxList(stations) {
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
        
        const iconColor = station.type === 'TVA' ? 'tva' : 'mqtt';
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
        stationAllCheckbox.addEventListener('change', (e) => {
            handleStationAllCheckboxChange(e.target.checked);
        });
    }
    
    updateStationDropdownDisplay();
}

/**
 * Cập nhật text hiển thị của dropdown
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
    // Menu button toggle sidebar
    const menuBtn = document.getElementById('menu-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mapElement = document.getElementById('map');
    
    if (menuBtn && sidebar && mapElement) {
        menuBtn.addEventListener('click', () => {
            const isHidden = sidebar.classList.toggle('hidden');
            
            if (isHidden) {
                mapElement.classList.remove('with-sidebar');
                if (sidebarOverlay) sidebarOverlay.classList.remove('show');
            } else {
                mapElement.classList.add('with-sidebar');
                // Show overlay on mobile
                if (window.innerWidth <= 768 && sidebarOverlay) {
                    sidebarOverlay.classList.add('show');
                }
            }
            
            // Resize map sau khi toggle
            setTimeout(() => {
                if (map) {
                    map.invalidateSize();
                }
            }, 350);
        });
    }
    
    // Close sidebar when clicking overlay (mobile)
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.add('hidden');
            sidebarOverlay.classList.remove('show');
            if (mapElement) {
                mapElement.classList.remove('with-sidebar');
            }
            setTimeout(() => {
                if (map) {
                    map.invalidateSize();
                }
            }, 350);
        });
    }
    
    // Dashboard button - Already on dashboard, just ensure it's active
    const dashboardBtn = document.getElementById('dashboard-btn');
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', () => {
            // Already on dashboard page, do nothing or refresh
            window.location.href = '/';
        });
    }
    
    // Stats toggle button - redirect to stats page
    const statsToggleBtn = document.getElementById('stats-toggle-btn');
    if (statsToggleBtn) {
        statsToggleBtn.addEventListener('click', () => {
            window.location.href = '/stats.html';
        });
    }
    
    // Station dropdown toggle
    const stationDisplay = document.getElementById('station-display');
    const stationDropdown = document.getElementById('station-dropdown');
    
    if (stationDisplay && stationDropdown) {
        stationDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            stationDropdown.classList.toggle('open');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!stationDropdown.contains(e.target) && !stationDisplay.contains(e.target)) {
                stationDropdown.classList.remove('open');
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
        if (window.innerWidth > 768 && sidebarOverlay) {
            sidebarOverlay.classList.remove('show');
        } else if (window.innerWidth <= 768 && sidebarOverlay && !sidebar.classList.contains('hidden')) {
            sidebarOverlay.classList.add('show');
        }
    });
    
    // Auto refresh dữ liệu mỗi 30 giây (MQTT realtime) và mỗi 2 phút (TVA)
    setInterval(() => {
        console.log('🔄 Tự động làm mới dữ liệu...');
        refreshStations();
    }, 30 * 1000); // 30 giây
}

// Khởi tạo map khi DOM ready
document.addEventListener('DOMContentLoaded', function() {
    initMap();
});
