// src/js/conflict-resolver.js - Gestionnaire de résolution de conflits de synchronisation

class ConflictResolver {
    constructor() {
        this.pendingResolution = null;
        this.resolveCallback = null;
        this.rejectCallback = null;
    }

    async showConflictDialog(conflicts) {
        return new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;
            this.createAndShowModal(conflicts);
        });
    }

    createAndShowModal(conflicts) {
        // Supprimer la modal existante si elle existe
        const existingModal = document.getElementById('conflict-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'conflict-modal';
        modal.className = 'modal-backdrop sync-conflict-modal';
        modal.innerHTML = `
            <div class="modal conflict-dialog">
                <div class="modal-header">
                    <h3 class="modal-title">Conflits de synchronisation détectés</h3>
                    <button class="btn btn-icon" onclick="conflictResolver.cancel()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="conflict-description">
                        ${conflicts.length} modification${conflicts.length > 1 ? 's' : ''} 
                        en conflit. Choisissez quelle version conserver :
                    </p>
                    <div class="conflict-list">
                        ${conflicts.map(c => this.renderConflict(c)).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <div class="conflict-actions">
                        <button class="btn btn-secondary" onclick="conflictResolver.resolveAll('server')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                            Utiliser toutes les versions serveur
                        </button>
                        <button class="btn btn-secondary" onclick="conflictResolver.resolveAll('local')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                            Garder toutes mes modifications
                        </button>
                        <button class="btn btn-primary" onclick="conflictResolver.applyResolution()">
                            Appliquer les choix
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        // Initialiser les resolutions
        this.pendingResolution = {};
        conflicts.forEach(c => {
            this.pendingResolution[c.id] = 'server'; // Par défaut, serveur
        });

        // Animer l'apparition
        setTimeout(() => modal.classList.add('show'), 10);
    }

    renderConflict(conflict) {
        const conflictId = conflict.id;
        return `
            <div class="conflict-item" data-conflict-id="${conflictId}">
                <h4 class="conflict-title">
                    ${this.getConflictTitle(conflict)}
                </h4>
                <div class="conflict-comparison">
                    <div class="version-card local-version ${this.pendingResolution?.[conflictId] === 'local' ? 'selected' : ''}">
                        <label class="version-label">
                            <input type="radio" 
                                   name="conflict-${conflictId}" 
                                   value="local"
                                   onchange="conflictResolver.selectVersion('${conflictId}', 'local')"
                                   ${this.pendingResolution?.[conflictId] === 'local' ? 'checked' : ''}>
                            <div class="version-content">
                                <h5>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                    </svg>
                                    Votre version (locale)
                                </h5>
                                <div class="version-details">
                                    ${this.renderVersionDetails(conflict.local)}
                                </div>
                            </div>
                        </label>
                    </div>
                    
                    <div class="conflict-vs">VS</div>
                    
                    <div class="version-card server-version ${this.pendingResolution?.[conflictId] === 'server' ? 'selected' : ''}">
                        <label class="version-label">
                            <input type="radio" 
                                   name="conflict-${conflictId}" 
                                   value="server"
                                   onchange="conflictResolver.selectVersion('${conflictId}', 'server')"
                                   ${this.pendingResolution?.[conflictId] === 'server' ? 'checked' : ''}>
                            <div class="version-content">
                                <h5>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                                    </svg>
                                    Version serveur
                                </h5>
                                <div class="version-details">
                                    ${this.renderVersionDetails(conflict.server)}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    getConflictTitle(conflict) {
        switch (conflict.entity_type) {
            case 'lesson':
                return `Leçon : ${conflict.entity_name || `#${conflict.entity_id}`}`;
            case 'quiz':
                return `Quiz : ${conflict.entity_name || `#${conflict.entity_id}`}`;
            case 'course':
                return `Cours : ${conflict.entity_name || `#${conflict.entity_id}`}`;
            default:
                return `${conflict.entity_type} : ${conflict.entity_id}`;
        }
    }

    renderVersionDetails(version) {
        const date = new Date(version.updated_at);
        const details = [];

        details.push(`<p class="version-date">Modifié : ${date.toLocaleString('fr-FR')}</p>`);

        if (version.data) {
            if (version.data.progress !== undefined) {
                details.push(`
                    <p class="version-progress">
                        Progression : <strong>${version.data.progress}%</strong>
                        <div class="progress-bar mini">
                            <div class="progress-fill" style="width: ${version.data.progress}%"></div>
                        </div>
                    </p>
                `);
            }
            if (version.data.completed !== undefined) {
                details.push(`
                    <p class="version-status">
                        État : <strong>${version.data.completed ? 'Terminé ✓' : 'En cours'}</strong>
                    </p>
                `);
            }
            if (version.data.score !== undefined) {
                details.push(`<p>Score : <strong>${version.data.score}%</strong></p>`);
            }
        }

        return details.join('');
    }

    selectVersion(conflictId, version) {
        this.pendingResolution[conflictId] = version;
        
        // Mettre à jour l'UI
        const conflictItem = document.querySelector(`[data-conflict-id="${conflictId}"]`);
        if (conflictItem) {
            conflictItem.querySelectorAll('.version-card').forEach(card => {
                card.classList.remove('selected');
            });
            conflictItem.querySelector(`.${version}-version`).classList.add('selected');
        }
    }

    resolveAll(version) {
        Object.keys(this.pendingResolution).forEach(conflictId => {
            this.pendingResolution[conflictId] = version;
            this.selectVersion(conflictId, version);
        });
    }

    applyResolution() {
        if (this.resolveCallback) {
            this.resolveCallback(this.pendingResolution);
            this.closeModal();
        }
    }

    cancel() {
        if (this.rejectCallback) {
            this.rejectCallback(new Error('Résolution annulée'));
            this.closeModal();
        }
    }

    closeModal() {
        const modal = document.getElementById('conflict-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
        }
        
        this.pendingResolution = null;
        this.resolveCallback = null;
        this.rejectCallback = null;
    }
}

// Instance globale
window.conflictResolver = new ConflictResolver();

// Export pour les modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConflictResolver;
}