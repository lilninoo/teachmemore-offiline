// sync.js - Module de synchronisation avec le serveur

// État de la synchronisation
const SyncState = {
    isSyncing: false,
    lastSync: null,
    pendingSync: new Set(),
    syncErrors: [],
    syncTimeout: null
};

// Initialiser la synchronisation
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
        
        console.log('[Sync] Module initialisé avec succès');
        return { success: true };
        
    } catch (error) {
        console.error('[Sync] Erreur lors de l\'initialisation:', error);
        return { success: false, error: error.message };
    }
}

// Synchronisation complète
async function performFullSync() {
    if (SyncState.isSyncing) {
        console.log('[Sync] Synchronisation déjà en cours');
        return { success: false, error: 'Synchronisation déjà en cours' };
    }
    
    console.log('[Sync] Démarrage de la synchronisation complète');
    SyncState.isSyncing = true;
    
    // Utiliser showSyncProgress si elle existe, sinon fallback
    const showProgress = window.showSyncProgress || ((msg, pct) => {
        console.log(`[Sync Progress] ${msg} (${pct}%)`);
        if (window.showInfo) window.showInfo(`${msg} (${pct}%)`);
    });
    
    const hideProgress = window.hideSyncProgress || (() => {
        console.log('[Sync Progress] Terminé');
    });
    
    showProgress('Synchronisation en cours...', 0);
    
    try {
        // 1. Vérifier la connexion
        const isOnline = navigator.onLine;
        if (!isOnline) {
            throw new Error('Aucune connexion internet');
        }
        
        // 2. Récupérer les modifications locales
        showProgress('Analyse des modifications locales...', 10);
        const localChanges = await getLocalChanges();
        console.log(`[Sync] ${localChanges.length} modifications locales trouvées`);
        
        // 3. Synchroniser la progression des leçons
        showProgress('Synchronisation de la progression...', 30);
        await syncLessonProgress();
        
        // 4. Synchroniser avec le serveur si on a des changements
        if (localChanges.length > 0) {
            showProgress('Envoi des modifications au serveur...', 50);
            await pushLocalChanges(localChanges);
        }
        
        // 5. Vérifier les mises à jour des cours
        showProgress('Vérification des mises à jour...', 70);
        await checkCourseUpdates();
        
        // 6. Nettoyer les cours expirés
        showProgress('Nettoyage des données...', 90);
        await cleanupExpiredContent();
        
        // 7. Mettre à jour la date de dernière sync
        SyncState.lastSync = new Date().toISOString();
        if (window.electronAPI && window.electronAPI.store) {
            await window.electronAPI.store.set('lastSync', SyncState.lastSync);
        }
        
        showProgress('Synchronisation terminée !', 100);
        
        // Rafraîchir l'interface
        if (window.refreshDashboard) {
            window.refreshDashboard();
        }
        
        // Mettre à jour l'indicateur de sync
        if (window.updateSyncIndicator) {
            await window.updateSyncIndicator();
        }
        
        setTimeout(() => {
            hideProgress();
        }, 2000);
        
        console.log('[Sync] Synchronisation complète terminée avec succès');
        
        if (window.showSuccess) {
            window.showSuccess('Synchronisation terminée avec succès');
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('[Sync] Erreur lors de la synchronisation:', error);
        SyncState.syncErrors.push({
            timestamp: new Date().toISOString(),
            error: error.message
        });
        
        if (window.showError) {
            window.showError(`Erreur de synchronisation: ${error.message}`);
        }
        
        hideProgress();
        
        return { success: false, error: error.message };
        
    } finally {
        SyncState.isSyncing = false;
    }
}

// Récupérer les modifications locales
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

// Pousser les changements locaux vers le serveur
async function pushLocalChanges(changes) {
    if (!changes || changes.length === 0) return;
    
    console.log(`[Sync] Envoi de ${changes.length} modifications au serveur`);
    
    // Grouper par type pour optimiser
    const progressData = {
        lessons: [],
        quizzes: [],
        courses: []
    };
    
    changes.forEach(item => {
        const data = {
            id: item.entity_id,
            action: item.action,
            data: item.data,
            timestamp: item.created_at
        };
        
        switch (item.entity_type) {
            case 'lesson':
                progressData.lessons.push(data);
                break;
            case 'quiz':
                progressData.quizzes.push(data);
                break;
            case 'course':
                progressData.courses.push(data);
                break;
        }
    });
    
    try {
        // Utiliser la fonction syncProgress qui existe dans votre preload
        const result = await window.electronAPI.api.syncProgress(progressData);
        
        if (result.success) {
            // Marquer comme synchronisés
            const syncIds = changes.map(item => item.id);
            await window.electronAPI.db.markAsSynced(syncIds);
            
            console.log(`[Sync] ${syncIds.length} éléments synchronisés avec succès`);
        } else {
            throw new Error(result.error || 'Échec de la synchronisation');
        }
    } catch (error) {
        console.error('[Sync] Erreur lors de l\'envoi des changements:', error);
        throw error;
    }
}

// Synchroniser la progression des leçons
async function syncLessonProgress() {
    try {
        // Utiliser getUnsyncedItems qui existe déjà
        const result = await window.electronAPI.db.getUnsyncedItems();
        
        if (!result.success || !result.result || result.result.length === 0) {
            console.log('[Sync] Aucune progression à synchroniser');
            return;
        }
        
        const unsyncedItems = result.result;
        console.log(`[Sync] ${unsyncedItems.length} éléments de progression trouvés`);
        
        // Les envoyer via pushLocalChanges
        await pushLocalChanges(unsyncedItems);
        
    } catch (error) {
        console.error('[Sync] Erreur lors de la synchronisation de la progression:', error);
        // Ne pas propager l'erreur pour continuer la sync
    }
}

// Vérifier les mises à jour des cours
async function checkCourseUpdates() {
    try {
        // Récupérer la liste des cours locaux
        const localResult = await window.electronAPI.db.getAllCourses();
        if (!localResult.success || !localResult.result) {
            return;
        }
        
        const localCourses = localResult.result;
        const updates = [];
        
        // Pour chaque cours local, vérifier s'il y a une mise à jour
        for (const localCourse of localCourses) {
            try {
                // Utiliser getCourseDetails qui existe dans votre preload
                const serverResult = await window.electronAPI.api.getCourseDetails(localCourse.course_id);
                
                if (serverResult.success && serverResult.data) {
                    const serverCourse = serverResult.data;
                    
                    // Comparer les dates de mise à jour
                    const localDate = new Date(localCourse.updated_at || 0);
                    const serverDate = new Date(serverCourse.updated_at || 0);
                    
                    if (serverDate > localDate) {
                        updates.push({
                            course_id: serverCourse.id,
                            title: serverCourse.title,
                            type: 'update',
                            local_version: localCourse.version || '1.0',
                            server_version: serverCourse.version || '1.1'
                        });
                    }
                }
            } catch (error) {
                console.debug(`[Sync] Impossible de vérifier les mises à jour pour ${localCourse.title}`);
            }
        }
        
        // Notifier l'utilisateur des mises à jour disponibles
        if (updates.length > 0) {
            console.log(`[Sync] ${updates.length} mises à jour disponibles`);
            showUpdateNotification(updates);
        }
        
    } catch (error) {
        console.error('[Sync] Erreur lors de la vérification des mises à jour:', error);
    }
}

// Nettoyer le contenu expiré
async function cleanupExpiredContent() {
    try {
        // Cette fonction existe dans votre preload !
        const result = await window.electronAPI.db.getExpiredCourses();
        
        if (!result.success || !result.result || result.result.length === 0) {
            console.log('[Sync] Aucun cours expiré trouvé');
            return;
        }
        
        const expiredCourses = result.result;
        console.log(`[Sync] ${expiredCourses.length} cours expirés trouvés`);
        
        // Demander confirmation à l'utilisateur
        const confirmCleanup = await showCleanupConfirmation(expiredCourses);
        
        if (confirmCleanup) {
            for (const course of expiredCourses) {
                await window.electronAPI.db.deleteCourse(course.course_id);
            }
            
            if (window.showSuccess) {
                window.showSuccess(`${expiredCourses.length} cours expirés supprimés`);
            }
        }
        
    } catch (error) {
        console.error('[Sync] Erreur lors du nettoyage:', error);
        // Ne pas propager l'erreur
    }
}

// Synchronisation automatique
let autoSyncInterval = null;

function startAutoSync() {
    // Synchroniser toutes les 30 minutes par défaut
    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    stopAutoSync(); // Arrêter l'ancienne instance si elle existe
    
    autoSyncInterval = setInterval(async () => {
        const isOnline = navigator.onLine;
        if (isOnline && !SyncState.isSyncing) {
            console.log('[Sync] Démarrage de la synchronisation automatique');
            performFullSync();
        }
    }, SYNC_INTERVAL);
    
    console.log('[Sync] Synchronisation automatique activée (toutes les 30 minutes)');
}

function stopAutoSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
        console.log('[Sync] Synchronisation automatique désactivée');
    }
}

// Gestion de la connexion
function onConnectionRestored() {
    console.log('[Sync] Connexion internet rétablie');
    if (window.showInfo) {
        window.showInfo('Connexion rétablie - Synchronisation en cours...');
    }
    
    // Attendre 5 secondes avant de synchroniser
    setTimeout(() => {
        if (!SyncState.isSyncing) {
            performFullSync();
        }
    }, 5000);
}

function onConnectionLost() {
    console.log('[Sync] Connexion internet perdue');
    if (window.showWarning) {
        window.showWarning('Mode hors ligne - Les modifications seront synchronisées ultérieurement');
    }
}

// Interface utilisateur pour la synchronisation
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
            <p>${message}</p>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
            <span class="progress-text">${percentage}%</span>
        </div>
    `;
    
    progressEl.classList.add('show');
}

function hideSyncProgress() {
    const progressEl = document.getElementById('sync-progress');
    if (progressEl) {
        progressEl.classList.remove('show');
        setTimeout(() => {
            progressEl.remove();
        }, 300);
    }
}

// Notifications de mise à jour
function showUpdateNotification(updates) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    
    notification.innerHTML = `
        <div class="update-notification-content">
            <h4>Mises à jour disponibles</h4>
            <p>${updates.length} cours ont des mises à jour disponibles</p>
            <ul>
                ${updates.slice(0, 3).map(u => 
                    `<li>${u.title} (v${u.server_version})</li>`
                ).join('')}
                ${updates.length > 3 ? `<li>Et ${updates.length - 3} autres...</li>` : ''}
            </ul>
            <div class="update-actions">
                <button class="btn btn-primary" onclick="showUpdateManager()">
                    Voir les mises à jour
                </button>
                <button class="btn btn-secondary" onclick="dismissUpdateNotification()">
                    Plus tard
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
}

// Confirmation de nettoyage
async function showCleanupConfirmation(expiredCourses) {
    if (window.electronAPI && window.electronAPI.dialog) {
        const result = await window.electronAPI.dialog.showMessageBox({
            type: 'question',
            title: 'Cours expirés',
            message: `${expiredCourses.length} cours ont expiré. Voulez-vous les supprimer pour libérer de l'espace ?`,
            detail: expiredCourses.map(c => c.title).join('\n'),
            buttons: ['Supprimer', 'Conserver'],
            defaultId: 0,
            cancelId: 1
        });
        
        return result.response === 0;
    } else {
        // Fallback si dialog n'est pas disponible
        return confirm(
            `${expiredCourses.length} cours ont expiré.\n\n` +
            `Voulez-vous les supprimer pour libérer de l'espace ?\n\n` +
            expiredCourses.slice(0, 5).map(c => `- ${c.title}`).join('\n') +
            (expiredCourses.length > 5 ? `\n... et ${expiredCourses.length - 5} autres` : '')
        );
    }
}

// Synchroniser un élément spécifique
async function syncItem(type, id, data) {
    try {
        const key = `${type}-${id}`;
        SyncState.pendingSync.add(key);
        
        // Ajouter à la file de synchronisation
        await window.electronAPI.db.addToSyncQueue(type, id, 'update', data);
        
        // Si en ligne, synchroniser après un délai
        const isOnline = navigator.onLine;
        if (isOnline && !SyncState.isSyncing) {
            // Grouper les synchronisations
            clearTimeout(SyncState.syncTimeout);
            SyncState.syncTimeout = setTimeout(() => {
                syncLessonProgress();
            }, 5000);
        }
        
    } catch (error) {
        console.error(`[Sync] Erreur lors de l'ajout à la file de sync:`, error);
    }
}

// Ajouter une file de synchronisation persistante
async function queueSyncItem(type, id, action, data) {
    // Sauvegarder dans la base locale
    await window.electronAPI.db.addToSyncQueue(type, id, action, data);
    
    // Tenter de synchroniser si en ligne
    const isOnline = navigator.onLine;
    if (isOnline && !SyncState.isSyncing) {
        // Synchroniser après un délai pour grouper les actions
        clearTimeout(SyncState.syncTimeout);
        SyncState.syncTimeout = setTimeout(() => {
            syncLessonProgress();
        }, 5000);
    }
}

// Obtenir le statut de synchronisation
function getSyncStatus() {
    return {
        isSyncing: SyncState.isSyncing,
        lastSync: SyncState.lastSync,
        pendingCount: SyncState.pendingSync.size,
        errors: SyncState.syncErrors
    };
}

// Synchroniser les médias téléchargés
async function syncDownloadedMedia(courseId) {
    try {
        // getMediaByLesson n'existe pas, mais on peut utiliser d'autres méthodes
        console.log('[Sync] Synchronisation des médias pour le cours', courseId);
        
        // Pour l'instant, on skip cette partie
        return;
        
    } catch (error) {
        console.error('[Sync] Erreur sync médias:', error);
    }
}

// Fonctions globales pour les boutons
window.showUpdateManager = function() {
    if (window.showInfo) {
        window.showInfo('Gestionnaire de mises à jour en développement');
    } else {
        alert('Gestionnaire de mises à jour en développement');
    }
};

window.dismissUpdateNotification = function() {
    const notification = document.querySelector('.update-notification');
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }
};

// Exports pour utilisation globale
window.syncManager = {
    performFullSync,
    startAutoSync,
    stopAutoSync,
    syncItem,
    queueSyncItem,
    getSyncStatus,
    initializeSync,
    syncDownloadedMedia
};

// Styles CSS pour la synchronisation
const syncStyles = `
<style>
.sync-progress {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--bg-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    padding: 20px;
    min-width: 300px;
    transform: translateY(150%);
    transition: transform 0.3s;
    z-index: 1000;
}

.sync-progress.show {
    transform: translateY(0);
}

.sync-progress-content p {
    margin: 0 0 10px;
    font-weight: 500;
}

.progress-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 5px;
}

.progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s ease;
}

.progress-text {
    font-size: 12px;
    color: var(--text-secondary);
}

.update-notification {
    position: fixed;
    top: 80px;
    right: 20px;
    background: var(--bg-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    padding: 20px;
    max-width: 400px;
    transform: translateX(450px);
    transition: transform 0.3s;
    z-index: 999;
}

.update-notification.show {
    transform: translateX(0);
}

.update-notification h4 {
    margin: 0 0 10px;
    color: var(--primary-color);
}

.update-notification ul {
    margin: 10px 0 15px 20px;
    font-size: 13px;
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

// Injecter les styles au chargement
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        document.head.insertAdjacentHTML('beforeend', syncStyles);
    });
} else {
    document.head.insertAdjacentHTML('beforeend', syncStyles);
}

// Initialiser au chargement
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[Sync] Document prêt, initialisation du module sync');
        initializeSync();
    });
} else {
    console.log('[Sync] Document déjà chargé, initialisation immédiate');
    initializeSync();
}