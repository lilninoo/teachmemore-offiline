// database/index.js - SecureDatabase with modular organization
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const encryption = require('../encryption');
const { createTables, setupTriggers } = require('./schema');
const { migrate } = require('./migrations');
const { prepareStatements, prepareMediaStatements } = require('./statements');

class SecureDatabase {
    constructor(dbPath, encryptionKey) {
        this.dbPath = dbPath;
        this.encryptionKey = encryptionKey;
        this.db = null;
        this.encryption = encryption;
        this.isInitialized = false;
        this.transactionLevel = 0;
        
        // Cache pour améliorer les performances
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute
        
        // Créer le dossier si nécessaire
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.init();
    }
    
    init() {
        try {
            console.log('Initialisation de la base de données:', this.dbPath);
            
            // Configuration optimisée pour better-sqlite3
            const options = {
                verbose: process.env.NODE_ENV === 'development' ? console.log : null,
                fileMustExist: false,
                timeout: 10000,
            };
            
            this.db = new Database(this.dbPath, options);
            
            // Configuration de performance
            this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging
            this.db.pragma('cache_size = 10000'); // 10MB cache
            this.db.pragma('temp_store = memory');
            this.db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
            this.db.pragma('optimize'); // Optimiser au démarrage
            
            // Activer les foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // Vérifier l'intégrité de la DB
            this.checkIntegrity();
            
            // Créer les tables
            const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
            createTables(this.db, schemaPath);
            
            // Préparer les statements fréquemment utilisés
            this.statements = prepareStatements(this.db);
            this.mediaStatements = prepareMediaStatements(this.db);
            
            // Configurer les triggers et fonctions personnalisées
            setupTriggers(this.db);
            
            // Migrer si nécessaire
            migrate(this.db, this.transaction.bind(this));
            
            this.isInitialized = true;
            console.log('Base de données initialisée avec succès');
            
        } catch (error) {
            console.error('Erreur lors de l\'initialisation de la DB:', error);
            this.handleDatabaseError(error);
            throw error;
        }
    }
    
    // Vérifier l'intégrité de la base
    checkIntegrity() {
        try {
            const result = this.db.pragma('integrity_check');
            if (result[0]?.integrity_check !== 'ok') {
                console.warn('Problème d\'intégrité détecté:', result);
            }
        } catch (error) {
            console.warn('Impossible de vérifier l\'intégrité:', error);
        }
    }
    
    // Gestion centralisée des erreurs de DB
    handleDatabaseError(error) {
        if (error.code === 'SQLITE_CORRUPT') {
            console.error('Base de données corrompue détectée');
        } else if (error.code === 'SQLITE_BUSY') {
            console.warn('Base de données occupée, retry automatique');
        } else if (error.code === 'SQLITE_LOCKED') {
            console.warn('Base de données verrouillée');
        }
    }
    
    // Wrapper de transaction
    transaction(fn) {
        return this.db.transaction(fn);
    }
    
    // ==================== MÉTHODES PRINCIPALES ====================
    
    // Sauvegarder un cours
    saveCourse(courseData) {
        try {
            console.log('[DB] Sauvegarde du cours:', {
                course_id: courseData.course_id,
                title: courseData.title,
                fields: Object.keys(courseData)
            });
            
            // Vérifier que toutes les données nécessaires sont présentes
            const requiredFields = [
                'course_id', 'title', 'instructor_name', 'sections_count', 
                'lessons_count', 'downloaded_at', 'local_path'
            ];
            
            for (const field of requiredFields) {
                if (courseData[field] === undefined) {
                    console.warn(`[DB] Champ manquant: ${field}`);
                    // Définir une valeur par défaut
                    if (field === 'sections_count' || field === 'lessons_count') {
                        courseData[field] = 0;
                    } else if (field === 'instructor_name') {
                        courseData[field] = 'Instructeur';
                    } else if (field === 'downloaded_at') {
                        courseData[field] = new Date().toISOString();
                    } else if (field === 'local_path') {
                        courseData[field] = '';
                    }
                }
            }
            
            // IMPORTANT: S'assurer que l'ordre des valeurs correspond exactement aux colonnes
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO courses (
                    course_id,
                    title,
                    description,
                    thumbnail_encrypted,
                    instructor_name,
                    instructor_id,
                    sections_count,
                    lessons_count,
                    duration,
                    difficulty_level,
                    category,
                    tags,
                    downloaded_at,
                    last_accessed,
                    local_path,
                    version,
                    expires_at,
                    is_synced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            // Préparer les valeurs dans le bon ordre
            const values = [
                courseData.course_id,
                courseData.title,
                courseData.description || null,
                courseData.thumbnail_encrypted || null,
                courseData.instructor_name,
                courseData.instructor_id || null,
                courseData.sections_count || 0,
                courseData.lessons_count || 0,
                courseData.duration || null,
                courseData.difficulty_level || 'intermediate',
                courseData.category || null,
                JSON.stringify(courseData.tags || []),
                courseData.downloaded_at,
                courseData.last_accessed || new Date().toISOString(),
                courseData.local_path,
                courseData.version || 1,
                courseData.expires_at || null,
                courseData.is_synced !== undefined ? courseData.is_synced : 0
            ];
            
            console.log('[DB] Nombre de colonnes:', 18);
            console.log('[DB] Nombre de valeurs:', values.length);
            console.log('[DB] Valeurs:', values);
            
            const result = stmt.run(...values);
            
            console.log('[DB] Cours sauvegardé avec succès:', {
                courseId: courseData.course_id,
                changes: result.changes
            });
            
            return result.lastInsertRowid;
            
        } catch (error) {
            console.error('[DB] Erreur saveCourse:', error);
            console.error('[DB] CourseData:', courseData);
            throw error;
        }
    }
    
    // Récupérer un cours
    getCourse(courseId) {
        try {
            return this.statements.getCourse.get(courseId);
        } catch (error) {
            console.error('Erreur lors de la récupération du cours:', error);
            throw error;
        }
    }
    
    // Récupérer tous les cours
    getAllCourses() {
        try {
            return this.statements.getAllCourses.all();
        } catch (error) {
            console.error('Erreur lors de la récupération des cours:', error);
            throw error;
        }
    }
    
    // Mettre à jour l'accès au cours
    updateCourseAccess(courseId) {
        try {
            return this.statements.updateCourseAccess.run(courseId);
        } catch (error) {
            console.error('Erreur lors de la mise à jour d\'accès:', error);
            throw error;
        }
    }
    
    // Supprimer un cours
    deleteCourse(courseId) {
        try {
            return this.statements.deleteCourse.run(courseId);
        } catch (error) {
            console.error('Erreur lors de la suppression du cours:', error);
            throw error;
        }
    }
    
    // Sauvegarder une section
    saveSection(sectionData) {
        try {
            console.log('[DB] Sauvegarde de la section:', sectionData);
            
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO sections (
                    section_id,
                    course_id,
                    title,
                    description,
                    order_index,
                    lessons_count,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            const values = [
                sectionData.section_id,
                sectionData.course_id,
                sectionData.title,
                sectionData.description || null,
                sectionData.order_index || 0,
                sectionData.lessons_count || 0,
                sectionData.created_at || new Date().toISOString()
            ];
            
            const result = stmt.run(...values);
            return result.lastInsertRowid;
            
        } catch (error) {
            console.error('[DB] Erreur saveSection:', error);
            throw error;
        }
    }
    
    // Récupérer les sections d'un cours
    getSections(courseId) {
        try {
            return this.statements.getSections.all(courseId);
        } catch (error) {
            console.error('Erreur lors de la récupération des sections:', error);
            throw error;
        }
    }
    
    // Sauvegarder une leçon
    async saveLesson(lesson) {
        const {
            lesson_id,
            section_id,
            title,
            type,
            content_encrypted,
            duration,
            order_index,
            completed,
            completed_at,
            progress,
            last_position,
            preview,
            points,
            attachments,
            difficulty,
            estimated_time,
            views_count,
            notes_count,
            bookmarks,
            created_at,
            updated_at
        } = lesson;

        // 🛡️ Validation de base
        if (!lesson_id || !section_id || !title || typeof order_index !== 'number') {
            throw new Error('Paramètres invalides pour insertion de la leçon.');
        }

        // 🧹 Nettoyage des champs mal formés
        const safeDuration = (typeof duration === 'string' || typeof duration === 'number') ? duration : null;
        const safeAttachments = Array.isArray(attachments) ? JSON.stringify(attachments) : '[]';
        const safeBookmarks = Array.isArray(bookmarks) ? JSON.stringify(bookmarks) : '[]';

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO lessons (
                lesson_id,
                section_id,
                title,
                type,
                content_encrypted,
                duration,
                order_index,
                completed,
                completed_at,
                progress,
                last_position,
                preview,
                points,
                attachments,
                difficulty,
                estimated_time,
                views_count,
                notes_count,
                bookmarks,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            lesson_id,
            section_id,
            title,
            type,
            content_encrypted,
            safeDuration,
            order_index,
            completed,
            completed_at,
            progress,
            last_position,
            preview,
            points,
            safeAttachments,
            difficulty,
            estimated_time,
            views_count,
            notes_count,
            safeBookmarks,
            created_at,
            updated_at
        );
    }
    
    // Récupérer une leçon
    getLesson(lessonId) {
        try {
            return this.statements.getLesson.get(lessonId);
        } catch (error) {
            console.error('Erreur lors de la récupération de la leçon:', error);
            throw error;
        }
    }
    
    // Récupérer les leçons d'une section
    getLessons(sectionId) {
        try {
            return this.statements.getLessons.all(sectionId);
        } catch (error) {
            console.error('Erreur lors de la récupération des leçons:', error);
            throw error;
        }
    }
    
    // Mettre à jour la progression d'une leçon
    updateLessonProgress(lessonId, progress = 0, completed = false) {
        try {
            // Validation minimale pour éviter l'erreur de paramètre manquant
            if (typeof lessonId === 'undefined') {
                throw new Error('lessonId manquant dans updateLessonProgress');
            }

            const completedFlag = completed ? 1 : 0;

            console.log('[DB] updateLessonProgress called with', {
                lessonId,
                progress,
                completed: completedFlag
            });

            return this.statements.updateLessonProgress.run({
                progress: progress,
                completed: completedFlag,
                completed_check: completedFlag,
                lesson_id: lessonId
            });
        } catch (error) {
            console.error('Erreur lors de la mise à jour de progression:', error);
            throw error;
        }
    }

    
    // Sauvegarder un média
    saveMedia(mediaData) {
        try {
            console.log('[DB] Sauvegarde du média:', mediaData);
            
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO media (
                    media_id,
                    course_id,
                    lesson_id,
                    type,
                    filename,
                    original_filename,
                    path_encrypted,
                    size,
                    mime_type,
                    checksum,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const values = [
                mediaData.media_id,
                mediaData.course_id,
                mediaData.lesson_id || null,
                mediaData.type,
                mediaData.filename,
                mediaData.original_filename || mediaData.filename,
                mediaData.path_encrypted,
                mediaData.size || 0,
                mediaData.mime_type || 'application/octet-stream',
                mediaData.checksum || null,
                mediaData.created_at || new Date().toISOString()
            ];
            
            const result = stmt.run(...values);
            return result.lastInsertRowid;
            
        } catch (error) {
            console.error('[DB] Erreur saveMedia:', error);
            throw error;
        }
    }
    
    // Récupérer les médias d'une leçon
    getMediaByLesson(lessonId) {
        try {
            return this.statements.getMediaByLesson.all(lessonId);
        } catch (error) {
            console.error('Erreur lors de la récupération des médias:', error);
            throw error;
        }
    }
    
    // Récupérer les médias d'une leçon avec déchiffrement
    getLessonMedia(lessonId) {
        try {
            console.log('[DB] Récupération des médias pour la leçon:', lessonId);
            
            const stmt = this.db.prepare(`
                SELECT 
                    media_id,
                    lesson_id,
                    course_id,
                    type,
                    filename,
                    original_filename,
                    path_encrypted,
                    url_encrypted,
                    size,
                    mime_type,
                    duration,
                    resolution,
                    checksum,
                    thumbnail_path
                FROM media 
                WHERE lesson_id = ?
                ORDER BY type DESC, filename ASC
            `);
            
            const media = stmt.all(lessonId);
            
            console.log(`[DB] ${media.length} médias trouvés pour la leçon ${lessonId}`);
            
            // Déchiffrer les chemins si l'encryption est disponible
            if (this.encryption && this.encryptionKey) {
                media.forEach(m => {
                    try {
                        if (m.path_encrypted) {
                            m.path = this.encryption.decrypt(m.path_encrypted, this.encryptionKey);
                            console.log(`[DB] Chemin déchiffré pour ${m.filename}:`, m.path);
                        }
                        if (m.url_encrypted) {
                            m.url = this.encryption.decrypt(m.url_encrypted, this.encryptionKey);
                        }
                    } catch (error) {
                        console.error(`[DB] Erreur déchiffrement média ${m.media_id}:`, error);
                    }
                });
            }
            
            return media;
            
        } catch (error) {
            console.error('[DB] Erreur getLessonMedia:', error);
            throw error;
        }
    }
    
    // Récupérer le média principal d'une leçon (vidéo ou document principal)
    getLessonMainMedia(lessonId) {
        try {
            console.log('[DB] Récupération du média principal pour la leçon:', lessonId);
            
            const stmt = this.db.prepare(`
                SELECT 
                    media_id,
                    lesson_id,
                    course_id,
                    type,
                    filename,
                    original_filename,
                    path_encrypted,
                    url_encrypted,
                    size,
                    mime_type,
                    duration,
                    resolution,
                    checksum
                FROM media 
                WHERE lesson_id = ? AND type IN ('video', 'audio', 'document')
                ORDER BY 
                    CASE type 
                        WHEN 'video' THEN 1 
                        WHEN 'audio' THEN 2 
                        WHEN 'document' THEN 3 
                        ELSE 4 
                    END
                LIMIT 1
            `);
            
            const media = stmt.get(lessonId);
            
            if (!media) {
                console.log(`[DB] Aucun média principal trouvé pour la leçon ${lessonId}`);
                return null;
            }
            
            console.log(`[DB] Média principal trouvé:`, {
                type: media.type,
                filename: media.filename,
                hasPath: !!media.path_encrypted
            });
            
            // Déchiffrer le chemin
            if (media.path_encrypted && this.encryption && this.encryptionKey) {
                try {
                    media.path = this.encryption.decrypt(media.path_encrypted, this.encryptionKey);
                    console.log(`[DB] Chemin déchiffré: ${media.path}`);
                } catch (error) {
                    console.error('[DB] Erreur déchiffrement chemin:', error);
                }
            }
            
            if (media.url_encrypted && this.encryption && this.encryptionKey) {
                try {
                    media.url = this.encryption.decrypt(media.url_encrypted, this.encryptionKey);
                } catch (error) {
                    console.error('[DB] Erreur déchiffrement URL:', error);
                }
            }
            
            return media;
            
        } catch (error) {
            console.error('[DB] Erreur getLessonMainMedia:', error);
            throw error;
        }
    }
    
    // Récupérer une leçon avec ses médias
    getLessonWithMedia(lessonId) {
        try {
            console.log('[DB] Récupération de la leçon avec médias:', lessonId);
            
            // Récupérer la leçon
            const lesson = this.getLesson(lessonId);
            if (!lesson) {
                return null;
            }
            
            // Déchiffrer le contenu si nécessaire
            if (lesson.content_encrypted && this.encryption && this.encryptionKey) {
                try {
                    const decrypted = this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey);
                    lesson.content = JSON.parse(decrypted);
                } catch (error) {
                    console.error('[DB] Erreur déchiffrement contenu:', error);
                    lesson.content = null;
                }
            }
            
            // Parser les attachments
            if (lesson.attachments) {
                try {
                    lesson.attachments = JSON.parse(lesson.attachments);
                } catch (error) {
                    console.error('[DB] Erreur parsing attachments:', error);
                    lesson.attachments = [];
                }
            } else {
                lesson.attachments = [];
            }
            
            // Parser les bookmarks
            if (lesson.bookmarks) {
                try {
                    lesson.bookmarks = JSON.parse(lesson.bookmarks);
                } catch (error) {
                    lesson.bookmarks = [];
                }
            } else {
                lesson.bookmarks = [];
            }
            
            // Récupérer les médias
            const media = this.getLessonMedia(lessonId);
            lesson.media = media;
            
            // Ajouter le média principal directement à la leçon pour compatibilité
            const mainMedia = media.find(m => ['video', 'audio', 'document'].includes(m.type));
            if (mainMedia) {
                lesson.file_path = mainMedia.path;
                lesson.media_type = mainMedia.type;
                lesson.media_filename = mainMedia.filename;
                lesson.media_mime_type = mainMedia.mime_type;
                lesson.media_duration = mainMedia.duration;
            }
            
            console.log('[DB] Leçon chargée avec médias:', {
                lessonId: lesson.lesson_id,
                title: lesson.title,
                type: lesson.type,
                hasContent: !!lesson.content,
                mediaCount: media.length,
                hasMainMedia: !!mainMedia,
                mainMediaType: mainMedia?.type
            });
            
            return lesson;
            
        } catch (error) {
            console.error('[DB] Erreur getLessonWithMedia:', error);
            throw error;
        }
    }
    
    // Ajouter à la file de synchronisation
    addToSyncQueue(entityType, entityId, action, data = null, priority = 5) {
        try {
            const dataStr = data ? JSON.stringify(data) : null;
            return this.statements.addToSyncQueue.run(entityType, entityId, action, dataStr, priority);
        } catch (error) {
            console.error('Erreur lors de l\'ajout à la file de sync:', error);
            throw error;
        }
    }
    
    // Récupérer les éléments non synchronisés
    getUnsyncedItems(limit = 100) {
        try {
            return this.statements.getUnsyncedItems.all(limit);
        } catch (error) {
            console.error('Erreur lors de la récupération des éléments non sync:', error);
            throw error;
        }
    }
    
    // Marquer comme synchronisé
    markAsSynced(syncIds) {
        try {
            const markStmt = this.statements.markAsSynced;
            if (Array.isArray(syncIds)) {
                const markAll = this.transaction(() => {
                    syncIds.forEach(id => markStmt.run(id));
                });
                markAll(); // Appeler la fonction retournée
            } else {
                markStmt.run(syncIds);
            }
        } catch (error) {
            console.error('Erreur lors du marquage comme synchronisé:', error);
            throw error;
        }
    }
    
    // Récupérer les statistiques
    getStats() {
        try {
            return this.statements.getStats.get();
        } catch (error) {
            console.error('Erreur lors de la récupération des stats:', error);
            throw error;
        }
    }
    
    // Récupérer la progression d'un cours
    getCourseProgress(courseId) {
        try {
            return this.statements.getCourseProgress.get(courseId);
        } catch (error) {
            console.error('Erreur lors de la récupération de la progression:', error);
            throw error;
        }
    }
    
    // Rechercher des cours
    searchCourses(query) {
        try {
            const searchQuery = `%${query}%`;
            const stmt = this.db.prepare(`
                SELECT * FROM courses 
                WHERE title LIKE ? OR instructor_name LIKE ? OR description LIKE ?
                ORDER BY downloaded_at DESC
            `);
            return stmt.all(searchQuery, searchQuery, searchQuery);
        } catch (error) {
            console.error('Erreur lors de la recherche:', error);
            throw error;
        }
    }
    
    // Récupérer les cours expirés
    getExpiredCourses() {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM courses 
                WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
            `);
            return stmt.all();
        } catch (error) {
            console.error('Erreur lors de la récupération des cours expirés:', error);
            throw error;
        }
    }
    
    // Nettoyer les données expirées
    cleanupExpiredData() {
        try {
            const cleanup = this.transaction(() => {
                // Nettoyer le cache expiré
                this.db.prepare('DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP').run();
                
                // Nettoyer les anciens logs de sync (> 30 jours)
                this.db.prepare(`
                    DELETE FROM sync_log 
                    WHERE synced = 1 AND synced_at < date('now', '-30 days')
                `).run();
                
                // Nettoyer les anciennes stats (> 90 jours)
                this.db.prepare(`
                    DELETE FROM usage_stats 
                    WHERE created_at < date('now', '-90 days')
                `).run();
            });
            cleanup(); // Appeler la fonction retournée
        } catch (error) {
            console.error('Erreur lors du nettoyage:', error);
            throw error;
        }
    }
    
    // Fermer la base de données
    close() {
        try {
            if (this.db) {
                this.db.close();
                this.isInitialized = false;
                console.log('Base de données fermée');
            }
        } catch (error) {
            console.error('Erreur lors de la fermeture:', error);
        }
    }
}

module.exports = SecureDatabase;
