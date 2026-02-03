/**
 * Mapping giữa Channel Number (CnlNum) và tên trạm TVA
 * Dựa trên cấu hình hệ thống Rapid SCADA
 * 
 * CẤU TRÚC:
 * - G5 NM1: 7 thông số (Mực nước, Lưu lượng, Tổng LQ, pH, TDS, AMONI, NITRAT)
 * - G4 NM2: 7 thông số (Mực nước, Lưu lượng, Tổng LQ, pH, TDS, AMONI, NITRAT)
 * - G4 NM1: 3 thông số (Mực nước, Lưu lượng, Tổng LQ)
 * - TRẠM 1: 3 thông số (Mực nước, Lưu lượng, Tổng LQ)
 * - TRẠM 24 (QT24): 5 thông số (Mực nước, pH, TDS, AMONI, NITRAT)
 */

const TVA_CHANNEL_MAPPING = {
    // ============ G4 NM2 (Giếng 4 Nhà Máy 2) - 7 thông số ============
    // Thông số cơ bản (Table 17)
    2902: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'MỰC_NƯỚC',
        parameterName: 'Mực Nước',
        unit: 'm',
        group: 'GIẾNG',
        view: 17,
    },
    2904: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'LƯU_LƯỢNG',
        parameterName: 'Lưu Lượng',
        unit: 'm³/h',
        group: 'GIẾNG',
        view: 17,
    },
    2905: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'TỔNG_LƯU_LƯỢNG',
        parameterName: 'Tổng Lưu Lượng',
        unit: 'm³',
        group: 'GIẾNG',
        view: 17,
    },
    // Chất lượng nước (Table 18)
    2932: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'AMONI',
        parameterName: 'Amoni',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },
    2933: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'NITRAT',
        parameterName: 'Nitrat',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },
    2934: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'PH',
        parameterName: 'Độ pH',
        unit: 'pH',
        group: 'GIẾNG',
        view: 18,
    },
    2935: {
        station: 'G4_NM2',
        stationName: 'GIẾNG 4 NHÀ MÁY 2',
        parameter: 'TDS',
        parameterName: 'TDS',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },

    // ============ G5 NM1 (Giếng 5 Nhà Máy 1) - 7 thông số ============
    // Thông số cơ bản (Table 17)
    2907: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'MỰC_NƯỚC',
        parameterName: 'Mực Nước',
        unit: 'm',
        group: 'GIẾNG',
        view: 17,
    },
    2909: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'LƯU_LƯỢNG',
        parameterName: 'Lưu Lượng',
        unit: 'm³/h',
        group: 'GIẾNG',
        view: 17,
    },
    2910: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'TỔNG_LƯU_LƯỢNG',
        parameterName: 'Tổng Lưu Lượng',
        unit: 'm³',
        group: 'GIẾNG',
        view: 17,
    },
    // Chất lượng nước (Table 18)
    2928: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'AMONI',
        parameterName: 'Amoni',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },
    2929: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'NITRAT',
        parameterName: 'Nitrat',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },
    2930: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'PH',
        parameterName: 'Độ pH',
        unit: 'pH',
        group: 'GIẾNG',
        view: 18,
    },
    2931: {
        station: 'G5_NM1',
        stationName: 'GIẾNG 5 NHÀ MÁY 1',
        parameter: 'TDS',
        parameterName: 'TDS',
        unit: 'mg/L',
        group: 'GIẾNG',
        view: 18,
    },

    // ============ G4 NM1 (Giếng 4 Nhà Máy 1) - 3 thông số ============
    2912: {
        station: 'G4_NM1',
        stationName: 'GIẾNG 4 NHÀ MÁY 1',
        parameter: 'MỰC_NƯỚC',
        parameterName: 'Mực Nước',
        unit: 'm',
        group: 'GIẾNG',
        view: 17,
    },
    2914: {
        station: 'G4_NM1',
        stationName: 'GIẾNG 4 NHÀ MÁY 1',
        parameter: 'LƯU_LƯỢNG',
        parameterName: 'Lưu Lượng',
        unit: 'm³/h',
        group: 'GIẾNG',
        view: 17,
    },
    2915: {
        station: 'G4_NM1',
        stationName: 'GIẾNG 4 NHÀ MÁY 1',
        parameter: 'TỔNG_LƯU_LƯỢNG',
        parameterName: 'Tổng Lưu Lượng',
        unit: 'm³',
        group: 'GIẾNG',
        view: 17,
    },

    // ============ TRẠM BƠM SỐ 1 - 3 thông số ============
    2917: {
        station: 'TRAM_1',
        stationName: 'TRẠM BƠM SỐ 1',
        parameter: 'MỰC_NƯỚC',
        parameterName: 'Mực Nước',
        unit: 'm',
        group: 'TRẠM_BƠM',
        view: 17,
    },
    2919: {
        station: 'TRAM_1',
        stationName: 'TRẠM BƠM SỐ 1',
        parameter: 'LƯU_LƯỢNG',
        parameterName: 'Lưu Lượng',
        unit: 'm³/h',
        group: 'TRẠM_BƠM',
        view: 17,
    },
    2920: {
        station: 'TRAM_1',
        stationName: 'TRẠM BƠM SỐ 1',
        parameter: 'TỔNG_LƯU_LƯỢNG',
        parameterName: 'Tổng Lưu Lượng',
        unit: 'm³',
        group: 'TRẠM_BƠM',
        view: 17,
    },

    // ============ TRẠM BƠM SỐ 24 (QT24) - 5 thông số ============
    2922: {
        station: 'TRAM_24',
        stationName: 'TRẠM BƠM SỐ 24 (QT24)',
        parameter: 'AMONI',
        parameterName: 'Amoni',
        unit: 'mg/L',
        group: 'TRẠM_BƠM',
        view: 18,
    },
    2923: {
        station: 'TRAM_24',
        stationName: 'TRẠM BƠM SỐ 24 (QT24)',
        parameter: 'MỰC_NƯỚC',
        parameterName: 'Mực Nước',
        unit: 'm',
        group: 'TRẠM_BƠM',
        view: 18,
    },
    2925: {
        station: 'TRAM_24',
        stationName: 'TRẠM BƠM SỐ 24 (QT24)',
        parameter: 'NITRAT',
        parameterName: 'Nitrat',
        unit: 'mg/L',
        group: 'TRẠM_BƠM',
        view: 18,
    },
    2926: {
        station: 'TRAM_24',
        stationName: 'TRẠM BƠM SỐ 24 (QT24)',
        parameter: 'PH',
        parameterName: 'Độ pH',
        unit: 'pH',
        group: 'TRẠM_BƠM',
        view: 18,
    },
    2927: {
        station: 'TRAM_24',
        stationName: 'TRẠM BƠM SỐ 24 (QT24)',
        parameter: 'TDS',
        parameterName: 'TDS',
        unit: 'mg/L',
        group: 'TRẠM_BƠM',
        view: 18,
    },
};

/**
 * Lấy thông tin trạm từ channel number
 * @param {number} channelNum - Channel number từ SCADA
 * @returns {Object|null} Thông tin trạm hoặc null nếu không tìm thấy
 */
function getStationInfo(channelNum) {
    return TVA_CHANNEL_MAPPING[channelNum] || null;
}

/**
 * Format dữ liệu channel thành object có ý nghĩa
 * @param {Object} channelData - Dữ liệu từ API {CnlNum, Val, Text, TextWithUnit, Stat, Color}
 * @returns {Object} Dữ liệu đã được format
 */
function formatChannelData(channelData) {
    const info = getStationInfo(channelData.CnlNum || channelData.channelNumber);
    
    if (!info) {
        return {
            channelNumber: channelData.CnlNum || channelData.channelNumber,
            station: 'UNKNOWN',
            stationName: `Channel ${channelData.CnlNum || channelData.channelNumber}`,
            parameter: 'UNKNOWN',
            parameterName: 'Unknown Parameter',
            value: channelData.Val || channelData.currentValue,
            displayText: channelData.TextWithUnit || channelData.displayText,
            unit: '',
            status: channelData.Stat === 1 ? 'Online' : 'Offline',
            color: channelData.Color || 'Black',
        };
    }
    
    return {
        channelNumber: channelData.CnlNum || channelData.channelNumber,
        station: info.station,
        stationName: info.stationName,
        parameter: info.parameter,
        parameterName: info.parameterName,
        value: channelData.Val || channelData.currentValue,
        displayText: channelData.TextWithUnit || channelData.displayText,
        unit: info.unit,
        status: channelData.Stat === 1 ? 'Online' : 'Offline',
        color: channelData.Color || 'Black',
        group: info.group,
    };
}

/**
 * Group các channels theo trạm
 * @param {Array} channelsData - Mảng dữ liệu channels
 * @returns {Object} Object với key là station ID, value là array parameters
 */
function groupByStation(channelsData) {
    const grouped = {};
    
    channelsData.forEach(channel => {
        const formatted = formatChannelData(channel);
        const stationId = formatted.station;
        
        if (!grouped[stationId]) {
            grouped[stationId] = {
                station: stationId,
                stationName: formatted.stationName,
                group: formatted.group,
                parameters: [],
            };
        }
        
        grouped[stationId].parameters.push({
            parameter: formatted.parameter,
            parameterName: formatted.parameterName,
            value: formatted.value,
            displayText: formatted.displayText,
            unit: formatted.unit,
            status: formatted.status,
            color: formatted.color,
            channelNumber: formatted.channelNumber,
        });
    });
    
    return grouped;
}

module.exports = {
    TVA_CHANNEL_MAPPING,
    getStationInfo,
    formatChannelData,
    groupByStation,
};
