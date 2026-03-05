let membershipCheckInterval = null;

function startMembershipCheck({ getApiClient, store, getMainWindow, config, log }) {
    checkMembershipStatus({ getApiClient, store, getMainWindow, config, log });
    
    membershipCheckInterval = setInterval(async () => {
        await checkMembershipStatus({ getApiClient, store, getMainWindow, config, log });
    }, config.membership.checkInterval);
}

function stopMembershipCheck() {
    if (membershipCheckInterval) {
        clearInterval(membershipCheckInterval);
        membershipCheckInterval = null;
    }
}

async function checkMembershipStatus({ getApiClient, store, getMainWindow, config, log }) {
    const apiClient = getApiClient();
    if (!apiClient || !apiClient.token) return;
    
    try {
        const lastCheck = store.get('lastMembershipCheck');
        const now = Date.now();
        
        if (lastCheck && (now - lastCheck) < 300000) {
            return;
        }
        
        log.info('Vérification du statut d\'abonnement...');
        const result = await apiClient.verifySubscription();
        
        store.set('lastMembershipCheck', now);
        
        if (result.success === false) {
            if (result.reason === 'unauthorized' || result.reason === 'refresh_token_expired') {
                log.warn('Token invalide détecté, tentative de refresh...');
                
                try {
                    const refreshResult = await apiClient.refreshAccessToken();
                    if (refreshResult.success) {
                        const retryResult = await apiClient.verifySubscription();
                        if (retryResult.success && retryResult.isActive) {
                            handleActiveMembership({ getMainWindow, config, store, log }, retryResult);
                            return;
                        }
                    }
                } catch (refreshError) {
                    log.error('Échec du refresh lors de la vérification membership:', refreshError);
                }
            }
            
            if (result.type === 'network_error') {
                log.warn('Erreur réseau lors de la vérification, ignorée');
                return;
            }
        }
        
        if (!result.success || !result.isActive) {
            handleInactiveMembership({ getMainWindow, config, store, log }, result);
        } else {
            handleActiveMembership({ getMainWindow, config, store, log }, result);
        }
        
    } catch (error) {
        log.error('Erreur lors de la vérification de l\'abonnement:', error);
        
        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            log.info('Connexion impossible, mode hors ligne activé');
            return;
        }
    }
}

function handleInactiveMembership({ getMainWindow, config, store, log }, result) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('membership-status-changed', {
            isActive: false,
            subscription: result.subscription
        });
    }
    
    applyMembershipRestrictions({ getMainWindow, config, store }, result.subscription);
}

function handleActiveMembership({ getMainWindow, config, store, log }, result) {
    removeMembershipRestrictions({ getMainWindow, store });
    
    if (result.subscription?.expires_at) {
        const expiresAt = new Date(result.subscription.expires_at);
        const daysUntilExpiry = Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry <= config.membership.warningDays && daysUntilExpiry > 0) {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('membership-expiring-soon', {
                    daysLeft: daysUntilExpiry,
                    expiresAt: result.subscription.expires_at
                });
            }
        }
    }
}

function applyMembershipRestrictions({ getMainWindow, config, store }, subscription) {
    const restrictions = {
        canDownloadPremium: false,
        canSync: false,
        maxCourses: config.membership.freeTierLimits.maxCourses,
        maxDownloadSize: config.membership.freeTierLimits.maxDownloadSize
    };
    
    if (store && store.set) {
        store.set('membershipRestrictions', restrictions);
    }
    
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('apply-restrictions', restrictions);
    }
}

function removeMembershipRestrictions({ getMainWindow, store }) {
    if (store && store.delete) {
        store.delete('membershipRestrictions');
    }
    
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remove-restrictions');
    }
}

module.exports = {
    startMembershipCheck,
    stopMembershipCheck,
    checkMembershipStatus,
    handleActiveMembership,
    handleInactiveMembership,
    applyMembershipRestrictions,
    removeMembershipRestrictions
};
