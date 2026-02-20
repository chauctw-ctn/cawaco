/**
 * Cấu hình tập trung cho toàn bộ hệ thống
 * Centralized Configuration Module
 */

module.exports = {
    // Cấu hình Server
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development'
    },

    // Cấu hình Database PostgreSQL
    database: {
        url: process.env.DATABASE_URL || 'postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',
        ssl: {
            rejectUnauthorized: false
        },
        options: '-c TimeZone=Asia/Ho_Chi_Minh',
        maxRecords: {
            tva: 100000,
            mqtt: 100000,
            scada: 100000
        }
    },

    // Cấu hình MQTT Broker
    mqtt: {
        broker: process.env.MQTT_BROKER || 'mqtt://14.225.252.85',
        port: parseInt(process.env.MQTT_PORT) || 1883,
        topic: process.env.MQTT_TOPIC || 'telemetry',
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clientId: `mqtt_client_${Date.now()}`,
        deviceNameMap: {
            'G15': 'GIẾNG SỐ 15',
            'G18': 'GIẾNG SỐ 18',
            'G29A': 'GIẾNG SỐ 29A',
            'G30A': 'GIẾNG SỐ 30A',
            'G31B': 'GIẾNG SỐ 31B',
            'GS1_NM2': 'NHÀ MÁY SỐ 1 - GIẾNG SỐ 2',
            'GS2_NM1': 'NHÀ MÁY SỐ 2 - GIẾNG SỐ 1',
            'GTACVAN': 'GIẾNG TẮC VẠN',
            'QT1_NM2': 'QT1-NM2 (Quan trắc NM2)',
            'QT2': 'QT2M (36/GP-BTNMT)',
            'QT2_NM2': 'QT2-NM2 (Quan trắc NM2)',
            'QT2M': 'QT2M (36/GP-BTNMT)',
            'QT5': 'QT5 (Quan trắc)'
        },
        parameterNameMap: {
            'LUULUONG': 'Lưu lượng',
            'MUCNUOC': 'Mực nước',
            'NHIETDO': 'Nhiệt độ nước',
            'TONGLUULUONG': 'Tổng lưu lượng'
        }
    },

    // Cấu hình TVA (Quan trắc TVA)
    tva: {
        url: process.env.TVA_URL || 'http://camau.dulieuquantrac.com:8906',
        loginUrl: process.env.TVA_LOGIN_URL || 'http://camau.dulieuquantrac.com:8906/index.php?module=users&view=users&task=checklogin',
        username: process.env.TVA_USERNAME || 'ctncamau@quantrac.net',
        password: process.env.TVA_PASSWORD || '123456789',
        timeout: 15000,
        maxRetries: 3,
        retryDelay: 5000
    },

    // Cấu hình SCADA-TVA
    scada: {
        url: process.env.SCADA_URL || 'http://14.161.36.253:86',
        loginUrl: process.env.SCADA_LOGIN_URL || 'http://14.161.36.253:86/Scada/Login.aspx',
        username: process.env.SCADA_USERNAME || 'cncamau',
        password: process.env.SCADA_PASSWORD || 'cm123456',
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 5000
    },

    // Cấu hình cập nhật dữ liệu định kỳ
    intervals: {
        tva: 5 * 60 * 1000,      // 5 phút
        mqtt: 1 * 60 * 1000,     // 1 phút (chỉ kiểm tra kết nối)
        scada: 5 * 60 * 1000,    // 5 phút
        cleanup: 24 * 60 * 60 * 1000 // 24 giờ
    },

    // Cấu hình Authentication
    auth: {
        users: {
            'admin': {
                password: 'admin123', // Trong production, sử dụng bcrypt
                name: 'Administrator',
                role: 'admin'
            },
            'user': {
                password: 'user123',
                name: 'User',
                role: 'user'
            }
        },
        jwtSecret: process.env.JWT_SECRET || 'camau-water-monitoring-secret-key-2026',
        jwtExpiresIn: '7d', // Token hết hạn sau 7 ngày
        tokenExpiry: 24 * 60 * 60 * 1000 // 24 giờ (legacy, for reference)
    },

    // Cấu hình trạng thái trạm (online/offline)
    station: {
        // Thời gian timeout (phút) - Nếu dữ liệu không cập nhật quá thời gian này => offline
        timeoutMinutes: 60,
        // Có thể cấu hình riêng cho từng loại trạm
        timeoutByType: {
            'TVA': 60,      // TVA: 60 phút
            'MQTT': 30,     // MQTT: 30 phút (Real-time nên timeout ngắn hơn)
            'SCADA': 60     // SCADA: 60 phút
        }
    }
};
