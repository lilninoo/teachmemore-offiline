const fs = require('fs');

function createTables(db, schemaPath) {
    try {
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
                    db.exec(stmt);
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
            createBasicSchema(db);
        }
    } catch (error) {
        console.error('Erreur lors de la création des tables:', error);
        throw error;
    }
}

function createBasicSchema(db) {
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
            db.exec(sql);
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.warn('Erreur lors de la création de table:', err.message);
            }
        }
    });
    
    // Créer les index après les tables
    createIndexes(db);
}

// Créer les index pour optimiser les performances
function createIndexes(db) {
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
            db.exec(sql);
        } catch (err) {
            // Ignorer seulement les erreurs "already exists"
            if (!err.message.includes('already exists')) {
                console.error(`Erreur lors de la création de l'index ${index + 1}:`, err.message);
                console.error('SQL:', sql);
            }
        }
    });
}

// Configuration des triggers
function setupTriggers(db) {
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
            db.exec(trigger);
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

module.exports = { createTables, createBasicSchema, createIndexes, setupTriggers };
