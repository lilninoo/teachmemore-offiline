function setupDownloadHandlers(ipcMain, context) {
  const {
    getApiClient,
    getDownloadManager
  } = context;

  ipcMain.handle('download:pauseDownload', async (event, downloadId) => {
    try {
        const downloadManager = getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        return await downloadManager.pauseDownload(downloadId);
    } catch (error) {
        console.error('Erreur pause download:', error);
        return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download:resumeDownload', async (event, downloadId) => {
    try {
        const downloadManager = getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        return await downloadManager.resumeDownload(downloadId);
    } catch (error) {
        console.error('Erreur resume download:', error);
        return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download:cancelDownload', async (event, downloadId) => {
    try {
        const downloadManager = getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        return await downloadManager.cancelDownload(downloadId);
    } catch (error) {
        console.error('Erreur cancel download:', error);
        return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download-course', async (event, { courseId, options }) => {
    try {
        const downloadManager = getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        
        // IMPORTANT: S'assurer que le downloadManager a un apiClient
        const apiClient = getApiClient();
        if (!apiClient) {
            throw new Error('Client API non initialisé - Veuillez vous reconnecter');
        }
        
        // Mettre à jour l'apiClient du downloadManager s'il n'est pas défini
        if (!downloadManager.apiClient) {
            console.log('[IPC] Mise à jour de l\'apiClient dans DownloadManager');
            downloadManager.apiClient = apiClient;
        }
        
        const result = await downloadManager.queueCourseDownload(courseId, options);
        console.log('[IPC] Résultat queueCourseDownload:', result);
        
        return result;
    } catch (error) {
        console.error('[IPC] Erreur lors du téléchargement:', error);
        return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cancel-download', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        throw new Error('Download manager non initialisé');
      }
      
      await downloadManager.cancelDownload(downloadId);
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de l\'annulation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-all-downloads', async () => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        return { success: true, downloads: [] };
      }
      
      const downloads = downloadManager.getAllDownloads();
      return { success: true, downloads };
    } catch (error) {
      console.error('Erreur lors de la récupération des téléchargements:', error);
      return { success: false, error: error.message, downloads: [] };
    }
  });

  ipcMain.handle('get-download-status', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        throw new Error('Download manager non initialisé');
      }
      
      const status = downloadManager.getDownloadStatus(downloadId);
      return { success: true, status };
    } catch (error) {
      console.error('Erreur lors de la récupération du statut:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pause-download', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) throw new Error('Download manager non initialisé');
      return await downloadManager.pauseDownload(downloadId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resume-download', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) throw new Error('Download manager non initialisé');
      return await downloadManager.resumeDownload(downloadId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('retry-download', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) throw new Error('Download manager non initialisé');
      return await downloadManager.retryDownload(downloadId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remove-from-history', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) throw new Error('Download manager non initialisé');
      return await downloadManager.removeFromHistory(downloadId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupDownloadHandlers };
