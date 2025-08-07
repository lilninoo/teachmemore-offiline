// app.js - Version COMPLÈTE avec DEBUG AMÉLIORÉ, WINSTON LOGGING et MODE OFFLINE/ONLINE

// Rendre les fonctions disponibles globalement dès le début
window.loadCoursesPage = null;
window.loadDownloadsPage = null;
window.loadProgressPage = null;
window.loadPageContent = null;



// ==================== CONFIGURATION WINSTON ====================
const winston = require('winston');
const path = require('path');

// Configuration du logger Winston pour le renderer
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
            return `${timestamp} [RENDERER-${level.toUpperCase()}] ${message} ${metaStr}`;
        })
    ),
    transports: [
        // Console transport uniquement (les logs fichiers sont gérés par le main process)
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Vérifier que les dépendances sont chargées
if (typeof window.Utils === 'undefined') {
    console.error('Utils.js doit être chargé avant app.js');
}

// Si Logger n'existe pas encore, utiliser un fallback
if (!window.Logger) {
    window.Logger = {
        info: console.log,
        error: console.error,
        warn: console.warn,
        debug: console.debug
    };
}

// AppLogger pour compatibilité avec le code existant
const AppLogger = {
    log: (message, data = null) => {
        logger.info(message, data || {});
    },
    error: (message, error = null) => {
        logger.error(message, error || {});
    },
    warn: (message, data = null) => {
        logger.warn(message, data || {});
    }
}

// Rediriger console.log vers Winston
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
};

console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));
console.warn = (...args) => logger.warn(args.join(' '));
console.info = (...args) => logger.info(args.join(' '));
console.debug = (...args) => logger.debug(args.join(' '));

// ==================== ÉTAT GLOBAL ====================
const AppState = {
    currentCourse: null,
    currentLesson: null,
    isOnline: navigator.onLine,
    isInitialized: false,
};

// Variables globales
let currentLesson = null;
let lessonProgress = 0;
let courseLoadingInProgress = false; // Protection contre les appels multiples
let dashboardUpdateInterval = null;

// ==================== DÉTECTION DE CONNEXION ====================


const API_CONFIG = {
    // Utiliser l'URL de config.js si disponible, sinon fallback
    getApiUrl: function() {
        if (window.AppConfig && window.AppConfig.API_URL) {
            return window.AppConfig.API_URL;
        }
        // Fallback si config.js n'est pas chargé
        console.error('Configuration API manquante, utilisation de l\'URL par défaut');
        return 'https://teachmemore.fr'; // Remplacez par votre URL
    }
};


// État de connexion
const ConnectionState = {
    isOnline: navigator.onLine,
    lastCheck: Date.now(),
    checkInterval: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
};

// Mode hors ligne avancé
class OfflineMode {
    constructor() {
        this.pendingActions = [];
        this.offlineStartTime = null;
    }
    
    enter() {
        logger.info('Activation du mode hors ligne');
        this.offlineStartTime = Date.now();
        
        // Sauvegarder l'état
        if (window.electronAPI && window.electronAPI.store) {
            window.electronAPI.store.set('offlineMode', true);
            window.electronAPI.store.set('offlineStartTime', this.offlineStartTime);
        }
        
        // Adapter l'interface
        this.adaptUI();
    }
    
    exit() {
        logger.info('Sortie du mode hors ligne');
        
        const duration = Date.now() - this.offlineStartTime;
        logger.info(`Durée du mode hors ligne: ${Math.round(duration / 1000)}s`);
        
        // Nettoyer l'état
        if (window.electronAPI && window.electronAPI.store) {
            window.electronAPI.store.delete('offlineMode');
            window.electronAPI.store.delete('offlineStartTime');
        }
        
        // Restaurer l'interface
        this.restoreUI();
        
        // Traiter les actions en attente
        this.processPendingActions();
    }
    
    adaptUI() {
        // Ajouter un bandeau d'information
        const banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.innerHTML = `
            <div class="offline-banner-content">
                <span class="offline-icon">📴</span>
                <span class="offline-text">Mode hors ligne actif</span>
                <span class="offline-info">Les modifications seront synchronisées à la reconnexion</span>
            </div>
        `;
        document.body.insertBefore(banner, document.body.firstChild);
        
        // Masquer les fonctionnalités en ligne uniquement
        document.querySelectorAll('.online-feature').forEach(el => {
            el.style.display = 'none';
        });
        
        // Ajouter des indicateurs visuels
        document.querySelectorAll('.needs-sync').forEach(el => {
            el.classList.add('pending-sync');
        });
    }
    
    restoreUI() {
        // Retirer le bandeau
        const banner = document.getElementById('offline-banner');
        if (banner) banner.remove();
        
        // Restaurer les fonctionnalités
        document.querySelectorAll('.online-feature').forEach(el => {
            el.style.display = '';
        });
        
        // Retirer les indicateurs
        document.querySelectorAll('.pending-sync').forEach(el => {
            el.classList.remove('pending-sync');
        });
    }
    
    queueAction(action) {
        logger.debug('Action mise en file d\'attente:', action);
        this.pendingActions.push({
            ...action,
            timestamp: Date.now()
        });
        
        // Sauvegarder en local
        if (window.electronAPI && window.electronAPI.store) {
            window.electronAPI.store.set('pendingActions', this.pendingActions);
        }
    }
    
    async processPendingActions() {
        if (this.pendingActions.length === 0) return;
        
        logger.info(`Traitement de ${this.pendingActions.length} actions en attente`);
        showLoader('Synchronisation des modifications...');
        
        const processed = [];
        const failed = [];
        
        for (const action of this.pendingActions) {
            try {
                await this.executeAction(action);
                processed.push(action);
            } catch (error) {
                logger.error('Erreur lors du traitement de l\'action:', error);
                failed.push(action);
            }
        }
        
        // Mettre à jour la liste des actions
        this.pendingActions = failed;
        
        // Sauvegarder l'état
        if (window.electronAPI && window.electronAPI.store) {
            if (failed.length > 0) {
                window.electronAPI.store.set('pendingActions', failed);
            } else {
                window.electronAPI.store.delete('pendingActions');
            }
        }
        
        hideLoader();
        
        if (processed.length > 0) {
            showSuccess(`${processed.length} modifications synchronisées`);
        }
        
        if (failed.length > 0) {
            showWarning(`${failed.length} modifications n'ont pas pu être synchronisées`);
        }
    }
    
    async executeAction(action) {
        logger.debug('Exécution de l\'action:', action.type);
        
        switch (action.type) {
            case 'updateProgress':
                return await window.electronAPI.api.updateLessonProgress(action.data);
                
            case 'completeLesson':
                return await window.electronAPI.api.completeLesson(action.data);
                
            case 'updateNote':
                return await window.electronAPI.api.updateNote(action.data);
                
            default:
                throw new Error(`Type d'action inconnu: ${action.type}`);
        }
    }
}

const offlineMode = new OfflineMode();

// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    logger.info('=== INITIALISATION DE L\'APPLICATION ===');
    logger.info(`URL: ${window.location.href}`);
    logger.info(`User Agent: ${navigator.userAgent}`);

    try {
        // Initialiser le StateManager en premier
        if (!window.stateManager) {
            await loadScript('js/state-manager.js');
        }
        await window.stateManager.initialize();
        logger.info('StateManager initialisé');

        // S'abonner aux événements du StateManager
        window.stateManager.on('courses-updated', () => {
            logger.info('Mise à jour des cours détectée');

            // Rafraîchir l'interface si on est sur le dashboard ou les cours
            const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
            if (currentPage === 'dashboard' || currentPage === 'courses') {
                loadPageContent(currentPage);
            }
        });

        // Attendre que l'AuthManager soit prêt
        logger.debug('Attente de l\'AuthManager...');
        await waitForAuthManager();
        logger.info('AuthManager prêt');

        // Initialiser la détection de connexion
        initializeConnectionDetection();

        // Initialiser les gestionnaires d'événements
        logger.debug('Initialisation des gestionnaires d\'événements...');
        initializeEventHandlers();
        logger.info('Gestionnaires d\'événements initialisés');

        // Initialiser l'interface utilisateur
        logger.debug('Initialisation de l\'interface utilisateur...');
        initializeUI();
        logger.info('Interface utilisateur initialisée');

        // Démarrer la mise à jour automatique du dashboard
        startDashboardAutoUpdate();

        AppState.isInitialized = true;
        logger.info('=== APPLICATION INITIALISÉE AVEC SUCCÈS ===');

        // Envoyer un ping au main process pour confirmer l'initialisation
        if (window.electronAPI && typeof window.electronAPI.send === 'function') {
            window.electronAPI.send('renderer-ready', { timestamp: new Date().toISOString() });
        }
    } catch (error) {
        logger.error('Erreur fatale lors de l\'initialisation:', {
            message: error?.message || String(error),
            stack: error?.stack || 'Pas de stack disponible'
        });
        showError('Erreur lors de l\'initialisation de l\'application');
    }
});

// ==================== GESTION DES ERREURS GLOBALES ====================
window.addEventListener('error', (event) => {
    logger.error('Erreur JavaScript non capturée:', {
        message: event.error?.message || event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
    });
});

window.addEventListener('unhandledrejection', (event) => {
    logger.error('Promise rejetée non gérée:', {
        reason: event.reason,
        promise: event.promise
    });
});

// ==================== FONCTIONS DE CONNEXION ====================

// Initialiser la détection de connexion
function initializeConnectionDetection() {
    logger.info('Initialisation de la détection de connexion');
    
    // Écouter les événements de connexion
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Vérification périodique (toutes les 30 secondes)
    ConnectionState.checkInterval = setInterval(() => {
        checkConnectionStatus();
    }, 30000);
    
    // Vérification initiale
    checkConnectionStatus();
}

// Gérer le passage en ligne
async function handleOnline() {
    logger.info('🌐 Connexion Internet rétablie');
    ConnectionState.isOnline = true;
    ConnectionState.reconnectAttempts = 0;
    AppState.isOnline = true;
    
    // Sortir du mode hors ligne
    offlineMode.exit();
    
    // Mettre à jour l'UI
    updateConnectionUI(true);
    
    // Notifier les modules
    if (window.downloadManager) {
        window.downloadManager.setOnlineStatus(true);
    }
    
    // Afficher une notification
    showSuccess('Connexion rétablie');
    
    // Attendre un peu avant de synchroniser
    setTimeout(async () => {
        // Vérifier si on a des éléments à synchroniser
        const unsyncedCount = await getUnsyncedCount();
        if (unsyncedCount > 0) {
            showInfo(`${unsyncedCount} éléments à synchroniser`);
            
            // Proposer la synchronisation
            if (window.syncManager) {
                const shouldSync = confirm(
                    `Vous avez ${unsyncedCount} modifications non synchronisées.\n` +
                    'Voulez-vous les synchroniser maintenant ?'
                );
                
                if (shouldSync) {
                    window.syncManager.performFullSync();
                }
            }
        }
        
        // Vérifier les mises à jour
        checkForUpdates();
        
    }, 3000);
}

// Gérer le passage hors ligne
function handleOffline() {
    logger.warn('📴 Connexion Internet perdue');
    ConnectionState.isOnline = false;
    AppState.isOnline = false;
    
    // Entrer en mode hors ligne
    offlineMode.enter();
    
    // Mettre à jour l'UI
    updateConnectionUI(false);
    
    // Notifier les modules
    if (window.downloadManager) {
        window.downloadManager.setOnlineStatus(false);
    }
    
    // Afficher une notification
    showWarning('Mode hors ligne - Les modifications seront synchronisées plus tard');
    
    // Arrêter les opérations nécessitant Internet
    stopOnlineOperations();
}

// Vérifier l'état de la connexion
async function checkConnectionStatus() {
    const wasOnline = ConnectionState.isOnline;
    
    try {
        // Méthode 1: navigator.onLine
        if (!navigator.onLine) {
            ConnectionState.isOnline = false;
            if (wasOnline) handleOffline();
            return;
        }
        
        // Méthode 2: Ping un serveur fiable
        const testUrls = [
            'https://www.google.com/favicon.ico',
            'https://api.github.com',
            'https://cdn.jsdelivr.net'
        ];
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        try {
            const response = await fetch(testUrls[0], {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            ConnectionState.isOnline = true;
            
            if (!wasOnline) {
                handleOnline();
            }
            
        } catch (error) {
            clearTimeout(timeout);
            
            // Essayer avec l'API Electron si disponible
            if (window.electronAPI && window.electronAPI.checkInternet) {
                const isOnline = await window.electronAPI.checkInternet();
                ConnectionState.isOnline = isOnline;
                
                if (isOnline && !wasOnline) {
                    handleOnline();
                } else if (!isOnline && wasOnline) {
                    handleOffline();
                }
            } else {
                ConnectionState.isOnline = false;
                if (wasOnline) handleOffline();
            }
        }
        
        ConnectionState.lastCheck = Date.now();
        
    } catch (error) {
        logger.error('Erreur lors de la vérification de connexion:', error);
        ConnectionState.isOnline = false;
        if (wasOnline) handleOffline();
    }
}

// Mettre à jour l'interface selon l'état de connexion
function updateConnectionUI(isOnline) {
    // Indicateur de connexion
    let indicator = document.getElementById('connection-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'connection-indicator';
        document.body.appendChild(indicator);
    }
    
    indicator.className = `connection-indicator ${isOnline ? 'online' : 'offline'}`;
    indicator.innerHTML = isOnline ? 
        '<span>🟢 En ligne</span>' : 
        '<span>🔴 Hors ligne</span>';
    
    // Désactiver/activer certains boutons
    const onlineOnlyButtons = document.querySelectorAll('.online-only');
    onlineOnlyButtons.forEach(btn => {
        btn.disabled = !isOnline;
        if (!isOnline) {
            btn.title = 'Fonctionnalité disponible uniquement en ligne';
        } else {
            btn.title = '';
        }
    });
    
    // Ajouter une classe au body
    document.body.classList.toggle('offline-mode', !isOnline);
    
    // Mettre à jour le bouton de synchronisation
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.classList.toggle('online-only', true);
        syncBtn.disabled = !isOnline;
    }
    
    // Mettre à jour le bouton de téléchargement
    const downloadBtn = document.getElementById('download-course-btn');
    if (downloadBtn) {
        downloadBtn.classList.toggle('online-only', true);
        downloadBtn.disabled = !isOnline;
    }
}

// Arrêter les opérations nécessitant Internet
function stopOnlineOperations() {
    // Arrêter la synchronisation automatique
    if (window.syncManager && window.syncManager.stopAutoSync) {
        window.syncManager.stopAutoSync();
    }
    
    // Mettre en pause les téléchargements
    if (window.downloadManager && window.downloadManager.pauseAllDownloads) {
        window.downloadManager.pauseAllDownloads();
    }
    
    // Arrêter la vérification de connexion fréquente
    if (ConnectionState.checkInterval) {
        clearInterval(ConnectionState.checkInterval);
        // Réduire la fréquence en mode hors ligne (toutes les 2 minutes)
        ConnectionState.checkInterval = setInterval(() => {
            checkConnectionStatus();
        }, 120000);
    }
}

// Obtenir le nombre d'éléments non synchronisés
async function getUnsyncedCount() {
    try {
        const result = await window.electronAPI.db.getUnsyncedItems();
        if (result.success && result.result) {
            return result.result.length;
        }
        return 0;
    } catch (error) {
        logger.error('Erreur lors du comptage des éléments non synchronisés:', error);
        return 0;
    }
}

// Vérifier les mises à jour (en ligne seulement)
async function checkForUpdates() {
    if (!ConnectionState.isOnline) return;
    
    try {
        logger.info('Vérification des mises à jour des cours...');
        
        const localCourses = await window.electronAPI.db.getAllCourses();
        if (!localCourses.success || !localCourses.result) return;
        
        let updatesAvailable = 0;
        
        for (const course of localCourses.result) {
            try {
                const onlineVersion = await window.electronAPI.api.getCourse(course.course_id);
                if (onlineVersion.success && onlineVersion.data) {
                    if (new Date(onlineVersion.data.updated_at) > new Date(course.updated_at)) {
                        updatesAvailable++;
                        logger.info(`Mise à jour disponible pour: ${course.title}`);
                    }
                }
            } catch (error) {
                logger.debug(`Impossible de vérifier les mises à jour pour ${course.course_id}`);
            }
        }
        
        if (updatesAvailable > 0) {
            showInfo(`${updatesAvailable} mise${updatesAvailable > 1 ? 's' : ''} à jour disponible${updatesAvailable > 1 ? 's' : ''}`);
        }
        
    } catch (error) {
        logger.error('Erreur lors de la vérification des mises à jour:', error);
    }
}

// ==================== FONCTIONS UTILITAIRES ====================

// Attendre que l'AuthManager soit disponible
function waitForAuthManager() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const timeout = 10000; // 10 secondes
        
        const checkAuth = () => {
            const elapsed = Date.now() - startTime;
            
            if (window.AuthManager) {
                logger.debug(`AuthManager trouvé après ${elapsed}ms`);
                resolve();
            } else if (elapsed > timeout) {
                logger.error('Timeout: AuthManager introuvable après 10 secondes');
                reject(new Error('AuthManager timeout'));
            } else {
                setTimeout(checkAuth, 100);
            }
        };
        checkAuth();
    });
}

// ==================== GESTIONNAIRES D'ÉVÉNEMENTS ====================

function initializeEventHandlers() {
    logger.info('Initialisation des gestionnaires d\'événements...');
    
    // Navigation sidebar
    const navItems = document.querySelectorAll('.nav-item');
    logger.debug(`${navItems.length} éléments de navigation trouvés`);
    
    navItems.forEach((item) => {
        // S'assurer qu'on supprime d'abord tout ancien listener
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        // Ajouter le nouveau listener
        newItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const page = newItem.dataset.page;
            logger.debug(`Navigation clicked: ${page}`);
            
            if (!page) {
                logger.error('Pas de data-page sur l\'élément cliqué');
                return;
            }
            
            // Vérifier que les éléments de contenu existent
            const targetContent = document.getElementById(`${page}-content`);
            if (!targetContent) {
                logger.error(`Élément de contenu non trouvé: ${page}-content`);
                return;
            }
            
            // Mettre à jour l'état actif
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            newItem.classList.add('active');
            
            // Afficher la page
            showContentPage(page);
            
            // Charger le contenu - utiliser la fonction globale
            if (window.loadPageContent) {
                window.loadPageContent(page);
            } else {
                logger.error('loadPageContent non disponible');
            }
        });
    });
    
    // Boutons header
    setupHeaderButtons();
    
    // Modals
    setupModals();
    
    // Player controls
    setupPlayerControls();
    
    // Recherche
    setupSearch();
    
    // Download button
    setupDownloadButton();
    
    // IMPORTANT: Écouter l'événement login-success
    window.electronAPI.on('login-success', async (user) => {
        logger.info('Événement login-success reçu', {
            username: user.username,
            userId: user.id,
            displayName: user.displayName
        });
        
        // Mettre à jour l'état
        window.AuthState.isLoggedIn = true;
        window.AuthState.user = user;
        
        // Afficher le dashboard
        showContentPage('dashboard');
        
        // Charger les données avec protection contre appels multiples
        if (!courseLoadingInProgress) {
            courseLoadingInProgress = true;
            setTimeout(async () => {
                try {
                    await loadDashboardData();
                } finally {
                    courseLoadingInProgress = false;
                }
            }, 100);
        }
        
        // Mettre à jour la navigation
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('[data-page="dashboard"]')?.classList.add('active');
        
        // Mettre à jour le nom d'utilisateur dans l'UI
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName) {
            userDisplayName.textContent = user.displayName || user.username || 'Utilisateur';
        }
        
        logger.info('Interface mise à jour après connexion');
    });
    
    // Écouter l'événement auto-login-success
    window.electronAPI.on('auto-login-success', () => {
        logger.info('Auto-login détecté');
        
        // Charger les données du dashboard après un court délai
        setTimeout(() => {
            logger.debug('Chargement des données après auto-login');
            loadDashboardData();
        }, 500);
    });
    
    // Écouter les événements de synchronisation
    window.electronAPI.on('sync-completed', (data) => {
        logger.info('Synchronisation terminée', data);
        loadCourses(); // Recharger les cours
    });
    
    // Écouter les événements de téléchargement
    window.electronAPI.on('download-progress', (data) => {
        logger.debug('Progression téléchargement:', {
            courseId: data.courseId,
            progress: data.progress,
            speed: data.speed
        });
        updateDownloadProgress(data);
    });
    
    // NOUVEAU: Écouter l'événement download-manager:download-completed
    window.electronAPI.on('download-manager:download-completed', async (data) => {
        logger.info('Téléchargement terminé:', {
            courseId: data.courseId,
            courseTitle: data.course?.title
        });
        
        showSuccess(`"${data.course?.title || 'Cours'}" téléchargé avec succès !`);
        
        // IMPORTANT: Recharger les cours immédiatement
        await loadCourses();
        
        // Mettre à jour le compteur
        await updateCoursesCount();
        
        // Si on est sur la page dashboard, recharger les stats
        const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
        if (currentPage === 'dashboard') {
            await updateStats();
        }
        
        // Si on est sur la page cours, la recharger
        if (currentPage === 'courses' && window.loadCoursesPage) {
            await window.loadCoursesPage();
        }
        
        // Naviguer vers la page des téléchargements pour voir le résultat
        if (window.showContentPage) {
            window.showContentPage('downloads');
            window.loadDownloadsPage();
        }
    });
    
    // Écouter aussi l'événement download-completed (ancienne version)
    window.electronAPI.on('download-completed', async (data) => {
        logger.info('Téléchargement terminé (ancien événement):', data);
        // Faire la même chose
        await loadCourses();
        await updateCoursesCount();
    });
    
    // Écouter la progression des téléchargements
    window.electronAPI.on('download-manager:download-progress', (data) => {
        // Si c'est un nouveau téléchargement et qu'on n'a pas encore rafraîchi
        if (data.progress === 0 && !data.refreshed) {
            data.refreshed = true;
            // Recharger le compteur pour montrer qu'un téléchargement est en cours
            updateCoursesCount();
        }
    });
    
    window.electronAPI.on('download-error', (data) => {
        logger.error('Erreur téléchargement:', {
            courseId: data.courseId,
            error: data.error
        });
        showError('Erreur lors du téléchargement');
    });
    
    // Écouter la suppression d'un cours
    window.electronAPI.on('course-deleted', async () => {
        await updateCoursesCount();
        await loadCourses();
    });
    
    logger.info('Tous les gestionnaires d\'événements sont configurés');
}

// ==================== NAVIGATION CORRIGÉE ====================

function handleNavigation(e) {
    e.preventDefault();
    
    const page = e.currentTarget.dataset.page;
    logger.info(`Navigation vers: ${page}`);
    
    if (!AppState.isInitialized) {
        logger.warn('Application non initialisée, navigation annulée');
        return;
    }
    
    // Vérifier que la page existe
    const targetContent = document.getElementById(`${page}-content`);
    if (!targetContent) {
        logger.error(`Page non trouvée: ${page}-content`);
        // Log de debug pour voir ce qui existe
        logger.debug('Pages disponibles:', {
            dashboard: !!document.getElementById('dashboard-content'),
            courses: !!document.getElementById('courses-content'),
            downloads: !!document.getElementById('downloads-content'),
            progress: !!document.getElementById('progress-content')
        });
        return;
    }
    
    // Retirer active de tous
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });
    
    // Ajouter active au cliqué
    e.currentTarget.classList.add('active');
    
    // Afficher la page correspondante
    showContentPage(page);
    
    // Mettre à jour le titre
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
        const titles = {
            'dashboard': 'Tableau de bord',
            'courses': 'Mes cours',
            'downloads': 'Téléchargements',
            'progress': 'Ma progression'
        };
        pageTitle.textContent = titles[page] || 'LearnPress Offline';
    }
    
    // Charger le contenu approprié
    loadPageContent(page);
    
    logger.debug(`Navigation terminée vers ${page}`);
}

// Afficher une page de contenu - FONCTION CORRIGÉE
function showContentPage(pageId) {
    logger.info(`Affichage de la page: ${pageId}`);
    
    // Log de debug pour voir l'état avant
    logger.debug('État avant changement:', {
        pageId: pageId,
        targetExists: !!document.getElementById(`${pageId}-content`),
        allPages: Array.from(document.querySelectorAll('.content-page')).map(p => p.id)
    });
    
    // Masquer toutes les pages de contenu
    document.querySelectorAll('.content-page').forEach(page => {
        page.classList.add('hidden');
        page.style.display = 'none'; // Forcer le masquage
    });
    
    // Afficher la page demandée
    const targetPage = document.getElementById(`${pageId}-content`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.style.display = 'block'; // Forcer l'affichage
        
        // Mettre à jour le titre de la page
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
            const titles = {
                'dashboard': 'Tableau de bord',
                'courses': 'Mes cours',
                'downloads': 'Téléchargements',
                'progress': 'Ma progression'
            };
            pageTitle.textContent = titles[pageId] || pageId;
        }
        
        logger.debug(`Page ${pageId} affichée avec succès`);
    } else {
        logger.error(`Page non trouvée: ${pageId}-content`);
    }
}

// Charger le contenu d'une page - FONCTION GLOBALE MISE À JOUR
window.loadPageContent = function(page) {
    logger.info(`Chargement du contenu pour la page: ${page}`);
    
    switch (page) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'courses':
            if (window.loadCoursesPage) {
                window.loadCoursesPage();
            } else {
                // Fallback si la fonction n'est pas encore définie
                logger.warn('loadCoursesPage non définie, chargement basique');
                loadCourses();
            }
            break;
        case 'downloads':
            if (window.loadDownloadsPage) {
                window.loadDownloadsPage();
            } else {
                logger.warn('loadDownloadsPage non définie');
                const container = document.getElementById('downloads-list');
                if (container) {
                    container.innerHTML = '<p>Page des téléchargements</p>';
                }
            }
            break;
        case 'progress':
            if (window.loadProgressPage) {
                window.loadProgressPage();
            } else {
                logger.warn('loadProgressPage non définie');
                const container = document.getElementById('progress-container');
                if (container) {
                    container.innerHTML = '<p>Page de progression</p>';
                }
            }
            break;
        default:
            logger.warn(`Page inconnue: ${page}`);
    }
};

// ==================== INITIALISATION UI ====================

function initializeUI() {
    logger.info('Initialisation UI - État auth:', {
        isLoggedIn: window.AuthState?.isLoggedIn,
        hasUser: !!window.AuthState?.user
    });
    
    // Vérifier si on est déjà connecté (auto-login ou refresh)
    if (window.AuthState && window.AuthState.isLoggedIn) {
        logger.info('Utilisateur déjà connecté, affichage du dashboard');
        
        // Afficher directement le dashboard
        showContentPage('dashboard');
        
        // Marquer le lien "Tableau de bord" comme actif
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('[data-page="dashboard"]')?.classList.add('active');
        
        // Afficher le nom d'utilisateur
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName && window.AuthState.user) {
            userDisplayName.textContent = window.AuthState.user.displayName || 
                                         window.AuthState.user.username || 
                                         'Utilisateur';
        }
        
        // Masquer la page de login et afficher le dashboard
        const loginPage = document.getElementById('login-page');
        const dashboardPage = document.getElementById('dashboard-page');
        
        if (loginPage) {
            loginPage.style.display = 'none';
            loginPage.classList.remove('active');
        }
        
        if (dashboardPage) {
            dashboardPage.style.display = 'block';
            dashboardPage.classList.remove('hidden');
            dashboardPage.classList.add('active');
        }
        
        // Charger les données
        loadDashboardData();
        
        logger.info('UI configurée pour utilisateur connecté');
        
    } else {
        logger.info('Aucun utilisateur connecté, affichage de la page de connexion');
    }
}

// ==================== CONFIGURATION DES BOUTONS ====================

function setupHeaderButtons() {
    logger.debug('Configuration des boutons du header');
    
    // Menu toggle (mobile)
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            logger.debug('Toggle menu mobile');
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('active');
            }
        });
    }
    
    // Search button
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            logger.debug('Toggle barre de recherche');
            const searchBar = document.getElementById('search-bar');
            if (searchBar) {
                searchBar.classList.toggle('hidden');
                if (!searchBar.classList.contains('hidden')) {
                    document.getElementById('search-input')?.focus();
                }
            }
        });
    }
    
    // Sync button
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (!ConnectionState.isOnline) {
                showWarning('Synchronisation impossible en mode hors ligne');
                return;
            }
            
            logger.info('Démarrage de la synchronisation manuelle');
            if (window.syncManager) {
                showLoader('Synchronisation en cours...');
                try {
                    await window.syncManager.performFullSync();
                    logger.info('Synchronisation terminée avec succès');
                    showSuccess('Synchronisation terminée');
                } catch (error) {
                    logger.error('Erreur de synchronisation:', {
                        message: error.message,
                        stack: error.stack
                    });
                    showError('Erreur lors de la synchronisation');
                } finally {
                    hideLoader();
                }
            }
        });
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            logger.info('Demande de déconnexion');
            
            // Vérifier s'il y a des modifications non synchronisées
            if (!ConnectionState.isOnline) {
                const unsyncedCount = await getUnsyncedCount();
                if (unsyncedCount > 0) {
                    const confirmLogout = confirm(
                        `Attention ! Vous avez ${unsyncedCount} modifications non synchronisées.\n` +
                        'Si vous vous déconnectez maintenant, ces modifications seront perdues.\n\n' +
                        'Voulez-vous vraiment vous déconnecter ?'
                    );
                    
                    if (!confirmLogout) {
                        logger.debug('Déconnexion annulée - modifications non synchronisées');
                        return;
                    }
                }
            }
            
            if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
                logger.info('Déconnexion confirmée');
                if (window.AuthManager) {
                    await window.AuthManager.performLogout();
                }
            } else {
                logger.debug('Déconnexion annulée');
            }
        });
    }
    
    // Settings button
    const settingsBtn = document.getElementById('settings-btn-dashboard');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            logger.debug('Ouverture des paramètres');
            showSettingsModal();
        });
    }
}

// ==================== MODALS ====================

function setupModals() {
    logger.debug('Configuration des modals');
    
    // Fermer les modals en cliquant sur le backdrop
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            logger.debug('Fermeture modal via backdrop');
            e.target.classList.add('hidden');
        }
    });
    
    // Modal de téléchargement
    const closeDownloadModal = document.getElementById('close-download-modal');
    if (closeDownloadModal) {
        closeDownloadModal.addEventListener('click', () => {
            logger.debug('Fermeture modal téléchargement');
            document.getElementById('download-modal')?.classList.add('hidden');
        });
    }
    
    // Modal des paramètres
    const closeSettingsModal = document.getElementById('close-settings-modal');
    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            logger.debug('Fermeture modal paramètres');
            document.getElementById('settings-modal')?.classList.add('hidden');
        });
    }
}

// Afficher le modal des paramètres
function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

// ==================== PLAYER CONTROLS ====================

function setupPlayerControls() {
    logger.debug('Configuration des contrôles du player');
    
    const backBtn = document.getElementById('back-to-courses');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            logger.info('Retour aux cours');
            showDashboard();
            loadCourses();
        });
    }
    
    const prevBtn = document.getElementById('prev-lesson');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            logger.info('Navigation: Leçon précédente');
            navigateToPreviousLesson();
        });
    }
    
    const nextBtn = document.getElementById('next-lesson');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            logger.info('Navigation: Leçon suivante');
            navigateToNextLesson();
        });
    }
    
    const completeBtn = document.getElementById('complete-lesson');
    if (completeBtn) {
        completeBtn.addEventListener('click', async () => {
            logger.info('Marquer la leçon comme terminée');
            await completeCurrentLesson();
        });
    }
}

// Navigation entre les leçons
async function navigateToPreviousLesson() {
    // TODO: Implémenter la navigation vers la leçon précédente
    logger.debug('Navigation vers la leçon précédente');
}

async function navigateToNextLesson() {
    // TODO: Implémenter la navigation vers la leçon suivante
    logger.debug('Navigation vers la leçon suivante');
}

// Compléter la leçon actuelle
async function completeCurrentLesson() {
    if (!AppState.currentLesson) {
        logger.warn('Aucune leçon active');
        return;
    }
    
    const lessonId = AppState.currentLesson.lesson_id;
    
    try {
        if (ConnectionState.isOnline) {
            // En ligne : envoyer directement à l'API
            const result = await window.electronAPI.api.completeLesson({
                lessonId: lessonId,
                courseId: AppState.currentCourse.course_id
            });
            
            if (result.success) {
                showSuccess('Leçon marquée comme terminée');
                // Mettre à jour la base locale aussi
                await window.electronAPI.db.updateLessonProgress(lessonId, 100, true);
            }
        } else {
            // Hors ligne : sauvegarder localement et mettre en file d'attente
            await window.electronAPI.db.updateLessonProgress(lessonId, 100, true);
            
            offlineMode.queueAction({
                type: 'completeLesson',
                data: {
                    lessonId: lessonId,
                    courseId: AppState.currentCourse.course_id
                }
            });
            
            showInfo('Progression sauvegardée localement');
        }
        
        // Mettre à jour l'UI
        updateLessonUI(lessonId, true);
        
    } catch (error) {
        logger.error('Erreur lors de la complétion de la leçon:', error);
        showError('Impossible de marquer la leçon comme terminée');
    }
}

// Mettre à jour l'UI de la leçon
function updateLessonUI(lessonId, completed) {
    const lessonEl = document.querySelector(`[data-lesson-id="${lessonId}"]`);
    if (lessonEl) {
        if (completed) {
            lessonEl.classList.add('completed');
            const icon = lessonEl.querySelector('.lesson-icon');
            if (icon) icon.textContent = '✓';
        }
    }
}

// ==================== RECHERCHE ====================

function setupSearch() {
    logger.debug('Configuration de la recherche');
    
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            logger.debug(`Recherche: "${query}"`);
            searchCourses(query);
        }, 300));
    }
}

// ==================== TÉLÉCHARGEMENT ====================

function setupDownloadButton() {
    logger.debug('Configuration du bouton de téléchargement');
    
    const downloadBtn = document.getElementById('download-course-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (!ConnectionState.isOnline) {
                showWarning('Le téléchargement nécessite une connexion Internet');
                return;
            }
            logger.info('Ouverture modal téléchargement');
            showDownloadModal();
        });
    }
    
    const startDownloadBtn = document.getElementById('start-download');
    if (startDownloadBtn) {
        startDownloadBtn.addEventListener('click', () => {
            logger.info('Démarrage téléchargement');
            startDownload();
        });
    }
    
    const cancelDownloadBtn = document.getElementById('cancel-download');
    if (cancelDownloadBtn) {
        cancelDownloadBtn.addEventListener('click', () => {
            logger.debug('Annulation téléchargement');
            document.getElementById('download-modal')?.classList.add('hidden');
        });
    }
}

// Démarrer le téléchargement d'un cours
async function startDownload() {
    const courseSelect = document.getElementById('course-select');
    const courseId = courseSelect.value;
    
    if (!courseId) {
        showWarning('Veuillez sélectionner un cours');
        return;
    }
    
    const options = {
        includeVideos: document.getElementById('include-videos').checked,
        includeDocuments: document.getElementById('include-documents').checked,
        compress: document.getElementById('compress-media').checked
    };
    
    try {
        // Fermer le modal
        document.getElementById('download-modal').classList.add('hidden');
        
        // Démarrer le téléchargement
        const result = await window.electronAPI.download.downloadCourse({
            courseId: courseId,
            options: options
        });
        
        if (result.success) {
            showInfo('Téléchargement démarré !');
            
            // Pré-rafraîchir le dashboard pour montrer que quelque chose se passe
            setTimeout(() => {
                updateCoursesCount();
            }, 1000);
            
            // Naviguer vers les téléchargements
            if (window.navigateTo) {
                window.navigateTo('downloads');
            }
        } else {
            showError(result.error || 'Erreur lors du téléchargement');
        }
        
    } catch (error) {
        logger.error('Erreur lors du démarrage du téléchargement:', error);
        showError('Impossible de démarrer le téléchargement');
    }
}

// ==================== CHARGEMENT DES DONNÉES ====================

async function loadDashboardData() {
    logger.info('=== CHARGEMENT DASHBOARD ===');
    
    try {
        // Charger les cours
        await loadCourses();
        
        // Mettre à jour les statistiques
        await updateStats();
        
        // Mettre à jour les informations de stockage
        await updateStorageInfo();
        
        // Vérifier le statut de connexion
        updateConnectionUI(ConnectionState.isOnline);
        
        logger.info('Dashboard chargé avec succès');
        
    } catch (error) {
        logger.error('Erreur lors du chargement du dashboard:', {
            message: error.message,
            stack: error.stack
        });
        
        // En cas d'erreur, essayer au moins d'afficher les cours locaux
        if (!ConnectionState.isOnline) {
            showInfo('Mode hors ligne - Chargement des données locales');
        } else {
            showError('Erreur lors du chargement des données');
        }
    }
}

// Fonction pour rafraîchir le dashboard
async function refreshDashboard() {
    logger.info('Rafraîchissement du dashboard...');
    
    try {
        // Recharger les cours
        await loadCourses();
        
        // Mettre à jour les statistiques
        await updateStats();
        
        // Mettre à jour le stockage
        await updateStorageInfo();
        
        logger.info('Dashboard rafraîchi avec succès');
    } catch (error) {
        logger.error('Erreur lors du rafraîchissement:', error);
    }
}

// Rendre la fonction globale
window.refreshDashboard = refreshDashboard;

// ==================== CHARGEMENT DES COURS ====================

// Fonction loadCourses corrigée - utiliser AppLogger
async function loadCourses() {
    AppLogger.log('Chargement des cours...');
    
    const coursesContainer = document.getElementById('courses-container');
    const coursesListContainer = document.getElementById('courses-list');
    
    // Déterminer quel container utiliser
    const activeContainer = coursesContainer || coursesListContainer;
    
    try {
        // Si on est dans la page "Mes cours", ne pas afficher le loader ici
        // car il sera géré par loadCoursesPage
        if (coursesContainer && !coursesListContainer) {
            coursesContainer.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Chargement des cours...</p>
                </div>
            `;
        }
        
        let allCourses = [];
        
        // En mode hors ligne, charger uniquement les cours locaux
        if (!ConnectionState.isOnline) {
            AppLogger.log('Mode hors ligne - Chargement des cours locaux uniquement');
            const localResult = await window.electronAPI.db.getAllCourses();
            
            if (localResult.success && localResult.result) {
                allCourses = localResult.result.map(course => ({
                    ...course,
                    isDownloaded: true,
                    course_id: course.course_id,
                    id: course.course_id // S'assurer que l'ID est présent
                }));
            }
        } else {
            // En mode en ligne, charger et fusionner les données
            try {
                // Charger les cours locaux
                const localResult = await window.electronAPI.db.getAllCourses();
                const localCourses = localResult.success ? localResult.result : [];
                
                // Charger les cours en ligne
                AppLogger.log('Appel API getUserCourses...');
                const onlineResult = await window.electronAPI.api.getUserCourses({
                    page: 1,
                    perPage: 50,
                    includeCertificates: true
                });
                
                if (onlineResult.success && onlineResult.courses) {
                    // Fusionner les données
                    const coursesMap = new Map();
                    
                    // Ajouter les cours locaux
                    localCourses.forEach(course => {
                        coursesMap.set(course.course_id, {
                            ...course,
                            isDownloaded: true,
                            isLocal: true
                        });
                    });
                    
                    // Fusionner avec les cours en ligne
                    onlineResult.courses.forEach(course => {
                        const courseId = course.id || course.course_id;
                        const existing = coursesMap.get(courseId);
                        
                        if (existing) {
                            coursesMap.set(courseId, {
                                ...existing,
                                ...course,
                                course_id: courseId,
                                isDownloaded: true,
                                isOnline: true
                            });
                        } else {
                            coursesMap.set(courseId, {
                                ...course,
                                course_id: courseId,
                                id: courseId,
                                isDownloaded: false,
                                isOnline: true
                            });
                        }
                    });
                    
                    allCourses = Array.from(coursesMap.values());
                } else {
                    // Si l'API échoue, utiliser seulement les cours locaux
                    allCourses = localCourses.map(course => ({
                        ...course,
                        isDownloaded: true
                    }));
                }
            } catch (error) {
                AppLogger.error('Erreur lors du chargement des cours en ligne:', error);
                // Fallback sur les cours locaux
                const localResult = await window.electronAPI.db.getAllCourses();
                if (localResult.success && localResult.result) {
                    allCourses = localResult.result.map(course => ({
                        ...course,
                        isDownloaded: true
                    }));
                }
            }
        }
        
        // Si on est sur la page dashboard, afficher les cours
        if (coursesContainer && !coursesListContainer) {
            displayCourses(allCourses);
            updateDashboardStats(allCourses);
        }
        
        // Mettre à jour le compteur dans la sidebar
        const coursesCount = document.getElementById('courses-count');
        if (coursesCount) {
            const downloadedCount = allCourses.filter(c => c.isDownloaded).length;
            coursesCount.textContent = downloadedCount;
        }
        
        AppLogger.log(`${allCourses.length} cours chargés avec succès`);
        
        return allCourses;
        
    } catch (error) {
        AppLogger.error('Erreur lors du chargement des cours:', error);
        
        // Afficher un message d'erreur seulement si on est sur le dashboard
        if (coursesContainer && !coursesListContainer) {
            coursesContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                    </svg>
                    <h3>Erreur de chargement</h3>
                    <p>${error.message || 'Impossible de charger les cours'}</p>
                    ${ConnectionState.isOnline ? 
                        '<button class="btn btn-primary" onclick="window.loadCourses()">Réessayer</button>' :
                        '<p class="text-secondary">Vous êtes en mode hors ligne</p>'
                    }
                </div>
            `;
        }
        
        throw error;
    }
}

// Fonction displayCourses corrigée
function displayCourses(courses) {
    AppLogger.log(`Affichage de ${courses.length} cours`);
    
    const coursesContainer = document.getElementById('courses-container');
    if (!coursesContainer) {
        AppLogger.error('Container courses-container non trouvé');
        return;
    }
    
    if (!courses || courses.length === 0) {
        coursesContainer.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <h3>Aucun cours disponible</h3>
                <p>Vous n'avez pas encore de cours. ${ConnectionState.isOnline ? 'Commencez par télécharger un cours depuis votre plateforme.' : 'Connectez-vous à Internet pour télécharger des cours.'}</p>
                ${ConnectionState.isOnline ? 
                    '<button class="btn btn-primary" onclick="showDownloadModal()">Télécharger un cours</button>' :
                    ''
                }
            </div>
        `;
        return;
    }
    
    // Créer les cartes de cours
    const coursesHTML = courses.map(course => createCourseCard(course)).join('');
    coursesContainer.innerHTML = `
        <div class="courses-grid">
            ${coursesHTML}
        </div>
    `;
    
    // Ajouter les event listeners
    attachCourseEventListeners();
}

// Fonction createCourseCard mise à jour
function createCourseCard(course) {
    const progress = course.progress || 0;
    const thumbnail = course.thumbnail || 'assets/default-course.jpg';
    const isDownloaded = course.isDownloaded || course.is_downloaded || false;
    const canPlayOffline = isDownloaded || !ConnectionState.isOnline;
    
    return `
        <div class="course-card card ${!canPlayOffline ? 'online-only' : ''}" data-course-id="${course.id || course.course_id}">
            <div class="course-thumbnail">
                <img src="${thumbnail}" alt="${course.title}" onerror="this.src='assets/default-course.jpg'">
                ${progress > 0 ? `
                <div class="course-progress-overlay">
                    <div class="progress-circle">
                        <span>${progress}%</span>
                    </div>
                </div>
                ` : ''}
                ${isDownloaded ? '<span class="downloaded-badge" title="Téléchargé">💾</span>' : ''}
            </div>
            <div class="card-body">
                <h3 class="course-title">${course.title}</h3>
                <p class="course-instructor">${course.instructor_name || 'Instructeur'}</p>
                <div class="course-meta">
                    <span>${course.lessons_count || 0} leçons</span>
                    <span>•</span>
                    <span>${course.duration || 'Durée inconnue'}</span>
                    ${!ConnectionState.isOnline && !isDownloaded ? '<span>• 🔒 En ligne uniquement</span>' : ''}
                </div>
                <div class="course-actions">
                    <button class="btn btn-primary btn-sm play-course-btn" 
                            data-course-id="${course.id || course.course_id}"
                            ${!canPlayOffline ? 'disabled title="Cours disponible uniquement en ligne"' : ''}>
                        ${progress > 0 ? 'Continuer' : 'Commencer'}
                    </button>
                    ${course.completed ? `
                    <button class="btn btn-secondary btn-sm" disabled>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                        </svg>
                        Terminé
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

// Fonction pour attacher les event listeners
function attachCourseEventListeners() {
    document.querySelectorAll('.play-course-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const courseId = btn.dataset.courseId;
            AppLogger.log('Ouverture du cours:', courseId);
            if (window.openCoursePlayer) {
                window.openCoursePlayer(courseId);
            }
        });
    });
    
    document.querySelectorAll('.course-card').forEach(card => {
        card.addEventListener('click', () => {
            const courseId = card.dataset.courseId;
            const isOnlineOnly = card.classList.contains('online-only');
            
            if (isOnlineOnly && !ConnectionState.isOnline) {
                showWarning('Ce cours nécessite une connexion Internet');
                return;
            }
            
            AppLogger.log('Clic sur la carte du cours:', courseId);
            if (window.openCoursePlayer) {
                window.openCoursePlayer(courseId);
            }
        });
    });
}

// Fonction updateDashboardStats corrigée
function updateDashboardStats(courses) {
    AppLogger.log('Mise à jour des statistiques');
    
    const stats = {
        total: courses.length,
        completed: courses.filter(c => c.completed).length,
        averageProgress: courses.length > 0 
            ? Math.round(courses.reduce((acc, c) => acc + (c.progress || 0), 0) / courses.length)
            : 0
    };
    
    // Mettre à jour l'interface
    const statCourses = document.getElementById('stat-courses');
    const statCompleted = document.getElementById('stat-completed');
    const statProgress = document.getElementById('stat-progress');
    
    if (statCourses) statCourses.textContent = stats.total;
    if (statCompleted) statCompleted.textContent = stats.completed;
    if (statProgress) statProgress.textContent = `${stats.averageProgress}%`;
    
    AppLogger.log('Statistiques mises à jour:', stats);
}

// Mettre à jour le badge du compteur avec animation
async function updateCoursesCount() {
    try {
        const localResult = await window.electronAPI.db.getAllCourses();
        if (localResult.success && localResult.result) {
            const downloadedCount = localResult.result.length;
            const coursesCount = document.getElementById('courses-count');
            if (coursesCount) {
                // Animer le changement si le nombre a changé
                const currentCount = parseInt(coursesCount.textContent) || 0;
                if (currentCount !== downloadedCount) {
                    coursesCount.classList.add('badge-pulse');
                    coursesCount.textContent = downloadedCount;
                    
                    // Retirer l'animation après 1 seconde
                    setTimeout(() => {
                        coursesCount.classList.remove('badge-pulse');
                    }, 1000);
                }
            }
        }
    } catch (error) {
       console.error('Erreur mise à jour compteur:', error);
   }
}

// ==================== MISE À JOUR DES STATISTIQUES ====================

async function updateStats() {
   logger.info('Mise à jour des statistiques...');
   
   try {
       const stats = await window.electronAPI.db.getStats();
       if (stats.success && stats.result) {
           const data = stats.result;
           
           // Mettre à jour les éléments du DOM
           const statCourses = document.getElementById('stat-courses');
           const statCompleted = document.getElementById('stat-completed');
           const statProgress = document.getElementById('stat-progress');
           
           if (statCourses) statCourses.textContent = data.totalCourses || 0;
           if (statCompleted) statCompleted.textContent = data.completedCourses || 0;
           if (statProgress) statProgress.textContent = `${Math.round(data.averageProgress || 0)}%`;
       }
   } catch (error) {
       logger.error('Erreur lors de la mise à jour des stats:', error);
   }
}

// ==================== MISE À JOUR DU STOCKAGE ====================

async function updateStorageInfo() {
   logger.info('Mise à jour des informations de stockage...');
   
   try {
       // Obtenir l'espace utilisé (simulé pour l'instant)
       const usedSpace = await calculateUsedSpace();
       const totalSpace = 5 * 1024 * 1024 * 1024; // 5 GB
       const percentage = Math.round((usedSpace / totalSpace) * 100);
       
       // Mettre à jour la barre de progression
       const storageBar = document.getElementById('storage-bar');
       if (storageBar) {
           storageBar.style.width = `${percentage}%`;
       }
       
       // Mettre à jour le texte
       const storageText = document.getElementById('storage-text');
       if (storageText) {
           storageText.textContent = `${formatBytes(usedSpace)} / ${formatBytes(totalSpace)}`;
       }
       
   } catch (error) {
       logger.error('Erreur lors de la mise à jour du stockage:', error);
   }
}

async function calculateUsedSpace() {
   // TODO: Implémenter le calcul réel de l'espace utilisé
   // Pour l'instant, retourner une valeur simulée
   return 1.2 * 1024 * 1024 * 1024; // 1.2 GB
}

function formatBytes(bytes) {
   if (bytes === 0) return '0 B';
   const k = 1024;
   const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
   const i = Math.floor(Math.log(bytes) / Math.log(k));
   return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== PAGES SPÉCIFIQUES ====================

// Définir loadCoursesPage comme fonction globale
window.loadCoursesPage = async function() {
   logger.info('Chargement de la page des cours');
   const container = document.getElementById('courses-list');
   if (!container) {
       logger.error('Container courses-list non trouvé');
       return;
   }
   
   // Afficher le loader
   container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement...</p></div>';
   
   try {
       // Charger les cours
       const courses = await loadCourses();
       
       // Si loadCourses retourne les cours, les afficher
       if (courses && courses.length > 0) {
           // Utiliser la fonction displayCourses de courses.js si disponible
           if (window.coursesManager && window.coursesManager.displayCourses) {
               await window.coursesManager.displayCourses(courses, container);
           } else {
               // Affichage basique
               const coursesHTML = courses.map(course => {
                   const isDownloaded = course.isDownloaded || course.is_downloaded;
                   return `
                       <div class="course-card card" data-course-id="${course.id || course.course_id}">
                           <div class="course-info">
                               <h3>${escapeHtml(course.title)}</h3>
                               <p>${escapeHtml(course.instructor_name || 'Instructeur')}</p>
                               <div class="course-actions">
                                   ${isDownloaded ? 
                                       `<button class="btn btn-primary" onclick="openCourse(${course.course_id || course.id})">Ouvrir</button>` :
                                       `<button class="btn btn-primary" onclick="downloadSingleCourse(${course.id})">Télécharger</button>`
                                   }
                               </div>
                           </div>
                       </div>
                   `;
               }).join('');
               
               container.innerHTML = `<div class="courses-grid">${coursesHTML}</div>`;
           }
       } else {
           container.innerHTML = `
               <div class="empty-state">
                   <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                       <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                   </svg>
                   <h3>Aucun cours disponible</h3>
                   <p>Commencez par télécharger un cours depuis votre plateforme.</p>
                   ${ConnectionState.isOnline ? 
                       '<button class="btn btn-primary" onclick="showDownloadModal()">Télécharger un cours</button>' :
                       '<p class="text-secondary">Connectez-vous à Internet pour télécharger des cours</p>'
                   }
               </div>
           `;
       }
   } catch (error) {
       logger.error('Erreur lors du chargement de la page des cours:', error);
       container.innerHTML = `
           <div class="message message-error">
               <p>Erreur lors du chargement des cours: ${error.message}</p>
               <button class="btn btn-sm" onclick="window.loadCoursesPage()">Réessayer</button>
           </div>
       `;
   }
};

// Télécharger un cours individuel
window.downloadSingleCourse = async function(courseId) {
   logger.info('Téléchargement d\'un cours:', courseId);
   
   if (!ConnectionState.isOnline) {
       showWarning('Une connexion Internet est requise pour télécharger des cours');
       return;
   }
   
   try {
       showLoader('Préparation du téléchargement...');
       
       const result = await window.electronAPI.download.downloadCourse({
           courseId: courseId,
           options: {
               includeVideos: true,
               includeDocuments: true,
               compress: false
           }
       });
       
       hideLoader();
       
       if (result.success) {
           showInfo('Téléchargement démarré - Consultez la page Téléchargements pour suivre la progression');
           
           // Naviguer vers la page des téléchargements
           if (window.navigateTo) {
               window.navigateTo('downloads');
           }
       } else {
           showError(result.error || 'Erreur lors du démarrage du téléchargement');
       }
       
   } catch (error) {
       hideLoader();
       logger.error('Erreur téléchargement:', error);
       showError('Impossible de démarrer le téléchargement');
   }
};

// Charger la page des téléchargements
async function loadDownloadsPage() {
   logger.info('Chargement de la page des téléchargements');
   const container = document.getElementById('downloads-list');
   if (!container) return;
   
   container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement des téléchargements...</p></div>';
   
   try {
       // Récupérer tous les téléchargements
       const downloadsResponse = await window.electronAPI.download.getAllDownloads();
       logger.debug('Réponse getAllDownloads:', downloadsResponse);
       
       if (downloadsResponse.success && downloadsResponse.downloads && downloadsResponse.downloads.length > 0) {
           displayDownloadsDetailed(downloadsResponse.downloads, container);
       } else {
           container.innerHTML = `
               <div class="empty-state">
                   <svg width="64" height="64" viewBox="0 0 24 24" fill="var(--text-secondary)">
                       <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                   </svg>
                   <h3>Aucun téléchargement</h3>
                   <p>Aucun téléchargement en cours ou terminé</p>
                   ${ConnectionState.isOnline ? 
                       '<button class="btn btn-primary" onclick="showDownloadModal()">Télécharger un cours</button>' :
                       '<p class="text-secondary">Connectez-vous à Internet pour télécharger des cours</p>'
                   }
               </div>
           `;
       }
   } catch (error) {
       logger.error('Erreur lors du chargement des téléchargements:', error);
       container.innerHTML = `
           <div class="message message-error">
               <p>Erreur lors du chargement des téléchargements</p>
               <button class="btn btn-primary" onclick="loadDownloadsPage()">Réessayer</button>
           </div>
       `;
   }
}

// Nouvelle fonction pour afficher les téléchargements avec détails
function displayDownloadsDetailed(downloads, container) {
   logger.debug(`Affichage de ${downloads.length} téléchargements`);
   
   // Séparer les téléchargements actifs et terminés
   const activeDownloads = downloads.filter(d => 
       d.status === 'downloading' || 
       d.status === 'pending' || 
       d.status === 'preparing' ||
       d.status === 'paused'
   );
   
   const completedDownloads = downloads.filter(d => 
       d.status === 'completed' || 
       d.status === 'error' || 
       d.status === 'cancelled'
   );
   
   let html = '<div class="downloads-content">';
   
   // Téléchargements actifs
   if (activeDownloads.length > 0) {
       html += `
           <div class="downloads-section">
               <h3>Téléchargements en cours (${activeDownloads.length})</h3>
               <div class="downloads-list">
       `;
       
       activeDownloads.forEach(download => {
           html += createDownloadItemHTML(download);
       });
       
       html += '</div></div>';
   }
   
   // Téléchargements terminés
   if (completedDownloads.length > 0) {
       html += `
           <div class="downloads-section">
               <h3>Historique des téléchargements (${completedDownloads.length})</h3>
               <div class="downloads-list">
       `;
       
       completedDownloads.forEach(download => {
           html += createDownloadItemHTML(download);
       });
       
       html += '</div></div>';
   }
   
   html += '</div>';
   container.innerHTML = html;
   
   // Attacher les event listeners
   attachDownloadEventListeners();
}

function createDownloadItemHTML(download) {
   const statusIcon = {
       pending: '⏳',
       preparing: '🔄',
       downloading: '⬇️',
       paused: '⏸️',
       completed: '✅',
       error: '❌',
       cancelled: '🚫'
   }[download.status] || '❓';
   
   const statusText = {
       pending: 'En attente',
       preparing: 'Préparation',
       downloading: 'Téléchargement',
       paused: 'En pause',
       completed: 'Terminé',
       error: 'Erreur',
       cancelled: 'Annulé'
   }[download.status] || download.status;
   
   const isActive = ['downloading', 'pending', 'preparing', 'paused'].includes(download.status);
   
   let html = `
       <div class="download-item ${download.status}" data-download-id="${download.id}">
           <div class="download-header">
               <span class="download-icon">${statusIcon}</span>
               <div class="download-info">
                   <h4>${escapeHtml(download.courseName || download.title || 'Cours inconnu')}</h4>
                   <div class="download-meta">
                       <span class="download-status">${statusText}</span>
   `;
   
   // Afficher les informations selon le statut
   if (download.status === 'downloading' && download.progress) {
       const speed = download.speed || '0 MB/s';
       const eta = download.eta || 'Calcul...';
       html += `
           <span class="download-speed">• ${speed}</span>
           <span class="download-eta">• ${eta}</span>
       `;
   }
   
   if (download.currentFile) {
       html += `<span class="download-current-file">• ${escapeHtml(download.currentFile)}</span>`;
   }
   
   if (download.error) {
       html += `<span class="download-error">• ${escapeHtml(download.error)}</span>`;
   }
   
   html += `
                   </div>
               </div>
               <div class="download-actions">
   `;
   
   // Actions selon le statut
   if (download.status === 'downloading') {
       html += `
           <button class="btn btn-sm btn-secondary" onclick="pauseDownload('${download.id}')" title="Mettre en pause">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
               </svg>
           </button>
       `;
   } else if (download.status === 'paused') {
       html += `
           <button class="btn btn-sm btn-primary" onclick="resumeDownload('${download.id}')" title="Reprendre">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M8 5v14l11-7z"/>
               </svg>
           </button>
       `;
   }
   
   if (isActive) {
       html += `
           <button class="btn btn-sm btn-danger" onclick="cancelDownload('${download.id}')" title="Annuler">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
               </svg>
           </button>
       `;
   } else if (download.status === 'error') {
       html += `
           <button class="btn btn-sm btn-primary" onclick="retryDownload('${download.id}')">
               Réessayer
           </button>
       `;
   } else if (download.status === 'completed') {
       html += `
           <button class="btn btn-sm btn-secondary" onclick="removeFromHistory('${download.id}')" title="Retirer de l'historique">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
               </svg>
           </button>
       `;
   }
   
   html += `
               </div>
           </div>
   `;
   
   // Barre de progression pour les téléchargements actifs
   if ((download.status === 'downloading' || download.status === 'preparing') && download.progress !== undefined) {
       html += `
           <div class="download-progress">
               <div class="progress-bar">
                   <div class="progress-fill" style="width: ${download.progress}%"></div>
               </div>
               <span class="progress-text">${Math.round(download.progress)}%</span>
           </div>
       `;
   }
   
   // Détails des fichiers si disponibles
   if (download.files && download.files.length > 0) {
       const completedFiles = download.files.filter(f => f.status === 'completed').length;
       const totalFiles = download.files.length;
       
       html += `
           <div class="download-files-summary">
               <span>${completedFiles} / ${totalFiles} fichiers téléchargés</span>
           </div>
       `;
   }
   
   html += '</div>';
   
   return html;
}

function attachDownloadEventListeners() {
   // Les event listeners sont déjà attachés via onclick
   // Cette fonction peut être utilisée pour ajouter des listeners supplémentaires si nécessaire
}

// Ajouter les fonctions manquantes
window.pauseDownload = async function(downloadId) {
   try {
       const result = await window.electronAPI.download.pauseDownload(downloadId);
       if (result.success) {
           showInfo('Téléchargement mis en pause');
           loadDownloadsPage();
       }
   } catch (error) {
       logger.error('Erreur lors de la pause:', error);
       showError('Impossible de mettre en pause le téléchargement');
   }
};

window.resumeDownload = async function(downloadId) {
   if (!ConnectionState.isOnline) {
       showWarning('Connexion Internet requise pour reprendre le téléchargement');
       return;
   }
   
   try {
       const result = await window.electronAPI.download.resumeDownload(downloadId);
       if (result.success) {
           showInfo('Téléchargement repris');
           loadDownloadsPage();
       }
   } catch (error) {
       logger.error('Erreur lors de la reprise:', error);
       showError('Impossible de reprendre le téléchargement');
   }
};

window.cancelDownload = async function(downloadId) {
   if (confirm('Êtes-vous sûr de vouloir annuler ce téléchargement ?')) {
       try {
           await window.electronAPI.download.cancelDownload(downloadId);
           showInfo('Téléchargement annulé');
           loadDownloadsPage();
       } catch (error) {
           logger.error('Erreur lors de l\'annulation:', error);
           showError('Impossible d\'annuler le téléchargement');
       }
   }
};

window.retryDownload = async function(downloadId) {
   if (!ConnectionState.isOnline) {
       showWarning('Connexion Internet requise pour relancer le téléchargement');
       return;
   }
   
   try {
       const result = await window.electronAPI.download.retryDownload(downloadId);
       if (result.success) {
           showInfo('Téléchargement relancé');
           loadDownloadsPage();
       }
   } catch (error) {
       logger.error('Erreur lors de la relance:', error);
       showError('Impossible de relancer le téléchargement');
   }
};

window.removeFromHistory = async function(downloadId) {
   try {
       const result = await window.electronAPI.download.removeFromHistory(downloadId);
       if (result.success) {
           loadDownloadsPage();
       }
   } catch (error) {
       logger.error('Erreur lors de la suppression:', error);
   }
};

// ==================== MISE À JOUR AUTOMATIQUE DU DASHBOARD ====================

function startDashboardAutoUpdate() {
   // Arrêter l'ancien interval s'il existe
   stopDashboardAutoUpdate();
   
   // Mettre à jour toutes les 5 secondes si on est sur le dashboard
   dashboardUpdateInterval = setInterval(() => {
       const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
       if (currentPage === 'dashboard') {
           updateCoursesCount();
       }
   }, 5000);
}

function stopDashboardAutoUpdate() {
   if (dashboardUpdateInterval) {
       clearInterval(dashboardUpdateInterval);
       dashboardUpdateInterval = null;
   }
}

// Observer les changements de page
const pageObserver = new MutationObserver(() => {
   const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
   if (currentPage === 'dashboard') {
       startDashboardAutoUpdate();
   } else {
       stopDashboardAutoUpdate();
   }
});

// Démarrer l'observation après l'initialisation
window.addEventListener('DOMContentLoaded', () => {
   pageObserver.observe(document.body, {
       attributes: true,
       attributeFilter: ['class'],
       subtree: true
   });
});

// ==================== UTILITAIRES ====================

function escapeHtml(text) {
   if (!text) return '';
   const div = document.createElement('div');
   div.textContent = text;
   return div.innerHTML;
}

function debounce(func, wait) {
   let timeout;
   return function executedFunction(...args) {
       const later = () => {
           clearTimeout(timeout);
           func(...args);
       };
       clearTimeout(timeout);
       timeout = setTimeout(later, wait);
   };
}

// ==================== NETTOYAGE ====================

window.addEventListener('beforeunload', () => {
   // Arrêter les mises à jour automatiques
   stopDashboardAutoUpdate();
   
   // Arrêter la vérification de connexion
   if (ConnectionState.checkInterval) {
       clearInterval(ConnectionState.checkInterval);
   }
   
   // Arrêter l'observation
   if (pageObserver) {
       pageObserver.disconnect();
   }
});

// Export des fonctions globales
window.showContentPage = showContentPage;
window.escapeHtml = escapeHtml;