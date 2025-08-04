// database.js - Version corrigée avec better-sqlite3 et gestion d'erreurs robuste
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const encryption = require('./encryption');

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
            this.createTables();
            
            // Préparer les statements fréquemment utilisés
            this.prepareStatements();
            
            // Configurer les triggers et fonctions personnalisées
            this.setupTriggers();
            
            // Migrer si nécessaire
            this.migrate();
            
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
    
    createTables() {
        try {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
            
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf8');
                
                // Parser le schéma SQL plus intelligemment
                const statements = [];
                let currentStatement = '';
                let inString = false;
                let stringChar = '';
                let inComment = false;
                let inMultilineComment = false;
                
                for (let i = 0; i < schema.length; i++) {
                    const char = schema[i];
                    const nextChar = i < schema.length - 1 ? schema[i + 1] : '';
                    const prevChar = i > 0 ? schema[i - 1] : '';
                    
                    // Gérer les commentaires multilignes
                    if (char === '/' && nextChar === '*' && !inString) {
                        inMultilineComment = true;
                        i++; // Skip next char
                        continue;
                    }
                    if (char === '*' && nextChar === '/' && inMultilineComment) {
                        inMultilineComment = false;
                        i++; // Skip next char
                        continue;
                    }
                    if (inMultilineComment) continue;
                    
                    // Gérer les commentaires de ligne
                    if (char === '-' && nextChar === '-' && !inString) {
                        inComment = true;
                    }
                    if (inComment && char === '\n') {
                        inComment = false;
                        continue;
                    }
                    if (inComment) continue;
                    
                    // Gérer les chaînes SQL
                    if ((char === "'" || char === '"') && prevChar !== '\\') {
                        if (!inString) {
                            inString = true;
                            stringChar = char;
                        } else if (char === stringChar) {
                            inString = false;
                        }
                    }
                    
                    currentStatement += char;
                    
                    // Fin de statement seulement si on n'est pas dans une chaîne
                    if (char === ';' && !inString) {
                        const stmt = currentStatement.trim();
                        if (stmt && !stmt.startsWith('--')) {
                            statements.push(stmt);
                        }
                        currentStatement = '';
                    }
                }
                
                // Ajouter le dernier statement s'il existe
                if (currentStatement.trim()) {
                    statements.push(currentStatement.trim());
                }
                
                // Exécuter chaque statement directement
                console.log(`Exécution de ${statements.length} statements SQL...`);
                statements.forEach((stmt, index) => {
                    try {
                        // Ignorer les statements vides ou les commentaires
                        if (!stmt || stmt.startsWith('--')) return;
                        
                        console.log(`Exécution statement ${index + 1}/${statements.length}`);
                        this.db.exec(stmt);
                    } catch (err) {
                        // Ignorer seulement les erreurs "already exists"
                        if (!err.message.includes('already exists')) {
                            console.error(`Erreur SQL statement ${index + 1}:`, err.message);
                            console.error('Statement:', stmt.substring(0, 100) + '...');
                        }
                    }
                });
            } else {
                console.log('Fichier schema.sql non trouvé, création du schéma de base');
                // Créer un schéma de base
                this.createBasicSchema();
            }
        } catch (error) {
            console.error('Erreur lors de la création des tables:', error);
            throw error;
        }
    }
    
    createBasicSchema() {
        const tables = [
            // Table des cours avec colonnes optimisées
            `CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id INTEGER UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                thumbnail_encrypted TEXT,
                instructor_name TEXT,
                instructor_id INTEGER,
                lessons_count INTEGER DEFAULT 0,
                sections_count INTEGER DEFAULT 0,
                duration TEXT,
                difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced') OR difficulty_level IS NULL),
                category TEXT,
                tags TEXT,
                price REAL DEFAULT 0,
                currency TEXT DEFAULT 'EUR',
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME,
                expires_at DATETIME,
                version INTEGER DEFAULT 1,
                checksum TEXT,
                metadata TEXT,
                file_size INTEGER DEFAULT 0,
                download_progress INTEGER DEFAULT 100,
                is_favorite BOOLEAN DEFAULT 0,
                rating REAL DEFAULT 0,
                completion_percentage REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Table des sections
            `CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                order_index INTEGER DEFAULT 0,
                lessons_count INTEGER DEFAULT 0,
                duration TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // Table des leçons avec colonnes étendues
            `CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER UNIQUE NOT NULL,
                section_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('video', 'text', 'quiz', 'assignment', 'pdf', 'audio') OR type IS NULL),
                content_encrypted TEXT,
                duration TEXT,
                order_index INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                completed_at DATETIME,
                progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
                last_position INTEGER DEFAULT 0,
                preview BOOLEAN DEFAULT 0,
                points INTEGER DEFAULT 0,
                attachments TEXT,
                difficulty TEXT DEFAULT 'normal',
                estimated_time INTEGER DEFAULT 0,
                views_count INTEGER DEFAULT 0,
                notes_count INTEGER DEFAULT 0,
                bookmarks TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
            )`,
            
            // Table des médias avec métadonnées étendues
            `CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id TEXT UNIQUE NOT NULL,
                lesson_id INTEGER,
                course_id INTEGER,
                type TEXT NOT NULL CHECK(type IN ('video', 'audio', 'document', 'image', 'archive') OR type IS NULL),
                filename TEXT NOT NULL,
                original_filename TEXT,
                path_encrypted TEXT NOT NULL,
                url_encrypted TEXT,
                size INTEGER,
                mime_type TEXT,
                duration INTEGER,
                resolution TEXT,
                bitrate INTEGER,
                quality TEXT,
                checksum TEXT,
                thumbnail_path TEXT,
                download_priority INTEGER DEFAULT 5,
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // Table des quiz
            `CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                questions_encrypted TEXT NOT NULL,
                settings TEXT,
                duration INTEGER,
                passing_grade INTEGER DEFAULT 70 CHECK(passing_grade >= 0 AND passing_grade <= 100),
                max_attempts INTEGER DEFAULT 0,
                user_answers TEXT,
                score REAL,
                passed BOOLEAN DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME,
                best_score REAL DEFAULT 0,
                time_spent INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table des devoirs/assignments
            `CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                instructions_encrypted TEXT,
                due_days INTEGER,
                max_file_size INTEGER,
                allowed_file_types TEXT,
                submission_encrypted TEXT,
                submitted_at DATETIME,
                grade REAL,
                feedback_encrypted TEXT,
                graded_at DATETIME,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'submitted', 'graded', 'late') OR status IS NULL),
                submission_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table de synchronisation améliorée
            `CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL CHECK(entity_type IN ('course', 'lesson', 'quiz', 'assignment', 'progress', 'note') OR entity_type IS NULL),
                entity_id INTEGER NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'complete', 'progress') OR action IS NULL),
                data TEXT,
                synced BOOLEAN DEFAULT 0,
                sync_attempts INTEGER DEFAULT 0,
                priority INTEGER DEFAULT 5,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                synced_at DATETIME,
                error_message TEXT,
                next_retry_at DATETIME,
                max_retries INTEGER DEFAULT 3
            )`,
            
            // Table des notes et annotations
            `CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                content_encrypted TEXT NOT NULL,
                position INTEGER,
                color TEXT DEFAULT '#ffeb3b',
                type TEXT DEFAULT 'note' CHECK(type IN ('note', 'highlight', 'bookmark') OR type IS NULL),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table des certificats
            `CREATE TABLE IF NOT EXISTS certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                certificate_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                certificate_key TEXT UNIQUE NOT NULL,
                issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                grade REAL,
                file_path_encrypted TEXT,
                metadata TEXT,
                template_id INTEGER,
                valid_until DATETIME,
                verification_url TEXT,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // Table des discussions (cache local)
            `CREATE TABLE IF NOT EXISTS discussions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discussion_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                parent_id INTEGER,
                author_name TEXT,
                author_avatar_encrypted TEXT,
                content_encrypted TEXT,
                created_at DATETIME,
                likes INTEGER DEFAULT 0,
                replies_count INTEGER DEFAULT 0,
                is_instructor BOOLEAN DEFAULT 0,
                synced BOOLEAN DEFAULT 1,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table des paramètres utilisateur
            `CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                type TEXT DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json') OR type IS NULL),
                description TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Table de cache avec TTL
            `CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                accessed_count INTEGER DEFAULT 0,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Table des statistiques d'utilisation
            `CREATE TABLE IF NOT EXISTS usage_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                entity_type TEXT,
                entity_id INTEGER,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        
        // Exécution directe sans transaction wrapper
        tables.forEach((sql, index) => {
            try {
                console.log(`Création table ${index + 1}/${tables.length}`);
                this.db.exec(sql);
            } catch (err) {
                if (!err.message.includes('already exists')) {
                    console.warn('Erreur lors de la création de table:', err.message);
                }
            }
        });
        
        // Créer les index après les tables
        this.createIndexes();
    }
    
    // Créer les index pour optimiser les performances
    createIndexes() {
        const indexes = [
            // Index de base
            'CREATE INDEX IF NOT EXISTS idx_lessons_section ON lessons(section_id)',
            'CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_lesson ON media(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_course ON media(course_id)',
            'CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced)',
            'CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)',
            'CREATE INDEX IF NOT EXISTS idx_quizzes_lesson ON quizzes(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_assignments_lesson ON assignments(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_notes_lesson ON notes(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_discussions_lesson ON discussions(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)',
            'CREATE INDEX IF NOT EXISTS idx_courses_expires ON courses(expires_at)',
            
            // Index composites corrigés
            'CREATE INDEX IF NOT EXISTS idx_lessons_completed ON lessons(completed, section_id)',
            'CREATE INDEX IF NOT EXISTS idx_lessons_progress ON lessons(progress, completed)',
            'CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category, downloaded_at)',
            'CREATE INDEX IF NOT EXISTS idx_sync_priority ON sync_log(priority, created_at, synced)',
            'CREATE INDEX IF NOT EXISTS idx_media_type_size ON media(type, size)',
            'CREATE INDEX IF NOT EXISTS idx_usage_stats_event ON usage_stats(event_type, created_at)',
            
            // Index pour la recherche textuelle
            'CREATE INDEX IF NOT EXISTS idx_courses_title ON courses(title)',
            'CREATE INDEX IF NOT EXISTS idx_lessons_title ON lessons(title)',
            'CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_name)'
        ];
        
        indexes.forEach((sql, index) => {
            try {
                console.log(`Création index ${index + 1}/${indexes.length}`);
                this.db.exec(sql);
            } catch (err) {
                // Ignorer seulement les erreurs "already exists"
                if (!err.message.includes('already exists')) {
                    console.error(`Erreur lors de la création de l'index ${index + 1}:`, err.message);
                    console.error('SQL:', sql);
                }
            }
        });
    }
    
    // Préparer les statements fréquemment utilisés
    prepareStatements() {
        try {
            // Statements pour les cours
            this.statements = {
                // Cours
                saveCourse: this.db.prepare(`
                    INSERT OR REPLACE INTO courses (
                        course_id, title, description, thumbnail_encrypted,
                        instructor_name, instructor_id, lessons_count, sections_count,
                        duration, difficulty_level, category, tags, price, currency,
                        downloaded_at, expires_at, version, checksum, metadata,
                        file_size, rating, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `),
                getCourse: this.db.prepare('SELECT * FROM courses WHERE course_id = ?'),
                getAllCourses: this.db.prepare(`
                    SELECT * FROM courses 
                    ORDER BY CASE 
                        WHEN last_accessed IS NOT NULL THEN last_accessed 
                        ELSE downloaded_at 
                    END DESC
                `),
                updateCourseAccess: this.db.prepare(`
                    UPDATE courses 
                    SET last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE course_id = ?
                `),
                deleteCourse: this.db.prepare('DELETE FROM courses WHERE course_id = ?'),
                
                // Sections
                saveSection: this.db.prepare(`
                    INSERT OR REPLACE INTO sections (
                        section_id, course_id, title, description, order_index, lessons_count
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `),
                getSections: this.db.prepare(`
                    SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC
                `),
                
                // Leçons
                saveLesson: this.db.prepare(`
                    INSERT OR REPLACE INTO lessons (
                        lesson_id, section_id, title, type, content_encrypted,
                        duration, order_index, completed, progress, preview,
                        points, attachments, difficulty, estimated_time, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `),
                getLesson: this.db.prepare('SELECT * FROM lessons WHERE lesson_id = ?'),
                getLessons: this.db.prepare(`
                    SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC
                `),
                updateLessonProgress: this.db.prepare(`
                    UPDATE lessons 
                    SET progress = @progress, 
                        completed = @completed, 
                        completed_at = CASE WHEN @completed_check = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE lesson_id = @lesson_id
                `),
                
                // Médias
                saveMedia: this.db.prepare(`
                    INSERT OR REPLACE INTO media (
                        media_id, lesson_id, course_id, type, filename, original_filename,
                        path_encrypted, url_encrypted, size, mime_type, duration,
                        resolution, bitrate, quality, checksum, thumbnail_path, download_priority
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `),
                getMedia: this.db.prepare('SELECT * FROM media WHERE media_id = ?'),
                getMediaByLesson: this.db.prepare('SELECT * FROM media WHERE lesson_id = ?'),
                getMediaByCourse: this.db.prepare('SELECT * FROM media WHERE course_id = ?'),
                
                // Synchronisation
                addToSyncQueue: this.db.prepare(`
                    INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
                    VALUES (?, ?, ?, ?, ?)
                `),
                getUnsyncedItems: this.db.prepare(`
                    SELECT * FROM sync_log 
                    WHERE synced = 0 AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
                    ORDER BY priority DESC, created_at ASC
                    LIMIT ?
                `),
                markAsSynced: this.db.prepare(`
                    UPDATE sync_log 
                    SET synced = 1, synced_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `),
                
                // Cache
                getCacheItem: this.db.prepare(`
                    SELECT value FROM cache 
                    WHERE key = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                `),
                setCacheItem: this.db.prepare(`
                    INSERT OR REPLACE INTO cache (key, value, expires_at, accessed_count, last_accessed)
                    VALUES (?, ?, ?, COALESCE((SELECT accessed_count FROM cache WHERE key = ?), 0) + 1, CURRENT_TIMESTAMP)
                `),
                
                // Statistiques
                getStats: this.db.prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM courses) as courses,
                        (SELECT COUNT(*) FROM lessons) as lessons,
                        (SELECT COUNT(*) FROM sync_log WHERE synced = 0) as unsynced,
                        (SELECT SUM(file_size) FROM courses) as total_size
                `),
                
                // Progression des cours
                getCourseProgress: this.db.prepare(`
                    SELECT 
                        COUNT(DISTINCT l.lesson_id) as total_lessons,
                        COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) as completed_lessons,
                        ROUND(AVG(l.progress), 2) as average_progress,
                        ROUND(CAST(COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) AS FLOAT) / 
                              NULLIF(COUNT(DISTINCT l.lesson_id), 0) * 100, 2) as completion_percentage
                    FROM sections s
                    LEFT JOIN lessons l ON s.section_id = l.section_id
                    WHERE s.course_id = ?
                `)
            };
            
            // Préparer aussi les statements pour les médias
            this.prepareMediaStatements();
        } catch (error) {
            console.error('Erreur lors de la préparation des statements:', error);
            throw error;
        }
    }
    
    // Préparer les statements pour les médias
    prepareMediaStatements() {
        if (!this.mediaStatements) {
            this.mediaStatements = {
                getMediaByLesson: this.db.prepare(`
                    SELECT * FROM media WHERE lesson_id = ?
                `),
                getMainMedia: this.db.prepare(`
                    SELECT * FROM media 
                    WHERE lesson_id = ? AND type IN ('video', 'audio', 'document')
                    ORDER BY 
                        CASE type 
                            WHEN 'video' THEN 1 
                            WHEN 'audio' THEN 2 
                            WHEN 'document' THEN 3 
                            ELSE 4 
                        END
                    LIMIT 1
                `),
                updateMediaPath: this.db.prepare(`
                    UPDATE media 
                    SET path_encrypted = ?
                    WHERE media_id = ?
                `)
            };
        }
    }
    
    // Configuration des triggers
    setupTriggers() {
        const triggers = [
            // Mise à jour automatique de last_accessed
            `DROP TRIGGER IF EXISTS update_course_access;`,
            `CREATE TRIGGER update_course_access 
             AFTER UPDATE ON lessons
             WHEN NEW.completed = 1 OR NEW.progress > OLD.progress
             BEGIN
                 UPDATE courses 
                 SET last_accessed = CURRENT_TIMESTAMP, 
                     updated_at = CURRENT_TIMESTAMP
                 WHERE course_id = (
                     SELECT s.course_id 
                     FROM sections s
                     WHERE s.section_id = NEW.section_id
                 );
             END;`,
             
            // Mise à jour du compteur de leçons dans les sections
            `DROP TRIGGER IF EXISTS update_section_lesson_count;`,
            `CREATE TRIGGER update_section_lesson_count
             AFTER INSERT ON lessons
             BEGIN
                 UPDATE sections 
                 SET lessons_count = (
                     SELECT COUNT(*) FROM lessons WHERE section_id = NEW.section_id
                 )
                 WHERE section_id = NEW.section_id;
             END;`,
             
            // Ajout automatique à la file de synchronisation
            `DROP TRIGGER IF EXISTS add_to_sync_on_progress;`,
            `CREATE TRIGGER add_to_sync_on_progress
             AFTER UPDATE ON lessons
             WHEN NEW.progress > OLD.progress OR NEW.completed != OLD.completed
             BEGIN
                 INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
                 VALUES ('lesson', NEW.lesson_id, 'progress', 
                         json_object('progress', NEW.progress, 'completed', NEW.completed), 5);
             END;`,
             
            // Mise à jour du timestamp
            `DROP TRIGGER IF EXISTS update_lesson_timestamp;`,
            `CREATE TRIGGER update_lesson_timestamp
             AFTER UPDATE ON lessons
             BEGIN
                 UPDATE lessons 
                 SET updated_at = CURRENT_TIMESTAMP 
                 WHERE lesson_id = NEW.lesson_id;
             END;`,
             
            // Mise à jour des statistiques d'usage
            `DROP TRIGGER IF EXISTS track_lesson_completion;`,
            `CREATE TRIGGER track_lesson_completion
             AFTER UPDATE ON lessons
             WHEN NEW.completed = 1 AND OLD.completed = 0
             BEGIN
                 INSERT INTO usage_stats (event_type, entity_type, entity_id, metadata)
                 VALUES ('lesson_completed', 'lesson', NEW.lesson_id, 
                         json_object(
                             'duration', IFNULL(NEW.duration, '0'),
                             'progress_time', datetime('now')
                         ));
             END;`,
             
            // Nettoyage automatique du cache expiré (une fois par jour)
            `DROP TRIGGER IF EXISTS cleanup_expired_cache;`,
            `CREATE TRIGGER cleanup_expired_cache
             AFTER INSERT ON cache
             WHEN (SELECT COUNT(*) FROM cache) % 100 = 0
             BEGIN
                 DELETE FROM cache 
                 WHERE expires_at < CURRENT_TIMESTAMP 
                 AND expires_at IS NOT NULL;
             END;`
        ];
        
        // Exécuter chaque trigger avec gestion d'erreur
        triggers.forEach((trigger, index) => {
            try {
                console.log(`Création trigger ${Math.floor(index/2) + 1}/${triggers.length/2}`);
                this.db.exec(trigger);
            } catch (err) {
                if (!err.message.includes('no such table') && 
                    !err.message.includes('syntax error')) {
                    console.error(`Erreur critique trigger ${index}:`, err.message);
                    throw err;
                } else {
                    console.warn('Erreur non critique pour trigger:', err.message);
                }
            }
        });
    }
    
    // Système de migration
    migrate() {
        try {
            // Vérifier la version de la DB
            let currentVersion = 0;
            try {
                const result = this.db.prepare("SELECT value FROM user_settings WHERE key = 'db_version'").get();
                currentVersion = result ? parseInt(result.value) : 0;
            } catch (error) {
                // Table user_settings n'existe pas encore
                currentVersion = 0;
            }
            
            const targetVersion = 2; // Version cible
            
            if (currentVersion < targetVersion) {
                console.log(`Migration de la DB v${currentVersion} vers v${targetVersion}`);
                
                // Utiliser correctement la transaction
                const runMigration = this.transaction(() => {
                    // Migrations par version
                    if (currentVersion < 1) {
                        this.migrateToV1();
                    }
                    if (currentVersion < 2) {
                        this.migrateToV2();
                    }
                    
                    // Mettre à jour la version
                    this.db.prepare(`
                        INSERT OR REPLACE INTO user_settings (key, value, type) 
                        VALUES ('db_version', ?, 'number')
                    `).run(targetVersion.toString());
                });
                
                // Exécuter la transaction
                runMigration();
                
                console.log('Migration terminée');
            }
        } catch (error) {
            console.error('Erreur lors de la migration:', error);
        }
    }
    
    // Migration vers v1
    migrateToV1() {
        // Ajouter des colonnes manquantes si nécessaire
        const alterations = [
            "ALTER TABLE courses ADD COLUMN file_size INTEGER DEFAULT 0",
            "ALTER TABLE courses ADD COLUMN rating REAL DEFAULT 0",
            "ALTER TABLE courses ADD COLUMN completion_percentage REAL DEFAULT 0",
            "ALTER TABLE lessons ADD COLUMN difficulty TEXT DEFAULT 'normal'",
            "ALTER TABLE lessons ADD COLUMN estimated_time INTEGER DEFAULT 0"
        ];
        
        alterations.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (error) {
                // Ignorer si la colonne existe déjà
                if (!error.message.includes('duplicate column name')) {
                    console.warn('Erreur SQL ignorée:', error.message);
                }
            }
        });
    }
    
    // Migration vers v2
    migrateToV2() {
        const alterations = [
            "ALTER TABLE media ADD COLUMN thumbnail_path TEXT",
            "ALTER TABLE media ADD COLUMN download_priority INTEGER DEFAULT 5",
            "ALTER TABLE quizzes ADD COLUMN best_score REAL DEFAULT 0",
            "ALTER TABLE quizzes ADD COLUMN time_spent INTEGER DEFAULT 0"
        ];
        
        alterations.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (error) {
                if (!error.message.includes('duplicate column name')) {
                    console.warn('Erreur SQL ignorée:', error.message);
                }
            }
        });
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