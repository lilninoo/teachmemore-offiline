const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs').promises;

let Database;
let betterSqliteAvailable = false;

try {
    Database = require('better-sqlite3');
    betterSqliteAvailable = true;
} catch (e) {
    // Native module not available
}

const describeFn = betterSqliteAvailable ? describe : describe.skip;

describeFn('SecureDatabase', () => {
    let tmpDir;
    let db;
    let rawDb;

    function createBasicSchema(rawDb) {
        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS courses (
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
                difficulty_level TEXT,
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
                local_path TEXT DEFAULT '',
                is_synced INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        rawDb.exec(`
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
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER UNIQUE NOT NULL,
                section_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                type TEXT,
                content_encrypted TEXT,
                duration TEXT,
                order_index INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                completed_at DATETIME,
                progress INTEGER DEFAULT 0,
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
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id TEXT UNIQUE NOT NULL,
                lesson_id INTEGER,
                course_id INTEGER,
                type TEXT,
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                data TEXT,
                synced BOOLEAN DEFAULT 0,
                sync_attempts INTEGER DEFAULT 0,
                priority INTEGER DEFAULT 5,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                synced_at DATETIME,
                error_message TEXT,
                next_retry_at DATETIME,
                max_retries INTEGER DEFAULT 3
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                accessed_count INTEGER DEFAULT 0,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS usage_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                entity_type TEXT,
                entity_id INTEGER,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        rawDb.exec(`
            CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                type TEXT DEFAULT 'string',
                description TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    function prepareStatements(rawDb) {
        return {
            getCourse: rawDb.prepare('SELECT * FROM courses WHERE course_id = ?'),
            getAllCourses: rawDb.prepare('SELECT * FROM courses ORDER BY downloaded_at DESC'),
            updateCourseAccess: rawDb.prepare('UPDATE courses SET last_accessed = CURRENT_TIMESTAMP WHERE course_id = ?'),
            deleteCourse: rawDb.prepare('DELETE FROM courses WHERE course_id = ?'),
            getSections: rawDb.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC'),
            getLesson: rawDb.prepare('SELECT * FROM lessons WHERE lesson_id = ?'),
            getLessons: rawDb.prepare('SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC'),
            updateLessonProgress: rawDb.prepare(`
                UPDATE lessons
                SET progress = @progress,
                    completed = @completed,
                    completed_at = CASE WHEN @completed_check = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lesson_id = @lesson_id
            `),
            getMediaByLesson: rawDb.prepare('SELECT * FROM media WHERE lesson_id = ?'),
            addToSyncQueue: rawDb.prepare('INSERT INTO sync_log (entity_type, entity_id, action, data, priority) VALUES (?, ?, ?, ?, ?)'),
            getUnsyncedItems: rawDb.prepare('SELECT * FROM sync_log WHERE synced = 0 ORDER BY priority DESC, created_at ASC LIMIT ?'),
            markAsSynced: rawDb.prepare('UPDATE sync_log SET synced = 1, synced_at = CURRENT_TIMESTAMP WHERE id = ?'),
            getStats: rawDb.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM courses) as courses,
                    (SELECT COUNT(*) FROM lessons) as lessons,
                    (SELECT COUNT(*) FROM sync_log WHERE synced = 0) as unsynced,
                    (SELECT SUM(file_size) FROM courses) as total_size
            `)
        };
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
        const dbPath = path.join(tmpDir, 'test.db');
        rawDb = new Database(dbPath);
        rawDb.pragma('journal_mode = WAL');
        rawDb.pragma('foreign_keys = ON');

        createBasicSchema(rawDb);
        const statements = prepareStatements(rawDb);

        db = {
            db: rawDb,
            statements,
            encryption: null,
            encryptionKey: null,
            transaction: (fn) => rawDb.transaction(fn),
            saveCourse(courseData) {
                const stmt = rawDb.prepare(`
                    INSERT OR REPLACE INTO courses (
                        course_id, title, description, thumbnail_encrypted,
                        instructor_name, instructor_id, sections_count, lessons_count,
                        duration, difficulty_level, category, tags,
                        downloaded_at, last_accessed, local_path, version, expires_at, is_synced
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const values = [
                    courseData.course_id,
                    courseData.title,
                    courseData.description || null,
                    courseData.thumbnail_encrypted || null,
                    courseData.instructor_name || 'Instructeur',
                    courseData.instructor_id || null,
                    courseData.sections_count || 0,
                    courseData.lessons_count || 0,
                    courseData.duration || null,
                    courseData.difficulty_level || 'intermediate',
                    courseData.category || null,
                    JSON.stringify(courseData.tags || []),
                    courseData.downloaded_at || new Date().toISOString(),
                    courseData.last_accessed || new Date().toISOString(),
                    courseData.local_path || '',
                    courseData.version || 1,
                    courseData.expires_at || null,
                    courseData.is_synced !== undefined ? courseData.is_synced : 0
                ];
                return stmt.run(...values).lastInsertRowid;
            },
            getCourse(courseId) { return statements.getCourse.get(courseId); },
            getAllCourses() { return statements.getAllCourses.all(); },
            deleteCourse(courseId) { return statements.deleteCourse.run(courseId); },
            saveSection(sectionData) {
                const stmt = rawDb.prepare(`
                    INSERT OR REPLACE INTO sections (
                        section_id, course_id, title, description, order_index, lessons_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                return stmt.run(
                    sectionData.section_id, sectionData.course_id, sectionData.title,
                    sectionData.description || null, sectionData.order_index || 0,
                    sectionData.lessons_count || 0, sectionData.created_at || new Date().toISOString()
                ).lastInsertRowid;
            },
            getSections(courseId) { return statements.getSections.all(courseId); },
            updateLessonProgress(lessonId, progress, completed) {
                return statements.updateLessonProgress.run({
                    progress, completed: completed ? 1 : 0,
                    completed_check: completed ? 1 : 0, lesson_id: lessonId
                });
            },
            addToSyncQueue(entityType, entityId, action, data, priority) {
                const dataStr = data ? JSON.stringify(data) : null;
                return statements.addToSyncQueue.run(entityType, entityId, action, dataStr, priority || 5);
            },
            getUnsyncedItems(limit) { return statements.getUnsyncedItems.all(limit || 100); },
            markAsSynced(syncIds) {
                if (Array.isArray(syncIds)) {
                    const fn = rawDb.transaction(() => {
                        syncIds.forEach(id => statements.markAsSynced.run(id));
                    });
                    fn();
                } else {
                    statements.markAsSynced.run(syncIds);
                }
            },
            getStats() { return statements.getStats.get(); },
            searchCourses(query) {
                const q = `%${query}%`;
                const stmt = rawDb.prepare('SELECT * FROM courses WHERE title LIKE ? OR instructor_name LIKE ? OR description LIKE ? ORDER BY downloaded_at DESC');
                return stmt.all(q, q, q);
            },
            cleanupExpiredData() {
                const fn = rawDb.transaction(() => {
                    rawDb.prepare('DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP').run();
                    rawDb.prepare("DELETE FROM sync_log WHERE synced = 1 AND synced_at < date('now', '-30 days')").run();
                    rawDb.prepare("DELETE FROM usage_stats WHERE created_at < date('now', '-90 days')").run();
                });
                fn();
            }
        };
    });

    afterEach(() => {
        if (rawDb) rawDb.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('saveCourse() / getCourse()', () => {
        it('should save and retrieve a course', () => {
            db.saveCourse({
                course_id: 101,
                title: 'Test Course',
                instructor_name: 'Prof Smith',
                sections_count: 5,
                lessons_count: 20,
                downloaded_at: '2024-01-01T00:00:00Z',
                local_path: '/courses/101'
            });

            const course = db.getCourse(101);
            expect(course).to.exist;
            expect(course.course_id).to.equal(101);
            expect(course.title).to.equal('Test Course');
            expect(course.instructor_name).to.equal('Prof Smith');
            expect(course.sections_count).to.equal(5);
            expect(course.lessons_count).to.equal(20);
        });

        it('should update an existing course on re-save', () => {
            db.saveCourse({ course_id: 101, title: 'Original', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/c/1' });
            db.saveCourse({ course_id: 101, title: 'Updated', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/c/1' });

            const course = db.getCourse(101);
            expect(course.title).to.equal('Updated');
        });

        it('should return undefined for non-existent course', () => {
            const course = db.getCourse(9999);
            expect(course).to.be.undefined;
        });
    });

    describe('getAllCourses()', () => {
        it('should return all saved courses', () => {
            db.saveCourse({ course_id: 1, title: 'Course A', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/a' });
            db.saveCourse({ course_id: 2, title: 'Course B', downloaded_at: '2024-01-02T00:00:00Z', local_path: '/b' });
            db.saveCourse({ course_id: 3, title: 'Course C', downloaded_at: '2024-01-03T00:00:00Z', local_path: '/c' });

            const courses = db.getAllCourses();
            expect(courses).to.have.lengthOf(3);
        });

        it('should return empty array when no courses', () => {
            const courses = db.getAllCourses();
            expect(courses).to.be.an('array').that.is.empty;
        });
    });

    describe('deleteCourse()', () => {
        it('should remove a course', () => {
            db.saveCourse({ course_id: 101, title: 'ToDelete', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/d' });
            expect(db.getCourse(101)).to.exist;

            db.deleteCourse(101);
            expect(db.getCourse(101)).to.be.undefined;
        });

        it('should be a no-op for non-existent course', () => {
            const result = db.deleteCourse(9999);
            expect(result.changes).to.equal(0);
        });
    });

    describe('saveSection() / getSections()', () => {
        it('should save and retrieve sections for a course', () => {
            db.saveCourse({ course_id: 1, title: 'Course', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/c' });
            db.saveSection({ section_id: 10, course_id: 1, title: 'Section 1', order_index: 0 });
            db.saveSection({ section_id: 11, course_id: 1, title: 'Section 2', order_index: 1 });

            const sections = db.getSections(1);
            expect(sections).to.have.lengthOf(2);
            expect(sections[0].title).to.equal('Section 1');
            expect(sections[1].title).to.equal('Section 2');
        });

        it('should return empty array for course with no sections', () => {
            db.saveCourse({ course_id: 1, title: 'Course', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/c' });
            const sections = db.getSections(1);
            expect(sections).to.be.an('array').that.is.empty;
        });
    });

    describe('updateLessonProgress()', () => {
        beforeEach(() => {
            db.saveCourse({ course_id: 1, title: 'Course', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/c' });
            db.saveSection({ section_id: 10, course_id: 1, title: 'Section', order_index: 0 });
            rawDb.prepare(`
                INSERT INTO lessons (lesson_id, section_id, title, type, order_index)
                VALUES (100, 10, 'Lesson 1', 'video', 0)
            `).run();
        });

        it('should update lesson progress', () => {
            db.updateLessonProgress(100, 50, false);
            const lesson = db.statements.getLesson.get(100);
            expect(lesson.progress).to.equal(50);
            expect(lesson.completed).to.equal(0);
        });

        it('should mark lesson as completed', () => {
            db.updateLessonProgress(100, 100, true);
            const lesson = db.statements.getLesson.get(100);
            expect(lesson.progress).to.equal(100);
            expect(lesson.completed).to.equal(1);
            expect(lesson.completed_at).to.not.be.null;
        });
    });

    describe('addToSyncQueue() / getUnsyncedItems()', () => {
        it('should add items to sync queue', () => {
            db.addToSyncQueue('lesson', 100, 'progress', { progress: 50 }, 5);
            const items = db.getUnsyncedItems(10);
            expect(items).to.have.lengthOf(1);
            expect(items[0].entity_type).to.equal('lesson');
            expect(items[0].entity_id).to.equal(100);
            expect(items[0].action).to.equal('progress');
            expect(items[0].synced).to.equal(0);
        });

        it('should return empty array when nothing unsynced', () => {
            const items = db.getUnsyncedItems(10);
            expect(items).to.be.an('array').that.is.empty;
        });

        it('should respect limit parameter', () => {
            for (let i = 0; i < 5; i++) {
                db.addToSyncQueue('lesson', i, 'progress', null, 5);
            }
            const items = db.getUnsyncedItems(3);
            expect(items).to.have.lengthOf(3);
        });
    });

    describe('markAsSynced()', () => {
        it('should mark a single item as synced', () => {
            db.addToSyncQueue('lesson', 1, 'progress', null, 5);
            const items = db.getUnsyncedItems(10);
            expect(items).to.have.lengthOf(1);

            db.markAsSynced(items[0].id);

            const remaining = db.getUnsyncedItems(10);
            expect(remaining).to.have.lengthOf(0);
        });

        it('should mark multiple items as synced', () => {
            db.addToSyncQueue('lesson', 1, 'progress', null, 5);
            db.addToSyncQueue('lesson', 2, 'progress', null, 5);
            const items = db.getUnsyncedItems(10);
            const ids = items.map(i => i.id);

            db.markAsSynced(ids);

            const remaining = db.getUnsyncedItems(10);
            expect(remaining).to.have.lengthOf(0);
        });
    });

    describe('searchCourses()', () => {
        beforeEach(() => {
            db.saveCourse({ course_id: 1, title: 'JavaScript Basics', instructor_name: 'John Doe', description: 'Learn JS', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/a' });
            db.saveCourse({ course_id: 2, title: 'Python Advanced', instructor_name: 'Jane Smith', description: 'Advanced Python', downloaded_at: '2024-01-02T00:00:00Z', local_path: '/b' });
            db.saveCourse({ course_id: 3, title: 'React Guide', instructor_name: 'John Doe', description: 'React framework', downloaded_at: '2024-01-03T00:00:00Z', local_path: '/c' });
        });

        it('should find courses by title', () => {
            const results = db.searchCourses('JavaScript');
            expect(results).to.have.lengthOf(1);
            expect(results[0].title).to.equal('JavaScript Basics');
        });

        it('should find courses by instructor name', () => {
            const results = db.searchCourses('John Doe');
            expect(results).to.have.lengthOf(2);
        });

        it('should find courses by description', () => {
            const results = db.searchCourses('framework');
            expect(results).to.have.lengthOf(1);
            expect(results[0].title).to.equal('React Guide');
        });

        it('should return empty array for no matches', () => {
            const results = db.searchCourses('Nonexistent');
            expect(results).to.be.an('array').that.is.empty;
        });

        it('should be case-insensitive (SQLite LIKE)', () => {
            const results = db.searchCourses('javascript');
            expect(results).to.have.lengthOf(1);
        });
    });

    describe('getStats()', () => {
        it('should return correct counts', () => {
            db.saveCourse({ course_id: 1, title: 'C1', downloaded_at: '2024-01-01T00:00:00Z', local_path: '/a' });
            db.saveCourse({ course_id: 2, title: 'C2', downloaded_at: '2024-01-02T00:00:00Z', local_path: '/b' });
            db.addToSyncQueue('lesson', 1, 'progress', null, 5);

            const stats = db.getStats();
            expect(stats.courses).to.equal(2);
            expect(stats.unsynced).to.equal(1);
        });

        it('should return zero counts when empty', () => {
            const stats = db.getStats();
            expect(stats.courses).to.equal(0);
            expect(stats.lessons).to.equal(0);
            expect(stats.unsynced).to.equal(0);
        });
    });

    describe('cleanupExpiredData()', () => {
        it('should remove expired cache entries', () => {
            rawDb.prepare("INSERT INTO cache (key, value, expires_at) VALUES ('old', 'data', datetime('now', '-1 day'))").run();
            rawDb.prepare("INSERT INTO cache (key, value, expires_at) VALUES ('fresh', 'data', datetime('now', '+1 day'))").run();

            db.cleanupExpiredData();

            const remaining = rawDb.prepare('SELECT * FROM cache').all();
            expect(remaining).to.have.lengthOf(1);
            expect(remaining[0].key).to.equal('fresh');
        });

        it('should remove old synced sync_log entries', () => {
            rawDb.prepare("INSERT INTO sync_log (entity_type, entity_id, action, synced, synced_at) VALUES ('lesson', 1, 'progress', 1, datetime('now', '-60 days'))").run();
            rawDb.prepare("INSERT INTO sync_log (entity_type, entity_id, action, synced, synced_at) VALUES ('lesson', 2, 'progress', 1, datetime('now', '-1 day'))").run();
            rawDb.prepare("INSERT INTO sync_log (entity_type, entity_id, action, synced) VALUES ('lesson', 3, 'progress', 0)").run();

            db.cleanupExpiredData();

            const remaining = rawDb.prepare('SELECT * FROM sync_log').all();
            expect(remaining).to.have.lengthOf(2);
        });

        it('should remove old usage_stats entries', () => {
            rawDb.prepare("INSERT INTO usage_stats (event_type, created_at) VALUES ('view', datetime('now', '-100 days'))").run();
            rawDb.prepare("INSERT INTO usage_stats (event_type, created_at) VALUES ('view', datetime('now', '-1 day'))").run();

            db.cleanupExpiredData();

            const remaining = rawDb.prepare('SELECT * FROM usage_stats').all();
            expect(remaining).to.have.lengthOf(1);
        });
    });
});
