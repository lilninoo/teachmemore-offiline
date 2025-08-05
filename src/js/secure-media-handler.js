// src/js/secure-media-handler.js
console.log('[SecureMediaHandler] Module en cours de chargement...');

class SecureMediaHandler {
    constructor() {
        this.streamUrls = new Map();
        this.activeStreams = new Set();
        this.cleanupTimers = new Map();
        this.serverPort = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return true;
        
        try {
            // Initialiser le serveur de streaming sécurisé
            const result = await window.electronAPI.media.initializeStreamServer();
            if (result.success) {
                this.serverPort = result.port;
                this.initialized = true;
                console.log('[SecureMediaHandler] Serveur de streaming initialisé sur le port:', this.serverPort);
                return true;
            }
            throw new Error(result.error || 'Échec de l\'initialisation du serveur');
        } catch (error) {
            console.error('[SecureMediaHandler] Erreur d\'initialisation:', error);
            return false;
        }
    }

    async isFileEncrypted(filePath) {
        try {
            // Vérifier si le fichier est chiffré en lisant les premiers octets
            const result = await window.electronAPI.media.checkEncryption(filePath);
            return result.encrypted;
        } catch (error) {
            console.error('[SecureMediaHandler] Erreur lors de la vérification du chiffrement:', error);
            // En cas d'erreur, supposer que le fichier est chiffré pour la sécurité
            return true;
        }
    }

    async createStreamUrl(filePath, mimeType = 'video/mp4') {
        console.log('[SecureMediaHandler] Création d\'URL de streaming pour:', filePath);
        
        try {
            // Vérifier d'abord si le fichier existe
            const fileExists = await this.checkFileExists(filePath);
            if (!fileExists) {
                throw new Error('Fichier introuvable: ' + filePath);
            }
            

        // Si pas de serveur initialisé, essayer quand même
        if (!this.initialized) {
            try {
                await this.initialize();
            } catch (e) {
                console.warn('[SecureMediaHandler] Initialisation échouée, tentative directe');
                // Retourner une URL file:// directe si l'init échoue
                return `file://${filePath}`;
            }
        }

            // Créer une URL de streaming sécurisée
            const result = await window.electronAPI.media.createSecureStream(filePath, mimeType);
            
            if (!result.success) {
                throw new Error(result.error || 'Échec de création du stream');
            }

            const streamUrl = `http://localhost:${this.serverPort}/stream/${result.streamId}`;
            
            // Mettre en cache
            this.streamUrls.set(filePath, streamUrl);
            this.activeStreams.add(streamUrl);
            
            // Programmer le nettoyage
            this.scheduleCleanup(filePath, streamUrl, 30 * 60 * 1000); // 30 minutes
            
            console.log('[SecureMediaHandler] URL de streaming créée:', streamUrl);
            return streamUrl;
            
        } catch (error) {
            console.error('[SecureMediaHandler] Erreur lors de la création du stream:', error);
            // Fallback : essayer l'accès direct
            return `file://${filePath}`;
        }
    }

    scheduleCleanup(filePath, streamUrl, delay) {
        // Annuler tout nettoyage existant
        if (this.cleanupTimers.has(filePath)) {
            clearTimeout(this.cleanupTimers.get(filePath));
        }

        // Programmer nouveau nettoyage
        const timerId = setTimeout(() => {
            this.cleanup(filePath, streamUrl);
        }, delay);
        
        this.cleanupTimers.set(filePath, timerId);
    }

    async cleanup(filePath, streamUrl) {
        console.log('[SecureMediaHandler] Nettoyage du stream:', streamUrl);
        
        try {
            // Informer le serveur de fermer le stream
            const streamId = streamUrl.split('/').pop();
            await window.electronAPI.media.closeStream(streamId);
            
            // Nettoyer les références locales
            this.streamUrls.delete(filePath);
            this.activeStreams.delete(streamUrl);
            this.cleanupTimers.delete(filePath);
            
        } catch (error) {
            console.error('[SecureMediaHandler] Erreur lors du nettoyage:', error);
        }
    }

    async cleanupAll() {
        console.log('[SecureMediaHandler] Nettoyage de tous les streams');
        
        // Annuler tous les timers
        for (const timerId of this.cleanupTimers.values()) {
            clearTimeout(timerId);
        }
        
        // Fermer tous les streams actifs
        for (const streamUrl of this.activeStreams) {
            const streamId = streamUrl.split('/').pop();
            try {
                await window.electronAPI.media.closeStream(streamId);
            } catch (error) {
                console.error('[SecureMediaHandler] Erreur lors de la fermeture du stream:', streamId, error);
            }
        }
        
        // Réinitialiser
        this.streamUrls.clear();
        this.activeStreams.clear();
        this.cleanupTimers.clear();
    }
}

// Créer une instance globale
window.secureMediaHandler = new SecureMediaHandler();

// Nettoyer à la fermeture
window.addEventListener('beforeunload', () => {
    window.secureMediaHandler.cleanupAll();
});

console.log('[SecureMediaHandler] Module chargé avec succès');