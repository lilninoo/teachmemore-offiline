// auth.js - Gestion complète de l'authentification avec LOGS DÉTAILLÉS

// État d'authentification global
window.AuthState = {
    isLoggedIn: false,
    user: null,
    apiUrl: null
};

// Système de logging visible dans la console Electron
const AuthLogger = {
    log: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[Auth ${timestamp}] ${message}`;
        console.log(logMessage, data || '');
        
        // Utiliser la méthode db.log au lieu de send
        if (window.electronAPI && window.electronAPI.db && window.electronAPI.db.log) {
            window.electronAPI.db.log('INFO', logMessage, data);
        }
    },
    error: (message, error = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[Auth ERROR ${timestamp}] ${message}`;
        console.error(logMessage, error || '');
        
        if (window.electronAPI && window.electronAPI.db && window.electronAPI.db.log) {
            window.electronAPI.db.log('ERROR', logMessage, error);
        }
    },
    warn: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[Auth WARN ${timestamp}] ${message}`;
        console.warn(logMessage, data || '');
        
        if (window.electronAPI && window.electronAPI.db && window.electronAPI.db.log) {
            window.electronAPI.db.log('WARN', logMessage, data);
        }
    }
};

// Afficher un message de démarrage visible
console.log('%c🔐 AUTH MODULE STARTING...', 'background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px;');
AuthLogger.log('Initialisation du module d\'authentification');

// IMPORTANT : Configurer l'écouteur IMMÉDIATEMENT au chargement du script
AuthLogger.log('Configuration de l\'écouteur login-success');

// Variable pour éviter les appels multiples
// Variable pour éviter les appels multiples
let loginEventProcessed = false;
let courseLoadingInProgress = false;

// Configurer l'écouteur UNE SEULE FOIS
if (!window._authEventListenerConfigured) {
    window._authEventListenerConfigured = true;
    
    window.electronAPI.on('login-success', async (user) => {
        // Éviter le traitement multiple
        if (loginEventProcessed) {
            AuthLogger.log('Événement login-success ignoré (déjà traité)');
            return;
        }
        
        loginEventProcessed = true;
        AuthLogger.log('✅ Événement login-success reçu !', user);
        
        window.AuthState.isLoggedIn = true;
        window.AuthState.user = user;
        
        // Forcer la transition immédiatement
        const loginPage = document.getElementById('login-page');
        const dashboardPage = document.getElementById('dashboard-page');
        
        if (loginPage) {
            loginPage.style.display = 'none';
            loginPage.classList.remove('active');
        }
        
        if (dashboardPage) {
            dashboardPage.style.display = 'block';
            dashboardPage.classList.remove('hidden');
            dashboardPage.classList.add('active');
        }
        
        // Mettre à jour le nom d'utilisateur
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName) {
            userDisplayName.textContent = user.displayName || user.username || 'Utilisateur';
        }
        
        // Désactiver le loader
        setLoginLoading(false);
        
        // Charger les cours UNE SEULE FOIS
        if (!courseLoadingInProgress && window.loadCourses) {
            courseLoadingInProgress = true;
            
            try {
                await window.loadCourses();
                AuthLogger.log('Cours chargés avec succès');
            } catch (error) {
                AuthLogger.error('Erreur lors du chargement des cours', error);
            } finally {
                courseLoadingInProgress = false;
            }
        }
        
        // Réinitialiser après un délai pour permettre une nouvelle connexion
        setTimeout(() => {
            loginEventProcessed = false;
        }, 5000);
    });
}

// Vérifier l'auto-login au chargement
document.addEventListener('DOMContentLoaded', async () => {
    AuthLogger.log('DOM chargé, vérification de l\'auto-login...');
    
    // Afficher l'état initial
    console.log('%c📊 ÉTAT INITIAL', 'background: #2196F3; color: white; padding: 5px;');
    console.table({
        'electronAPI disponible': !!window.electronAPI,
        'checkAutoLogin disponible': !!(window.electronAPI && window.electronAPI.checkAutoLogin),
        'Login page visible': document.getElementById('login-page')?.style.display,
        'Dashboard visible': document.getElementById('dashboard-page')?.style.display
    });
    
    try {
        const autoLoginResult = await window.electronAPI.checkAutoLogin();
        AuthLogger.log('Résultat auto-login:', autoLoginResult);
        
        if (autoLoginResult.success) {
            AuthLogger.log('✅ Auto-login réussi');
            
            window.AuthState.isLoggedIn = true;
            window.AuthState.user = { username: autoLoginResult.username };
            window.AuthState.apiUrl = autoLoginResult.apiUrl;
            
            showDashboard();
            
            // Charger les cours après un court délai
            setTimeout(async () => {
                if (window.loadCourses) {
                    try {
                        await window.loadCourses();
                        AuthLogger.log('Cours chargés via auto-login');
                    } catch (error) {
                        AuthLogger.error('Erreur chargement cours', error);
                    }
                }
            }, 500);
            
            return;
        }
    } catch (error) {
        AuthLogger.error('Erreur auto-login', error);
    }
    
    AuthLogger.log('Affichage de la page de connexion');
    showLoginPage();
    await restoreLoginForm();
    setupLoginForm();
});

// Afficher la page de connexion
function showLoginPage() {
    AuthLogger.log('Affichage page de connexion');
    
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    
    if (loginPage) {
        loginPage.style.display = 'block';
        loginPage.classList.remove('hidden');
        loginPage.classList.add('active');
    }
    
    if (dashboardPage) {
        dashboardPage.style.display = 'none';
        dashboardPage.classList.add('hidden');
        dashboardPage.classList.remove('active');
    }
    
    console.log('%c🔓 PAGE DE LOGIN ACTIVE', 'background: #FF9800; color: white; padding: 5px;');
}

// Afficher le dashboard
function showDashboard() {
    AuthLogger.log('Affichage du dashboard');
    
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    
    if (loginPage) {
        loginPage.style.display = 'none';
        loginPage.classList.remove('active');
        loginPage.classList.add('hidden');
    }
    
    if (dashboardPage) {
        dashboardPage.style.display = 'block';
        dashboardPage.classList.remove('hidden');
        dashboardPage.classList.add('active');
    }
    
    // Afficher le nom d'utilisateur
    const userDisplayName = document.getElementById('user-display-name');
    if (userDisplayName && window.AuthState.user) {
        userDisplayName.textContent = window.AuthState.user.displayName || 
                                     window.AuthState.user.username || 
                                     'Utilisateur';
    }
    
    console.log('%c🏠 DASHBOARD ACTIF', 'background: #4CAF50; color: white; padding: 5px;');
}

// Restaurer les valeurs du formulaire
async function restoreLoginForm() {
    AuthLogger.log('Restauration du formulaire de connexion...');
    
    try {
        const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
        const savedUsername = await window.electronAPI.store.get('savedUsername');
        
        AuthLogger.log('Valeurs sauvegardées:', { savedApiUrl, savedUsername });
        
        const apiUrlInput = document.getElementById('api-url');
        const usernameInput = document.getElementById('username');
        const rememberCheckbox = document.getElementById('remember-me');
        
        if (savedApiUrl && apiUrlInput) {
            apiUrlInput.value = savedApiUrl;
        }
        
        if (savedUsername && usernameInput) {
            usernameInput.value = savedUsername;
            if (rememberCheckbox) {
                rememberCheckbox.checked = true;
            }
        }
        
        // Focus sur le premier champ vide
        const passwordInput = document.getElementById('password');
        if (!apiUrlInput.value && apiUrlInput) {
            apiUrlInput.focus();
        } else if (!usernameInput.value && usernameInput) {
            usernameInput.focus();
        } else if (passwordInput) {
            passwordInput.focus();
        }
    } catch (error) {
        AuthLogger.error('Erreur restauration formulaire', error);
    }
}

// Gérer la soumission du formulaire
function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (!loginForm) {
        AuthLogger.error('Formulaire de login non trouvé');
        return;
    }
    
    AuthLogger.log('Configuration du formulaire de login');
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('%c🚀 DÉBUT CONNEXION', 'background: #9C27B0; color: white; padding: 5px; font-weight: bold;');
        AuthLogger.log('Soumission du formulaire');
        
        const apiUrlInput = document.getElementById('api-url');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const rememberCheckbox = document.getElementById('remember-me');
        
        if (!apiUrlInput || !usernameInput || !passwordInput) {
            showLoginError('Éléments du formulaire manquants');
            return;
        }
        
        let apiUrl = apiUrlInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
        
        // Normaliser l'URL
        if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
            apiUrl = 'https://' + apiUrl;
        }
        apiUrl = apiUrl.replace(/\/$/, '');
        
        AuthLogger.log('Données de connexion:', { apiUrl, username, rememberMe });
        
        // Validation
        if (!apiUrl || !username || !password) {
            showLoginError('Veuillez remplir tous les champs');
            return;
        }
        
        // Afficher le loader
        setLoginLoading(true);
        hideLoginError();
        
        // Tracker le temps de connexion
        const startTime = Date.now();
        
        try {
            AuthLogger.log('Tentative de connexion à:', apiUrl);
            
            // Sauvegarder l'URL
            await window.electronAPI.store.set('savedApiUrl', apiUrl);
            
            // Appeler l'API de login
            console.log('%c📡 APPEL API LOGIN...', 'background: #00BCD4; color: white; padding: 5px;');
            const result = await window.electronAPI.api.login(apiUrl, username, password);
            
            const connectionTime = Date.now() - startTime;
            AuthLogger.log(`Résultat de connexion (${connectionTime}ms):`, result);
            
            if (result.success) {
                console.log('%c✅ CONNEXION RÉUSSIE !', 'background: #4CAF50; color: white; padding: 10px; font-size: 16px;');
                AuthLogger.log('Connexion réussie !');

                // Sauvegarder les préférences
                if (rememberMe) {
                    await window.electronAPI.store.set('savedUsername', username);
                } else {
                    await window.electronAPI.store.delete('savedUsername');
                }

                // Utiliser un seul timeout de sécurité
                let eventReceived = false;
                
                // Écouter une fois l'événement
                const eventPromise = new Promise((resolve) => {
                    const checkEvent = setInterval(() => {
                        if (window.AuthState.isLoggedIn) {
                            eventReceived = true;
                            clearInterval(checkEvent);
                            resolve();
                        }
                    }, 100);
                    
                    // Timeout après 5 secondes
                    setTimeout(() => {
                        clearInterval(checkEvent);
                        resolve();
                    }, 5000);
                });
                
                await eventPromise;
                
                // Si l'événement n'a pas été reçu, forcer la transition
                if (!eventReceived) {
                    AuthLogger.warn('Event login-success non reçu, forçage manuel');
                    window.AuthState.isLoggedIn = true;
                    window.AuthState.user = result.user || { username };
                    showDashboard();
                    
                    if (window.loadCourses && !courseLoadingInProgress) {
                        courseLoadingInProgress = true;
                        window.loadCourses().finally(() => {
                            courseLoadingInProgress = false;
                        });
                    }
                }
                
                // Toujours désactiver le loader
                setLoginLoading(false);
                
            } else {
                // Gérer les erreurs
                console.log('%c❌ ÉCHEC CONNEXION', 'background: #F44336; color: white; padding: 10px;');
                AuthLogger.error('Échec de connexion:', result.error);
                setLoginLoading(false);
                
                let errorMessage = result.error || 'Erreur de connexion';
                
                if (result.code === 'no_active_membership' || result.code === 'no_membership') {
                    errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
                } else if (result.status === 404) {
                    errorMessage = 'API non trouvée. Vérifiez l\'URL du site et que le plugin est activé';
                }
                
                showLoginError(errorMessage);
            }
            
        } catch (error) {
            console.log('%c💥 ERREUR CRITIQUE', 'background: #000; color: #F44336; padding: 10px;');
            AuthLogger.error('Erreur de connexion', error);
            setLoginLoading(false);
            showLoginError('Erreur de connexion: ' + error.message);
        }
    });
}

// Utilitaires UI
function setLoginLoading(loading) {
    AuthLogger.log('setLoginLoading:', loading);
    
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.disabled = loading;
        
        const btnText = loginBtn.querySelector('.btn-text');
        const btnLoader = loginBtn.querySelector('.btn-loader');
        
        if (btnText && btnLoader) {
            if (loading) {
                btnText.classList.add('hidden');
                btnLoader.classList.remove('hidden');
                console.log('%c⏳ LOADER ACTIF', 'background: #FFC107; color: black; padding: 5px;');
            } else {
                btnText.classList.remove('hidden');
                btnLoader.classList.add('hidden');
                console.log('%c✓ LOADER DÉSACTIVÉ', 'background: #8BC34A; color: white; padding: 5px;');
            }
        }
    }
}

function showLoginError(message) {
    AuthLogger.error('Erreur affichée:', message);
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        errorDiv.style.display = 'block';
    }
}

function hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.style.display = 'none';
    }
}

// Déconnexion
async function performLogout() {
    try {
        console.log('%c🚪 DÉCONNEXION', 'background: #795548; color: white; padding: 10px;');
        AuthLogger.log('Déconnexion...');
        
        await window.electronAPI.api.logout();
        
        window.AuthState.isLoggedIn = false;
        window.AuthState.user = null;
        window.AuthState.apiUrl = null;
        
        showLoginPage();
        
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.reset();
        }
        
        await restoreLoginForm();
        
        AuthLogger.log('Déconnexion terminée');
        
    } catch (error) {
        AuthLogger.error('Erreur déconnexion', error);
        showLoginPage();
    }
}

// Fonction de debug globale
window.debugAuth = function() {
    console.log('%c🔍 DEBUG AUTH STATE', 'background: #E91E63; color: white; padding: 10px; font-size: 14px;');
    
    const debugInfo = {
        'Auth State': window.AuthState,
        'Login Page': {
            exists: !!document.getElementById('login-page'),
            display: document.getElementById('login-page')?.style.display,
            classes: document.getElementById('login-page')?.className
        },
        'Dashboard Page': {
            exists: !!document.getElementById('dashboard-page'),
            display: document.getElementById('dashboard-page')?.style.display,
            classes: document.getElementById('dashboard-page')?.className
        },
        'Login Button': {
            exists: !!document.getElementById('login-btn'),
            disabled: document.getElementById('login-btn')?.disabled,
            loaderHidden: document.querySelector('.btn-loader')?.classList.contains('hidden')
        },
        'ElectronAPI': {
            exists: !!window.electronAPI,
            hasOn: !!(window.electronAPI && window.electronAPI.on),
            hasLogin: !!(window.electronAPI && window.electronAPI.api && window.electronAPI.api.login)
        }
    };
    
    console.table(debugInfo);
    
    // Actions de debug
    console.log('\n%c📋 ACTIONS DISPONIBLES:', 'font-weight: bold;');
    console.log('- debugAuth.forceLogin() : Forcer la connexion');
    console.log('- debugAuth.forceDashboard() : Forcer l\'affichage du dashboard');
    console.log('- debugAuth.resetLoader() : Réinitialiser le loader');
    console.log('- debugAuth.simulateLoginSuccess() : Simuler un événement login-success');
};

// Actions de debug
window.debugAuth.forceLogin = function() {
    window.AuthState.isLoggedIn = true;
    window.AuthState.user = { username: 'debug-user' };
    showDashboard();
    setLoginLoading(false);
    console.log('%c✅ Connexion forcée', 'background: green; color: white; padding: 5px;');
};

window.debugAuth.forceDashboard = function() {
    showDashboard();
    console.log('%c✅ Dashboard forcé', 'background: green; color: white; padding: 5px;');
};

window.debugAuth.resetLoader = function() {
    setLoginLoading(false);
    document.getElementById('login-btn').disabled = false;
    console.log('%c✅ Loader réinitialisé', 'background: green; color: white; padding: 5px;');
};

window.debugAuth.simulateLoginSuccess = function() {
    const fakeUser = {
        username: 'test-user',
        displayName: 'Test User',
        id: 123
    };
    
    if (window.electronAPI && window.electronAPI.emit) {
        window.electronAPI.emit('login-success', fakeUser);
    } else {
        // Appeler directement le handler
        const event = new CustomEvent('login-success', { detail: fakeUser });
        window.dispatchEvent(event);
    }
    console.log('%c✅ Événement login-success simulé', 'background: green; color: white; padding: 5px;');
};

// Écouter les échecs d'authentification depuis le main process
if (window.electronAPI) {
    window.electronAPI.on('force-logout', (data) => {
        AuthLogger.warn('Force logout reçu:', data);
        window.AuthState.isLoggedIn = false;
        window.AuthState.user = null;
        window.AuthState.apiUrl = null;
        showLoginPage();
        showLoginError(data.message || 'Votre session a expiré. Veuillez vous reconnecter.');
    });

    window.electronAPI.on('refresh-failed', (data) => {
        AuthLogger.warn('Refresh token échoué:', data);
        if (!data.canRetry) {
            window.AuthState.isLoggedIn = false;
            window.AuthState.user = null;
            showLoginPage();
            showLoginError('Votre session a expiré. Veuillez vous reconnecter.');
        }
    });
}

// Export global
window.AuthManager = {
    showLoginPage,
    showDashboard,
    performLogout,
    isLoggedIn: () => window.AuthState.isLoggedIn,
    getUser: () => window.AuthState.user
};

console.log('%c✅ AUTH MODULE CHARGÉ', 'background: #4CAF50; color: white; padding: 10px; font-size: 14px;');
console.log('Tapez debugAuth() dans la console pour voir l\'état actuel');
