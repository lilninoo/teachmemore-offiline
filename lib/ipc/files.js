const path = require('path');
const fs = require('fs').promises;

function setupFileHandlers(ipcMain, context) {
  const {
    app,
    dialog,
    mainWindow
  } = context;

  function isPathWithinUserData(filePath) {
    const userDataPath = app.getPath('userData');
    const resolved = path.resolve(filePath);
    return resolved.startsWith(userDataPath + path.sep) || resolved === userDataPath;
  }

  ipcMain.handle('file-read', async (event, filePath) => {
    if (!isPathWithinUserData(filePath)) {
      console.warn(`[IPC] Blocked file-read outside userData: ${filePath}`);
      return { success: false, error: 'Access denied: path outside application data' };
    }
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-write', async (event, { filePath, data }) => {
    if (!isPathWithinUserData(filePath)) {
      console.warn(`[IPC] Blocked file-write outside userData: ${filePath}`);
      return { success: false, error: 'Access denied: path outside application data' };
    }
    try {
      await fs.writeFile(filePath, data, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-exists', async (event, filePath) => {
    if (!isPathWithinUserData(filePath)) {
      console.warn(`[IPC] Blocked file-exists outside userData: ${filePath}`);
      return false;
    }
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file-create-directory', async (event, dirPath) => {
    if (!isPathWithinUserData(dirPath)) {
      console.warn(`[IPC] Blocked file-create-directory outside userData: ${dirPath}`);
      return { success: false, error: 'Access denied: path outside application data' };
    }
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-delete', async (event, filePath) => {
    if (!isPathWithinUserData(filePath)) {
      console.warn(`[IPC] Blocked file-delete outside userData: ${filePath}`);
      return { success: false, error: 'Access denied: path outside application data' };
    }
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-get-media-path', (event, filename) => {
    return path.join(app.getPath('userData'), 'media', filename);
  });

  // ==================== DIALOGUES ====================

  ipcMain.handle('dialog-save', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-open', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-message', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-error', (event, { title, content }) => {
    dialog.showErrorBox(title, content);
    return { success: true };
  });
}

module.exports = { setupFileHandlers };
