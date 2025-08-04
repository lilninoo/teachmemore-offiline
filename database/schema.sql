-- schema.sql - Structure complète de la base de données LearnPress Offline
-- Base de données SQLite avec support du chiffrement

-- =====================================================
-- TABLE DES COURS
-- =====================================================
CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_encrypted TEXT,  -- URL de la miniature chiffrée
    instructor_name TEXT,
    instructor_id INTEGER,
    lessons_count INTEGER DEFAULT 0,
    sections_count INTEGER DEFAULT 0,
    duration TEXT,  -- Format: "2h 30m"
    difficulty_level TEXT,  -- beginner, intermediate, advanced
    category TEXT,
    tags TEXT,  -- JSON array
    price REAL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME,
    expires_at DATETIME,
    version INTEGER DEFAULT 1,
    checksum TEXT,  -- Pour vérifier l'intégrité
    metadata TEXT,  -- JSON pour données supplémentaires
    file_size INTEGER DEFAULT 0,
    download_progress INTEGER DEFAULT 100,
    is_favorite BOOLEAN DEFAULT 0,
    rating REAL DEFAULT 0,
    completion_percentage REAL DEFAULT 0,
    local_path TEXT,  -- AJOUT: Chemin local du cours
    is_synced BOOLEAN DEFAULT 0,  -- AJOUT: État de synchronisation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABLE DES SECTIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS sections (
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
);

-- =====================================================
-- TABLE DES LEÇONS
-- =====================================================
CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id INTEGER UNIQUE NOT NULL,
    section_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,  -- video, text, quiz, assignment, pdf, audio
    content_encrypted TEXT,  -- Contenu HTML chiffré
    duration TEXT,  -- Format: "15m"
    order_index INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT 0,
    completed_at DATETIME,
    progress INTEGER DEFAULT 0,  -- Pourcentage 0-100
    last_position INTEGER DEFAULT 0,  -- Position en secondes pour les vidéos
    preview BOOLEAN DEFAULT 0,  -- Leçon en aperçu gratuit
    points INTEGER DEFAULT 0,  -- Points attribués à la complétion
    attachments TEXT,  -- JSON array des pièces jointes
    difficulty TEXT DEFAULT 'normal',
    estimated_time INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    notes_count INTEGER DEFAULT 0,
    bookmarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES MÉDIAS
-- =====================================================
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT UNIQUE NOT NULL,
    lesson_id INTEGER,
    course_id INTEGER,
    type TEXT NOT NULL,  -- video, audio, document, image, archive
    filename TEXT NOT NULL,
    original_filename TEXT,
    path_encrypted TEXT NOT NULL,  -- Chemin local chiffré
    url_encrypted TEXT,  -- URL d'origine chiffrée
    size INTEGER,  -- Taille en octets
    mime_type TEXT,
    duration INTEGER,  -- Durée en secondes pour vidéo/audio
    resolution TEXT,  -- Pour les vidéos (ex: "1920x1080")
    checksum TEXT,
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    bitrate INTEGER,
    quality TEXT,
    thumbnail_path TEXT,
    download_priority INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES QUIZ
-- =====================================================
CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER UNIQUE NOT NULL,
    lesson_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    questions_encrypted TEXT NOT NULL,  -- JSON array chiffré
    settings TEXT,  -- JSON (passing_grade, retake_count, duration, etc.)
    duration INTEGER,  -- Durée limite en minutes
    passing_grade INTEGER DEFAULT 70,  -- Note de passage en %
    max_attempts INTEGER DEFAULT 0,  -- 0 = illimité
    user_answers TEXT,  -- JSON array des réponses
    score REAL,
    passed BOOLEAN DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    last_attempt DATETIME,
    best_score REAL DEFAULT 0,
    time_spent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES DEVOIRS/ASSIGNMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER UNIQUE NOT NULL,
    lesson_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    instructions_encrypted TEXT,
    due_days INTEGER,  -- Nombre de jours pour rendre le devoir
    max_file_size INTEGER,  -- Taille max en MB
    allowed_file_types TEXT,  -- JSON array
    submission_encrypted TEXT,  -- Soumission de l'étudiant chiffrée
    submitted_at DATETIME,
    grade REAL,
    feedback_encrypted TEXT,
    graded_at DATETIME,
    status TEXT DEFAULT 'pending',
    submission_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DE SYNCHRONISATION
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,  -- course, lesson, quiz, assignment, progress, note
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,  -- create, update, delete, complete, progress
    data TEXT,  -- JSON des données à synchroniser
    synced BOOLEAN DEFAULT 0,
    sync_attempts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME,
    error_message TEXT,
    priority INTEGER DEFAULT 5,
    next_retry_at DATETIME,
    max_retries INTEGER DEFAULT 3
);

-- =====================================================
-- TABLE DES CERTIFICATS
-- =====================================================
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id INTEGER UNIQUE NOT NULL,
    course_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    certificate_key TEXT UNIQUE NOT NULL,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    grade REAL,
    file_path_encrypted TEXT,
    metadata TEXT,  -- JSON
    template_id INTEGER,
    valid_until DATETIME,
    verification_url TEXT,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES NOTES/BOOKMARKS
-- =====================================================
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id INTEGER NOT NULL,
    content_encrypted TEXT NOT NULL,
    position INTEGER,  -- Position dans la vidéo ou le texte
    color TEXT DEFAULT '#ffeb3b',  -- Couleur du surlignage
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'note',
    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES DISCUSSIONS (Cache local)
-- =====================================================
CREATE TABLE IF NOT EXISTS discussions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discussion_id INTEGER UNIQUE NOT NULL,
    lesson_id INTEGER NOT NULL,
    parent_id INTEGER,  -- Pour les réponses
    author_name TEXT,
    author_avatar_encrypted TEXT,
    content_encrypted TEXT,
    created_at DATETIME,
    likes INTEGER DEFAULT 0,
    replies_count INTEGER DEFAULT 0,
    is_instructor BOOLEAN DEFAULT 0,
    synced BOOLEAN DEFAULT 1,  -- Déjà synchronisé car vient du serveur
    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE DES PARAMÈTRES UTILISATEUR
-- =====================================================
CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'string',
    description TEXT
);

-- =====================================================
-- TABLE DE CACHE
-- =====================================================
CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_count INTEGER DEFAULT 0,
    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABLE DES STATISTIQUES D'UTILISATION
-- =====================================================
CREATE TABLE IF NOT EXISTS usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEX POUR LES PERFORMANCES (CORRIGÉS)
-- =====================================================
-- Index de base
CREATE INDEX IF NOT EXISTS idx_lessons_section ON lessons(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_media_lesson ON media(lesson_id);
CREATE INDEX IF NOT EXISTS idx_media_course ON media(course_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced);
CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_lesson ON quizzes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_assignments_lesson ON assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_notes_lesson ON notes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_discussions_lesson ON discussions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_courses_expires ON courses(expires_at);

-- Index composites pour les requêtes courantes (CORRIGÉS)
CREATE INDEX IF NOT EXISTS idx_lessons_completed ON lessons(completed, section_id);
CREATE INDEX IF NOT EXISTS idx_lessons_progress ON lessons(progress, completed);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category, downloaded_at);
CREATE INDEX IF NOT EXISTS idx_sync_priority ON sync_log(priority, created_at, synced);
CREATE INDEX IF NOT EXISTS idx_media_type_size ON media(type, size);
CREATE INDEX IF NOT EXISTS idx_usage_stats_event ON usage_stats(event_type, created_at);

-- Index pour la recherche textuelle
CREATE INDEX IF NOT EXISTS idx_courses_title ON courses(title);
CREATE INDEX IF NOT EXISTS idx_lessons_title ON lessons(title);
CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_name);

-- =====================================================
-- VUES UTILES
-- =====================================================

-- Vue pour la progression des cours
CREATE VIEW IF NOT EXISTS course_progress_view AS
SELECT 
    c.course_id,
    c.title as course_title,
    COUNT(DISTINCT l.lesson_id) as total_lessons,
    COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) as completed_lessons,
    ROUND(AVG(l.progress), 2) as average_progress,
    ROUND(CAST(COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) AS FLOAT) / 
          NULLIF(COUNT(DISTINCT l.lesson_id), 0) * 100, 2) as completion_percentage
FROM courses c
LEFT JOIN sections s ON c.course_id = s.course_id
LEFT JOIN lessons l ON s.section_id = l.section_id
GROUP BY c.course_id;

-- Vue pour les quiz avec résultats
CREATE VIEW IF NOT EXISTS quiz_results_view AS
SELECT 
    q.quiz_id,
    q.title as quiz_title,
    l.lesson_id,
    l.title as lesson_title,
    q.score,
    q.passed,
    q.attempts,
    q.last_attempt,
    q.passing_grade
FROM quizzes q
JOIN lessons l ON q.lesson_id = l.lesson_id;

-- =====================================================
-- TRIGGERS (CORRIGÉS)
-- =====================================================

-- Mise à jour automatique de last_accessed
DROP TRIGGER IF EXISTS update_course_access;
CREATE TRIGGER update_course_access 
AFTER UPDATE ON lessons
WHEN NEW.completed = 1 OR NEW.progress > OLD.progress
BEGIN
    UPDATE courses 
    SET last_accessed = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE course_id = (
        SELECT c.course_id 
        FROM courses c
        JOIN sections s ON c.course_id = s.course_id
        WHERE s.section_id = NEW.section_id
    );
END;

-- Mise à jour du compteur de leçons dans les sections
DROP TRIGGER IF EXISTS update_section_lesson_count;
CREATE TRIGGER update_section_lesson_count
AFTER INSERT ON lessons
BEGIN
    UPDATE sections 
    SET lessons_count = (
        SELECT COUNT(*) FROM lessons WHERE section_id = NEW.section_id
    )
    WHERE section_id = NEW.section_id;
END;

-- Ajout automatique à la file de synchronisation
DROP TRIGGER IF EXISTS add_to_sync_on_progress;
CREATE TRIGGER add_to_sync_on_progress
AFTER UPDATE ON lessons
WHEN NEW.progress > OLD.progress OR NEW.completed != OLD.completed
BEGIN
    INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
    VALUES ('lesson', NEW.lesson_id, 'progress', 
            json_object('progress', NEW.progress, 'completed', NEW.completed), 5);
END;

-- Mise à jour des timestamps
DROP TRIGGER IF EXISTS update_lesson_timestamp;
CREATE TRIGGER update_lesson_timestamp
AFTER UPDATE ON lessons
BEGIN
    UPDATE lessons SET updated_at = CURRENT_TIMESTAMP WHERE lesson_id = NEW.lesson_id;
END;

-- Mise à jour des statistiques d'usage
DROP TRIGGER IF EXISTS track_lesson_completion;
CREATE TRIGGER track_lesson_completion
AFTER UPDATE ON lessons
WHEN NEW.completed = 1 AND OLD.completed = 0
BEGIN
    INSERT INTO usage_stats (event_type, entity_type, entity_id, metadata)
    VALUES ('lesson_completed', 'lesson', NEW.lesson_id, 
            json_object('duration', NEW.duration, 'progress_time', NEW.updated_at));
END;

-- Nettoyage automatique du cache expiré
DROP TRIGGER IF EXISTS cleanup_expired_cache;
CREATE TRIGGER cleanup_expired_cache
AFTER INSERT ON cache
BEGIN
    DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP;
END;

-- =====================================================
-- SCRIPT DE MIGRATION POUR BASES EXISTANTES
-- =====================================================
-- Si vous avez déjà une base de données sans ces colonnes,
-- exécutez ces commandes pour les ajouter :

-- ALTER TABLE courses ADD COLUMN local_path TEXT;
-- ALTER TABLE courses ADD COLUMN is_synced BOOLEAN DEFAULT 0;