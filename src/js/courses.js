// courses.js - Gestion complète des cours et téléchargements




// Vérifier que les dépendances sont chargées
if (typeof window === 'undefined') {
    throw new Error('courses.js doit être chargé dans un environnement navigateur');
}

// Log de démarrage
console.log('[Courses] Module en cours de chargement...');

// ==================== INITIALISATION ====================

// Image par défaut en base64 (un placeholder SVG avec une icône de livre)
const DEFAULT_COURSE_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMwMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTgwIiBmaWxsPSIjMzMzMzMzIi8+CjxwYXRoIGQ9Ik0xNTAgNjBDMTM1IDYwIDEyMCA2NSAxMjAgODBWMTAwQzEyMCAxMTUgMTM1IDEyMCAxNTAgMTIwQzE2NSAxMjAgMTgwIDExNSAxODAgMTAwVjgwQzE4MCA2NSAxNjUgNjAgMTUwIDYwWiIgZmlsbD0iIzY2NjY2NiIvPgo8cGF0aCBkPSJNMTMwIDkwSDE3MFY5NUgxMzBWOTBaIiBmaWxsPSIjOTk5OTk5Ii8+CjxwYXRoIGQ9Ik0xMzAgMTAwSDE3MFYxMDVIMTMwVjEwMFoiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTE0NSA3MEgxNTVWMTE1SDE0NVY3MFoiIGZpbGw9IiM5OTk5OTkiLz4KPC9zdmc+';

// Utiliser directement les fonctions de utils.js sans les redéclarer
const escapeHtml = window.Utils?.escapeHtml || ((text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
});

const formatFileSize = window.Utils?.formatFileSize || ((bytes) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

const formatDate = window.Utils?.formatDate || ((dateString, format) => {
    const date = new Date(dateString);
    if (format === 'long') {
        return date.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    return date.toLocaleDateString('fr-FR');
});

const formatDuration = window.Utils?.formatDuration || ((seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
});

const isCourseExpired = window.Utils?.isCourseExpired || ((course) => {
    if (!course.expires_at) return false;
    return new Date(course.expires_at) < new Date();
});

const debounce = window.Utils?.debounce || function(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Fonctions de notification - utiliser celles globales si disponibles
const showError = window.showError || ((message) => {
    console.error('Erreur:', message);
    alert(message);
});

const showSuccess = window.showSuccess || ((message) => {
    console.log('Succès:', message);
    alert(message);
});

const showWarning = window.showWarning || ((message) => {
    console.warn('Avertissement:', message);
    alert(message);
});

const showInfo = window.showInfo || ((message) => {
    console.info('Info:', message);
    alert(message);
});

const showLoader = window.showLoader || ((message) => {
    console.log('Chargement:', message);
});

const hideLoader = window.hideLoader || (() => {
    console.log('Fin du chargement');
});

// État local du module
const CoursesState = {
    availableCourses: [],
    downloadedCourses: [],
    activeDownloads: new Map(),
    filters: {
        category: null,
        difficulty: null,
        search: '',
        showDownloaded: true,
        showAvailable: true
    },
    currentPage: 1,
    coursesPerPage: 12
};

// ==================== INITIALISATION ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeCourses();
    loadActiveDownloads();
});

function initializeCourses() {
    // Gestionnaires d'événements pour le téléchargement
    const downloadBtn = document.getElementById('download-course-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', showDownloadModal);
    }
    
    const closeDownloadModal = document.getElementById('close-download-modal');
    if (closeDownloadModal) {
        closeDownloadModal.addEventListener('click', hideDownloadModal);
    }
    
    const cancelDownload = document.getElementById('cancel-download');
    if (cancelDownload) {
        cancelDownload.addEventListener('click', hideDownloadModal);
    }
    
    const startDownloadBtn = document.getElementById('start-download');
    if (startDownloadBtn) {
        startDownloadBtn.addEventListener('click', startDownload);
    }
    
    // Sélection de cours
    const courseSelect = document.getElementById('course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', onCourseSelected);
    }
    
    // Options de téléchargement
    const downloadOptions = ['include-videos', 'include-documents', 'compress-media'];
    downloadOptions.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updateDownloadEstimate);
        }
    });
    
    // Écouter les événements de progression
    window.electronAPI.on('download-progress', handleDownloadProgress);
    window.electronAPI.on('download-completed', handleDownloadCompleted);
    window.electronAPI.on('download-error', handleDownloadError);
    window.electronAPI.on('course-downloaded', handleCourseDownloaded);
}

// ==================== AFFICHAGE DES COURS ====================

async function loadCourses() {
    const container = document.getElementById('courses-container');
    const coursesListContainer = document.getElementById('courses-list');
    
    // Utiliser le bon container selon la page active
    const activeContainer = container || coursesListContainer;
    if (!activeContainer) {
        console.error('[Courses] Aucun container trouvé pour les cours');
        return;
    }
    
    // Afficher le loader
    activeContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        // 1. Charger les cours locaux (offline first)
        const localCoursesPromise = loadLocalCourses();
        
        // 2. Charger les cours en ligne
        const onlineCoursesPromise = loadOnlineCourses();
        
        // Attendre les deux promesses
        const [localCourses, onlineCourses] = await Promise.all([
            localCoursesPromise,
            onlineCoursesPromise
        ]);
        
        // Fusionner les données
        const mergedCourses = mergeCourseData(localCourses, onlineCourses);
        
        // Afficher les cours
        await displayCourses(mergedCourses, activeContainer);
        
        // Mettre à jour les statistiques
        updateDashboardStats(mergedCourses);
        
    } catch (error) {
        console.error('[Courses] Erreur lors du chargement des cours:', error);
        activeContainer.innerHTML = `
            <div class="message message-error">
                Erreur lors du chargement des cours
                <button class="btn btn-sm" onclick="window.loadCourses()">Réessayer</button>
            </div>
        `;
    }
}

async function loadLocalCourses() {
    try {
        const response = await window.electronAPI.db.getAllCourses();
        if (response.success && response.result) {
            CoursesState.downloadedCourses = response.result;
            return response.result;
        }
        return [];
    } catch (error) {
        console.error('[Courses] Erreur lors du chargement des cours locaux:', error);
        return [];
    }
}

async function loadOnlineCourses() {
    try {
        const response = await window.electronAPI.api.getUserCourses({
            enrolled_only: true,
            page: 1,
            per_page: 100
        });
        
        if (response.success && response.courses) {
            CoursesState.availableCourses = response.courses;
            return response.courses;
        }
        return [];
    } catch (error) {
        console.warn('[Courses] Impossible de charger les cours en ligne:', error);
        return [];
    }
}

function mergeCourseData(localCourses, onlineCourses) {
    const merged = new Map();
    
    // Ajouter les cours locaux
    localCourses.forEach(course => {
        merged.set(course.course_id, {
            ...course,
            isDownloaded: true,
            isLocal: true
        });
    });
    
    // Fusionner avec les cours en ligne
    onlineCourses.forEach(course => {
        const courseId = course.id || course.course_id;
        const existing = merged.get(courseId);
        
        if (existing) {
            // Fusionner les données
            merged.set(courseId, {
                ...existing,
                ...course,
                isDownloaded: true,
                isOnline: true,
                // Garder les données locales importantes
                last_accessed: existing.last_accessed,
                local_path: existing.local_path
            });
        } else {
            // Ajouter le cours en ligne
            merged.set(courseId, {
                ...course,
                course_id: courseId,
                isDownloaded: false,
                isOnline: true
            });
        }
    });
    
    return Array.from(merged.values());
}

async function displayCourses(courses, container) {
    if (!container) {
        console.error('[Courses] Container non fourni');
        return;
    }
    
    // IMPORTANT: Vérifier qu'on n'est pas déjà en train d'afficher
    if (container.dataset.loading === 'true') {
        console.warn('[Courses] Affichage déjà en cours, annulation');
        return;
    }
    
    container.dataset.loading = 'true';
    
    try {
        if (!courses || courses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                        <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                    </svg>
                    <h3>Aucun cours disponible</h3>
                    <p>Téléchargez des cours pour les consulter hors ligne</p>
                    <button class="btn btn-primary" onclick="showDownloadModal()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                        Télécharger un cours
                    </button>
                </div>
            `;
            return;
        }
        
        // Appliquer les filtres
        const filteredCourses = applyFilters(courses);
        
        // Pagination
        const totalPages = Math.ceil(filteredCourses.length / CoursesState.coursesPerPage);
        const startIndex = (CoursesState.currentPage - 1) * CoursesState.coursesPerPage;
        const endIndex = startIndex + CoursesState.coursesPerPage;
        const coursesToDisplay = filteredCourses.slice(startIndex, endIndex);
        
        // Créer le conteneur
        container.innerHTML = `
            <div class="courses-grid" id="courses-grid"></div>
            ${totalPages > 1 ? createPaginationHTML(totalPages) : ''}
        `;
        
        // Afficher les cours
        const grid = document.getElementById('courses-grid');
        if (!grid) {
            console.error('[Courses] Grid non trouvé');
            return;
        }
        
        for (const course of coursesToDisplay) {
            const card = await createCourseCard(course);
            if (typeof card === 'string') {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = card;
                grid.appendChild(tempDiv.firstElementChild);
            } else {
                grid.appendChild(card);
            }
        }
        
    } finally {
        container.dataset.loading = 'false';
    }
}


async function loadCoursesPage() {
    console.log('[Courses] Chargement de la page Mes cours (téléchargés uniquement)');
    const container = document.getElementById('courses-list');
    if (!container) return;

    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement...</p></div>';

    // Wire the "Télécharger un cours" button to navigate to Dashboard
    const browseBtn = document.getElementById('browse-courses-btn');
    if (browseBtn) {
        browseBtn.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const dashNav = document.querySelector('[data-page="dashboard"]');
            if (dashNav) dashNav.classList.add('active');
            if (window.showContentPage) window.showContentPage('dashboard');
            if (window.loadPageContent) window.loadPageContent('dashboard');
        };
    }

    try {
        const localCourses = await loadLocalCourses();
        CoursesState.downloadedCourses = localCourses;

        // Update badge
        const badge = document.getElementById('courses-count');
        if (badge) badge.textContent = localCourses.length;

        if (localCourses.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:60px 20px;">
                    <svg width="80" height="80" viewBox="0 0 24 24" fill="var(--text-secondary)" style="margin-bottom:20px;opacity:0.4;">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    <h3 style="margin-bottom:10px;color:var(--text-secondary);">Aucun cours téléchargé</h3>
                    <p style="color:var(--text-secondary);margin-bottom:20px;">Téléchargez des cours depuis le tableau de bord pour y accéder hors ligne.</p>
                    <button class="btn btn-primary" id="go-to-dashboard-btn">
                        Explorer les cours disponibles
                    </button>
                </div>
            `;
            const goBtn = document.getElementById('go-to-dashboard-btn');
            if (goBtn) {
                goBtn.onclick = () => {
                    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                    const dashNav = document.querySelector('[data-page="dashboard"]');
                    if (dashNav) dashNav.classList.add('active');
                    if (window.showContentPage) window.showContentPage('dashboard');
                    if (window.loadPageContent) window.loadPageContent('dashboard');
                };
            }
            return;
        }

        // Mark all as downloaded and render
        const courses = localCourses.map(c => ({ ...c, isDownloaded: true, isLocal: true }));
        await displayCourses(courses, container);

    } catch (error) {
        console.error('[Courses] Erreur chargement Mes cours:', error);
        container.innerHTML = `
            <div class="message message-error">
                <p>Erreur lors du chargement des cours</p>
                <button class="btn btn-sm" onclick="loadCoursesPage()">Réessayer</button>
            </div>
        `;
    }
}


function applyFilters(courses) {
    return courses.filter(course => {
        // Filtre de recherche
        if (CoursesState.filters.search) {
            const searchLower = CoursesState.filters.search.toLowerCase();
            const matchTitle = course.title?.toLowerCase().includes(searchLower);
            const matchInstructor = course.instructor_name?.toLowerCase().includes(searchLower);
            if (!matchTitle && !matchInstructor) return false;
        }
        
        // Filtre de catégorie
        if (CoursesState.filters.category && course.category !== CoursesState.filters.category) {
            return false;
        }
        
        // Filtre de difficulté
        if (CoursesState.filters.difficulty && course.difficulty_level !== CoursesState.filters.difficulty) {
            return false;
        }
        
        // Filtre téléchargé/disponible
        if (!CoursesState.filters.showDownloaded && course.isDownloaded) return false;
        if (!CoursesState.filters.showAvailable && !course.isDownloaded) return false;
        
        return true;
    });
}

function createFiltersHTML() {
    return `
        <div class="filters-row">
            <input type="text" 
                   id="course-search" 
                   class="form-control" 
                   placeholder="Rechercher un cours..."
                   value="${CoursesState.filters.search}">
            
            <select id="category-filter" class="form-control">
                <option value="">Toutes les catégories</option>
                ${getUniqueCategories().map(cat => 
                    `<option value="${cat}" ${CoursesState.filters.category === cat ? 'selected' : ''}>${cat}</option>`
                ).join('')}
            </select>
            
            <select id="difficulty-filter" class="form-control">
                <option value="">Toutes les difficultés</option>
                <option value="beginner" ${CoursesState.filters.difficulty === 'beginner' ? 'selected' : ''}>Débutant</option>
                <option value="intermediate" ${CoursesState.filters.difficulty === 'intermediate' ? 'selected' : ''}>Intermédiaire</option>
                <option value="advanced" ${CoursesState.filters.difficulty === 'advanced' ? 'selected' : ''}>Avancé</option>
            </select>
            
            <div class="filter-toggles">
                <label class="checkbox-label">
                    <input type="checkbox" id="show-downloaded" ${CoursesState.filters.showDownloaded ? 'checked' : ''}>
                    Téléchargés
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="show-available" ${CoursesState.filters.showAvailable ? 'checked' : ''}>
                    Disponibles
                </label>
            </div>
        </div>
    `;
}

function getUniqueCategories() {
    const categories = new Set();
    [...CoursesState.availableCourses, ...CoursesState.downloadedCourses].forEach(course => {
        if (course.category) categories.add(course.category);
    });
    return Array.from(categories).sort();
}

function createPaginationHTML(totalPages) {
    let html = '<div class="pagination">';
    
    // Bouton précédent
    html += `<button class="btn btn-sm" onclick="changePage(${CoursesState.currentPage - 1})" 
             ${CoursesState.currentPage === 1 ? 'disabled' : ''}>←</button>`;
    
    // Numéros de page
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= CoursesState.currentPage - 2 && i <= CoursesState.currentPage + 2)) {
            html += `<button class="btn btn-sm ${i === CoursesState.currentPage ? 'btn-primary' : ''}" 
                     onclick="changePage(${i})">${i}</button>`;
        } else if (i === CoursesState.currentPage - 3 || i === CoursesState.currentPage + 3) {
            html += '<span>...</span>';
        }
    }
    
    // Bouton suivant
    html += `<button class="btn btn-sm" onclick="changePage(${CoursesState.currentPage + 1})" 
             ${CoursesState.currentPage === totalPages ? 'disabled' : ''}>→</button>`;
    
    html += '</div>';
    return html;
}

function attachFilterEvents() {
    // Recherche
    const searchInput = document.getElementById('course-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            CoursesState.filters.search = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        }, 300));
    }
    
    // Catégorie
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
            CoursesState.filters.category = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    // Difficulté
    const difficultyFilter = document.getElementById('difficulty-filter');
    if (difficultyFilter) {
        difficultyFilter.addEventListener('change', (e) => {
            CoursesState.filters.difficulty = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    // Toggles
    const showDownloaded = document.getElementById('show-downloaded');
    if (showDownloaded) {
        showDownloaded.addEventListener('change', (e) => {
            CoursesState.filters.showDownloaded = e.target.checked;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    const showAvailable = document.getElementById('show-available');
    if (showAvailable) {
        showAvailable.addEventListener('change', (e) => {
            CoursesState.filters.showAvailable = e.target.checked;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
}

// ==================== CRÉATION DES CARTES DE COURS ====================

async function createCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card card';
    card.dataset.courseId = course.course_id || course.id;
    
    const isExpired = isCourseExpired(course);
    const isDownloaded = course.isDownloaded;
    const thumbnailUrl = (typeof course.thumbnail === 'string' ? course.thumbnail : null) || DEFAULT_COURSE_IMAGE;

    
    // Obtenir la progression
    let progressData = null;
    if (isDownloaded) {
        try {
            const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id || course.id);
            if (progressResponse.success && progressResponse.result) {
                progressData = progressResponse.result;
            }
        } catch (error) {
            console.error('Erreur lors de la récupération de la progression:', error);
        }
    }
    
    const progressPercentage = progressData ? Math.round(progressData.completion_percentage || 0) : 0;
    
    card.innerHTML = `
        <div class="course-thumbnail-wrapper">
            <img src="${thumbnailUrl}" 
                 alt="${escapeHtml(course.title)}" 
                 class="course-thumbnail"
                 onerror="this.src='${DEFAULT_COURSE_IMAGE}'">
            ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
            ${isDownloaded ? '<div class="course-downloaded-badge" title="Cours téléchargé">💾</div>' : ''}
        </div>
        <div class="course-info">
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-instructor">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
            <div class="course-stats">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${progressPercentage > 0 ? `<span class="course-progress-text">✓ ${progressPercentage}%</span>` : ''}
            </div>
            ${course.rating ? `
                <div class="course-rating">
                    ${createRatingStars(course.rating)}
                    <span class="rating-count">(${course.review_count || 0})</span>
                </div>
            ` : ''}
        </div>
        ${progressPercentage > 0 ? `
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${progressPercentage}%"></div>
        </div>
        ` : ''}
        <div class="course-actions">
            ${createCourseActions(course, isDownloaded)}
        </div>
    `;
    
    // NE PAS ajouter d'événement click sur la carte entière
    // Les actions seront gérées par les boutons individuels
    
    // Attacher les événements aux boutons
    setTimeout(() => {
        const downloadBtn = card.querySelector('.download-course-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[Courses] Bouton télécharger cliqué pour le cours:', course.id);
                downloadSingleCourse(course.id);
            });
        }
        
        const playBtn = card.querySelector('.play-course-btn');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[Courses] Bouton play cliqué pour le cours:', course.course_id || course.id);
                openCourse(course.course_id || course.id);
            });
        }
    }, 0);
    
    return card;
}

function createCourseActions(course, isDownloaded) {
    const courseId = course.course_id || course.id;
    
    if (isDownloaded) {
        // Actions pour cours téléchargé
        return `
            <button class="btn btn-primary play-course-btn" data-course-id="${courseId}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px;">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Ouvrir
            </button>
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); deleteCourse(${courseId})" title="Supprimer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `;
    } else {
        // Actions pour cours non téléchargé
        return `
            <button class="btn btn-primary download-course-btn" data-course-id="${courseId}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px;">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                Télécharger
            </button>
        `;
    }
}

function createRatingStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    let stars = '';
    for (let i = 0; i < fullStars; i++) {
        stars += '⭐';
    }
    if (hasHalfStar) {
        stars += '✨';
    }
    for (let i = 0; i < emptyStars; i++) {
        stars += '☆';
    }
    
    return `<span class="rating-stars">${stars}</span>`;
}

// ==================== MODAL DE TÉLÉCHARGEMENT ====================

async function showDownloadModal() {
    showLoader('Chargement des cours disponibles...');
    
    const modal = document.getElementById('download-modal');
    modal.classList.remove('hidden');
    
    // Charger la liste des cours disponibles
    await loadAvailableCourses();
    
    hideLoader();
}

function hideDownloadModal() {
    const modal = document.getElementById('download-modal');
    modal.classList.add('hidden');
    
    // Réinitialiser le formulaire
    document.getElementById('course-select').value = '';
    document.getElementById('download-info').classList.add('hidden');
}

async function loadAvailableCourses() {
    const select = document.getElementById('course-select');
    select.innerHTML = '<option value="">Chargement des cours...</option>';
    
    try {
        // Utiliser les cours déjà chargés ou les recharger
        if (CoursesState.availableCourses.length === 0) {
            await loadOnlineCourses();
        }
        
        // Récupérer les IDs des cours déjà téléchargés
        const downloadedIds = new Set(CoursesState.downloadedCourses.map(c => c.course_id));
        
        // Filtrer les cours non téléchargés
        const availableForDownload = CoursesState.availableCourses.filter(
            course => !downloadedIds.has(course.id || course.course_id)
        );
        
        if (availableForDownload.length === 0) {
            select.innerHTML = '<option value="">Tous les cours sont déjà téléchargés</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Sélectionner un cours...</option>';
        
        // Grouper par catégorie
        const coursesByCategory = {};
        availableForDownload.forEach(course => {
            const category = course.category || 'Autres';
            if (!coursesByCategory[category]) {
                coursesByCategory[category] = [];
            }
            coursesByCategory[category].push(course);
        });
        
        // Créer les options groupées
        Object.entries(coursesByCategory).forEach(([category, courses]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category;
            
            courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.id;
                option.textContent = `${course.title} - ${course.lessons_count || 0} leçons`;
                if (course.instructor_name) {
                    option.textContent += ` (${course.instructor_name})`;
                }
                optgroup.appendChild(option);
            });
            
            select.appendChild(optgroup);
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        select.innerHTML = '<option value="">Erreur de connexion</option>';
        showError('Impossible de charger la liste des cours');
    }
}

function onCourseSelected(e) {
    const courseId = parseInt(e.target.value);
    updateDownloadEstimate();
}

async function updateDownloadEstimate() {
    const courseId = parseInt(document.getElementById('course-select').value);
    const infoDiv = document.getElementById('download-info');
    
    if (!courseId) {
        infoDiv.classList.add('hidden');
        return;
    }
    
    const course = CoursesState.availableCourses.find(c => c.id === courseId);
    if (!course) return;
    
    // Options sélectionnées
    const includeVideos = document.getElementById('include-videos').checked;
    const includeDocuments = document.getElementById('include-documents').checked;
    const compressMedia = document.getElementById('compress-media').checked;
    
    // Calculer la taille estimée
    let estimatedSize = 0;
    let contentTypes = [];
    
    if (includeVideos) {
        const videoSize = course.download_info?.estimated_size || course.video_size || 500 * 1024 * 1024;
        estimatedSize += videoSize;
        contentTypes.push(`Vidéos (${course.download_info?.video_count || 0})`);
    }
    
    if (includeDocuments) {
        const docSize = course.document_size || 50 * 1024 * 1024;
        estimatedSize += docSize;
        contentTypes.push(`Documents (${course.download_info?.document_count || 0})`);
    }
    
    if (compressMedia && includeVideos) {
        estimatedSize *= 0.7; // 30% de compression
    }
    
    infoDiv.innerHTML = `
        <div class="course-preview">
            <h4>${escapeHtml(course.title)}</h4>
            <div class="course-meta">
                <span>👤 ${escapeHtml(course.instructor_name || 'Instructeur')}</span>
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${course.rating ? `<span>⭐ ${course.rating}/5</span>` : ''}
            </div>
            ${course.description ? `
                <p class="course-description">${escapeHtml(course.description).substring(0, 200)}...</p>
            ` : ''}
            <div class="download-details">
                <p><strong>Contenu à télécharger :</strong> ${contentTypes.join(', ') || 'Aucun'}</p>
                <p><strong>Taille estimée :</strong> ${formatFileSize(estimatedSize)}</p>
                <p><strong>Espace disponible :</strong> <span id="available-space">Calcul...</span></p>
                ${compressMedia ? '<p class="info-note">📦 Compression activée - La taille finale peut être réduite</p>' : ''}
            </div>
            ${course.expires_at ? `
                <p class="warning-note">⚠️ Ce cours expire le ${formatDate(course.expires_at, 'long')}</p>
            ` : ''}
        </div>
    `;
    
    infoDiv.classList.remove('hidden');
    
    // Vérifier l'espace disponible
    checkAvailableSpace();
}

async function checkAvailableSpace() {
    try {
        const systemInfo = await window.electronAPI.system.getSystemInfo();
        if (systemInfo.success) {
            const spaceElement = document.getElementById('available-space');
            if (spaceElement) {
                spaceElement.textContent = formatFileSize(systemInfo.info.freeMemory);
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'espace:', error);
    }
}

// ==================== TÉLÉCHARGEMENT ====================

async function startDownload() {
    console.log('[Courses] startDownload appelé depuis le modal');
    
    const courseId = document.getElementById('course-select').value;
    if (!courseId) {
        showWarning('Veuillez sélectionner un cours');
        return;
    }
    
    // Récupérer les options
    const options = {
        includeVideos: document.getElementById('include-videos').checked,
        includeDocuments: document.getElementById('include-documents').checked,
        compressMedia: document.getElementById('compress-media').checked,
        videoQuality: 'high',
        encryptionEnabled: true
    };
    
    // Fermer le modal
    hideDownloadModal();
    
    // Démarrer le téléchargement
    await downloadSingleCourse(parseInt(courseId), options);
}

async function downloadSingleCourse(courseId, customOptions = null) {
    console.log('[Courses] downloadSingleCourse appelé avec courseId:', courseId);
    
    // S'assurer que courseId est un nombre
    courseId = parseInt(courseId);
    
    const course = CoursesState.availableCourses.find(c => c.id === courseId || c.course_id === courseId);
    if (!course) {
        console.error('[Courses] Cours non trouvé:', courseId);
        showError('Cours introuvable');
        return;
    }
    
    console.log('[Courses] Cours trouvé:', course.title);
    
    // Afficher une confirmation
    const confirmed = confirm(`Voulez-vous télécharger le cours "${course.title}" ?`);
    if (!confirmed) {
        console.log('[Courses] Téléchargement annulé par l\'utilisateur');
        return;
    }
    
    // Options par défaut pour téléchargement rapide
    const options = customOptions || {
        includeVideos: true,
        includeDocuments: true,
        compressMedia: false,
        videoQuality: 'high',
        encryptionEnabled: true
    };
    
    try {
        console.log('[Courses] Appel de window.electronAPI.download.downloadCourse...');
        
        // Vérifier que l'API est disponible
        if (!window.electronAPI || !window.electronAPI.download || !window.electronAPI.download.downloadCourse) {
            throw new Error('API de téléchargement non disponible');
        }
        
        const result = await window.electronAPI.download.downloadCourse(courseId, options);
        
        console.log('[Courses] Résultat du téléchargement:', result);
        
        if (result.success) {
            const download = {
                id: result.downloadId,
                course: course,
                options: options,
                status: 'pending',
                progress: 0,
                startTime: Date.now()
            };
            
            CoursesState.activeDownloads.set(result.downloadId, download);
            updateDownloadDisplay();
            
            showSuccess(`Téléchargement de "${course.title}" démarré`);
            
            // Naviguer vers la page des téléchargements
            const downloadsNavItem = document.querySelector('[data-page="downloads"]');
            if (downloadsNavItem) {
                downloadsNavItem.click();
            }
        } else {
            throw new Error(result.error || 'Erreur lors du démarrage du téléchargement');
        }
    } catch (error) {
        console.error('[Courses] Erreur lors du téléchargement rapide:', error);
        showError(`Erreur: ${error.message}`);
    }
}

// ==================== GESTION DES ÉVÉNEMENTS DE TÉLÉCHARGEMENT ====================

function handleDownloadProgress(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        download.status = data.status;
        download.progress = data.progress || 0;
        download.currentFile = data.currentFile;
        download.error = data.error;
        
        updateDownloadDisplay();
        
        // Si terminé ou erreur, nettoyer après un délai
        if (data.status === 'completed' || data.status === 'error') {
            setTimeout(() => {
                CoursesState.activeDownloads.delete(data.downloadId);
                updateDownloadDisplay();
            }, 5000);
        }
    }
}

function handleDownloadCompleted(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        showSuccess(`"${download.course.title}" téléchargé avec succès !`);
        
        // Recharger la liste des cours
        loadCourses();
    }
}

function handleDownloadError(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        showError(`Erreur lors du téléchargement de "${download.course.title}": ${data.error}`);
    }
}

function handleCourseDownloaded(data) {
    // Mettre à jour la liste des cours téléchargés
    loadLocalCourses().then(() => {
        loadCourses();
    });
}

// ==================== AFFICHAGE DES TÉLÉCHARGEMENTS ====================

function updateDownloadDisplay() {
    const container = document.getElementById('downloads-container') || document.getElementById('downloads-list');
    if (!container) return;
    
    if (CoursesState.activeDownloads.size === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                <p>Aucun téléchargement en cours</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '<div class="downloads-list">';
    const listContainer = container.querySelector('.downloads-list');
    
    CoursesState.activeDownloads.forEach(download => {
        const downloadEl = createDownloadElement(download);
        listContainer.appendChild(downloadEl);
    });
}

function createDownloadElement(download) {
    const el = document.createElement('div');
    el.className = 'download-item';
    el.dataset.downloadId = download.id;
    
    const statusIcon = {
        pending: '⏳',
        preparing: '🔄',
        creating_package: '📦',
        downloading: '⬇️',
        completed: '✅',
        error: '❌',
        cancelled: '🚫'
    }[download.status] || '⏳';
    
    const statusText = {
        pending: 'En attente',
        preparing: 'Préparation',
        creating_package: 'Création du package',
        downloading: 'Téléchargement',
        completed: 'Terminé',
        error: 'Erreur',
        cancelled: 'Annulé'
    }[download.status] || download.status;
    
    // Calculer la vitesse et le temps restant
    let speedInfo = '';
    if (download.status === 'downloading' && download.startTime && download.progress > 0) {
        const elapsed = (Date.now() - download.startTime) / 1000; // en secondes
        const speed = download.progress / elapsed; // %/s
        const remaining = speed > 0 ? ((100 - download.progress) / speed) : 0;
        
        speedInfo = `
            <span class="download-speed">${speed.toFixed(1)}%/s</span>
            <span class="download-eta">${formatDuration(remaining)} restant</span>
        `;
    }
    
    el.innerHTML = `
        <div class="download-header">
            <span class="download-icon">${statusIcon}</span>
            <div class="download-info">
                <h4>${escapeHtml(download.course.title)}</h4>
                <p class="download-status">
                    ${statusText} 
                    ${download.currentFile ? `- ${escapeHtml(download.currentFile)}` : ''}
                    ${speedInfo}
                </p>
                ${download.error ? `<p class="download-error">${escapeHtml(download.error)}</p>` : ''}
            </div>
            <div class="download-actions">
                ${download.status === 'downloading' || download.status === 'pending' ? `
                    <button class="btn btn-icon" onclick="cancelDownload('${download.id}')" title="Annuler">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                ` : ''}
                ${download.status === 'error' ? `
                    <button class="btn btn-sm btn-primary" onclick="retryDownload('${download.id}')">
                        Réessayer
                    </button>
                ` : ''}
            </div>
        </div>
        ${download.status === 'downloading' || download.status === 'creating_package' ? `
            <div class="download-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${download.progress}%"></div>
                </div>
                <span class="progress-text">${Math.round(download.progress)}%</span>
            </div>
        ` : ''}
    `;
    
    return el;
}


window.createCourseCard = function(course) {
    // Utiliser la version de course-functions.js qui retourne une string
    const courseId = course.course_id || course.id;
    const progress = course.progress || course.completion_percentage || 0;
    const isExpired = isCourseExpired(course);
    const isDownloaded = course.isDownloaded || course.is_downloaded;
    const isOnline = window.ConnectionState ? window.ConnectionState.isOnline : navigator.onLine;
    
    let thumbnailUrl = DEFAULT_COURSE_IMAGE;
    if (course.thumbnail && typeof course.thumbnail === 'string') {
        thumbnailUrl = course.thumbnail;
    }
    
    return `
        <div class="course-card card ${!isOnline && !isDownloaded ? 'disabled' : ''}" 
            data-course-id="${courseId}"
            data-is-downloaded="${isDownloaded}">
            <div class="course-thumbnail-wrapper">
                <img src="${thumbnailUrl}" 
                    alt="${escapeHtml(course.title)}" 
                    class="course-thumbnail"
                    loading="lazy"
                    onerror="this.src='${DEFAULT_COURSE_IMAGE}'">
                ${progress > 0 ? `
                <div class="course-progress-overlay">
                    <div class="progress-circle">
                        <span>${Math.round(progress)}%</span>
                    </div>
                </div>
                ` : ''}
                ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
                ${isDownloaded ? '<div class="course-downloaded-badge" title="Cours téléchargé">💾</div>' : ''}
            </div>
            <div class="card-body">
                <h3 class="course-title">${escapeHtml(course.title)}</h3>
                <p class="course-instructor">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
                <div class="course-meta">
                    <span>📚 ${course.lessons_count || 0} leçons</span>
                    ${course.duration ? `<span>• ⏱️ ${course.duration}</span>` : ''}
                </div>
                <div class="course-actions">
                    ${isDownloaded ? `
                        <button class="btn btn-primary btn-sm play-course-btn" 
                                data-course-id="${courseId}"
                                onclick="event.stopPropagation(); window.openCoursePlayer('${courseId}')">
                            ${progress > 0 ? 'Continuer' : 'Commencer'}
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-sm download-course-btn" 
                                data-course-id="${courseId}"
                                onclick="event.stopPropagation(); window.downloadSingleCourse('${courseId}')">
                            Télécharger
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
};

// Fonction attachCourseEventListeners également utilisée par app.js
window.attachCourseEventListeners = function() {
    // Version simple qui fonctionne avec le HTML généré ci-dessus
    console.log('[Courses] Attaching event listeners for course cards');
};

// ==================== ACTIONS SUR LES TÉLÉCHARGEMENTS ====================

window.cancelDownload = async function(downloadId) {
    const download = CoursesState.activeDownloads.get(downloadId);
    if (download && (download.status === 'downloading' || download.status === 'pending')) {
        if (confirm(`Êtes-vous sûr de vouloir annuler le téléchargement de "${download.course.title}" ?`)) {
            try {
                const result = await window.electronAPI.download.cancelDownload(downloadId);
                if (result.success) {
                    download.status = 'cancelled';
                    updateDownloadDisplay();
                    
                    setTimeout(() => {
                        CoursesState.activeDownloads.delete(downloadId);
                        updateDownloadDisplay();
                    }, 2000);
                    
                    showInfo('Téléchargement annulé');
                }
            } catch (error) {
                console.error('Erreur lors de l\'annulation:', error);
                showError('Impossible d\'annuler le téléchargement');
            }
        }
    }
};

window.retryDownload = async function(downloadId) {
    const download = CoursesState.activeDownloads.get(downloadId);
    if (download && download.status === 'error') {
        try {
            // Réinitialiser le téléchargement
            download.status = 'pending';
            download.error = null;
            download.progress = 0;
            download.startTime = Date.now();
            
            const result = await window.electronAPI.download.downloadCourse(
                download.course.id,
                download.options
            );
            
            if (result.success) {
                // Mettre à jour l'ID si nécessaire
                if (result.downloadId !== downloadId) {
                    CoursesState.activeDownloads.delete(downloadId);
                    download.id = result.downloadId;
                    CoursesState.activeDownloads.set(result.downloadId, download);
                }
                
                updateDownloadDisplay();
                showInfo('Téléchargement relancé');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            download.status = 'error';
            download.error = error.message;
            updateDownloadDisplay();
            showError(`Impossible de relancer: ${error.message}`);
        }
    }
};

// ==================== CHARGEMENT DES TÉLÉCHARGEMENTS ACTIFS ====================

async function loadActiveDownloads() {
    try {
        const result = await window.electronAPI.download.getAllDownloads();
        if (result.success && result.downloads) {
            result.downloads.forEach(dl => {
                if (dl.status === 'downloading' || dl.status === 'pending' || dl.status === 'preparing') {
                    CoursesState.activeDownloads.set(dl.id, dl);
                }
            });
            updateDownloadDisplay();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des téléchargements:', error);
    }
}

// ==================== ACTIONS SUR LES COURS ====================

async function openCourse(courseId) {
    try {
        console.log('[Courses] Ouverture du cours:', courseId);
        
        // Mettre à jour l'accès au cours
        await window.electronAPI.db.updateCourseAccess(courseId);
        
        // Vérifier si le playerManager existe
        if (!window.playerManager) {
            console.error('[Courses] PlayerManager non disponible');
            
            // Créer le player UI si nécessaire
            if (!document.getElementById('player-page')) {
                console.log('[Courses] Création de l\'interface du player...');
                
                // Créer un playerManager temporaire minimal
                window.playerManager = {
                    createPlayerUI: function() {
                        // Réutiliser la fonction du vrai playerManager si possible
                        const script = document.querySelector('script[src*="player.js"]');
                        if (script) {
                            console.log('[Courses] Rechargement du module player...');
                            // Forcer le rechargement du module
                            const newScript = document.createElement('script');
                            newScript.src = script.src + '?t=' + Date.now();
                            document.head.appendChild(newScript);
                            
                            // Attendre que le module soit chargé
                            return new Promise(resolve => {
                                newScript.onload = () => {
                                    setTimeout(resolve, 100);
                                };
                            });
                        }
                    },
                    
                    showPlayerPage: function() {
                        const dashboardPage = document.getElementById('dashboard-page');
                        const playerPage = document.getElementById('player-page');
                        
                        if (dashboardPage) dashboardPage.classList.add('hidden');
                        if (playerPage) playerPage.classList.remove('hidden');
                    }
                };
                
                // Créer l'UI
                await window.playerManager.createPlayerUI();
            }
        }
        
        // S'assurer que playerManager est maintenant disponible
        if (window.playerManager && window.playerManager.loadCourse) {
            // Charger le cours
            const success = await window.playerManager.loadCourse(courseId);
            
            if (!success) {
                throw new Error('Échec du chargement du cours');
            }
        } else {
            // Fallback : afficher directement le player
            console.warn('[Courses] PlayerManager incomplet, affichage direct');
            
            // Afficher la page du player
            const dashboardPage = document.getElementById('dashboard-page');
            const playerPage = document.getElementById('player-page');
            
            if (dashboardPage) dashboardPage.classList.add('hidden');
            if (playerPage) {
                playerPage.classList.remove('hidden');
                
                // Essayer de charger le cours manuellement
                const courseResponse = await window.electronAPI.db.getCourse(courseId);
                if (courseResponse.success && courseResponse.result) {
                    // Afficher au moins le titre
                    const titleElement = document.getElementById('player-course-name');
                    if (titleElement) {
                        titleElement.textContent = courseResponse.result.title;
                    }
                    
                    showInfo('Cours chargé. Certaines fonctionnalités peuvent être limitées.');
                }
            }
        }
        
    } catch (error) {
        console.error('[Courses] Erreur lors de l\'ouverture du cours:', error);
        showError('Impossible d\'ouvrir le cours: ' + error.message);
    }
}

async function deleteCourse(courseId) {
    const course = CoursesState.downloadedCourses.find(c => c.course_id === courseId);
    const title = course ? course.title : 'ce cours';
    
    if (confirm(`Êtes-vous sûr de vouloir supprimer "${title}" ?\n\nCette action est irréversible.`)) {
        try {
            showLoader('Suppression en cours...');
            
            const result = await window.electronAPI.db.deleteCourse(courseId);
            
            if (result.success) {
                // Retirer de la liste locale
                CoursesState.downloadedCourses = CoursesState.downloadedCourses.filter(
                    c => c.course_id !== courseId
                );
                
                // Recharger l'affichage
                await loadCourses();
                
                showSuccess('Cours supprimé avec succès');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            showError(`Erreur lors de la suppression: ${error.message}`);
        } finally {
            hideLoader();
        }
    }
}

async function updateCourse(courseId) {
    showInfo('La mise à jour des cours sera disponible dans une prochaine version');
    // TODO: Implémenter la mise à jour des cours
}

// Ajouter une fonction pour montrer les détails d'un cours avant téléchargement
function showCourseDetails(course) {
    console.log('[Courses] Affichage des détails du cours:', course);
    
    // Créer un modal pour afficher les détails
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h2>${escapeHtml(course.title)}</h2>
                <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
            </div>
            <div class="modal-body">
                <div class="course-details">
                    <img src="${course.thumbnail || DEFAULT_COURSE_IMAGE}" 
                         alt="${escapeHtml(course.title)}" 
                         style="width: 100%; max-height: 300px; object-fit: cover; border-radius: 8px; margin-bottom: 16px;">
                    
                    <div class="course-meta" style="display: flex; gap: 16px; margin-bottom: 16px;">
                        <span>👤 ${escapeHtml(course.instructor_name || 'Instructeur')}</span>
                        <span>📚 ${course.lessons_count || 0} leçons</span>
                        <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                        ${course.rating ? `<span>⭐ ${course.rating}/5</span>` : ''}
                    </div>
                    
                    ${course.description ? `
                        <div class="course-description" style="margin-bottom: 16px;">
                            <h3>Description</h3>
                            <div style="max-height: 200px; overflow-y: auto;">
                                ${course.description}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${course.expires_at ? `
                        <p class="warning-note">⚠️ Ce cours expire le ${formatDate(course.expires_at, 'long')}</p>
                    ` : ''}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">
                    Fermer
                </button>
                <button class="btn btn-primary" onclick="this.closest('.modal-backdrop').remove(); downloadSingleCourse(${course.id})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px;">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    Télécharger
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Afficher le lecteur vidéo
function showPlayer() {
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (dashboardPage) dashboardPage.classList.add('hidden');
    if (playerPage) playerPage.classList.remove('hidden');
}

// ==================== UTILITAIRES ====================

function updateDashboardStats(courses) {
    try {
        // Nombre de cours
        const statCourses = document.getElementById('stat-courses');
        if (statCourses) {
            statCourses.textContent = courses.filter(c => c.isDownloaded).length;
        }
        
        // Cours terminés
        const completedCourses = courses.filter(c => c.completed || c.progress >= 100).length;
        const statCompleted = document.getElementById('stat-completed');
        if (statCompleted) {
            statCompleted.textContent = completedCourses;
        }
        
        // Progression moyenne
        const coursesWithProgress = courses.filter(c => c.isDownloaded);
        let avgProgress = 0;
        if (coursesWithProgress.length > 0) {
            const totalProgress = coursesWithProgress.reduce((sum, course) => sum + (course.progress || 0), 0);
            avgProgress = Math.round(totalProgress / coursesWithProgress.length);
        }
        
        const statProgress = document.getElementById('stat-progress');
        if (statProgress) {
            statProgress.textContent = `${avgProgress}%`;
        }
        
        // Mettre à jour le compteur dans le menu
        const coursesCount = document.getElementById('courses-count');
        if (coursesCount) {
            coursesCount.textContent = courses.filter(c => c.isDownloaded).length;
        }
        
    } catch (error) {
        console.error('[Courses] Erreur lors de la mise à jour des stats:', error);
    }
}

function changePage(page) {
    CoursesState.currentPage = page;
    loadCourses();
    
    // Scroll vers le haut
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== EXPORTS GLOBAUX ====================

// Créer l'objet coursesManager avec toutes les fonctions
window.coursesManager = {
    loadCourses,
    showDownloadModal,
    openCourse,
    deleteCourse,
    updateCourse,
    loadActiveDownloads,
    displayCourses, // Ajouter cette fonction
    CoursesState // Exposer l'état pour debug
};

// Assigner les fonctions globales pour les onclick
window.showDownloadModal = showDownloadModal;
window.cancelDownload = cancelDownload;
window.retryDownload = retryDownload;
window.changePage = changePage;
window.downloadSingleCourse = downloadSingleCourse;
window.deleteCourse = deleteCourse;
window.updateCourse = updateCourse;
window.openCourse = openCourse;
window.openCoursePlayer = openCourse;
window.loadCourses = loadCourses;
window.displayCourses = displayCourses; // Ajouter cette ligne

// Fonction pour initialiser les cours au chargement
window.initializeCourses = function() {
    // Éviter les appels multiples
    if (window.coursesModuleInitialized) {
        console.log('[Courses] Module déjà initialisé');
        return;
    }
    window.coursesModuleInitialized = true;
    
    console.log('[Courses] Initialisation du module courses');
    
    // S'assurer que les fonctions sont disponibles
    window.loadCoursesPage = loadCoursesPage;
    if (false) {
        window._loadCoursesPageFallback = async function() {
            console.log('[Courses] loadCoursesPage fallback (désactivé)');
            const container = document.getElementById('courses-list');
            if (!container) {
                console.error('[Courses] Container courses-list non trouvé');
                return;
            }
            
            try {
                // Utiliser directement les données en mémoire si disponibles
                let allCourses = [];
                
                if (CoursesState.availableCourses.length > 0 || CoursesState.downloadedCourses.length > 0) {
                    allCourses = mergeCourseData(CoursesState.downloadedCourses, CoursesState.availableCourses);
                    await displayCourses(allCourses, container);
                } else {
                    // Sinon charger depuis les sources
                    await loadCourses();
                }
            } catch (error) {
                console.error('[Courses] Erreur:', error);
                container.innerHTML = `
                    <div class="message message-error">
                        <p>Erreur lors du chargement des cours</p>
                        <button class="btn btn-sm" onclick="window.loadCoursesPage();">Réessayer</button>
                    </div>
                `;
            }
        };
    }
    
    // Initialiser les gestionnaires d'événements de base
    initializeCourses(); // Appelle la fonction locale
    
    // Charger les téléchargements actifs
    loadActiveDownloads();
};

// Auto-initialiser quand le DOM est prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.initializeCourses();
    });
} else {
    // DOM déjà chargé
    setTimeout(() => {
        window.initializeCourses();
    }, 100);
}

// Auto-initialiser quand le DOM est prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initializeCourses);
} else {
    // DOM déjà chargé
    setTimeout(window.initializeCourses, 100);
}

// ==================== STYLES CSS ====================

const coursesStyles = `
<style>
/* Filtres */
.courses-filters {
    margin-bottom: 24px;
    padding: 16px;
    background: var(--bg-primary);
    border-radius: 8px;
    box-shadow: var(--shadow);
}

.filters-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
}

.filters-row .form-control {
    flex: 1;
    min-width: 200px;
}

.filter-toggles {
    display: flex;
    gap: 16px;
}

/* Grille de cours */
.courses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
}

/* Carte de cours améliorée */
.course-card {
    position: relative;
    cursor: pointer;
    transition: all 0.3s;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.course-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-xl);
}

.course-thumbnail-wrapper {
    position: relative;
    height: 180px;
    overflow: hidden;
    border-radius: 8px 8px 0 0;
}

.course-thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.course-card:hover .course-thumbnail {
    transform: scale(1.05);
}

.course-expired-badge,
.course-downloaded-badge {
    position: absolute;
    top: 10px;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    z-index: 1;
}

.course-expired-badge {
    right: 10px;
    background: var(--danger-color);
    color: white;
}

.course-downloaded-badge {
    left: 10px;
    background: var(--success-color);
    color: white;
}

/* MODIFICATION: Actions de cours mises à jour */
.course-actions {
    /* Suppression du positionnement absolu pour les rendre toujours visibles */
    display: flex;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-secondary);
    opacity: 1; /* Toujours visible */
    transition: opacity 0.2s;
}

.course-actions .btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}

.download-course-btn,
.play-course-btn {
    font-weight: 500;
}

/* Fix pour les boutons dans les cartes */
.course-card button {
    position: relative;
    z-index: 2;
}

.course-info {
    padding: 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
}

.course-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
}

.course-instructor {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
}

.course-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
    flex-wrap: wrap;
    margin-bottom: 8px;
}

.course-progress-text {
    color: var(--success-color) !important;
    font-weight: 500;
}

.course-rating {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin-top: auto;
}

.rating-stars {
    letter-spacing: 2px;
}

.rating-count {
    color: var(--text-secondary);
}

.course-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--bg-secondary);
}

.course-progress-bar {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
}

/* Modal de détails */
.modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal-content {
    background: var(--bg-primary);
    border-radius: 12px;
    box-shadow: var(--shadow-xl);
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
    margin: 0;
    font-size: 20px;
}

.modal-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
}

.modal-close:hover {
    background: var(--bg-hover);
}

.modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
}

.modal-footer {
    padding: 20px;
    border-top: 1px solid var(--border-color);
    display: flex;
    gap: 12px;
    justify-content: flex-end;
}

/* Modal de téléchargement */
.course-preview {
    background: var(--bg-secondary);
    padding: 20px;
    border-radius: 8px;
    margin: 16px 0;
}

.course-preview h4 {
    margin: 0 0 12px;
    color: var(--primary-color);
    font-size: 18px;
}

.course-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.course-description {
    margin: 12px 0;
    line-height: 1.6;
}

.download-details {
    margin: 16px 0;
}

.download-details p {
    margin: 8px 0;
}

.info-note {
    color: var(--info-color);
    font-size: 13px;
    margin-top: 8px;
}

.warning-note {
    color: var(--warning-color);
    font-size: 13px;
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(255, 193, 7, 0.1);
    border-radius: 4px;
}

/* Téléchargements */
.downloads-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.download-item {
    background: var(--bg-primary);
    border-radius: 8px;
    padding: 20px;
    box-shadow: var(--shadow);
    transition: transform 0.2s;
}

.download-item:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-lg);
}

.download-header {
    display: flex;
    align-items: start;
    gap: 16px;
}

.download-icon {
    font-size: 24px;
    line-height: 1;
}

.download-info {
    flex: 1;
}

.download-info h4 {
    margin: 0 0 4px;
    font-size: 16px;
}

.download-status {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
}

.download-speed,
.download-eta {
    font-size: 12px;
    margin-left: 8px;
}

.download-error {
    font-size: 14px;
    color: var(--danger-color);
    margin: 4px 0 0;
}

.download-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.download-progress {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
}

.progress-bar {
    flex: 1;
    height: 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
    position: relative;
}

.progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.3),
        transparent
    );
    animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.progress-text {
    font-size: 13px;
    font-weight: 500;
    min-width: 40px;
    text-align: right;
}

/* Options de téléchargement */
.download-options {
    margin: 20px 0;
}

.download-options .checkbox-label {
    margin-bottom: 12px;
    display: flex;
    align-items: center;
}

/* Pagination */
.pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
}

.pagination button {
    min-width: 36px;
    height: 36px;
}

.pagination span {
    color: var(--text-secondary);
    font-size: 14px;
}

/* Empty state */
.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-secondary);
}

.empty-state svg {
    margin-bottom: 20px;
    opacity: 0.3;
}

.empty-state h3 {
    margin: 0 0 12px;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
}

.empty-state p {
    margin: 0 0 20px;
    font-size: 16px;
}

/* Loading state */
.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
}

.loading .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--bg-secondary);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 20px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Responsive */
@media (max-width: 768px) {
    .courses-grid {
        grid-template-columns: 1fr;
    }
    
    .filters-row {
        flex-direction: column;
    }
    
    .filters-row .form-control {
        width: 100%;
    }
    
    .filter-toggles {
        width: 100%;
        justify-content: space-between;
    }
    
    .course-actions {
        opacity: 1;
    }
    
    .download-header {
        flex-direction: column;
    }
    
    .download-actions {
        width: 100%;
        justify-content: flex-end;
        margin-top: 12px;
    }
}

/* Dark mode specific */
@media (prefers-color-scheme: dark) {
    .course-card {
        background: var(--bg-card);
        border-color: var(--border-color);
    }
    
    .course-thumbnail-wrapper {
        background: #1a1a1a;
    }
    
    .empty-state svg {
        fill: var(--text-secondary);
    }
}
</style>
`;

// Injecter les styles
document.head.insertAdjacentHTML('beforeend', coursesStyles);

console.log('[Courses] Module chargé avec succès');