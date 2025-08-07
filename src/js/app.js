
// Rendre les fonctions disponibles globalement dès le début
window.loadCoursesPage = null;
window.loadDownloadsPage = null;
window.loadProgressPage = null;
window.loadPageContent = null;

// app.js - Application principale avec gestion offline améliorée et synchronisation

// ==================== CONFIGURATION LOGGING ====================
const logger = {
    info: (message, data) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data || '');
    },
    error: (message, error) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error || '');
    },
    warn: (message, data) => {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data || '');
    },
    debug: (message, data) => {
        console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, data || '');
    }
};

// AppLogger pour compatibilité
const AppLogger = {
    log: (message, data = null) => {
        logger.info(message, data);
    },
    error: (message, error = null) => {
        logger.error(message, error);
    },
    warn: (message, data = null) => {
        logger.warn(message, data);
    }
};

// Si Logger n'existe pas encore, utiliser le logger créé
if (!window.Logger) {
    window.Logger = logger;
}

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
let courseLoadingInProgress = false;
let dashboardUpdateInterval = null;

// ==================== CLASSE ENHANCED OFFLINE MODE ====================
class EnhancedOfflineMode {
    constructor() {
        this.isOffline = !navigator.onLine;
        this.offlineStartTime = null;
        this.queueUpdateInterval = null;
        this.setupEventListeners();
        
        // Vérifier l'état initial
        if (this.isOffline) {
            this.enter();
        }
    }
    
    setupEventListeners() {
        // Intercepter les actions qui nécessitent une sync
        document.addEventListener('lesson-completed', this.handleLessonCompleted.bind(this));
        document.addEventListener('quiz-submitted', this.handleQuizSubmitted.bind(this));
        document.addEventListener('progress-updated', this.handleProgressUpdated.bind(this));
        document.addEventListener('note-saved', this.handleNoteSaved.bind(this));
        
        // Écouter les changements de connexion
        window.addEventListener('online', () => this.exit());
        window.addEventListener('offline', () => this.enter());
    }
    
    async handleLessonCompleted(event) {
        const { lessonId, courseId, progress } = event.detail;
        logger.info('Leçon complétée en mode offline:', { lessonId, progress });
        
        // Sauvegarder localement
        await window.electronAPI.db.updateLessonProgress(lessonId, progress, true);
        
        // Ajouter à la queue de sync
        if (this.isOffline || !navigator.onLine) {
            await window.syncQueue.add({
                type: 'lesson_progress',
                data: { 
                    lessonId, 
                    courseId, 
                    progress, 
                    completed: true,
                    completedAt: new Date().toISOString()
                }
            });
            
            showInfo('✅ Progression sauvegardée localement');
            this.updateQueueCount();
        } else {
            // Sync immédiate si en ligne
            try {
                await window.electronAPI.api.syncProgress({
                    lessons: [{
                        id: lessonId,
                        action: 'update',
                        data: { progress, completed: true },
                        timestamp: new Date().toISOString()
                    }]
                });
                showSuccess('✅ Progression synchronisée');
            } catch (error) {
                logger.error('Erreur sync immédiate:', error);
                // Fallback sur la queue
                await window.syncQueue.add({
                    type: 'lesson_progress',
                    data: { lessonId, courseId, progress, completed: true }
                });
            }
        }
    }
    
    async handleQuizSubmitted(event) {
        const { quizId, courseId, answers, score } = event.detail;
        
        if (this.isOffline || !navigator.onLine) {
            await window.syncQueue.add({
                type: 'quiz_attempt',
                data: {
                    quizId,
                    courseId,
                    answers,
                    score,
                    completedAt: new Date().toISOString()
                }
            });
            
            showInfo('📝 Résultat du quiz sauvegardé localement');
            this.updateQueueCount();
        }
    }
    
    async handleProgressUpdated(event) {
        const { lessonId, progress, lastPosition } = event.detail;
        
        // Debounce les mises à jour de progression
        if (this._progressTimeout) {
            clearTimeout(this._progressTimeout);
        }
        
        this._progressTimeout = setTimeout(async () => {
            if (this.isOffline || !navigator.onLine) {
                await window.syncQueue.add({
                    type: 'lesson_progress',
                    data: {
                        lessonId,
                        progress,
                        lastPosition,
                        updatedAt: new Date().toISOString()
                    }
                });
                this.updateQueueCount();
            }
        }, 2000); // Attendre 2 secondes avant de sauvegarder
    }
    
    async handleNoteSaved(event) {
        const { lessonId, content } = event.detail;
        
        if (this.isOffline || !navigator.onLine) {
            await window.syncQueue.add({
                type: 'note_update',
                data: {
                    lessonId,
                    content,
                    updatedAt: new Date().toISOString()
                }
            });
            
            showInfo('📝 Note sauvegardée localement');
            this.updateQueueCount();
        }
    }
    
    enter() {
        if (this.isOffline) return; // Déjà en mode offline
        
        logger.warn('📴 Entrée en mode hors ligne');
        this.isOffline = true;
        this.offlineStartTime = Date.now();
        
        // Adaptations UI
        document.body.classList.add('offline-mode');
        this.showOfflineBanner();
        
        // Désactiver les fonctionnalités online
        this.disableOnlineFeatures();
        
        // Démarrer la mise à jour du compteur
        this.startQueueUpdateInterval();
        
        // Notifier l'utilisateur
        showWarning('Mode hors ligne activé - Les modifications seront synchronisées plus tard');
    }
    
    exit() {
        if (!this.isOffline) return; // Déjà en ligne
        
        logger.info('🌐 Sortie du mode hors ligne');
        this.isOffline = false;
        const duration = Date.now() - this.offlineStartTime;
        
        // Restaurer l'UI
        document.body.classList.remove('offline-mode');
        this.hideOfflineBanner();
        this.enableOnlineFeatures();
        
        // Arrêter la mise à jour du compteur
        this.stopQueueUpdateInterval();
        
        // Traiter la queue de synchronisation
        if (window.syncQueue && window.syncQueue.getQueueSize() > 0) {
            showInfo(`Synchronisation de ${window.syncQueue.getQueueSize()} modification(s) en attente...`);
            setTimeout(() => {
                window.syncQueue.process();
            }, 2000);
        }
        
        logger.info(`Durée hors ligne: ${Math.round(duration / 1000)}s`);
        showSuccess('Connexion rétablie');
    }
    
    showOfflineBanner() {
        if (document.getElementById('offline-banner')) return;
        
        const banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.innerHTML = `
            <div class="offline-banner-content">
                <span class="offline-icon">📴</span>
                <span class="offline-text">Mode hors ligne</span>
                <span class="offline-info">Les modifications sont sauvegardées localement</span>
                <span class="offline-queue-count" id="offline-queue-count"></span>
            </div>
        `;
        
        // Insérer après le header
        const header = document.querySelector('.app-header');
        if (header && header.nextSibling) {
            header.parentNode.insertBefore(banner, header.nextSibling);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
        
        setTimeout(() => banner.classList.add('show'), 10);
        
        // Mettre à jour le compteur initial
        this.updateQueueCount();
    }
    
    hideOfflineBanner() {
        const banner = document.getElementById('offline-banner');
        if (banner) {
            banner.classList.remove('show');
            setTimeout(() => banner.remove(), 300);
        }
    }
    
    async updateQueueCount() {
        const count = window.syncQueue ? window.syncQueue.getQueueSize() : 0;
        const countEl = document.getElementById('offline-queue-count');
        if (countEl) {
            if (count > 0) {
                countEl.textContent = `(${count} en attente)`;
                countEl.style.display = 'inline';
            } else {
                countEl.style.display = 'none';
            }
        }
    }
    
    startQueueUpdateInterval() {
        this.stopQueueUpdateInterval();
        this.queueUpdateInterval = setInterval(() => {
            this.updateQueueCount();
        }, 5000); // Toutes les 5 secondes
    }
    
    stopQueueUpdateInterval() {
        if (this.queueUpdateInterval) {
            clearInterval(this.queueUpdateInterval);
            this.queueUpdateInterval = null;
        }
    }
    
    disableOnlineFeatures() {
        // Désactiver les boutons qui nécessitent une connexion
        document.querySelectorAll('.online-only').forEach(el => {
            el.disabled = true;
            el.setAttribute('data-offline-title', el.title || '');
            el.title = 'Fonctionnalité disponible uniquement en ligne';
        });
        
        // Ajouter un indicateur visuel aux cours non téléchargés
        document.querySelectorAll('.course-card:not(.downloaded)').forEach(card => {
            card.classList.add('offline-disabled');
        });
    }
    
    enableOnlineFeatures() {
        // Réactiver les boutons
        document.querySelectorAll('.online-only').forEach(el => {
            el.disabled = false;
            const originalTitle = el.getAttribute('data-offline-title');
            if (originalTitle) {
                el.title = originalTitle;
                el.removeAttribute('data-offline-title');
            }
        });
        
        // Retirer les indicateurs visuels
        document.querySelectorAll('.offline-disabled').forEach(card => {
            card.classList.remove('offline-disabled');
        });
    }
}

// Instance globale du mode offline
let offlineMode = null;

// ==================== DÉTECTION DE CONNEXION ====================
window.ConnectionState = {
    isOnline: navigator.onLine,
    lastCheck: Date.now(),
    checkInterval: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
};

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
            const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
            if (currentPage === 'dashboard' || currentPage === 'courses') {
                loadPageContent(currentPage);
            }
        });

        // Attendre que l'AuthManager soit prêt
        logger.debug('Attente de l\'AuthManager...');
        await waitForAuthManager();
        logger.info('AuthManager prêt');

        // Initialiser le mode offline amélioré
        offlineMode = new EnhancedOfflineMode();
        logger.info('Mode offline amélioré initialisé');

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
        
        // Initialiser le sync manager
        await initializeSyncManager();

        // Démarrer la mise à jour automatique du dashboard
        startDashboardAutoUpdate();

        AppState.isInitialized = true;
        logger.info('=== APPLICATION INITIALISÉE AVEC SUCCÈS ===');

        // Envoyer un ping au main process
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

async function handleOnline() {
    logger.info('🌐 Connexion Internet rétablie');
    ConnectionState.isOnline = true;
    ConnectionState.reconnectAttempts = 0;
    AppState.isOnline = true;
    
    // Le mode offline gère déjà la transition
    updateConnectionUI(true);
    
    // Notifier les modules
    if (window.downloadManager) {
        window.downloadManager.setOnlineStatus(true);
    }
}

function handleOffline() {
    logger.warn('📴 Connexion Internet perdue');
    ConnectionState.isOnline = false;
    AppState.isOnline = false;
    
    // Le mode offline gère déjà la transition
    updateConnectionUI(false);
    
    // Notifier les modules
    if (window.downloadManager) {
        window.downloadManager.setOnlineStatus(false);
    }
}

async function checkConnectionStatus() {
    const wasOnline = ConnectionState.isOnline;
    
    try {
        if (!navigator.onLine) {
            ConnectionState.isOnline = false;
            if (wasOnline) handleOffline();
            return;
        }
        
        // Ping un serveur fiable
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        try {
            const response = await fetch('https://www.google.com/favicon.ico', {
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
    
    // Le mode offline gère maintenant les boutons
}

// ==================== SYNC MANAGER ====================
async function initializeSyncManager() {
    logger.info('Initialisation du gestionnaire de synchronisation...');
    
    if (!window.syncManager) {
        logger.error('syncManager non disponible !');
        return;
    }
    
    try {
        await window.syncManager.initializeSync();
        logger.info('Sync manager initialisé avec succès');
        
        // Vérifier s'il y a des éléments non synchronisés
        const status = window.syncManager.getSyncStatus();
        if (status.queueSize > 0) {
            logger.info(`${status.queueSize} éléments non synchronisés détectés`);
            // L'indicateur sera mis à jour automatiquement par la queue
        }
        
    } catch (error) {
        logger.error('Erreur lors de l\'initialisation du sync manager:', error);
    }
}

// ==================== FONCTIONS UTILITAIRES ====================
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

async function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// ==================== GESTIONNAIRES D'ÉVÉNEMENTS ====================
function initializeEventHandlers() {
    logger.info('Initialisation des gestionnaires d\'événements...');
    
    // Navigation sidebar
    const navItems = document.querySelectorAll('.nav-item');
    logger.debug(`${navItems.length} éléments de navigation trouvés`);
    
    navItems.forEach((item) => {
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        newItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const page = newItem.dataset.page;
            logger.debug(`Navigation clicked: ${page}`);
            
            if (!page) {
                logger.error('Pas de data-page sur l\'élément cliqué');
                return;
            }
            
            const targetContent = document.getElementById(`${page}-content`);
            if (!targetContent) {
                logger.error(`Élément de contenu non trouvé: ${page}-content`);
                return;
            }
            
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            newItem.classList.add('active');
            
            showContentPage(page);
            
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
    
    // Écouter les événements système
    setupSystemEventListeners();
    
    logger.info('Tous les gestionnaires d\'événements sont configurés');
}

// ==================== NAVIGATION ====================
function showContentPage(pageId) {
    logger.info(`Affichage de la page: ${pageId}`);
    
    logger.debug('État avant changement:', {
        pageId: pageId,
        targetExists: !!document.getElementById(`${pageId}-content`),
        allPages: Array.from(document.querySelectorAll('.content-page')).map(p => p.id)
    });
    
    // Masquer toutes les pages de contenu
    document.querySelectorAll('.content-page').forEach(page => {
        page.classList.add('hidden');
        page.style.display = 'none';
    });
    
    // Afficher la page demandée
    const targetPage = document.getElementById(`${pageId}-content`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.style.display = 'block';
        
        // Mettre à jour le titre
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

// Charger le contenu d'une page
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

// ==================== CONFIGURATION DES BOUTONS HEADER ====================
function setupHeaderButtons() {
    logger.debug('Configuration des boutons du header');
    
    // Menu toggle (mobile)
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        const newMenuToggle = menuToggle.cloneNode(true);
        menuToggle.parentNode.replaceChild(newMenuToggle, menuToggle);
        
        newMenuToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('active');
                document.body.classList.toggle('sidebar-open');
            }
        });
    }
    
    // Search button
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        const newSearchBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newSearchBtn, searchBtn);
        
        newSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const searchBar = document.getElementById('search-bar');
            if (searchBar) {
                searchBar.classList.toggle('hidden');
                if (!searchBar.classList.contains('hidden')) {
                    const searchInput = document.getElementById('search-input');
                    if (searchInput) {
                        searchInput.focus();
                        searchInput.select();
                    }
                }
            }
        });
    }
    
    // SYNC BUTTON - CORRECTION IMPORTANTE
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        // IMPORTANT: Cloner pour retirer les anciens listeners
        const newSyncBtn = syncBtn.cloneNode(true);
        syncBtn.parentNode.replaceChild(newSyncBtn, syncBtn);
        
        newSyncBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('[Sync Button] Clic détecté');
            
            // Vérifier la connexion
            if (!navigator.onLine) {
                showWarning('Synchronisation impossible en mode hors ligne');
                return;
            }
            
            // Vérifier que syncManager existe
            if (!window.syncManager) {
                console.error('[Sync Button] syncManager non disponible');
                showError('Module de synchronisation non chargé');
                return;
            }
            
            // Désactiver le bouton pendant la sync
            newSyncBtn.disabled = true;
            newSyncBtn.classList.add('syncing');
            
            // Ajouter l'icône de chargement
            const originalHTML = newSyncBtn.innerHTML;
            newSyncBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="spinning">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                </svg>
            `;
            
            try {
                // S'assurer que syncManager est initialisé
                if (!window.syncManager.initialized) {
                    console.log('[Sync Button] Initialisation de syncManager...');
                    await window.syncManager.initializeSync();
                }
                
                // Lancer la synchronisation
                console.log('[Sync Button] Démarrage de la synchronisation...');
                const result = await window.syncManager.performFullSync();
                console.log('[Sync Button] Résultat:', result);
                
                if (result.success) {
                    // Rafraîchir le dashboard si nécessaire
                    if (window.refreshDashboard) {
                        await window.refreshDashboard();
                    }
                }
            } catch (error) {
                console.error('[Sync Button] Erreur:', error);
                showError('Erreur lors de la synchronisation');
            } finally {
                // Restaurer le bouton
                newSyncBtn.disabled = false;
                newSyncBtn.classList.remove('syncing');
                newSyncBtn.innerHTML = originalHTML;
            }
        });
        
        console.log('[Sync Button] Event listener attaché avec succès');
    } else {
        logger.error('Bouton sync-btn non trouvé dans le DOM');
    }
    
    // Settings button
    const settingsBtn = document.getElementById('settings-btn-dashboard');
    if (settingsBtn) {
        const newSettingsBtn = settingsBtn.cloneNode(true);
        settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
        
        newSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showSettingsModal();
        });
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        
        newLogoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            logger.info('Demande de déconnexion');
            
            // Vérifier s'il y a des modifications non synchronisées
            let unsyncedCount = 0;
            if (window.syncQueue) {
                unsyncedCount = window.syncQueue.getQueueSize();
            }
            
            if (!ConnectionState.isOnline && unsyncedCount > 0) {
                const confirmLogout = await showConfirmDialog(
                    'Modifications non synchronisées',
                    `Attention ! Vous avez ${unsyncedCount} modifications non synchronisées.\n` +
                    'Si vous vous déconnectez maintenant, ces modifications seront perdues.\n\n' +
                    'Voulez-vous vraiment vous déconnecter ?',
                    'Se déconnecter quand même',
                    'Annuler'
                );
                
                if (!confirmLogout) {
                    return;
                }
            } else {
                const confirmLogout = await showConfirmDialog(
                    'Déconnexion',
                    'Êtes-vous sûr de vouloir vous déconnecter ?',
                    'Se déconnecter',
                    'Annuler'
                );
                
                if (!confirmLogout) {
                    return;
                }
            }
            
            logger.info('Déconnexion confirmée');
            
            // Arrêter la synchronisation automatique
            if (window.syncManager && window.syncManager.stopAutoSync) {
                window.syncManager.stopAutoSync();
            }
            
            // Effectuer la déconnexion
            if (window.AuthManager && window.AuthManager.performLogout) {
                showLoader('Déconnexion en cours...');
                try {
                    await window.AuthManager.performLogout();
                    logger.info('Déconnexion réussie');
                } catch (error) {
                    logger.error('Erreur lors de la déconnexion:', error);
                    showError('Erreur lors de la déconnexion');
                } finally {
                    hideLoader();
                }
            }
        });
    }
    
    logger.info('Configuration des boutons du header terminée');
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
    logger.debug('Navigation vers la leçon précédente');
}

async function navigateToNextLesson() {
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
            const result = await window.electronAPI.api.completeLesson({
                lessonId: lessonId,
                courseId: AppState.currentCourse.course_id
            });
            
            if (result.success) {
                showSuccess('Leçon marquée comme terminée');
                await window.electronAPI.db.updateLessonProgress(lessonId, 100, true);
            }
        } else {
            await window.electronAPI.db.updateLessonProgress(lessonId, 100, true);
            
            if (offlineMode) {
                await offlineMode.handleLessonCompleted({
                    detail: {
                        lessonId: lessonId,
                        courseId: AppState.currentCourse.course_id,
                        progress: 100
                    }
                });
            }
            
            showInfo('Progression sauvegardée localement');
        }
        
        updateLessonUI(lessonId, true);
        
    } catch (error) {
        logger.error('Erreur lors de la complétion de la leçon:', error);
        showError('Impossible de marquer la leçon comme terminée');
    }
}

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

async function searchCourses(query) {
    if (!query) {
        // Afficher tous les cours
        await loadCourses();
        return;
    }
    
    try {
        const result = await window.electronAPI.db.searchCourses(query);
        if (result.success && result.result) {
            displayCourses(result.result);
        }
    } catch (error) {
        logger.error('Erreur recherche:', error);
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

async function showDownloadModal() {
    logger.info('Ouverture du modal de téléchargement');
    const modal = document.getElementById('download-modal');
    
    if (modal) {
        modal.classList.remove('hidden');
        
        const courseSelect = document.getElementById('course-select');
        if (courseSelect && window.electronAPI && window.electronAPI.api) {
            courseSelect.innerHTML = '<option value="">Chargement des cours...</option>';
            
            try {
                const result = await window.electronAPI.api.getUserCourses();
                if (result.success && result.courses) {
                    courseSelect.innerHTML = '<option value="">Sélectionnez un cours</option>';
                    result.courses.forEach(course => {
                        const option = document.createElement('option');
                        option.value = course.id;
                        option.textContent = course.title;
                        courseSelect.appendChild(option);
                    });
                }
            } catch (error) {
                logger.error('Erreur lors du chargement des cours:', error);
                courseSelect.innerHTML = '<option value="">Erreur de chargement</option>';
            }
        }
    }
}

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
        document.getElementById('download-modal').classList.add('hidden');
        
        const result = await window.electronAPI.download.downloadCourse(courseId, options);
        
        if (result.success) {
            showInfo('Téléchargement démarré !');
            
            setTimeout(() => {
                updateCoursesCount();
            }, 1000);
            
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

// ==================== SYSTÈME D'ÉVÉNEMENTS ====================
function setupSystemEventListeners() {
    // Login success
    window.electronAPI.on('login-success', async (user) => {
        logger.info('Événement login-success reçu', {
            username: user.username,
            userId: user.id
        });
        
        window.AuthState.isLoggedIn = true;
        window.AuthState.user = user;
        
        showContentPage('dashboard');
        
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
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('[data-page="dashboard"]')?.classList.add('active');
        
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName) {
            userDisplayName.textContent = user.displayName || user.username || 'Utilisateur';
        }
    });
    
    // Auto-login success
    window.electronAPI.on('auto-login-success', () => {
        logger.info('Auto-login détecté');
        setTimeout(() => {
            loadDashboardData();
        }, 500);
    });
    
    // Sync completed
    window.electronAPI.on('sync-completed', (data) => {
        logger.info('Synchronisation terminée', data);
        loadCourses();
    });
    
    // Download events
    window.electronAPI.on('download-manager:download-completed', async (data) => {
        logger.info('Téléchargement terminé:', {
            courseId: data.courseId,
            courseTitle: data.course?.title
        });
        
        showSuccess(`"${data.course?.title || 'Cours'}" téléchargé avec succès !`);
        
        await loadCourses();
        await updateCoursesCount();
        
        const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
        if (currentPage === 'dashboard') {
            await updateStats();
        }
        
        if (currentPage === 'courses' && window.loadCoursesPage) {
            await window.loadCoursesPage();
        }
    });
    
    // Connection status
    window.electronAPI.on('connection-status-changed', ({ isOnline }) => {
        logger.info(`Statut de connexion changé: ${isOnline ? 'En ligne' : 'Hors ligne'}`);
        ConnectionState.isOnline = isOnline;
        updateConnectionUI(isOnline);
    });
}

// ==================== INITIALISATION UI ====================
function initializeUI() {
    logger.info('Initialisation UI - État auth:', {
        isLoggedIn: window.AuthState?.isLoggedIn,
        hasUser: !!window.AuthState?.user
    });
    
    if (window.AuthState && window.AuthState.isLoggedIn) {
        logger.info('Utilisateur déjà connecté, affichage du dashboard');
        
        showContentPage('dashboard');
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('[data-page="dashboard"]')?.classList.add('active');
        
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName && window.AuthState.user) {
            userDisplayName.textContent = window.AuthState.user.displayName || 
                                         window.AuthState.user.username || 
                                         'Utilisateur';
        }
        
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
        
        loadDashboardData();
        
        logger.info('UI configurée pour utilisateur connecté');
        
    } else {
        logger.info('Aucun utilisateur connecté, affichage de la page de connexion');
    }
}

// ==================== CHARGEMENT DES DONNÉES ====================
async function loadDashboardData() {
    logger.info('=== CHARGEMENT DASHBOARD ===');
    
    try {
        await loadCourses();
        await updateStats();
        await updateStorageInfo();
        
        updateConnectionUI(ConnectionState.isOnline);
        
        logger.info('Dashboard chargé avec succès');
        
    } catch (error) {
        logger.error('Erreur lors du chargement du dashboard:', {
            message: error.message,
            stack: error.stack
        });
        
        if (!ConnectionState.isOnline) {
            showInfo('Mode hors ligne - Chargement des données locales');
        } else {
            showError('Erreur lors du chargement des données');
        }
    }
}

async function refreshDashboard() {
    logger.info('Rafraîchissement du dashboard...');
    
    try {
        await loadCourses();
        await updateStats();
        await updateStorageInfo();
        
        logger.info('Dashboard rafraîchi avec succès');
    } catch (error) {
        logger.error('Erreur lors du rafraîchissement:', error);
    }
}

window.refreshDashboard = refreshDashboard;

// ==================== CHARGEMENT DES COURS ====================
async function loadCourses() {
    AppLogger.log('Chargement des cours...');
    
    const coursesContainer = document.getElementById('courses-container');
    const coursesListContainer = document.getElementById('courses-list');
    
    const activeContainer = coursesContainer || coursesListContainer;
    
    try {
        if (coursesContainer && !coursesListContainer) {
            coursesContainer.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Chargement des cours...</p>
                </div>
            `;
        }
        
        let allCourses = [];
        
        if (!ConnectionState.isOnline) {
            AppLogger.log('Mode hors ligne - Chargement des cours locaux uniquement');
            const localResult = await window.electronAPI.db.getAllCourses();
            
            if (localResult.success && localResult.result) {
                allCourses = localResult.result.map(course => ({
                    ...course,
                    isDownloaded: true,
                    course_id: course.course_id,
                    id: course.course_id
                }));
            }
        } else {
            try {
                const localResult = await window.electronAPI.db.getAllCourses();
                const localCourses = localResult.success ? localResult.result : [];
                
                AppLogger.log('Appel API getUserCourses...');
                const onlineResult = await window.electronAPI.api.getUserCourses({
                    page: 1,
                    perPage: 50,
                    includeCertificates: true
                });
                
                if (onlineResult.success && onlineResult.courses) {
                    const coursesMap = new Map();
                    
                    localCourses.forEach(course => {
                        coursesMap.set(course.course_id, {
                            ...course,
                            isDownloaded: true,
                            isLocal: true
                        });
                    });
                    
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
                    allCourses = localCourses.map(course => ({
                        ...course,
                        isDownloaded: true
                    }));
                }
            } catch (error) {
                AppLogger.error('Erreur lors du chargement des cours en ligne:', error);
                const localResult = await window.electronAPI.db.getAllCourses();
                if (localResult.success && localResult.result) {
                    allCourses = localResult.result.map(course => ({
                        ...course,
                        isDownloaded: true
                    }));
                }
            }
        }
        
        if (coursesContainer && !coursesListContainer) {
            displayCourses(allCourses);
            updateDashboardStats(allCourses);
        }
        
        const coursesCount = document.getElementById('courses-count');
        if (coursesCount) {
            const downloadedCount = allCourses.filter(c => c.isDownloaded).length;
            coursesCount.textContent = downloadedCount;
        }
        
        AppLogger.log(`${allCourses.length} cours chargés avec succès`);
        
        return allCourses;
        
    } catch (error) {
        AppLogger.error('Erreur lors du chargement des cours:', error);
        
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
    
    const coursesHTML = courses.map(course => createCourseCard(course)).join('');
    coursesContainer.innerHTML = `
        <div class="courses-grid">
            ${coursesHTML}
        </div>
    `;
    
    attachCourseEventListeners();
}

function createCourseCard(course) {
    const progress = course.progress || 0;
    const thumbnail = course.thumbnail || 'assets/default-course.jpg';
    const isDownloaded = course.isDownloaded || course.is_downloaded || false;
    const canPlayOffline = isDownloaded || !ConnectionState.isOnline;
    
    return `
        <div class="course-card card ${!canPlayOffline ? 'online-only' : ''} ${isDownloaded ? 'downloaded' : ''}" data-course-id="${course.id || course.course_id}">
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

function updateDashboardStats(courses) {
    AppLogger.log('Mise à jour des statistiques');
    
    const stats = {
        total: courses.length,
        completed: courses.filter(c => c.completed).length,
        averageProgress: courses.length > 0 
            ? Math.round(courses.reduce((acc, c) => acc + (c.progress || 0), 0) / courses.length)
            : 0
    };
    
    const statCourses = document.getElementById('stat-courses');
    const statCompleted = document.getElementById('stat-completed');
    const statProgress = document.getElementById('stat-progress');
    
    if (statCourses) statCourses.textContent = stats.total;
    if (statCompleted) statCompleted.textContent = stats.completed;
    if (statProgress) statProgress.textContent = `${stats.averageProgress}%`;
    
    AppLogger.log('Statistiques mises à jour:', stats);
}

async function updateCoursesCount() {
    try {
        const localResult = await window.electronAPI.db.getAllCourses();
        if (localResult.success && localResult.result) {
            const downloadedCount = localResult.result.length;
            const coursesCount = document.getElementById('courses-count');
            if (coursesCount) {
                const currentCount = parseInt(coursesCount.textContent) || 0;
                if (currentCount !== downloadedCount) {
                    coursesCount.classList.add('badge-pulse');
                    coursesCount.textContent = downloadedCount;
                    
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
       const usedSpace = await calculateUsedSpace();
       const totalSpace = 5 * 1024 * 1024 * 1024; // 5 GB
       const percentage = Math.round((usedSpace / totalSpace) * 100);
       
       const storageBar = document.getElementById('storage-bar');
       if (storageBar) {
           storageBar.style.width = `${percentage}%`;
       }
       
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
   return 1.2 * 1024 * 1024 * 1024; // 1.2 GB
}

function formatBytes(bytes) {
   if (bytes === 0) return '0 B';
   const k = 1024;
   const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
   const i = Math.floor(Math.log(bytes) / Math.log(k));
   return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== MISE À JOUR AUTOMATIQUE DU DASHBOARD ====================
function startDashboardAutoUpdate() {
   if (dashboardUpdateInterval) {
       clearInterval(dashboardUpdateInterval);
   }
   
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

// ==================== DIALOG DE CONFIRMATION ====================
async function showConfirmDialog(title, message, confirmText = 'Confirmer', cancelText = 'Annuler') {
    if (window.electronAPI && window.electronAPI.dialog) {
        const result = await window.electronAPI.dialog.showMessageBox({
            type: 'question',
            title: title,
            message: message,
            buttons: [cancelText, confirmText],
            defaultId: 0,
            cancelId: 0
        });
        return result.response === 1;
    } else {
        return confirm(`${title}\n\n${message}`);
    }
}

// ==================== FONCTIONS UTILITAIRES ====================
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

// ==================== STYLES DYNAMIQUES ====================
const dynamicStyles = `
<style>
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.spinning {
    animation: spin 1s linear infinite;
}

.offline-banner {
    position: fixed;
    top: 60px;
    left: 0;
    right: 0;
    background: var(--warning-color, #f39c12);
    color: white;
    padding: 10px 20px;
    z-index: 1000;
    transform: translateY(-100%);
    transition: transform 0.3s ease-in-out;
}

.offline-banner.show {
    transform: translateY(0);
}

.offline-banner-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
}

.offline-queue-count {
    font-size: 0.9em;
    opacity: 0.9;
}

.offline-mode .online-only {
    opacity: 0.5;
    cursor: not-allowed;
}

.offline-mode .course-card.offline-disabled {
    opacity: 0.6;
    position: relative;
}

.offline-mode .course-card.offline-disabled::after {
    content: '🔒';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 48px;
    opacity: 0.3;
}

.badge-pulse {
    animation: pulse 0.5s ease-in-out;
}

@keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
}

.connection-indicator {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--bg-secondary);
    border-radius: 20px;
    padding: 8px 16px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    font-size: 14px;
    z-index: 1000;
    transition: all 0.3s ease;
}

.connection-indicator.online {
    background: var(--success-color, #27ae60);
    color: white;
}

.connection-indicator.offline {
    background: var(--danger-color, #e74c3c);
    color: white;
}

.sidebar-open .main-content {
    overflow: hidden;
}

.sidebar-open::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 90;
}

#sidebar.active {
    transform: translateX(0);
}

.sync-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: var(--danger-color, #e74c3c);
    color: white;
    border-radius: 10px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: bold;
    animation: badge-pulse 2s infinite;
}

@keyframes badge-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}
</style>
`;

// Injecter les styles si pas déjà fait
if (!document.getElementById('app-dynamic-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'app-dynamic-styles';
    styleElement.innerHTML = dynamicStyles.replace('<style>', '').replace('</style>', '');
    document.head.appendChild(styleElement);
}

// ==================== GESTION DES PAGES SPÉCIFIQUES ====================

// Page des cours
window.loadCoursesPage = async function() {
    logger.info('Chargement de la page des cours');
    const container = document.getElementById('courses-list');
    if (!container) {
        logger.error('Container courses-list non trouvé');
        return;
    }
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement...</p></div>';
    
    try {
        const courses = await loadCourses();
        
        if (courses && courses.length > 0) {
            if (window.coursesManager && window.coursesManager.displayCourses) {
                await window.coursesManager.displayCourses(courses, container);
            } else {
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

// Page des téléchargements
window.loadDownloadsPage = async function() {
    logger.info('Chargement de la page des téléchargements');
    const container = document.getElementById('downloads-list');
    if (!container) return;
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement des téléchargements...</p></div>';
    
    try {
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
};

// Page de progression
window.loadProgressPage = async function() {
    logger.info('Chargement de la page de progression');
    const container = document.getElementById('progress-container');
    if (!container) return;
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement de la progression...</p></div>';
    
    try {
        const progressData = await window.electronAPI.db.getDetailedProgress();
        
        if (progressData.success && progressData.result) {
            displayProgressPage(progressData.result, container);
        } else {
            container.innerHTML = '<p>Aucune progression enregistrée</p>';
        }
    } catch (error) {
        logger.error('Erreur lors du chargement de la progression:', error);
        container.innerHTML = '<p>Erreur lors du chargement de la progression</p>';
    }
};

// ==================== FONCTIONS D'AFFICHAGE ====================

function displayDownloadsDetailed(downloads, container) {
    logger.debug(`Affichage de ${downloads.length} téléchargements`);
    
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
    
    if (activeDownloads.length > 0) {
        html += `
            <div class="downloads-section">
                <h3>Téléchargements en cours (${activeDownloads.length})</h3>
                <div class="downloads-list">
                    ${activeDownloads.map(download => createDownloadItemHTML(download)).join('')}
                </div>
            </div>
        `;
    }
    
    if (completedDownloads.length > 0) {
        html += `
            <div class="downloads-section">
                <h3>Historique des téléchargements (${completedDownloads.length})</h3>
                <div class="downloads-list">
                    ${completedDownloads.map(download => createDownloadItemHTML(download)).join('')}
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
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
    
    // Barre de progression
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
    
    // Détails des fichiers
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

function displayProgressPage(progressData, container) {
    // TODO: Implémenter l'affichage détaillé de la progression
    container.innerHTML = '<p>Affichage de la progression en cours de développement...</p>';
}

// ==================== FONCTIONS DE TÉLÉCHARGEMENT ====================

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

// ==================== NETTOYAGE ====================
window.addEventListener('beforeunload', () => {
    stopDashboardAutoUpdate();
    
    if (ConnectionState.checkInterval) {
        clearInterval(ConnectionState.checkInterval);
    }
    
    if (offlineMode) {
        offlineMode.stopQueueUpdateInterval();
    }
});

// ==================== EXPORTS GLOBAUX ====================
window.showContentPage = showContentPage;
window.escapeHtml = escapeHtml;
window.showDownloadModal = showDownloadModal;
window.openCourse = function(courseId) {
    if (window.openCoursePlayer) {
        window.openCoursePlayer(courseId);
    }
};

// Export du logger pour les autres modules
window.AppLogger = AppLogger;
window.logger = logger;