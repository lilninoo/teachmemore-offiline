// logger.js - Système de logs pour le renderer process

class RendererLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.logLevels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3,
            FATAL: 4
        };
        
        // Niveau de log actuel (depuis les settings)
        this.currentLevel = this.logLevels.INFO;
        
        // Charger la configuration
        this.loadConfig();
        
        // Intercepter console.log, console.error, etc.
        this.interceptConsole();
        
        // Écouter les changements de configuration
        window.electronAPI.on('log-level-changed', (level) => {
            this.currentLevel = this.logLevels[level] || this.logLevels.INFO;
        });
    }
    
    async loadConfig() {
        try {
            const debugMode = await window.electronAPI.store.get('debugMode');
            if (debugMode) {
                this.currentLevel = this.logLevels.DEBUG;
            }
        } catch (error) {
            console.error('Erreur lors du chargement de la config des logs:', error);
        }
    }
    
    interceptConsole() {
        // Sauvegarder les méthodes originales
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;
        const originalDebug = console.debug;
        
        // Remplacer console.log
        console.log = (...args) => {
            originalLog.apply(console, args);
            this.log('INFO', args);
        };
        
        // Remplacer console.error
        console.error = (...args) => {
            originalError.apply(console, args);
            this.log('ERROR', args);
            
            // Envoyer les erreurs au main process
            if (args[0] instanceof Error) {
                window.electronAPI.reportError({
                    message: args[0].message,
                    stack: args[0].stack,
                    timestamp: new Date().toISOString()
                });
            }
        };
        
        // Remplacer console.warn
        console.warn = (...args) => {
            originalWarn.apply(console, args);
            this.log('WARN', args);
        };
        
        // Remplacer console.info
        console.info = (...args) => {
            originalInfo.apply(console, args);
            this.log('INFO', args);
        };
        
        // Remplacer console.debug
        console.debug = (...args) => {
            originalDebug.apply(console, args);
            this.log('DEBUG', args);
        };
    }
    
    log(level, args) {
        const levelValue = this.logLevels[level];
        
        // Vérifier si on doit logger ce niveau
        if (levelValue < this.currentLevel) {
            return;
        }
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: this.formatMessage(args),
            data: args.length > 1 ? args.slice(1) : undefined,
            source: this.getCallerInfo()
        };
        
        // Ajouter au buffer
        this.logs.push(logEntry);
        
        // Limiter la taille du buffer
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        // Pour les erreurs critiques, notifier l'utilisateur
        if (level === 'ERROR' || level === 'FATAL') {
            this.notifyError(logEntry);
        }
        
        // Persister les logs importants
        if (levelValue >= this.logLevels.WARN) {
            this.persistLog(logEntry);
        }
    }
    
    formatMessage(args) {
        return args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }
    
    getCallerInfo() {
        try {
            const stack = new Error().stack;
            const lines = stack.split('\n');
            // Trouver la ligne qui n'est pas dans logger.js
            for (let i = 3; i < lines.length; i++) {
                const line = lines[i];
                if (!line.includes('logger.js') && !line.includes('console.')) {
                    const match = line.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
                    if (match) {
                        return {
                            function: match[1],
                            file: match[2].split('/').pop(),
                            line: match[3],
                            column: match[4]
                        };
                    }
                }
            }
        } catch (e) {
            // Ignorer les erreurs de parsing
        }
        return null;
    }
    
    async persistLog(logEntry) {
        try {
            // Envoyer au main process pour sauvegarde
            await window.electronAPI.saveLog(logEntry);
        } catch (error) {
            // Ne pas créer une boucle infinie
            console.warn('Erreur lors de la sauvegarde du log:', error);
        }
    }
    
    notifyError(logEntry) {
        // Créer une notification discrète
        const notification = document.createElement('div');
        notification.className = 'error-notification';
        notification.innerHTML = `
            <div class="error-icon">⚠️</div>
            <div class="error-content">
                <div class="error-level">${logEntry.level}</div>
                <div class="error-message">${this.truncate(logEntry.message, 100)}</div>
                <div class="error-time">${new Date(logEntry.timestamp).toLocaleTimeString()}</div>
            </div>
            <button class="error-dismiss" onclick="this.parentElement.remove()">×</button>
        `;
        
        // Ajouter au DOM
        let container = document.getElementById('error-notifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'error-notifications';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Auto-supprimer après 10 secondes
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 10000);
    }
    
    truncate(str, length) {
        if (str.length <= length) return str;
        return str.substring(0, length) + '...';
    }
    
    // API publique
    debug(...args) {
        this.log('DEBUG', args);
    }
    
    info(...args) {
        this.log('INFO', args);
    }
    
    warn(...args) {
        this.log('WARN', args);
    }
    
    error(...args) {
        this.log('ERROR', args);
    }
    
    fatal(...args) {
        this.log('FATAL', args);
    }
    
    // Obtenir les logs filtrés
    getLogs(filter = {}) {
        let filtered = this.logs;
        
        if (filter.level) {
            const minLevel = this.logLevels[filter.level];
            filtered = filtered.filter(log => 
                this.logLevels[log.level] >= minLevel
            );
        }
        
        if (filter.startTime) {
            filtered = filtered.filter(log => 
                new Date(log.timestamp) >= new Date(filter.startTime)
            );
        }
        
        if (filter.endTime) {
            filtered = filtered.filter(log => 
                new Date(log.timestamp) <= new Date(filter.endTime)
            );
        }
        
        if (filter.search) {
            const searchLower = filter.search.toLowerCase();
            filtered = filtered.filter(log => 
                log.message.toLowerCase().includes(searchLower)
            );
        }
        
        return filtered;
    }
    
    // Exporter les logs
    async exportLogs(format = 'json') {
        const logs = this.getLogs();
        
        if (format === 'json') {
            return JSON.stringify(logs, null, 2);
        } else if (format === 'csv') {
            const headers = ['Timestamp', 'Level', 'Message', 'Source'];
            const rows = logs.map(log => [
                log.timestamp,
                log.level,
                log.message.replace(/"/g, '""'),
                log.source ? `${log.source.file}:${log.source.line}` : ''
            ]);
            
            const csv = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');
            
            return csv;
        } else if (format === 'txt') {
            return logs.map(log => 
                `[${log.timestamp}] [${log.level}] ${log.message}`
            ).join('\n');
        }
    }
    
    // Nettoyer les logs
    clear() {
        this.logs = [];
    }
    
    // Créer un contexte de log
    createContext(contextName) {
        return {
            debug: (...args) => this.debug(`[${contextName}]`, ...args),
            info: (...args) => this.info(`[${contextName}]`, ...args),
            warn: (...args) => this.warn(`[${contextName}]`, ...args),
            error: (...args) => this.error(`[${contextName}]`, ...args),
            fatal: (...args) => this.fatal(`[${contextName}]`, ...args)
        };
    }
    
    // Mesurer les performances
    startTimer(label) {
        const startTime = performance.now();
        
        return {
            end: (message) => {
                const duration = performance.now() - startTime;
                this.debug(`[PERF] ${label}: ${duration.toFixed(2)}ms`, message);
                return duration;
            }
        };
    }
    
    // Logger les actions utilisateur
    logAction(action, details = {}) {
        this.info('[USER_ACTION]', action, details);
        
        // Envoyer les analytics si activé
        if (window.analyticsEnabled) {
            this.sendAnalytics('user_action', {
                action,
                ...details,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Logger les erreurs réseau
    logNetworkError(url, error, details = {}) {
        this.error('[NETWORK]', `Failed request to ${url}`, {
            error: error.message,
            status: error.response?.status,
            ...details
        });
    }
    
    // Logger les événements de synchronisation
    logSync(event, data = {}) {
        this.info('[SYNC]', event, data);
    }
    
    async sendAnalytics(event, data) {
        try {
            // Implémenter l'envoi d'analytics si nécessaire
            // await window.electronAPI.sendAnalytics(event, data);
        } catch (error) {
            // Ignorer les erreurs d'analytics
        }
    }
}

// Styles CSS pour les notifications d'erreur
const errorNotificationStyles = `
<style>
#error-notifications {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    max-width: 400px;
}

.error-notification {
    background: var(--bg-primary);
    border: 1px solid var(--danger-color);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    display: flex;
    align-items: start;
    gap: 12px;
    box-shadow: var(--shadow-lg);
    animation: slideIn 0.3s ease-out;
}

.error-notification.fade-out {
    animation: fadeOut 0.3s ease-out forwards;
}

@keyframes slideIn {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

@keyframes fadeOut {
    to {
        opacity: 0;
        transform: translateX(100%);
    }
}

.error-icon {
    font-size: 24px;
}

.error-content {
    flex: 1;
}

.error-level {
    font-weight: 600;
    color: var(--danger-color);
    font-size: 12px;
    text-transform: uppercase;
}

.error-message {
    margin: 4px 0;
    word-break: break-word;
}

.error-time {
    font-size: 12px;
    color: var(--text-secondary);
}

.error-dismiss {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.error-dismiss:hover {
    color: var(--text-primary);
}
</style>
`;

// Ajouter les styles au document
document.head.insertAdjacentHTML('beforeend', errorNotificationStyles);

// Créer l'instance globale
window.Logger = new RendererLogger();

// Créer des alias pour faciliter l'utilisation
// Créer des alias pour faciliter l'utilisation
if (window.Logger) {
    window.log = window.Logger.info ? window.Logger.info.bind(window.Logger) : console.log;
    window.logError = window.Logger.error ? window.Logger.error.bind(window.Logger) : console.error;
    window.logWarn = window.Logger.warn ? window.Logger.warn.bind(window.Logger) : console.warn;
    window.logDebug = window.Logger.debug ? window.Logger.debug.bind(window.Logger) : console.debug;
}

window.logError = window.Logger.error.bind(window.Logger);
window.logWarn = window.Logger.warn.bind(window.Logger);
window.logDebug = window.Logger.debug.bind(window.Logger);

// Export pour les modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.Logger;
}
