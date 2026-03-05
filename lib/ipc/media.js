function setupMediaHandlers(ipcMain, context) {
  const { getSecureMediaPlayer } = context;

  ipcMain.handle('create-stream-url', async (event, { filePath, mimeType }) => {
    try {
      const { getMediaPlayer } = context;
      const mediaPlayer = getMediaPlayer();
      
      if (!mediaPlayer) {
        throw new Error('Media player non initialisé');
      }
      
      const streamUrl = await mediaPlayer.createStreamUrl(filePath, mimeType);
      return { success: true, url: streamUrl };
    } catch (error) {
      console.error('Erreur lors de la création du stream:', error);
      return { success: false, error: error.message };
    }
  });

  // NOUVELLES MÉTHODES POUR LE SECURE MEDIA PLAYER
  ipcMain.handle('media:createStreamUrl', async (event, encryptedPath, mimeType) => {
    try {
      console.log('[IPC] Création URL de streaming pour:', encryptedPath);

      const { getSecureMediaPlayer } = context;
      if (typeof getSecureMediaPlayer !== 'function') {
        console.error('[IPC] getSecureMediaPlayer n\'est pas une fonction', getSecureMediaPlayer);
        throw new Error('SecureMediaPlayer non disponible');
      }

      const secureMediaPlayer = await getSecureMediaPlayer();
      const streamUrl = await secureMediaPlayer.createStreamUrl(encryptedPath, mimeType);
      console.log('[IPC] URL de streaming créée:', streamUrl);

      return { success: true, url: streamUrl };
    } catch (error) {
      console.error('[IPC] Erreur createStreamUrl:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('media:decryptFile', async (event, encryptedPath, outputPath) => {
    try {
      console.log('[IPC] Déchiffrement du fichier:', encryptedPath);

      if (typeof getSecureMediaPlayer !== 'function') {
        throw new Error('SecureMediaPlayer non disponible');
      }

      const secureMediaPlayer = await getSecureMediaPlayer(); // await ici
      if (!secureMediaPlayer) {
        throw new Error('Instance de SecureMediaPlayer introuvable');
      }

      const result = await secureMediaPlayer.decryptFile(encryptedPath, outputPath);
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] Erreur decryptFile:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupMediaHandlers };
