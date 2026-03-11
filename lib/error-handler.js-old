// error-handler.js - Gestion centralisée des erreurs
const log = require('electron-log');
const { dialog, app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

class ErrorHandler {
    constructor() {
        this.errors = [];
        this.maxErrors = 100;
        this.errorLogPath = path.join(app.getPath('userData'), 'logs', 'errors.log');
        
        // Configurer electron-log
        log.transports.file.level = 'error';
        log.transports.file.fileName = 'errors.log';
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
        
        // Types d'erreurs avec leurs gestionnaires
        this.errorTypes = {
            AUTH_ERROR: this.handleAuthError.bind(this),
            NETWORK_ERROR: this.handleNetworkError.bind(this),
            DATABASE_ERROR: this.handleDatabaseError.bind(this),
            STORAGE_ERROR: this.handleStorageError.bind(this),
            MEMBERSHIP_ERROR: this.handleMembershipError.bind(this),
            SYNC_ERROR: this.handleSyncError.bind(this),
            DOWNLOAD_ERROR: this.handleDownloadError.bind(this),
            ENCRYPTION_ERROR: this.handleEncryptionError.bind(this),
            UPDATE_ERROR: this.handleUpdateError.bind(this),
            UNKNOWN_ERROR: this.handleUnknownError.bind(this)
        };
        
        // Messages d'erreur localisés
        this.errorMessages = {
            fr: {
                AUTH_ERROR: {
                    INVALID_CREDENTIALS: 'Identifiants incorrects',
                    TOKEN_EXPIRED: 'Votre session a expiré',
                    NO_MEMBERSHIP: 'Abonnement requis pour accéder à cette fonctionnalité',
                    MEMBERSHIP_EXPIRED: 'Votre abonnement a expiré'
                },
                NETWORK_ERROR: {
                    NO_INTERNET: 'Aucune connexion Internet détectée',
                    TIMEOUT: 'La requête a expiré. Vérifiez votre connexion',
                    SERVER_ERROR: 'Erreur du serveur. Réessayez plus tard',
                    API_UNAVAILABLE: 'Le service est temporairement indisponible'
                },
                DATABASE_ERROR: {
                    CORRUPT: 'La base de données est corrompue',
                    LOCKED: 'La base de données est verrouillée',
                    DISK_FULL: 'Espace disque insuffisant',
                    INIT_FAILED: 'Impossible d\'initialiser la base de données'
                },
                STORAGE_ERROR: {
                    NO_SPACE: 'Espace de stockage insuffisant',
                    PERMISSION_DENIED: 'Permission refusée pour accéder au stockage',
                    FILE_NOT_FOUND: 'Fichier non trouvé',
                    WRITE_FAILED: 'Impossible d\'écrire le fichier'
                },
                MEMBERSHIP_ERROR: {
                    NO_ACCESS: 'Votre abonnement ne permet pas l\'accès à ce contenu',
                    LIMIT_REACHED: 'Vous avez atteint la limite de votre abonnement',
                    VERIFICATION_FAILED: 'Impossible de vérifier votre abonnement'
                },
                SYNC_ERROR: {
                    CONFLICT: 'Conflit de synchronisation détecté',
                    PARTIAL_SYNC: 'Synchronisation partielle. Certaines données n\'ont pas été synchronisées',
                    SYNC_FAILED: 'Échec de la synchronisation'
                },
                DOWNLOAD_ERROR: {
                    DOWNLOAD_FAILED: 'Échec du téléchargement',
                    CORRUPT_FILE: 'Le fichier téléchargé est corrompu',
                    NO_ACCESS: 'Accès refusé au cours',
                    PACKAGE_ERROR: 'Erreur lors de la création du package'
                },
                ENCRYPTION_ERROR: {
                    DECRYPT_FAILED: 'Impossible de déchiffrer les données',
                    KEY_MISSING: 'Clé de chiffrement manquante',
                    INVALID_KEY: 'Clé de chiffrement invalide'
                },
                UPDATE_ERROR: {
                    UPDATE_FAILED: 'Échec de la mise à jour',
                    DOWNLOAD_FAILED: 'Impossible de télécharger la mise à jour',
                    INSTALL_FAILED: 'Impossible d\'installer la mise à jour'
                },
                UNKNOWN_ERROR: {
                    GENERIC: 'Une erreur inattendue s\'est produite'
                }
            }
        };
    }
    
    // Gestionnaire principal d'erreurs
    async handleError(error, context = {}) {
        // Enrichir l'erreur avec le contexte
        const enrichedError = {
            ...error,
            timestamp: new Date().toISOString(),
            context,
            app: {
                version: app.getVersion(),
                platform: process.platform,
                arch: process.arch
            }
        };
        
        // Logger l'erreur
        log.error('Application Error:', enrichedError);
        
        // Ajouter à la liste des erreurs
        this.errors.unshift(enrichedError);
        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(0, this.maxErrors);
        }
        
        // Déterminer le type d'erreur
        const errorType = this.determineErrorType(error);
        
        // Appeler le gestionnaire spécifique
        if (this.errorTypes[errorType]) {
            return await this.errorTypes[errorType](error, context);
        }
        
        // Gestionnaire par défaut
        return await this.handleUnknownError(error, context);
    }
    
    // Déterminer le type d'erreur
    determineErrorType(error) {
        if (error.code === 'AUTH_ERROR' || error.message?.includes('auth')) {
            return 'AUTH_ERROR';
        }
        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('network')) {
            return 'NETWORK_ERROR';
        }
        if (error.code === 'SQLITE_ERROR' || error.message?.includes('database')) {
            return 'DATABASE_ERROR';
        }
        if (error.code === 'ENOSPC' || error.code === 'EACCES' || error.message?.includes('storage')) {
            return 'STORAGE_ERROR';
        }
        if (error.code === 'NO_MEMBERSHIP' || error.message?.includes('membership')) {
            return 'MEMBERSHIP_ERROR';
        }
        if (error.message?.includes('sync')) {
            return 'SYNC_ERROR';
        }
        if (error.message?.includes('download')) {
            return 'DOWNLOAD_ERROR';
        }
        if (error.message?.includes('encrypt') || error.message?.includes('decrypt')) {
            return 'ENCRYPTION_ERROR';
        }
        if (error.message?.includes('update')) {
            return 'UPDATE_ERROR';
        }
        
        return 'UNKNOWN_ERROR';
    }
    
    // Gestionnaires spécifiques
    async handleAuthError(error, context) {
        const action = await this.showErrorDialog(
            'Erreur d\'authentification',
            this.getErrorMessage('AUTH_ERROR', error.code || 'INVALID_CREDENTIALS'),
            ['Réessayer', 'Se déconnecter', 'Annuler']
        );
        
        switch (action) {
            case 0: // Réessayer
                if (context.retry) {
                    return await context.retry();
                }
                break;
            case 1: // Se déconnecter
                if (context.logout) {
                    return await context.logout();
                }
                break;
        }
        
        return { handled: true, action };
    }
    
    async handleNetworkError(error, context) {
        // Vérifier si c'est juste une perte de connexion temporaire
        const isOnline = await this.checkInternetConnection();
        
        if (!isOnline) {
            // Mode hors ligne
            this.sendToRenderer('switch-to-offline-mode');
            return { handled: true, offline: true };
        }
        
        // Erreur réseau avec connexion active
        const action = await this.showErrorDialog(
            'Erreur de connexion',
            this.getErrorMessage('NETWORK_ERROR', error.code || 'SERVER_ERROR'),
            ['Réessayer', 'Mode hors ligne', 'Annuler']
        );
        
        if (action === 1) {
            this.sendToRenderer('switch-to-offline-mode');
        }
        
        return { handled: true, action };
    }
    
    async handleDatabaseError(error, context) {
        // Erreur critique - proposer de réinitialiser
        const action = await this.showErrorDialog(
            'Erreur de base de données',
            `${this.getErrorMessage('DATABASE_ERROR', error.code || 'CORRUPT')}\n\nVoulez-vous réinitialiser la base de données ? Cela supprimera tous les cours téléchargés.`,
            ['Réinitialiser', 'Sauvegarder et quitter', 'Annuler'],
            'error'
        );
        
        switch (action) {
            case 0: // Réinitialiser
                await this.resetDatabase();
                app.relaunch();
                app.exit(0);
                break;
            case 1: // Sauvegarder et quitter
                await this.backupDatabase();
                app.quit();
                break;
        }
        
        return { handled: true, action };
    }
    
    async handleStorageError(error, context) {
        if (error.code === 'ENOSPC') {
            // Espace insuffisant
            const action = await this.showErrorDialog(
                'Espace insuffisant',
                'L\'espace de stockage est insuffisant. Libérez de l\'espace ou supprimez des cours.',
                ['Gérer le stockage', 'Annuler']
            );
            
            if (action === 0) {
                this.sendToRenderer('open-storage-manager');
            }
        }
        
        return { handled: true };
    }
    
    async handleMembershipError(error, context) {
        const action = await this.showErrorDialog(
            'Abonnement requis',
            this.getErrorMessage('MEMBERSHIP_ERROR', error.code || 'NO_ACCESS'),
            ['Voir les abonnements', 'Annuler']
        );
        
        if (action === 0) {
            this.sendToRenderer('open-membership-page');
        }
        
        return { handled: true, action };
    }
    
    async handleSyncError(error, context) {
        // Les erreurs de sync ne sont pas critiques
        log.warn('Sync error:', error);
        
        // Ajouter à la file de retry
        if (context.syncData) {
            this.sendToRenderer('queue-sync-retry', context.syncData);
        }
        
        return { handled: true, queued: true };
    }
    
    async handleDownloadError(error, context) {
        const action = await this.showErrorDialog(
            'Erreur de téléchargement',
            this.getErrorMessage('DOWNLOAD_ERROR', error.code || 'DOWNLOAD_FAILED'),
            ['Réessayer', 'Annuler']
        );
        
        if (action === 0 && context.retry) {
            return await context.retry();
        }
        
        return { handled: true, action };
    }
    
    async handleEncryptionError(error, context) {
        // Erreur critique de sécurité
        await this.showErrorDialog(
            'Erreur de sécurité',
            'Une erreur de chiffrement s\'est produite. L\'application va se fermer pour protéger vos données.',
            ['OK'],
            'error'
        );
        
        app.quit();
        return { handled: true, critical: true };
    }
    
    async handleUpdateError(error, context) {
        // Non critique - juste informer
        log.warn('Update error:', error);
        return { handled: true, ignored: true };
    }
    
    async handleUnknownError(error, context) {
        const action = await this.showErrorDialog(
            'Erreur inattendue',
            `${this.getErrorMessage('UNKNOWN_ERROR', 'GENERIC')}\n\nDétails: ${error.message}`,
            ['Envoyer le rapport', 'Ignorer'],
            'error'
        );
        
        if (action === 0) {
            await this.sendErrorReport(error, context);
        }
        
        return { handled: true, action };
    }
    
    // Utilitaires
    getErrorMessage(type, code) {
        const messages = this.errorMessages.fr[type];
        return messages[code] || messages.GENERIC || 'Une erreur s\'est produite';
    }
    
    async showErrorDialog(title, message, buttons = ['OK'], type = 'error') {
        const { response } = await dialog.showMessageBox({
            type,
            title,
            message,
            buttons,
            defaultId: 0,
            cancelId: buttons.length - 1
        });
        
        return response;
    }
    
    sendToRenderer(channel, data) {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        
        windows.forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send(channel, data);
            }
        });
    }
    
    async checkInternetConnection() {
        try {
            const { net } = require('electron');
            return net.isOnline();
        } catch {
            return false;
        }
    }
    
    async resetDatabase() {
        const dbPath = path.join(app.getPath('userData'), 'database', 'courses.db');
        
        try {
            // Backup d'abord
            await this.backupDatabase();
            
            // Supprimer la DB
            await fs.unlink(dbPath);
            
            log.info('Database reset successfully');
        } catch (error) {
            log.error('Failed to reset database:', error);
        }
    }
    
    async backupDatabase() {
        const dbPath = path.join(app.getPath('userData'), 'database', 'courses.db');
        const backupPath = path.join(
            app.getPath('userData'), 
            'backups', 
            `backup-${Date.now()}.db`
        );
        
        try {
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.copyFile(dbPath, backupPath);
            
            log.info('Database backed up to:', backupPath);
        } catch (error) {
            log.error('Failed to backup database:', error);
        }
    }
    
    async sendErrorReport(error, context) {
        // Implémenter l'envoi de rapport d'erreur
        // Par exemple avec Sentry ou un service similaire
        log.info('Error report would be sent:', { error, context });
    }
    
    // Récupérer les erreurs récentes
    getRecentErrors(count = 10) {
        return this.errors.slice(0, count);
    }
    
    // Nettoyer les anciennes erreurs
    clearErrors() {
        this.errors = [];
    }
}

// Singleton
module.exports = new ErrorHandler();
