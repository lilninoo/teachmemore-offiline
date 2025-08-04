// app-protection.js - À charger avant app.js dans index.html

// Protection contre les redéclarations multiples
(function() {
    'use strict';
    
    // Créer un namespace global pour l'application
    if (!window.LearnPressApp) {
        window.LearnPressApp = {
            initialized: false,
            modules: {},
            state: {},
            config: {}
        };
    }
    
    // Fonction pour vérifier si un module est déjà chargé
    window.checkModuleLoaded = function(moduleName) {
        return window.LearnPressApp.modules[moduleName] === true;
    };
    
    // Fonction pour marquer un module comme chargé
    window.markModuleLoaded = function(moduleName) {
        window.LearnPressApp.modules[moduleName] = true;
        console.log(`[Module] ${moduleName} chargé`);
    };
    
    // Protection pour app.js
    if (!window.LearnPressApp.modules.app) {
        // Variables globales protégées
        window.LearnPressApp.state.courseLoadingInProgress = false;
        window.LearnPressApp.state.dashboardUpdateInterval = null;
        window.LearnPressApp.state.currentLesson = null;
        window.LearnPressApp.state.lessonProgress = 0;
        
        // Marquer comme chargé
        window.markModuleLoaded('app');
    }
    
    // Protection pour logger.js
    if (!window.LearnPressApp.modules.logger && !window.Logger) {
        window.markModuleLoaded('logger');
    }
    
    // Protection pour utils.js
    if (!window.LearnPressApp.modules.utils && !window.Utils) {
        window.markModuleLoaded('utils');
    }
    
    // Fonction helper pour éviter les redéclarations
    window.safeDefine = function(name, value, scope = window) {
        if (typeof scope[name] === 'undefined') {
            scope[name] = value;
            return true;
        }
        console.warn(`[SafeDefine] "${name}" existe déjà, définition ignorée`);
        return false;
    };
    
    // Protection contre le rechargement accidentel des scripts
    window.scriptLoadTracker = window.scriptLoadTracker || {};
    
    // Override de la méthode appendChild pour traquer les scripts
    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(element) {
        if (element.tagName === 'SCRIPT' && element.src) {
            const scriptName = element.src.split('/').pop();
            if (window.scriptLoadTracker[scriptName]) {
                console.warn(`[Script] Tentative de rechargement bloquée: ${scriptName}`);
                return element;
            }
            window.scriptLoadTracker[scriptName] = true;
        }
        return originalAppendChild.call(this, element);
    };
    
})();