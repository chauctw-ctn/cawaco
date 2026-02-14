/**
 * Tọa độ các trạm SCADA (Chất lượng nước)
 */
const SCADA_STATION_COORDINATES = {
    // Giếng và nhà máy - Station IDs
    'G4_NM1': { lat: 9.1794, lng: 105.1528 },
    'G4_NM2': { lat: 9.1801, lng: 105.1532 },
    'G5_NM1': { lat: 9.1785, lng: 105.1535 },
    'TRAM_1': { lat: 9.1770, lng: 105.1520 },
    'TRAM_24': { lat: 9.1805, lng: 105.1545 },
    
    // Giếng và nhà máy - Full names
    'GIẾNG 4 NHÀ MÁY 1': { lat: 9.1794, lng: 105.1528 },
    'GIẾNG 4 NHÀ MÁY 2': { lat: 9.1801, lng: 105.1532 },
    'GIẾNG 5 NHÀ MÁY 1': { lat: 9.1785, lng: 105.1535 },
    
    // Trạm bơm
    'TRẠM BƠM SỐ 1': { lat: 9.1770, lng: 105.1520 },
    'TRẠM BƠM SỐ 24 (QT24)': { lat: 9.1805, lng: 105.1545 }
};

module.exports = {
    SCADA_STATION_COORDINATES
};
