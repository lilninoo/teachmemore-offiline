
// downloads.js - Gestion complète de la page des téléchargements
(function() {
    'use strict';
    
    console.log('[Downloads] Module de téléchargements chargé');
    
    // État des téléchargements
    const DownloadsState = {
        activeDownloads: new Map(),
        completedDownloads: [],
        updateInterval: null
    };
    
    // Fonction principale pour charger la page des téléchargements
    window.loadDownloadsPage = async function() {
        console.log('[Downloads] Chargement de la page des téléchargements');
        
        const container = document.getElementById('downloads-list');
        if (!container) {
            console.error('[Downloads] Container downloads-list non trouvé');
            return;
        }
        
        // Démarrer la mise à jour automatique
        startAutoUpdate();
        
        // Charger les téléchargements
        await refreshDownloads();
    };
    
    // Rafraîchir l'affichage des téléchargements
    async function refreshDownloads() {
        try {
            console.log('[Downloads] Rafraîchissement des téléchargements...');
            
            // Récupérer tous les téléchargements via l'API
            const result = await window.electronAPI.download.getAllDownloads();
            
            if (result.success && result.downloads) {
                console.log(`[Downloads] ${result.downloads.length} téléchargements trouvés`);
                
                // Mettre à jour l'état local
                DownloadsState.activeDownloads.clear();
                result.downloads.forEach(dl => {
                    if (dl.status !== 'completed' && dl.status !== 'error') {
                        DownloadsState.activeDownloads.set(dl.id, dl);
                    }
                });
                
                // Afficher les téléchargements
                displayDownloads(result.downloads);
            }
        } catch (error) {
            console.error('[Downloads] Erreur lors du rafraîchissement:', error);
        }
    }
    
    // Afficher les téléchargements
    function displayDownloads(downloads) {
        const container = document.getElementById('downloads-list');
        if (!container) return;
        
        // Séparer les téléchargements actifs et terminés
        const activeDownloads = downloads.filter(dl => 
            dl.status === 'downloading' || 
            dl.status === 'preparing' || 
            dl.status === 'creating-package' ||
            dl.status === 'queued' ||
            dl.status === 'paused'
        );
        
        const completedDownloads = downloads.filter(dl => 
            dl.status === 'completed' || 
            dl.status === 'error' || 
            dl.status === 'cancelled'
        ).slice(0, 10); // Limiter l'historique
        
        let html = '';
        
        // Section des téléchargements actifs
        if (activeDownloads.length > 0) {
            html += `
                <div class="downloads-section">
                    <h3>Téléchargements en cours</h3>
                    <div class="downloads-list">
            `;
            
            activeDownloads.forEach(dl => {
                html += createDownloadItem(dl);
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Section de l'historique
        if (completedDownloads.length > 0) {
            html += `
                <div class="downloads-section">
                    <h3>Historique</h3>
                    <div class="downloads-list">
            `;
            
            completedDownloads.forEach(dl => {
                html += createDownloadItem(dl);
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Message si aucun téléchargement
        if (downloads.length === 0) {
            html = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    <h3>Aucun téléchargement</h3>
                    <p>Les téléchargements de cours apparaîtront ici</p>
                </div>
            `;
        }
        
        container.innerHTML = html;
        
        // Attacher les événements
        attachDownloadEvents();
    }
    
    // Créer un élément de téléchargement
    function createDownloadItem(download) {
        const statusInfo = getStatusInfo(download.status);
        const progress = download.progress || 0;
        const isActive = ['downloading', 'preparing', 'creating-package'].includes(download.status);
        
        return `
            <div class="download-item ${download.status}" data-download-id="${download.id}">
                <div class="download-header">
                    <div class="download-icon">${statusInfo.icon}</div>
                    <div class="download-info">
                        <h4>${escapeHtml(download.course?.title || 'Cours inconnu')}</h4>
                        <div class="download-meta">
                            <span class="download-status">${statusInfo.text}</span>
                            ${download.status === 'downloading' && download.speed ? `
                                <span class="download-speed">${formatBytes(download.speed)}/s</span>
                            ` : ''}
                            ${download.status === 'downloading' && download.eta ? `
                                <span class="download-eta">${formatDuration(download.eta)} restant</span>
                            ` : ''}
                            ${download.currentFile ? `
                                <span class="download-current-file">${escapeHtml(download.currentFile)}</span>
                            ` : ''}
                        </div>
                        ${download.error ? `
                            <div class="download-error">${escapeHtml(download.error)}</div>
                        ` : ''}
                    </div>
                    <div class="download-actions">
                        ${download.status === 'downloading' ? `
                            <button class="btn btn-icon pause-download-btn" title="Pause">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${download.status === 'paused' ? `
                            <button class="btn btn-icon resume-download-btn" title="Reprendre">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${['downloading', 'queued', 'preparing', 'paused'].includes(download.status) ? `
                            <button class="btn btn-icon cancel-download-btn" title="Annuler">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${download.status === 'error' ? `
                            <button class="btn btn-sm btn-primary retry-download-btn">Réessayer</button>
                        ` : ''}
                    </div>
                </div>
                ${isActive ? `
                    <div class="download-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="progress-text">${Math.round(progress)}%</span>
                    </div>
                ` : ''}
                ${download.statistics && download.status === 'downloading' ? `
                    <div class="download-files-summary">
                        ${download.statistics.filesDownloaded || 0}/${download.files?.length || 0} fichiers
                        • ${formatBytes(download.downloadedSize || 0)}/${formatBytes(download.totalSize || 0)}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // Obtenir les informations de statut
    function getStatusInfo(status) {
        const statusMap = {
            'queued': { icon: '⏳', text: 'En attente' },
            'preparing': { icon: '🔄', text: 'Préparation' },
            'creating-package': { icon: '📦', text: 'Création du package' },
            'downloading': { icon: '⬇️', text: 'Téléchargement en cours' },
            'compressing': { icon: '🗜️', text: 'Compression' },
            'paused': { icon: '⏸️', text: 'En pause' },
            'completed': { icon: '✅', text: 'Terminé' },
            'error': { icon: '❌', text: 'Erreur' },
            'cancelled': { icon: '🚫', text: 'Annulé' }
        };
        
        return statusMap[status] || { icon: '❓', text: status };
    }
    
    // Attacher les événements aux boutons
    function attachDownloadEvents() {
        // Pause
        document.querySelectorAll('.pause-download-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const downloadId = e.target.closest('.download-item').dataset.downloadId;
                await pauseDownload(downloadId);
            });
        });
        
        // Resume
        document.querySelectorAll('.resume-download-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const downloadId = e.target.closest('.download-item').dataset.downloadId;
                await resumeDownload(downloadId);
            });
        });
        
        // Cancel
        document.querySelectorAll('.cancel-download-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const downloadId = e.target.closest('.download-item').dataset.downloadId;
                await cancelDownload(downloadId);
            });
        });
        
        // Retry
        document.querySelectorAll('.retry-download-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const downloadId = e.target.closest('.download-item').dataset.downloadId;
                await retryDownload(downloadId);
            });
        });
    }
    
    // Actions sur les téléchargements
    async function pauseDownload(downloadId) {
        try {
            const result = await window.electronAPI.download.pauseDownload(downloadId);
            if (result.success) {
                showInfo('Téléchargement mis en pause');
                await refreshDownloads();
            }
        } catch (error) {
            console.error('[Downloads] Erreur pause:', error);
            showError('Impossible de mettre en pause');
        }
    }
    
    async function resumeDownload(downloadId) {
        try {
            const result = await window.electronAPI.download.resumeDownload(downloadId);
            if (result.success) {
                showInfo('Téléchargement repris');
                await refreshDownloads();
            }
        } catch (error) {
            console.error('[Downloads] Erreur reprise:', error);
            showError('Impossible de reprendre');
        }
    }
    
    async function cancelDownload(downloadId) {
        if (!confirm('Êtes-vous sûr de vouloir annuler ce téléchargement ?')) return;
        
        try {
            const result = await window.electronAPI.download.cancelDownload(downloadId);
            if (result.success) {
                showInfo('Téléchargement annulé');
                await refreshDownloads();
            }
        } catch (error) {
            console.error('[Downloads] Erreur annulation:', error);
            showError('Impossible d\'annuler');
        }
    }
    
    async function retryDownload(downloadId) {
        try {
            // Obtenir les infos du téléchargement
            const download = DownloadsState.activeDownloads.get(downloadId);
            if (download && download.course) {
                // Relancer le téléchargement
                const result = await window.electronAPI.download.downloadCourse(
                    download.course.id || download.courseId,
                    download.options || {}
                );
                
                if (result.success) {
                    showInfo('Téléchargement relancé');
                    await refreshDownloads();
                }
            }
        } catch (error) {
            console.error('[Downloads] Erreur retry:', error);
            showError('Impossible de relancer');
        }
    }
    
    // Mise à jour automatique
    function startAutoUpdate() {
        // Arrêter l'intervalle existant
        if (DownloadsState.updateInterval) {
            clearInterval(DownloadsState.updateInterval);
        }
        
        // Mettre à jour toutes les secondes si des téléchargements sont actifs
        DownloadsState.updateInterval = setInterval(async () => {
            if (DownloadsState.activeDownloads.size > 0) {
                await refreshDownloads();
            }
        }, 1000);
    }
    
    function stopAutoUpdate() {
        if (DownloadsState.updateInterval) {
            clearInterval(DownloadsState.updateInterval);
            DownloadsState.updateInterval = null;
        }
    }
    
    // Écouter les événements de téléchargement
    window.addEventListener('DOMContentLoaded', () => {
        // Événements de progression
        window.electronAPI.on('download-manager:download-started', async (data) => {
            console.log('[Downloads] Téléchargement démarré:', data);
            await refreshDownloads();
        });
        
        window.electronAPI.on('download-manager:download-progress', async (data) => {
            // Mise à jour rapide sans rechargement complet
            const item = document.querySelector(`[data-download-id="${data.id}"]`);
            if (item) {
                updateDownloadItemProgress(item, data);
            }
        });
        
        window.electronAPI.on('download-manager:download-completed', async (data) => {
            console.log('[Downloads] Téléchargement terminé:', data);
            showSuccess(`"${data.course?.title || 'Cours'}" téléchargé avec succès !`);
            await refreshDownloads();
        });
        
        window.electronAPI.on('download-manager:download-error', async (data) => {
            console.log('[Downloads] Erreur de téléchargement:', data);
            showError(`Erreur: ${data.error}`);
            await refreshDownloads();
        });
    });
    
    // Mise à jour rapide d'un élément
    function updateDownloadItemProgress(item, data) {
        const progressBar = item.querySelector('.progress-fill');
        const progressText = item.querySelector('.progress-text');
        const statusEl = item.querySelector('.download-status');
        const speedEl = item.querySelector('.download-speed');
        const etaEl = item.querySelector('.download-eta');
        const currentFileEl = item.querySelector('.download-current-file');
        
        if (progressBar) progressBar.style.width = `${data.progress}%`;
        if (progressText) progressText.textContent = `${Math.round(data.progress)}%`;
        if (statusEl) statusEl.textContent = getStatusInfo(data.status).text;
        if (speedEl && data.speed) speedEl.textContent = `${formatBytes(data.speed)}/s`;
        if (etaEl && data.eta) etaEl.textContent = `${formatDuration(data.eta)} restant`;
        if (currentFileEl && data.currentFile) currentFileEl.textContent = data.currentFile;
    }
    
    // Use shared utilities from utils.js (loaded first via script tag)
    const { escapeHtml, formatFileSize: formatBytes, formatDuration } = window.Utils || {};
    const showInfo = window.showInfo || ((msg) => console.info(msg));
    const showSuccess = window.showSuccess || ((msg) => console.log(msg));
    const showError = window.showError || ((msg) => console.error(msg));
    
    // Nettoyer quand on quitte la page
    window.addEventListener('beforeunload', () => {
        stopAutoUpdate();
    });
    
    // Export global
    window.downloadsManager = {
        loadDownloadsPage,
        refreshDownloads,
        DownloadsState
    };
    
    console.log('[Downloads] Module initialisé');
})();
