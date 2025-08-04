// lib/cache-manager.js - Gestionnaire de cache intelligent avec limite de taille
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class CacheManager {
    constructor(database, maxCacheSize = 2 * 1024 * 1024 * 1024) { // 2GB par défaut
        this.db = database;
        this.maxCacheSize = maxCacheSize;
        this.cacheDir = null;
        this.cacheIndex = new Map();
        this.accessFrequency = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = 3600000; // 1 heure
    }
    
    async initialize(userDataPath) {
        try {
            this.cacheDir = path.join(userDataPath, 'cache');
            await fs.mkdir(this.cacheDir, { recursive: true });
            
            // Charger l'index du cache depuis la DB
            await this.loadCacheIndex();
            
            // Démarrer le nettoyage automatique
            this.startAutoCleanup();
            
            console.log('[CacheManager] Initialisé avec limite:', this.formatSize(this.maxCacheSize));
            
        } catch (error) {
            console.error('[CacheManager] Erreur d\'initialisation:', error);
            throw error;
        }
    }
    
    // Mettre en cache un fichier média
    async cacheMedia(mediaId, originalPath, metadata = {}) {
        try {
            const cacheKey = this.generateCacheKey(mediaId);
            const cachePath = path.join(this.cacheDir, cacheKey);
            
            // Vérifier si déjà en cache
            if (await this.isInCache(mediaId)) {
                this.updateAccessTime(mediaId);
                return cachePath;
            }
            
            // Obtenir la taille du fichier
            const stats = await fs.stat(originalPath);
            const fileSize = stats.size;
            
            // Vérifier l'espace disponible
            const currentSize = await this.getCacheSize();
            if (currentSize + fileSize > this.maxCacheSize) {
                await this.makeSpace(fileSize);
            }
            
            // Copier le fichier dans le cache
            await fs.copyFile(originalPath, cachePath);
            
            // Enregistrer dans l'index
            const cacheEntry = {
                media_id: mediaId,
                cache_key: cacheKey,
                original_path: originalPath,
                file_size: fileSize,
                mime_type: metadata.mimeType || 'application/octet-stream',
                created_at: new Date().toISOString(),
                last_accessed: new Date().toISOString(),
                access_count: 1,
                priority: metadata.priority || 5,
                course_id: metadata.courseId,
                lesson_id: metadata.lessonId
            };
            
            await this.saveCacheEntry(cacheEntry);
            this.cacheIndex.set(mediaId, cacheEntry);
            
            console.log(`[CacheManager] Fichier mis en cache: ${mediaId} (${this.formatSize(fileSize)})`);
            
            return cachePath;
            
        } catch (error) {
            console.error('[CacheManager] Erreur lors de la mise en cache:', error);
            throw error;
        }
    }
    
    // Récupérer un fichier du cache
    async getFromCache(mediaId) {
        try {
            const entry = this.cacheIndex.get(mediaId);
            if (!entry) {
                return null;
            }
            
            const cachePath = path.join(this.cacheDir, entry.cache_key);
            
            // Vérifier que le fichier existe
            try {
                await fs.access(cachePath);
            } catch {
                // Le fichier n'existe plus, nettoyer l'entrée
                await this.removeCacheEntry(mediaId);
                return null;
            }
            
            // Mettre à jour les statistiques d'accès
            this.updateAccessTime(mediaId);
            
            return cachePath;
            
        } catch (error) {
            console.error('[CacheManager] Erreur lors de la récupération:', error);
            return null;
        }
    }
    
    // Vérifier si un fichier est en cache
    async isInCache(mediaId) {
        if (!this.cacheIndex.has(mediaId)) {
            return false;
        }
        
        const entry = this.cacheIndex.get(mediaId);
        const cachePath = path.join(this.cacheDir, entry.cache_key);
        
        try {
            await fs.access(cachePath);
            return true;
        } catch {
            // Le fichier n'existe plus
            await this.removeCacheEntry(mediaId);
            return false;
        }
    }
    
    // Algorithme LRU (Least Recently Used) pour libérer de l'espace
    async makeSpace(requiredSize) {
        console.log(`[CacheManager] Libération de ${this.formatSize(requiredSize)} d'espace...`);
        
        let freedSpace = 0;
        const currentSize = await this.getCacheSize();
        const targetSize = Math.max(0, this.maxCacheSize - requiredSize);
        
        // Obtenir les entrées triées par dernière utilisation (plus ancien en premier)
        const sortedEntries = Array.from(this.cacheIndex.values())
            .sort((a, b) => {
                // Prioriser par score composite (accès, priorité, date)
                const scoreA = this.calculateEvictionScore(a);
                const scoreB = this.calculateEvictionScore(b);
                return scoreA - scoreB;
            });
        
        // Supprimer les fichiers jusqu'à avoir assez d'espace
        for (const entry of sortedEntries) {
            if (currentSize - freedSpace <= targetSize) {
                break;
            }
            
            try {
                const cachePath = path.join(this.cacheDir, entry.cache_key);
                await fs.unlink(cachePath);
                await this.removeCacheEntry(entry.media_id);
                
                freedSpace += entry.file_size;
                console.log(`[CacheManager] Supprimé du cache: ${entry.media_id} (${this.formatSize(entry.file_size)})`);
                
            } catch (error) {
                console.error('[CacheManager] Erreur lors de la suppression:', error);
            }
        }
        
        console.log(`[CacheManager] Espace libéré: ${this.formatSize(freedSpace)}`);
    }
    
    // Calculer un score d'éviction (plus bas = éviction prioritaire)
    calculateEvictionScore(entry) {
        const now = Date.now();
        const lastAccessed = new Date(entry.last_accessed).getTime();
        const age = now - lastAccessed;
        
        // Facteurs du score :
        // - Temps depuis le dernier accès (plus important)
        // - Nombre d'accès
        // - Priorité du contenu
        // - Taille du fichier (favoriser la suppression des gros fichiers)
        
        const ageScore = age / (1000 * 60 * 60); // Heures depuis le dernier accès
        const accessScore = entry.access_count * 10;
        const priorityScore = entry.priority * 100;
        const sizeScore = (entry.file_size / (1024 * 1024)) * 0.1; // MB * 0.1
        
        return priorityScore + accessScore - ageScore - sizeScore;
    }
    
    // Mettre à jour le temps d'accès
    async updateAccessTime(mediaId) {
        const entry = this.cacheIndex.get(mediaId);
        if (!entry) return;
        
        entry.last_accessed = new Date().toISOString();
        entry.access_count = (entry.access_count || 0) + 1;
        
        // Mettre à jour dans la DB
        try {
            await this.db.db.prepare(`
                UPDATE media_cache 
                SET last_accessed = ?, access_count = ?
                WHERE media_id = ?
            `).run(entry.last_accessed, entry.access_count, mediaId);
        } catch (error) {
            console.error('[CacheManager] Erreur mise à jour accès:', error);
        }
    }
    
    // Obtenir la taille totale du cache
    async getCacheSize() {
        let totalSize = 0;
        
        for (const entry of this.cacheIndex.values()) {
            totalSize += entry.file_size || 0;
        }
        
        return totalSize;
    }
    
    // Charger l'index du cache depuis la DB
    async loadCacheIndex() {
        try {
            // Créer la table si elle n'existe pas
            this.db.db.exec(`
                CREATE TABLE IF NOT EXISTS media_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    media_id TEXT UNIQUE NOT NULL,
                    cache_key TEXT NOT NULL,
                    original_path TEXT,
                    file_size INTEGER,
                    mime_type TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
                    access_count INTEGER DEFAULT 1,
                    priority INTEGER DEFAULT 5,
                    course_id INTEGER,
                    lesson_id INTEGER,
                    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
                    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
                )
            `);
            
            // Créer les index
            this.db.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_cache_media ON media_cache(media_id);
                CREATE INDEX IF NOT EXISTS idx_cache_accessed ON media_cache(last_accessed);
                CREATE INDEX IF NOT EXISTS idx_cache_course ON media_cache(course_id);
            `);
            
            // Charger les entrées
            const entries = this.db.db.prepare('SELECT * FROM media_cache').all();
            
            // Vérifier que les fichiers existent toujours
            for (const entry of entries) {
                const cachePath = path.join(this.cacheDir, entry.cache_key);
                
                try {
                    await fs.access(cachePath);
                    this.cacheIndex.set(entry.media_id, entry);
                } catch {
                    // Fichier manquant, nettoyer l'entrée
                    await this.removeCacheEntry(entry.media_id);
                }
            }
            
            const cacheSize = await this.getCacheSize();
            console.log(`[CacheManager] Index chargé: ${this.cacheIndex.size} fichiers, ${this.formatSize(cacheSize)}`);
            
        } catch (error) {
            console.error('[CacheManager] Erreur lors du chargement de l\'index:', error);
        }
    }
    
    // Sauvegarder une entrée de cache
    async saveCacheEntry(entry) {
        try {
            this.db.db.prepare(`
                INSERT OR REPLACE INTO media_cache (
                    media_id, cache_key, original_path, file_size,
                    mime_type, created_at, last_accessed, access_count,
                    priority, course_id, lesson_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                entry.media_id,
                entry.cache_key,
                entry.original_path,
                entry.file_size,
                entry.mime_type,
                entry.created_at,
                entry.last_accessed,
                entry.access_count,
                entry.priority,
                entry.course_id,
                entry.lesson_id
            );
        } catch (error) {
            console.error('[CacheManager] Erreur sauvegarde entrée:', error);
        }
    }
    
    // Supprimer une entrée de cache
    async removeCacheEntry(mediaId) {
        try {
            this.cacheIndex.delete(mediaId);
            
            this.db.db.prepare('DELETE FROM media_cache WHERE media_id = ?').run(mediaId);
            
        } catch (error) {
            console.error('[CacheManager] Erreur suppression entrée:', error);
        }
    }
    
    // Nettoyer le cache des fichiers orphelins
    async cleanupOrphanFiles() {
        try {
            const files = await fs.readdir(this.cacheDir);
            const validKeys = new Set(Array.from(this.cacheIndex.values()).map(e => e.cache_key));
            
            let cleanedCount = 0;
            let cleanedSize = 0;
            
            for (const file of files) {
                if (!validKeys.has(file)) {
                    const filePath = path.join(this.cacheDir, file);
                    
                    try {
                        const stats = await fs.stat(filePath);
                        await fs.unlink(filePath);
                        
                        cleanedCount++;
                        cleanedSize += stats.size;
                        
                    } catch (error) {
                        console.error(`[CacheManager] Erreur suppression ${file}:`, error);
                    }
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`[CacheManager] Nettoyage: ${cleanedCount} fichiers orphelins (${this.formatSize(cleanedSize)})`);
            }
            
        } catch (error) {
            console.error('[CacheManager] Erreur nettoyage orphelins:', error);
        }
    }
    
    // Nettoyer le cache des cours supprimés
    async cleanupDeletedCourses() {
        try {
            // Obtenir la liste des cours valides
            const courses = this.db.getAllCourses();
            const validCourseIds = new Set(courses.map(c => c.course_id));
            
            // Supprimer les entrées de cache pour les cours supprimés
            for (const [mediaId, entry] of this.cacheIndex) {
                if (entry.course_id && !validCourseIds.has(entry.course_id)) {
                    const cachePath = path.join(this.cacheDir, entry.cache_key);
                    
                    try {
                        await fs.unlink(cachePath);
                        await this.removeCacheEntry(mediaId);
                        
                        console.log(`[CacheManager] Supprimé cache du cours ${entry.course_id}`);
                        
                    } catch (error) {
                        console.error('[CacheManager] Erreur suppression:', error);
                    }
                }
            }
            
        } catch (error) {
            console.error('[CacheManager] Erreur nettoyage cours supprimés:', error);
        }
    }
    
    // Précharger les médias d'une leçon
    async preloadLessonMedia(lessonId) {
        try {
            const mediaList = this.db.getMediaByLesson(lessonId);
            
            for (const media of mediaList) {
                if (!await this.isInCache(media.media_id)) {
                    // Décrypter le chemin
                    const decryptedPath = this.db.encryption.decrypt(
                        media.path_encrypted,
                        this.db.encryptionKey
                    );
                    
                    await this.cacheMedia(media.media_id, decryptedPath, {
                        mimeType: media.mime_type,
                        priority: 8, // Priorité élevée pour le préchargement
                        courseId: media.course_id,
                        lessonId: media.lesson_id
                    });
                }
            }
            
        } catch (error) {
            console.error('[CacheManager] Erreur préchargement:', error);
        }
    }
    
    // Optimiser le cache (défragmentation)
    async optimizeCache() {
        console.log('[CacheManager] Début de l\'optimisation du cache...');
        
        try {
            // 1. Nettoyer les fichiers orphelins
            await this.cleanupOrphanFiles();
            
            // 2. Nettoyer les cours supprimés
            await this.cleanupDeletedCourses();
            
            // 3. Supprimer les entrées expirées (> 30 jours sans accès)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            
            for (const [mediaId, entry] of this.cacheIndex) {
                if (entry.last_accessed < thirtyDaysAgo && entry.priority < 7) {
                    const cachePath = path.join(this.cacheDir, entry.cache_key);
                    
                    try {
                        await fs.unlink(cachePath);
                        await this.removeCacheEntry(mediaId);
                        
                        console.log(`[CacheManager] Supprimé entrée expirée: ${mediaId}`);
                        
                    } catch (error) {
                        console.error('[CacheManager] Erreur suppression expirée:', error);
                    }
                }
            }
            
            // 4. Afficher les statistiques
            const cacheSize = await this.getCacheSize();
            console.log(`[CacheManager] Optimisation terminée: ${this.cacheIndex.size} fichiers, ${this.formatSize(cacheSize)}`);
            
        } catch (error) {
            console.error('[CacheManager] Erreur optimisation:', error);
        }
    }
    
    // Démarrer le nettoyage automatique
    startAutoCleanup() {
        setInterval(async () => {
            const now = Date.now();
            
            if (now - this.lastCleanup > this.cleanupInterval) {
                this.lastCleanup = now;
                await this.optimizeCache();
            }
        }, 60000); // Vérifier toutes les minutes
    }
    
    // Obtenir les statistiques du cache
    async getStats() {
        const cacheSize = await this.getCacheSize();
        const usage = (cacheSize / this.maxCacheSize) * 100;
        
        // Statistiques par type de fichier
        const statsByType = {};
        for (const entry of this.cacheIndex.values()) {
            const type = this.getMediaType(entry.mime_type);
            if (!statsByType[type]) {
                statsByType[type] = { count: 0, size: 0 };
            }
            statsByType[type].count++;
            statsByType[type].size += entry.file_size;
        }
        
        return {
            totalFiles: this.cacheIndex.size,
            totalSize: cacheSize,
            maxSize: this.maxCacheSize,
            usage: usage.toFixed(2) + '%',
            statsByType,
            oldestEntry: this.getOldestEntry(),
            mostAccessed: this.getMostAccessedEntry()
        };
    }
    
    // Obtenir l'entrée la plus ancienne
    getOldestEntry() {
        let oldest = null;
        
        for (const entry of this.cacheIndex.values()) {
            if (!oldest || entry.last_accessed < oldest.last_accessed) {
                oldest = entry;
            }
        }
        
        return oldest;
    }
    
    // Obtenir l'entrée la plus accédée
    getMostAccessedEntry() {
        let mostAccessed = null;
        
        for (const entry of this.cacheIndex.values()) {
            if (!mostAccessed || entry.access_count > mostAccessed.access_count) {
                mostAccessed = entry;
            }
        }
        
        return mostAccessed;
    }
    
    // Générer une clé de cache unique
    generateCacheKey(mediaId) {
        const hash = crypto.createHash('sha256');
        hash.update(mediaId);
        return hash.digest('hex').substring(0, 16);
    }
    
    // Obtenir le type de média
    getMediaType(mimeType) {
        if (!mimeType) return 'other';
        
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.includes('pdf')) return 'pdf';
        if (mimeType.includes('document')) return 'document';
        
        return 'other';
    }
    
    // Formater la taille
    formatSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    // Vider complètement le cache
    async clearCache() {
        try {
            console.log('[CacheManager] Vidage complet du cache...');
            
            // Supprimer tous les fichiers
            for (const entry of this.cacheIndex.values()) {
                const cachePath = path.join(this.cacheDir, entry.cache_key);
                
                try {
                    await fs.unlink(cachePath);
                } catch (error) {
                    console.error(`[CacheManager] Erreur suppression ${entry.cache_key}:`, error);
                }
            }
            
            // Vider l'index
            this.cacheIndex.clear();
            
            // Vider la table
            this.db.db.prepare('DELETE FROM media_cache').run();
            
            console.log('[CacheManager] Cache vidé');
            
        } catch (error) {
            console.error('[CacheManager] Erreur vidage cache:', error);
        }
    }
    
    // Définir la limite du cache
    setMaxCacheSize(sizeInBytes) {
        this.maxCacheSize = sizeInBytes;
        console.log(`[CacheManager] Nouvelle limite: ${this.formatSize(sizeInBytes)}`);
    }
}

module.exports = CacheManager;