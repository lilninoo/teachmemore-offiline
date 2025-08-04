// src/js/state-manager.js
class StateManager {
    constructor() {
        this.state = {
            courses: {
                downloaded: new Map(),
                available: new Map(),
                downloading: new Map()
            },
            lastSync: null,
            syncInterval: null
        };
        
        this.listeners = new Map();
        this.refreshInterval = 5000; // 5 secondes
    }
    
    // Initialiser l'état depuis la DB locale
    async initialize() {
        console.log('[StateManager] Initialisation...');
        
        try {
            // Charger les cours depuis la DB
            await this.loadLocalCourses();
            
            // Démarrer l'actualisation automatique
            this.startAutoRefresh();
            
            // Émettre l'événement d'initialisation
            this.emit('initialized', this.state);
            
        } catch (error) {
            console.error('[StateManager] Erreur initialisation:', error);
        }
    }
    
    // Charger les cours locaux
    async loadLocalCourses() {
        const result = await window.electronAPI.db.getAllCourses();
        
        if (result.success && result.result) {
            this.state.courses.downloaded.clear();
            
            for (const course of result.result) {
                this.state.courses.downloaded.set(course.course_id, {
                    ...course,
                    isDownloaded: true,
                    localPath: course.local_path,
                    lastModified: course.updated_at
                });
            }
            
            console.log(`[StateManager] ${this.state.courses.downloaded.size} cours chargés`);
        }
    }
    
    // Actualisation automatique
    startAutoRefresh() {
        if (this.state.syncInterval) {
            clearInterval(this.state.syncInterval);
        }
        
        this.state.syncInterval = setInterval(() => {
            this.refreshState();
        }, this.refreshInterval);
        
        console.log('[StateManager] Auto-refresh démarré');
    }
    
    // Rafraîchir l'état
    async refreshState() {
        const previousCount = this.state.courses.downloaded.size;
        
        await this.loadLocalCourses();
        
        const currentCount = this.state.courses.downloaded.size;
        
        if (previousCount !== currentCount) {
            console.log(`[StateManager] Changement détecté: ${previousCount} -> ${currentCount}`);
            this.emit('courses-updated', {
                previous: previousCount,
                current: currentCount,
                courses: Array.from(this.state.courses.downloaded.values())
            });
        }
        
        this.state.lastSync = Date.now();
    }
    
    // Vérifier si un cours est déjà téléchargé
    isCourseDownloaded(courseId) {
        return this.state.courses.downloaded.has(String(courseId));
    }
    
    // Obtenir un cours téléchargé
    getDownloadedCourse(courseId) {
        return this.state.courses.downloaded.get(String(courseId));
    }
    
    // Ajouter un cours téléchargé
    addDownloadedCourse(course) {
        this.state.courses.downloaded.set(String(course.course_id), {
            ...course,
            isDownloaded: true,
            downloadedAt: new Date().toISOString()
        });
        
        this.emit('course-added', course);
        this.emit('courses-updated', {
            courses: Array.from(this.state.courses.downloaded.values())
        });
    }
    
    // Supprimer un cours
    removeCourse(courseId) {
        const course = this.state.courses.downloaded.get(String(courseId));
        if (course) {
            this.state.courses.downloaded.delete(String(courseId));
            this.emit('course-removed', course);
            this.emit('courses-updated', {
                courses: Array.from(this.state.courses.downloaded.values())
            });
        }
    }
    
    // Obtenir tous les cours téléchargés
    getAllDownloadedCourses() {
        return Array.from(this.state.courses.downloaded.values());
    }
    
    // Vérifier si une leçon a des médias locaux
    async hasLocalMedia(lessonId) {
        try {
            const result = await window.electronAPI.db.getMediaByLesson(lessonId);
            return result && result.length > 0;
        } catch (error) {
            console.error('[StateManager] Erreur vérification média:', error);
            return false;
        }
    }
    
    // Système d'événements
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[StateManager] Erreur callback ${event}:`, error);
                }
            });
        }
    }
    
    // Nettoyer
    destroy() {
        if (this.state.syncInterval) {
            clearInterval(this.state.syncInterval);
        }
        this.listeners.clear();
    }
}

// Créer une instance globale
window.stateManager = new StateManager();