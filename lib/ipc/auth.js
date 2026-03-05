function setupAuthHandlers(ipcMain, context) {
  const {
    store,
    deviceId,
    mainWindow,
    getApiClient,
    setApiClient
  } = context;

ipcMain.handle('check-auto-login', async () => {
    try {
        const token = store.get('token');
        const refreshToken = store.get('refreshToken');
        const tokenExpiry = store.get('tokenExpiry');
        const apiUrl = store.get('apiUrl');
        const username = store.get('username');
        
        console.log('[IPC] Check auto-login:', { 
            hasToken: !!token, 
            hasRefreshToken: !!refreshToken,
            tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : 'none',
            isExpired: tokenExpiry ? Date.now() > tokenExpiry : true,
            apiUrl,
            username 
        });
        
        if (!apiUrl) {
            console.log('[IPC] Pas d\'URL API configurée');
            return { success: false, reason: 'no_api_url' };
        }
        
        // NOUVEAU : Vérifier si le token est encore valide
        if (token && tokenExpiry && Date.now() < tokenExpiry) {
            console.log('[IPC] Token encore valide, utilisation directe');
            
            // Créer le client API avec le token existant
            const LearnPressAPIClient = require('../api-client');
            const apiClient = new LearnPressAPIClient(apiUrl, deviceId);
            apiClient.token = token;
            apiClient.refreshToken = refreshToken;
            
            // Vérifier rapidement que le token fonctionne
            try {
                const testResult = await apiClient.verifySubscription();
                if (testResult.success) {
                    setApiClient(apiClient);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('login-success', {
                            username: username,
                            displayName: username,
                            id: apiClient.userId
                        });
                    }
                    
                    return {
                        success: true,
                        username: username,
                        apiUrl: apiUrl,
                        isActive: testResult.isActive || false,
                        subscription: testResult.subscription || null
                    };
                }
            } catch (error) {
                console.log('[IPC] Token invalide, tentative de refresh');
            }
        }
        
        // Si on a un refresh token, essayer de l'utiliser
        if (refreshToken) {
            try {
                console.log('[IPC] Tentative de refresh token...');
                
                const LearnPressAPIClient = require('../api-client');
                const apiClient = new LearnPressAPIClient(apiUrl, deviceId);
                apiClient.refreshToken = refreshToken;
                
                const refreshResult = await apiClient.refreshAccessToken();
                
                if (refreshResult.success) {
                    console.log('[IPC] Refresh réussi');
                    
                    // Sauvegarder le nouveau token avec expiration
                    store.set('token', apiClient.token);
                    store.set('tokenExpiry', Date.now() + 3600000); // 1 heure
                    
                    if (apiClient.refreshToken !== refreshToken) {
                        store.set('refreshToken', apiClient.refreshToken);
                    }
                    
                    setApiClient(apiClient);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('login-success', {
                            username: username,
                            displayName: username,
                            id: apiClient.userId
                        });
                    }
                    
                    const verifyResult = await apiClient.verifySubscription();
                    
                    return {
                        success: true,
                        username: username,
                        apiUrl: apiUrl,
                        isActive: verifyResult.isActive || false,
                        subscription: verifyResult.subscription || null
                    };
                } else if (refreshResult.canRetry) {
                    // NOUVEAU : Proposer une reconnexion automatique
                    return {
                        success: false,
                        canAutoReconnect: true,
                        reason: 'refresh_failed_can_retry',
                        message: 'La session a expiré mais une reconnexion est possible'
                    };
                }
                
            } catch (refreshError) {
                console.error('[IPC] Échec du refresh:', refreshError.message);
                
                // NOUVEAU : Distinguer les types d'erreur
                if (refreshError.code === 'ENOTFOUND' || refreshError.code === 'ETIMEDOUT') {
                    return {
                        success: false,
                        error: 'network_error',
                        message: 'Impossible de se connecter au serveur',
                        canRetry: true
                    };
                }
            }
        }
        
        // Si on arrive ici, échec de l'auto-login
        console.log('[IPC] Auto-login échoué');
        
        // NOUVEAU : Ne pas supprimer les tokens immédiatement
        // Ils pourraient être valides mais le serveur est temporairement inaccessible
        
        return {
            success: false,
            error: 'authentication_failed',
            message: 'Impossible de restaurer votre session',
            requiresLogin: true,
            canRetry: true
        };
        
    } catch (error) {
        console.error('[IPC] Erreur auto-login:', error);
        
        return { 
            success: false, 
            error: error.message,
            requiresLogin: true
        };
    }
});

  ipcMain.handle('api-login', async (event, { apiUrl, username, password }) => {
    try {
        console.log('[IPC] Tentative de connexion...');
        
        // Nettoyer les anciens tokens avant la nouvelle connexion
        store.delete('token');
        store.delete('refreshToken');
        
        // Créer un nouveau client API
        const LearnPressAPIClient = require('../api-client');
        const apiClient = new LearnPressAPIClient(apiUrl, deviceId);
        
        const result = await apiClient.login(username, password);
        console.log('[IPC] Résultat de connexion:', result);
        
        if (result.success) {
            console.log('[IPC] Connexion réussie !');
            
            // Sauvegarder le client API AVANT de sauvegarder les tokens
            setApiClient(apiClient);
            
            // Sauvegarder les informations de connexion
            store.set('apiUrl', apiUrl);
            store.set('token', apiClient.token);
            store.set('refreshToken', apiClient.refreshToken);
            store.set('userId', apiClient.userId);
            store.set('username', username);
            
            // IMPORTANT : Envoyer l'événement de succès au renderer
            console.log('[IPC] Envoi de l\'événement login-success via event.sender');
            
            // Envoyer immédiatement via event.sender (connexion directe)
            event.sender.send('login-success', result.user);
            
            // Aussi essayer avec mainWindow si disponible (backup)
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('[IPC] Envoi aussi via mainWindow');
                mainWindow.webContents.send('login-success', result.user);
            }
            
            // Aussi essayer avec toutes les fenêtres (double backup)
            const { BrowserWindow } = require('electron');
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((window, index) => {
                if (!window.isDestroyed() && window.webContents) {
                    console.log(`[IPC] Envoi à la fenêtre ${index}`);
                    window.webContents.send('login-success', result.user);
                }
            });
            
            return {
                success: true,
                user: result.user,
                token: apiClient.token
            };
        }
        
        return result;
    } catch (error) {
        console.error('[IPC] Erreur de connexion:', error);
        return { 
            success: false, 
            error: error.message || 'Erreur de connexion'
        };
    }
  });

  ipcMain.handle('api-logout', async () => {
    try {
      const apiClient = getApiClient();
      if (apiClient) {
        await apiClient.logout();
      }
      
      // Nettoyer toutes les données
      store.delete('token');
      store.delete('refreshToken');
      store.delete('userId');
      store.delete('username');
      
      setApiClient(null);
      
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-refresh-token', async () => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const result = await apiClient.refreshAccessToken();
      
      if (result.success) {
        store.set('token', apiClient.token);
        if (apiClient.refreshToken) {
          store.set('refreshToken', apiClient.refreshToken);
        }
      }
      
      return result;
    } catch (error) {
      console.error('Erreur de rafraîchissement du token:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-verify-subscription', async () => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.verifySubscription();
    } catch (error) {
      console.error('Erreur de vérification:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupAuthHandlers };
