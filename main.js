// main.js - Point d'entrée principal de l'application Electron
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Notification } = require('electron');
//const { SecureMediaPlayer, getSecureMediaPlayer } = require('./lib/secure-media-player');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const log = require('electron-log');
const { machineIdSync } = require('node-machine-id');
const contextMenu = require('electron-context-menu');
const crypto = require('crypto');
const { getSecureMediaPlayer: rawGetSecureMediaPlayer } = require('./lib/secure-media-player');
const encryptionKey = getOrCreateEncryptionKey();

let secureMediaPlayerInstance = null;
const context = {
  // ... autres props existantes ...
  encryptionKey,
  getSecureMediaPlayer: async () => {
    if (!secureMediaPlayerInstance) {
      secureMediaPlayerInstance = rawGetSecureMediaPlayer(encryptionKey);
      await secureMediaPlayerInstance.initialize();
    }
    return secureMediaPlayerInstance;
  },
  // éventuellement expose aussi getMediaPlayer si utilisé ailleurs
};

// Import des modules personnalisés
const LearnPressAPIClient = require('./lib/api-client');
const SecureDatabase = require('./lib/database');
const DownloadManager = require('./lib/download-manager');
//const { SecureMediaPlayer } = require('./lib/secure-media-player');
const { setupIpcHandlers } = require('./lib/ipc-handlers');
const errorHandler = require('./lib/error-handler');


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
    
    // Essayer de sauvegarder l'état
    if (database) {
        try {
            await database.close();
        } catch (e) {
            log.error('Erreur lors de la fermeture de la DB:', e);
        }
    }
    
    // Afficher un dialogue d'erreur si possible
    try {
        dialog.showErrorBox(
            'Erreur Critique',
            `Une erreur critique s'est produite:\n${error.message}\n\nL'application va se fermer.`
        );
    } catch (e) {
        // Ignorer si impossible d'afficher le dialogue
    }
    
    // Attendre un peu pour que les logs soient écrits
    setTimeout(() => {
        app.exit(1);
    }, 1000);
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Envoyer l'erreur au error handler
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
let membershipCheckInterval = null;
let maintenanceInterval = null;
let isQuitting = false;

const isDev = config.isDev;
const deviceId = machineIdSync();

// Générer ou récupérer une clé de chiffrement sécurisée
function getOrCreateEncryptionKey() {
    const keyFile = path.join(app.getPath('userData'), '.key');
    
    try {
        if (fs.existsSync(keyFile)) {
            const key = fs.readFileSync(keyFile, 'utf8');
            // Vérifier que la clé est valide
            if (key && key.length === 64) {
                return key;
            }
        }
    } catch (error) {
        log.error('Erreur lors de la lecture de la clé:', error);
    }
    
    // Créer une nouvelle clé
    const key = crypto.randomBytes(32).toString('hex');
    
    try {
        // Créer le dossier userData s'il n'existe pas
        const userDataPath = app.getPath('userData');
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        
        // Sauvegarder la clé avec permissions restrictives
        fs.writeFileSync(keyFile, key, { mode: 0o600 });
        log.info('Nouvelle clé de chiffrement créée');
    } catch (error) {
        log.error('Erreur lors de la sauvegarde de la clé:', error);
    }
    
    return key;
}

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
        // Tenter de créer le store avec chiffrement
        store = new Store({
            encryptionKey: getOrCreateEncryptionKey().substring(0, 32),
            schema: storeSchema,
            clearInvalidConfig: true // AJOUT: Nettoie automatiquement les configs invalides
        });
        
        // Vérifier que le store fonctionne
        store.set('_test', 'test');
        if (store.get('_test') !== 'test') {
            throw new Error('Store verification failed');
        }
        store.delete('_test');
        
        log.info('Store initialisé avec succès');
        return true;
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation du store:', error);
        
        // Essayer sans chiffrement
        try {
            store = new Store({
                schema: storeSchema,
                clearInvalidConfig: true
            });
            
            log.warn('Store initialisé sans chiffrement');
            
            // Notifier l'utilisateur
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
            
            // Créer un store minimal en mémoire avec méthodes complètes
            const memoryStore = {};
            store = {
                data: memoryStore,
                get: function(key, defaultValue) {
                    return this.data[key] !== undefined ? this.data[key] : 
                           (storeSchema[key]?.default !== undefined ? storeSchema[key].default : defaultValue);
                },
                set: function(key, value) {
                    this.data[key] = value;
                    return this; // Pour le chaînage
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
                // Ajouter les méthodes manquantes
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

// ==================== GESTION DES ABONNEMENTS ====================

function startMembershipCheck() {
    checkMembershipStatus();
    
    membershipCheckInterval = setInterval(async () => {
        await checkMembershipStatus();
    }, config.membership.checkInterval);
}

function stopMembershipCheck() {
    if (membershipCheckInterval) {
        clearInterval(membershipCheckInterval);
        membershipCheckInterval = null;
    }
}

async function checkMembershipStatus() {
    if (!apiClient || !apiClient.token) return;
    
    try {
        const result = await apiClient.verifySubscription();
        
        if (!result.success || !result.isActive) {
            handleInactiveMembership(result);
        } else {
            handleActiveMembership(result);
        }
    } catch (error) {
        log.error('Erreur lors de la vérification de l\'abonnement:', error);
    }
}

function handleInactiveMembership(result) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('membership-status-changed', {
            isActive: false,
            subscription: result.subscription
        });
    }
    
    applyMembershipRestrictions(result.subscription);
}

function handleActiveMembership(result) {
    removeMembershipRestrictions();
    
    if (result.subscription?.expires_at) {
        const expiresAt = new Date(result.subscription.expires_at);
        const daysUntilExpiry = Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry <= config.membership.warningDays && daysUntilExpiry > 0) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('membership-expiring-soon', {
                    daysLeft: daysUntilExpiry,
                    expiresAt: result.subscription.expires_at
                });
            }
        }
    }
}

function applyMembershipRestrictions(subscription) {
    const restrictions = {
        canDownloadPremium: false,
        canSync: false,
        maxCourses: config.membership.freeTierLimits.maxCourses,
        maxDownloadSize: config.membership.freeTierLimits.maxDownloadSize
    };
    
    if (store && store.set) {
        store.set('membershipRestrictions', restrictions);
    }
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('apply-restrictions', restrictions);
    }
}

function removeMembershipRestrictions() {
    if (store && store.delete) {
        store.delete('membershipRestrictions');
    }
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remove-restrictions');
    }
}

// ==================== NETTOYAGE ET MAINTENANCE ====================

function startMaintenance() {
    // Exécuter immédiatement puis périodiquement
    performMaintenance();
    
    maintenanceInterval = setInterval(async () => {
        await performMaintenance();
    }, config.storage.cleanupInterval);
}

function stopMaintenance() {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = null;
    }
}

async function performMaintenance() {
    try {
        log.info('Début de la maintenance périodique');
        
        // Nettoyer les données expirées
        if (database && database.isInitialized) {
            await database.cleanupExpiredData();
            
            const stats = database.getStats();
            log.info('Stats DB:', stats);
        }
        
        // Nettoyer les vieux logs
        cleanOldLogs();
        
        // Vérifier l'espace disque
        const diskSpace = await checkDiskSpace();
        if (diskSpace.free < 1024 * 1024 * 1024) { // Moins de 1GB
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('low-disk-space', {
                    free: diskSpace.free,
                    used: diskSpace.used
                });
            }
        }
        
        log.info('Maintenance périodique terminée');
    } catch (error) {
        log.error('Erreur lors de la maintenance:', error);
    }
}

async function checkDiskSpace() {
    try {
        // Utiliser require dynamique pour éviter les erreurs si le module n'existe pas
        const checkDiskSpace = require('check-disk-space').default;
        const userDataPath = app.getPath('userData');
        const diskSpace = await checkDiskSpace(userDataPath);
        
        return {
            free: diskSpace.free,
            total: diskSpace.size,
            used: diskSpace.size - diskSpace.free
        };
    } catch (error) {
        // Retourner des valeurs par défaut si le module n'est pas disponible
        return {
            free: 10 * 1024 * 1024 * 1024, // 10GB
            total: 100 * 1024 * 1024 * 1024, // 100GB
            used: 90 * 1024 * 1024 * 1024 // 90GB
        };
    }
}

function cleanOldLogs() {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) return;
    
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 jours
    const now = Date.now();
    
    try {
        const files = fs.readdirSync(logsDir);
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    log.info('Ancien log supprimé:', file);
                }
            } catch (err) {
                log.warn('Erreur lors de la vérification du fichier:', err);
            }
        });
    } catch (error) {
        log.warn('Erreur lors du nettoyage des logs:', error);
    }
}

// ==================== INITIALISATION ====================

async function initializeApp() {
    try {
        log.info('Initialisation de l\'application...');
        
        // Initialiser le store en premier
        const storeInitialized = initializeStore();
        if (!storeInitialized) {
            log.warn('Store non initialisé correctement, utilisation du mode dégradé');
        }
        
        // Initialiser la base de données
        await initializeDatabase();
        
        // Initialiser le lecteur média sécurisé
        await initializeMediaPlayer();
        
        // Créer le gestionnaire de téléchargement
        await initializeDownloadManager();
        
        // Démarrer la maintenance
        startMaintenance();
        
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
            const encryptionKey = getOrCreateEncryptionKey();
            
            // Créer le dossier de la DB s'il n'existe pas
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            // Vérifier si le fichier DB existe et est accessible
            let dbExists = false;
            try {
                if (fs.existsSync(dbPath)) {
                    fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
                    dbExists = true;
                }
            } catch (accessError) {
                log.warn('Fichier DB inaccessible, création d\'une nouvelle DB');
                if (fs.existsSync(dbPath)) {
                    // Backup de l'ancienne DB
                    const backupPath = dbPath + `.backup.${Date.now()}`;
                    fs.renameSync(dbPath, backupPath);
                    log.info(`Ancienne DB sauvegardée: ${backupPath}`);
                }
            }
            
            database = new SecureDatabase(dbPath, encryptionKey);
            
            // Attendre que la DB soit prête
            let initTimeout = 5000; // 5 secondes
            const startTime = Date.now();
            
            while (!database.isInitialized && (Date.now() - startTime) < initTimeout) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (!database.isInitialized) {
                throw new Error('Timeout lors de l\'initialisation de la base de données');
            }
            
            // Test de la DB
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
        
        // Utiliser la fonction du context qui gère déjà le singleton
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
        
        // Créer le DownloadManager sans apiClient pour l'instant
        downloadManager = new DownloadManager(database, encryption, null);
        
        // L'apiClient sera défini plus tard via setApiClient
        
        log.info('Gestionnaire de téléchargement initialisé');
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation du download manager:', error);
        downloadManager = null;
    }
}

// ==================== CRÉATION DES FENÊTRES ====================

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 600,
        height: 400,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    
    splashWindow.loadFile(path.join(__dirname, 'src/splash.html'));
    
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function createMainWindow() {
    // Restaurer les dimensions de la fenêtre
    const windowBounds = store ? store.get('windowBounds') : null;
    
    mainWindow = new BrowserWindow({
        width: windowBounds?.width || config.window.width,
        height: windowBounds?.height || config.window.height,
        x: windowBounds?.x,
        y: windowBounds?.y,
        minWidth: config.window.minWidth,
        minHeight: config.window.minHeight,
        show: false,
        icon: path.join(__dirname, 'assets/icons/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: !isDev,
            // Permissions
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            navigateOnDragDrop: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    });
    
    mainWindow.loadFile(path.join(__dirname, 'src/index.html'));
    
    // Menu contextuel
    contextMenu({
        window: mainWindow,
        showInspectElement: isDev,
        showSearchWithGoogle: false,
        showCopyImage: true,
        prepend: () => []
    });
    
    // Empêcher la navigation vers des URLs externes
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });
    
    // Empêcher l'ouverture de nouvelles fenêtres
    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
    
    // Gérer le certificat invalide en dev
    if (isDev) {
        mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
            event.preventDefault();
            callback(true);
        });
    }
    
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            setTimeout(() => {
                if (splashWindow && !splashWindow.isDestroyed()) {
                    splashWindow.close();
                }
                mainWindow.show();
                
                // Vérifier si l'utilisateur est connecté
                const token = store ? store.get('token') : null;
                if (token) {
                    mainWindow.webContents.send('auto-login-success');
                }
            }, 1500);
        } else {
            mainWindow.show();
        }
    });
    
    // Sauvegarder la position de la fenêtre
    mainWindow.on('close', (event) => {
        if (!isQuitting && process.platform === 'darwin') {
            event.preventDefault();
            mainWindow.hide();
            return;
        }
        
        if (!mainWindow.isDestroyed() && store && store.set) {
            const bounds = mainWindow.getBounds();
            store.set('windowBounds', bounds);
        }
    });
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

function createMenu() {
    const template = [
        {
            label: 'Fichier',
            submenu: [
                {
                    label: 'Synchroniser',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('sync-courses');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Paramètres',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('open-settings');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Déconnexion',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('logout');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quitter',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Édition',
            submenu: [
                { role: 'undo', label: 'Annuler' },
                { role: 'redo', label: 'Rétablir' },
                { type: 'separator' },
                { role: 'cut', label: 'Couper' },
                { role: 'copy', label: 'Copier' },
                { role: 'paste', label: 'Coller' },
                { role: 'selectall', label: 'Tout sélectionner' }
            ]
        },
        {
            label: 'Affichage',
            submenu: [
                { role: 'reload', label: 'Recharger' },
                { role: 'forcereload', label: 'Forcer le rechargement' },
                { type: 'separator' },
                { role: 'resetzoom', label: 'Réinitialiser le zoom' },
                { role: 'zoomin', label: 'Zoom avant' },
                { role: 'zoomout', label: 'Zoom arrière' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Plein écran' }
            ]
        },
        {
            label: 'Fenêtre',
            submenu: [
                { role: 'minimize', label: 'Réduire' },
                { role: 'close', label: 'Fermer' }
            ]
        },
        {
            label: 'Aide',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        shell.openExternal('https://docs.votre-site.com');
                    }
                },
                {
                    label: 'Support',
                    click: () => {
                        shell.openExternal('https://support.votre-site.com');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Afficher les logs',
                    click: () => {
                        const logPath = log.transports.file.getFile().path;
                        shell.showItemInFolder(logPath);
                    }
                },
                { type: 'separator' },
                {
                    label: 'À propos',
                    click: () => {
                        if (mainWindow) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'À propos',
                                message: 'LearnPress Offline',
                                detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}`,
                                buttons: ['OK']
                            });
                        }
                    }
                },
                {
                    label: 'Vérifier les mises à jour',
                    click: () => {
                        autoUpdater.checkForUpdatesAndNotify();
                    }
                }
            ]
        }
    ];
    
    // Menu spécifique macOS
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                { role: 'about', label: 'À propos de LearnPress Offline' },
                { type: 'separator' },
                {
                    label: 'Préférences...',
                    accelerator: 'Cmd+,',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('open-settings');
                        }
                    }
                },
                { type: 'separator' },
                { role: 'services', label: 'Services', submenu: [] },
                { type: 'separator' },
                { role: 'hide', label: 'Masquer LearnPress Offline' },
                { role: 'hideothers', label: 'Masquer les autres' },
                { role: 'unhide', label: 'Tout afficher' },
                { type: 'separator' },
                { role: 'quit', label: 'Quitter LearnPress Offline' }
            ]
        });
        
        // Ajuster le menu Fenêtre pour macOS
        const windowMenuIndex = template.findIndex(m => m.label === 'Fenêtre');
        if (windowMenuIndex !== -1) {
            template[windowMenuIndex].submenu = [
                { role: 'minimize', label: 'Réduire' },
                { role: 'zoom', label: 'Zoom' },
                { type: 'separator' },
                { role: 'front', label: 'Tout ramener au premier plan' }
            ];
        }
    }
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ==================== DEEP LINKING ====================

function setupDeepLinking() {
    // Enregistrer le protocole
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('learnpress', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('learnpress');
    }
    
    // Gérer les liens sur Windows
    const deeplinkingUrl = process.argv.find((arg) => arg.startsWith('learnpress://'));
    if (deeplinkingUrl) {
        handleDeepLink(deeplinkingUrl);
    }
    
    // Gérer les liens sur macOS
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url) {
    log.info('Deep link reçu:', url);
    
    try {
        const urlParts = url.replace('learnpress://', '').split('/');
        const type = urlParts[0];
        const id = urlParts[1];
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('deep-link', { type, id });
            
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (error) {
        log.error('Erreur lors du traitement du deep link:', error);
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
        
        // Si une fenêtre existe, la mettre au premier plan
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
        
        // Gérer les deep links de la seconde instance
        const deeplinkingUrl = commandLine.find((arg) => arg.startsWith('learnpress://'));
        if (deeplinkingUrl) {
            handleDeepLink(deeplinkingUrl);
        }
    });
}

// ==================== APP LIFECYCLE ====================

// Désactiver l'accélération GPU si problèmes
if (!isDev) {
    app.disableHardwareAcceleration();
}

// Mode développement
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
        
        // Initialiser l'application
        await initializeApp();
        
        // Créer les fenêtres
        createSplashWindow();
        createMainWindow();
        createMenu();
        
        // Configurer les gestionnaires IPC
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
                    startMembershipCheck();
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
            getSecureMediaPlayer: context.getSecureMediaPlayer // réutilise la fonction définie plus haut avec lazy init
        });

        
        // Gérer le deep linking
        setupDeepLinking();
        
        // Vérifier les mises à jour en production
        if (!isDev) {
            autoUpdater.checkForUpdatesAndNotify();
        }
        
        log.info('Application initialisée avec succès');
        
    } catch (error) {
        log.error('Erreur critique lors de l\'initialisation:', error);
        
        // Afficher un dialogue d'erreur
        dialog.showErrorBox(
            'Erreur d\'initialisation',
            `L'application n'a pas pu démarrer correctement:\n\n${error.message}\n\nVeuillez consulter les logs pour plus de détails.`
        );
        
        app.quit();
    }
});

app.on('before-quit', (event) => {
    if (!isQuitting) {
        event.preventDefault();
        isQuitting = true;
        
        // Nettoyer avant de quitter
        cleanupBeforeQuit().then(() => {
            app.quit();
        });
    }
});

async function cleanupBeforeQuit() {
    log.info('Nettoyage avant fermeture...');
    
    try {
        // Arrêter les intervals
        stopMembershipCheck();
        stopMaintenance();
        
        // Fermer la base de données
        if (database && database.isInitialized) {
            await database.close();
            log.info('Base de données fermée');
        }
        
        // Nettoyer le media player
        if (mediaPlayer) {
            await mediaPlayer.cleanup();
            log.info('Media player nettoyé');
        }
        
        // Déconnecter l'API
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
        createMainWindow();
    } else if (mainWindow) {
        mainWindow.show();
    }
});

// ==================== AUTO UPDATER ====================

autoUpdater.on('checking-for-update', () => {
    log.info('Vérification des mises à jour...');
});

autoUpdater.on('update-available', (info) => {
    log.info('Mise à jour disponible:', info.version);
    
    if (mainWindow) {
        const notification = new Notification({
            title: 'Mise à jour disponible',
            body: `Une nouvelle version (${info.version}) est disponible. Elle sera téléchargée en arrière-plan.`,
            icon: path.join(__dirname, 'assets/icons/icon.png')
        });
        
        notification.show();
    }
});

autoUpdater.on('update-not-available', () => {
    log.info('Aucune mise à jour disponible');
});

autoUpdater.on('error', (err) => {
    log.error('Erreur lors de la mise à jour:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', progressObj);
    }
});

autoUpdater.on('update-downloaded', () => {
    log.info('Mise à jour téléchargée');
    
    if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Mise à jour prête',
            message: 'La mise à jour a été téléchargée. L\'application va redémarrer pour l\'installer.',
            buttons: ['Redémarrer maintenant', 'Plus tard']
        }).then((result) => {
            if (result.response === 0) {
                isQuitting = true;
                autoUpdater.quitAndInstall();
            }
        });
    }
});

// ==================== SÉCURITÉ ====================

app.on('web-contents-created', (event, contents) => {
    // Empêcher l'ouverture de nouvelles fenêtres
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
        shell.openExternal(navigationUrl);
    });
    
    // Configurer les headers de sécurité
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self' 'unsafe-inline'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: https:; " +
                    "media-src 'self' file: http://127.0.0.1:*; " +
                    "font-src 'self' data:; " +
                    "connect-src 'self' https: http://127.0.0.1:*"
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




