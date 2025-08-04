
// progress.js - Gestion complète de la progression des cours
(function() {
    'use strict';
    
    console.log('[Progress] Module de progression chargé');
    
    // État de la progression
    const ProgressState = {
        courses: [],
        updateInterval: null
    };
    
    // Fonction principale pour charger la page de progression
    window.loadProgressPage = async function() {
        console.log('[Progress] Chargement de la page de progression');
        
        const container = document.getElementById('progress-container');
        if (!container) {
            console.error('[Progress] Container progress-container non trouvé');
            return;
        }
        
        // Afficher le loader
        container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement de votre progression...</p></div>';
        
        try {
            // Charger tous les cours avec leur progression
            await loadCoursesProgress();
            
            // Afficher la progression
            displayProgress(container);
            
            // Démarrer la mise à jour automatique
            startProgressAutoUpdate();
            
        } catch (error) {
            console.error('[Progress] Erreur lors du chargement:', error);
            container.innerHTML = `
                <div class="message message-error">
                    <p>Erreur lors du chargement de la progression</p>
                    <button class="btn btn-sm" onclick="loadProgressPage()">Réessayer</button>
                </div>
            `;
        }
    };
    
    // Charger la progression de tous les cours
    async function loadCoursesProgress() {
        try {
            // Récupérer tous les cours téléchargés
            const coursesResult = await window.electronAPI.db.getAllCourses();
            
            if (coursesResult.success && coursesResult.result) {
                const courses = coursesResult.result;
                
                // Pour chaque cours, récupérer la progression détaillée
                const coursesWithProgress = [];
                
                for (const course of courses) {
                    const progressResult = await window.electronAPI.db.getCourseProgress(course.course_id);
                    
                    if (progressResult.success && progressResult.result) {
                        coursesWithProgress.push({
                            ...course,
                            progress: progressResult.result
                        });
                    } else {
                        // Cours sans progression
                        coursesWithProgress.push({
                            ...course,
                            progress: {
                                completion_percentage: 0,
                                completed_lessons: 0,
                                total_lessons: course.lessons_count || 0,
                                last_accessed: course.last_accessed
                            }
                        });
                    }
                }
                
                ProgressState.courses = coursesWithProgress;
                console.log(`[Progress] ${coursesWithProgress.length} cours chargés`);
                
            } else {
                ProgressState.courses = [];
            }
        } catch (error) {
            console.error('[Progress] Erreur lors du chargement des cours:', error);
            ProgressState.courses = [];
        }
    }
    
    // Afficher la progression
    function displayProgress(container) {
        if (ProgressState.courses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    <h3>Aucune progression</h3>
                    <p>Commencez à suivre des cours pour voir votre progression</p>
                </div>
            `;
            return;
        }
        
        // Calculer les statistiques globales
        const stats = calculateGlobalStats();
        
        // Séparer les cours par statut
        const inProgressCourses = ProgressState.courses.filter(c => 
            c.progress.completion_percentage > 0 && c.progress.completion_percentage < 100
        );
        const completedCourses = ProgressState.courses.filter(c => 
            c.progress.completion_percentage >= 100
        );
        const notStartedCourses = ProgressState.courses.filter(c => 
            c.progress.completion_percentage === 0
        );
        
        let html = `
            <div class="progress-overview">
                <!-- Statistiques globales -->
                <div class="progress-stats">
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalCourses}</div>
                        <div class="stat-label">Cours total</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.completedCourses}</div>
                        <div class="stat-label">Cours terminés</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalLessons}</div>
                        <div class="stat-label">Leçons total</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.completedLessons}</div>
                        <div class="stat-label">Leçons terminées</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${Math.round(stats.globalProgress)}%</div>
                        <div class="stat-label">Progression globale</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${formatDuration(stats.totalTime)}</div>
                        <div class="stat-label">Temps total</div>
                    </div>
                </div>
                
                <!-- Graphique de progression (placeholder) -->
                <div class="progress-chart">
                    <canvas id="progress-chart"></canvas>
                </div>
        `;
        
        // Cours en cours
        if (inProgressCourses.length > 0) {
            html += `
                <div class="progress-section">
                    <h3>En cours (${inProgressCourses.length})</h3>
                    <div class="progress-list">
            `;
            
            inProgressCourses.forEach(course => {
                html += createProgressItem(course, 'in-progress');
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Cours terminés
        if (completedCourses.length > 0) {
            html += `
                <div class="progress-section">
                    <h3>Terminés (${completedCourses.length})</h3>
                    <div class="progress-list">
            `;
            
            completedCourses.forEach(course => {
                html += createProgressItem(course, 'completed');
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Cours non commencés
        if (notStartedCourses.length > 0) {
            html += `
                <div class="progress-section">
                    <h3>Non commencés (${notStartedCourses.length})</h3>
                    <div class="progress-list">
            `;
            
            notStartedCourses.forEach(course => {
                html += createProgressItem(course, 'not-started');
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        
        container.innerHTML = html;
        
        // Dessiner le graphique de progression
        drawProgressChart();
        
        // Attacher les événements
        attachProgressEvents();
    }
    
    // Calculer les statistiques globales
    function calculateGlobalStats() {
        const stats = {
            totalCourses: ProgressState.courses.length,
            completedCourses: 0,
            totalLessons: 0,
            completedLessons: 0,
            globalProgress: 0,
            totalTime: 0
        };
        
        ProgressState.courses.forEach(course => {
            // Cours terminés
            if (course.progress.completion_percentage >= 100) {
                stats.completedCourses++;
            }
            
            // Leçons
            stats.totalLessons += course.progress.total_lessons || course.lessons_count || 0;
            stats.completedLessons += course.progress.completed_lessons || 0;
            
            // Temps total (estimation)
            if (course.duration) {
                // Convertir la durée en secondes si nécessaire
                const duration = parseDuration(course.duration);
                stats.totalTime += duration * (course.progress.completion_percentage / 100);
            }
        });
        
        // Progression globale
        if (stats.totalLessons > 0) {
            stats.globalProgress = (stats.completedLessons / stats.totalLessons) * 100;
        }
        
        return stats;
    }
    
    // Créer un élément de progression
    function createProgressItem(course, status) {
        const progress = course.progress.completion_percentage || 0;
        const isCompleted = progress >= 100;
        
        return `
            <div class="progress-item ${status}" data-course-id="${course.course_id}">
                <div class="progress-item-header">
                    <div>
                        <h4>${escapeHtml(course.title)}</h4>
                        <p class="text-muted">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
                    </div>
                    <div class="progress-percentage ${isCompleted ? 'text-success' : ''}">
                        ${Math.round(progress)}%
                    </div>
                </div>
                
                <div class="progress-bar-container">
                    <div class="progress-bar ${isCompleted ? 'progress-bar-success' : ''}" 
                         style="width: ${progress}%"></div>
                </div>
                
                <div class="progress-details">
                    <span>📚 ${course.progress.completed_lessons || 0}/${course.progress.total_lessons || course.lessons_count || 0} leçons</span>
                    ${course.duration ? `<span>⏱️ ${formatTimeSpent(course.duration, progress)}</span>` : ''}
                    ${course.last_accessed ? `<span>📅 ${formatLastAccessed(course.last_accessed)}</span>` : ''}
                    ${course.rating && isCompleted ? `<span>⭐ ${course.rating}/5</span>` : ''}
                </div>
                
                <div class="progress-actions">
                    ${!isCompleted ? `
                        <button class="btn btn-primary btn-sm continue-course-btn">
                            Continuer
                        </button>
                    ` : `
                        <button class="btn btn-secondary btn-sm review-course-btn">
                            Revoir
                        </button>
                        <button class="btn btn-success btn-sm certificate-btn">
                            Certificat
                        </button>
                    `}
                </div>
            </div>
        `;
    }
    
    // Dessiner le graphique de progression
    function drawProgressChart() {
        const canvas = document.getElementById('progress-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = 200;
        
        // Données pour le graphique
        const data = ProgressState.courses.map(c => ({
            name: c.title,
            progress: c.progress.completion_percentage || 0
        })).slice(0, 10); // Limiter à 10 cours
        
        // Dessiner un simple graphique en barres
        const barWidth = width / data.length;
        const maxHeight = height - 40;
        
        ctx.clearRect(0, 0, width, height);
        
        data.forEach((item, index) => {
            const x = index * barWidth + barWidth * 0.1;
            const barHeight = (item.progress / 100) * maxHeight;
            const y = height - barHeight - 20;
            
            // Barre
            ctx.fillStyle = item.progress >= 100 ? '#28a745' : '#2271b1';
            ctx.fillRect(x, y, barWidth * 0.8, barHeight);
            
            // Pourcentage
            ctx.fillStyle = '#333';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.round(item.progress)}%`, x + barWidth * 0.4, y - 5);
            
            // Nom du cours (tronqué)
            ctx.save();
            ctx.translate(x + barWidth * 0.4, height - 5);
            ctx.rotate(-Math.PI / 4);
            ctx.font = '10px Arial';
            ctx.fillText(item.name.substring(0, 15) + '...', 0, 0);
            ctx.restore();
        });
    }
    
    // Attacher les événements
    function attachProgressEvents() {
        // Continuer un cours
        document.querySelectorAll('.continue-course-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const courseId = e.target.closest('.progress-item').dataset.courseId;
                openCourse(courseId);
            });
        });
        
        // Revoir un cours
        document.querySelectorAll('.review-course-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const courseId = e.target.closest('.progress-item').dataset.courseId;
                openCourse(courseId);
            });
        });
        
        // Certificat
        document.querySelectorAll('.certificate-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const courseId = e.target.closest('.progress-item').dataset.courseId;
                showCertificate(courseId);
            });
        });
    }
    
    // Ouvrir un cours
    function openCourse(courseId) {
        if (window.openCourse) {
            window.openCourse(courseId);
        } else {
            console.error('[Progress] Fonction openCourse non disponible');
        }
    }
    
    // Afficher le certificat
    function showCertificate(courseId) {
        const course = ProgressState.courses.find(c => c.course_id == courseId);
        if (!course) return;
        
        // Créer un modal pour le certificat
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal" style="max-width: 600px;">
                <div class="modal-header">
                    <h3 class="modal-title">Certificat de réussite</h3>
                    <button class="btn btn-icon" onclick="this.closest('.modal-backdrop').remove()">×</button>
                </div>
                <div class="modal-body" style="text-align: center;">
                    <div class="certificate-preview" style="padding: 40px; border: 2px solid #2271b1; border-radius: 8px; background: #f8f9fa;">
                        <h2 style="color: #2271b1; margin-bottom: 20px;">Certificat de Réussite</h2>
                        <p style="font-size: 18px; margin: 20px 0;">Décerné à</p>
                        <h3 style="font-size: 24px; margin: 20px 0;">Vous</h3>
                        <p style="margin: 20px 0;">Pour avoir complété avec succès le cours</p>
                        <h4 style="font-size: 20px; color: #2271b1; margin: 20px 0;">${escapeHtml(course.title)}</h4>
                        <p style="margin: 20px 0;">Le ${new Date().toLocaleDateString('fr-FR')}</p>
                        <div style="margin-top: 40px;">
                            <p style="font-style: italic;">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Fermer</button>
                    <button class="btn btn-primary" onclick="downloadCertificate('${courseId}')">
                        Télécharger PDF
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // Télécharger le certificat
    window.downloadCertificate = async function(courseId) {
        showInfo('Le téléchargement de certificats sera disponible dans une prochaine version');
    };
    
    // Mise à jour automatique
    function startProgressAutoUpdate() {
        // Mettre à jour toutes les 30 secondes
        ProgressState.updateInterval = setInterval(async () => {
            await loadCoursesProgress();
            displayProgress(document.getElementById('progress-container'));
        }, 30000);
    }
    
    function stopProgressAutoUpdate() {
        if (ProgressState.updateInterval) {
            clearInterval(ProgressState.updateInterval);
            ProgressState.updateInterval = null;
        }
    }
    
    // Utilitaires
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function formatDuration(seconds) {
        if (!seconds) return '0h';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
    
    function parseDuration(duration) {
        // Convertir une durée string en secondes
        if (typeof duration === 'number') return duration;
        if (!duration) return 0;
        
        // Essayer de parser "2h 30m" ou "45m" etc.
        const match = duration.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/);
        if (match) {
            const hours = parseInt(match[1] || 0);
            const minutes = parseInt(match[2] || 0);
            return hours * 3600 + minutes * 60;
        }
        
        return 0;
    }
    
    function formatTimeSpent(totalDuration, progressPercent) {
        const duration = parseDuration(totalDuration);
        const spent = duration * (progressPercent / 100);
        return `${formatDuration(spent)} / ${formatDuration(duration)}`;
    }
    
    function formatLastAccessed(date) {
        if (!date) return '';
        
        const lastDate = new Date(date);
        const now = new Date();
        const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return "Aujourd'hui";
        if (diffDays === 1) return "Hier";
        if (diffDays < 7) return `Il y a ${diffDays} jours`;
        if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} semaines`;
        
        return lastDate.toLocaleDateString('fr-FR');
    }
    
    function showInfo(message) {
        window.showInfo ? window.showInfo(message) : console.info(message);
    }
    
    // Nettoyer quand on quitte la page
    window.addEventListener('beforeunload', () => {
        stopProgressAutoUpdate();
    });
    
    // Export global
    window.progressManager = {
        loadProgressPage,
        ProgressState
    };
    
    console.log('[Progress] Module initialisé');
})();
