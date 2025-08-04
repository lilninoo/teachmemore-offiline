// notes-annotations.js - Système de notes et annotations pour les leçons

const { v4: uuidv4 } = require('uuid');

class NotesAnnotationsManager {
    constructor(database, encryption) {
        this.db = database;
        this.encryption = encryption;
        this.cache = new Map();
    }

    /**
     * Créer une nouvelle note
     */
    async createNote(lessonId, noteData) {
        try {
            const noteId = uuidv4();
            const timestamp = new Date().toISOString();
            
            const note = {
                id: noteId,
                lesson_id: lessonId,
                content: noteData.content,
                position: noteData.position || null,
                timestamp: noteData.timestamp || null, // Pour les notes vidéo
                color: noteData.color || '#ffeb3b',
                type: noteData.type || 'text', // text, highlight, bookmark
                tags: noteData.tags || [],
                created_at: timestamp,
                updated_at: timestamp,
                synced: false
            };

            // Chiffrer le contenu sensible
            const encryptedNote = {
                ...note,
                content_encrypted: this.encryption.encrypt(note.content, this.db.encryptionKey),
                tags: JSON.stringify(note.tags)
            };

            // Sauvegarder dans la base de données
            const stmt = this.db.db.prepare(`
                INSERT INTO notes (
                    id, lesson_id, content_encrypted, position, 
                    timestamp, color, type, tags, created_at, updated_at
                ) VALUES (
                    @id, @lesson_id, @content_encrypted, @position,
                    @timestamp, @color, @type, @tags, @created_at, @updated_at
                )
            `);

            stmt.run(encryptedNote);

            // Ajouter au cache
            this.cache.set(noteId, note);

            // Ajouter à la file de synchronisation
            this.db.addToSyncQueue('note', noteId, 'create', note);

            return { success: true, note };

        } catch (error) {
            console.error('Erreur lors de la création de la note:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Récupérer toutes les notes d'une leçon
     */
    async getNotesByLesson(lessonId) {
        try {
            const stmt = this.db.db.prepare(`
                SELECT * FROM notes 
                WHERE lesson_id = ? 
                ORDER BY position ASC, created_at DESC
            `);

            const notes = stmt.all(lessonId);

            return notes.map(note => ({
                ...note,
                content: this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey),
                tags: JSON.parse(note.tags || '[]')
            }));

        } catch (error) {
            console.error('Erreur lors de la récupération des notes:', error);
            return [];
        }
    }

    /**
     * Mettre à jour une note
     */
    async updateNote(noteId, updates) {
        try {
            const stmt = this.db.db.prepare('SELECT * FROM notes WHERE id = ?');
            const existingNote = stmt.get(noteId);

            if (!existingNote) {
                return { success: false, error: 'Note non trouvée' };
            }

            const updatedNote = {
                ...existingNote,
                ...updates,
                updated_at: new Date().toISOString()
            };

            if (updates.content) {
                updatedNote.content_encrypted = this.encryption.encrypt(
                    updates.content, 
                    this.db.encryptionKey
                );
            }

            if (updates.tags) {
                updatedNote.tags = JSON.stringify(updates.tags);
            }

            const updateStmt = this.db.db.prepare(`
                UPDATE notes SET
                    content_encrypted = @content_encrypted,
                    position = @position,
                    timestamp = @timestamp,
                    color = @color,
                    type = @type,
                    tags = @tags,
                    updated_at = @updated_at
                WHERE id = @id
            `);

            updateStmt.run({
                ...updatedNote,
                id: noteId
            });

            // Mettre à jour le cache
            this.cache.set(noteId, updatedNote);

            // Ajouter à la file de synchronisation
            this.db.addToSyncQueue('note', noteId, 'update', updates);

            return { success: true, note: updatedNote };

        } catch (error) {
            console.error('Erreur lors de la mise à jour de la note:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Supprimer une note
     */
    async deleteNote(noteId) {
        try {
            const stmt = this.db.db.prepare('DELETE FROM notes WHERE id = ?');
            const result = stmt.run(noteId);

            if (result.changes > 0) {
                // Retirer du cache
                this.cache.delete(noteId);

                // Ajouter à la file de synchronisation
                this.db.addToSyncQueue('note', noteId, 'delete');

                return { success: true };
            }

            return { success: false, error: 'Note non trouvée' };

        } catch (error) {
            console.error('Erreur lors de la suppression de la note:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Créer une annotation (surlignage)
     */
    async createHighlight(lessonId, highlightData) {
        const noteData = {
            content: highlightData.text,
            position: highlightData.startOffset,
            color: highlightData.color || '#ffeb3b',
            type: 'highlight',
            metadata: {
                startOffset: highlightData.startOffset,
                endOffset: highlightData.endOffset,
                startContainer: highlightData.startContainer,
                endContainer: highlightData.endContainer
            }
        };

        return this.createNote(lessonId, noteData);
    }

    /**
     * Créer un marque-page
     */
    async createBookmark(lessonId, bookmarkData) {
        const noteData = {
            content: bookmarkData.title || 'Marque-page',
            position: bookmarkData.position,
            timestamp: bookmarkData.timestamp,
            type: 'bookmark',
            color: '#4299e1'
        };

        return this.createNote(lessonId, noteData);
    }

    /**
     * Rechercher dans les notes
     */
    async searchNotes(query, options = {}) {
        try {
            const searchQuery = `%${query}%`;
            let sql = 'SELECT * FROM notes WHERE 1=1';
            const params = [];

            // Recherche dans le contenu (nécessite de déchiffrer)
            const allNotes = this.db.db.prepare('SELECT * FROM notes').all();
            
            const results = allNotes.filter(note => {
                const content = this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey);
                const tags = JSON.parse(note.tags || '[]');
                
                // Recherche dans le contenu
                if (content.toLowerCase().includes(query.toLowerCase())) {
                    return true;
                }
                
                // Recherche dans les tags
                if (tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))) {
                    return true;
                }
                
                return false;
            });

            // Appliquer les filtres
            let filtered = results;

            if (options.lessonId) {
                filtered = filtered.filter(note => note.lesson_id === options.lessonId);
            }

            if (options.type) {
                filtered = filtered.filter(note => note.type === options.type);
            }

            if (options.color) {
                filtered = filtered.filter(note => note.color === options.color);
            }

            if (options.startDate) {
                filtered = filtered.filter(note => 
                    new Date(note.created_at) >= new Date(options.startDate)
                );
            }

            if (options.endDate) {
                filtered = filtered.filter(note => 
                    new Date(note.created_at) <= new Date(options.endDate)
                );
            }

            // Trier les résultats
            if (options.sortBy === 'date') {
                filtered.sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at)
                );
            } else if (options.sortBy === 'position') {
                filtered.sort((a, b) => a.position - b.position);
            }

            // Déchiffrer le contenu pour le retour
            return filtered.map(note => ({
                ...note,
                content: this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey),
                tags: JSON.parse(note.tags || '[]')
            }));

        } catch (error) {
            console.error('Erreur lors de la recherche des notes:', error);
            return [];
        }
    }

    /**
     * Obtenir toutes les notes d'un cours
     */
    async getNotesByCourse(courseId) {
        try {
            const stmt = this.db.db.prepare(`
                SELECT n.* 
                FROM notes n
                JOIN lessons l ON n.lesson_id = l.lesson_id
                JOIN sections s ON l.section_id = s.section_id
                WHERE s.course_id = ?
                ORDER BY s.order_index, l.order_index, n.position
            `);

            const notes = stmt.all(courseId);

            return notes.map(note => ({
                ...note,
                content: this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey),
                tags: JSON.parse(note.tags || '[]')
            }));

        } catch (error) {
            console.error('Erreur lors de la récupération des notes du cours:', error);
            return [];
        }
    }

    /**
     * Exporter les notes
     */
    async exportNotes(courseId, format = 'json') {
        try {
            const notes = await this.getNotesByCourse(courseId);

            if (format === 'json') {
                return JSON.stringify(notes, null, 2);
            } else if (format === 'markdown') {
                let markdown = `# Notes du cours\n\n`;
                let currentLesson = null;

                for (const note of notes) {
                    if (note.lesson_id !== currentLesson) {
                        const lesson = this.db.db.prepare(
                            'SELECT title FROM lessons WHERE lesson_id = ?'
                        ).get(note.lesson_id);
                        
                        markdown += `\n## ${lesson?.title || 'Leçon'}\n\n`;
                        currentLesson = note.lesson_id;
                    }

                    if (note.type === 'highlight') {
                        markdown += `> **Surlignage:** ${note.content}\n\n`;
                    } else if (note.type === 'bookmark') {
                        markdown += `- **Marque-page:** ${note.content}`;
                        if (note.timestamp) {
                            markdown += ` (${this.formatTimestamp(note.timestamp)})`;
                        }
                        markdown += '\n\n';
                    } else {
                        markdown += `### Note\n${note.content}\n\n`;
                        if (note.tags.length > 0) {
                            markdown += `**Tags:** ${note.tags.join(', ')}\n\n`;
                        }
                    }
                }

                return markdown;
            } else if (format === 'html') {
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Notes du cours</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            .note { margin-bottom: 20px; padding: 15px; border-left: 3px solid; }
                            .highlight { background-color: #fffacd; border-color: #ffd700; }
                            .bookmark { background-color: #e3f2fd; border-color: #2196f3; }
                            .text-note { background-color: #f5f5f5; border-color: #666; }
                            .tags { font-size: 0.9em; color: #666; }
                            h2 { color: #333; margin-top: 30px; }
                        </style>
                    </head>
                    <body>
                        <h1>Notes du cours</h1>
                `;

                let currentLesson = null;

                for (const note of notes) {
                    if (note.lesson_id !== currentLesson) {
                        const lesson = this.db.db.prepare(
                            'SELECT title FROM lessons WHERE lesson_id = ?'
                        ).get(note.lesson_id);
                        
                        html += `<h2>${lesson?.title || 'Leçon'}</h2>`;
                        currentLesson = note.lesson_id;
                    }

                    const noteClass = note.type === 'highlight' ? 'highlight' : 
                                     note.type === 'bookmark' ? 'bookmark' : 'text-note';

                    html += `<div class="note ${noteClass}">`;
                    html += `<p>${note.content}</p>`;
                    
                    if (note.timestamp) {
                        html += `<p><small>Position: ${this.formatTimestamp(note.timestamp)}</small></p>`;
                    }
                    
                    if (note.tags.length > 0) {
                        html += `<p class="tags">Tags: ${note.tags.join(', ')}</p>`;
                    }
                    
                    html += `</div>`;
                }

                html += `</body></html>`;
                return html;
            }

            return null;

        } catch (error) {
            console.error('Erreur lors de l\'export des notes:', error);
            return null;
        }
    }

    /**
     * Importer des notes
     */
    async importNotes(data, format = 'json') {
        try {
            let notes = [];

            if (format === 'json') {
                notes = JSON.parse(data);
            } else {
                return { success: false, error: 'Format non supporté' };
            }

            let imported = 0;
            let errors = 0;

            for (const note of notes) {
                try {
                    await this.createNote(note.lesson_id, {
                        content: note.content,
                        position: note.position,
                        timestamp: note.timestamp,
                        color: note.color,
                        type: note.type,
                        tags: note.tags
                    });
                    imported++;
                } catch (error) {
                    console.error('Erreur lors de l\'import de la note:', error);
                    errors++;
                }
            }

            return {
                success: true,
                imported,
                errors,
                total: notes.length
            };

        } catch (error) {
            console.error('Erreur lors de l\'import des notes:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Synchroniser les notes avec le serveur
     */
    async syncNotes(apiClient) {
        try {
            // Récupérer les notes non synchronisées
            const unsyncedNotes = this.db.db.prepare(
                'SELECT * FROM notes WHERE synced = 0'
            ).all();

            if (unsyncedNotes.length === 0) {
                return { success: true, synced: 0 };
            }

            // Préparer les données pour l'envoi
            const notesData = unsyncedNotes.map(note => ({
                id: note.id,
                lesson_id: note.lesson_id,
                content: this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey),
                position: note.position,
                timestamp: note.timestamp,
                color: note.color,
                type: note.type,
                tags: JSON.parse(note.tags || '[]'),
                created_at: note.created_at,
                updated_at: note.updated_at
            }));

            // Envoyer au serveur
            const result = await apiClient.syncNotes(notesData);

            if (result.success) {
                // Marquer comme synchronisées
                const stmt = this.db.db.prepare(
                    'UPDATE notes SET synced = 1 WHERE id = ?'
                );

                for (const note of unsyncedNotes) {
                    stmt.run(note.id);
                }

                return { success: true, synced: unsyncedNotes.length };
            }

            return { success: false, error: result.error };

        } catch (error) {
            console.error('Erreur lors de la synchronisation des notes:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Formater un timestamp en format lisible
     */
    formatTimestamp(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Obtenir les statistiques des notes
     */
    async getNotesStats(courseId = null) {
        try {
            let query = 'SELECT COUNT(*) as total, type FROM notes';
            const params = [];

            if (courseId) {
                query += `
                    JOIN lessons l ON notes.lesson_id = l.lesson_id
                    JOIN sections s ON l.section_id = s.section_id
                    WHERE s.course_id = ?
                `;
                params.push(courseId);
            }

            query += ' GROUP BY type';

            const stats = this.db.db.prepare(query).all(...params);

            const result = {
                total: 0,
                byType: {},
                recentNotes: []
            };

            for (const stat of stats) {
                result.total += stat.total;
                result.byType[stat.type] = stat.total;
            }

            // Récupérer les notes récentes
            let recentQuery = 'SELECT * FROM notes';
            if (courseId) {
                recentQuery += `
                    JOIN lessons l ON notes.lesson_id = l.lesson_id
                    JOIN sections s ON l.section_id = s.section_id
                    WHERE s.course_id = ?
                `;
            }
            recentQuery += ' ORDER BY created_at DESC LIMIT 5';

            result.recentNotes = this.db.db.prepare(recentQuery).all(...params).map(note => ({
                ...note,
                content: this.encryption.decrypt(note.content_encrypted, this.db.encryptionKey),
                tags: JSON.parse(note.tags || '[]')
            }));

            return result;

        } catch (error) {
            console.error('Erreur lors de la récupération des stats:', error);
            return { total: 0, byType: {}, recentNotes: [] };
        }
    }
}

module.exports = NotesAnnotationsManager;
