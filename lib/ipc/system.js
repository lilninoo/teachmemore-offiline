const path = require('path');
const fs = require('fs').promises;

function setupSystemHandlers(ipcMain, context) {
  const {
    store,
    deviceId,
    app,
    mainWindow,
    getApiClient,
    getDatabase,
    getDownloadManager,
    errorHandler,
    config
  } = context;

  ipcMain.handle('get-device-id', () => {
    return deviceId;
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-app-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('check-internet', async () => {
    const { net } = require('electron');
    return net.isOnline();
  });

  ipcMain.handle('log-error', async (event, error) => {
    await errorHandler.handleError(error, { source: 'renderer' });
    return { success: true };
  });

  ipcMain.handle('report-error', async (event, error) => {
    await errorHandler.handleError(error, { source: 'renderer' });
    return { success: true };
  });

  ipcMain.handle('save-log', async (event, logEntry) => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      const { existsSync, mkdirSync, appendFileSync } = require('fs');
      
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      
      const logFile = path.join(logsDir, `renderer-${new Date().toISOString().split('T')[0]}.log`);
      const logLine = `${logEntry.timestamp} [${logEntry.level}] ${logEntry.message}\n`;
      
      appendFileSync(logFile, logLine);
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du log:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        console.warn(`[IPC] Blocked open-external for non-HTTPS URL: ${url}`);
        return { success: false, error: 'Only HTTPS URLs are allowed' };
      }
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Invalid URL for open-external:', url);
      return { success: false, error: 'Invalid URL' };
    }
  });

  ipcMain.handle('get-membership-restrictions', () => {
    return store.get('membershipRestrictions') || null;
  });

  ipcMain.handle('check-feature-access', (event, feature) => {
    const restrictions = store.get('membershipRestrictions');
    if (!restrictions) return true;
    
    return config.isFeatureEnabled(feature, { is_active: !restrictions });
  });

  ipcMain.handle('get-error-logs', () => {
    return errorHandler.getRecentErrors();
  });

  ipcMain.handle('show-notification', (event, options) => {
    const { Notification } = require('electron');
    
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title || 'LearnPress Offline',
        body: options.body,
        icon: path.join(__dirname, '..', '..', 'assets/icons/icon.png'),
        silent: options.silent || false
      });
      
      notification.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      
      notification.show();
    }
    
    return { success: true };
  });

  ipcMain.handle('export-certificate-pdf', async (event, certificateData) => {
    try {
      // Fonctionnalité à implémenter avec une librairie PDF
      return { 
        success: false, 
        error: 'Fonctionnalité en cours de développement' 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('system-get-info', async () => {
    try {
      const os = require('os');
      return {
        success: true,
        info: {
          platform: process.platform,
          version: os.release(),
          arch: process.arch,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpus: os.cpus().length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-system-info', async () => {
    try {
      const os = require('os');
      return {
        success: true,
        info: {
          platform: process.platform,
          version: os.release(),
          arch: process.arch,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpus: os.cpus().length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-storage-info', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const fsStat = require('fs');
      let totalSize = 0;
      const walkDir = async (dir) => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isFile()) {
              const stat = await fs.stat(entryPath);
              totalSize += stat.size;
            } else if (entry.isDirectory() && entry.name !== 'node_modules') {
              await walkDir(entryPath);
            }
          }
        } catch (e) { /* skip inaccessible dirs */ }
      };
      await walkDir(userDataPath);
      return { success: true, info: { usedSpace: totalSize, path: userDataPath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('debug-info', () => {
    return {
      apiClient: !!getApiClient(),
      database: !!getDatabase(),
      downloadManager: !!getDownloadManager(),
      mainWindow: !!mainWindow && !mainWindow.isDestroyed(),
      store: !!store,
      tokens: {
        hasToken: !!store.get('token'),
        hasRefreshToken: !!store.get('refreshToken')
      }
    };
  });

  // Ajouter un écouteur pour les événements du renderer
  ipcMain.on('renderer-log', (event, level, message, data) => {
    console.log(`[Renderer ${level}] ${message}`, data || '');
  });

  // Gestionnaire pour forcer l'envoi d'événements (debug)
  ipcMain.handle('force-emit-event', (event, eventName, data) => {
    const allowedEvents = [
      'sync-courses', 'sync-completed', 'sync-error',
      'download-progress', 'download-completed', 'download-error',
      'download-cancelled', 'course-downloaded',
      'membership-status-changed', 'membership-expiring-soon',
      'connection-status-changed', 'update-progress'
    ];
    if (!allowedEvents.includes(eventName)) {
      console.warn(`[IPC] Blocked force-emit-event for disallowed channel: ${eventName}`);
      return { success: false, error: `Event '${eventName}' is not allowed` };
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(eventName, data);
      return { success: true };
    }
    return { success: false, error: 'mainWindow non disponible' };
  });
}

module.exports = { setupSystemHandlers };
