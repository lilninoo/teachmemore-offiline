// utils.js - Fonctions utilitaires pour l'application

// ==================== FORMATAGE ====================

// Formater la taille de fichier
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Formater la durée
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Formater la date
function formatDate(dateString, format = 'short') {
    const date = new Date(dateString);
    
    if (format === 'short') {
        return date.toLocaleDateString('fr-FR');
    } else if (format === 'long') {
        return date.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } else if (format === 'relative') {
        return formatRelativeTime(date);
    }
    
    return date.toLocaleString('fr-FR');
}

// Formater le temps relatif
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    
    if (seconds < 60) return 'À l\'instant';
    if (seconds < 3600) return `Il y a ${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `Il y a ${Math.floor(seconds / 3600)} heures`;
    if (seconds < 604800) return `Il y a ${Math.floor(seconds / 86400)} jours`;
    
    return formatDate(date, 'short');
}

// ==================== SÉCURITÉ ====================

// Échapper le HTML pour éviter les injections
function escapeHtml(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== VALIDATION ====================

// Valider une URL
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Valider un email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Valider un mot de passe (au moins 8 caractères)
function isValidPassword(password) {
    return password && password.length >= 8;
}

// ==================== MANIPULATION DOM ====================

// Créer un élément avec attributs et contenu
function createElement(tag, attributes = {}, content = '') {
    const element = document.createElement(tag);
    
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'dataset') {
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                element.dataset[dataKey] = dataValue;
            });
        } else {
            element.setAttribute(key, value);
        }
    });
    
    if (typeof content === 'string') {
        element.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        element.appendChild(content);
    } else if (Array.isArray(content)) {
        content.forEach(child => element.appendChild(child));
    }
    
    return element;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ==================== STOCKAGE LOCAL ====================

// Gestion du cache local temporaire
const LocalCache = {
    set(key, value, ttl = 3600000) { // TTL par défaut : 1 heure
        const item = {
            value: value,
            expiry: Date.now() + ttl
        };
        sessionStorage.setItem(key, JSON.stringify(item));
    },
    
    get(key) {
        const itemStr = sessionStorage.getItem(key);
        if (!itemStr) return null;
        
        const item = JSON.parse(itemStr);
        if (Date.now() > item.expiry) {
            sessionStorage.removeItem(key);
            return null;
        }
        
        return item.value;
    },
    
    remove(key) {
        sessionStorage.removeItem(key);
    },
    
    clear() {
        sessionStorage.clear();
    }
};

// ==================== GESTION DES ERREURS ====================

// Logger centralisé
const Logger = {
    log(message, data = null) {
        console.log(`[LearnPress] ${message}`, data || '');
        if (window.Logger && window.Logger !== Logger) {
            window.Logger.info(message, data);
        }
    },
    
    warn(message, data = null) {
        console.warn(`[LearnPress] ${message}`, data || '');
        if (window.Logger && window.Logger !== Logger) {
            window.Logger.warn(message, data);
        }
    },
    
    error(message, error = null) {
        console.error(`[LearnPress] ${message}`, error || '');
        if (window.electronAPI) {
            window.electronAPI.logError({ message, error: error?.toString() });
        }
        if (window.Logger && window.Logger !== Logger) {
            window.Logger.error(message, error);
        }
    },
    
    debug(message, data = null) {
        if (window.DEBUG_MODE) {
            console.debug(`[LearnPress Debug] ${message}`, data || '');
        }
        if (window.Logger && window.Logger !== Logger) {
            window.Logger.debug(message, data);
        }
    }
};

// Gestionnaire d'erreurs global
window.addEventListener('error', (event) => {
    Logger.error('Erreur non gérée:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('Promise rejetée:', event.reason);
});

// ==================== ANIMATIONS ====================

// Fade in element
function fadeIn(element, duration = 300) {
    element.style.opacity = 0;
    element.style.display = 'block';
    
    const start = performance.now();
    
    function animate(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        element.style.opacity = progress;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    requestAnimationFrame(animate);
}

// Fade out element
function fadeOut(element, duration = 300) {
    const start = performance.now();
    const initialOpacity = parseFloat(window.getComputedStyle(element).opacity);
    
    function animate(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        element.style.opacity = initialOpacity * (1 - progress);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            element.style.display = 'none';
        }
    }
    
    requestAnimationFrame(animate);
}

// ==================== UTILITAIRES DIVERS ====================

// Générer un ID unique
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Deep clone d'un objet
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    
    const clonedObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            clonedObj[key] = deepClone(obj[key]);
        }
    }
    
    return clonedObj;
}

// Trier un tableau d'objets
function sortArray(array, key, order = 'asc') {
    return array.sort((a, b) => {
        if (order === 'asc') {
            return a[key] > b[key] ? 1 : -1;
        } else {
            return a[key] < b[key] ? 1 : -1;
        }
    });
}

// Filtrer un tableau avec plusieurs critères
function filterArray(array, filters) {
    return array.filter(item => {
        return Object.entries(filters).every(([key, value]) => {
            if (value === null || value === undefined || value === '') return true;
            return item[key] === value;
        });
    });
}

// ==================== HELPERS POUR L'APPLICATION ====================

// Calculer l'espace de stockage utilisé
async function calculateStorageUsed() {
    try {
        const stats = await window.electronAPI.db.getStats();
        if (stats.success) {
            return {
                courses: stats.result.dbSize || 0,
                cache: 0,
                total: stats.result.dbSize || 0
            };
        }
        return { courses: 0, cache: 0, total: 0 };
    } catch (error) {
        Logger.error('Erreur lors du calcul du stockage:', error);
        return { courses: 0, cache: 0, total: 0 };
    }
}

// Vérifier si un cours est expiré
function isCourseExpired(course) {
    if (!course.expires_at) return false;
    return new Date(course.expires_at) < new Date();
}

// Obtenir l'icône pour un type de fichier
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'mp4': '🎥', 'avi': '🎥', 'mov': '🎥', 'mkv': '🎥',
        'pdf': '📕', 'doc': '📄', 'docx': '📄', 'txt': '📝',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
        'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵',
        'zip': '📦', 'rar': '📦', '7z': '📦',
        'xls': '📊', 'xlsx': '📊', 'csv': '📊',
        'video': '🎥',
        'text': '📄',
        'quiz': '❓',
        'assignment': '📋'
    };
    
    return icons[ext] || icons[filename] || '📎';
}

// Parser les paramètres de l'URL
function parseQueryParams(url) {
    const params = new URLSearchParams(url);
    const result = {};
    
    for (const [key, value] of params) {
        result[key] = value;
    }
    
    return result;
}

// ==================== FONCTIONS UI GLOBALES ====================

// Afficher le loader
function showLoader(message = 'Chargement...') {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.querySelector('p').textContent = message;
        loader.classList.add('show');
    }
}

// Masquer le loader
function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('show');
    }
}

// Afficher une erreur
function showError(message) {
    showNotification(message, 'error');
}

// Afficher un succès
function showSuccess(message) {
    showNotification(message, 'success');
}

// Afficher une info
function showInfo(message) {
    showNotification(message, 'info');
}

// Afficher un avertissement
function showWarning(message) {
    showNotification(message, 'warning');
}

// Afficher une notification
function showNotification(message, type = 'info') {
    // Supprimer les anciennes notifications du même type
    const oldNotifications = document.querySelectorAll(`.notification-${type}`);
    oldNotifications.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type} show`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-message">${escapeHtml(message)}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-supprimer après 5 secondes
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Obtenir l'icône de notification
function getNotificationIcon(type) {
    const icons = {
        'success': '✅',
        'error': '❌',
        'warning': '⚠️',
        'info': 'ℹ️'
    };
    return icons[type] || 'ℹ️';
}

// Afficher une boîte de message
function showMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;
    
    const container = document.getElementById('message-container') || document.body;
    container.appendChild(messageEl);
    
    setTimeout(() => messageEl.remove(), 5000);
}

// Afficher/Masquer une page
function showPage(pageId) {
    // Masquer toutes les pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
    
    // Afficher la page demandée
    const page = document.getElementById(pageId);
    if (page) {
        page.classList.remove('hidden');
    }
}

// Afficher le player
function showPlayer() {
    showPage('player-page');
}

// Afficher le dashboard
function showDashboard() {
    showPage('dashboard-page');
}

// Créer une carte de cours
function createCourseCard(course, progress) {
    const card = document.createElement('div');
    card.className = 'course-card card';
    card.dataset.courseId = course.course_id;
    
    const isExpired = isCourseExpired(course);
    const thumbnailUrl = course.thumbnail || 'assets/default-course.jpg';
    
    card.innerHTML = `
        <div class="course-thumbnail-wrapper">
            <img src="${escapeHtml(thumbnailUrl)}" 
                 alt="${escapeHtml(course.title)}" 
                 class="course-thumbnail"
                 onerror="this.src='assets/default-course.jpg'">
            ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
        </div>
        <div class="course-info">
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-instructor">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
            <div class="course-stats">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
            </div>
        </div>
        ${progress ? `
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${Math.round(progress.completion_percentage || 0)}%"></div>
        </div>
        ` : ''}
        <div class="course-actions">
            <button class="btn btn-icon" onclick="event.stopPropagation(); deleteCourse(${course.course_id})" title="Supprimer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        </div>
    `;
    
    // Ajouter l'événement de clic
    card.addEventListener('click', () => {
        if (!isExpired) {
            openCourse(course.course_id);
        } else {
            showWarning('Ce cours a expiré et ne peut plus être consulté');
        }
    });
    
    return card;
}

// Marquer une leçon comme active
function markLessonActive(lessonId) {
    // Retirer la classe active de toutes les leçons
    document.querySelectorAll('.lesson-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Ajouter la classe active à la leçon sélectionnée
    const lessonEl = document.querySelector(`[data-lesson-id="${lessonId}"]`);
    if (lessonEl) {
        lessonEl.classList.add('active');
    }
}

// Mettre à jour l'interface de la leçon
function updateLessonUI() {
    const completeBtn = document.getElementById('complete-lesson');
    if (completeBtn) {
        if (window.currentLesson && window.currentLesson.completed) {
            completeBtn.textContent = 'Leçon terminée ✓';
            completeBtn.disabled = true;
        } else {
            completeBtn.textContent = 'Marquer comme terminé';
            completeBtn.disabled = false;
        }
    }
}

// ==================== EXPORTS GLOBAUX ====================

// Exposer les utilitaires globalement
window.Utils = {
    // Formatage
    formatFileSize,
    formatDuration,
    formatDate,
    formatRelativeTime,
    
    // Sécurité
    escapeHtml,
    
    // Validation
    isValidUrl,
    isValidEmail,
    isValidPassword,
    
    // DOM
    createElement,
    debounce,
    throttle,
    
    // Cache
    LocalCache,
    
    // Logger
    Logger,
    
    // Animations
    fadeIn,
    fadeOut,
    
    // Divers
    generateId,
    deepClone,
    sortArray,
    filterArray,
    
    // App specific
    calculateStorageUsed,
    isCourseExpired,
    getFileIcon,
    parseQueryParams
};

// Raccourcis globaux
window.log = Logger.log;
window.logError = Logger.error;
window.logWarn = Logger.warn;
window.logDebug = Logger.debug;

// Mode debug (peut être activé via la console)
window.DEBUG_MODE = false;
