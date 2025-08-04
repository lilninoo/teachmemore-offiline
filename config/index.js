// config/index.js - Configuration centralisée de l'application
const path = require('path');
const { app } = require('electron');

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';
const isProduction = !isDev && !isTest;

const config = {
    // Environnement
    env: process.env.NODE_ENV || 'production',
    isDev,
    isTest,
    isProduction,

    // Application
    app: {
        name: 'LearnPress Offline',
        version: app?.getVersion?.() || '1.0.0',
        id: 'com.teachmemore.learnpress-offline',
        protocol: 'learnpress',
        userAgent: `LearnPressOffline/${app?.getVersion?.() || '1.0.0'}`
    },

    // Chemins
    paths: {
        userData: app?.getPath?.('userData') || path.join(__dirname, '..', 'userData'),
        database: path.join(app?.getPath?.('userData') || '.', 'database'),
        courses: path.join(app?.getPath?.('userData') || '.', 'courses'),
        media: path.join(app?.getPath?.('userData') || '.', 'media'),
        logs: path.join(app?.getPath?.('userData') || '.', 'logs'),
        temp: path.join(app?.getPath?.('userData') || '.', 'temp'),
        cache: path.join(app?.getPath?.('userData') || '.', 'cache')
    },

    // Base de données
    database: {
        filename: 'courses.db',
        options: {
            verbose: isDev ? console.log : null,
            fileMustExist: false,
            timeout: 5000
        }
    },

    // API
    api: {
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        namespace: 'col-lms/v1',
        endpoints: {
            auth: {
                login: '/auth/login',
                refresh: '/auth/refresh',
                verify: '/auth/verify',
                logout: '/auth/logout'
            },
            courses: {
                list: '/courses',
                details: '/courses/:id',
                package: '/courses/:id/package',
                media: '/courses/:id/media'
            },
            lessons: {
                content: '/lessons/:id/content'
            },
            progress: {
                sync: '/progress/sync'
            },
            packages: {
                status: '/packages/:id/status'
            }
        }
    },

    // Sécurité
    security: {
        algorithm: 'aes-256-gcm',
        keyLength: 32,
        saltLength: 32,
        iterations: 100000,
        tokenExpiry: 3600,
        refreshTokenExpiry: 604800,
        maxLoginAttempts: 5,
        lockoutDuration: 900
    },

    // Synchronisation
    sync: {
        autoSync: true,
        syncInterval: 1800000,
        batchSize: 100,
        retryDelay: 60000,
        maxRetries: 3
    },

    // Téléchargement
    download: {
        maxConcurrent: 2,
        chunkSize: 1048576,
        resumable: true,
        timeout: 300000,
        retryAttempts: 3,
        defaultOptions: {
            includeVideos: true,
            includeDocuments: true,
            compressImages: true,
            encryptionEnabled: true
        }
    },

    // Stockage
    storage: {
        maxCourseAge: 2592000000,
        maxCacheSize: 1073741824,
        cleanupInterval: 86400000,
        compressionLevel: 6
    },

    // Lecteur vidéo
    player: {
        saveProgressInterval: 5000,
        seekStep: 10,
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
        defaultPlaybackRate: 1,
        resumePlayback: true
    },

    // Interface utilisateur
    ui: {
        theme: 'auto',
        language: 'fr',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: 'HH:mm',
        animations: true,
        compactMode: false
    },

    // Logs
    logging: {
        level: isDev ? 'debug' : 'info',
        maxFiles: 5,
        maxFileSize: 10485760,
        format: isDev ? 'pretty' : 'json'
    },

    // Mises à jour
    updates: {
        autoCheck: true,
        autoDownload: false,
        checkInterval: 14400000,
        channel: isDev ? 'beta' : 'stable'
    },

    // Abonnements
    membership: {
        checkInterval: 3600000,
        warningDays: 7,
        restrictedFeatures: [
            'download_premium_courses',
            'offline_sync',
            'advanced_stats'
        ],
        freeTierLimits: {
            maxCourses: 3,
            maxDownloadSize: 536870912,
            syncEnabled: false
        }
    },

    // Performances
    performance: {
        lazyLoadImages: true,
        preloadCount: 5,
        maxMemoryUsage: 536870912,
        gcInterval: 300000
    },

    // Développement
    dev: {
        devTools: isDev,
        hotReload: isDev,
        mockData: false,
        apiDelay: 0,
        offlineMode: false
    }
};

// Fonctions utilitaires
config.getPath = (type) => {
    return config.paths[type] || config.paths.userData;
};

config.getApiUrl = (endpoint, params = {}) => {
    let url = endpoint;
    Object.keys(params).forEach(key => {
        url = url.replace(`:${key}`, params[key]);
    });
    return url;
};

config.isFeatureEnabled = (feature, userMembership = null) => {
    if (!config.membership.restrictedFeatures.includes(feature)) return true;
    return userMembership && userMembership.is_active;
};

config.validate = () => {
    const required = ['paths.userData', 'database.filename', 'api.namespace'];
    const errors = [];

    required.forEach(pathStr => {
        const keys = pathStr.split('.');
        let value = config;
        for (const key of keys) {
            value = value[key];
            if (!value) {
                errors.push(`Configuration manquante: ${pathStr}`);
                break;
            }
        }
    });

    if (errors.length > 0) {
        throw new Error(`Erreurs de configuration:\n${errors.join('\n')}`);
    }

    return true;
};

// Configuration spécifique à l'environnement
if (isDev) {
    try {
        const devConfig = require('./development');
        Object.assign(config, devConfig);
    } catch (e) {
        console.warn('[config] Aucun fichier de configuration dev détecté.');
    }
}

// Export
module.exports = isProduction ? Object.freeze(config) : config;
