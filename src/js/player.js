// player.js - Lecteur vidéo moderne avec toutes les fonctionnalités

console.log('[Player] Module en cours de chargement...');

// ==================== ÉTAT DU PLAYER ====================
const PlayerState = {
    // Cours et contenu
    currentCourse: null,
    currentSection: null,
    currentLesson: null,
    sections: [],
    lessons: new Map(),
    
    // État de lecture
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: parseFloat(localStorage.getItem('player_volume') || '1'),
    playbackRate: parseFloat(localStorage.getItem('player_rate') || '1'),
    isMuted: false,
    isFullscreen: false,
    isPiP: false,
    isTheaterMode: false,
    
    // Paramètres
    autoplay: localStorage.getItem('player_autoplay') !== 'false',
    quality: localStorage.getItem('player_quality') || 'auto',
    subtitlesEnabled: localStorage.getItem('player_subtitles') === 'true',
    currentSubtitle: null,
    
    // Contrôles
    controlsVisible: true,
    controlsTimeout: null,
    seekPreview: false,
    seekTime: 0,
    
    // Progression
    watchedSegments: [],
    completionThreshold: 0.9,
    
    // Notes et signets
    notes: [],
    bookmarks: [],
    
    // Analytics
    sessionStartTime: null,
    totalWatchTime: 0,
    
    // UI Elements
    videoElement: null,
    container: null
};

// Exposer l'état globalement
window.PlayerState = PlayerState;

// Ajouter cette fonction dans player.js
async function loadMediaWithLocalFirst(lessonId) {
    console.log('[Player] Recherche du média local pour la leçon:', lessonId);
    
    try {
        // Vérifier d'abord si on a des médias locaux
        const localMedia = await window.electronAPI.db.getLessonMedia(lessonId);
        
        if (localMedia && localMedia.length > 0) {
            console.log('[Player] Médias locaux trouvés:', localMedia.length);
            
            // Trouver le média principal (vidéo ou audio)
            const mainMedia = localMedia.find(m => ['video', 'audio'].includes(m.type));
            
            if (mainMedia && mainMedia.path) {
                console.log('[Player] Utilisation du média local:', mainMedia.path);
                
                // Vérifier que le fichier existe
                const fileExists = await window.electronAPI.checkFileExists(mainMedia.path);
                
                if (fileExists) {
                    return {
                        success: true,
                        url: `file://${mainMedia.path}`,
                        type: mainMedia.type,
                        isLocal: true,
                        metadata: mainMedia
                    };
                } else {
                    console.warn('[Player] Fichier local introuvable:', mainMedia.path);
                }
            }
        }
        
        // Si pas de média local, essayer en ligne
        console.log('[Player] Pas de média local, tentative en ligne...');
        
        if (!navigator.onLine) {
            throw new Error('Aucun média local et pas de connexion Internet');
        }
        
        // Charger depuis l'API
        const onlineResult = await window.electronAPI.api.getLessonMedia(lessonId);
        
        if (onlineResult.success && onlineResult.media) {
            return {
                success: true,
                url: onlineResult.media.url,
                type: onlineResult.media.type,
                isLocal: false,
                metadata: onlineResult.media
            };
        }
        
        throw new Error('Aucun média trouvé pour cette leçon');
        
    } catch (error) {
        console.error('[Player] Erreur chargement média:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Modifier loadLessonContent pour utiliser loadMediaWithLocalFirst
async function loadLessonContent(lesson) {
    console.log('[Player] Chargement du contenu de la leçon:', lesson.title);
    
    try {
        const contentEl = document.getElementById('lesson-content');
        if (!contentEl) return;
        
        // Afficher le loader
        contentEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement...</p></div>';
        
        // Charger le média (local en priorité)
        const mediaResult = await loadMediaWithLocalFirst(lesson.lesson_id);
        
        if (mediaResult.success && mediaResult.url) {
            if (mediaResult.type === 'video') {
                contentEl.innerHTML = createVideoPlayer(mediaResult.url, mediaResult.isLocal);
                initializeVideoPlayer();
            } else if (mediaResult.type === 'audio') {
                contentEl.innerHTML = createAudioPlayer(mediaResult.url, mediaResult.isLocal);
            }
            
            // Afficher un indicateur si c'est local
            if (mediaResult.isLocal) {
                showInfo('Lecture du contenu hors ligne');
            }
        } else {
            // Contenu HTML/Texte
            contentEl.innerHTML = lesson.content || '<p>Aucun contenu disponible</p>';
        }
        
    } catch (error) {
        console.error('[Player] Erreur:', error);
        document.getElementById('lesson-content').innerHTML = 
            `<div class="message message-error">
                <p>Erreur: ${error.message}</p>
                ${!navigator.onLine ? '<p>Vérifiez votre connexion Internet</p>' : ''}
             </div>`;
    }
}

// ==================== GESTIONNAIRE PRINCIPAL ====================
const playerManager = {
    // Initialiser le player
    init() {
        console.log('[Player] Initialisation du player');
        
        // Vérifier si l'UI existe déjà
        if (!document.getElementById('player-page')) {
            this.createPlayerUI();
        }
        
        // Attendre que le DOM soit prêt
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeElements();
                this.attachEventListeners();
                this.loadSavedSettings();
                this.initKeyboardShortcuts();
                this.initGestures();
            });
        } else {
            this.initializeElements();
            this.attachEventListeners();
            this.loadSavedSettings();
            this.initKeyboardShortcuts();
            this.initGestures();
        }
    },
    
    // Charger un cours
    async loadCourse(courseId) {
        console.log('[Player] Chargement du cours:', courseId);
        
        try {
            showLoader('Chargement du cours...');
            
            // Récupérer le cours
            const courseResponse = await window.electronAPI.db.getCourse(courseId);
            if (!courseResponse.success) {
                throw new Error('Cours non trouvé');
            }
            
            PlayerState.currentCourse = courseResponse.result;
            PlayerState.sessionStartTime = Date.now();
            
            // S'assurer que l'UI existe
            if (!document.getElementById('player-page')) {
                console.log('[Player] Création de l\'interface du player...');
                this.createPlayerUI();
            }
            
            // Afficher le player
            this.showPlayerPage();
            
            // Attendre que le DOM soit complètement prêt
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Réinitialiser les éléments
            this.initializeElements();
            this.attachEventListeners();
            
            // Maintenant mettre à jour l'UI
            this.updateCourseInfo();
            
            // Charger la structure du cours
            await this.loadCourseStructure();
            
            // Charger la dernière position ou première leçon
            await this.loadInitialLesson();
            
            hideLoader();
            return true;
            
        } catch (error) {
            console.error('[Player] Erreur lors du chargement du cours:', error);
            hideLoader();
            showError('Impossible de charger le cours');
            return false;
        }
    },
    
    // Charger une leçon
    async loadLesson(lessonId) {
        console.log('[Player] Chargement de la leçon:', lessonId);
        
        try {
            const lessonResponse = await window.electronAPI.db.getLesson(lessonId);
            if (!lessonResponse.success) {
                throw new Error('Leçon non trouvée');
            }
            
            // Sauvegarder la progression de la leçon précédente
            if (PlayerState.currentLesson) {
                await this.saveProgress();
            }
            
            PlayerState.currentLesson = lessonResponse.result;

            console.log('[Player] Leçon chargée - Données complètes:', PlayerState.currentLesson);
            console.log('[Player] Chemins média disponibles:', {
                file_path: PlayerState.currentLesson.file_path,
                video_url: PlayerState.currentLesson.video_url,
                media_url: PlayerState.currentLesson.media_url,
                content_encrypted: PlayerState.currentLesson.content_encrypted ? 'Oui' : 'Non'
            });
            
            // Trouver la section correspondante
            for (const [sectionId, lessons] of PlayerState.lessons) {
                if (lessons.some(l => l.lesson_id === lessonId)) {
                    PlayerState.currentSection = PlayerState.sections.find(s => s.section_id === sectionId);
                    break;
                }
            }
            
            // Réinitialiser l'état
            PlayerState.watchedSegments = [];
            PlayerState.currentTime = 0;
            
            // Charger le contenu
            await this.loadLessonContent();
            
            // Charger les données additionnelles
            await this.loadLessonData();
            
            // Mettre à jour l'UI
            this.updateLessonInfo();
            this.updateNavigation();
            
            // Marquer comme vue
            await this.markLessonAsViewed(lessonId);
            
            // Analytics
            this.trackEvent('lesson_started', { lessonId, courseId: PlayerState.currentCourse.course_id });
            
            return true;
            
        } catch (error) {
            console.error('[Player] Erreur lors du chargement de la leçon:', error);
            showError('Impossible de charger la leçon');
            return false;
        }
    },
    

// Charger les médias associés à une leçon
async loadLessonMedia(lessonId) {
    console.log('[Player] Chargement des médias pour la leçon:', lessonId);
    
    try {
        // Récupérer les médias depuis la base de données
        const mediaResponse = await window.electronAPI.db.getLessonMedia(lessonId);
        
        if (!mediaResponse.success || !mediaResponse.media || mediaResponse.media.length === 0) {
            console.log('[Player] Aucun média trouvé pour cette leçon');
            return null;
        }
        
        const media = mediaResponse.media[0]; // Prendre le premier média (généralement la vidéo principale)
        console.log('[Player] Média trouvé:', {
            type: media.type,
            hasPath: !!media.path,
            filename: media.filename
        });
        
        // Déchiffrer le chemin
        if (media.path_encrypted && this.encryption) {
            media.path = this.encryption.decrypt(media.path_encrypted, this.db.encryptionKey);
            console.log('[Player] Chemin déchiffré:', media.path);
        }
        
        return media;
        
    } catch (error) {
        console.error('[Player] Erreur lors du chargement des médias:', error);
        return null;
    }
},

// Modifier la fonction loadLesson existante
async loadLesson(lessonId) {
    console.log('[Player] Chargement de la leçon:', lessonId);
    
    try {
        // Utiliser la nouvelle méthode qui charge la leçon avec ses médias
        const lessonResponse = await window.electronAPI.db.getLessonWithMedia(lessonId);
        if (!lessonResponse.success) {
            throw new Error('Leçon non trouvée');
        }
        
        // Sauvegarder la progression de la leçon précédente
        if (PlayerState.currentLesson) {
            await this.saveProgress();
        }
        
        PlayerState.currentLesson = lessonResponse.result;
        
        // Les médias et le contenu sont déjà inclus grâce à getLessonWithMedia
        console.log('[Player] Leçon chargée avec médias:', {
            id: PlayerState.currentLesson.lesson_id,
            title: PlayerState.currentLesson.title,
            type: PlayerState.currentLesson.type,
            hasFilePath: !!PlayerState.currentLesson.file_path,
            hasContent: !!PlayerState.currentLesson.content,
            hasAttachments: Array.isArray(PlayerState.currentLesson.attachments),
            attachmentsCount: PlayerState.currentLesson.attachments?.length || 0,
            mediaCount: PlayerState.currentLesson.media?.length || 0
        });
        
        console.log('[Player] Leçon chargée complètement:', {
            id: PlayerState.currentLesson.lesson_id,
            title: PlayerState.currentLesson.title,
            type: PlayerState.currentLesson.type,
            hasFilePath: !!PlayerState.currentLesson.file_path,
            hasContent: !!PlayerState.currentLesson.content,
            attachmentsCount: PlayerState.currentLesson.attachments?.length || 0
        });
        
        // Trouver la section correspondante
        for (const [sectionId, lessons] of PlayerState.lessons) {
            if (lessons.some(l => l.lesson_id === lessonId)) {
                PlayerState.currentSection = PlayerState.sections.find(s => s.section_id === sectionId);
                break;
            }
        }
        
        // Réinitialiser l'état
        PlayerState.watchedSegments = [];
        PlayerState.currentTime = 0;
        
        // Charger le contenu
        await this.loadLessonContent();
        
        // Charger les données additionnelles
        await this.loadLessonData();
        
        // Mettre à jour l'UI
        this.updateLessonInfo();
        this.updateNavigation();
        
        // Marquer comme vue
        await this.markLessonAsViewed(lessonId);
        
        // Analytics
        this.trackEvent('lesson_started', { lessonId, courseId: PlayerState.currentCourse.course_id });
        
        return true;
        
    } catch (error) {
        console.error('[Player] Erreur lors du chargement de la leçon:', error);
        showError('Impossible de charger la leçon');
        return false;
    }
},



// Modifier aussi la fonction loadVideo pour gérer les fichiers chiffrés
async loadVideo() {
    console.log('[Player] Chargement de la vidéo...');
    
    const video = PlayerState.videoElement;
    const documentViewer = document.getElementById('document-viewer');
    
    if (!video) {
        console.error('[Player] Élément vidéo non trouvé');
        return;
    }
    
    if (!PlayerState.currentLesson) {
        console.error('[Player] Aucune leçon sélectionnée');
        return;
    }
    
    // Afficher la vidéo, cacher le document
    video.style.display = 'block';
    video.classList.remove('hidden');
    documentViewer?.classList.add('hidden');
    
    // Réafficher les contrôles vidéo
    const videoControls = document.getElementById('video-controls');
    if (videoControls) {
        videoControls.style.display = 'block';
    }
    
    // Réinitialiser
    this.showLoading();
    video.pause();
    
    // Déterminer le chemin de la vidéo
    let videoPath = PlayerState.currentLesson.file_path;
    
    if (!videoPath) {
        console.error('[Player] Aucun chemin vidéo trouvé pour la leçon');
        this.hideLoading();
        this.displayNoMediaMessage();
        return;
    }
    
    console.log('[Player] Chemin vidéo:', videoPath);
    
    // IMPORTANT: Si nous avons un SecureMediaPlayer, l'utiliser pour déchiffrer
    if (window.electronAPI && window.electronAPI.media && window.electronAPI.media.createStreamUrl) {
        try {
            console.log('[Player] Utilisation du SecureMediaPlayer pour le déchiffrement');
            
            // Créer une URL de streaming sécurisée
            const streamUrl = await window.electronAPI.media.createStreamUrl(videoPath, 'video/mp4');
            console.log('[Player] URL de streaming créée:', streamUrl);
            
            video.src = streamUrl;
        } catch (error) {
            console.error('[Player] Erreur lors de la création de l\'URL de streaming:', error);
            // Fallback : essayer de lire le fichier directement (ne fonctionnera pas si chiffré)
            video.src = `file://${videoPath}`;
        }
    } else {
        // Fallback : utiliser le chemin direct
        console.warn('[Player] SecureMediaPlayer non disponible, lecture directe');
        if (videoPath.startsWith('/') || videoPath.match(/^[A-Z]:\\/)) {
            video.src = `file://${videoPath}`;
        } else {
            video.src = videoPath;
        }
    }
    
    console.log('[Player] Source vidéo définie:', video.src);
    
    // Charger les sous-titres si disponibles
    if (PlayerState.currentLesson.subtitle_path) {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = 'Français';
        track.srclang = 'fr';
        track.src = `file://${PlayerState.currentLesson.subtitle_path}`;
        track.default = PlayerState.subtitlesEnabled;
        
        // Retirer les anciennes pistes
        video.querySelectorAll('track').forEach(t => t.remove());
        video.appendChild(track);
    }
    
    // Appliquer les paramètres
    video.playbackRate = PlayerState.playbackRate;
    video.volume = PlayerState.volume;
    video.muted = PlayerState.isMuted;
    
    // Écouter l'événement loadeddata pour masquer le loader
    video.addEventListener('loadeddata', () => {
        this.hideLoading();
        console.log('[Player] Vidéo chargée avec succès');
    }, { once: true });
    
    // Écouter l'événement error
    video.addEventListener('error', (e) => {
        this.hideLoading();
        console.error('[Player] Erreur de chargement vidéo:', e);
        console.error('[Player] Code erreur:', video.error?.code);
        console.error('[Player] Message erreur:', video.error?.message);
        
        // Afficher un message d'erreur détaillé
        let errorMessage = 'Erreur lors du chargement de la vidéo';
        if (video.error) {
            switch (video.error.code) {
                case 1:
                    errorMessage = 'Le chargement de la vidéo a été abandonné';
                    break;
                case 2:
                    errorMessage = 'Erreur réseau lors du chargement';
                    break;
                case 3:
                    errorMessage = 'Erreur de décodage de la vidéo';
                    break;
                case 4:
                    errorMessage = 'Format vidéo non supporté ou fichier introuvable';
                    break;
            }
        }
        
        this.displayNoMediaMessage();
        showError(errorMessage);
    }, { once: true });
},


    // Créer l'interface du player
    createPlayerUI() {
        const existingPlayer = document.getElementById('player-page');
        if (existingPlayer) {
            console.log('[Player] Interface du player déjà existante');
            this.initializeElements();
            return;
        }
        
        console.log('[Player] Création de l\'interface du player...');
        
        const playerHTML = `
        <div id="player-page" class="page hidden">
            <div class="player-wrapper">
                <!-- Header -->
                <div class="player-header">
                    <button class="btn-icon" onclick="playerManager.exitPlayer()" title="Retour aux cours">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                        </svg>
                    </button>
                    <div class="player-breadcrumb">
                        <span id="player-course-name">Cours</span>
                        <span class="separator">›</span>
                        <span id="player-section-name">Section</span>
                        <span class="separator">›</span>
                        <span id="player-lesson-name">Leçon</span>
                    </div>
                    <div class="player-header-actions">
                        <button class="btn-icon" onclick="playerManager.toggleTheaterMode()" title="Mode cinéma">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z"/>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="playerManager.toggleSidebar()" title="Afficher/Masquer la navigation">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <!-- Main Content -->
                <div class="player-main">
                    <!-- Sidebar -->
                    <div class="player-sidebar" id="player-sidebar">
                        <!-- Tabs -->
                        <div class="sidebar-tabs">
                            <button class="tab-btn active" data-tab="navigation" onclick="playerManager.switchTab('navigation')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z"/>
                                </svg>
                                Navigation
                            </button>
                            <button class="tab-btn" data-tab="notes" onclick="playerManager.switchTab('notes')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                                </svg>
                                Notes
                            </button>
                            <button class="tab-btn" data-tab="resources" onclick="playerManager.switchTab('resources')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                                </svg>
                                Ressources
                            </button>
                        </div>
                        
                        <!-- Tab Content -->
                        <div class="sidebar-content">
                            <div id="tab-navigation" class="tab-content active">
                                <div id="course-navigation" class="course-navigation">
                                    <!-- Navigation dynamique -->
                                </div>
                            </div>
                            <div id="tab-notes" class="tab-content">
                                <div class="notes-container">
                                    <div class="notes-header">
                                        <h3>Mes Notes</h3>
                                        <button class="btn-sm btn-primary" onclick="playerManager.addNote()">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                                            </svg>
                                            Ajouter
                                        </button>
                                    </div>
                                    <div id="notes-list" class="notes-list">
                                        <!-- Notes dynamiques -->
                                    </div>
                                </div>
                            </div>
                            <div id="tab-resources" class="tab-content">
                                <div id="resources-list" class="resources-list">
                                    <!-- Ressources dynamiques -->
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Video Container -->
                    <div class="player-content" id="player-content">
                        <div class="video-wrapper" id="video-wrapper">
                            <!-- Overlay pour les contrôles -->
                            <div class="video-overlay" id="video-overlay">
                                <!-- Indicateur de chargement -->
                                <div class="loading-spinner" id="loading-spinner">
                                    <div class="spinner"></div>
                                </div>
                                
                                <!-- Grand bouton play central -->
                                <div class="center-play-button" id="center-play-button">
                                    <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z"/>
                                    </svg>
                                </div>
                                
                                <!-- Indicateurs de seek -->
                                <div class="seek-indicator left" id="seek-backward">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                                    </svg>
                                    <span>-10s</span>
                                </div>
                                <div class="seek-indicator right" id="seek-forward">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                                    </svg>
                                    <span>+10s</span>
                                </div>
                            </div>
                            
                            <!-- Video element -->
                            <video id="course-video" class="video-player" preload="metadata"></video>
                            
                            <!-- Document viewer (pour les PDFs) -->
                            <iframe id="document-viewer" class="document-viewer hidden"></iframe>
                            
                            <!-- Conteneurs supplémentaires pour différents types de contenu -->
                            <div id="text-content-container" class="text-content-container hidden"></div>
                            <div id="no-media-message" class="no-media-message hidden"></div>
                            <div id="attachments-container" class="attachments-container hidden"></div>
                            
                            <!-- Contrôles personnalisés -->
                            <div class="video-controls" id="video-controls">
                                <!-- Progress bar -->
                                <div class="progress-container" id="progress-container">
                                    <div class="progress-bar">
                                        <div class="progress-buffered" id="progress-buffered"></div>
                                        <div class="progress-played" id="progress-played">
                                            <div class="progress-handle"></div>
                                        </div>
                                        <div class="progress-segments" id="progress-segments"></div>
                                    </div>
                                    <div class="progress-tooltip" id="progress-tooltip">
                                        <span class="tooltip-time">00:00</span>
                                        <div class="tooltip-preview"></div>
                                    </div>
                                </div>
                                
                                <!-- Controls bar -->
                                <div class="controls-bar">
                                    <div class="controls-left">
                                        <!-- Play/Pause -->
                                        <button class="control-btn" id="play-pause-btn" title="Lecture/Pause (Espace)">
                                            <svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M8 5v14l11-7z"/>
                                            </svg>
                                            <svg class="pause-icon hidden" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                            </svg>
                                        </button>
                                        
                                        <!-- Skip buttons -->
                                        <button class="control-btn" onclick="playerManager.skipBackward()" title="Reculer de 10s (←)">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                                            </svg>
                                        </button>
                                        <button class="control-btn" onclick="playerManager.skipForward()" title="Avancer de 10s (→)">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                                            </svg>
                                        </button>
                                        
                                        <!-- Volume -->
                                        <div class="volume-control">
                                            <button class="control-btn" id="volume-btn" title="Volume (M pour muet)">
                                                <svg class="volume-high" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                                </svg>
                                                <svg class="volume-low hidden" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                                                </svg>
                                                <svg class="volume-muted hidden" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                                                </svg>
                                            </button>
                                            <div class="volume-slider-container">
                                                <input type="range" class="volume-slider" id="volume-slider" min="0" max="100" value="100">
                                            </div>
                                        </div>
                                        
                                        <!-- Time display -->
                                        <div class="time-display">
                                            <span id="current-time">00:00</span>
                                            <span class="time-separator">/</span>
                                            <span id="duration">00:00</span>
                                        </div>
                                    </div>
                                    
                                    <div class="controls-right">
                                        <!-- Bookmarks -->
                                        <button class="control-btn" onclick="playerManager.addBookmark()" title="Ajouter un signet (B)">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                                            </svg>
                                        </button>
                                        
                                        <!-- Speed -->
                                        <div class="speed-control">
                                            <button class="control-btn" id="speed-btn" title="Vitesse de lecture">
                                                <span id="speed-text">1x</span>
                                            </button>
                                            <div class="speed-menu hidden" id="speed-menu">
                                                <button data-speed="0.25">0.25x</button>
                                                <button data-speed="0.5">0.5x</button>
                                                <button data-speed="0.75">0.75x</button>
                                                <button data-speed="1" class="active">Normal</button>
                                                <button data-speed="1.25">1.25x</button>
                                                <button data-speed="1.5">1.5x</button>
                                                <button data-speed="1.75">1.75x</button>
                                                <button data-speed="2">2x</button>
                                            </div>
                                        </div>
                                        
                                        <!-- Quality -->
                                        <div class="quality-control">
                                            <button class="control-btn" id="quality-btn" title="Qualité">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M19.59 14.59L21 16l-5 5-3.5-3.5 1.41-1.41L16 18.17l3.59-3.58M4 7h6v2H4v2h6v2H4v2h6v2H4v2h6v2H4v1c0 .55.45 1 1 1h8.09c-.05-.33-.09-.66-.09-1v-1H12v-2h1.09c.12-.72.37-1.39.72-2H12v-2h4c.57 0 1.09.1 1.58.28l.97-.98c-.53-.24-1.11-.38-1.72-.41-1.26-1.34-3.07-2.16-5.04-2.16-2.82 0-5.26 1.58-6.47 3.88H4v-2h8.82C12.58 7.7 11.56 7 10.5 7 8.57 7 7 8.57 7 10.5V11H4V9h1.05C5.03 8.84 5 8.67 5 8.5 5 8.22 5.03 7.95 5.09 7.7c.11-.35.26-.68.45-1C6.3 5.26 7.76 4.25 9.5 4.25c.91 0 1.76.25 2.49.68 1.1-1.43 2.83-2.36 4.79-2.36 3.31 0 6 2.69 6 6v9c0 .34-.04.67-.09 1H23V7c0-1.1-.9-2-2-2H9l2 2z"/>
                                                </svg>
                                                <span id="quality-text">Auto</span>
                                            </button>
                                            <div class="quality-menu hidden" id="quality-menu">
                                                <button data-quality="auto" class="active">Auto</button>
                                                <button data-quality="1080p">1080p</button>
                                                <button data-quality="720p">720p</button>
                                                <button data-quality="480p">480p</button>
                                                <button data-quality="360p">360p</button>
                                            </div>
                                        </div>
                                        
                                        <!-- Subtitles -->
                                        <button class="control-btn" id="subtitles-btn" onclick="playerManager.toggleSubtitles()" title="Sous-titres (C)">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                                            </svg>
                                        </button>
                                        
                                        <!-- Picture in Picture -->
                                        <button class="control-btn" onclick="playerManager.togglePiP()" title="Picture-in-Picture (P)">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>
                                            </svg>
                                        </button>
                                        
                                        <!-- Fullscreen -->
                                        <button class="control-btn" onclick="playerManager.toggleFullscreen()" title="Plein écran (F)">
                                            <svg class="fullscreen-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                                            </svg>
                                            <svg class="exit-fullscreen-icon hidden" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Bottom tabs for additional content -->
                        <div class="content-tabs" id="content-tabs">
                            <div class="tabs-header">
                                <button class="content-tab active" data-content="transcript">Transcription</button>
                                <button class="content-tab" data-content="questions">Questions</button>
                                <button class="content-tab" data-content="downloads">Téléchargements</button>
                            </div>
                            <div class="tabs-content">
                                <div id="content-transcript" class="content-panel active">
                                    <div class="transcript-content">
                                        <p class="empty-message">Aucune transcription disponible</p>
                                    </div>
                                </div>
                                <div id="content-questions" class="content-panel">
                                    <div class="questions-content">
                                        <p class="empty-message">Aucune question pour cette leçon</p>
                                    </div>
                                </div>
                                <div id="content-downloads" class="content-panel">
                                    <div class="downloads-content">
                                        <p class="empty-message">Aucune ressource téléchargeable</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Modals -->
            <!-- Note Modal -->
            <div id="note-modal" class="modal hidden">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Ajouter une note</h3>
                        <button class="modal-close" onclick="playerManager.closeNoteModal()">×</button>
                    </div>
                    <div class="modal-body">
                        <textarea id="note-text" placeholder="Écrivez votre note ici..." rows="5"></textarea>
                        <div class="note-timestamp">
                            Timestamp: <span id="note-timestamp">00:00</span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="playerManager.closeNoteModal()">Annuler</button>
                        <button class="btn btn-primary" onclick="playerManager.saveNote()">Enregistrer</button>
                    </div>
                </div>
            </div>
        </div>
        `;
        
        // Ajouter au DOM
        document.body.insertAdjacentHTML('beforeend', playerHTML);
        console.log('[Player] Interface du player créée avec succès');
        this.initializeElements();
    },
    
    // Initialiser les éléments DOM
    initializeElements() {
        console.log('[Player] Initialisation des éléments DOM...');
        
        PlayerState.container = document.getElementById('player-content');
        PlayerState.videoElement = document.getElementById('course-video');
        
        // Vérifier que les éléments existent
        if (!PlayerState.videoElement) {
            console.warn('[Player] Élément vidéo non trouvé');
        } else {
            console.log('[Player] Élément vidéo trouvé et stocké');
        }
        
        // Vérifier les autres éléments importants
        const elements = {
            'video-wrapper': document.getElementById('video-wrapper'),
            'video-overlay': document.getElementById('video-overlay'),
            'video-controls': document.getElementById('video-controls'),
            'player-course-name': document.getElementById('player-course-name'),
            'player-section-name': document.getElementById('player-section-name'),
            'player-lesson-name': document.getElementById('player-lesson-name')
        };
        
        Object.entries(elements).forEach(([id, element]) => {
            if (!element) {
                console.warn(`[Player] Élément ${id} non trouvé`);
            }
        });
    },
    
    // Attacher les écouteurs d'événements
    attachEventListeners() {
        const video = PlayerState.videoElement;
        if (!video) {
            console.warn('[Player] Impossible d\'attacher les événements vidéo - élément non trouvé');
            return;
        }
        
        console.log('[Player] Attachement des événements vidéo...');
        
        // Événements vidéo
        video.addEventListener('loadstart', () => this.handleLoadStart());
        video.addEventListener('loadedmetadata', () => this.handleLoadedMetadata());
        video.addEventListener('loadeddata', () => this.handleLoadedData());
        video.addEventListener('progress', () => this.handleProgress());
        video.addEventListener('play', () => this.handlePlay());
        video.addEventListener('pause', () => this.handlePause());
        video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        video.addEventListener('ended', () => this.handleEnded());
        video.addEventListener('error', (e) => this.handleError(e));
        video.addEventListener('waiting', () => this.showLoading());
        video.addEventListener('canplay', () => this.hideLoading());
        video.addEventListener('volumechange', () => this.handleVolumeChange());
        video.addEventListener('ratechange', () => this.handleRateChange());
        
        // Contrôles
        const playPauseBtn = document.getElementById('play-pause-btn');
        playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
        
        const centerPlayBtn = document.getElementById('center-play-button');
        centerPlayBtn?.addEventListener('click', () => this.togglePlayPause());
        
        const videoOverlay = document.getElementById('video-overlay');
        videoOverlay?.addEventListener('click', (e) => {
            if (e.target === videoOverlay) {
                this.togglePlayPause();
            }
        });
        
        // Double-clic pour plein écran
        videoOverlay?.addEventListener('dblclick', () => this.toggleFullscreen());
        
        // Progress bar
        const progressContainer = document.getElementById('progress-container');
        progressContainer?.addEventListener('mousedown', (e) => this.handleProgressSeek(e));
        progressContainer?.addEventListener('mousemove', (e) => this.handleProgressHover(e));
        progressContainer?.addEventListener('mouseleave', () => this.hideProgressTooltip());
        
        // Volume
        const volumeSlider = document.getElementById('volume-slider');
        volumeSlider?.addEventListener('input', (e) => this.setVolume(e.target.value / 100));
        
        // Speed menu
        const speedBtn = document.getElementById('speed-btn');
        speedBtn?.addEventListener('click', () => this.toggleSpeedMenu());
        
        const speedMenu = document.getElementById('speed-menu');
        speedMenu?.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setPlaybackRate(parseFloat(e.target.dataset.speed));
                this.toggleSpeedMenu();
            });
        });
        
        // Quality menu
        const qualityBtn = document.getElementById('quality-btn');
        qualityBtn?.addEventListener('click', () => this.toggleQualityMenu());
        
        // Content tabs
        document.querySelectorAll('.content-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchContentTab(e.target.dataset.content);
            });
        });
        
        // Controls visibility
        let controlsTimeout;
        const videoWrapper = document.getElementById('video-wrapper');
        
        videoWrapper?.addEventListener('mousemove', () => {
            this.showControls();
            clearTimeout(controlsTimeout);
            controlsTimeout = setTimeout(() => {
                if (PlayerState.isPlaying && !this.isMenuOpen()) {
                    this.hideControls();
                }
            }, 3000);
        });
        
        videoWrapper?.addEventListener('mouseleave', () => {
            if (PlayerState.isPlaying && !this.isMenuOpen()) {
                this.hideControls();
            }
        });
        
        console.log('[Player] Événements attachés avec succès');
    },
    
    // Raccourcis clavier
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ne pas intercepter si on est dans un input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Vérifier qu'on est dans le player
            const playerPage = document.getElementById('player-page');
            if (!playerPage || playerPage.classList.contains('hidden')) return;
            
            switch(e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    this.skipBackward();
                    break;
                case 'arrowright':
                    e.preventDefault();
                    this.skipForward();
                    break;
                case 'arrowup':
                    e.preventDefault();
                    this.increaseVolume();
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    this.decreaseVolume();
                    break;
                case 'f':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'm':
                    e.preventDefault();
                    this.toggleMute();
                    break;
                case 'c':
                    e.preventDefault();
                    this.toggleSubtitles();
                    break;
                case 'p':
                    e.preventDefault();
                    this.togglePiP();
                    break;
                case 'b':
                    e.preventDefault();
                    this.addBookmark();
                    break;
                case 'n':
                    e.preventDefault();
                    this.addNote();
                    break;
                case 't':
                    e.preventDefault();
                    this.toggleTheaterMode();
                    break;
                case 'escape':
                    if (PlayerState.isFullscreen) {
                        this.toggleFullscreen();
                    }
                    break;
                case '0':
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    e.preventDefault();
                    const percent = parseInt(e.key) * 10;
                    this.seekToPercent(percent);
                    break;
                case '<':
                case ',':
                    e.preventDefault();
                    this.decreaseSpeed();
                    break;
                case '>':
                case '.':
                    e.preventDefault();
                    this.increaseSpeed();
                    break;
            }
        });
    },
    
    // Gestes tactiles
    initGestures() {
        const overlay = document.getElementById('video-overlay');
        if (!overlay) return;
        
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        
        overlay.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = PlayerState.currentTime;
        });
        
        overlay.addEventListener('touchmove', (e) => {
            if (!touchStartX) return;
            
            const deltaX = e.touches[0].clientX - touchStartX;
            const deltaY = e.touches[0].clientY - touchStartY;
            
            // Seek horizontal
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                e.preventDefault();
                const seekTime = (deltaX / overlay.clientWidth) * 60; // 60 secondes max
                this.previewSeek(touchStartTime + seekTime);
            }
            // Volume vertical (côté droit)
            else if (touchStartX > overlay.clientWidth / 2) {
                e.preventDefault();
                const volumeDelta = -(deltaY / overlay.clientHeight);
                this.setVolume(PlayerState.volume + volumeDelta);
            }
            // Luminosité (côté gauche) - non implémenté
        });
        
        overlay.addEventListener('touchend', () => {
            touchStartX = 0;
            touchStartY = 0;
            this.applySeekPreview();
        });
    },
    
    // ==================== CHARGEMENT DU CONTENU ====================
    
    // Charger la structure du cours
    async loadCourseStructure() {
        console.log('[Player] Chargement de la structure du cours...');
        
        try {
            // Charger les sections
            const sectionsResponse = await window.electronAPI.db.getSections(PlayerState.currentCourse.course_id);
            if (sectionsResponse.success) {
                PlayerState.sections = sectionsResponse.result || [];
                console.log(`[Player] ${PlayerState.sections.length} sections chargées`);
                
                // Charger les leçons pour chaque section
                for (const section of PlayerState.sections) {
                    const lessonsResponse = await window.electronAPI.db.getLessons(section.section_id);
                    if (lessonsResponse.success) {
                        PlayerState.lessons.set(section.section_id, lessonsResponse.result || []);
                        console.log(`[Player] ${lessonsResponse.result?.length || 0} leçons chargées pour la section ${section.section_id}`);
                    }
                }
                
                // Construire la navigation
                this.buildNavigation();
                
                console.log('[Player] Structure du cours chargée avec succès');
                return true;
            }
            
            throw new Error('Impossible de charger les sections du cours');
            
        } catch (error) {
            console.error('[Player] Erreur lors du chargement de la structure:', error);
            throw error;
        }
    },
    
    // Charger la leçon initiale
    async loadInitialLesson() {
        try {
            // Vérifier la progression sauvegardée
            const progressResponse = await window.electronAPI.db.getCourseProgress(PlayerState.currentCourse.course_id);
            
            if (progressResponse.success && progressResponse.result?.last_lesson_id) {
                // Reprendre où on s'était arrêté
                await this.loadLesson(progressResponse.result.last_lesson_id);
                
                // Restaurer la position
                if (progressResponse.result.last_position) {
                    PlayerState.videoElement.currentTime = progressResponse.result.last_position;
                }
            } else {
                // Charger la première leçon
                if (PlayerState.sections.length > 0) {
                    const firstSection = PlayerState.sections[0];
                    const lessons = PlayerState.lessons.get(firstSection.section_id);
                    if (lessons && lessons.length > 0) {
                        await this.loadLesson(lessons[0].lesson_id);
                    }
                }
            }
        } catch (error) {
            console.error('[Player] Erreur lors du chargement de la leçon initiale:', error);
        }
    },
    
    // Charger le contenu de la leçon
    async loadLessonContent() {
        const lesson = PlayerState.currentLesson;
        if (!lesson) return;
        
        // Utiliser la nouvelle méthode displayMedia
        this.displayMedia(lesson);
    },

    

    // Afficher le média selon le type
displayMedia(lesson, retryCount = 0) {
    console.log('[Player] displayMedia appelé', {
        lessonId: lesson?.lesson_id,
        retryCount: retryCount,
        hasLesson: !!lesson
    });
    
    // Si pas de leçon, ne rien faire
    if (!lesson) {
        console.error('[Player] Aucune leçon fournie à displayMedia');
        return;
    }
    
    // Limite de tentatives
    if (retryCount > 3) {
        console.error('[Player] Impossible d\'afficher le média après 3 tentatives');
        this.displayNoMediaMessage();
        return;
    }
    
    // Vérifier que la page du player existe
    const playerPage = document.getElementById('player-page');
    if (!playerPage || playerPage.classList.contains('hidden')) {
        console.warn('[Player] Page du player non visible, attente...');
        setTimeout(() => this.displayMedia(lesson, retryCount + 1), 500);
        return;
    }
    
    // Vérifier que les éléments nécessaires existent
    const videoWrapper = document.getElementById('video-wrapper');
    const videoElement = document.getElementById('course-video');
    
    if (!videoWrapper || !videoElement) {
        console.warn(`[Player] Éléments manquants (tentative ${retryCount + 1}/3)`);
        
        // Si c'est la première tentative, essayer de réinitialiser
        if (retryCount === 0) {
            this.initializeElements();
        }
        
        setTimeout(() => this.displayMedia(lesson, retryCount + 1), 300);
        return;
    }
    
    // S'assurer que le videoElement est stocké
    if (!PlayerState.videoElement) {
        PlayerState.videoElement = videoElement;
    }
    
    console.log('[Player] Éléments trouvés, affichage du contenu...');
    
    // Réinitialiser l'affichage
    this.resetMediaDisplay();
    
    // Déterminer le type de contenu
    const hasVideo = lesson.file_path && (lesson.media_type === 'video' || lesson.type === 'video');
    const hasAudio = lesson.file_path && (lesson.media_type === 'audio' || lesson.type === 'audio');
    const hasDocument = lesson.file_path && (lesson.media_type === 'document' || lesson.type === 'pdf');
    const hasAttachments = Array.isArray(lesson.attachments) && lesson.attachments.length > 0;
    const hasContent = !!lesson.content;
    
    console.log('[Player] Type de contenu:', {
        hasVideo,
        hasAudio,
        hasDocument,
        hasAttachments,
        hasContent,
        filePath: lesson.file_path,
        mediaType: lesson.media_type,
        lessonType: lesson.type
    });
    
    // Afficher selon le type
    if (hasVideo || hasAudio) {
        console.log('[Player] Chargement vidéo/audio');
        this.loadVideo();
    } else if (hasDocument) {
        console.log('[Player] Chargement document');
        this.loadDocument();
    } else if (hasContent) {
        console.log('[Player] Affichage du contenu HTML');
        this.displayTextContent(lesson);
    } else if (hasAttachments) {
        console.log('[Player] Affichage des pièces jointes');
        this.loadAttachments(lesson.attachments);
    } else {
        console.log('[Player] Aucun média trouvé');
        this.displayNoMediaMessage();
    }
},

// Réinitialiser l'affichage des médias
resetMediaDisplay() {
    const video = document.getElementById('course-video');
    const docViewer = document.getElementById('document-viewer');
    const textContainer = document.getElementById('text-content-container');
    const noMediaMsg = document.getElementById('no-media-message');
    const attachmentsContainer = document.getElementById('attachments-container');
    const videoControls = document.getElementById('video-controls');
    
    // Arrêter la vidéo si elle joue
    if (video && !video.paused) {
        video.pause();
    }
    
    // Masquer tous les éléments
    [video, docViewer, textContainer, noMediaMsg, attachmentsContainer].forEach(el => {
        if (el) {
            el.style.display = 'none';
            el.classList.add('hidden');
        }
    });
    
    // Masquer les contrôles par défaut
    if (videoControls) {
        videoControls.style.display = 'none';
    }
},

// Corriger aussi la fonction loadAttachments pour éviter l'erreur map
loadAttachments(attachments) {
    const videoWrapper = document.getElementById('video-wrapper');
    if (!videoWrapper) return;
    
    // Vérifier que attachments est bien un tableau
    if (!Array.isArray(attachments)) {
        console.error('[Player] Attachments n\'est pas un tableau:', attachments);
        this.displayNoMediaMessage();
        return;
    }
    
    if (attachments.length === 0) {
        this.displayNoMediaMessage();
        return;
    }
    
    // Masquer les autres éléments
    this.resetMediaDisplay();
    
    // Créer ou mettre à jour le conteneur des pièces jointes
    let attachmentsContainer = document.getElementById('attachments-container');
    if (!attachmentsContainer) {
        attachmentsContainer = document.createElement('div');
        attachmentsContainer.id = 'attachments-container';
        attachmentsContainer.className = 'attachments-container';
        videoWrapper.appendChild(attachmentsContainer);
    }
    
    attachmentsContainer.style.display = 'block';
    attachmentsContainer.classList.remove('hidden');
    
    attachmentsContainer.innerHTML = `
        <div class="attachments-wrapper">
            <h3>Ressources de la leçon</h3>
            <div class="attachments-list">
                ${attachments.map(attachment => {
                    // S'assurer que chaque attachment a les propriétés nécessaires
                    const name = attachment.name || attachment.filename || 'Document';
                    const size = attachment.size || 0;
                    const id = attachment.id || attachment.url || '';
                    
                    return `
                        <div class="attachment-item">
                            <div class="attachment-icon">${this.getFileIcon(attachment.type || name)}</div>
                            <div class="attachment-info">
                                <h4>${this.escapeHtml(name)}</h4>
                                <p>${size ? this.formatFileSize(size) : ''}</p>
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="playerManager.downloadAttachment('${id}')">
                                Télécharger
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    // Masquer les contrôles vidéo
    this.updateControlsForDocument();
},

    // Nouvelle fonction pour gérer l'affichage du contenu
    displayMediaContent(lesson) {
        console.log('[Player] displayMediaContent - Type de média:', {
            hasMediaUrl: !!lesson.media_url,
            hasVideoUrl: !!lesson.video_url,
            hasFilePath: !!lesson.file_path,
            hasAttachments: !!(lesson.attachments?.length),
            contentType: lesson.content_type,
            lessonType: lesson.type
        });
        
        const videoWrapper = document.getElementById('video-wrapper');
        const videoElement = document.getElementById('course-video');
        const documentViewer = document.getElementById('document-viewer');
        
        if (!videoWrapper) {
            console.error('[Player] video-wrapper introuvable dans displayMediaContent');
            return;
        }
        
        // Réinitialiser l'affichage
        if (videoElement) {
            videoElement.pause();
            videoElement.src = '';
            videoElement.style.display = 'none';
        }
        
        if (documentViewer) {
            documentViewer.style.display = 'none';
            documentViewer.src = '';
        }
        
        // Masquer les contrôles vidéo par défaut
        const videoControls = document.getElementById('video-controls');
        if (videoControls) {
            videoControls.style.display = 'none';
        }
        
        // Déterminer le type de contenu et l'afficher
        const hasVideo = lesson.video_url || lesson.file_path || 
                        (lesson.media_url && this.isVideoFile(lesson.media_url));
        const hasDocument = lesson.media_url && this.isDocumentFile(lesson.media_url);
        
        if (hasVideo) {
            console.log('[Player] Contenu vidéo détecté');
            this.loadVideo();
        } else if (hasDocument) {
            console.log('[Player] Contenu document détecté');
            this.loadDocument();
        } else if (lesson.attachments?.length > 0) {
            console.log('[Player] Pièces jointes détectées');
            this.loadAttachments(lesson.attachments);
        } else if (lesson.content) {
            console.log('[Player] Contenu HTML/texte détecté');
            this.displayTextContent(lesson);
        } else {
            console.log('[Player] Aucun média trouvé pour cette leçon');
            this.displayNoMediaMessage();
        }
    },

    // Fonction helper pour vérifier si c'est un fichier vidéo
    isVideoFile(url) {
        if (!url) return false;
        const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
        const ext = url.split('.').pop().toLowerCase();
        return videoExtensions.includes(ext);
    },

    // Fonction helper pour vérifier si c'est un document
    isDocumentFile(url) {
        if (!url) return false;
        const docExtensions = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];
        const ext = url.split('.').pop().toLowerCase();
        return docExtensions.includes(ext);
    },

    // Afficher le contenu texte/HTML
    displayTextContent(lesson) {
        const videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper) return;
        
        // Masquer la vidéo et le document viewer
        const video = document.getElementById('course-video');
        const docViewer = document.getElementById('document-viewer');
        
        if (video) video.style.display = 'none';
        if (docViewer) docViewer.style.display = 'none';
        
        // Créer un conteneur pour le contenu
        let contentContainer = document.getElementById('text-content-container');
        if (!contentContainer) {
            contentContainer = document.createElement('div');
            contentContainer.id = 'text-content-container';
            contentContainer.className = 'text-content-container';
            videoWrapper.appendChild(contentContainer);
        }
        
        contentContainer.style.display = 'block';
        contentContainer.innerHTML = `
            <div class="lesson-content-wrapper">
                ${lesson.content || '<p>Aucun contenu disponible pour cette leçon.</p>'}
            </div>
        `;
        
        // Masquer les contrôles vidéo
        this.updateControlsForDocument();
    },

    // Afficher un message quand il n'y a pas de média
    displayNoMediaMessage() {
        const videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper) return;
        
        // Masquer tous les éléments média
        const video = document.getElementById('course-video');
        const docViewer = document.getElementById('document-viewer');
        const textContainer = document.getElementById('text-content-container');
        
        if (video) video.style.display = 'none';
        if (docViewer) docViewer.style.display = 'none';
        if (textContainer) textContainer.style.display = 'none';
        
        // Créer ou mettre à jour le message
        let messageContainer = document.getElementById('no-media-message');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.id = 'no-media-message';
            messageContainer.className = 'no-media-message';
            videoWrapper.appendChild(messageContainer);
        }
        
        messageContainer.style.display = 'flex';
        messageContainer.innerHTML = `
            <div class="empty-media-content">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                <h3>Aucun média disponible</h3>
                <p>Cette leçon ne contient pas de vidéo ou de document.</p>
                ${PlayerState.currentLesson?.content ? 
                    '<p class="info-text">Le contenu de la leçon est affiché ci-dessous.</p>' : 
                    '<p class="info-text">Contactez votre formateur si vous pensez qu\'il manque du contenu.</p>'
                }
            </div>
        `;
        
        // Masquer les contrôles vidéo
        this.updateControlsForDocument();
    },

    // Charger les pièces jointes
    loadAttachments(attachments) {
        const videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper || !attachments || attachments.length === 0) return;
        
        // Masquer les autres éléments
        const video = document.getElementById('course-video');
        const docViewer = document.getElementById('document-viewer');
        
        if (video) video.style.display = 'none';
        if (docViewer) docViewer.style.display = 'none';
        
        // Créer ou mettre à jour le conteneur des pièces jointes
        let attachmentsContainer = document.getElementById('attachments-container');
        if (!attachmentsContainer) {
            attachmentsContainer = document.createElement('div');
            attachmentsContainer.id = 'attachments-container';
            attachmentsContainer.className = 'attachments-container';
            videoWrapper.appendChild(attachmentsContainer);
        }
        
        attachmentsContainer.style.display = 'block';
        attachmentsContainer.innerHTML = `
            <div class="attachments-wrapper">
                <h3>Ressources de la leçon</h3>
                <div class="attachments-list">
                    ${attachments.map(attachment => `
                        <div class="attachment-item">
                            <div class="attachment-icon">${this.getFileIcon(attachment.type || attachment.name)}</div>
                            <div class="attachment-info">
                                <h4>${this.escapeHtml(attachment.name || 'Document')}</h4>
                                <p>${attachment.size ? this.formatFileSize(attachment.size) : ''}</p>
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="playerManager.downloadAttachment('${attachment.id || attachment.url}')">
                                Télécharger
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Masquer les contrôles vidéo
        this.updateControlsForDocument();
    },

    // Créer un player minimal en cas d'urgence
    createMinimalPlayer() {
        console.log('[Player] Création d\'un player minimal d\'urgence');
        
        const playerPage = document.getElementById('player-page');
        if (!playerPage) {
            console.error('[Player] Impossible de créer le player minimal - pas de page');
            return;
        }
        
        // Créer un player très basique
        playerPage.innerHTML = `
            <div class="player-emergency">
                <div class="player-header" style="padding: 20px; border-bottom: 1px solid #ddd;">
                    <button onclick="playerManager.exitPlayer()" class="btn btn-secondary">← Retour aux cours</button>
                    <h2 style="margin: 10px 0;">Lecteur de cours (Mode minimal)</h2>
                </div>
                <div id="video-wrapper" style="padding: 20px; background: #000; min-height: 400px; display: flex; align-items: center; justify-content: center;">
                    <video id="course-video" controls style="width: 100%; max-width: 900px; background: #000;">
                        Votre navigateur ne supporte pas la lecture vidéo.
                    </video>
                    <iframe id="document-viewer" class="hidden" style="width: 100%; height: 600px; border: none;"></iframe>
                    <div id="text-content-container" class="hidden" style="width: 100%; max-width: 900px; background: white; padding: 20px;"></div>
                    <div id="no-media-message" class="hidden" style="text-align: center; color: #666;"></div>
                    <div id="attachments-container" class="hidden" style="width: 100%; max-width: 900px;"></div>
                </div>
                <div class="player-info" style="padding: 20px;">
                    <h3 id="player-lesson-name">Chargement...</h3>
                    <p style="color: #666;">Si le contenu ne se charge pas, vérifiez que le fichier existe et que vous avez les droits d'accès.</p>
                </div>
            </div>
        `;
        
        // Ajouter un style minimal
        const style = document.createElement('style');
        style.textContent = `
            .player-emergency { font-family: Arial, sans-serif; }
            .hidden { display: none !important; }
            .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
            .btn-primary { background: #007bff; color: white; }
            .btn-secondary { background: #6c757d; color: white; }
            .btn:hover { opacity: 0.9; }
        `;
        document.head.appendChild(style);
        
        console.log('[Player] Player minimal créé');
    },

    // Helper pour télécharger une pièce jointe
    downloadAttachment(attachmentId) {
        console.log('[Player] Téléchargement de la pièce jointe:', attachmentId);
        // Implémenter la logique de téléchargement
        showInfo('Téléchargement en cours...');
    },
    
    // Charger une vidéo
// Charger une vidéo
async loadVideo() {
    console.log('[Player] ==> loadVideo() appelé');
    console.log('[Player] État actuel:', {
        hasVideoElement: !!PlayerState.videoElement,
        hasCurrentLesson: !!PlayerState.currentLesson,
        lessonId: PlayerState.currentLesson?.lesson_id,
        lessonType: PlayerState.currentLesson?.type
    });
    
    const video = PlayerState.videoElement;
    const documentViewer = document.getElementById('document-viewer');
    
    if (!video) {
        console.error('[Player] Élément vidéo non trouvé');
        return;
    }

     // IMPORTANT : S'assurer que la vidéo est visible
    video.style.display = 'block';
    video.style.visibility = 'visible';
    video.style.opacity = '1';
    video.classList.remove('hidden');


        // S'assurer que le conteneur est aussi visible
    const videoWrapper = document.getElementById('video-wrapper');
    if (videoWrapper) {
        videoWrapper.style.display = 'block';
        videoWrapper.classList.remove('hidden');
    }
    
    if (!PlayerState.currentLesson) {
        console.error('[Player] Aucune leçon sélectionnée');
        return;
    }
    
    // Debug: Afficher toutes les propriétés de la leçon
    console.log('[Player] Propriétés de la leçon:', {
        file_path: PlayerState.currentLesson.file_path,
        video_url: PlayerState.currentLesson.video_url,
        media_url: PlayerState.currentLesson.media_url,
        media: PlayerState.currentLesson.media,
        attachments: PlayerState.currentLesson.attachments,
        type: PlayerState.currentLesson.type,
        media_type: PlayerState.currentLesson.media_type
    });
    
    // Afficher la vidéo, cacher le document
    video.style.display = 'block';
    video.classList.remove('hidden');
    documentViewer?.classList.add('hidden');
    
    // Réafficher les contrôles vidéo
    const videoControls = document.getElementById('video-controls');
    if (videoControls) {
        videoControls.style.display = 'block';
    }
    
    // Réinitialiser
    this.showLoading();
    video.pause();
    
    // Déterminer le chemin de la vidéo
    let videoPath = null;
    
    // 1. Essayer file_path en premier
    if (PlayerState.currentLesson.file_path) {
        videoPath = PlayerState.currentLesson.file_path;
        console.log('[Player] Chemin trouvé dans file_path:', videoPath);
    }
    // 2. Essayer video_url
    else if (PlayerState.currentLesson.video_url) {
        videoPath = PlayerState.currentLesson.video_url;
        console.log('[Player] Chemin trouvé dans video_url:', videoPath);
    }
    // 3. Essayer media_url
    else if (PlayerState.currentLesson.media_url) {
        videoPath = PlayerState.currentLesson.media_url;
        console.log('[Player] Chemin trouvé dans media_url:', videoPath);
    }
    // 4. Essayer de récupérer depuis les médias associés
    else if (PlayerState.currentLesson.media && Array.isArray(PlayerState.currentLesson.media) && PlayerState.currentLesson.media.length > 0) {
        console.log('[Player] Recherche dans les médias associés:', PlayerState.currentLesson.media.length, 'média(s)');
        
        const videoMedia = PlayerState.currentLesson.media.find(m => 
            m.type === 'video' || m.mime_type?.startsWith('video/')
        );
        
        if (videoMedia) {
            videoPath = videoMedia.path || videoMedia.file_path || videoMedia.url;
            console.log('[Player] Média vidéo trouvé:', {
                id: videoMedia.id,
                type: videoMedia.type,
                mime_type: videoMedia.mime_type,
                path: videoMedia.path,
                file_path: videoMedia.file_path,
                url: videoMedia.url
            });
        }
    }
    
    if (!videoPath) {
        console.error('[Player] ERREUR: Aucun chemin vidéo trouvé pour la leçon');
        console.error('[Player] Données complètes de la leçon:', PlayerState.currentLesson);
        this.hideLoading();
        this.displayNoMediaMessage();
        return;
    }
    
    console.log('[Player] Chemin vidéo final:', videoPath);
    console.log('[Player] Type de chemin:', {
        isAbsolutePath: videoPath.startsWith('/') || videoPath.match(/^[A-Z]:\\/),
        isHttpUrl: videoPath.startsWith('http://') || videoPath.startsWith('https://'),
        isFileUrl: videoPath.startsWith('file://'),
        extension: videoPath.split('.').pop()
    });
    
    // Vérifier la disponibilité du SecureMediaPlayer
    console.log('[Player] Vérification du SecureMediaPlayer:', {
        hasElectronAPI: !!window.electronAPI,
        hasMedia: !!window.electronAPI?.media,
        hasCreateStreamUrl: !!window.electronAPI?.media?.createStreamUrl
    });
    
    try {
        // Si nous avons un SecureMediaPlayer, l'utiliser pour déchiffrer
        if (window.electronAPI && window.electronAPI.media && window.electronAPI.media.createStreamUrl) {
            console.log('[Player] Utilisation du SecureMediaPlayer pour le déchiffrement');
            
            // Créer une URL de streaming sécurisée
            console.log('[Player] Appel de createStreamUrl avec:', {
                path: videoPath,
                mimeType: 'video/mp4'
            });
            
            const streamResult = await window.electronAPI.media.createStreamUrl(videoPath, 'video/mp4');
            
            console.log('[Player] Résultat de createStreamUrl:', {
                success: streamResult.success,
                hasUrl: !!streamResult.url,
                error: streamResult.error
            });
            
            if (streamResult.success && streamResult.url) {
                console.log('[Player] URL de streaming créée avec succès:', streamResult.url);
                video.src = streamResult.url;
            } else {
                throw new Error(streamResult.error || 'Échec de la création de l\'URL de streaming');
            }
            
        } else {
            // Fallback : utiliser le chemin direct
            console.warn('[Player] SecureMediaPlayer non disponible, lecture directe');
            console.warn('[Player] ATTENTION: La lecture directe ne fonctionnera que si le fichier n\'est PAS chiffré');
            
            if (videoPath.startsWith('/') || videoPath.match(/^[A-Z]:\\/)) {
                video.src = `file://${videoPath}`;
            } else if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
                video.src = videoPath;
            } else {
                // Supposer que c'est un chemin relatif
                video.src = videoPath;
            }
        }
        
    } catch (error) {
        console.error('[Player] ERREUR lors de la création de l\'URL de streaming:', error);
        console.error('[Player] Stack trace:', error.stack);
        
        // Tenter le fallback en dernier recours
        console.warn('[Player] Tentative de lecture directe (fallback d\'urgence)');
        if (videoPath.startsWith('/') || videoPath.match(/^[A-Z]:\\/)) {
            video.src = `file://${videoPath}`;
        } else {
            video.src = videoPath;
        }
    }
    
    console.log('[Player] Source vidéo définie:', video.src);
    
    // Charger les sous-titres si disponibles
    if (PlayerState.currentLesson.subtitle_path) {
        console.log('[Player] Chargement des sous-titres:', PlayerState.currentLesson.subtitle_path);
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = 'Français';
        track.srclang = 'fr';
        track.src = `file://${PlayerState.currentLesson.subtitle_path}`;
        track.default = PlayerState.subtitlesEnabled;
        
        // Retirer les anciennes pistes
        video.querySelectorAll('track').forEach(t => t.remove());
        video.appendChild(track);
    }
    
    // Appliquer les paramètres
    video.playbackRate = PlayerState.playbackRate;
    video.volume = PlayerState.volume;
    video.muted = PlayerState.isMuted;
    
    console.log('[Player] Paramètres vidéo appliqués:', {
        playbackRate: video.playbackRate,
        volume: video.volume,
        muted: video.muted
    });
    
    // Écouter l'événement loadeddata pour masquer le loader
    video.addEventListener('loadeddata', () => {
        this.hideLoading();
        console.log('[Player] ✓ Vidéo chargée avec succès');
        console.log('[Player] Métadonnées vidéo:', {
            duration: video.duration,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState
        });
    }, { once: true });
    
    // Écouter l'événement error
    video.addEventListener('error', (e) => {
        this.hideLoading();
        console.error('[Player] ❌ ERREUR de chargement vidéo:', e);
        console.error('[Player] Détails de l\'erreur:', {
            errorCode: video.error?.code,
            errorMessage: video.error?.message,
            errorDetails: video.error,
            videoSrc: video.src,
            networkState: video.networkState,
            readyState: video.readyState
        });
        
        // Afficher un message d'erreur détaillé
        let errorMessage = 'Erreur lors du chargement de la vidéo';
        if (video.error) {
            switch (video.error.code) {
                case 1:
                    errorMessage = 'Le chargement de la vidéo a été abandonné';
                    break;
                case 2:
                    errorMessage = 'Erreur réseau lors du chargement';
                    break;
                case 3:
                    errorMessage = 'Erreur de décodage de la vidéo';
                    break;
                case 4:
                    errorMessage = 'Format vidéo non supporté ou fichier introuvable';
                    console.error('[Player] Erreur de format/fichier. Vérifiez que:', 
                        '\n- Le fichier existe à l\'emplacement indiqué',
                        '\n- Le fichier n\'est pas corrompu',
                        '\n- Si le fichier est chiffré, le SecureMediaPlayer doit être utilisé'
                    );
                    break;
            }
        }
        
        this.displayNoMediaMessage();
        showError(errorMessage);
    }, { once: true });
    
    console.log('[Player] <== loadVideo() terminé, en attente du chargement...');
},
   
   // Charger un document
   async loadDocument() {
       const video = PlayerState.videoElement;
       const documentViewer = document.getElementById('document-viewer');
       
       if (!documentViewer || !PlayerState.currentLesson.file_path) return;
       
       // Cacher la vidéo, afficher le document
       video?.classList.add('hidden');
       documentViewer.classList.remove('hidden');
       
       // Charger le document
       documentViewer.src = `file://${PlayerState.currentLesson.file_path}`;
       
       // Masquer certains contrôles non pertinents
       this.updateControlsForDocument();
   },
   
   // Charger les données additionnelles de la leçon
   async loadLessonData() {
       console.log('[Player] Chargement des données de la leçon...');
       
       // Charger les notes
       await this.loadNotes();
       
       // Charger les signets
       await this.loadBookmarks();
       
       // Charger les ressources
       await this.loadResources();
       
       // Charger la transcription
       await this.loadTranscript();
       
       // Charger les segments regardés
       await this.loadWatchedSegments();
       
       console.log('[Player] Données de la leçon chargées');
   },
   
   // ==================== CONTRÔLES DE LECTURE ====================
   
   // Play/Pause
   togglePlayPause() {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       if (video.paused) {
           video.play();
       } else {
           video.pause();
       }
   },
   
   // Avancer de 10 secondes
   skipForward() {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       video.currentTime = Math.min(video.currentTime + 10, video.duration);
       this.showSeekIndicator('forward');
   },
   
   // Reculer de 10 secondes
   skipBackward() {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       video.currentTime = Math.max(video.currentTime - 10, 0);
       this.showSeekIndicator('backward');
   },
   
   // Aller à un pourcentage
   seekToPercent(percent) {
       const video = PlayerState.videoElement;
       if (!video || !video.duration) return;
       
       video.currentTime = (percent / 100) * video.duration;
   },
   
   // Définir le volume
   setVolume(value) {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       value = Math.max(0, Math.min(1, value));
       video.volume = value;
       PlayerState.volume = value;
       
       // Sauvegarder
       localStorage.setItem('player_volume', value);
       
       // Mettre à jour l'UI
       const volumeSlider = document.getElementById('volume-slider');
       if (volumeSlider) {
           volumeSlider.value = value * 100;
       }
       
       this.updateVolumeIcon();
   },
   
   // Augmenter le volume
   increaseVolume() {
       this.setVolume(PlayerState.volume + 0.1);
   },
   
   // Diminuer le volume
   decreaseVolume() {
       this.setVolume(PlayerState.volume - 0.1);
   },
   
   // Mute/Unmute
   toggleMute() {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       video.muted = !video.muted;
       PlayerState.isMuted = video.muted;
       this.updateVolumeIcon();
   },
   
   // Définir la vitesse
   setPlaybackRate(rate) {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       video.playbackRate = rate;
       PlayerState.playbackRate = rate;
       
       // Sauvegarder
       localStorage.setItem('player_rate', rate);
       
       // Mettre à jour l'UI
       document.getElementById('speed-text').textContent = rate === 1 ? '1x' : `${rate}x`;
       
       // Mettre à jour le menu
       document.querySelectorAll('#speed-menu button').forEach(btn => {
           btn.classList.toggle('active', parseFloat(btn.dataset.speed) === rate);
       });
   },
   
   // Augmenter la vitesse
   increaseSpeed() {
       const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
       const currentIndex = speeds.indexOf(PlayerState.playbackRate);
       if (currentIndex < speeds.length - 1) {
           this.setPlaybackRate(speeds[currentIndex + 1]);
       }
   },
   
   // Diminuer la vitesse
   decreaseSpeed() {
       const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
       const currentIndex = speeds.indexOf(PlayerState.playbackRate);
       if (currentIndex > 0) {
           this.setPlaybackRate(speeds[currentIndex - 1]);
       }
   },
   
   // ==================== MODES D'AFFICHAGE ====================
   
   // Plein écran
   async toggleFullscreen() {
       const container = document.getElementById('video-wrapper');
       if (!container) return;
       
       if (!document.fullscreenElement) {
           await container.requestFullscreen();
           PlayerState.isFullscreen = true;
           this.updateFullscreenIcon();
       } else {
           await document.exitFullscreen();
           PlayerState.isFullscreen = false;
           this.updateFullscreenIcon();
       }
   },
   
   // Picture-in-Picture
   async togglePiP() {
       const video = PlayerState.videoElement;
       if (!video) return;
       
       try {
           if (document.pictureInPictureElement) {
               await document.exitPictureInPicture();
               PlayerState.isPiP = false;
           } else {
               await video.requestPictureInPicture();
               PlayerState.isPiP = true;
           }
       } catch (error) {
           console.error('[Player] Erreur PiP:', error);
       }
   },
   
   // Mode théâtre
   toggleTheaterMode() {
       const wrapper = document.querySelector('.player-wrapper');
       if (!wrapper) return;
       
       PlayerState.isTheaterMode = !PlayerState.isTheaterMode;
       wrapper.classList.toggle('theater-mode', PlayerState.isTheaterMode);
   },
   
   // Toggle sidebar
   toggleSidebar() {
       const sidebar = document.getElementById('player-sidebar');
       if (!sidebar) return;
       
       sidebar.classList.toggle('collapsed');
   },
   
   // ==================== GESTION DES ÉVÉNEMENTS VIDÉO ====================
   
   handleLoadStart() {
       console.log('[Player] Chargement démarré');
       this.showLoading();
   },
   
   handleLoadedMetadata() {
       console.log('[Player] Métadonnées chargées');
       const video = PlayerState.videoElement;
       PlayerState.duration = video.duration;
       
       // Mettre à jour l'affichage de la durée
       document.getElementById('duration').textContent = this.formatTime(video.duration);
       
       // Charger les segments regardés
       this.displayWatchedSegments();
   },
   
   handleLoadedData() {
       console.log('[Player] Données chargées');
       this.hideLoading();
       
       // Auto-play si activé
       if (PlayerState.autoplay) {
           PlayerState.videoElement.play();
       }
   },
   
   handleProgress() {
       const video = PlayerState.videoElement;
       if (!video.buffered.length) return;
       
       // Calculer le pourcentage mis en mémoire tampon
       const bufferedEnd = video.buffered.end(video.buffered.length - 1);
       const bufferedPercent = (bufferedEnd / video.duration) * 100;
       PlayerState.buffered = bufferedPercent;
       
       // Mettre à jour la barre de progression
       const bufferedBar = document.getElementById('progress-buffered');
       if (bufferedBar) {
           bufferedBar.style.width = `${bufferedPercent}%`;
       }
   },
   
   handlePlay() {
       PlayerState.isPlaying = true;
       this.updatePlayPauseIcon();
       document.getElementById('center-play-button')?.classList.add('hidden');
   },
   
   handlePause() {
       PlayerState.isPlaying = false;
       this.updatePlayPauseIcon();
       document.getElementById('center-play-button')?.classList.remove('hidden');
   },
   
   handleTimeUpdate() {
       const video = PlayerState.videoElement;
       PlayerState.currentTime = video.currentTime;
       
       // Mettre à jour l'affichage du temps
       document.getElementById('current-time').textContent = this.formatTime(video.currentTime);
       
       // Mettre à jour la barre de progression
       if (video.duration) {
           const percent = (video.currentTime / video.duration) * 100;
           document.getElementById('progress-played').style.width = `${percent}%`;
       }
       
       // Enregistrer les segments regardés
       this.recordWatchedSegment(video.currentTime);
       
       // Sauvegarder la progression toutes les 5 secondes
       if (Math.floor(video.currentTime) % 5 === 0) {
           this.saveProgress();
       }
       
       // Mettre à jour la transcription active
       this.updateActiveTranscript(video.currentTime);
   },
   
   handleEnded() {
       console.log('[Player] Lecture terminée');
       PlayerState.isPlaying = false;
       this.updatePlayPauseIcon();
       
       // Marquer la leçon comme complétée
       this.markLessonAsCompleted();
       
       // Charger la leçon suivante si autoplay
       if (PlayerState.autoplay) {
           setTimeout(() => this.loadNextLesson(), 2000);
       }
   },
   
   handleError(e) {
       console.error('[Player] Erreur vidéo:', e);
       this.hideLoading();
       
       let errorMessage = 'Erreur lors de la lecture de la vidéo';
       if (PlayerState.videoElement.error) {
           switch (PlayerState.videoElement.error.code) {
               case 1:
                   errorMessage = 'Le chargement de la vidéo a été abandonné';
                   break;
               case 2:
                   errorMessage = 'Erreur réseau lors du chargement';
                   break;
               case 3:
                   errorMessage = 'Erreur de décodage de la vidéo';
                   break;
               case 4:
                   errorMessage = 'Format vidéo non supporté';
                   break;
           }
       }
       
       showError(errorMessage);
   },
   
   handleVolumeChange() {
       const video = PlayerState.videoElement;
       PlayerState.volume = video.volume;
       PlayerState.isMuted = video.muted;
       
       this.updateVolumeIcon();
       
       // Mettre à jour le slider
       const volumeSlider = document.getElementById('volume-slider');
       if (volumeSlider && !video.muted) {
           volumeSlider.value = video.volume * 100;
       }
   },
   
   handleRateChange() {
       PlayerState.playbackRate = PlayerState.videoElement.playbackRate;
   },
   
   // ==================== NAVIGATION ====================
   
   // Construire la navigation
   buildNavigation() {
       const navContainer = document.getElementById('course-navigation');
       if (!navContainer) return;
       
       let navHTML = '';
       let totalLessons = 0;
       let completedLessons = 0;
       
       PlayerState.sections.forEach(section => {
           const lessons = PlayerState.lessons.get(section.section_id) || [];
           const sectionCompleted = lessons.filter(l => l.completed).length;
           totalLessons += lessons.length;
           completedLessons += sectionCompleted;
           
           navHTML += `
               <div class="nav-section" data-section-id="${section.section_id}">
                   <div class="section-header">
                       <h3>${this.escapeHtml(section.title)}</h3>
                       <span class="section-progress">${sectionCompleted}/${lessons.length}</span>
                   </div>
                   <div class="section-lessons">
           `;
           
           lessons.forEach((lesson, index) => {
               const isActive = PlayerState.currentLesson?.lesson_id === lesson.lesson_id;
               const isCompleted = lesson.completed;
               const icon = this.getLessonIcon(lesson.content_type);
               
               navHTML += `
                   <div class="nav-lesson ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" 
                        data-lesson-id="${lesson.lesson_id}"
                        onclick="playerManager.loadLesson(${lesson.lesson_id})">
                       <span class="lesson-number">${index + 1}</span>
                       <span class="lesson-icon">${icon}</span>
                       <div class="lesson-info">
                           <div class="lesson-title">${this.escapeHtml(lesson.title)}</div>
                           ${lesson.duration ? `<div class="lesson-duration">${this.formatTime(lesson.duration)}</div>` : ''}
                       </div>
                       ${isCompleted ? '<span class="lesson-check">✓</span>' : ''}
                   </div>
               `;
           });
           
           navHTML += '</div></div>';
       });
       
       navContainer.innerHTML = navHTML;
       
       // Mettre à jour la progression globale
       this.updateCourseProgress(completedLessons, totalLessons);
   },
   
   // Mettre à jour la navigation active
   updateNavigation() {
       // Retirer l'ancienne classe active
       document.querySelectorAll('.nav-lesson').forEach(el => {
           el.classList.remove('active');
       });
       
       // Ajouter la classe active
       const activeLesson = document.querySelector(`[data-lesson-id="${PlayerState.currentLesson.lesson_id}"]`);
       if (activeLesson) {
           activeLesson.classList.add('active');
           activeLesson.scrollIntoView({ behavior: 'smooth', block: 'center' });
       }
   },
   
   // Charger la prochaine leçon
   async loadNextLesson() {
       const allLessons = [];
       PlayerState.sections.forEach(section => {
           const lessons = PlayerState.lessons.get(section.section_id) || [];
           allLessons.push(...lessons);
       });
       
       const currentIndex = allLessons.findIndex(l => l.lesson_id === PlayerState.currentLesson.lesson_id);
       if (currentIndex < allLessons.length - 1) {
           await this.loadLesson(allLessons[currentIndex + 1].lesson_id);
       } else {
           showInfo('Félicitations ! Vous avez terminé ce cours.');
           this.showCourseCompletion();
       }
   },
   
   // Charger la leçon précédente
   async loadPreviousLesson() {
       const allLessons = [];
       PlayerState.sections.forEach(section => {
           const lessons = PlayerState.lessons.get(section.section_id) || [];
           allLessons.push(...lessons);
       });
       
       const currentIndex = allLessons.findIndex(l => l.lesson_id === PlayerState.currentLesson.lesson_id);
       if (currentIndex > 0) {
           await this.loadLesson(allLessons[currentIndex - 1].lesson_id);
       }
   },
   
   // ==================== NOTES ET SIGNETS ====================
   
   // Ajouter une note
   addNote() {
       const modal = document.getElementById('note-modal');
       const timestamp = document.getElementById('note-timestamp');
       const noteText = document.getElementById('note-text');
       
       if (!modal) return;
       
       // Mettre à jour le timestamp
       timestamp.textContent = this.formatTime(PlayerState.currentTime);
       noteText.value = '';
       noteText.dataset.timestamp = PlayerState.currentTime;
       
       // Afficher le modal
       modal.classList.remove('hidden');
       noteText.focus();
   },
   
   // Sauvegarder la note
   async saveNote() {
       const noteText = document.getElementById('note-text');
       const text = noteText.value.trim();
       
       if (!text) return;
       
       try {
           const note = {
               lesson_id: PlayerState.currentLesson.lesson_id,
               timestamp: parseFloat(noteText.dataset.timestamp),
               text: text,
               created_at: new Date().toISOString()
           };
           
           // Vérifier que la méthode existe
           if (window.electronAPI.db.addNote) {
               const result = await window.electronAPI.db.addNote(note);
               if (result.success) {
                   PlayerState.notes.push({ ...note, id: result.noteId });
                   this.displayNotes();
                   this.closeNoteModal();
                   showSuccess('Note ajoutée');
               }
           } else {
               // Stockage local en fallback
               note.id = Date.now();
               PlayerState.notes.push(note);
               this.displayNotes();
               this.closeNoteModal();
               showSuccess('Note ajoutée (local)');
           }
       } catch (error) {
           console.error('[Player] Erreur lors de l\'ajout de la note:', error);
           showError('Impossible d\'ajouter la note');
       }
   },
   
   // Fermer le modal de note
   closeNoteModal() {
       document.getElementById('note-modal')?.classList.add('hidden');
   },
   
   // Charger les notes
   async loadNotes() {
       try {
           // Vérifier que la méthode existe
           if (window.electronAPI.db.getNotes) {
               const result = await window.electronAPI.db.getNotes(PlayerState.currentLesson.lesson_id);
               if (result.success) {
                   PlayerState.notes = result.notes;
                   this.displayNotes();
               }
           } else {
               console.log('[Player] Méthode getNotes non disponible');
               PlayerState.notes = [];
               this.displayNotes();
           }
       } catch (error) {
           console.error('[Player] Erreur lors du chargement des notes:', error);
           PlayerState.notes = [];
           this.displayNotes();
       }
   },
   
   // Afficher les notes
   displayNotes() {
       const notesList = document.getElementById('notes-list');
       if (!notesList) return;
       
       if (PlayerState.notes.length === 0) {
           notesList.innerHTML = '<p class="empty-message">Aucune note pour cette leçon</p>';
           return;
       }
       
       notesList.innerHTML = PlayerState.notes
           .sort((a, b) => a.timestamp - b.timestamp)
           .map(note => `
               <div class="note-item" data-note-id="${note.id}">
                   <div class="note-header">
                       <span class="note-timestamp" onclick="playerManager.seekTo(${note.timestamp})">
                           ${this.formatTime(note.timestamp)}
                       </span>
                       <button class="btn-icon small" onclick="playerManager.deleteNote(${note.id})">
                           <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                               <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                           </svg>
                       </button>
                   </div>
                   <div class="note-text">${this.escapeHtml(note.text)}</div>
               </div>
           `).join('');
   },
   
   // Supprimer une note
   async deleteNote(noteId) {
       if (!confirm('Supprimer cette note ?')) return;
       
       try {
           const result = await window.electronAPI.db.deleteNote(noteId);
           if (result.success) {
               PlayerState.notes = PlayerState.notes.filter(n => n.id !== noteId);
               this.displayNotes();
               showSuccess('Note supprimée');
           }
       } catch (error) {
           console.error('[Player] Erreur lors de la suppression de la note:', error);
           showError('Impossible de supprimer la note');
       }
   },
   
   // Ajouter un signet
   async addBookmark() {
       try {
           const bookmark = {
               lesson_id: PlayerState.currentLesson.lesson_id,
               timestamp: PlayerState.currentTime,
               title: `Signet à ${this.formatTime(PlayerState.currentTime)}`,
               created_at: new Date().toISOString()
           };
           
           const result = await window.electronAPI.db.addBookmark(bookmark);
           if (result.success) {
               PlayerState.bookmarks.push({ ...bookmark, id: result.bookmarkId });
               this.displayBookmarks();
               showSuccess('Signet ajouté');
               
               // Animation visuelle
               this.showBookmarkAnimation();
           }
       } catch (error) {
           console.error('[Player] Erreur lors de l\'ajout du signet:', error);
           showError('Impossible d\'ajouter le signet');
       }
   },
   
   // Charger les signets
   async loadBookmarks() {
       try {
           if (window.electronAPI.db.getBookmarks) {
               const result = await window.electronAPI.db.getBookmarks(PlayerState.currentLesson.lesson_id);
               if (result.success) {
                   PlayerState.bookmarks = result.bookmarks;
                   this.displayBookmarks();
               }
           } else {
               console.log('[Player] Méthode getBookmarks non disponible');
               PlayerState.bookmarks = [];
               this.displayBookmarks();
           }
       } catch (error) {
           console.error('[Player] Erreur lors du chargement des signets:', error);
           PlayerState.bookmarks = [];
           this.displayBookmarks();
       }
   },
   
   // Afficher les signets sur la timeline
   displayBookmarks() {
       const segmentsContainer = document.getElementById('progress-segments');
       if (!segmentsContainer || !PlayerState.duration) return;
       
       // Nettoyer les anciens signets
       segmentsContainer.querySelectorAll('.bookmark-marker').forEach(el => el.remove());
       
       // Ajouter les nouveaux signets
       PlayerState.bookmarks.forEach(bookmark => {
           const position = (bookmark.timestamp / PlayerState.duration) * 100;
           const marker = document.createElement('div');
           marker.className = 'bookmark-marker';
           marker.style.left = `${position}%`;
           marker.title = bookmark.title;
           marker.onclick = () => this.seekTo(bookmark.timestamp);
           segmentsContainer.appendChild(marker);
       });
   },
   
   // ==================== RESSOURCES ====================
   
   // Charger les ressources
   async loadResources() {
       try {
           if (window.electronAPI.db.getLessonResources) {
               const result = await window.electronAPI.db.getLessonResources(PlayerState.currentLesson.lesson_id);
               if (result.success) {
                   this.displayResources(result.resources);
               }
           } else {
               console.log('[Player] Méthode getLessonResources non disponible');
               this.displayResources([]);
           }
       } catch (error) {
           console.error('[Player] Erreur lors du chargement des ressources:', error);
           this.displayResources([]);
       }
   },
   
   // Afficher les ressources
   displayResources(resources) {
       const resourcesList = document.getElementById('resources-list');
       if (!resourcesList) return;
       
       if (!resources || resources.length === 0) {
           resourcesList.innerHTML = '<p class="empty-message">Aucune ressource pour cette leçon</p>';
           return;
       }
       
       resourcesList.innerHTML = resources.map(resource => `
           <div class="resource-item">
               <div class="resource-icon">${this.getResourceIcon(resource.type)}</div>
               <div class="resource-info">
                   <div class="resource-title">${this.escapeHtml(resource.title)}</div>
                   <div class="resource-meta">${this.formatFileSize(resource.size)} • ${resource.type}</div>
               </div>
               <button class="btn btn-sm" onclick="playerManager.downloadResource(${resource.id})">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                   </svg>
               </button>
           </div>
       `).join('');
   },
   
   // Télécharger une ressource
   async downloadResource(resourceId) {
       try {
           const result = await window.electronAPI.download.downloadResource(resourceId);
           if (result.success) {
               showSuccess('Téléchargement démarré');
           }
       } catch (error) {
           console.error('[Player] Erreur lors du téléchargement:', error);
           showError('Impossible de télécharger la ressource');
       }
   },
   
   // ==================== TRANSCRIPTION ====================
   
   // Charger la transcription
   async loadTranscript() {
       if (!PlayerState.currentLesson.transcript_path) {
           this.displayTranscript(null);
           return;
       }
       
       try {
           if (window.electronAPI.file && window.electronAPI.file.readFile) {
               const result = await window.electronAPI.file.readFile(PlayerState.currentLesson.transcript_path);
               if (result.success) {
                   const transcript = JSON.parse(result.content);
                   this.displayTranscript(transcript);
               }
           } else {
               console.log('[Player] Méthode readFile non disponible');
               this.displayTranscript(null);
           }
       } catch (error) {
           console.error('[Player] Erreur lors du chargement de la transcription:', error);
           this.displayTranscript(null);
       }
   },
   
   // Afficher la transcription
   displayTranscript(transcript) {
       const container = document.querySelector('.transcript-content');
       if (!container) return;
       
       if (!transcript || transcript.length === 0) {
           container.innerHTML = '<p class="empty-message">Aucune transcription disponible</p>';
           return;
       }
       
       container.innerHTML = transcript.map((segment, index) => `
           <div class="transcript-segment" data-index="${index}" data-start="${segment.start}" data-end="${segment.end}">
               <span class="transcript-time" onclick="playerManager.seekTo(${segment.start})">
                   ${this.formatTime(segment.start)}
               </span>
               <span class="transcript-text">${this.escapeHtml(segment.text)}</span>
           </div>
       `).join('');
       
       // Stocker la transcription
       PlayerState.transcript = transcript;
   },
   
   // Mettre à jour la transcription active
   updateActiveTranscript(currentTime) {
       if (!PlayerState.transcript) return;
       
       document.querySelectorAll('.transcript-segment').forEach(segment => {
           const start = parseFloat(segment.dataset.start);
           const end = parseFloat(segment.dataset.end);
           const isActive = currentTime >= start && currentTime <= end;
           
           segment.classList.toggle('active', isActive);
           
           if (isActive) {
               segment.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }
       });
   },
   
   // ==================== PROGRESSION ET ANALYTICS ====================
   
   // Enregistrer les segments regardés
   recordWatchedSegment(currentTime) {
       const segmentSize = 5; // Segments de 5 secondes
       const segmentIndex = Math.floor(currentTime / segmentSize);
       
       if (!PlayerState.watchedSegments.includes(segmentIndex)) {
           PlayerState.watchedSegments.push(segmentIndex);
           this.updateWatchedProgress();
       }
   },
   
   // Mettre à jour la progression regardée
   updateWatchedProgress() {
       if (!PlayerState.duration) return;
       
       const segmentSize = 5;
       const totalSegments = Math.ceil(PlayerState.duration / segmentSize);
       const watchedPercent = (PlayerState.watchedSegments.length / totalSegments) * 100;
       
       // Vérifier si la leçon est complétée
       if (watchedPercent >= PlayerState.completionThreshold * 100) {
           this.markLessonAsCompleted();
       }
   },
   
   // Afficher les segments regardés
   displayWatchedSegments() {
       const segmentsContainer = document.getElementById('progress-segments');
       if (!segmentsContainer || !PlayerState.duration) return;
       
       // Nettoyer
       segmentsContainer.querySelectorAll('.watched-segment').forEach(el => el.remove());
       
       // Ajouter les segments regardés
       const segmentSize = 5;
       PlayerState.watchedSegments.forEach(index => {
           const start = (index * segmentSize / PlayerState.duration) * 100;
           const width = (segmentSize / PlayerState.duration) * 100;
           
           const segment = document.createElement('div');
           segment.className = 'watched-segment';
           segment.style.left = `${start}%`;
           segment.style.width = `${width}%`;
           segmentsContainer.appendChild(segment);
       });
   },
   
   // Charger les segments regardés
   async loadWatchedSegments() {
       try {
           if (window.electronAPI.db.getLessonProgress) {
               const result = await window.electronAPI.db.getLessonProgress(PlayerState.currentLesson.lesson_id);
               if (result.success && result.progress?.watched_segments) {
                   PlayerState.watchedSegments = result.progress.watched_segments;
                   this.displayWatchedSegments();
               }
           } else {
               console.log('[Player] Méthode getLessonProgress non disponible');
           }
       } catch (error) {
           console.error('[Player] Erreur lors du chargement de la progression:', error);
       }
   },
   
   // Sauvegarder la progression
   async saveProgress() {
       if (!PlayerState.currentLesson) return;
       
       try {
           const progress = {
               lesson_id: PlayerState.currentLesson.lesson_id,
               course_id: PlayerState.currentCourse.course_id,
               last_position: PlayerState.currentTime,
               watched_segments: PlayerState.watchedSegments,
               updated_at: new Date().toISOString()
           };
           
           if (window.electronAPI.db.updateLessonProgress) {
               await window.electronAPI.db.updateLessonProgress(progress);
           }
           
           // Mettre à jour la progression du cours
           if (window.electronAPI.db.updateCourseProgress) {
               await window.electronAPI.db.updateCourseProgress({
                   course_id: PlayerState.currentCourse.course_id,
                   last_lesson_id: PlayerState.currentLesson.lesson_id,
                   last_accessed: new Date().toISOString()
               });
           }
           
       } catch (error) {
           console.error('[Player] Erreur lors de la sauvegarde de la progression:', error);
       }
   },

   // Marquer la leçon comme vue
   async markLessonAsViewed(lessonId) {
       try {
           if (window.electronAPI.db.markLessonAsViewed) {
               await window.electronAPI.db.markLessonAsViewed(lessonId);
           } else {
               console.log('[Player] Méthode markLessonAsViewed non disponible');
           }
       } catch (error) {
           console.error('[Player] Erreur lors du marquage de la leçon:', error);
       }
   },
   
   // Marquer la leçon comme complétée
   async markLessonAsCompleted() {
       if (PlayerState.currentLesson.completed) return;
       
       try {
           if (window.electronAPI.db.markLessonAsCompleted) {
               await window.electronAPI.db.markLessonAsCompleted(PlayerState.currentLesson.lesson_id);
           }
           
           PlayerState.currentLesson.completed = true;
           
           // Mettre à jour la navigation
           this.buildNavigation();
           
           // Afficher une notification
           showSuccess('Leçon complétée !');
           
           // Analytics
           this.trackEvent('lesson_completed', {
               lessonId: PlayerState.currentLesson.lesson_id,
               duration: PlayerState.duration,
               watchTime: PlayerState.currentTime
           });
           
       } catch (error) {
           console.error('[Player] Erreur lors du marquage de completion:', error);
       }
   },
   
   // Mettre à jour la progression du cours
   updateCourseProgress(completed, total) {
       const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
       
       // Mettre à jour l'affichage si nécessaire
       const progressElement = document.getElementById('course-progress');
       if (progressElement) {
           progressElement.textContent = `${percent}% complété (${completed}/${total} leçons)`;
       }
   },
   
   // Analytics
   trackEvent(eventName, data) {
       try {
           // Vérifier que l'API analytics existe avant de l'utiliser
           if (window.electronAPI && window.electronAPI.analytics && window.electronAPI.analytics.track) {
               window.electronAPI.analytics.track(eventName, {
                   ...data,
                   courseId: PlayerState.currentCourse.course_id,
                   timestamp: new Date().toISOString()
               });
           } else {
               // Log en console si l'API n'est pas disponible
               console.log('[Player] Analytics event:', eventName, data);
           }
       } catch (error) {
           console.error('[Player] Erreur analytics:', error);
       }
   },
   
   // ==================== UI ET CONTRÔLES ====================
   
   // Gestion de la barre de progression
   handleProgressSeek(e) {
       const progressBar = e.currentTarget;
       const rect = progressBar.getBoundingClientRect();
       const percent = (e.clientX - rect.left) / rect.width;
       const time = percent * PlayerState.duration;
       
       this.seekTo(time);
   },
   
   // Survol de la barre de progression
   handleProgressHover(e) {
       const progressBar = e.currentTarget;
       const rect = progressBar.getBoundingClientRect();
       const percent = (e.clientX - rect.left) / rect.width;
       const time = percent * PlayerState.duration;
       
       this.showProgressTooltip(e.clientX, time);
   },
   
   // Afficher le tooltip de progression
   showProgressTooltip(x, time) {
       const tooltip = document.getElementById('progress-tooltip');
       if (!tooltip) return;
       
       tooltip.style.left = `${x}px`;
       tooltip.classList.add('visible');
       tooltip.querySelector('.tooltip-time').textContent = this.formatTime(time);
       
       // TODO: Ajouter la prévisualisation vidéo
   },
   
   // Masquer le tooltip
   hideProgressTooltip() {
       document.getElementById('progress-tooltip')?.classList.remove('visible');
   },
   
   // Aller à un timestamp
   seekTo(time) {
       if (!PlayerState.videoElement) return;
       PlayerState.videoElement.currentTime = Math.max(0, Math.min(time, PlayerState.duration));
   },
   
   // Preview seek (pour les gestes)
   previewSeek(time) {
       PlayerState.seekTime = time;
       PlayerState.seekPreview = true;
       // TODO: Afficher la preview
   },
   
   // Appliquer le seek preview
   applySeekPreview() {
       if (PlayerState.seekPreview) {
           this.seekTo(PlayerState.seekTime);
           PlayerState.seekPreview = false;
       }
   },
   
   // Afficher/masquer les contrôles
   showControls() {
       PlayerState.controlsVisible = true;
       document.getElementById('video-controls')?.classList.remove('hidden');
   },
   
   hideControls() {
       PlayerState.controlsVisible = false;
       document.getElementById('video-controls')?.classList.add('hidden');
   },
   
   // Vérifier si un menu est ouvert
   isMenuOpen() {
       return !document.getElementById('speed-menu')?.classList.contains('hidden') ||
              !document.getElementById('quality-menu')?.classList.contains('hidden');
   },
   
   // Toggle speed menu
   toggleSpeedMenu() {
       const menu = document.getElementById('speed-menu');
       menu?.classList.toggle('hidden');
       
       // Fermer les autres menus
       document.getElementById('quality-menu')?.classList.add('hidden');
   },
   
   // Toggle quality menu
   toggleQualityMenu() {
       const menu = document.getElementById('quality-menu');
       menu?.classList.toggle('hidden');
       
       // Fermer les autres menus
       document.getElementById('speed-menu')?.classList.add('hidden');
   },
   
   // Toggle subtitles
   toggleSubtitles() {
       PlayerState.subtitlesEnabled = !PlayerState.subtitlesEnabled;
       
       const tracks = PlayerState.videoElement?.textTracks;
       if (tracks && tracks.length > 0) {
           tracks[0].mode = PlayerState.subtitlesEnabled ? 'showing' : 'hidden';
       }
       
       // Sauvegarder la préférence
       localStorage.setItem('player_subtitles', PlayerState.subtitlesEnabled);
       
       // Mettre à jour l'icône
       document.getElementById('subtitles-btn')?.classList.toggle('active', PlayerState.subtitlesEnabled);
   },
   
   // Afficher l'indicateur de seek
   showSeekIndicator(direction) {
       const indicator = document.getElementById(`seek-${direction}`);
       if (!indicator) return;
       
       indicator.classList.add('show');
       setTimeout(() => {
           indicator.classList.remove('show');
       }, 500);
   },
   
   // Animation de signet
   showBookmarkAnimation() {
       // TODO: Implémenter une animation visuelle
   },
   
   // Afficher le loader
   showLoading() {
       document.getElementById('loading-spinner')?.classList.add('visible');
   },
   
   hideLoading() {
       document.getElementById('loading-spinner')?.classList.remove('visible');
   },
   
   // Mettre à jour les icônes
   updatePlayPauseIcon() {
       const playIcon = document.querySelector('.play-icon');
       const pauseIcon = document.querySelector('.pause-icon');
       
       if (PlayerState.isPlaying) {
           playIcon?.classList.add('hidden');
           pauseIcon?.classList.remove('hidden');
       } else {
           playIcon?.classList.remove('hidden');
           pauseIcon?.classList.add('hidden');
       }
   },
   
   updateVolumeIcon() {
       const volumeHigh = document.querySelector('.volume-high');
       const volumeLow = document.querySelector('.volume-low');
       const volumeMuted = document.querySelector('.volume-muted');
       
       volumeHigh?.classList.add('hidden');
       volumeLow?.classList.add('hidden');
       volumeMuted?.classList.add('hidden');
       
       if (PlayerState.isMuted || PlayerState.volume === 0) {
           volumeMuted?.classList.remove('hidden');
       } else if (PlayerState.volume < 0.5) {
           volumeLow?.classList.remove('hidden');
       } else {
           volumeHigh?.classList.remove('hidden');
       }
   },
   
   updateFullscreenIcon() {
       const fullscreenIcon = document.querySelector('.fullscreen-icon');
       const exitFullscreenIcon = document.querySelector('.exit-fullscreen-icon');
       
       if (PlayerState.isFullscreen) {
           fullscreenIcon?.classList.add('hidden');
           exitFullscreenIcon?.classList.remove('hidden');
       } else {
           fullscreenIcon?.classList.remove('hidden');
           exitFullscreenIcon?.classList.add('hidden');
       }
   },
   
   // Mettre à jour les contrôles pour un document
   updateControlsForDocument() {
       // Masquer les contrôles non pertinents
       document.getElementById('play-pause-btn')?.classList.add('hidden');
       document.querySelector('.progress-container')?.classList.add('hidden');
       document.querySelector('.time-display')?.classList.add('hidden');
       document.querySelector('.speed-control')?.classList.add('hidden');
   },
   
   // Mettre à jour les infos du cours
   updateCourseInfo() {
       // Vérifier que l'élément existe
       const courseNameElement = document.getElementById('player-course-name');
       if (courseNameElement && PlayerState.currentCourse) {
           courseNameElement.textContent = PlayerState.currentCourse.title;
       } else {
           console.warn('[Player] Élément player-course-name non trouvé ou cours non chargé');
       }
   },
   
   // Mettre à jour les infos de la leçon
   updateLessonInfo() {
       const lessonNameElement = document.getElementById('player-lesson-name');
       const sectionNameElement = document.getElementById('player-section-name');
       
       if (lessonNameElement && PlayerState.currentLesson) {
           lessonNameElement.textContent = PlayerState.currentLesson.title;
       }
       
       if (sectionNameElement && PlayerState.currentSection) {
           sectionNameElement.textContent = PlayerState.currentSection.title || '';
       }
   },
   
   // Changer d'onglet dans la sidebar
   switchTab(tabName) {
       // Mettre à jour les boutons
       document.querySelectorAll('.tab-btn').forEach(btn => {
           btn.classList.toggle('active', btn.dataset.tab === tabName);
       });
       
       // Mettre à jour le contenu
       document.querySelectorAll('.tab-content').forEach(content => {
           content.classList.toggle('active', content.id === `tab-${tabName}`);
       });
   },
   
   // Changer d'onglet de contenu
   switchContentTab(tabName) {
       // Mettre à jour les boutons
       document.querySelectorAll('.content-tab').forEach(btn => {
           btn.classList.toggle('active', btn.dataset.content === tabName);
       });
       
       // Mettre à jour le contenu
       document.querySelectorAll('.content-panel').forEach(panel => {
           panel.classList.toggle('active', panel.id === `content-${tabName}`);
       });
   },
   
   // Afficher la page du player
showPlayerPage() {
    console.log('[Player] Affichage de la page du player');
    
    // Masquer TOUTES les pages d'abord
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
        page.classList.add('hidden');
    });
    
    // S'assurer que la page du player existe
    let playerPage = document.getElementById('player-page');
    if (!playerPage) {
        console.log('[Player] Page du player n\'existe pas, création...');
        this.createPlayerUI();
        playerPage = document.getElementById('player-page');
    }
    
    if (playerPage) {
        // Afficher SEULEMENT la page du player
        playerPage.classList.remove('hidden');
        playerPage.classList.add('active');
        
        // NE PAS forcer les styles inline agressifs
        // Juste s'assurer que les éléments de base sont visibles
        const videoWrapper = document.getElementById('video-wrapper');
        if (videoWrapper) {
            videoWrapper.style.display = '';
            videoWrapper.style.visibility = '';
            videoWrapper.style.opacity = '';
        }
        
        console.log('[Player] Page affichée avec succès');
    }
    
    // Réinitialiser après un court délai
    setTimeout(() => {
        this.initializeElements();
        this.attachEventListeners();
    }, 100);
},

    // Créer un player d'urgence ultra-simple
    createEmergencyPlayer() {
        console.log('[Player] Création d\'un player d\'urgence');
        
        const emergencyHTML = `
        <div id="player-page" class="page">
            <div class="player-emergency">
                <div class="player-header-emergency">
                    <button onclick="playerManager.exitPlayer()" class="btn btn-secondary">
                        ← Retour aux cours
                    </button>
                    <h2>Lecteur de cours</h2>
                </div>
                <div id="player-content" class="player-content-emergency">
                    <div id="video-wrapper" class="video-wrapper-emergency">
                        <video id="course-video" controls style="width: 100%; max-width: 900px;">
                            Votre navigateur ne supporte pas la lecture vidéo.
                        </video>
                        <div id="document-viewer" class="hidden" style="width: 100%; height: 600px;"></div>
                        <div id="error-overlay" class="error-overlay hidden">
                            <div class="error-content">
                                <h3>Impossible de charger le média</h3>
                                <p id="error-message">Le contenu de cette leçon n'a pas pu être chargé.</p>
                                <button onclick="playerManager.retryLoad()" class="btn btn-primary">
                                    Réessayer
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="lesson-info-emergency">
                        <h3 id="player-lesson-name">Chargement...</h3>
                        <div id="lesson-content-fallback"></div>
                    </div>
                </div>
            </div>
        </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', emergencyHTML);
        
        // Ajouter des styles minimaux
        this.addEmergencyStyles();
    },
    
    // Créer les éléments manquants
    createMissingElements() {
        console.log('[Player] Tentative de création des éléments manquants');
        
        const playerContent = document.getElementById('player-content');
        if (!playerContent) {
            console.error('[Player] player-content introuvable, impossible de créer les éléments');
            return;
        }
        
        // Vérifier et créer video-wrapper
        let videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper) {
            console.log('[Player] Création de video-wrapper');
            videoWrapper = document.createElement('div');
            videoWrapper.id = 'video-wrapper';
            videoWrapper.className = 'video-wrapper';
            playerContent.insertBefore(videoWrapper, playerContent.firstChild);
        }
        
        // Vérifier et créer course-video
        let courseVideo = document.getElementById('course-video');
        if (!courseVideo) {
            console.log('[Player] Création de course-video');
            courseVideo = document.createElement('video');
            courseVideo.id = 'course-video';
            courseVideo.className = 'video-player';
            courseVideo.setAttribute('controls', '');
            courseVideo.setAttribute('preload', 'metadata');
            videoWrapper.appendChild(courseVideo);
        }
        
        // Créer aussi les autres éléments essentiels
        if (!document.getElementById('loading-spinner')) {
            const loadingSpinner = document.createElement('div');
            loadingSpinner.id = 'loading-spinner';
            loadingSpinner.className = 'loading-spinner';
            loadingSpinner.innerHTML = '<div class="spinner"></div>';
            videoWrapper.appendChild(loadingSpinner);
        }
        
        console.log('[Player] Éléments créés/vérifiés');
    },
    
    // Ajouter des styles d'urgence
    addEmergencyStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .player-emergency {
                height: 100vh;
                display: flex;
                flex-direction: column;
                background: #f5f5f5;
            }
            .player-header-emergency {
                padding: 20px;
                background: white;
                border-bottom: 1px solid #ddd;
                display: flex;
                align-items: center;
                gap: 20px;
            }
            .player-content-emergency {
                flex: 1;
                padding: 20px;
                overflow-y: auto;
            }
            .video-wrapper-emergency {
                background: black;
                min-height: 400px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                margin-bottom: 20px;
            }
            .lesson-info-emergency {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .error-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
            }
            .error-overlay.hidden {
                display: none;
            }
            .error-content {
                background: white;
                padding: 30px;
                border-radius: 8px;
                text-align: center;
                max-width: 400px;
            }
            .error-content h3 {
                margin: 0 0 10px;
                color: #e74c3c;
            }
            .error-content p {
                margin: 0 0 20px;
                color: #666;
            }
        `;
        document.head.appendChild(style);
    },
    
    // Fonction pour réessayer le chargement
    retryLoad() {
        console.log('[Player] Nouvelle tentative de chargement');
        const errorOverlay = document.getElementById('error-overlay');
        if (errorOverlay) {
            errorOverlay.classList.add('hidden');
        }
        
        if (PlayerState.currentLesson) {
            this.loadLesson(PlayerState.currentLesson.lesson_id);
        }
    },
   
   // Afficher l'écran de fin de cours
   showCourseCompletion() {
       // TODO: Implémenter un écran de félicitations avec statistiques
   },
   
   // Charger les paramètres sauvegardés
   loadSavedSettings() {
       // Volume
       const savedVolume = localStorage.getItem('player_volume');
       if (savedVolume !== null) {
           PlayerState.volume = parseFloat(savedVolume);
       }
       
       // Vitesse
       const savedRate = localStorage.getItem('player_rate');
       if (savedRate !== null) {
           PlayerState.playbackRate = parseFloat(savedRate);
       }
       
       // Sous-titres
       const savedSubtitles = localStorage.getItem('player_subtitles');
       if (savedSubtitles !== null) {
           PlayerState.subtitlesEnabled = savedSubtitles === 'true';
       }
       
       // Autoplay
       const savedAutoplay = localStorage.getItem('player_autoplay');
       if (savedAutoplay !== null) {
           PlayerState.autoplay = savedAutoplay !== 'false';
       }
       
       // Qualité
       const savedQuality = localStorage.getItem('player_quality');
       if (savedQuality !== null) {
           PlayerState.quality = savedQuality;
       }
   },
   
   // Quitter le player
async exitPlayer() {
    // Sauvegarder la progression
    await this.saveProgress();
    
    // Calculer le temps de visionnage
    if (PlayerState.sessionStartTime) {
        const watchTime = Date.now() - PlayerState.sessionStartTime;
        PlayerState.totalWatchTime += watchTime;
        
        // Analytics
        this.trackEvent('session_ended', {
            watchTime: Math.round(watchTime / 1000),
            totalWatchTime: Math.round(PlayerState.totalWatchTime / 1000)
        });
    }
    
    // Pause la vidéo
    if (PlayerState.videoElement && !PlayerState.videoElement.paused) {
        PlayerState.videoElement.pause();
    }
    
    // IMPORTANT : Masquer correctement le player
    const playerPage = document.getElementById('player-page');
    if (playerPage) {
        playerPage.classList.remove('active');
        playerPage.classList.add('hidden');
    }
    
    // Afficher le dashboard
    const dashboardPage = document.getElementById('dashboard-page');
    if (dashboardPage) {
        dashboardPage.classList.remove('hidden');
        dashboardPage.classList.add('active');
    }
    
    // Recharger les cours si nécessaire
    if (window.loadCourses) {
        window.loadCourses();
    }
},
   
   // ==================== HELPERS ====================
   
   // Formater le temps
   formatTime(seconds) {
       if (!seconds || isNaN(seconds)) return '00:00';
       
       const hours = Math.floor(seconds / 3600);
       const minutes = Math.floor((seconds % 3600) / 60);
       const secs = Math.floor(seconds % 60);
       
       if (hours > 0) {
           return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
       }
       return `${minutes}:${secs.toString().padStart(2, '0')}`;
   },
   
   // Formater la taille de fichier
   formatFileSize(bytes) {
       if (bytes === 0) return '0 B';
       const k = 1024;
       const sizes = ['B', 'KB', 'MB', 'GB'];
       const i = Math.floor(Math.log(bytes) / Math.log(k));
       return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
   },
   
   // Échapper le HTML
   escapeHtml(text) {
       if (!text) return '';
       const div = document.createElement('div');
       div.textContent = text;
       return div.innerHTML;
   },
   
   // Obtenir l'icône de la leçon
   getLessonIcon(type) {
       const icons = {
           video: '🎥',
           document: '📄',
           quiz: '❓',
           exercise: '💻',
           audio: '🎵',
           presentation: '📊'
       };
       return icons[type] || '📚';
   },
   
   // Obtenir l'icône de ressource
   getResourceIcon(type) {
       const icons = {
           pdf: '📕',
           zip: '📦',
           code: '💻',
           image: '🖼️',
           excel: '📊',
           word: '📝',
           powerpoint: '📊'
       };
       
       const ext = type.toLowerCase();
       if (ext === 'pdf') return icons.pdf;
       if (ext === 'zip' || ext === 'rar') return icons.zip;
       if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return icons.image;
       if (['xls', 'xlsx'].includes(ext)) return icons.excel;
       if (['doc', 'docx'].includes(ext)) return icons.word;
       if (['ppt', 'pptx'].includes(ext)) return icons.powerpoint;
       if (['js', 'py', 'html', 'css', 'java', 'cpp'].includes(ext)) return icons.code;
       
       return '📎';
   },
   
   // Obtenir l'icône pour les fichiers
   getFileIcon(filename) {
       if (!filename) return '📎';
       const ext = filename.split('.').pop().toLowerCase();
       return this.getResourceIcon(ext);
   }
};

// ==================== FONCTIONS GLOBALES ====================

// Helpers globaux si non disponibles
if (!window.showLoader) {
   window.showLoader = function(message) {
       console.log('[Loader]', message);
   };
}

if (!window.hideLoader) {
   window.hideLoader = function() {
       console.log('[Loader] Hidden');
   };
}

if (!window.showError) {
   window.showError = function(message) {
       console.error('[Error]', message);
       alert(message);
   };
}

if (!window.showSuccess) {
   window.showSuccess = function(message) {
       console.log('[Success]', message);
   };
}

if (!window.showInfo) {
   window.showInfo = function(message) {
       console.info('[Info]', message);
   };
}

// Exposer le gestionnaire globalement
window.playerManager = playerManager;

// Initialiser au chargement
document.addEventListener('DOMContentLoaded', () => {
   playerManager.init();
});

// ==================== STYLES CSS ====================

const playerStyles = `
<style>
/* Variables du thème */
:root {
   --player-bg: #000;
   --player-controls-bg: rgba(0, 0, 0, 0.9);
   --player-text: #fff;
   --player-hover: rgba(255, 255, 255, 0.1);
   --player-active: var(--primary-color, #007bff);
   --player-progress: var(--primary-color, #007bff);
   --player-buffered: rgba(255, 255, 255, 0.3);
}

/* Wrapper principal */
.player-wrapper {
   height: 100vh;
   display: flex;
   flex-direction: column;
   background: var(--bg-primary);
   overflow: hidden;
}

/* Header du player */
.player-header {
   display: flex;
   align-items: center;
   padding: 12px 20px;
   background: var(--bg-secondary);
   border-bottom: 1px solid var(--border-color);
   gap: 16px;
   z-index: 100;
}

.player-breadcrumb {
   flex: 1;
   display: flex;
   align-items: center;
   gap: 8px;
   font-size: 14px;
   color: var(--text-secondary);
   overflow: hidden;
}

.player-breadcrumb span {
   white-space: nowrap;
   overflow: hidden;
   text-overflow: ellipsis;
}

.player-breadcrumb .separator {
   color: var(--text-muted);
   flex-shrink: 0;
}

.player-header-actions {
   display: flex;
   gap: 8px;
}

/* Layout principal */
.player-main {
   flex: 1;
   display: flex;
   overflow: hidden;
}

/* Sidebar */
.player-sidebar {
   width: 320px;
   background: var(--bg-secondary);
   border-right: 1px solid var(--border-color);
   display: flex;
   flex-direction: column;
   transition: width 0.3s;
}

.player-sidebar.collapsed {
   width: 0;
}

.sidebar-tabs {
   display: flex;
   border-bottom: 1px solid var(--border-color);
}

.tab-btn {
   flex: 1;
   padding: 12px;
   background: transparent;
   border: none;
   color: var(--text-secondary);
   font-size: 13px;
   cursor: pointer;
   display: flex;
   align-items: center;
   justify-content: center;
   gap: 6px;
   transition: all 0.2s;
}

.tab-btn:hover {
   background: var(--bg-hover);
}

.tab-btn.active {
   color: var(--primary-color);
   border-bottom: 2px solid var(--primary-color);
}

.tab-btn svg {
   width: 16px;
   height: 16px;
}

.sidebar-content {
   flex: 1;
   overflow-y: auto;
}

.tab-content {
   display: none;
   height: 100%;
}

.tab-content.active {
   display: block;
}

/* Navigation du cours */
.course-navigation {
   padding: 16px;
}

.nav-section {
   margin-bottom: 20px;
}

.section-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
   margin-bottom: 12px;
   padding: 0 8px;
}

.section-header h3 {
   font-size: 14px;
   font-weight: 600;
   margin: 0;
   color: var(--text-primary);
}

.section-progress {
   font-size: 12px;
   color: var(--text-muted);
}

.nav-lesson {
   display: flex;
   align-items: center;
   padding: 10px 8px;
   margin: 0 -8px;
   border-radius: 6px;
   cursor: pointer;
   transition: all 0.2s;
   gap: 10px;
}

.nav-lesson:hover {
   background: var(--bg-hover);
}

.nav-lesson.active {
   background: var(--primary-color);
   color: white;
}

.nav-lesson.completed {
   opacity: 0.8;
}

.lesson-number {
   width: 24px;
   height: 24px;
   background: var(--bg-tertiary);
   border-radius: 50%;
   display: flex;
   align-items: center;
   justify-content: center;
   font-size: 12px;
   font-weight: 500;
   flex-shrink: 0;
}

.nav-lesson.active .lesson-number {
   background: rgba(255, 255, 255, 0.2);
}

.lesson-icon {
   font-size: 16px;
   flex-shrink: 0;
}

.lesson-info {
   flex: 1;
   min-width: 0;
}

.lesson-title {
   font-size: 13px;
   font-weight: 500;
   white-space: nowrap;
   overflow: hidden;
   text-overflow: ellipsis;
}

.lesson-duration {
   font-size: 11px;
   opacity: 0.7;
   margin-top: 2px;
}

.lesson-check {
   color: var(--success-color);
   font-size: 16px;
   flex-shrink: 0;
}

/* Notes */
.notes-container {
   padding: 16px;
}

.notes-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
   margin-bottom: 16px;
}

.notes-header h3 {
   font-size: 16px;
   margin: 0;
}

.notes-list {
   display: flex;
   flex-direction: column;
   gap: 12px;
}

.note-item {
   background: var(--bg-primary);
   padding: 12px;
   border-radius: 6px;
   border: 1px solid var(--border-color);
}

.note-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
   margin-bottom: 8px;
}

.note-timestamp {
   color: var(--primary-color);
   font-size: 12px;
   font-weight: 500;
   cursor: pointer;
}

.note-timestamp:hover {
   text-decoration: underline;
}

.note-text {
   font-size: 13px;
   line-height: 1.5;
}

/* Resources */
.resources-list {
   padding: 16px;
   display: flex;
   flex-direction: column;
   gap: 12px;
}

.resource-item {
   display: flex;
   align-items: center;
   gap: 12px;
   padding: 12px;
   background: var(--bg-primary);
   border: 1px solid var(--border-color);
   border-radius: 6px;
}

.resource-icon {
   font-size: 24px;
   flex-shrink: 0;
}

.resource-info {
   flex: 1;
}
   .resource-title {
   font-size: 14px;
   font-weight: 500;
   margin-bottom: 4px;
}

.resource-meta {
   font-size: 12px;
   color: var(--text-secondary);
}

/* Contenu principal */
.player-content {
   flex: 1;
   display: flex;
   flex-direction: column;
   background: var(--bg-primary);
}

/* Video wrapper */
.video-wrapper {
   flex: 1;
   position: relative;
   background: var(--player-bg);
   overflow: hidden;
}

/* Video overlay */
.video-overlay {
   position: absolute;
   top: 0;
   left: 0;
   right: 0;
   bottom: 0;
   z-index: 1;
   cursor: pointer;
}

/* Loading spinner */
.loading-spinner {
   position: absolute;
   top: 50%;
   left: 50%;
   transform: translate(-50%, -50%);
   display: none;
}

.loading-spinner.visible {
   display: block;
}

.spinner {
   width: 50px;
   height: 50px;
   border: 3px solid rgba(255, 255, 255, 0.2);
   border-top-color: white;
   border-radius: 50%;
   animation: spin 0.8s linear infinite;
}

@keyframes spin {
   to { transform: rotate(360deg); }
}

/* Center play button */
.center-play-button {
   position: absolute;
   top: 50%;
   left: 50%;
   transform: translate(-50%, -50%);
   background: rgba(0, 0, 0, 0.7);
   border-radius: 50%;
   padding: 20px;
   transition: all 0.2s;
   cursor: pointer;
}

.center-play-button:hover {
   background: rgba(0, 0, 0, 0.9);
   transform: translate(-50%, -50%) scale(1.1);
}

.center-play-button.hidden {
   display: none;
}

/* Seek indicators */
.seek-indicator {
   position: absolute;
   top: 50%;
   transform: translateY(-50%);
   background: rgba(0, 0, 0, 0.7);
   color: white;
   padding: 10px;
   border-radius: 8px;
   display: flex;
   flex-direction: column;
   align-items: center;
   opacity: 0;
   transition: opacity 0.2s;
   pointer-events: none;
}

.seek-indicator.left {
   left: 20px;
}

.seek-indicator.right {
   right: 20px;
}

.seek-indicator.show {
   opacity: 1;
}

.seek-indicator span {
   font-size: 14px;
   margin-top: 4px;
}

/* Video player */
.video-player {
   width: 100%;
   height: 100%;
   object-fit: contain;
}

/* Document viewer */
.document-viewer {
   width: 100%;
   height: 100%;
   border: none;
   background: white;
}

/* Conteneurs de contenu alternatif */
.text-content-container,
.no-media-message,
.attachments-container {
   position: absolute;
   top: 0;
   left: 0;
   right: 0;
   bottom: 0;
   padding: 40px;
   overflow-y: auto;
   background: var(--bg-primary);
}

.text-content-container {
   background: white;
   color: #333;
}

.lesson-content-wrapper {
   max-width: 800px;
   margin: 0 auto;
   line-height: 1.6;
}

.no-media-message {
   display: flex;
   align-items: center;
   justify-content: center;
   text-align: center;
   color: var(--text-secondary);
}

.empty-media-content {
   max-width: 400px;
}

.empty-media-content h3 {
   margin: 20px 0 10px;
   color: var(--text-primary);
}

.info-text {
   font-size: 14px;
   margin-top: 20px;
   opacity: 0.8;
}

.attachments-wrapper {
   max-width: 800px;
   margin: 0 auto;
}

.attachments-wrapper h3 {
   margin-bottom: 20px;
   color: var(--text-primary);
}

.attachments-list {
   display: grid;
   gap: 16px;
   grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

.attachment-item {
   display: flex;
   align-items: center;
   gap: 16px;
   padding: 16px;
   background: var(--bg-secondary);
   border-radius: 8px;
   border: 1px solid var(--border-color);
}

.attachment-icon {
   font-size: 32px;
   flex-shrink: 0;
}

.attachment-info {
   flex: 1;
}

.attachment-info h4 {
   margin: 0 0 4px;
   font-size: 14px;
}

.attachment-info p {
   margin: 0;
   font-size: 12px;
   color: var(--text-secondary);
}

/* Video controls */
.video-controls {
   position: absolute;
   bottom: 0;
   left: 0;
   right: 0;
   background: var(--player-controls-bg);
   color: var(--player-text);
   transition: opacity 0.3s;
   z-index: 2;
}

.video-controls.hidden {
   opacity: 0;
   pointer-events: none;
}

/* Progress container */
.progress-container {
   padding: 0 16px;
   cursor: pointer;
   position: relative;
}

.progress-bar {
   height: 4px;
   background: rgba(255, 255, 255, 0.2);
   border-radius: 2px;
   position: relative;
   transition: height 0.2s;
}

.progress-container:hover .progress-bar {
   height: 6px;
}

.progress-buffered {
   position: absolute;
   top: 0;
   left: 0;
   height: 100%;
   background: var(--player-buffered);
   border-radius: 2px;
}

.progress-played {
   position: absolute;
   top: 0;
   left: 0;
   height: 100%;
   background: var(--player-progress);
   border-radius: 2px;
   position: relative;
}

.progress-handle {
   position: absolute;
   right: -6px;
   top: 50%;
   transform: translateY(-50%);
   width: 12px;
   height: 12px;
   background: white;
   border-radius: 50%;
   opacity: 0;
   transition: opacity 0.2s;
}

.progress-container:hover .progress-handle {
   opacity: 1;
}

.progress-segments {
   position: absolute;
   top: 0;
   left: 0;
   width: 100%;
   height: 100%;
}

.watched-segment {
   position: absolute;
   height: 100%;
   background: rgba(255, 255, 255, 0.1);
}

.bookmark-marker {
   position: absolute;
   width: 4px;
   height: 12px;
   background: var(--warning-color);
   top: 50%;
   transform: translateY(-50%);
   cursor: pointer;
   transition: all 0.2s;
}

.bookmark-marker:hover {
   height: 16px;
}

/* Progress tooltip */
.progress-tooltip {
   position: absolute;
   bottom: 20px;
   background: rgba(0, 0, 0, 0.9);
   color: white;
   padding: 4px 8px;
   border-radius: 4px;
   font-size: 12px;
   pointer-events: none;
   opacity: 0;
   transition: opacity 0.2s;
}

.progress-tooltip.visible {
   opacity: 1;
}

/* Controls bar */
.controls-bar {
   display: flex;
   align-items: center;
   padding: 8px 16px;
   gap: 16px;
}

.controls-left,
.controls-right {
   display: flex;
   align-items: center;
   gap: 8px;
}

.controls-left {
   flex: 1;
}

/* Control buttons */
.control-btn {
   background: transparent;
   border: none;
   color: var(--player-text);
   cursor: pointer;
   padding: 6px;
   border-radius: 4px;
   transition: all 0.2s;
   display: flex;
   align-items: center;
   justify-content: center;
}

.control-btn:hover {
   background: var(--player-hover);
}

.control-btn.active {
   color: var(--player-active);
}

.control-btn svg {
   width: 20px;
   height: 20px;
}

/* Volume control */
.volume-control {
   display: flex;
   align-items: center;
   gap: 4px;
}

.volume-slider-container {
   width: 0;
   overflow: hidden;
   transition: width 0.3s;
}

.volume-control:hover .volume-slider-container {
   width: 80px;
}

.volume-slider {
   width: 80px;
   height: 4px;
   -webkit-appearance: none;
   appearance: none;
   background: rgba(255, 255, 255, 0.3);
   border-radius: 2px;
   outline: none;
}

.volume-slider::-webkit-slider-thumb {
   -webkit-appearance: none;
   appearance: none;
   width: 12px;
   height: 12px;
   background: white;
   border-radius: 50%;
   cursor: pointer;
}

/* Time display */
.time-display {
   font-size: 13px;
   font-family: monospace;
   white-space: nowrap;
}

.time-separator {
   margin: 0 4px;
   color: var(--text-muted);
}

/* Speed control */
.speed-control {
   position: relative;
}

#speed-text {
   font-size: 13px;
   min-width: 35px;
   text-align: center;
}

.speed-menu {
   position: absolute;
   bottom: 100%;
   left: 50%;
   transform: translateX(-50%);
   background: var(--bg-secondary);
   border: 1px solid var(--border-color);
   border-radius: 8px;
   padding: 4px;
   margin-bottom: 8px;
   box-shadow: var(--shadow-lg);
}

.speed-menu button {
   display: block;
   width: 100%;
   padding: 8px 16px;
   background: transparent;
   border: none;
   color: var(--text-primary);
   font-size: 13px;
   cursor: pointer;
   text-align: left;
   border-radius: 4px;
   transition: all 0.2s;
}

.speed-menu button:hover {
   background: var(--bg-hover);
}

.speed-menu button.active {
   background: var(--primary-color);
   color: white;
}

/* Quality control */
.quality-control {
   position: relative;
}

.quality-menu {
   position: absolute;
   bottom: 100%;
   right: 0;
   background: var(--bg-secondary);
   border: 1px solid var(--border-color);
   border-radius: 8px;
   padding: 4px;
   margin-bottom: 8px;
   box-shadow: var(--shadow-lg);
}

.quality-menu button {
   display: block;
   width: 100%;
   padding: 8px 16px;
   background: transparent;
   border: none;
   color: var(--text-primary);
   font-size: 13px;
   cursor: pointer;
   text-align: left;
   border-radius: 4px;
   transition: all 0.2s;
   white-space: nowrap;
}

.quality-menu button:hover {
   background: var(--bg-hover);
}

.quality-menu button.active {
   background: var(--primary-color);
   color: white;
}

/* Content tabs */
.content-tabs {
   background: var(--bg-secondary);
   border-top: 1px solid var(--border-color);
}

.tabs-header {
   display: flex;
   border-bottom: 1px solid var(--border-color);
}

.content-tab {
   padding: 12px 20px;
   background: transparent;
   border: none;
   color: var(--text-secondary);
   font-size: 14px;
   cursor: pointer;
   transition: all 0.2s;
   position: relative;
}

.content-tab:hover {
   background: var(--bg-hover);
}

.content-tab.active {
   color: var(--primary-color);
}

.content-tab.active::after {
   content: '';
   position: absolute;
   bottom: 0;
   left: 0;
   right: 0;
   height: 2px;
   background: var(--primary-color);
}

.tabs-content {
   height: 200px;
   overflow-y: auto;
}

.content-panel {
   display: none;
   padding: 16px;
}

.content-panel.active {
   display: block;
}

/* Transcript */
.transcript-content {
   max-width: 800px;
   margin: 0 auto;
}

.transcript-segment {
   display: flex;
   gap: 16px;
   margin-bottom: 16px;
   padding: 8px;
   border-radius: 6px;
   transition: all 0.2s;
}

.transcript-segment:hover {
   background: var(--bg-hover);
}

.transcript-segment.active {
   background: var(--bg-hover);
   border-left: 3px solid var(--primary-color);
   padding-left: 5px;
}

.transcript-time {
   color: var(--primary-color);
   font-size: 12px;
   font-weight: 500;
   cursor: pointer;
   flex-shrink: 0;
}

.transcript-time:hover {
   text-decoration: underline;
}

.transcript-text {
   font-size: 14px;
   line-height: 1.6;
}

/* Empty messages */
.empty-message {
   text-align: center;
   color: var(--text-muted);
   font-size: 14px;
   padding: 40px 20px;
}

/* Modals */
.modal {
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
   width: 90%;
   max-width: 500px;
}

.modal-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
   padding: 20px;
   border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
   margin: 0;
   font-size: 18px;
}

.modal-close {
   background: none;
   border: none;
   font-size: 24px;
   cursor: pointer;
   color: var(--text-secondary);
   width: 32px;
   height: 32px;
   display: flex;
   align-items: center;
   justify-content: center;
   border-radius: 4px;
   transition: all 0.2s;
}

.modal-close:hover {
   background: var(--bg-hover);
}

.modal-body {
   padding: 20px;
}

.modal-body textarea {
   width: 100%;
   min-height: 100px;
   padding: 12px;
   border: 1px solid var(--border-color);
   border-radius: 6px;
   background: var(--bg-secondary);
   color: var(--text-primary);
   font-size: 14px;
   resize: vertical;
}

.note-timestamp {
   margin-top: 12px;
   font-size: 13px;
   color: var(--text-secondary);
}

.modal-footer {
   display: flex;
   justify-content: flex-end;
   gap: 12px;
   padding: 20px;
   border-top: 1px solid var(--border-color);
}

/* Theater mode */
.player-wrapper.theater-mode .player-sidebar {
   width: 0;
}

.player-wrapper.theater-mode .video-wrapper {
   height: 80vh;
}

/* Mode minimal d'urgence */
.player-emergency {
   height: 100vh;
   display: flex;
   flex-direction: column;
}

/* Responsive */
@media (max-width: 768px) {
   .player-sidebar {
       position: absolute;
       top: 0;
       left: -320px;
       height: 100%;
       z-index: 10;
       transition: left 0.3s;
   }
   
   .player-sidebar.open {
       left: 0;
   }
   
   .player-breadcrumb {
       display: none;
   }
   
   .controls-bar {
       flex-wrap: wrap;
       gap: 8px;
   }
   
   .volume-control:hover .volume-slider-container {
       width: 0;
   }
   
   .time-display {
       font-size: 12px;
   }
}

/* Animations */
@keyframes fadeIn {
   from { opacity: 0; }
   to { opacity: 1; }
}

@keyframes slideIn {
   from { transform: translateY(20px); opacity: 0; }
   to { transform: translateY(0); opacity: 1; }
}

/* Utility classes */
.btn-icon {
   background: transparent;
   border: none;
   color: var(--text-primary);
   cursor: pointer;
   padding: 8px;
   border-radius: 6px;
   transition: all 0.2s;
   display: flex;
   align-items: center;
   justify-content: center;
}

.btn-icon:hover {
   background: var(--bg-hover);
}

.btn-icon.small {
   padding: 4px;
}

.btn {
   padding: 8px 16px;
   border: none;
   border-radius: 6px;
   font-size: 14px;
   font-weight: 500;
   cursor: pointer;
   transition: all 0.2s;
   display: inline-flex;
   align-items: center;
   gap: 8px;
}

.btn-primary {
   background: var(--primary-color);
   color: white;
}

.btn-primary:hover {
   opacity: 0.9;
}

.btn-secondary {
   background: var(--bg-secondary);
   color: var(--text-primary);
   border: 1px solid var(--border-color);
}

.btn-secondary:hover {
   background: var(--bg-hover);
}

.btn-sm {
   padding: 6px 12px;
   font-size: 13px;
}

.hidden {
   display: none !important;
}

/* Styles pour le player vidéo */
#video-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
}

#course-video {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
}

/* S'assurer que les overlays ne cachent pas la vidéo */
.video-overlay {
    pointer-events: none;
}

.video-overlay > * {
    pointer-events: auto;
}

/* Masquer le spinner quand la vidéo est chargée */
.loading-spinner.hidden {
    display: none !important;
}
</style>
`;

// Injecter les styles
document.head.insertAdjacentHTML('beforeend', playerStyles);

console.log('[Player] Module chargé avec succès');