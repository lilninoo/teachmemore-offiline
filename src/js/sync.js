// sync.js - Module de synchronisation avancé avec gestion de queue persistante

// ==================== SYNC QUEUE PERSISTANTE ====================
class SyncQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 secondes
        this.loadQueue();
    }
    
    async loadQueue() {
        try {
            const savedQueue = await window.electronAPI.store.get('syncQueue');
            if (savedQueue) {
                this.queue = JSON.parse(savedQueue);
                console.log(`[SyncQueue] ${this.queue.length} actions chargées depuis le stockage`);
            }
        } catch (error) {
            console.error('[SyncQueue] Erreur chargement queue:', error);
        }
    }
    
    async saveQueue() {
        try {
            await window.electronAPI.store.set('syncQueue', JSON.stringify(this.queue));
        } catch (error) {
            console.error('[SyncQueue] Erreur sauvegarde queue:', error);
        }
    }
    
    async add(action) {
        const queueItem = {
            ...action,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            attempts: 0,
            lastAttempt: null
        };
        
        this.queue.push(queueItem);
        await this.saveQueue();
        
        console.log('[SyncQueue] Action ajoutée:', queueItem.type);
        
        // Mettre à jour l'indicateur UI
        this.updateQueueIndicator();
        
        // Tenter de traiter si en ligne et pas déjà en cours
        if (navigator.onLine && !this.processing) {
            setTimeout(() => this.process(), 1000);
        }
        
        return queueItem.id;
    }
    
    async process() {
        if (this.processing || this.queue.length === 0 || !navigator.onLine) {
            return;
        }
        
        console.log(`[SyncQueue] Début du traitement de ${this.queue.length} actions`);
        this.processing = true;
        
        let successCount = 0;
        let failureCount = 0;
        
        while (this.queue.length > 0 && navigator.onLine) {
            const action = this.queue[0];
            
            try {
                console.log(`[SyncQueue] Traitement de: ${action.type}`);
                action.lastAttempt = new Date().toISOString();
                
                await this.executeAction(action);
                
                // Succès - retirer de la queue
                this.queue.shift();
                await this.saveQueue();
                successCount++;
                
                console.log(`[SyncQueue] Action ${action.type} traitée avec succès`);
                
            } catch (error) {
                console.error(`[SyncQueue] Erreur traitement ${action.type}:`, error);
                action.attempts++;
                
                if (action.attempts >= this.maxRetries) {
                    // Trop d'échecs - déplacer vers les échecs permanents
                    this.queue.shift();
                    await this.logFailure(action, error);
                    failureCount++;
                } else {
                    // Réessayer plus tard
                    console.log(`[SyncQueue] Nouvelle tentative dans ${this.retryDelay}ms`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    
                    // Si on a perdu la connexion, arrêter
                    if (!navigator.onLine) break;
                }
            }
        }
        
        this.processing = false;
        this.updateQueueIndicator();
        
        console.log(`[SyncQueue] Traitement terminé: ${successCount} succès, ${failureCount} échecs`);
        
        if (successCount > 0) {
            showSuccess(`${successCount} modification${successCount > 1 ? 's' : ''} synchronisée${successCount > 1 ? 's' : ''}`);
        }
        
        if (failureCount > 0) {
            showWarning(`${failureCount} synchronisation${failureCount > 1 ? 's' : ''} échouée${failureCount > 1 ? 's' : ''}`);
        }
    }
    
    async executeAction(action) {
        switch (action.type) {
            case 'lesson_progress':
                return await window.electronAPI.api.syncProgress({
                    lessons: [{
                        id: action.data.lessonId,
                        action: 'update',
                        data: {
                            progress: action.data.progress,
                            completed: action.data.completed,
                            last_position: action.data.lastPosition
                        },
                        timestamp: action.timestamp
                    }]
                });
                
            case 'quiz_attempt':
                return await window.electronAPI.api.syncProgress({
                    quizzes: [{
                        id: action.data.quizId,
                        action: 'submit',
                        data: {
                            answers: action.data.answers,
                            score: action.data.score,
                            completed_at: action.data.completedAt
                        },
                        timestamp: action.timestamp
                    }]
                });
                
            case 'course_completion':
                return await window.electronAPI.api.syncProgress({
                    courses: [{
                        id: action.data.courseId,
                        action: 'complete',
                        data: {
                            completion_percentage: 100,
                            completed_at: action.data.completedAt
                        },
                        timestamp: action.timestamp
                    }]
                });
                
            case 'note_update':
                return await window.electronAPI.api.updateNote({
                    lessonId: action.data.lessonId,
                    content: action.data.content,
                    timestamp: action.timestamp
                });
                
            default:
                throw new Error(`Type d'action inconnu: ${action.type}`);
        }
    }
    
    async logFailure(action, error) {
        try {
            const failures = JSON.parse(await window.electronAPI.store.get('syncFailures') || '[]');
            failures.push({
                action,
                error: error.message,
                stack: error.stack,
                failedAt: new Date().toISOString()
            });
            
            // Garder seulement les 50 derniers échecs
            if (failures.length > 50) {
                failures.splice(0, failures.length - 50);
            }
            
            await window.electronAPI.store.set('syncFailures', JSON.stringify(failures));
            console.error('[SyncQueue] Action enregistrée comme échec permanent:', action);
            
        } catch (err) {
            console.error('[SyncQueue] Erreur lors de l\'enregistrement de l\'échec:', err);
        }
    }
    
    updateQueueIndicator() {
        const count = this.queue.length;
        
        // Mettre à jour le badge sur le bouton sync
        const syncBtn = document.getElementById('sync-btn');
        if (syncBtn) {
            const existingBadge = syncBtn.querySelector('.sync-badge');
            if (existingBadge) existingBadge.remove();
            
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'sync-badge';
                badge.textContent = count;
                syncBtn.style.position = 'relative';
                syncBtn.appendChild(badge);
            }
        }
        
        // Mettre à jour le compteur dans le banner offline
        const queueCount = document.getElementById('offline-queue-count');
        if (queueCount) {
            queueCount.textContent = count > 0 ? `(${count} en attente)` : '';
        }
    }
    
    getQueueSize() {
        return this.queue.length;
    }
    
    isProcessing() {
        return this.processing;
    }
    
    async clear() {
        this.queue = [];
        await this.saveQueue();
        this.updateQueueIndicator();
    }
}

// ==================== ÉTAT DE LA SYNCHRONISATION ====================
const SyncState = {
    isSyncing: false,
    lastSync: null,
    pendingSync: new Set(),
    syncErrors: [],
    syncTimeout: null,
    autoSyncInterval: null,
    connectionCheckInterval: null
};

// Instance globale de la queue
window.syncQueue = new SyncQueue();

// ==================== INITIALISATION ====================
async function initializeSync() {
    try {
        console.log('[Sync] Initialisation du module de synchronisation');
        
        // Charger la dernière date de synchronisation
        if (window.electronAPI && window.electronAPI.store) {
            SyncState.lastSync = await window.electronAPI.store.get('lastSync');
        }
        
        // Démarrer la synchronisation automatique si activée
        const autoSync = await window.electronAPI.store.get('autoSync');
        if (autoSync !== false) { // Par défaut activé
            startAutoSync();
        }
        
        // Écouter les changements de connexion
        window.addEventListener('online', onConnectionRestored);
        window.addEventListener('offline', onConnectionLost);
        
        // Vérification périodique de la connexion
        startConnectionMonitoring();
        
        // Traiter la queue si on est en ligne
        if (navigator.onLine && window.syncQueue.getQueueSize() > 0) {
            console.log('[Sync] Actions en attente détectées, traitement...');
            setTimeout(() => window.syncQueue.process(), 2000);
        }
        
        console.log('[Sync] Module initialisé avec succès');
        return { success: true };
        
    } catch (error) {
        console.error('[Sync] Erreur lors de l\'initialisation:', error);
        return { success: false, error: error.message };
    }
}

// ==================== SYNCHRONISATION COMPLÈTE ====================
async function performFullSync() {
    if (SyncState.isSyncing) {
        console.log('[Sync] Synchronisation déjà en cours');
        return { success: false, error: 'Synchronisation déjà en cours' };
    }
    
    if (!navigator.onLine) {
        console.log('[Sync] Pas de connexion internet');
        return { success: false, error: 'Aucune connexion internet' };
    }
    
    console.log('[Sync] ========== DÉBUT SYNCHRONISATION COMPLÈTE ==========');
    SyncState.isSyncing = true;
    
    const syncStartTime = Date.now();
    const results = {
        success: true,
        processed: 0,
        conflicts: 0,
        errors: [],
        updates: []
    };
    
    try {
        // 1. Traiter la queue d'actions en attente
        showSyncProgress('Envoi des modifications locales...', 10);
        if (window.syncQueue.getQueueSize() > 0) {
            console.log(`[Sync] ${window.syncQueue.getQueueSize()} actions en attente`);
            await window.syncQueue.process();
            results.processed = window.syncQueue.getQueueSize();
        }
        
        // 2. Récupérer les modifications locales non synchronisées
        showSyncProgress('Analyse des modifications locales...', 25);
        const localChanges = await getLocalChanges();
        console.log(`[Sync] ${localChanges.length} modifications locales trouvées`);
        
        if (localChanges.length > 0) {
            showSyncProgress('Synchronisation avec le serveur...', 40);
            const syncResult = await syncWithServer(localChanges);
            
            if (syncResult.conflicts && syncResult.conflicts.length > 0) {
                // Gérer les conflits
                showSyncProgress('Résolution des conflits...', 60);
                const conflictResult = await handleSyncConflicts(syncResult.conflicts);
                results.conflicts = syncResult.conflicts.length;
                
                if (!conflictResult.success) {
                    throw new Error('Résolution des conflits annulée');
                }
            }
            
            results.processed += localChanges.length;
        }
        
        // 3. Vérifier les mises à jour des cours
        showSyncProgress('Vérification des mises à jour...', 70);
        const updates = await checkCourseUpdates();
        if (updates.length > 0) {
            results.updates = updates;
            showUpdateNotification(updates);
        }
        
        // 4. Nettoyer les données expirées
        showSyncProgress('Nettoyage des données...', 85);
        await cleanupExpiredContent();
        
        // 5. Synchroniser les statistiques
        showSyncProgress('Synchronisation des statistiques...', 95);
        await syncStatistics();
        
        // 6. Mettre à jour la date de dernière sync
        SyncState.lastSync = new Date().toISOString();
        await window.electronAPI.store.set('lastSync', SyncState.lastSync);
        
        const syncDuration = Date.now() - syncStartTime;
        console.log(`[Sync] ========== SYNCHRONISATION TERMINÉE (${syncDuration}ms) ==========`);
        
        showSyncProgress('Synchronisation terminée !', 100);
        
        // Rafraîchir l'interface
        if (window.refreshDashboard) {
            await window.refreshDashboard();
        }
        
        // Mettre à jour les indicateurs
        await updateSyncIndicators();
        
        setTimeout(() => {
            hideSyncProgress();
            
            // Afficher le résumé
            if (results.processed > 0 || results.updates.length > 0) {
                const message = `Synchronisation réussie: ${results.processed} modification(s) envoyée(s)` +
                    (results.conflicts > 0 ? `, ${results.conflicts} conflit(s) résolu(s)` : '') +
                    (results.updates.length > 0 ? `, ${results.updates.length} mise(s) à jour disponible(s)` : '');
                showSuccess(message);
            } else {
                showInfo('Tout est déjà synchronisé');
            }
        }, 1500);
        
        return results;
        
    } catch (error) {
        console.error('[Sync] Erreur lors de la synchronisation:', error);
        SyncState.syncErrors.push({
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        });
        
        results.success = false;
        results.errors.push(error.message);
        
        showError(`Erreur de synchronisation: ${error.message}`);
        hideSyncProgress();
        
        return results;
        
    } finally {
        SyncState.isSyncing = false;
    }
}

// ==================== FONCTIONS DE SYNCHRONISATION ====================

async function getLocalChanges() {
    try {
        const result = await window.electronAPI.db.getUnsyncedItems();
        if (result.success && result.result) {
            return result.result;
        }
        return [];
    } catch (error) {
        console.error('[Sync] Erreur lors de la récupération des modifications locales:', error);
        return [];
    }
}

async function syncWithServer(localChanges) {
    if (!localChanges || localChanges.length === 0) {
        return { success: true, synced: 0 };
    }
    
    console.log(`[Sync] Envoi de ${localChanges.length} modifications au serveur`);
    
    // Grouper par type pour optimiser
    const grouped = {
        lessons: [],
        quizzes: [],
        courses: [],
        notes: []
    };
    
    localChanges.forEach(item => {
        const data = {
            id: item.entity_id,
            action: item.action,
            data: typeof item.data === 'string' ? JSON.parse(item.data) : item.data,
            timestamp: item.created_at,
            sync_id: item.id
        };
        
        switch (item.entity_type) {
            case 'lesson':
                grouped.lessons.push(data);
                break;
            case 'quiz':
                grouped.quizzes.push(data);
                break;
            case 'course':
                grouped.courses.push(data);
                break;
            case 'note':
                grouped.notes.push(data);
                break;
        }
    });
    
    try {
        // Envoyer au serveur
        const result = await window.electronAPI.api.syncProgress(grouped);
        
        if (result.success) {
            // Marquer comme synchronisés
            const syncIds = localChanges.map(item => item.id);
            await window.electronAPI.db.markAsSynced(syncIds);
            
            console.log(`[Sync] ${syncIds.length} éléments synchronisés avec succès`);
            
            return {
                success: true,
                synced: syncIds.length,
                conflicts: result.conflicts || []
            };
        } else {
            throw new Error(result.error || 'Échec de la synchronisation');
        }
    } catch (error) {
        console.error('[Sync] Erreur lors de l\'envoi des changements:', error);
        throw error;
    }
}

async function handleSyncConflicts(conflicts) {
    if (!conflicts || conflicts.length === 0) {
        return { success: true };
    }
    
    console.log(`[Sync] ${conflicts.length} conflits détectés`);
    
    try {
        // Utiliser le conflict resolver
        const resolutions = await window.conflictResolver.showConflictDialog(conflicts);
        
        // Appliquer les résolutions
        for (const [conflictId, resolution] of Object.entries(resolutions)) {
            const conflict = conflicts.find(c => c.id === conflictId);
            if (conflict) {
                if (resolution === 'local') {
                    // Forcer la version locale
                    await forceLocalVersion(conflict);
                } else {
                    // Accepter la version serveur
                    await acceptServerVersion(conflict);
                }
            }
        }
        
        console.log('[Sync] Conflits résolus avec succès');
        return { success: true };
        
    } catch (error) {
        console.error('[Sync] Résolution de conflits annulée:', error);
        return { success: false, error: 'Résolution annulée' };
    }
}

async function forceLocalVersion(conflict) {
    // Forcer l'envoi de la version locale au serveur
    await window.electronAPI.api.syncProgress({
        [`${conflict.entity_type}s`]: [{
            id: conflict.entity_id,
            action: 'force_update',
            data: conflict.local.data,
            timestamp: new Date().toISOString()
        }]
    });
}

async function acceptServerVersion(conflict) {
    // Mettre à jour la base locale avec la version serveur
    switch (conflict.entity_type) {
        case 'lesson':
            await window.electronAPI.db.updateLessonProgress(
                conflict.entity_id,
                conflict.server.data.progress,
                conflict.server.data.completed
            );
            break;
        case 'quiz':
            // Implémenter selon le schéma de DB
            break;
        case 'course':
            // Implémenter selon le schéma de DB
            break;
    }
}

async function checkCourseUpdates() {
    try {
        const localResult = await window.electronAPI.db.getAllCourses();
        if (!localResult.success || !localResult.result) {
            return [];
        }
        
        const localCourses = localResult.result;
        const updates = [];
        
        for (const localCourse of localCourses) {
            try {
                const serverResult = await window.electronAPI.api.getCourseDetails(localCourse.course_id);
                
                if (serverResult.success && serverResult.course) {
                    const serverCourse = serverResult.course;
                    
                    // Comparer les versions ou dates
                    const needsUpdate = (serverCourse.version && localCourse.version && 
                                       serverCourse.version > localCourse.version) ||
                                      (new Date(serverCourse.updated_at) > new Date(localCourse.updated_at));
                    
                    if (needsUpdate) {
                        updates.push({
                            course_id: localCourse.course_id,
                            title: localCourse.title,
                            type: 'update',
                            local_version: localCourse.version || '1.0',
                            server_version: serverCourse.version || '1.1',
                            size_estimate: serverCourse.file_size || 0
                        });
                    }
                }
            } catch (error) {
                console.debug(`[Sync] Impossible de vérifier les mises à jour pour ${localCourse.title}`);
            }
        }
        
        console.log(`[Sync] ${updates.length} mises à jour disponibles`);
        return updates;
        
    } catch (error) {
        console.error('[Sync] Erreur lors de la vérification des mises à jour:', error);
        return [];
    }
}

async function cleanupExpiredContent() {
    try {
        const result = await window.electronAPI.db.getExpiredCourses();
        
        if (!result.success || !result.result || result.result.length === 0) {
            console.log('[Sync] Aucun cours expiré trouvé');
            return;
        }
        
        const expiredCourses = result.result;
        console.log(`[Sync] ${expiredCourses.length} cours expirés trouvés`);
        
        // Demander confirmation
        const confirmCleanup = await showCleanupConfirmation(expiredCourses);
        
        if (confirmCleanup) {
            for (const course of expiredCourses) {
                await window.electronAPI.db.deleteCourse(course.course_id);
                console.log(`[Sync] Cours expiré supprimé: ${course.title}`);
            }
            
            showSuccess(`${expiredCourses.length} cours expirés supprimés`);
        }
        
    } catch (error) {
        console.error('[Sync] Erreur lors du nettoyage:', error);
    }
}

async function syncStatistics() {
    try {
        // Récupérer les statistiques locales
        const localStats = await window.electronAPI.db.getStats();
        
        if (localStats.success && localStats.result) {
            // Envoyer au serveur
            await window.electronAPI.api.syncProgress({
                statistics: [{
                    action: 'update',
                    data: {
                        total_courses: localStats.result.totalCourses,
                        completed_courses: localStats.result.completedCourses,
                        total_lessons: localStats.result.totalLessons,
                        completed_lessons: localStats.result.completedLessons,
                        average_progress: localStats.result.averageProgress,
                        last_activity: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                }]
            });
        }
    } catch (error) {
        console.error('[Sync] Erreur sync statistiques:', error);
    }
}

// ==================== SYNCHRONISATION AUTOMATIQUE ====================

function startAutoSync() {
    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    stopAutoSync(); // Arrêter l'ancienne instance
    
    SyncState.autoSyncInterval = setInterval(async () => {
        if (navigator.onLine && !SyncState.isSyncing) {
            console.log('[Sync] Démarrage de la synchronisation automatique');
            await performFullSync();
        }
    }, SYNC_INTERVAL);
    
    console.log('[Sync] Synchronisation automatique activée (toutes les 30 minutes)');
}

function stopAutoSync() {
    if (SyncState.autoSyncInterval) {
        clearInterval(SyncState.autoSyncInterval);
        SyncState.autoSyncInterval = null;
        console.log('[Sync] Synchronisation automatique désactivée');
    }
}

// ==================== GESTION DE LA CONNEXION ====================

function startConnectionMonitoring() {
    SyncState.connectionCheckInterval = setInterval(() => {
        checkConnectionAndSync();
    }, 10000); // Toutes les 10 secondes
}

async function checkConnectionAndSync() {
    const isOnline = navigator.onLine;
    
    if (isOnline && window.syncQueue.getQueueSize() > 0 && !window.syncQueue.isProcessing()) {
        console.log('[Sync] Connexion détectée, traitement de la queue...');
        await window.syncQueue.process();
    }
}

function onConnectionRestored() {
    console.log('[Sync] 🌐 Connexion internet rétablie');
    
    showInfo('Connexion rétablie - Synchronisation en cours...');
    
    // Attendre un peu avant de synchroniser
    setTimeout(async () => {
        // Traiter la queue
        if (window.syncQueue.getQueueSize() > 0) {
            console.log(`[Sync] ${window.syncQueue.getQueueSize()} actions en attente`);
            await window.syncQueue.process();
        }
        
        // Sync complète si nécessaire
        if (!SyncState.isSyncing) {
            const lastSyncDate = SyncState.lastSync ? new Date(SyncState.lastSync) : null;
            const hoursSinceLastSync = lastSyncDate ? 
                (Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60) : 999;
            
            if (hoursSinceLastSync > 1) {
                console.log('[Sync] Plus d\'1 heure depuis la dernière sync, lancement...');
                performFullSync();
            }
        }
    }, 3000);
}

function onConnectionLost() {
    console.log('[Sync] 📴 Connexion internet perdue');
    
    if (window.syncQueue.isProcessing()) {
        console.log('[Sync] Arrêt du traitement de la queue');
    }
    
    showWarning('Mode hors ligne - Les modifications seront synchronisées ultérieurement');
}

// ==================== INTERFACE UTILISATEUR ====================

function showSyncProgress(message, percentage) {
    let progressEl = document.getElementById('sync-progress');
    
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'sync-progress';
        progressEl.className = 'sync-progress';
        document.body.appendChild(progressEl);
    }
    
    progressEl.innerHTML = `
        <div class="sync-progress-content">
            <div class="sync-progress-header">
                <span class="sync-icon">🔄</span>
                <span class="sync-title">Synchronisation</span>
            </div>
            <p class="sync-message">${message}</p>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
            <span class="progress-text">${percentage}%</span>
        </div>
    `;
    
    setTimeout(() => progressEl.classList.add('show'), 10);
}

function hideSyncProgress() {
    const progressEl = document.getElementById('sync-progress');
    if (progressEl) {
        progressEl.classList.remove('show');
        setTimeout(() => progressEl.remove(), 300);
    }
}

function showUpdateNotification(updates) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.id = 'update-notification';
    
    const totalSize = updates.reduce((sum, u) => sum + (u.size_estimate || 0), 0);
    
    notification.innerHTML = `
        <div class="update-notification-content">
            <button class="notification-close" onclick="dismissUpdateNotification()">×</button>
            <h4>🎉 Mises à jour disponibles</h4>
            <p>${updates.length} cours ont des nouvelles versions</p>
            <div class="update-list">
                ${updates.slice(0, 3).map(u => `
                    <div class="update-item">
                        <span class="update-title">${escapeHtml(u.title)}</span>
                        <span class="update-version">v${u.server_version}</span>
                    </div>
                `).join('')}
                ${updates.length > 3 ? `
                    <div class="update-more">Et ${updates.length - 3} autres...</div>
                ` : ''}
            </div>
            ${totalSize > 0 ? `
                <p class="update-size">Taille estimée: ${formatBytes(totalSize)}</p>
            ` : ''}
            <div class="update-actions">
                <button class="btn btn-primary" onclick="showUpdateManager()">
                    Gérer les mises à jour
                </button>
                <button class="btn btn-secondary" onclick="dismissUpdateNotification()">
                    Plus tard
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Auto-masquer après 30 secondes
    setTimeout(() => {
        if (document.getElementById('update-notification')) {
            dismissUpdateNotification();
        }
    }, 30000);
}

async function showCleanupConfirmation(expiredCourses) {
    if (window.electronAPI && window.electronAPI.dialog) {
        const result = await window.electronAPI.dialog.showMessageBox({
            type: 'question',
            title: 'Cours expirés',
            message: `${expiredCourses.length} cours ont expiré. Voulez-vous les supprimer pour libérer de l'espace ?`,
            detail: expiredCourses.slice(0, 10).map(c => `• ${c.title}`).join('\n') + 
                    (expiredCourses.length > 10 ? `\n... et ${expiredCourses.length - 10} autres` : ''),
            buttons: ['Supprimer', 'Conserver'],
            defaultId: 0,
            cancelId: 1
        });
        
        return result.response === 0;
    } else {
        return confirm(
            `${expiredCourses.length} cours ont expiré.\n\n` +
            `Voulez-vous les supprimer pour libérer de l'espace ?\n\n` +
            expiredCourses.slice(0, 5).map(c => `- ${c.title}`).join('\n') +
            (expiredCourses.length > 5 ? `\n... et ${expiredCourses.length - 5} autres` : '')
        );
    }
}

async function updateSyncIndicators() {
    try {
        // Mettre à jour le badge de la queue
        window.syncQueue.updateQueueIndicator();
        
        // Mettre à jour la date de dernière sync dans l'UI
        const lastSyncEl = document.getElementById('last-sync-time');
        if (lastSyncEl && SyncState.lastSync) {
            const date = new Date(SyncState.lastSync);
            lastSyncEl.textContent = `Dernière sync: ${formatRelativeTime(date)}`;
        }
        
    } catch (error) {
        console.error('[Sync] Erreur mise à jour indicateurs:', error);
    }
}

// ==================== FONCTIONS UTILITAIRES ====================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
    
    const days = Math.floor(hours / 24);
    return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
}

function showInfo(message) {
    window.showInfo ? window.showInfo(message) : console.info(message);
}

function showSuccess(message) {
    window.showSuccess ? window.showSuccess(message) : console.log(message);
}

function showError(message) {
    window.showError ? window.showError(message) : console.error(message);
}

function showWarning(message) {
    window.showWarning ? window.showWarning(message) : console.warn(message);
}

// ==================== FONCTIONS GLOBALES ====================

window.showUpdateManager = function() {
    // TODO: Implémenter le gestionnaire de mises à jour
    showInfo('Gestionnaire de mises à jour en développement');
};

window.dismissUpdateNotification = function() {
    const notification = document.getElementById('update-notification');
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }
};

// ==================== API PUBLIQUE ====================

window.syncManager = {
    initialized: false,
    
    // Initialisation
    initializeSync: async function() {
        if (this.initialized) return { success: true };
        const result = await initializeSync();
        this.initialized = result.success;
        return result;
    },
    
    // Synchronisation complète
    performFullSync,
    
    // Gestion de la synchronisation automatique
    startAutoSync,
    stopAutoSync,
    
    // Ajouter une action à la queue
    queueAction: async function(type, data) {
        return await window.syncQueue.add({ type, data });
    },
    
    // Obtenir le statut
    getSyncStatus: function() {
        return {
            isSyncing: SyncState.isSyncing,
            lastSync: SyncState.lastSync,
            queueSize: window.syncQueue.getQueueSize(),
            isProcessing: window.syncQueue.isProcessing(),
            errors: SyncState.syncErrors.slice(-10) // Les 10 dernières erreurs
        };
    },
    
    // Forcer le traitement de la queue
    processQueue: async function() {
        if (navigator.onLine) {
            await window.syncQueue.process();
        }
    },
    
    // Nettoyer la queue
    clearQueue: async function() {
        if (confirm('Êtes-vous sûr de vouloir supprimer toutes les modifications en attente ?')) {
            await window.syncQueue.clear();
            showInfo('File d\'attente vidée');
        }
    },
    
    // Obtenir les échecs de synchronisation
    getSyncFailures: async function() {
        try {
            const failures = await window.electronAPI.store.get('syncFailures');
            return failures ? JSON.parse(failures) : [];
        } catch {
            return [];
        }
    }
};

// ==================== STYLES CSS ====================

const syncStyles = `
<style>
/* Progress de synchronisation */
.sync-progress {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--bg-primary);
    border-radius: 12px;
    box-shadow: var(--shadow-xl);
    padding: 24px;
    min-width: 320px;
    transform: translateY(150%);
    transition: transform 0.3s ease;
    z-index: 1000;
    border: 1px solid var(--border-color);
}

.sync-progress.show {
    transform: translateY(0);
}

.sync-progress-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
}

.sync-icon {
    font-size: 24px;
    animation: spin 2s linear infinite;
}

.sync-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
}

.sync-message {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--text-secondary);
}

.progress-bar {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--primary-color), var(--primary-hover));
    transition: width 0.3s ease;
    position: relative;
    overflow: hidden;
}

.progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.3),
        transparent
    );
    animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.progress-text {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: right;
}

/* Notification de mise à jour */
.update-notification {
    position: fixed;
    top: calc(var(--header-height) + 20px);
    right: 20px;
    background: var(--bg-primary);
    border-radius: 12px;
    box-shadow: var(--shadow-xl);
    padding: 24px;
    max-width: 420px;
    transform: translateX(450px);
    transition: transform 0.3s ease;
    z-index: 999;
    border: 2px solid var(--primary-color);
}

.update-notification.show {
    transform: translateX(0);
}

.update-notification-content {
    position: relative;
}

.notification-close {
    position: absolute;
    top: -8px;
    right: -8px;
    background: transparent;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.notification-close:hover {
    color: var(--text-primary);
}

.update-notification h4 {
    margin: 0 0 12px;
    color: var(--primary-color);
    font-size: 18px;
}

.update-notification p {
    margin: 0 0 16px;
    color: var(--text-secondary);
}

.update-list {
    margin: 16px 0;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
}

.update-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-color);
}

.update-item:last-child {
    border-bottom: none;
}

.update-title {
    font-weight: 500;
    color: var(--text-primary);
}

.update-version {
    font-size: 12px;
    background: var(--primary-color);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
}

.update-more {
    padding: 8px 0 0;
    font-style: italic;
    color: var(--text-secondary);
    font-size: 13px;
}

.update-size {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 12px 0 !important;
}

.update-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}

/* Badge de synchronisation */
.sync-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: var(--danger-color);
    color: white;
    border-radius: 10px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: bold;
    min-width: 18px;
    text-align: center;
    animation: badge-pulse 2s infinite;
}

@keyframes badge-pulse {
    0%, 100% { 
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7);
    }
    50% { 
        transform: scale(1.1);
        box-shadow: 0 0 0 10px rgba(231, 76, 60, 0);
    }
}

/* Animation de rotation */
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* Bouton sync en cours */
#sync-btn.syncing {
    position: relative;
    overflow: hidden;
}

#sync-btn.syncing::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.2),
        transparent
    );
    animation: sync-wave 1.5s infinite;
}

@keyframes sync-wave {
    0% { left: -100%; }
    100% { left: 100%; }
}

/* État de sync dans l'UI */
.sync-status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-radius: 20px;
    font-size: 12px;
    color: var(--text-secondary);
}

.sync-status-indicator.syncing {
    background: var(--primary-light);
    color: var(--primary-color);
}

.sync-status-indicator.error {
    background: rgba(231, 76, 60, 0.1);
    color: var(--danger-color);
}
</style>
`;

// Injecter les styles au chargement
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        document.head.insertAdjacentHTML('beforeend', syncStyles);
    });
} else {
    document.head.insertAdjacentHTML('beforeend', syncStyles);
}

// ==================== INITIALISATION AU CHARGEMENT ====================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[Sync] Document prêt, initialisation du module sync');
        initializeSync();
    });
} else {
    console.log('[Sync] Document déjà chargé, initialisation immédiate');
    initializeSync();
}

console.log('[Sync] Module de synchronisation chargé avec succès');