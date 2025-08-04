// sync.js - Module de synchronisation avec le serveur

// État de la synchronisation
const SyncState = {
    isSyncing: false,
    lastSync: null,
    pendingSync: new Set(),
    syncErrors: []
};

// Initialiser la synchronisation
async function initializeSync() {
    // Charger la dernière date de synchronisation
    SyncState.lastSync = await window.electronAPI.store.get('lastSync');
    
    // Démarrer la synchronisation automatique si activée
    const autoSync = await window.electronAPI.store.get('autoSync');
    if (autoSync) {
        startAutoSync();
    }
    
    // Écouter les changements de connexion
    window.addEventListener('online', onConnectionRestored);
    window.addEventListener('offline', onConnectionLost);
}

// Synchronisation complète
async function performFullSync() {
    if (SyncState.isSyncing) {
        console.log('Synchronisation déjà en cours');
        return { success: false, error: 'Synchronisation déjà en cours' };
    }
    
    SyncState.isSyncing = true;
    showSyncProgress('Synchronisation en cours...', 0);
    
    try {
        // 1. Vérifier la connexion
        const isOnline = await window.electronAPI.checkInternet();
        if (!isOnline) {
            throw new Error('Aucune connexion internet');
        }
        
        // 2. Synchroniser la progression des leçons
        showSyncProgress('Synchronisation de la progression...', 20);
        await syncLessonProgress();
        
        // 3. Synchroniser les quiz
        showSyncProgress('Synchronisation des quiz...', 40);
        await syncQuizResults();
        
        // 4. Vérifier les mises à jour des cours
        showSyncProgress('Vérification des mises à jour...', 60);
        await checkCourseUpdates();
        
        // 5. Nettoyer les cours expirés
        showSyncProgress('Nettoyage des données...', 80);
        await cleanupExpiredContent();
        
        // 6. Mettre à jour la date de dernière sync
        SyncState.lastSync = new Date().toISOString();
        await window.electronAPI.store.set('lastSync', SyncState.lastSync);
        
        showSyncProgress('Synchronisation terminée !', 100);
        
        setTimeout(() => {
            hideSyncProgress();
        }, 2000);
        
        return { success: true };
        
    } catch (error) {
        console.error('Erreur lors de la synchronisation:', error);
        SyncState.syncErrors.push({
            timestamp: new Date().toISOString(),
            error: error.message
        });
        
        showError(`Erreur de synchronisation: ${error.message}`);
        hideSyncProgress();
        
        return { success: false, error: error.message };
        
    } finally {
        SyncState.isSyncing = false;
    }
}

// Synchroniser la progression des leçons
async function syncLessonProgress() {
    try {
        // Récupérer les éléments non synchronisés
        const unsyncedItems = await window.electronAPI.db.getUnsyncedItems();
        
        if (unsyncedItems.length === 0) {
            console.log('Aucune progression à synchroniser');
            return;
        }
        
        // Grouper par type d'action
        const progressData = {
            lessons: [],
            quizzes: [],
            courses: []
        };
        
        unsyncedItems.forEach(item => {
            const data = {
                id: item.entity_id,
                action: item.action,
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
        
        // Envoyer au serveur
        const result = await window.electronAPI.api.syncProgress(progressData);
        
        if (result.success) {
            // Marquer comme synchronisés
            const syncIds = unsyncedItems.map(item => item.id);
            await window.electronAPI.db.markAsSynced(syncIds);
            
            console.log(`${syncIds.length} éléments synchronisés avec succès`);
        } else {
            throw new Error(result.error || 'Échec de la synchronisation');
        }
        
    } catch (error) {
        console.error('Erreur lors de la synchronisation de la progression:', error);
        throw error;
    }
}

// Synchroniser les résultats des quiz
async function syncQuizResults() {
    try {
        // Récupérer tous les quiz avec des tentatives
        const courses = await window.electronAPI.db.getAllCourses();
        const quizAttempts = [];
        
        for (const course of courses) {
            const sections = await window.electronAPI.db.getSections(course.course_id);
            
            for (const section of sections) {
                const lessons = await window.electronAPI.db.getLessons(section.section_id);
                
                for (const lesson of lessons) {
                    if (lesson.type === 'quiz') {
                        const quiz = await window.electronAPI.db.getQuiz(lesson.lesson_id);
                        if (quiz && quiz.attempts > 0) {
                            quizAttempts.push({
                                quiz_id: quiz.quiz_id,
                                lesson_id: lesson.lesson_id,
                                score: quiz.score,
                                attempts: quiz.attempts,
                                last_attempt: quiz.last_attempt
                            });
                        }
                    }
                }
            }
        }
        
        if (quizAttempts.length > 0) {
            // Envoyer les résultats au serveur
            const result = await window.electronAPI.api.syncProgress({
                quiz_results: quizAttempts
            });
            
            if (result.success) {
                console.log(`${quizAttempts.length} résultats de quiz synchronisés`);
            }
        }
        
    } catch (error) {
        console.error('Erreur lors de la synchronisation des quiz:', error);
        // Ne pas propager l'erreur pour ne pas bloquer la sync complète
    }
}

// Vérifier les mises à jour des cours
async function checkCourseUpdates() {
    try {
        // Récupérer la liste des cours du serveur
        const result = await window.electronAPI.api.getCourses(1, 100);
        
        if (!result.success) {
            throw new Error(result.error || 'Impossible de récupérer les cours');
        }
        
        const serverCourses = result.courses;
        const localCourses = await window.electronAPI.db.getAllCourses();
        
        // Créer un map pour comparaison rapide
        const localCoursesMap = new Map(
            localCourses.map(c => [c.course_id, c])
        );
        
        const updates = [];
        
        // Vérifier les mises à jour
        for (const serverCourse of serverCourses) {
            const localCourse = localCoursesMap.get(serverCourse.id);
            
            if (localCourse) {
                // Comparer les versions ou checksums
                if (serverCourse.version > (localCourse.version || 0)) {
                    updates.push({
                        course_id: serverCourse.id,
                        title: serverCourse.title,
                        type: 'update',
                        new_version: serverCourse.version
                    });
                }
            }
        }
        
        // Notifier l'utilisateur des mises à jour disponibles
        if (updates.length > 0) {
            showUpdateNotification(updates);
        }
        
    } catch (error) {
        console.error('Erreur lors de la vérification des mises à jour:', error);
        throw error;
    }
}

// Nettoyer le contenu expiré
async function cleanupExpiredContent() {
    try {
        const expiredCourses = await window.electronAPI.db.getExpiredCourses();
        
        if (expiredCourses.length > 0) {
            console.log(`${expiredCourses.length} cours expirés trouvés`);
            
            // Demander confirmation à l'utilisateur
            const confirmCleanup = await showCleanupConfirmation(expiredCourses);
            
            if (confirmCleanup) {
                for (const course of expiredCourses) {
                    await window.electronAPI.db.deleteCourse(course.course_id);
                }
                
                showSuccess(`${expiredCourses.length} cours expirés supprimés`);
            }
        }
        
        // Nettoyer aussi les entrées de synchronisation anciennes
        await window.electronAPI.db.cleanupExpiredData();
        
    } catch (error) {
        console.error('Erreur lors du nettoyage:', error);
        // Ne pas propager l'erreur
    }
}

// Synchronisation automatique
let autoSyncInterval = null;

function startAutoSync() {
    // Synchroniser toutes les 30 minutes
    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    stopAutoSync(); // Arrêter l'ancienne instance si elle existe
    
    autoSyncInterval = setInterval(async () => {
        const isOnline = await window.electronAPI.checkInternet();
        if (isOnline && !SyncState.isSyncing) {
            console.log('Démarrage de la synchronisation automatique');
            performFullSync();
        }
    }, SYNC_INTERVAL);
    
    console.log('Synchronisation automatique activée');
}

function stopAutoSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
        console.log('Synchronisation automatique désactivée');
    }
}

// Gestion de la connexion
function onConnectionRestored() {
    console.log('Connexion internet rétablie');
    showInfo('Connexion rétablie - Synchronisation en cours...');
    
    // Attendre 5 secondes avant de synchroniser
    setTimeout(() => {
        performFullSync();
    }, 5000);
}

function onConnectionLost() {
    console.log('Connexion internet perdue');
    showWarning('Mode hors ligne - Les modifications seront synchronisées ultérieurement');
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
                    `<li>${u.title} (v${u.new_version})</li>`
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
}

// Synchroniser un élément spécifique
async function syncItem(type, id, data) {
    try {
        SyncState.pendingSync.add(`${type}-${id}`);
        
        // Ajouter à la file de synchronisation
        await window.electronAPI.db.addToSyncQueue(type, id, 'update');
        
        // Si en ligne, synchroniser immédiatement
        const isOnline = await window.electronAPI.checkInternet();
        if (isOnline && !SyncState.isSyncing) {
            setTimeout(() => {
                syncLessonProgress();
            }, 1000);
        }
        
    } catch (error) {
        console.error(`Erreur lors de l'ajout à la file de sync:`, error);
    }
}


// Ajouter une file de synchronisation persistante
async function queueSyncItem(type, id, action, data) {
    // Sauvegarder dans la base locale
    await window.electronAPI.db.addToSyncQueue(type, id, action, data);
    
    // Tenter de synchroniser si en ligne
    const isOnline = await window.electronAPI.checkInternet();
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

// Exports pour utilisation globale
window.syncManager = {
    performFullSync,
    startAutoSync,
    stopAutoSync,
    syncItem,
    getSyncStatus,
    initializeSync
};

// Fonctions globales pour les boutons
window.showUpdateManager = function() {
    showMessage('Gestionnaire de mises à jour en développement', 'info');
};

window.dismissUpdateNotification = function() {
    const notification = document.querySelector('.update-notification');
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }
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
</style>
`;

document.head.insertAdjacentHTML('beforeend', syncStyles);

// Initialiser au chargement
document.addEventListener('DOMContentLoaded', () => {
    initializeSync();
});


class OfflineMode {
    constructor() {
        this.isOffline = false;
        this.pendingActions = [];
    }
    
    enableOfflineMode() {
        this.isOffline = true;
        this.disableOnlineFeatures();
    }

    disableOnlineFeatures() {
        // À implémenter : désactiver les boutons ou fonctionnalités online
    }
    
    queueAction(action) {
        this.pendingActions.push({
            ...action,
            timestamp: Date.now()
        });
    }
    
    async syncPendingActions() {
        // Synchroniser quand la connexion revient
    }
}

