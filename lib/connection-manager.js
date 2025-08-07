// lib/connection-manager.js
const { net } = require('electron');

class ConnectionManager {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
        this.isOnline = true;
        this.lastCheck = Date.now();
        this.listeners = new Set();
    }
    
    async checkConnection() {
        const results = await Promise.allSettled([
            this.checkNavigatorOnline(),
            this.checkAPIEndpoint(),
            this.checkElectronAPI()
        ]);
        
        const onlineCount = results.filter(r => 
            r.status === 'fulfilled' && r.value === true
        ).length;
        
        const wasOnline = this.isOnline;
        this.isOnline = onlineCount >= 2; // Au moins 2 méthodes confirment
        this.lastCheck = Date.now();
        
        // Notifier les listeners si le statut a changé
        if (wasOnline !== this.isOnline) {
            this.notifyListeners(this.isOnline);
        }
        
        return this.isOnline;
    }
    
    async checkNavigatorOnline() {
        return net.isOnline();
    }
    
    async checkAPIEndpoint() {
        if (!this.apiUrl) return false;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.apiUrl}/wp-json/col-lms/v1/ping`, {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch {
            return false;
        }
    }
    
    async checkElectronAPI() {
        return net.isOnline();
    }
    
    onStatusChange(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    
    notifyListeners(isOnline) {
        this.listeners.forEach(callback => {
            try {
                callback(isOnline);
            } catch (error) {
                console.error('Erreur dans listener de connexion:', error);
            }
        });
    }
    
    startMonitoring(interval = 30000) {
        this.stopMonitoring();
        
        this.monitoringInterval = setInterval(async () => {
            await this.checkConnection();
        }, interval);
        
        // Vérifier immédiatement
        this.checkConnection();
    }
    
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }
}

module.exports = ConnectionManager;