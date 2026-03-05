function setupStoreHandlers(ipcMain, context) {
  const { store } = context;

  const SENSITIVE_STORE_KEYS = ['token', 'refreshToken', 'tokenExpiry', 'lastMembershipCheck'];
  const ALLOWED_STORE_KEYS = [
    'apiUrl', 'savedApiUrl', 'savedUsername', 'userId', 'username',
    'lastSync', 'autoSync', 'theme', 'language', 'windowBounds',
    'membershipRestrictions', 'debugMode'
  ];

  ipcMain.handle('store-get', (event, key) => {
    if (SENSITIVE_STORE_KEYS.includes(key)) {
      console.warn(`[IPC] Blocked store-get for sensitive key: ${key}`);
      return undefined;
    }
    return store.get(key);
  });

  ipcMain.handle('store-set', (event, key, value) => {
    if (SENSITIVE_STORE_KEYS.includes(key)) {
      console.warn(`[IPC] Blocked store-set for sensitive key: ${key}`);
      return { success: false, error: 'Cannot modify sensitive data from renderer' };
    }
    store.set(key, value);
    return { success: true };
  });

  ipcMain.handle('store-delete', (event, key) => {
    if (SENSITIVE_STORE_KEYS.includes(key)) {
      console.warn(`[IPC] Blocked store-delete for sensitive key: ${key}`);
      return { success: false, error: 'Cannot delete sensitive data from renderer' };
    }
    store.delete(key);
    return { success: true };
  });

  ipcMain.handle('store-clear', () => {
    store.clear();
    return { success: true };
  });
}

module.exports = { setupStoreHandlers };
