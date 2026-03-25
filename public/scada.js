let scadaData = null;

let scadaAutoRefreshTimer = null;
let scadaClockTimer = null;
let scadaLoading = false;
let scadaResizeObserver = null;

const SCADA_CANVAS = {
    width: 1532,
    height: 831
};

const METRIC_TEXT_MAP = {
    'MỰC_NƯỚC': 'MỰC NƯỚC',
    'LƯU_LƯỢNG': 'LƯU LƯỢNG',
    'TỔNG_LƯU_LƯỢNG': 'TỔNG LƯU LƯỢNG',
    'PH': 'PH',
    'TDS': 'TDS',
    'AMONI': 'AMONI',
    'NITRAT': 'NITRAT'
};

const METRIC_UNIT_FALLBACK = {
    'MỰC_NƯỚC': 'm',
    'LƯU_LƯỢNG': 'm³/h',
    'TỔNG_LƯU_LƯỢNG': 'm³',
    'PH': 'pH',
    'TDS': 'mg/L',
    'AMONI': 'mg/L',
    'NITRAT': 'mg/L'
};

const VALUE_ONLY_METRICS = new Set(['MỰC_NƯỚC', 'LƯU_LƯỢNG', 'TỔNG_LƯU_LƯỢNG']);

function normalizeUnitText(unit) {
    const raw = String(unit || '').trim();
    if (!raw) return '';

    const normalized = raw
        .replace(/m\s*3\s*\/\s*h/gi, 'm³/h')
        .replace(/m\s*3/gi, 'm³')
        .replace(/mg\s*\/\s*l/gi, 'mg/L')
        .replace(/ph/gi, 'pH');

    return normalized;
}

const SCADA_LAYOUT = [
    {
        id: 'G5_NM1',
        match: ['g5_nm1', 'g5 nm1', 'gieng 5', 'gieng so 5', 'gieng 5 nha may 1'],
        title: { text: 'Giếng Số 5 NM1', x: 35, y: 530, className: 'scada-label scada-label--station' },
        details: [
            { text: 'THÔNG TIN GIẾNG SỐ 5 NM1:', x: 5, y: 575, className: 'scada-label scada-label--section' },
            { text: '- Lưu lượng khai thác: 1.800 m3/ngày đêm', x: 10, y: 615, className: 'scada-label scada-label--detail' },
            { text: '- Mực nước cho phép tối đa: 32m', x: 10, y: 645, className: 'scada-label scada-label--detail' },
            { text: '- Số giờ khai thác: 24 giờ/ngày đêm', x: 10, y: 675, className: 'scada-label scada-label--detail' },
            { text: '- Đường kính giếng: D350mm', x: 10, y: 705, className: 'scada-label scada-label--detail' },
            { text: '- Công suất bơm: 18.5kw', x: 10, y: 735, className: 'scada-label scada-label--detail' }
        ],
        pump: { x: 92, y: 420, w: 27, h: 85, paramKey: 'LƯU_LƯỢNG' },
        metrics: [
            { paramKey: 'MỰC_NƯỚC', x: 42, y: 220, w: 50, h: 18, companionText: 'M', companionX: 95, companionY: 220, companionClass: 'scada-unit' },
            { paramKey: 'TỔNG_LƯU_LƯỢNG', x: 140, y: 188, w: 80, h: 18, companionText: 'M3', companionX: 223, companionY: 188, companionClass: 'scada-unit' },
            { paramKey: 'LƯU_LƯỢNG', x: 140, y: 170, w: 80, h: 18, companionText: 'M3/H', companionX: 223, companionY: 170, companionClass: 'scada-unit' },
            { paramKey: 'PH', x: 190, y: 270, w: 50, h: 18, companionText: 'PH', companionX: 150, companionY: 270, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'TDS', x: 190, y: 292, w: 50, h: 18, companionText: 'TDS', companionX: 145, companionY: 292, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'AMONI', x: 190, y: 314, w: 50, h: 18, companionText: 'AMONI', companionX: 135, companionY: 314, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'NITRAT', x: 190, y: 336, w: 50, h: 18, companionText: 'NITRAT', companionX: 135, companionY: 336, companionClass: 'scada-label scada-label--metric' }
        ]
    },
    {
        id: 'G4_NM2',
        match: ['g4_nm2', 'g4 nm2', 'gieng 4 nm2', 'gieng 4 nha may 2'],
        title: { text: 'Giếng Số 4 NM2', x: 360, y: 530, className: 'scada-label scada-label--station' },
        details: [
            { text: 'THÔNG TIN GIẾNG SỐ 4 NM2:', x: 330, y: 575, className: 'scada-label scada-label--section' },
            { text: '- Lưu lượng khai thác: 2000 m3/ngày đêm', x: 335, y: 615, className: 'scada-label scada-label--detail' },
            { text: '- Mực nước cho phép tối đa: 32m', x: 335, y: 645, className: 'scada-label scada-label--detail' },
            { text: '- Số giờ khai thác: 24 giờ/ngày đêm', x: 335, y: 675, className: 'scada-label scada-label--detail' },
            { text: '- Đường kính giếng: D350mm', x: 335, y: 705, className: 'scada-label scada-label--detail' },
            { text: '- Công suất bơm: 18.5kw', x: 335, y: 735, className: 'scada-label scada-label--detail' }
        ],
        pump: { x: 416, y: 420, w: 27, h: 85, paramKey: 'LƯU_LƯỢNG' },
        metrics: [
            { paramKey: 'MỰC_NƯỚC', x: 365, y: 220, w: 50, h: 18, companionText: 'M', companionX: 418, companionY: 220, companionClass: 'scada-unit' },
            { paramKey: 'TỔNG_LƯU_LƯỢNG', x: 465, y: 188, w: 80, h: 18, companionText: 'M3', companionX: 550, companionY: 188, companionClass: 'scada-unit' },
            { paramKey: 'LƯU_LƯỢNG', x: 465, y: 170, w: 80, h: 18, companionText: 'M3/H', companionX: 550, companionY: 170, companionClass: 'scada-unit' },
            { paramKey: 'PH', x: 510, y: 270, w: 50, h: 18, companionText: 'PH', companionX: 470, companionY: 270, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'TDS', x: 510, y: 292, w: 50, h: 18, companionText: 'TDS', companionX: 465, companionY: 292, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'AMONI', x: 510, y: 314, w: 50, h: 18, companionText: 'AMONI', companionX: 455, companionY: 314, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'NITRAT', x: 510, y: 336, w: 50, h: 18, companionText: 'NITRAT', companionX: 455, companionY: 336, companionClass: 'scada-label scada-label--metric' }
        ]
    },
    {
        id: 'G4_NM1',
        match: ['g4_nm1', 'g4 nm1', 'gieng 4 nm1', 'gieng 4 nha may 1'],
        title: { text: 'Giếng Số 4 NM1', x: 690, y: 530, className: 'scada-label scada-label--station' },
        details: [
            { text: 'THÔNG TIN GIẾNG SỐ 4 NM1:', x: 655, y: 575, className: 'scada-label scada-label--section' },
            { text: '- Lưu lượng khai thác: 1800 m3/ngày đêm', x: 665, y: 615, className: 'scada-label scada-label--detail' },
            { text: '- Mực nước cho phép tối đa: 32m', x: 665, y: 645, className: 'scada-label scada-label--detail' },
            { text: '- Số giờ khai thác: 24 giờ/ngày đêm', x: 665, y: 675, className: 'scada-label scada-label--detail' },
            { text: '- Đường kính giếng: D350mm', x: 665, y: 705, className: 'scada-label scada-label--detail' },
            { text: '- Công suất bơm: 18.5kw', x: 665, y: 735, className: 'scada-label scada-label--detail' }
        ],
        pump: { x: 739, y: 420, w: 27, h: 85, paramKey: 'LƯU_LƯỢNG' },
        metrics: [
            { paramKey: 'MỰC_NƯỚC', x: 688, y: 220, w: 50, h: 18, companionText: 'M', companionX: 740, companionY: 220, companionClass: 'scada-unit' },
            { paramKey: 'TỔNG_LƯU_LƯỢNG', x: 785, y: 188, w: 80, h: 18, companionText: 'M3', companionX: 870, companionY: 188, companionClass: 'scada-unit' },
            { paramKey: 'LƯU_LƯỢNG', x: 785, y: 170, w: 80, h: 18, companionText: 'M3/H', companionX: 870, companionY: 170, companionClass: 'scada-unit' }
        ]
    },
    {
        id: 'TRAM_1',
        match: ['tram_1', 'tram 1', 'tram bom 1', 'tram bom so 1'],
        title: { text: 'Trạm Bơm Số 1', x: 990, y: 530, className: 'scada-label scada-label--station' },
        details: [
            { text: 'THÔNG TIN TRẠM BƠM SỐ 1:', x: 970, y: 575, className: 'scada-label scada-label--section' },
            { text: '- Lưu lượng khai thác: 2200 m3/ngày đêm', x: 975, y: 615, className: 'scada-label scada-label--detail' },
            { text: '- Mực nước cho phép tối đa: 34m', x: 975, y: 645, className: 'scada-label scada-label--detail' },
            { text: '- Số giờ khai thác: 24 giờ/ngày đêm', x: 975, y: 675, className: 'scada-label scada-label--detail' },
            { text: '- Đường kính giếng: D350mm', x: 975, y: 705, className: 'scada-label scada-label--detail' },
            { text: '- Công suất bơm: 18.5kw', x: 975, y: 735, className: 'scada-label scada-label--detail' }
        ],
        pump: { x: 1042, y: 420, w: 27, h: 85, paramKey: 'LƯU_LƯỢNG' },
        metrics: [
            { paramKey: 'MỰC_NƯỚC', x: 990, y: 220, w: 50, h: 18, companionText: 'M', companionX: 1043, companionY: 220, companionClass: 'scada-unit' },
            { paramKey: 'TỔNG_LƯU_LƯỢNG', x: 1090, y: 188, w: 80, h: 18, companionText: 'M3', companionX: 1175, companionY: 188, companionClass: 'scada-unit' },
            { paramKey: 'LƯU_LƯỢNG', x: 1090, y: 170, w: 80, h: 18, companionText: 'M3/H', companionX: 1175, companionY: 170, companionClass: 'scada-unit' }
        ]
    },
    {
        id: 'TRAM_24',
        match: ['tram_24', 'tram 24', 'tram bom 24', 'tram bom so 24', 'qt24'],
        title: { text: 'Trạm Bơm Số 24', x: 1290, y: 530, className: 'scada-label scada-label--station' },
        details: [],
        pump: null,
        metrics: [
            { paramKey: 'MỰC_NƯỚC', x: 1290, y: 220, w: 50, h: 18, companionText: 'M', companionX: 1342, companionY: 220, companionClass: 'scada-unit' },
            { paramKey: 'PH', x: 1405, y: 120, w: 50, h: 18, companionText: 'PH', companionX: 1360, companionY: 122, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'TDS', x: 1405, y: 140, w: 50, h: 18, companionText: 'TDS', companionX: 1355, companionY: 140, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'AMONI', x: 1405, y: 160, w: 50, h: 18, companionText: 'AMONI', companionX: 1345, companionY: 160, companionClass: 'scada-label scada-label--metric' },
            { paramKey: 'NITRAT', x: 1405, y: 180, w: 50, h: 18, companionText: 'NITRAT', companionX: 1345, companionY: 180, companionClass: 'scada-label scada-label--metric' }
        ]
    }
];

function normalizeText(input) {
    return String(input ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\(.*?\)/g, ' ')
        .replace(/_/g, ' ')
        .replace(/nha\s*may/g, 'nm')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeParameterName(paramName) {
    const name = normalizeText(paramName);
    const compact = name.replace(/\s+/g, '');
    if (!name) return '';
    if (compact.includes('ph')) return 'PH';
    if (compact.includes('tds')) return 'TDS';
    if (compact.includes('amoni') || compact.includes('nh4')) return 'AMONI';
    if (compact.includes('nitrat') || compact.includes('no3')) return 'NITRAT';
    if (compact.includes('luuluong')) {
        if (compact.includes('tong')) return 'TỔNG_LƯU_LƯỢNG';
        return 'LƯU_LƯỢNG';
    }
    if (compact.includes('mucnuoc')) return 'MỰC_NƯỚC';
    return String(paramName ?? '').trim().toUpperCase();
}

function findStationLayout(station) {
    const stationSource = `${station?.station || ''} ${station?.stationName || ''}`;
    const stationKey = normalizeText(stationSource);
    const stationCompact = stationKey.replace(/\s+/g, '');

    return SCADA_LAYOUT.find((item) => item.match.some((token) => {
        const normalizedToken = normalizeText(token);
        const tokenCompact = normalizedToken.replace(/\s+/g, '');
        return stationKey.includes(normalizedToken) || stationCompact.includes(tokenCompact);
    })) || null;
}

function escapeHtml(input) {
    return String(input ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function toPercentX(value) {
    return `${(value / SCADA_CANVAS.width) * 100}%`;
}

function toPercentY(value) {
    return `${(value / SCADA_CANVAS.height) * 100}%`;
}

function parseNumber(value) {
    if (value === null || value === undefined) return Number.NaN;

    const raw = String(value).trim().replace(/\s+/g, '');
    if (!raw) return Number.NaN;

    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');

    if (hasComma && hasDot) {
        const lastComma = raw.lastIndexOf(',');
        const lastDot = raw.lastIndexOf('.');

        if (lastComma > lastDot) {
            const normalized = raw.replace(/\./g, '').replace(',', '.');
            return Number.parseFloat(normalized);
        }

        const normalized = raw.replace(/,/g, '');
        return Number.parseFloat(normalized);
    }

    if (hasComma) {
        const parts = raw.split(',');
        if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
            return Number.parseFloat(raw.replace(',', '.'));
        }
        return Number.parseFloat(raw.replace(/,/g, ''));
    }

    if (hasDot) {
        const parts = raw.split('.');
        if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 3) {
            return Number.parseFloat(raw);
        }
        return Number.parseFloat(raw.replace(/\./g, ''));
    }

    return Number.parseFloat(raw);
}

function getStationParameterMap(station) {
    const params = {};
    if (!station || !Array.isArray(station.parameters)) return params;

    station.parameters.forEach((param) => {
        const key = normalizeParameterName(param.parameter || param.parameterName);
        if (key) params[key] = param;
    });

    return params;
}

function formatMetricValue(param, metricKey) {
    if (!param) return '--';
    const raw = param.displayText ?? param.value;
    if (raw === null || raw === undefined || raw === '' || raw === 'undefined') return '--';

    const numericValue = parseNumber(raw);
    if (Number.isNaN(numericValue)) {
        return String(raw);
    }

    const fixedDigits = metricKey === 'TỔNG_LƯU_LƯỢNG' ? 0 : 2;
    const formatter = new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: fixedDigits,
        maximumFractionDigits: fixedDigits
    });

    return formatter.format(numericValue);
}

function getQualityStatus(paramName, value) {
    const numericValue = parseNumber(value);
    if (Number.isNaN(numericValue)) return null;

    switch (normalizeParameterName(paramName)) {
        case 'PH':
            if (numericValue >= 6.5 && numericValue <= 8.5) return { className: 'quality-good', text: 'Đạt chuẩn' };
            if ((numericValue >= 6.0 && numericValue < 6.5) || (numericValue > 8.5 && numericValue <= 9.0)) {
                return { className: 'quality-warning', text: 'Cảnh báo' };
            }
            return { className: 'quality-danger', text: 'Vượt chuẩn' };
        case 'TDS':
            if (numericValue <= 500) return { className: 'quality-good', text: 'Tốt' };
            if (numericValue <= 1000) return { className: 'quality-warning', text: 'TB' };
            return { className: 'quality-danger', text: 'Cao' };
        case 'AMONI':
            if (numericValue <= 0.5) return { className: 'quality-good', text: 'Tốt' };
            if (numericValue <= 1.0) return { className: 'quality-warning', text: 'TB' };
            return { className: 'quality-danger', text: 'Cao' };
        case 'NITRAT':
            if (numericValue <= 10) return { className: 'quality-good', text: 'Tốt' };
            if (numericValue <= 20) return { className: 'quality-warning', text: 'TB' };
            return { className: 'quality-danger', text: 'Cao' };
        default:
            return null;
    }
}

function renderTextNode(node) {
    const style = [`left:${toPercentX(node.x)}`, `top:${toPercentY(node.y)}`];
    return `<div class="${node.className}" style="${style.join(';')}">${escapeHtml(node.text)}</div>`;
}

function renderValueNode(metricConfig, param) {
    const value = formatMetricValue(param, metricConfig.paramKey);
    const metricLabel = METRIC_TEXT_MAP[metricConfig.paramKey] || metricConfig.paramKey;
    const metricUnit = normalizeUnitText(param?.unit || METRIC_UNIT_FALLBACK[metricConfig.paramKey] || '');
    const displayText = VALUE_ONLY_METRICS.has(metricConfig.paramKey)
        ? `${value}${metricUnit ? ` ${metricUnit}` : ''}`
        : `${metricLabel}: ${value}${metricUnit ? ` (${metricUnit})` : ''}`;

    const quality = getQualityStatus(metricConfig.paramKey, value);
    const qualityClass = quality ? ` value-tag--${quality.className}` : '';
    const mutedClass = value === '--' ? ' value-tag--muted' : '';
    const valueLength = String(displayText).length;

    let adaptiveClass = '';
    if (valueLength >= 11) {
        adaptiveClass = ' value-tag--tiny';
    } else if (valueLength >= 8) {
        adaptiveClass = ' value-tag--compact';
    }

    const baseWidth = Math.max(metricConfig.w, 38);
    const dynamicWidth = Math.max(baseWidth, Math.min(240, 28 + valueLength * 6));

    const style = [
        `left:${toPercentX(metricConfig.x)}`,
        `top:${toPercentY(metricConfig.y)}`,
        `width:${dynamicWidth}px`,
        `height:${Math.max(metricConfig.h, 16)}px`
    ].join(';');

    return `<div class="value-tag${qualityClass}${mutedClass}${adaptiveClass} pulse" style="${style}">${escapeHtml(displayText)}</div>`;
}

function renderPumpNode(slot, params) {
    if (!slot.pump) return '';

    const param = params[slot.pump.paramKey];
    const rawFlow = param?.displayText ?? param?.value ?? '';
    let numericValue = parseNumber(rawFlow);

    if (Number.isNaN(numericValue)) {
        const numericToken = String(rawFlow).match(/-?\d+(?:[.,]\d+)?/);
        numericValue = parseNumber(numericToken ? numericToken[0] : '0');
    }

    const active = !Number.isNaN(numericValue) && Math.abs(numericValue) > Number.EPSILON;
    if (!active) return '';

    const style = [
        `left:${toPercentX(slot.pump.x)}`,
        `top:${toPercentY(slot.pump.y)}`,
        `width:${slot.pump.w}px`,
        `height:${slot.pump.h}px`,
        'opacity:1'
    ].join(';');

    return `<img class="pump-state" style="${style}" src="GIENG_CHAY.PNG" alt="">`;
}

function updateLastUpdate() {
    const el = document.getElementById('lastUpdate');
    if (!el) return;

    const timeValue = scadaData?.created_at || scadaData?.timestamp;
    if (!scadaData || !timeValue) {
        el.textContent = 'Chưa có dữ liệu thời gian cập nhật';
        return;
    }

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

    const totalStations = Object.keys(scadaData.stationsGrouped || {}).length;
    el.textContent = `Cập nhật: ${formatter.format(new Date(timeValue))} | ${scadaData.source || 'SCADA'} | ${totalStations} trạm`;
}

function updateClock() {
    const clock = document.getElementById('scadaClock');
    if (!clock) return;
    clock.textContent = new Date().toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh'
    });
}

function fitScadaViewport() {
    const stage = document.getElementById('scadaStageScroll');
    const scaler = document.getElementById('scadaViewportScaler');
    const viewport = document.getElementById('scadaViewport');

    if (!stage || !scaler || !viewport) return;

    const availableWidth = stage.clientWidth;
    const availableHeight = stage.clientHeight;

    if (!availableWidth || !availableHeight) return;

    // Tính scale phù hợp để fit vào viewport
    const scale = Math.min(
        availableWidth / SCADA_CANVAS.width,
        availableHeight / SCADA_CANVAS.height
    );

    const safeScale = Math.max(0.35, scale);

    // Thiết lập kích thước scaler = kích thước scaled để percentage-based children render đúng
    scaler.style.width = `${SCADA_CANVAS.width * safeScale}px`;
    scaler.style.height = `${SCADA_CANVAS.height * safeScale}px`;
    
    // Viewport inherit kích thước từ scaler (thông qua CSS flex/grid hoặc auto)
    // Xóa transform vì scaler đã có kích thước đúng
    viewport.style.transform = '';
    viewport.style.transformOrigin = '';
}

function renderStations() {
    const container = document.getElementById('stationsContainer');
    if (!container) return;

    if (!scadaData || !scadaData.stationsGrouped) {
        container.innerHTML = '<div class="scada-error-state"><h3>Không có dữ liệu để hiển thị</h3><p>API chưa trả về thông tin trạm hợp lệ.</p></div>';
        return;
    }

    const stationLayouts = new Map();
    Object.values(scadaData.stationsGrouped).forEach((station) => {
        const layout = findStationLayout(station);
        if (layout) {
            stationLayouts.set(layout.id, {
                layout,
                station,
                params: getStationParameterMap(station)
            });
        }
    });

    const overlayNodes = [];
    overlayNodes.push('<div class="scada-overlay-title">HỆ THỐNG SCADA GIẾNG QUAN TRẮC</div>');

    SCADA_LAYOUT.forEach((slot) => {
        overlayNodes.push(renderTextNode(slot.title));
        slot.details.forEach((detail) => overlayNodes.push(renderTextNode(detail)));

        const stationEntry = stationLayouts.get(slot.id);
        const params = stationEntry?.params || {};

        overlayNodes.push(renderPumpNode(slot, params));

        slot.metrics.forEach((metricConfig) => {
            overlayNodes.push(renderValueNode(metricConfig, params[metricConfig.paramKey]));
        });
    });

    container.innerHTML = `
        <div class="scada-stage-shell">
            <div id="scadaStageScroll" class="scada-stage-scroll">
                <div id="scadaViewportScaler" class="scada-viewport-scaler">
                <div id="scadaViewport" class="scada-viewport">
                    <img class="scada-bg" src="image19.png" alt="Sơ đồ SCADA chất lượng nước">
                    <div class="scada-layer">${overlayNodes.join('')}</div>
                    <div id="scadaClock" class="scada-clock"></div>
                </div>
                </div>
            </div>
        </div>
    `;

    updateClock();
    fitScadaViewport();
}

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

        const data = await response.json();
        if (!data.success && data.success !== undefined) {
            throw new Error(data.message || 'Không có dữ liệu');
        }

        scadaData = data;
        renderStations();
        updateLastUpdate();
    } catch (error) {
        console.error('Error loading SCADA data:', error);

        if (!silent || !scadaData) {
            const container = document.getElementById('stationsContainer');
            if (container) {
                container.innerHTML = `
                    <div class="scada-error-state">
                        <h3>${escapeHtml(error.message)}</h3>
                        <p>Hệ thống sẽ tiếp tục tự động thử tải lại dữ liệu mỗi 5 phút.</p>
                        <button type="button" onclick="loadScadaData()">Thử lại</button>
                    </div>
                `;
            }
        }
    } finally {
        scadaLoading = false;
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function initScadaPage() {
    const container = document.getElementById('stationsContainer');
    if (!container) return;

    document.body.classList.remove('loading');

    const refreshBtn = document.getElementById('refresh-scada-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadScadaData());
    }

    updateClock();
    if (scadaClockTimer) clearInterval(scadaClockTimer);
    scadaClockTimer = setInterval(updateClock, 1000);

    window.addEventListener('resize', fitScadaViewport);

    const scadaMain = document.getElementById('scada-main');
    if (window.ResizeObserver && scadaMain) {
        if (scadaResizeObserver) scadaResizeObserver.disconnect();
        scadaResizeObserver = new ResizeObserver(() => {
            fitScadaViewport();
        });
        scadaResizeObserver.observe(scadaMain);
    }

    loadScadaData();

    if (scadaAutoRefreshTimer) clearInterval(scadaAutoRefreshTimer);
    scadaAutoRefreshTimer = setInterval(() => loadScadaData({ silent: true }), 5 * 60 * 1000);
}

// Listen for sidebar toggle events from header.js
window.addEventListener('sidebar:toggled', () => {
    setTimeout(fitScadaViewport, 100);
});

document.addEventListener('DOMContentLoaded', initScadaPage);
