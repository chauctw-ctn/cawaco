// SCADA Data Display Script

let scadaData = null;

let scadaAutoRefreshTimer = null;
let scadaLoading = false;

// Update last update time
function updateLastUpdate() {
    // Support both created_at (new) and timestamp (legacy) fields
    const timeValue = scadaData?.created_at || scadaData?.timestamp;
    if (!scadaData || !timeValue) return;
    
    const timestamp = new Date(timeValue);
    const el = document.getElementById('lastUpdate');
    if (!el) return;
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
    el.textContent = `Cập nhật lần cuối: ${formatter.format(timestamp)} | Nguồn: ${scadaData.source || 'SCADA'} | Phương thức: ${scadaData.method || 'N/A'}`;
}

// Load SCADA data
async function loadScadaData(options = {}) {
    const { silent = false } = options;

    if (scadaLoading) return;
    scadaLoading = true;

    const refreshBtn = document.getElementById('refresh-scada-btn');
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const response = await fetch(`/api/scada/cached?_t=${Date.now()}`, {
            cache: 'no-store'
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP ${response.status}: Không thể tải dữ liệu`);
        }
        
        scadaData = await response.json();
        
        if (!scadaData.success && scadaData.success !== undefined) {
            throw new Error(scadaData.message || 'Không có dữ liệu');
        }
        
        renderStations();
        updateLastUpdate();

    } catch (error) {
        console.error('Error loading SCADA data:', error);
        const container = document.getElementById('stationsContainer');
        container.innerHTML = `
            <div class="error" style="padding: 40px; text-align: center;">
                <h3 style="color: #d32f2f; margin-bottom: 10px;">❌ ${error.message}</h3>
                <p style="color: #666; margin-top: 10px;">
                    Hệ thống sẽ tự động cập nhật dữ liệu chất lượng nước mỗi 5 phút.
                </p>
                <button onclick="loadScadaData()" style="margin-top: 20px; padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Thử lại
                </button>
            </div>
        `;

    } finally {
        scadaLoading = false;
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

// Render stations
function renderStations() {
    const container = document.getElementById('stationsContainer');
    
    if (!scadaData || !scadaData.stationsGrouped) {
        container.innerHTML = '<div class="error">Không có dữ liệu để hiển thị</div>';
        return;
    }

    const stations = scadaData.stationsGrouped;
    const stationEntries = Object.entries(stations);
    
    // Debug: Log parameter names from database
    console.log('🔍 Debug - SCADA Data from database:');
    stationEntries.forEach(([id, st]) => {
        console.log(`Station: ${st.stationName}`);
        if (st.parameters) {
            st.parameters.forEach(p => {
                console.log(`  - Parameter: "${p.parameter}" (${p.parameterName}) = ${p.displayText} ${p.unit}`);
            });
        }
    });

    // SCADA/HMI style overview (no table)
    const metrics = [
        // Order required: Level, Flow, Total Flow, PH, TDS, AMONI, NITRAT
        { key: 'MỰC_NƯỚC', label: 'Mực nước', unitFallback: 'm', kind: 'level', colorClass: 'level' },
        { key: 'LƯU_LƯỢNG', label: 'Lưu lượng', unitFallback: 'm³/h', kind: 'flow', colorClass: 'flowrate' },
        { key: 'TỔNG_LƯU_LƯỢNG', label: 'Tổng', unitFallback: 'm³', kind: 'total', colorClass: 'totalflow' },
        { key: 'PH', label: 'pH', kind: 'quality', colorClass: 'ph' },
        { key: 'TDS', label: 'TDS', kind: 'quality', colorClass: 'tds' },
        { key: 'AMONI', label: 'Amoni', kind: 'quality', colorClass: 'amoni' },
        { key: 'NITRAT', label: 'Nitrat', kind: 'quality', colorClass: 'nitrat' }
    ];

    // Sorting helpers
    const normalizeKey = (input) => {
        let s = String(input ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        // normalize common words/variants
        s = s
            .replace(/\(.*?\)/g, ' ') // remove (QT24)
            .replace(/nha\s*may/g, 'nm')
            .replace(/\bso\b/g, ' ') // remove "so" ("số")
            .replace(/[^a-z0-9\s_]/g, ' ')
            .replace(/\bnm\s+(\d+)\b/g, 'nm$1')
            .replace(/\s+/g, ' ')
            .trim();

        return s;
    };

    // Enforce station order left-to-right as requested
    const explicitStationOrder = [
        'giếng 5',
        'giếng 4 nm2',
        'giếng 4 nm1',
        'trạm bơm 1',
        'trạm bơm 24'
    ].map(normalizeKey);

    const getStationRank = (stationName) => {
        const key = normalizeKey(stationName);
        const idx = explicitStationOrder.findIndex(wanted => key === wanted || key.startsWith(wanted) || key.includes(wanted));
        return idx; // -1 if not found
    };

    // Stations as columns (1 row, fixed order left-to-right)
    const sortedStations = stationEntries
        .map(([id, st]) => st)
        .sort((s1, s2) => {
            const n1 = (s1?.stationName || '').toString();
            const n2 = (s2?.stationName || '').toString();
            const r1 = getStationRank(n1);
            const r2 = getStationRank(n2);

            const has1 = r1 !== -1;
            const has2 = r2 !== -1;
            if (has1 && has2 && r1 !== r2) return r1 - r2;
            if (has1 && !has2) return -1;
            if (!has1 && has2) return 1;
            return n1.localeCompare(n2, 'vi');
        });

    container.innerHTML = `
        <div class="scada-group-grid" role="list" aria-label="Giếng/trạm">
            ${sortedStations.map(st => renderGroupColumn(st.stationName || '--', [st], metrics)).join('')}
        </div>
    `;
}

function renderGroupColumn(groupName, stations, metrics) {
    return `
        <section class="scada-group" role="listitem" aria-label="${escapeHtml(groupName)}">
            <div class="scada-panels" role="list" aria-label="Danh sách trạm">
                ${stations.map(st => renderStationPanel(st, metrics)).join('')}
            </div>
        </section>
    `;
}

function buildParamMap(station) {
    const params = {};
    if (!station || !Array.isArray(station.parameters)) return params;
    
    station.parameters.forEach(p => {
        if (!p || !p.parameter) return;
        
        // Normalize parameter name for matching
        const normalizedKey = normalizeParameterName(p.parameter);
        
        // Store both original and normalized keys
        params[p.parameter] = p; // Original key
        params[normalizedKey] = p; // Normalized key
    });
    
    return params;
}

/**
 * Normalize parameter name for flexible matching
 * Examples:
 * - "pH" or "PH" -> "PH"
 * - "TDS (mg/l)" or "TDS" -> "TDS"
 * - "Amoni (NH4+)" or "Amoni" -> "AMONI"
 * - "Nitrat (NO3-)" or "Nitrat" -> "NITRAT"
 * - "Lưu lượng" -> "LƯU_LƯỢNG"
 * - "Mực nước" -> "MỰC_NƯỚC"
 */
function normalizeParameterName(paramName) {
    if (!paramName) return '';
    
    const name = String(paramName).trim().toLowerCase();
    
    // Water quality parameters
    if (name.includes('ph')) return 'PH';
    if (name.includes('tds')) return 'TDS';
    if (name.includes('amoni') || name.includes('nh4')) return 'AMONI';
    if (name.includes('nitrat') || name.includes('no3')) return 'NITRAT';
    
    // Flow and level parameters
    if (name.includes('lưu lượng') || name.includes('luu luong')) {
        if (name.includes('tổng') || name.includes('tong')) {
            return 'TỔNG_LƯU_LƯỢNG';
        }
        return 'LƯU_LƯỢNG';
    }
    if (name.includes('mực nước') || name.includes('muc nuoc')) return 'MỰC_NƯỚC';
    
    // Return uppercase version with underscores
    return paramName.toUpperCase().replace(/\s+/g, '_').replace(/[()]/g, '');
}

function formatCell(param, fallbackUnit) {
    if (!param) return { text: '--', unit: '' };

    let text = param.displayText ?? param.value ?? param.TextWithUnit ?? '--';
    
    // Handle undefined, null, or empty string
    if (text === undefined || text === null || text === '' || text === 'undefined') {
        text = '--';
    } else {
        text = String(text);
    }
    
    const unit = (param.unit ?? fallbackUnit ?? '').toString();
    return { text, unit };
}

function hasMeaningfulValue(param) {
    if (!param) return false;
    const raw = (param.displayText ?? param.value ?? param.TextWithUnit);
    if (raw === null || raw === undefined || raw === '' || raw === 'undefined') return false;
    const text = String(raw).trim();
    if (!text) return false;
    if (text === '--') return false;
    if (text.toLowerCase() === 'n/a') return false;
    return true;
}

function renderQualityBadge(param) {
    if (!param) return '';
    const quality = getQualityStatus(param.parameter, param.value);
    if (!quality) return '';
    return `<span class="quality-pill ${quality.class}">${quality.text}</span>`;
}

function renderStationPanel(station, metrics) {
    const params = buildParamMap(station);
    const name = station.stationName || '--';

    // Always show all metrics, even if no meaningful value
    const blocks = metrics
        .map(m => {
            const param = params[m.key];
            const { text, unit } = formatCell(param, m.unitFallback);
            const qualityBadge = m.kind === 'quality' && hasMeaningfulValue(param) ? renderQualityBadge(param) : '';

            // Minor normalization for PH (often unitless)
            const unitHtml = unit && m.key !== 'PH' ? `<span class="hmi-unit">${escapeHtml(unit)}</span>` : '';

            return `
                <div class="hmi-block hmi-${m.kind} hmi-${m.colorClass}" role="listitem">
                    <div class="hmi-label">${escapeHtml(m.label)}</div>
                    <div class="hmi-readout">
                        <span class="hmi-value">${escapeHtml(text)}</span>
                        ${unitHtml}
                        ${qualityBadge}
                    </div>
                </div>
            `;
        })
        .join('');

    return `
        <article class="station-panel" role="listitem">
            <header class="station-panel__header">
                <div class="station-panel__name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            </header>
            <div class="station-panel__metrics" role="list" aria-label="Thông số">
                ${blocks || '<div class="station-panel__empty">Không có dữ liệu</div>'}
            </div>
        </article>
    `;
}

function escapeHtml(input) {
    return String(input)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// Get quality status
function getQualityStatus(paramName, value) {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;
    
    // Normalize parameter name for comparison
    const normalized = normalizeParameterName(paramName);
    
    switch(normalized) {
        case 'PH':
            if (numValue >= 6.5 && numValue <= 8.5) return {class: 'quality-good', text: 'Đạt chuẩn'};
            if (numValue >= 6.0 && numValue < 6.5 || numValue > 8.5 && numValue <= 9.0) return {class: 'quality-warning', text: 'Cảnh báo'};
            return {class: 'quality-danger', text: 'Vượt chuẩn'};
        case 'TDS':
            if (numValue <= 500) return {class: 'quality-good', text: 'Tốt'};
            if (numValue <= 1000) return {class: 'quality-warning', text: 'TB'};
            return {class: 'quality-danger', text: 'Cao'};
        case 'AMONI':
            if (numValue <= 0.5) return {class: 'quality-good', text: 'Tốt'};
            if (numValue <= 1.0) return {class: 'quality-warning', text: 'TB'};
            return {class: 'quality-danger', text: 'Cao'};
        case 'NITRAT':
            if (numValue <= 10) return {class: 'quality-good', text: 'Tốt'};
            if (numValue <= 20) return {class: 'quality-warning', text: 'TB'};
            return {class: 'quality-danger', text: 'Cao'};
        default:
            return null;
    }
}

// Render individual station card
function renderStationUnit(station) {
    const params = {};
    station.parameters.forEach(p => {
        params[p.parameter] = p;
    });

    const flowRate = params['LƯU_LƯỢNG'] || {displayText: '0.0', value: 0, unit: 'm³/h'};
    const totalFlow = params['TỔNG_LƯU_LƯỢNG'] || {displayText: '0', value: 0, unit: 'm³'};
    const waterLevel = params['MỰC_NƯỚC'] || {displayText: '0.0', value: 0, unit: 'm'};
    const pH = params['PH'];
    const tds = params['TDS'];
    const amoni = params['AMONI'];
    const nitrat = params['NITRAT'];

    const stationType = station.group || 'TRẠM';

    return `
        <div class="station-card">
            <div class="station-header">
                <div class="station-name">${station.stationName}</div>
                <div class="station-type">${stationType}</div>
            </div>
            
            <div class="parameters-grid">
                <!-- Flow Rate -->
                <div class="param-group flow">
                    <div class="param-label">
                        <span class="param-icon">💧</span>
                        <span>Lưu Lượng</span>
                    </div>
                    <div class="param-value-container">
                        <span class="param-value">${flowRate.displayText}</span>
                        <span class="param-unit">${flowRate.unit}</span>
                    </div>
                </div>

                <!-- Total Flow -->
                <div class="param-group flow">
                    <div class="param-label">
                        <span class="param-icon">📊</span>
                        <span>Tổng Lưu Lượng</span>
                    </div>
                    <div class="param-value-container">
                        <span class="param-value">${totalFlow.displayText}</span>
                        <span class="param-unit">${totalFlow.unit}</span>
                    </div>
                </div>

                <!-- Water Level -->
                <div class="param-group level">
                    <div class="param-label">
                        <span class="param-icon">📏</span>
                        <span>Mực Nước</span>
                    </div>
                    <div class="param-value-container">
                        <span class="param-value">${waterLevel.displayText}</span>
                        <span class="param-unit">${waterLevel.unit}</span>
                    </div>
                </div>

                ${pH ? renderQualityParam('🧪', 'pH', pH) : ''}
                ${tds ? renderQualityParam('⚗️', 'TDS', tds) : ''}
                ${amoni ? renderQualityParam('🔬', 'Amoni', amoni) : ''}
                ${nitrat ? renderQualityParam('🧬', 'Nitrat', nitrat) : ''}
            </div>
        </div>
    `;
}

// Render quality parameter with badge
function renderQualityParam(icon, label, param) {
    const quality = getQualityStatus(param.parameter, param.value);
    const qualityBadge = quality ? `<span class="quality-badge ${quality.class}">${quality.text}</span>` : '';
    
    return `
        <div class="param-group quality">
            <div class="param-label">
                <span class="param-icon">${icon}</span>
                <span>${label}</span>
            </div>
            <div class="param-value-container">
                <span class="param-value">${param.displayText}</span>
                <span class="param-unit">${param.unit}</span>
                ${qualityBadge}
            </div>
        </div>
    `;
}

// Render individual parameter
function renderParameter(param) {
    const qualityClass = getQualityClass(param);
    const qualityLabel = qualityClass ? `<span class="quality-indicator ${qualityClass}">${getQualityLabel(qualityClass)}</span>` : '';
    
    return `
        <div class="parameter-row">
            <div class="parameter-name">
                ${param.status === 'Online' ? '<span class="status-online"></span>' : '<span class="status-offline"></span>'}
                ${param.parameterName}
            </div>
            <div>
                <span class="parameter-value">${param.displayText}</span>
                <span class="parameter-unit">${param.unit}</span>
                ${qualityLabel}
            </div>
        </div>
    `;
}

// Get quality class based on parameter value
function getQualityClass(param) {
    // pH quality check
    if (param.parameter === 'PH') {
        const value = parseFloat(param.value);
        if (value >= 6.5 && value <= 8.5) return 'quality-good';
        if (value >= 6.0 && value <= 9.0) return 'quality-warning';
        return 'quality-danger';
    }
    
    // TDS quality check (mg/L)
    if (param.parameter === 'TDS') {
        const value = parseFloat(param.value);
        if (value <= 500) return 'quality-good';
        if (value <= 1000) return 'quality-warning';
        return 'quality-danger';
    }
    
    // Amoni quality check (mg/L)
    if (param.parameter === 'AMONI') {
        const value = parseFloat(param.value);
        if (value <= 0.5) return 'quality-good';
        if (value <= 1.0) return 'quality-warning';
        return 'quality-danger';
    }
    
    // Nitrat quality check (mg/L)
    if (param.parameter === 'NITRAT') {
        const value = parseFloat(param.value);
        if (value <= 10) return 'quality-good';
        if (value <= 45) return 'quality-warning';
        return 'quality-danger';
    }
    
    return null;
}

// Get quality label
function getQualityLabel(qualityClass) {
    switch(qualityClass) {
        case 'quality-good': return 'Đạt';
        case 'quality-warning': return 'Cảnh báo';
        case 'quality-danger': return 'Vượt chuẩn';
        default: return '';
    }
}

function initScadaPage() {
    const container = document.getElementById('stationsContainer');
    if (!container) return; // Not on SCADA page

    // Refresh button
    const refreshBtn = document.getElementById('refresh-scada-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadScadaData());
    }

    // Initial load
    loadScadaData();

    // Auto refresh every 5 minutes
    if (scadaAutoRefreshTimer) clearInterval(scadaAutoRefreshTimer);
    scadaAutoRefreshTimer = setInterval(() => loadScadaData({ silent: true }), 5 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', initScadaPage);
