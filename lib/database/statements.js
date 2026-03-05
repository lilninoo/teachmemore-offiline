// Préparer les statements fréquemment utilisés
function prepareStatements(db) {
    try {
        // Statements pour les cours
        const statements = {
            // Cours
            saveCourse: db.prepare(`
                INSERT OR REPLACE INTO courses (
                    course_id, title, description, thumbnail_encrypted,
                    instructor_name, instructor_id, lessons_count, sections_count,
                    duration, difficulty_level, category, tags, price, currency,
                    downloaded_at, expires_at, version, checksum, metadata,
                    file_size, rating, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `),
            getCourse: db.prepare('SELECT * FROM courses WHERE course_id = ?'),
            getAllCourses: db.prepare(`
                SELECT * FROM courses 
                ORDER BY CASE 
                    WHEN last_accessed IS NOT NULL THEN last_accessed 
                    ELSE downloaded_at 
                END DESC
            `),
            updateCourseAccess: db.prepare(`
                UPDATE courses 
                SET last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE course_id = ?
            `),
            deleteCourse: db.prepare('DELETE FROM courses WHERE course_id = ?'),
            
            // Sections
            saveSection: db.prepare(`
                INSERT OR REPLACE INTO sections (
                    section_id, course_id, title, description, order_index, lessons_count
                ) VALUES (?, ?, ?, ?, ?, ?)
            `),
            getSections: db.prepare(`
                SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC
            `),
            
            // Leçons
            saveLesson: db.prepare(`
                INSERT OR REPLACE INTO lessons (
                    lesson_id, section_id, title, type, content_encrypted,
                    duration, order_index, completed, progress, preview,
                    points, attachments, difficulty, estimated_time, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `),
            getLesson: db.prepare('SELECT * FROM lessons WHERE lesson_id = ?'),
            getLessons: db.prepare(`
                SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC
            `),
            updateLessonProgress: db.prepare(`
                UPDATE lessons 
                SET progress = @progress, 
                    completed = @completed, 
                    completed_at = CASE WHEN @completed_check = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lesson_id = @lesson_id
            `),
            
            // Médias
            saveMedia: db.prepare(`
                INSERT OR REPLACE INTO media (
                    media_id, lesson_id, course_id, type, filename, original_filename,
                    path_encrypted, url_encrypted, size, mime_type, duration,
                    resolution, bitrate, quality, checksum, thumbnail_path, download_priority
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `),
            getMedia: db.prepare('SELECT * FROM media WHERE media_id = ?'),
            getMediaByLesson: db.prepare('SELECT * FROM media WHERE lesson_id = ?'),
            getMediaByCourse: db.prepare('SELECT * FROM media WHERE course_id = ?'),
            
            // Synchronisation
            addToSyncQueue: db.prepare(`
                INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
                VALUES (?, ?, ?, ?, ?)
            `),
            getUnsyncedItems: db.prepare(`
                SELECT * FROM sync_log 
                WHERE synced = 0 AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
                ORDER BY priority DESC, created_at ASC
                LIMIT ?
            `),
            markAsSynced: db.prepare(`
                UPDATE sync_log 
                SET synced = 1, synced_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `),
            
            // Cache
            getCacheItem: db.prepare(`
                SELECT value FROM cache 
                WHERE key = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            `),
            setCacheItem: db.prepare(`
                INSERT OR REPLACE INTO cache (key, value, expires_at, accessed_count, last_accessed)
                VALUES (?, ?, ?, COALESCE((SELECT accessed_count FROM cache WHERE key = ?), 0) + 1, CURRENT_TIMESTAMP)
            `),
            
            // Statistiques
            getStats: db.prepare(`
                SELECT 
                    (SELECT COUNT(*) FROM courses) as courses,
                    (SELECT COUNT(*) FROM lessons) as lessons,
                    (SELECT COUNT(*) FROM sync_log WHERE synced = 0) as unsynced,
                    (SELECT SUM(file_size) FROM courses) as total_size
            `),
            
            // Progression des cours
            getCourseProgress: db.prepare(`
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
        
        return statements;
    } catch (error) {
        console.error('Erreur lors de la préparation des statements:', error);
        throw error;
    }
}

// Préparer les statements pour les médias
function prepareMediaStatements(db) {
    return {
        getMediaByLesson: db.prepare(`
            SELECT * FROM media WHERE lesson_id = ?
        `),
        getMainMedia: db.prepare(`
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
        updateMediaPath: db.prepare(`
            UPDATE media 
            SET path_encrypted = ?
            WHERE media_id = ?
        `)
    };
}

module.exports = { prepareStatements, prepareMediaStatements };
