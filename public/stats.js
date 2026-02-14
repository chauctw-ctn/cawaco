// Global variables
let allStations = [];
let currentPage = 1;
let rowsPerPage = 50;
let filteredData = [];
let currentParameterNames = [];
let visibleColumnIndices = []; // Indices of columns that have data

/**
 * Format date to dd/mm/yyyy theo GMT+7 (Việt Nam)
 */
function formatDate(date) {
    const d = new Date(date);
    // Format theo timezone Việt Nam (GMT+7)
    const formatter = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    return formatter.format(d);
}

/**
 * Format date time to dd/mm/yyyy HH:mm:ss theo GMT+7 (Việt Nam)
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
 * Format time to HH:mm theo GMT+7 (Việt Nam)
 */
function formatTime(date) {
    const d = new Date(date);
    // Format theo timezone Việt Nam (GMT+7)
    const formatter = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return formatter.format(d);
}

/**
 * Initialize the page
 */
async function init() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    await loadStations();
    setupEventListeners();
    setDefaultDates();
    
    // Check "TẤT CẢ" by default
    const stationAllCheckbox = document.getElementById('station-all');
    const parameterSelect = document.getElementById('parameter-select');
    
    if (stationAllCheckbox) {
        stationAllCheckbox.checked = true;
        // Check all station checkboxes
        const checkboxes = document.querySelectorAll('.station-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
        updateStationDisplay();
    }
    
    if (parameterSelect) {
        parameterSelect.value = 'all';
    }
    
    // Auto-load data after initialization
    setTimeout(() => {
        loadStatsData();
    }, 500);
}

/**
 * Update station display text
 */
function updateStationDisplay() {
    const allCheckbox = document.getElementById('station-all');
    const checkboxes = document.querySelectorAll('.station-checkbox');
    const displayText = document.querySelector('#station-display .selected-text');
    
    if (!displayText) return;
    
    if (allCheckbox.checked) {
        displayText.textContent = 'TẤT CẢ';
    } else {
        const checked = Array.from(checkboxes).filter(cb => cb.checked);
        if (checked.length === 0) {
            displayText.textContent = 'Chọn trạm...';
        } else if (checked.length === 1) {
            const stationId = checked[0].value;
            const station = allStations.find(s => s.id === stationId);
            displayText.textContent = station ? station.name : 'Đã chọn 1 trạm';
        } else {
            displayText.textContent = `Đã chọn ${checked.length} trạm`;
        }
    }
}

/**
 * Update current time display
 */
function updateCurrentTime() {
    const now = new Date();
    const timeString = formatDateTime(now);
    
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

/**
 * Set default date values
 */
function setDefaultDates() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    document.getElementById('start-date').value = dateStr;
    document.getElementById('end-date').value = dateStr;
}

/**
 * Load all stations from API
 */
async function loadStations() {
    try {
        console.log('Loading stations from API...');
        
        // Fetch both regular stations (TVA+MQTT) and SCADA stations
        const [regularResponse, scadaResponse] = await Promise.all([
            fetch('/api/stations'),
            fetch('/api/scada/cached').catch(() => ({ ok: false }))
        ]);
        
        console.log('Regular stations status:', regularResponse.status);
        console.log('SCADA stations status:', scadaResponse.ok ? 200 : 'failed');
        
        allStations = [];
        
        // Add regular stations (TVA + MQTT)
        if (regularResponse.ok) {
            const data = await regularResponse.json();
            if (data.success && data.stations) {
                allStations = [...data.stations];
                console.log('Loaded regular stations:', allStations.length);
            }
        }
        
        // Add SCADA stations (quality monitoring)
        if (scadaResponse.ok) {
            const scadaData = await scadaResponse.json();
            if (scadaData.success !== false && scadaData.stationsGrouped) {
                const scadaStations = Object.values(scadaData.stationsGrouped);
                scadaStations.forEach(station => {
                    // Convert SCADA station to stats format
                    const stationData = [];
                    if (station.parameters && Array.isArray(station.parameters)) {
                        station.parameters.forEach(p => {
                            stationData.push({
                                name: p.parameterName || p.parameter,
                                value: p.displayText || p.value || '--',
                                unit: p.unit || ''
                            });
                        });
                    }
                    
                    allStations.push({
                        id: `scada_${station.station}`,
                        name: station.stationName || station.station,
                        type: 'SCADA',
                        lat: null,
                        lng: null,
                        updateTime: scadaData.timestamp,
                        data: stationData,
                        group: station.group
                    });
                });
                console.log('Loaded SCADA stations:', scadaStations.length);
            }
        }
        
        console.log('Total stations loaded:', allStations.length);
        populateStationSelect();
        
    } catch (error) {
        console.error('Error loading stations:', error);
        // Don't show alert, just log the error and continue with empty list
        allStations = [];
        populateStationSelect();
    }
}

/**
 * Populate station select dropdown with checkboxes
 */
function populateStationSelect() {
    const stationList = document.getElementById('station-list');
    if (!stationList) {
        console.error('Station list element not found');
        return;
    }
    
    stationList.innerHTML = '';
    
    console.log('Populating stations:', allStations.length);
    
    // Update counts (only if elements exist in sidebar)
    const tvaStations = allStations.filter(s => s.type === 'TVA');
    const mqttStations = allStations.filter(s => s.type === 'MQTT');
    const scadaStations = allStations.filter(s => s.type === 'SCADA');
    
    const allCountEl = document.getElementById('all-count');
    const tvaCountEl = document.getElementById('tva-count');
    const mqttCountEl = document.getElementById('mqtt-count');
    
    if (allCountEl) allCountEl.textContent = allStations.length;
    if (tvaCountEl) tvaCountEl.textContent = tvaStations.length;
    if (mqttCountEl) mqttCountEl.textContent = mqttStations.length;
    
    // Add checkboxes for each station
    allStations.forEach(station => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        const typeLabel = station.type === 'SCADA' ? 'CLN' : station.type;
        label.innerHTML = `
            <input type="checkbox" value="${station.id}" class="station-checkbox">
            <span>${station.name} (${typeLabel})</span>
        `;
        stationList.appendChild(label);
    });
    
    console.log('Stations populated:', allStations.length);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Note: Menu button and sidebar toggle is handled by header.js
    // We don't need to duplicate that logic here
    
    // Return to map button (Dashboard)
    const returnMapBtn = document.getElementById('return-map-btn');
    if (returnMapBtn) {
        returnMapBtn.addEventListener('click', () => {
            if (window.smoothNavigate) {
                window.smoothNavigate('/');
            } else {
                window.location.href = '/';
            }
        });
    }
    
    // Stats toggle button (already on stats page)
    const statsToggleBtn = document.getElementById('stats-toggle-btn');
    if (statsToggleBtn) {
        statsToggleBtn.addEventListener('click', () => {
            // Already on stats page, do nothing or refresh
        });
    }
    
    // Multi-select dropdown
    const stationDisplay = document.getElementById('station-display');
    const stationDropdown = document.getElementById('station-dropdown');
    
    if (stationDisplay && stationDropdown) {
        stationDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            stationDropdown.classList.toggle('open');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            stationDropdown.classList.remove('open');
        });
        
        stationDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // "TẤT CẢ" checkbox handler
    const stationAllCheckbox = document.getElementById('station-all');
    if (stationAllCheckbox) {
        stationAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.station-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
            });
            updateStationDisplay();
        });
    }
    
    // Individual station checkboxes
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('station-checkbox')) {
            const allCheckbox = document.getElementById('station-all');
            const checkboxes = document.querySelectorAll('.station-checkbox');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            const noneChecked = Array.from(checkboxes).every(cb => !cb.checked);
            
            if (allChecked) {
                allCheckbox.checked = true;
            } else if (noneChecked) {
                allCheckbox.checked = false;
            } else {
                allCheckbox.checked = false;
            }
            
            updateStationDisplay();
        }
    });
    
    // Apply filter button
    const applyBtn = document.getElementById('apply-filter-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            loadStatsData();
        });
    }
    
    // Pagination buttons
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                displayCurrentPage();
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredData.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                displayCurrentPage();
            }
        });
    }
}

/**
 * Load statistics data from SQL database
 */
async function loadStatsData() {
    const allCheckbox = document.getElementById('station-all');
    const stationCheckboxes = document.querySelectorAll('.station-checkbox');
    const parameterSelect = document.getElementById('parameter-select');
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;
    
    // Get selected stations
    let selectedStations = [];
    if (allCheckbox && allCheckbox.checked) {
        selectedStations = allStations.map(s => s.id);
    } else {
        selectedStations = Array.from(stationCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);
    }
    
    // Get selected parameter
    const selectedParameter = parameterSelect.value;
    
    if (selectedStations.length === 0) {
        alert('Vui lòng chọn ít nhất một trạm');
        return;
    }
    
    if (!startDate || !endDate) {
        alert('Vui lòng chọn khoảng thời gian');
        return;
    }
    
    // Reset parameter names
    currentParameterNames = [];
    
    // Show loading
    const tableBody = document.getElementById('table-body');
    tableBody.innerHTML = '<tr><td colspan="100" class="loading">Đang tải dữ liệu từ SQL...</td></tr>';
    
    try {
        // Fetch data from SQL API (now includes SCADA data)
        const queryParams = new URLSearchParams({
            stations: selectedStations.join(','),
            type: 'all',
            parameter: selectedParameter,
            startDate: startDate,
            endDate: endDate,
            interval: interval,
            limit: 50000
        });
        
        console.log('Fetching from API:', `/api/stats?${queryParams}`);
        const response = await fetch(`/api/stats?${queryParams}`);
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('📥 API response received:', result);
        console.log(`📊 API returned ${result.data?.length || 0} records`);
        if (result.data && result.data.length > 0) {
            console.log('   Sample record from API:', result.data[0]);
        }
        
        if (!result.success) {
            throw new Error(result.error || 'Unknown error');
        }
        
        // Check if no data returned
        if (!result.data || result.data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="100" class="no-data">
                        <div style="padding: 40px; text-align: center;">
                            <h3 style="color: #666; margin-bottom: 10px;">📊 Không tìm thấy dữ liệu</h3>
                            <p style="color: #999;">Không có dữ liệu cho khoảng thời gian và trạm đã chọn.</p>
                            <p style="color: #999; font-size: 13px; margin-top: 10px;">
                                Lưu ý: Dữ liệu chất lượng nước được cập nhật mỗi 5 phút.<br>
                                Vui lòng chọn khoảng thời gian khác hoặc đợi hệ thống cập nhật dữ liệu.
                            </p>
                        </div>
                    </td>
                </tr>
            `;
            // Build empty table header
            buildTableHeaderFromData(selectedStations, selectedParameter);
            return;
        }
        
        // Process and format the data
        filteredData = processStatsData(result.data, selectedStations, selectedParameter, interval);
        
        // Build table header
        buildTableHeaderFromData(selectedStations, selectedParameter);
        
        // Reset to first page
        currentPage = 1;
        
        // Display data
        displayCurrentPage();
        
        console.log(`Total loaded: ${filteredData.length} records`);
        
        // Show message if processed data is empty but raw data had records
        if (filteredData.length === 0 && result.data.length > 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="100" class="no-data">
                        <div style="padding: 40px; text-align: center;">
                            <h3 style="color: #666; margin-bottom: 10px;">🔍 Không có dữ liệu phù hợp</h3>
                            <p style="color: #999;">Dữ liệu đã được lọc theo khoảng lấy mẫu bạn chọn.</p>
                            <p style="color: #999; font-size: 13px; margin-top: 10px;">
                                Thử chọn khoảng lấy mẫu nhỏ hơn hoặc mở rộng khoảng thời gian.
                            </p>
                        </div>
                    </td>
                </tr>
            `;
        }
        
    } catch (error) {
        console.error('Error loading stats data:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="100" class="no-data">
                    <div style="padding: 40px; text-align: center;">
                        <h3 style="color: #d32f2f; margin-bottom: 10px;">❌ Lỗi khi tải dữ liệu</h3>
                        <p style="color: #666;">${error.message}</p>
                        <p style="color: #999; font-size: 13px; margin-top: 10px;">
                            Vui lòng thử lại hoặc liên hệ quản trị viên nếu lỗi vẫn tiếp diễn.
                        </p>
                    </div>
                </td>
            </tr>
        `;
    }
}

/**
 * Process raw SQL data into table format
 */
function processStatsData(rawData, selectedStations, selectedParameter, interval) {
    if (!rawData || rawData.length === 0) {
        console.log('⚠️ processStatsData: No raw data to process');
        return [];
    }
    
    console.log(`📊 processStatsData: Processing ${rawData.length} raw records`);
    console.log('Sample record:', rawData[0]);
    
    // Normalize parameter names first (to handle case variations)
    const normalizedData = rawData.map(record => ({
        ...record,
        parameter_name_original: record.parameter_name,
        parameter_name: normalizeParameterName(record.parameter_name)
    }));
    
    // Get unique parameter names from rawData ONCE (not per row)
    // Filter out temperature and empty names
    let parameterNames = [...new Set(normalizedData.map(r => r.parameter_name))]
        .filter(name => name && name.trim()) // Remove empty names
        .filter(name => !name.toLowerCase().includes('nhiệt độ') && !name.toLowerCase().includes('nhiet do')); // Remove temperature
    
    console.log('📋 All parameters found:', parameterNames);
    console.log('🔍 Selected parameter:', selectedParameter);
    
    // If a specific parameter is selected (not 'all'), filter to only that parameter
    if (selectedParameter !== 'all') {
        const normalizedSelectedParam = normalizeParameterName(selectedParameter);
        console.log('🔍 Normalized selected param:', normalizedSelectedParam);
        console.log('🔍 Parameter names before filter:', parameterNames);
        
        // Filter to only matching parameter (after normalization, all should match)
        parameterNames = parameterNames.filter(name => name === normalizedSelectedParam);
        
        console.log('📋 Filtered parameters:', parameterNames);
    }
    
    // Sort in specific order: Mực nước, Lưu lượng, Tổng lưu lượng, pH, TDS, Amoni, Nitrat
    parameterNames = sortParameterNames(parameterNames);
    
    console.log('✅ Final parameters to display:', parameterNames);
    
    // Store parameter names globally for header building
    currentParameterNames = parameterNames;
    
    // Filter data to only include selected parameters
    const filteredByParameter = normalizedData.filter(record => 
        parameterNames.includes(record.parameter_name)
    );
    
    console.log(`🔽 Filtered by parameter: ${filteredByParameter.length} records (from ${normalizedData.length})`);
    
    // Apply sampling interval filter
    const intervalMinutes = parseInt(interval);
    const filteredByInterval = applySamplingInterval(filteredByParameter, intervalMinutes);
    
    // Group data by timestamp
    const groupedByTime = {};
    
    filteredByInterval.forEach(record => {
        const timestamp = new Date(record.timestamp);
        
        // Align timestamp to interval for display (căn chỉnh để hiển thị)
        const minutes = timestamp.getMinutes();
        const alignedMinutes = Math.floor(minutes / intervalMinutes) * intervalMinutes;
        const alignedTimestamp = new Date(timestamp);
        alignedTimestamp.setMinutes(alignedMinutes);
        alignedTimestamp.setSeconds(0);
        alignedTimestamp.setMilliseconds(0);
        
        const dateStr = formatDate(alignedTimestamp);
        const timeStr = formatTime(alignedTimestamp);
        const key = `${dateStr} ${timeStr}`;
        
        if (!groupedByTime[key]) {
            groupedByTime[key] = {
                date: dateStr,
                time: timeStr,
                timestamp: alignedTimestamp,
                values: {}
            };
        }
        
        // Store value by station and parameter (use normalized name)
        const cellKey = `${record.station_id}_${record.parameter_name}`;
        groupedByTime[key].values[cellKey] = record.value;
    });
    
    // Convert to array and sort by timestamp (newest first)
    const data = Object.values(groupedByTime)
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(item => {
            const row = {
                date: item.date,
                time: item.time,
                values: []
            };
            
            // For each station and parameter combination, get the value
            selectedStations.forEach(stationId => {
                parameterNames.forEach(paramName => {
                    const cellKey = `${stationId}_${paramName}`;
                    const value = item.values[cellKey];
                    row.values.push(value !== undefined && value !== null ? value : '-');
                });
            });
        
            return row;
        });
    
    // Identify which columns have data
    identifyVisibleColumns(data, selectedStations.length, parameterNames.length);
    
    return data;
}

/**
 * Identify which columns have at least one non-empty value
 */
function identifyVisibleColumns(data, stationCount, paramCount) {
    if (data.length === 0) {
        visibleColumnIndices = [];
        return;
    }
    
    const totalColumns = stationCount * paramCount;
    const columnHasData = new Array(totalColumns).fill(false);
    
    // Check each column
    data.forEach(row => {
        row.values.forEach((value, index) => {
            if (value !== null && value !== undefined && value !== '-' && value !== '') {
                columnHasData[index] = true;
            }
        });
    });
    
    // Build array of visible column indices
    visibleColumnIndices = [];
    columnHasData.forEach((hasData, index) => {
        if (hasData) {
            visibleColumnIndices.push(index);
        }
    });
    
    console.log(`📊 Visible columns: ${visibleColumnIndices.length}/${totalColumns}`);
}

/**
 * Normalize parameter names to handle case variations
 */
function normalizeParameterName(name) {
    if (!name) return '';
    
    const normalized = name.trim();
    const lower = normalized.toLowerCase();
    
    // Map common variations to standard forms
    if (lower.includes('mực nước') || lower.includes('muc nuoc')) {
        return 'Mực nước';
    }
    if (lower.includes('lưu lượng') && !lower.includes('tổng')) {
        return 'Lưu lượng';
    }
    if (lower.includes('tổng lưu lượng') || lower.includes('tong luu luong')) {
        return 'Tổng lưu lượng';
    }
    
    // Water quality parameters - check exact matches and variations
    // Normalize both 'pH' and 'Độ pH' to 'pH' for consistency
    if (lower === 'ph' || lower === 'độ ph' || lower === 'do ph' || lower.includes('ph')) {
        return 'pH';
    }
    if (lower === 'tds' || lower.includes('tds') || lower.includes('tổng chất rắn')) {
        return 'TDS';
    }
    if (lower === 'amoni' || lower.includes('amoni') || lower === 'nh4+' || lower === 'nh4') {
        return 'Amoni';
    }
    if (lower === 'nitrat' || lower.includes('nitrat') || lower === 'no3-' || lower === 'no3') {
        return 'Nitrat';
    }
    
    // Return original with normalized case (first letter uppercase)
    return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

/**
 * Sort parameter names in specific order
 */
function sortParameterNames(names) {
    const order = ['Mực nước', 'Lưu lượng', 'Tổng lưu lượng', 'pH', 'TDS', 'Amoni', 'Nitrat'];
    
    return names.sort((a, b) => {
        const indexA = order.indexOf(a);
        const indexB = order.indexOf(b);
        
        // If both are in the order list, sort by order
        if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
        }
        // If only a is in order, a comes first
        if (indexA !== -1) return -1;
        // If only b is in order, b comes first
        if (indexB !== -1) return 1;
        // Otherwise, alphabetical sort
        return a.localeCompare(b, 'vi');
    });
}

/**
 * Apply sampling interval filter to raw data
 */
function applySamplingInterval(rawData, intervalMinutes) {
    if (!rawData || rawData.length === 0 || intervalMinutes <= 0) {
        return rawData;
    }
    
    // Group by station and parameter
    const groupedByStationParam = {};
    
    rawData.forEach(record => {
        const key = `${record.station_id}_${record.parameter_name}`;
        if (!groupedByStationParam[key]) {
            groupedByStationParam[key] = [];
        }
        groupedByStationParam[key].push(record);
    });
    
    // For each station-parameter combination, filter by interval
    const filtered = [];
    
    Object.values(groupedByStationParam).forEach(records => {
        // Sort by timestamp
        records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        if (records.length === 0) return;
        
        // Group by aligned time intervals
        const alignedGroups = {};
        
        records.forEach(record => {
            const timestamp = new Date(record.timestamp);
            
            // Align to interval (e.g., for 5 min: 13:28 -> 13:25, 13:23 -> 13:20)
            const minutes = timestamp.getMinutes();
            const alignedMinutes = Math.floor(minutes / intervalMinutes) * intervalMinutes;
            
            // Create aligned timestamp
            const alignedTime = new Date(timestamp);
            alignedTime.setMinutes(alignedMinutes);
            alignedTime.setSeconds(0);
            alignedTime.setMilliseconds(0);
            
            const key = alignedTime.toISOString();
            
            // Keep the closest record to the aligned time
            if (!alignedGroups[key]) {
                alignedGroups[key] = record;
            } else {
                // Keep the record closest to the aligned time
                const existingDiff = Math.abs(new Date(alignedGroups[key].timestamp) - alignedTime);
                const currentDiff = Math.abs(timestamp - alignedTime);
                
                if (currentDiff < existingDiff) {
                    alignedGroups[key] = record;
                }
            }
        });
        
        // Add all aligned records
        filtered.push(...Object.values(alignedGroups));
    });
    
    return filtered;
}

/**
 * Build table header from actual data
 */
function buildTableHeaderFromData(selectedStations, selectedParameter) {
    const headerStations = document.getElementById('table-header-stations');
    const headerParameters = document.getElementById('table-header-parameters');
    
    // Clear existing headers
    headerStations.innerHTML = '';
    headerParameters.innerHTML = '';
    
    // Row 1: Date and Time columns (rowspan=2)
    const thDate = document.createElement('th');
    thDate.textContent = 'Ngày';
    thDate.rowSpan = 2;
    headerStations.appendChild(thDate);
    
    const thTime = document.createElement('th');
    thTime.textContent = 'Giờ';
    thTime.rowSpan = 2;
    headerStations.appendChild(thTime);
    
    // Row 1: Station names (colspan = number of visible parameters for that station)
    selectedStations.forEach((stationId, stationIndex) => {
        const station = allStations.find(s => s.id === stationId);
        if (!station) return;
        
        // Count visible parameters for this station
        const startCol = stationIndex * currentParameterNames.length;
        const endCol = startCol + currentParameterNames.length;
        const visibleParamsForStation = visibleColumnIndices.filter(idx => idx >= startCol && idx < endCol).length;
        
        if (visibleParamsForStation > 0) {
            const thStation = document.createElement('th');
            thStation.textContent = station.name;
            thStation.colSpan = visibleParamsForStation;
            thStation.className = 'station-header';
            headerStations.appendChild(thStation);
        }
    });
    
    // Row 2: Parameter names (only visible ones)
    selectedStations.forEach((stationId, stationIndex) => {
        const station = allStations.find(s => s.id === stationId);
        if (!station) return;
        
        currentParameterNames.forEach((paramName, paramIndex) => {
            const columnIndex = stationIndex * currentParameterNames.length + paramIndex;
            
            // Only add header if this column has data
            if (visibleColumnIndices.includes(columnIndex)) {
                const thParam = document.createElement('th');
                thParam.textContent = paramName;
                thParam.className = 'parameter-header';
                headerParameters.appendChild(thParam);
            }
        });
    });
}

/**
 * Build table header based on selected stations and parameters
 */
function buildTableHeader(selectedStations, selectedParameters) {
    const tableHeader = document.getElementById('table-header');
    tableHeader.innerHTML = '<th>Ngày</th><th>Giờ</th>';
    
    selectedStations.forEach(stationId => {
        const station = allStations.find(s => s.id === stationId);
        if (!station) return;
        
        selectedParameters.forEach(param => {
            const th = document.createElement('th');
            th.textContent = `${param.label} (${station.name})`;
            tableHeader.appendChild(th);
        });
    });
}

/**
 * Display current page of data
 */
function displayCurrentPage() {
    const tableBody = document.getElementById('table-body');
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (filteredData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="100" class="no-data">Không có dữ liệu</td></tr>';
        pageInfo.textContent = 'Trang 0/0';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, filteredData.length);
    
    tableBody.innerHTML = '';
    
    for (let i = startIndex; i < endIndex; i++) {
        const row = filteredData[i];
        const tr = document.createElement('tr');
        
        // Date column
        const dateTd = document.createElement('td');
        dateTd.textContent = row.date;
        tr.appendChild(dateTd);
        
        // Time column
        const timeTd = document.createElement('td');
        timeTd.textContent = row.time;
        tr.appendChild(timeTd);
        
        // Data columns (only visible ones)
        row.values.forEach((value, index) => {
            // Only show columns that have data
            if (visibleColumnIndices.includes(index)) {
                const td = document.createElement('td');
                td.textContent = value !== null && value !== undefined ? value : '-';
                tr.appendChild(td);
            }
        });
        
        tableBody.appendChild(tr);
    }
    
    // Update pagination
    pageInfo.textContent = `Trang ${currentPage}/${totalPages}`;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
}

/**
 * Generate mock statistics data
 */
function generateMockData(selectedStations, selectedParameters, startDate, endDate, interval) {
    const data = [];
    const start = new Date(startDate + ' 00:00:00');
    const end = new Date(endDate + ' 23:59:59');
    const intervalMinutes = parseInt(interval);
    
    let currentTime = new Date(start);
    
    while (currentTime <= end) {
        const row = {
            date: formatDate(currentTime),
            time: formatTime(currentTime),
            values: []
        };
        
        // Generate values for each station and parameter combination
        selectedStations.forEach(() => {
            selectedParameters.forEach(param => {
                let value;
                
                switch (param.value) {
                    case 'water_level':
                        value = (20 + Math.random() * 10).toFixed(2);
                        break;
                    case 'flow_rate':
                        value = (Math.random() * 30).toFixed(2);
                        break;
                    case 'flow_velocity':
                        value = (Math.random() * 2).toFixed(2);
                        break;
                    case 'total_flow':
                        value = Math.floor(40000 + Math.random() * 10000);
                        break;
                    case 'battery':
                        value = Math.floor(80 + Math.random() * 20);
                        break;
                    case 'signal':
                        value = Math.floor(20 + Math.random() * 11);
                        break;
                    default:
                        value = '-';
                }
                
                row.values.push(value);
            });
        });
        
        data.push(row);
        
        // Move to next interval
        currentTime = new Date(currentTime.getTime() + intervalMinutes * 60000);
    }
    
    // Reverse array to show most recent data first
    return data.reverse();
}

// Handle window resize for overlay visibility
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    
    if (window.innerWidth > 768 && sidebarOverlay) {
        sidebarOverlay.classList.remove('show');
    } else if (window.innerWidth <= 768 && sidebarOverlay && sidebar && !sidebar.classList.contains('hidden')) {
        sidebarOverlay.classList.add('show');
    }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
