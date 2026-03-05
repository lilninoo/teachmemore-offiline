const path = require('path');
const fs = require('fs').promises;

function setupDatabaseHandlers(ipcMain, context) {
  const {
    app,
    getDatabase
  } = context;

  ipcMain.handle('db-save-course', async (event, courseData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveCourse(courseData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-course', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getCourse(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-all-courses', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getAllCourses() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-update-course-access', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.updateCourseAccess(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-delete-course', async (event, courseId) => {
    const db = getDatabase();
    
    // Supprimer aussi les fichiers
    const coursePath = path.join(app.getPath('userData'), 'courses', `course-${courseId}`);
    try {
      await fs.rmdir(coursePath, { recursive: true });
    } catch (error) {
      console.error('Erreur lors de la suppression des fichiers:', error);
    }
    
    try {
      return { success: true, result: db.deleteCourse(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-search-courses', async (event, query) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.searchCourses(query) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-course-progress', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getCourseProgress(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-section', async (event, sectionData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveSection(sectionData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-sections', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getSections(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-lesson', async (event, lessonData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveLesson(lessonData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-lesson', async (event, lessonId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getLesson(lessonId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-lessons', async (event, sectionId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getLessons(sectionId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-update-lesson-progress', async (event, payload = {}) => {
    const db = getDatabase();
    const { lessonId, progress, completed } = payload;
    if (typeof lessonId === 'undefined') {
      return { success: false, error: 'lessonId manquant pour mise à jour de progression' };
    }
    try {
      return { success: true, result: db.updateLessonProgress(lessonId, progress, completed) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-media', async (event, mediaData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveMedia(mediaData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-media', async (event, mediaId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getMedia(mediaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-media-by-lesson', async (event, lessonId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getMediaByLesson(lessonId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // NOUVELLES MÉTHODES POUR LES MÉDIAS
  ipcMain.handle('db:getLessonMedia', async (event, lessonId) => {
    try {
      console.log('[IPC] Récupération des médias pour la leçon:', lessonId);
      const db = getDatabase();
      const media = db.getLessonMedia(lessonId);
      return { success: true, media };
    } catch (error) {
      console.error('[IPC] Erreur getLessonMedia:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:getLessonWithMedia', async (event, lessonId) => {
    try {
      console.log('[IPC] Récupération de la leçon avec médias:', lessonId);
      const db = getDatabase();
      const lesson = db.getLessonWithMedia(lessonId);
      return { success: true, result: lesson };
    } catch (error) {
      console.error('[IPC] Erreur getLessonWithMedia:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-quiz', async (event, quizData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveQuiz(quizData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-quiz', async (event, quizId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getQuiz(quizId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-quiz-attempt', async (event, { quizId, answers, score }) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveQuizAttempt(quizId, answers, score) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-unsynced-items', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getUnsyncedItems() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-mark-as-synced', async (event, syncIds) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.markAsSynced(syncIds) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-expired-courses', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getExpiredCourses() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-cleanup-expired-data', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.cleanupExpiredData() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-add-to-sync-queue', async (event, { entityType, entityId, action, data }) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.addToSyncQueue(entityType, entityId, action, data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-stats', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupDatabaseHandlers };
