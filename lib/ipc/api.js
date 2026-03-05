const path = require('path');

function setupApiHandlers(ipcMain, context) {
  const {
    app,
    mainWindow,
    getApiClient
  } = context;

  ipcMain.handle('api-get-courses', async (event, { page, perPage }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getCourses(page, perPage);
    } catch (error) {
      console.error('Erreur lors de la récupération des cours:', error);
      return { success: false, error: error.message, courses: [] };
    }
  });

  ipcMain.handle('api-get-user-courses', async (event, filters) => {
    try {
        const apiClient = getApiClient();
        if (!apiClient) {
            console.error('[IPC] Client API non initialisé lors de getUserCourses');
            return { 
                success: false, 
                error: 'Client API non initialisé - Veuillez vous reconnecter', 
                courses: [] 
            };
        }
        
        // Vérifier que le client a un token
        if (!apiClient.token) {
            console.error('[IPC] Pas de token dans le client API');
            return { 
                success: false, 
                error: 'Token manquant - Veuillez vous reconnecter', 
                courses: [] 
            };
        }
        
        console.log('[IPC] Récupération des cours utilisateur...');
        console.log('[IPC] Token présent:', !!apiClient.token);
        console.log('[IPC] URL API:', apiClient.apiUrl);
        console.log('[IPC] Filtres:', filters);
        
        const result = await apiClient.getUserCourses(filters);
        console.log('[IPC] Résultat getUserCourses:', {
            success: result.success,
            coursesCount: result.courses?.length,
            error: result.error,
            errorCode: result.code,
            status: result.status
        });
        
        return result;
    } catch (error) {
        console.error('[IPC] Erreur lors de la récupération des cours:', error);
        console.error('[IPC] Stack trace:', error.stack);
        
        return { 
            success: false, 
            error: error.message || 'Erreur inconnue',
            errorDetails: {
                name: error.name,
                code: error.code,
                stack: error.stack
            },
            courses: [] 
        };
    }
  });

  ipcMain.handle('api-get-course-details', async (event, courseId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getCourseDetails(courseId);
    } catch (error) {
      console.error('Erreur lors de la récupération du cours:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-download-course', async (event, { courseId, options }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const downloadPath = path.join(app.getPath('userData'), 'courses', `course-${courseId}`);
      
      const result = await apiClient.downloadCourse(courseId, downloadPath, (progress) => {
        // Envoyer la progression au renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            courseId,
            ...progress
          });
        }
      }, options);
      
      return result;
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-get-lesson-content', async (event, lessonId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getLessonContent(lessonId);
    } catch (error) {
      console.error('Erreur lors de la récupération de la leçon:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-sync-progress', async (event, progressData) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.syncProgress(progressData);
    } catch (error) {
      console.error('Erreur lors de la synchronisation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-get-media-info', async (event, courseId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getMediaInfo(courseId);
    } catch (error) {
      console.error('Erreur lors de la récupération des médias:', error);
      return { success: false, error: error.message, media: [] };
    }
  });

  ipcMain.handle('api-download-media', async (event, { mediaUrl, lessonId }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const mediaPath = path.join(app.getPath('userData'), 'media', `lesson-${lessonId}`);
      const filename = path.basename(mediaUrl);
      const savePath = path.join(mediaPath, filename);
      
      const result = await apiClient.downloadMedia(mediaUrl, savePath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            type: 'media',
            lessonId,
            progress
          });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Erreur lors du téléchargement du média:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupApiHandlers };
