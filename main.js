// main.js - Point d'entrée principal de l'application Electron
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Notification, safeStorage } = require('electron');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const log = require('electron-log');
const { machineIdSync } = require('node-machine-id');
const contextMenu = require('electron-context-menu');
const crypto = require('crypto');
const { getSecureMediaPlayer: rawGetSecureMediaPlayer } = require('./lib/secure-media-player');
const ConnectionManager = require('./lib/connection-manager');
let connectionManager = null;
let encryptionKey = null;

let secureMediaPlayerInstance = null;
const context = {
  get encryptionKey() { return encryptionKey; },
  getSecureMediaPlayer: async () => {
    if (!secureMediaPlayerInstance) {
      secureMediaPlayerInstance = rawGetSecureMediaPlayer(encryptionKey);
      await secureMediaPlayerInstance.initialize();
    }
    return secureMediaPlayerInstance;
  },
};

// Import des modules personnalisés
const LearnPressAPIClient = require('./lib/api-client');
const SecureDatabase = require('./lib/database');
const DownloadManager = require('./lib/download-manager');
const { setupIpcHandlers } = require('./lib/ipc-handlers');
const errorHandler = require('./lib/error-handler');

// Import des modules extraits
const { getOrCreateEncryptionKey } = require('./lib/key-management');
const { createSplashWindow, createMainWindow } = require('./lib/windows');
const { createMenu } = require('./lib/menu');
const { startMembershipCheck, stopMembershipCheck } = require('./lib/membership');
const { startMaintenance, stopMaintenance } = require('./lib/maintenance');
const { setupDeepLinking, handleDeepLink } = require('./lib/deep-linking');
const { setupAutoUpdater } = require('./lib/auto-updater-setup');

// Configuration du logging
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} {level} {text}';
autoUpdater.logger = log;

// Configuration par défaut
const config = {
    isDev: process.env.NODE_ENV === 'development',
    logging: {
        level: 'info',
        maxFileSize: 10 * 1024 * 1024
    },
    window: {
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768
    },
    membership: {
        checkInterval: 3600000, // 1 heure
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
    storage: {
        cleanupInterval: 86400000 // 24 heures
    },
    sync: {
        autoSync: true,
        syncInterval: 1800000, // 30 minutes
        retryDelay: 60000
    }
};

// ==================== GESTION DES ERREURS GLOBALES ====================

process.on('uncaughtException', async (error) => {
    log.error('Uncaught Exception:', error);
    console.error('Uncaught Exception:', error);
    
    if (database) {
        try {
            await database.close();
        } catch (e) {
            log.error('Erreur lors de la fermeture de la DB:', e);
        }
    }
    
    try {
        dialog.showErrorBox(
            'Erreur Critique',
            `Une erreur critique s'est produite:\n${error.message}\n\nL'application va se fermer.`
        );
    } catch (e) {
        // Ignorer si impossible d'afficher le dialogue
    }
    
    setTimeout(() => {
        app.exit(1);
    }, 1000);
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    if (errorHandler) {
        await errorHandler.handleError(reason, { type: 'unhandledRejection' });
    }
});

// ==================== VARIABLES GLOBALES ====================

let mainWindow = null;
let splashWindow = null;
let apiClient = null;
let database = null;
let mediaPlayer = null;
let downloadManager = null;
let isQuitting = false;

const isDev = config.isDev;
const deviceId = machineIdSync();

// Store sécurisé pour les données sensibles
let store;

function initializeStore() {
    const storeSchema = {
        apiUrl: { type: 'string', default: '' },
        token: { type: 'string', default: '' },
        refreshToken: { type: 'string', default: '' },
        userId: { type: 'number', default: 0 },
        username: { type: 'string', default: '' },
        savedApiUrl: { type: 'string', default: '' },
        savedUsername: { type: 'string', default: '' },
        lastSync: { type: 'string', default: '' },
        autoSync: { type: 'boolean', default: true },
        theme: { type: 'string', default: 'auto' },
        language: { type: 'string', default: 'fr' },
        membershipRestrictions: { type: 'object', default: {} },
        windowBounds: { 
            type: 'object', 
            default: {
                width: 1400,
                height: 900
            }
        }
    };

    try {
        store = new Store({
            encryptionKey: encryptionKey ? encryptionKey.substring(0, 32) : undefined,
            schema: storeSchema,
            clearInvalidConfig: true
        });
        
        store.set('_test', 'test');
        if (store.get('_test') !== 'test') {
            throw new Error('Store verification failed');
        }
        store.delete('_test');
        
        log.info('Store initialisé avec succès');
        return true;
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation du store:', error);
        
        try {
            store = new Store({
                schema: storeSchema,
                clearInvalidConfig: true
            });
            
            log.warn('Store initialisé sans chiffrement');
            
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('store-warning', {
                        message: 'Les données seront stockées sans chiffrement pour cette session'
                    });
                }
            }, 2000);
            
            return true;
            
        } catch (fallbackError) {
            log.error('Impossible de créer le store:', fallbackError);
            
            const memoryStore = {};
            store = {
                data: memoryStore,
                get: function(key, defaultValue) {
                    return this.data[key] !== undefined ? this.data[key] : 
                           (storeSchema[key]?.default !== undefined ? storeSchema[key].default : defaultValue);
                },
                set: function(key, value) {
                    this.data[key] = value;
                    return this;
                },
                delete: function(key) {
                    delete this.data[key];
                    return this;
                },
                clear: function() {
                    this.data = {};
                    return this;
                },
                has: function(key) {
                    return key in this.data;
                },
                getAll: function() {
                    return {...this.data};
                },
                size: function() {
                    return Object.keys(this.data).length;
                }
            };
            
            log.warn('Utilisation d\'un store temporaire en mémoire');
            return false;
        }
    }
}

// ==================== INITIALISATION ====================

async function initializeApp() {
    try {
        log.info('Initialisation de l\'application...');
        
        encryptionKey = await getOrCreateEncryptionKey();
        
        const storeInitialized = initializeStore();
        if (!storeInitialized) {
            log.warn('Store non initialisé correctement, utilisation du mode dégradé');
        }
        
        await initializeDatabase();
        
        await initializeMediaPlayer();
        
        await initializeDownloadManager();
        
        connectionManager = new ConnectionManager(store.get('apiUrl'));
        connectionManager.onStatusChange((isOnline) => {
            log.info(`Statut de connexion changé: ${isOnline ? 'En ligne' : 'Hors ligne'}`);
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('connection-status-changed', { isOnline });
            }
        });
        connectionManager.startMonitoring();
        log.info('Gestionnaire de connexion initialisé');
        
        startMaintenance({ app, getDatabase: () => database, getMainWindow: () => mainWindow, log, config });
        
        log.info('Application initialisée avec succès');
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation:', error);
        throw error;
    }
}

async function initializeDatabase() {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            log.info(`Initialisation de la base de données... (tentative ${retryCount + 1})`);
            
            const dbDir = path.join(app.getPath('userData'), 'database');
            const dbPath = path.join(dbDir, 'courses.db');
            
            await fs.mkdir(dbDir, { recursive: true }).catch(() => {});
            
            let dbExists = false;
            try {
                await fs.access(dbPath, fsSync.constants.R_OK | fsSync.constants.W_OK);
                dbExists = true;
            } catch (accessError) {
                const exists = await fs.access(dbPath).then(() => true).catch(() => false);
                if (exists) {
                    log.warn('Fichier DB inaccessible, création d\'une nouvelle DB');
                    const backupPath = dbPath + `.backup.${Date.now()}`;
                    await fs.rename(dbPath, backupPath);
                    log.info(`Ancienne DB sauvegardée: ${backupPath}`);
                }
            }
            
            database = new SecureDatabase(dbPath, encryptionKey);
            
            let initTimeout = 5000;
            const startTime = Date.now();
            
            while (!database.isInitialized && (Date.now() - startTime) < initTimeout) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (!database.isInitialized) {
                throw new Error('Timeout lors de l\'initialisation de la base de données');
            }
            
            const testResult = database.db.prepare('SELECT 1 as test').get();
            if (testResult.test !== 1) {
                throw new Error('Test de la base de données échoué');
            }
            
            log.info('Base de données initialisée avec succès');
            return true;
            
        } catch (error) {
            log.error(`Erreur lors de l\'initialisation de la DB (tentative ${retryCount + 1}):`, error);
            
            if (database) {
                try {
                    database.close();
                } catch (closeError) {
                    log.error('Erreur lors de la fermeture de la DB:', closeError);
                }
                database = null;
            }
            
            retryCount++;
            
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            } else {
                throw new Error(`Impossible d'initialiser la base de données après ${maxRetries} tentatives: ${error.message}`);
            }
        }
    }
}

async function initializeMediaPlayer() {
    try {
        log.info('Initialisation du lecteur média sécurisé...');
        
        mediaPlayer = await context.getSecureMediaPlayer();
        
        log.info('Lecteur média initialisé avec succès');
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation du lecteur média:', error);
        mediaPlayer = null;
    }
}

async function initializeDownloadManager() {
    try {
        log.info('Initialisation du gestionnaire de téléchargement...');
        
        if (!database) {
            throw new Error('Database non initialisée');
        }
        
        const encryption = require('./lib/encryption');
        
        downloadManager = new DownloadManager(database, encryption, null);
        
        log.info('Gestionnaire de téléchargement initialisé');
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation du download manager:', error);
        downloadManager = null;
    }
}

// ==================== SINGLE INSTANCE ====================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    log.info('Une autre instance est déjà en cours d\'exécution');
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        log.info('Tentative de lancer une seconde instance');
        
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
        
        const deeplinkingUrl = commandLine.find((arg) => arg.startsWith('learnpress://'));
        if (deeplinkingUrl) {
            handleDeepLink({ getMainWindow: () => mainWindow, log }, deeplinkingUrl);
        }
    });
}

// ==================== APP LIFECYCLE ====================

if (!isDev) {
    app.disableHardwareAcceleration();
}

if (isDev) {
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
}

app.whenReady().then(async () => {
    try {
        log.info('=== Application démarrée ===');
        log.info(`Version: ${app.getVersion()}`);
        log.info(`Electron: ${process.versions.electron}`);
        log.info(`Node: ${process.versions.node}`);
        log.info(`Platform: ${process.platform} ${process.arch}`);
        
        await initializeApp();
        
        splashWindow = createSplashWindow({
            BrowserWindow,
            path,
            onCreated: (win) => { splashWindow = win; }
        });
        
        mainWindow = createMainWindow({
            BrowserWindow,
            path,
            shell,
            contextMenu,
            store,
            config,
            isDev,
            splashWindow,
            isQuitting: () => isQuitting,
            onCreated: (win) => { mainWindow = win; }
        });
        
        createMenu({ Menu, shell, dialog, app, mainWindow, autoUpdater, log, isDev });
        
        setupIpcHandlers(ipcMain, {
            store,
            deviceId,
            app,
            dialog,
            mainWindow,
            getApiClient: () => apiClient,
            setApiClient: (client) => {
                apiClient = client;
                if (downloadManager) {
                    console.log('[Main] Mise à jour de l\'apiClient dans DownloadManager');
                    downloadManager.apiClient = client;
                }
                if (client && client.token) {
                    startMembershipCheck({ getApiClient: () => apiClient, store, getMainWindow: () => mainWindow, config, log });
                } else {
                    stopMembershipCheck();
                }
            },
            getDatabase: () => database,
            getDownloadManager: () => downloadManager,
            getMediaPlayer: () => mediaPlayer,
            errorHandler,
            config,
            encryptionKey,
            getSecureMediaPlayer: context.getSecureMediaPlayer
        });

        setupDeepLinking({ app, getMainWindow: () => mainWindow, log });
        
        setupAutoUpdater({
            autoUpdater,
            getMainWindow: () => mainWindow,
            dialog,
            log,
            Notification,
            setIsQuitting: (val) => { isQuitting = val; }
        });
        
        if (!isDev) {
            autoUpdater.checkForUpdatesAndNotify();
        }
        
        log.info('Application initialisée avec succès');
        
    } catch (error) {
        log.error('Erreur critique lors de l\'initialisation:', error);
        
        dialog.showErrorBox(
            'Erreur d\'initialisation',
            `L'application n'a pas pu démarrer correctement:\n\n${error.message}\n\nVeuillez consulter les logs pour plus de détails.`
        );
        
        app.quit();
    }
});

ipcMain.on('refresh-failed', async (event, data) => {
    log.warn('Échec du refresh token détecté');
    
    if (data.canRetry) {
        const choice = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: 'Session expirée',
            message: 'Votre session a expiré. Voulez-vous vous reconnecter automatiquement ?',
            buttons: ['Reconnecter', 'Déconnecter'],
            defaultId: 0,
            cancelId: 1
        });
        
        if (choice.response === 0) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('show-auto-reconnect');
            }
        } else {
            if (apiClient) {
                apiClient.clearTokens();
            }
            store.delete('token');
            store.delete('refreshToken');
            store.delete('tokenExpiry');
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('force-logout');
            }
        }
    }
});

app.on('before-quit', (event) => {
    if (!isQuitting) {
        event.preventDefault();
        isQuitting = true;
        
        cleanupBeforeQuit().then(() => {
            app.quit();
        });
    }
});

async function cleanupBeforeQuit() {
    log.info('Nettoyage avant fermeture...');
    
    try {
        stopMembershipCheck();
        stopMaintenance();
        
        if (database && database.isInitialized) {
            await database.close();
            log.info('Base de données fermée');
        }
        
        if (mediaPlayer) {
            await mediaPlayer.cleanup();
            log.info('Media player nettoyé');
        }
        
        if (apiClient && apiClient.token) {
            try {
                await apiClient.logout();
            } catch (error) {
                log.warn('Erreur lors de la déconnexion API:', error);
            }
        }
        
        log.info('Nettoyage terminé');
    } catch (error) {
        log.error('Erreur lors du nettoyage:', error);
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow({
            BrowserWindow,
            path,
            shell,
            contextMenu,
            store,
            config,
            isDev,
            splashWindow,
            isQuitting: () => isQuitting,
            onCreated: (win) => { mainWindow = win; }
        });
    } else if (mainWindow) {
        mainWindow.show();
    }
});

// ==================== SÉCURITÉ ====================

app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
        shell.openExternal(navigationUrl);
    });
    
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data:; " +
                    "media-src 'self' file: http://127.0.0.1:*; " +
                    "font-src 'self' data:; " +
                    "connect-src 'self' http://127.0.0.1:*; " +
                    "object-src 'none'; " +
                    "base-uri 'self'; " +
                    "form-action 'self'; " +
                    "frame-ancestors 'none'"
                ],
                'X-Content-Type-Options': ['nosniff'],
                'X-Frame-Options': ['DENY'],
                'X-XSS-Protection': ['1; mode=block']
            }
        });
    });
});

// ==================== EXPORTS POUR TESTS ====================

if (process.env.NODE_ENV === 'test') {
    module.exports = {
        app,
        store,
        createMainWindow,
        initializeApp
    };
}
