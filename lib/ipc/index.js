const { setupAuthHandlers } = require('./auth');
const { setupStoreHandlers } = require('./store');
const { setupApiHandlers } = require('./api');
const { setupDownloadHandlers } = require('./downloads');
const { setupDatabaseHandlers } = require('./database');
const { setupFileHandlers } = require('./files');
const { setupMediaHandlers } = require('./media');
const { setupSystemHandlers } = require('./system');

function setupIpcHandlers(ipcMain, context) {
  setupAuthHandlers(ipcMain, context);
  setupStoreHandlers(ipcMain, context);
  setupApiHandlers(ipcMain, context);
  setupDownloadHandlers(ipcMain, context);
  setupDatabaseHandlers(ipcMain, context);
  setupFileHandlers(ipcMain, context);
  setupMediaHandlers(ipcMain, context);
  setupSystemHandlers(ipcMain, context);
  console.log('[IPC] Gestionnaires IPC configurés avec succès');
}

module.exports = { setupIpcHandlers };
