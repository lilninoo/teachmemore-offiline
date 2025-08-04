// lib/api-client.js - Client API corrigé et robuste avec support des URLs sécurisées et header Referer
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const FormData = require('form-data');

class LearnPressAPIClient {
    constructor(apiUrl, deviceId) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.deviceId = deviceId;
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.refreshInProgress = false;
        this.requestQueue = [];
        
        console.log('[API] Client initialisé:', {
            apiUrl: this.apiUrl,
            deviceId: this.deviceId
        });
        
        // Configuration axios avec le bon namespace
        this.client = axios.create({
            baseURL: `${this.apiUrl}/wp-json/col-lms/v1`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Device-ID': this.deviceId,
                'User-Agent': 'LearnPress-Offline/1.0.0'
            },
            retries: 3,
            retryDelay: 1000,
            retryCondition: (error) => {
                return axios.isNetworkOrIdempotentRequestError(error) ||
                       error.response?.status >= 500;
            }
        });
        
        this.setupInterceptors();
        
        // Métriques de performance
        this.metrics = {
            requestCount: 0,
            errorCount: 0,
            avgResponseTime: 0
        };
    }
    
    // Gestion centralisée des erreurs API
    handleApiError(error, context = {}) {
        const errorInfo = {
            timestamp: new Date().toISOString(),
            context,
            request: {
                method: error.config?.method,
                url: error.config?.url,
                params: error.config?.params
            }
        };
        
        if (error.response) {
            // Erreur de réponse serveur
            errorInfo.type = 'response';
            errorInfo.status = error.response.status;
            errorInfo.statusText = error.response.statusText;
            errorInfo.data = error.response.data;
            
            // Messages personnalisés selon le code d'erreur
            switch (error.response.status) {
                case 400:
                    errorInfo.userMessage = 'Données invalides. Veuillez vérifier votre saisie.';
                    break;
                case 401:
                    errorInfo.userMessage = 'Session expirée. Veuillez vous reconnecter.';
                    errorInfo.requiresReauth = true;
                    break;
                case 403:
                    errorInfo.userMessage = 'Accès refusé. Vérifiez vos permissions.';
                    break;
                case 404:
                    errorInfo.userMessage = 'Ressource non trouvée. L\'API pourrait ne pas être installée.';
                    break;
                case 429:
                    errorInfo.userMessage = 'Trop de requêtes. Veuillez patienter.';
                    errorInfo.retryAfter = error.response.headers['retry-after'];
                    break;
                case 500:
                case 502:
                case 503:
                    errorInfo.userMessage = 'Erreur serveur. Réessayez plus tard.';
                    errorInfo.serverError = true;
                    break;
                default:
                    errorInfo.userMessage = error.response.data?.message || 'Une erreur est survenue';
            }
        } else if (error.request) {
            // Erreur de requête (pas de réponse)
            errorInfo.type = 'request';
            errorInfo.userMessage = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
            errorInfo.networkError = true;
            
            if (error.code === 'ECONNABORTED') {
                errorInfo.userMessage = 'La requête a expiré. Connexion trop lente.';
                errorInfo.timeout = true;
            }
        } else {
            // Erreur de configuration
            errorInfo.type = 'setup';
            errorInfo.userMessage = 'Erreur de configuration. Contactez le support.';
            errorInfo.message = error.message;
        }
        
        console.error('[API] Erreur détaillée:', errorInfo);
        
        return errorInfo;
    }

    // Wrapper pour les requêtes avec retry automatique
    async makeRequest(requestConfig, options = {}) {
        const {
            maxRetries = 3,
            retryDelay = 1000,
            exponentialBackoff = true,
            onRetry = null
        } = options;
        
        console.log('[API] makeRequest:', {
            method: requestConfig.method,
            url: requestConfig.url,
            hasData: !!requestConfig.data,
            hasParams: !!requestConfig.params
        });
        
        let lastError;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.client(requestConfig);
                console.log('[API] Request successful:', {
                    status: response.status,
                    hasData: !!response.data
                });
                return response;
                
            } catch (error) {
                lastError = error;
                
                const errorInfo = this.handleApiError(error, {
                    attempt: attempt + 1,
                    maxRetries: maxRetries + 1
                });
                
                // Ne pas réessayer si c'est une erreur client (4xx) sauf 429
                if (errorInfo.status >= 400 && errorInfo.status < 500 && errorInfo.status !== 429) {
                    throw errorInfo;
                }
                
                // Ne pas réessayer si on a atteint le maximum
                if (attempt === maxRetries) {
                    throw errorInfo;
                }
                
                // Calculer le délai avant le prochain essai
                let delay = retryDelay;
                if (exponentialBackoff) {
                    delay = retryDelay * Math.pow(2, attempt);
                }
                
                // Si c'est un 429, respecter le Retry-After
                if (errorInfo.retryAfter) {
                    delay = parseInt(errorInfo.retryAfter) * 1000;
                }
                
                console.log(`[API] Nouvelle tentative dans ${delay}ms (tentative ${attempt + 1}/${maxRetries + 1})`);
                
                if (onRetry) {
                    onRetry(attempt + 1, delay, errorInfo);
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
    
    setupInterceptors() {
        // Intercepteur de requête
        this.client.interceptors.request.use(
            config => {
                config.startTime = Date.now();
                this.metrics.requestCount++;
                
                if (this.token) {
                    config.headers['Authorization'] = `Bearer ${this.token}`;
                }
                
                console.log(`[API] ${config.method.toUpperCase()} ${config.url}`, {
                    hasAuth: !!config.headers['Authorization'],
                    params: config.params,
                    dataSize: config.data ? JSON.stringify(config.data).length : 0
                });
                return config;
            },
            error => {
                console.error('[API] Request error:', error);
                return Promise.reject(error);
            }
        );
        
        // Intercepteur de réponse avec gestion du refresh améliorée
        this.client.interceptors.response.use(
            response => {
                let responseTime = 0;
                if (response.config.startTime) {
                    responseTime = Date.now() - response.config.startTime;
                    this.updateMetrics(responseTime);
                }
                
                console.log(`[API] Response: ${response.status} (${responseTime}ms)`, {
                    url: response.config.url,
                    dataType: typeof response.data,
                    dataKeys: response.data ? Object.keys(response.data).slice(0, 5) : []
                });
                return response;
            },
            async error => {
                const originalRequest = error.config;
                
                this.metrics.errorCount++;
                
                console.error('[API] Response error:', {
                    url: originalRequest?.url,
                    status: error.response?.status,
                    message: error.message,
                    data: error.response?.data
                });
                
                // Gestion du token expiré avec protection contre les boucles
                if (error.response?.status === 401 && 
                    !originalRequest._retry && 
                    this.refreshToken &&
                    !this.refreshInProgress) {
                    
                    originalRequest._retry = true;
                    
                    try {
                        console.log('[API] Token expiré, tentative de refresh...');
                        const result = await this.refreshAccessToken();
                        
                        if (result.success) {
                            originalRequest.headers['Authorization'] = `Bearer ${this.token}`;
                            this.processQueuedRequests();
                            return this.client(originalRequest);
                        }
                    } catch (refreshError) {
                        console.error('[API] Échec du refresh, déconnexion forcée');
                        this.forceLogout();
                        throw refreshError;
                    }
                } else if (error.response?.status === 401 && this.refreshInProgress) {
                    // Mettre en file d'attente pendant le refresh
                    return new Promise((resolve, reject) => {
                        this.requestQueue.push({ resolve, reject, originalRequest });
                    });
                }
                
                return Promise.reject(this.normalizeError(error));
            }
        );
    }
    
    // Obtenir les headers pour les requêtes
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Device-ID': this.deviceId
        };
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        return headers;
    }
    
    // Normaliser les erreurs pour un handling cohérent
    normalizeError(error) {
        if (error.response) {
            return {
                type: 'http_error',
                status: error.response.status,
                message: error.response.data?.message || error.response.statusText,
                code: error.response.data?.code,
                data: error.response.data
            };
        } else if (error.request) {
            return {
                type: 'network_error',
                message: 'Erreur de connexion réseau',
                code: error.code,
                originalError: error
            };
        } else {
            return {
                type: 'config_error',
                message: error.message,
                originalError: error
            };
        }
    }
    
    // Mettre à jour les métriques de performance
    updateMetrics(responseTime) {
        const count = this.metrics.requestCount;
        this.metrics.avgResponseTime = ((this.metrics.avgResponseTime * (count - 1)) + responseTime) / count;
    }
    
    // Traiter les requêtes en file d'attente après refresh
    processQueuedRequests() {
        console.log(`[API] Traitement de ${this.requestQueue.length} requêtes en attente`);
        
        while (this.requestQueue.length > 0) {
            const { resolve, reject, originalRequest } = this.requestQueue.shift();
            
            if (this.token) {
                originalRequest.headers['Authorization'] = `Bearer ${this.token}`;
                this.client(originalRequest).then(resolve).catch(reject);
            } else {
                reject(new Error('Token non disponible après refresh'));
            }
        }
    }
    
    // Authentification - VERSION AMÉLIORÉE
    async login(username, password) {
        try {
            console.log('[API] Début de l\'authentification...', {
                username,
                apiUrl: this.apiUrl,
                deviceId: this.deviceId
            });
            
            const response = await this.makeRequest({
                method: 'POST',
                url: '/auth/login',
                data: {
                    username,
                    password,
                    device_id: this.deviceId,
                    app_version: '1.0.0'
                }
            }, {
                maxRetries: 2,
                onRetry: (attempt, delay) => {
                    console.log(`[API] Authentification, tentative ${attempt}`);
                }
            });
            
            const data = response.data;
            console.log('[API] Réponse login:', {
                hasToken: !!data.token,
                hasRefreshToken: !!data.refresh_token,
                hasUser: !!data.user,
                userKeys: data.user ? Object.keys(data.user) : []
            });
            
            if (data.token) {
                this.token = data.token;
                this.refreshToken = data.refresh_token;
                this.userId = data.user.id;
                
                console.log('[API] Authentification réussie', {
                    userId: this.userId,
                    tokenLength: this.token.length,
                    hasRefreshToken: !!this.refreshToken
                });
                
                return {
                    success: true,
                    user: {
                        id: data.user.id,
                        username: data.user.username,
                        email: data.user.email,
                        displayName: data.user.display_name || data.user.username,
                        avatar: data.user.avatar_url,
                        membership: data.user.membership || null,
                        roles: data.user.roles || [],
                        capabilities: data.user.capabilities || {},
                        profile: data.user.profile || {}
                    },
                    token: data.token,
                    expiresIn: data.expires_in || 3600
                };
            }
            
            throw new Error('Token non reçu du serveur');
            
        } catch (error) {
            console.error('[API] Erreur de connexion:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                return {
                    success: false,
                    error: error.userMessage,
                    code: error.data?.code,
                    status: error.status,
                    requiresMembership: error.data?.code === 'no_active_membership'
                };
            }
            
            // Ancien système de gestion d'erreur (fallback)
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data || {};
                
                let errorMessage = data.message || 'Erreur de connexion';
                let errorCode = data.code;
                
                switch (status) {
                    case 400:
                        errorMessage = 'Données d\'authentification invalides';
                        break;
                    case 401:
                        errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
                        break;
                    case 403:
                        if (data.code === 'no_active_membership') {
                            errorMessage = 'Un abonnement actif est requis';
                            errorCode = 'no_active_membership';
                        } else {
                            errorMessage = 'Accès refusé';
                        }
                        break;
                    case 404:
                        errorMessage = 'API non trouvée. Vérifiez l\'URL du site et que le plugin est installé.';
                        break;
                    case 429:
                        errorMessage = 'Trop de tentatives de connexion. Veuillez patienter.';
                        break;
                    case 500:
                    case 502:
                    case 503:
                        errorMessage = 'Erreur du serveur. Réessayez plus tard.';
                        break;
                }
                
                return {
                    success: false,
                    error: errorMessage,
                    code: errorCode,
                    status: status,
                    requiresMembership: errorCode === 'no_active_membership'
                };
            }
            
            return {
                success: false,
                error: error.message || 'Erreur de connexion réseau',
                type: 'network_error'
            };
        }
    }
    
    // Vérifier l'abonnement
    async verifySubscription() {
        try {
            console.log('[API] Vérification de l\'abonnement...');
            
            const response = await this.makeRequest({
                method: 'GET',
                url: '/auth/verify'
            }, {
                maxRetries: 2
            });
            
            console.log('[API] Réponse vérification:', {
                hasSubscription: !!response.data.subscription,
                isActive: response.data.subscription?.is_active,
                hasUser: !!response.data.user
            });
            
            const subscriptionData = {
                success: true,
                isActive: response.data.subscription?.is_active || false,
                subscription: response.data.subscription || null,
                user: response.data.user || null,
                features: response.data.features || {},
                limits: response.data.limits || {},
                expiresAt: response.data.subscription?.expires_at || null
            };
            
            // Cache local pour réduire les appels API
            this.lastSubscriptionCheck = Date.now();
            this.cachedSubscription = subscriptionData;
            
            return subscriptionData;
            
        } catch (error) {
            console.error('[API] Erreur de vérification d\'abonnement:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                if (error.requiresReauth) {
                    console.log('[API] Refresh token invalide, nettoyage des tokens...');
                    
                    this.clearTokens();
                    
                    if (typeof window !== 'undefined' && window.electronAPI) {
                        window.electronAPI.emit('force-logout', { 
                            reason: 'refresh_token_expired',
                            message: 'Votre session a expiré. Veuillez vous reconnecter.'
                        });
                    }
                    
                    return {
                        success: false,
                        isActive: false,
                        subscription: null,
                        reason: 'refresh_token_expired'
                    };
                }
            }
            
            // Utiliser le cache si disponible et récent (< 5 minutes)
            if (this.cachedSubscription && 
                Date.now() - this.lastSubscriptionCheck < 300000) {
                console.log('[API] Utilisation du cache pour l\'abonnement');
                return this.cachedSubscription;
            }
            
            if (error.status === 401 || error.response?.status === 401) {
                return {
                    success: true,
                    isActive: false,
                    subscription: null,
                    reason: 'unauthorized'
                };
            }
            
            return {
                success: false,
                error: error.userMessage || error.message,
                isActive: false,
                type: error.type || 'unknown'
            };
        }
    }
    
    // Récupérer les cours - VERSION AMÉLIORÉE
    async getCourses(page = 1, perPage = 50, filters = {}) {
        try {
            console.log('[API] Récupération des cours:', { page, perPage, filters });
            
            const params = {
                page,
                per_page: perPage,
                ...filters
            };
            
            if (filters.category) params.category = filters.category;
            if (filters.difficulty) params.difficulty = filters.difficulty;
            if (filters.search) params.search = filters.search;
            if (filters.instructor) params.instructor = filters.instructor;
            if (filters.date_from) params.date_from = filters.date_from;
            if (filters.date_to) params.date_to = filters.date_to;
            
            const response = await this.makeRequest({
                method: 'GET',
                url: '/courses',
                params
            }, {
                maxRetries: 2,
                onRetry: (attempt, delay) => {
                    console.log(`[API] Récupération des cours, tentative ${attempt}`);
                }
            });
            
            console.log('[API] Cours récupérés:', {
                count: response.data.courses?.length || 0,
                total: response.data.total,
                pages: response.data.pages
            });
            
            const courses = this.transformCourses(response.data.courses || []);
            
            return {
                success: true,
                courses: courses,
                total: response.data.total || 0,
                pages: response.data.pages || Math.ceil((response.data.total || 0) / perPage),
                currentPage: page,
                hasMore: response.data.has_more || false,
                categories: response.data.categories || [],
                instructors: response.data.instructors || [],
                filters: response.data.active_filters || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                return {
                    success: false,
                    error: error.userMessage,
                    errorCode: error.status,
                    requiresReauth: error.requiresReauth,
                    courses: []
                };
            }
            
            return {
                success: false,
                error: error.message || 'Erreur inconnue',
                courses: []
            };
        }
    }
    
    // Récupérer les cours de l'utilisateur - VERSION CORRIGÉE
    async getUserCourses(filters = {}) {
        try {
            const params = {
                enrolled_only: true,
                page: filters.page || 1,
                per_page: filters.perPage || 50,
                include_progress: true,
                include_certificates: filters.includeCertificates || false,
                ...filters
            };
            
            console.log('[API] Récupération des cours utilisateur avec params:', params);
            console.log('[API] Token actuel:', this.token ? `${this.token.substring(0, 20)}...` : 'AUCUN');
            console.log('[API] URL de base:', this.apiUrl);
            
            const response = await this.makeRequest({
                method: 'GET',
                url: '/courses',
                params
            }, {
                maxRetries: 2,
                onRetry: (attempt, delay) => {
                    console.log(`[API] Récupération des cours utilisateur, tentative ${attempt}`);
                }
            });
            
            console.log('[API] Réponse brute:', {
                status: response.status,
                headers: response.headers,
                dataType: typeof response.data,
                dataKeys: response.data ? Object.keys(response.data) : []
            });
            
            // Gérer différents formats de réponse possibles
            let courses = [];
            
            // Format 1: { courses: [...] }
            if (response.data.courses && Array.isArray(response.data.courses)) {
                courses = response.data.courses;
            }
            // Format 2: Tableau direct
            else if (Array.isArray(response.data)) {
                courses = response.data;
            }
            // Format 3: { data: [...] }
            else if (response.data.data && Array.isArray(response.data.data)) {
                courses = response.data.data;
            }
            // Format 4: Objet avec items
            else if (response.data.items && Array.isArray(response.data.items)) {
                courses = response.data.items;
            }
            
            console.log('[API] Nombre de cours trouvés:', courses.length);
            
            // Transformer les cours pour uniformiser le format
            const transformedCourses = this.transformLearnPressCourses(courses);
            
            console.log('[API] Cours transformés:', {
                count: transformedCourses.length,
                sampleCourse: transformedCourses[0] ? {
                    id: transformedCourses[0].id,
                    title: transformedCourses[0].title,
                    hasProgress: transformedCourses[0].progress !== undefined
                } : null
            });
            
            return {
                success: true,
                courses: transformedCourses,
                total: response.data.total || courses.length,
                pages: response.data.pages || Math.ceil((response.data.total || courses.length) / params.per_page),
                hasMore: response.data.has_more || false,
                stats: {
                    completed: transformedCourses.filter(c => c.completed).length,
                    inProgress: transformedCourses.filter(c => c.progress > 0 && !c.completed).length,
                    notStarted: transformedCourses.filter(c => c.progress === 0).length
                }
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours utilisateur:', error);
            console.error('[API] Type d\'erreur:', error.name || error.type);
            console.error('[API] Message:', error.userMessage || error.message);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                if (error.status === 404) {
                    return {
                        success: false,
                        error: 'Endpoint API non trouvé. Vérifiez la configuration du plugin WordPress.',
                        code: 'endpoint_not_found',
                        courses: [],
                        total: 0
                    };
                }
                
                return {
                    success: false,
                    error: error.userMessage,
                    errorCode: error.status,
                    requiresReauth: error.requiresReauth,
                    courses: [],
                    total: 0
                };
            }
            
            // Ancien système (fallback)
            if (error.response) {
                console.error('[API] Réponse d\'erreur:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data,
                    headers: error.response.headers
                });
                
                if (error.response.status === 404) {
                    console.error('[API] Endpoint /courses non trouvé. Vérifiez que le plugin est installé.');
                    return {
                        success: false,
                        error: 'Endpoint API non trouvé. Vérifiez la configuration du plugin WordPress.',
                        code: 'endpoint_not_found',
                        courses: [],
                        total: 0
                    };
                }
            }
            
            return {
                success: false,
                error: error.message || 'Erreur lors de la récupération des cours',
                errorType: error.name,
                courses: [],
                total: 0
            };
        }
    }
    
    // Transformer les cours (ancienne méthode pour compatibilité)
    transformCourses(courses) {
        return this.transformLearnPressCourses(courses);
    }
    
    // Nouvelle méthode pour transformer les cours LearnPress
    transformLearnPressCourses(courses) {
        console.log('[API] Transformation de', courses.length, 'cours');
        
        return courses.map(course => {
            // Gérer les différents formats possibles de LearnPress
            const courseId = course.id || course.ID || course.course_id;
            
            // Extraire les informations de l'instructeur
            let instructorName = 'Instructeur';
            let instructorId = null;
            
            if (course.instructor) {
                if (typeof course.instructor === 'string') {
                    instructorName = course.instructor;
                } else if (course.instructor.display_name) {
                    instructorName = course.instructor.display_name;
                    instructorId = course.instructor.id || course.instructor.ID;
                } else if (course.instructor.name) {
                    instructorName = course.instructor.name;
                    instructorId = course.instructor.id;
                }
            } else if (course.author) {
                instructorName = course.author.display_name || course.author.name || 'Instructeur';
                instructorId = course.author.id || course.author.ID;
            }
            
            // Calculer le nombre de leçons
            let lessonsCount = 0;
            let sectionsCount = 0;
            
            if (course.sections && Array.isArray(course.sections)) {
                sectionsCount = course.sections.length;
                course.sections.forEach(section => {
                    if (section.items) {
                        lessonsCount += section.items.length;
                    } else if (section.lessons) {
                        lessonsCount += section.lessons.length;
                    }
                });
            }
            
            // Si pas de sections mais un compteur direct
            if (lessonsCount === 0) {
                lessonsCount = course.count_items || course.total_lessons || course.lesson_count || 0;
            }
            
            // Gérer la progression
            let progress = 0;
            let completed = false;
            
            if (course.course_data) {
                progress = course.course_data.result?.percent || 0;
                completed = course.course_data.status === 'finished' || progress >= 100;
            } else if (course.progress !== undefined) {
                progress = course.progress;
                completed = course.completed || progress >= 100;
            }
            
            // Gérer la miniature
            let thumbnail = null;
            if (course.image) {
                thumbnail = course.image;
            } else if (course.thumbnail) {
                thumbnail = course.thumbnail;
            } else if (course.featured_image) {
                thumbnail = course.featured_image;
            } else if (course._embedded && course._embedded['wp:featuredmedia']) {
                thumbnail = course._embedded['wp:featuredmedia'][0]?.source_url;
            }
            
            const transformedCourse = {
                id: courseId,
                course_id: courseId,
                title: course.title?.rendered || course.title || course.name || 'Sans titre',
                description: course.content?.rendered || course.description || course.excerpt?.rendered || '',
                excerpt: course.excerpt?.rendered || course.excerpt || '',
                thumbnail: thumbnail,
                instructor_name: instructorName,
                instructor_id: instructorId,
                instructor_avatar: course.instructor?.avatar_url,
                sections_count: sectionsCount,
                lessons_count: lessonsCount,
                students_count: course.students || course.count_students || 0,
                duration: course.duration || this.calculateDuration(course.sections),
                difficulty_level: course.level || 'intermediate',
                category: this.extractCategory(course),
                categories: course.categories || [],
                tags: course.tags || [],
                price: parseFloat(course.price || course.regular_price || 0),
                sale_price: parseFloat(course.sale_price || 0),
                currency: course.currency || 'EUR',
                enrolled: course.enrolled || course.is_enrolled || false,
                progress: progress,
                completed: completed,
                completion_date: course.completion_date,
                last_accessed: course.last_accessed,
                can_download: course.can_download !== false,
                updated_at: course.modified || course.updated_at || course.date_modified,
                created_at: course.date || course.created_at || course.date_created,
                rating: parseFloat(course.rating || course.average_rating || 0),
                review_count: course.rating_count || course.count_rating || 0,
                language: course.language || 'fr',
                requirements: course.requirements || [],
                what_will_learn: course.what_will_learn || [],
                sections: this.transformLearnPressSections(course.sections || course.curriculum?.sections || []),
                download_info: {
                    estimated_size: course.estimated_download_size || 0,
                    file_count: course.total_files || 0,
                    video_count: course.video_count || 0,
                    document_count: course.document_count || 0
                }
            };
            
            console.log('[API] Cours transformé:', {
                id: transformedCourse.id,
                title: transformedCourse.title,
                progress: transformedCourse.progress,
                enrolled: transformedCourse.enrolled
            });
            
            return transformedCourse;
        });
    }
    
    // Transformer les sections LearnPress
    transformLearnPressSections(sections) {
        if (!Array.isArray(sections)) return [];
        
        return sections.map((section, index) => ({
            id: section.id || section.ID || `section-${index}`,
            section_id: section.id || section.ID || `section-${index}`,
            title: section.title || section.name || `Section ${index + 1}`,
            description: section.description || '',
            order: section.order || index,
            lessons_count: section.items?.length || section.lessons?.length || 0,
            duration: section.duration || this.calculateSectionDuration(section.items || section.lessons),
            lessons: this.transformLearnPressLessons(section.items || section.lessons || [])
        }));
    }
    
    // Transformer les leçons LearnPress
    transformLearnPressLessons(lessons) {
        if (!Array.isArray(lessons)) return [];
        
        return lessons.map((lesson, index) => ({
            id: lesson.id || lesson.ID,
            lesson_id: lesson.id || lesson.ID,
            title: lesson.title || lesson.name || 'Sans titre',
            description: lesson.description || '',
            type: lesson.type || lesson.item_type || 'lp_lesson',
            duration: lesson.duration || 0,
            order: lesson.order || index,
            preview: lesson.preview || false,
            completed: lesson.status === 'completed' || lesson.completed || false,
            progress: lesson.progress || 0,
            locked: lesson.locked || false,
            content: lesson.content || '',
            video_url: lesson.video_sources?.[0]?.url || lesson.video || null,
            video_sources: lesson.video_sources || [],
            attachments: lesson.attachments || [],
            estimated_reading_time: lesson.estimated_reading_time || 0,
            difficulty: lesson.difficulty || 'normal',
            points: lesson.points || 0,
            quiz_questions: lesson.quiz_questions || 0
        }));
    }
    
    // Extraire la catégorie principale
    extractCategory(course) {
        if (course.categories && course.categories.length > 0) {
            return course.categories[0].name || course.categories[0].title || 'Non catégorisé';
        }
        if (course.category) {
            return course.category;
        }
        if (course.course_category && course.course_category.length > 0) {
            return course.course_category[0];
        }
        return 'Non catégorisé';
    }
    
    // Calculer la durée totale
    calculateDuration(sections) {
        if (!sections || !Array.isArray(sections)) return 'Durée inconnue';
        
        let totalMinutes = 0;
        sections.forEach(section => {
            if (section.lessons || section.items) {
                const lessons = section.lessons || section.items;
                lessons.forEach(lesson => {
                    if (lesson.duration) {
                        if (typeof lesson.duration === 'number') {
                            totalMinutes += lesson.duration;
                        } else if (typeof lesson.duration === 'string') {
                            const parts = lesson.duration.split(':');
                            if (parts.length === 2) {
                                totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
                            } else if (parts.length === 3) {
                                totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]) + parseInt(parts[2]) / 60;
                            }
                        }
                    }
                });
            }
        });
        
        if (totalMinutes === 0) return 'Durée inconnue';
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }
    
    // Calculer la durée d'une section
    calculateSectionDuration(lessons) {
        if (!lessons || !Array.isArray(lessons)) return 0;
        
        return lessons.reduce((total, lesson) => {
            if (lesson.duration && typeof lesson.duration === 'number') {
                return total + lesson.duration;
            }
            return total;
        }, 0);
    }
    
    // Récupérer les détails d'un cours
    async getCourseDetails(courseId) {
        try {
            console.log('[API] Récupération des détails du cours:', courseId);
            
            const response = await this.makeRequest({
                method: 'GET',
                url: `/courses/${courseId}`,
                params: {
                    include_sections: true,
                    include_lessons: true,
                    include_media: true,
                    include_quiz: true,
                    include_assignments: true,
                    include_progress: true
                }
            }, {
                maxRetries: 2,
                onRetry: (attempt, delay) => {
                    console.log(`[API] Récupération des détails du cours ${courseId}, tentative ${attempt}`);
                }
            });
            
            console.log('[API] Détails du cours récupérés:', {
                hasData: !!response.data,
                dataKeys: response.data ? Object.keys(response.data) : []
            });
            
            const courseData = response.data.course || response.data;
            const course = this.transformLearnPressCourses([courseData])[0];
            
            if (response.data.prerequisites) {
                course.prerequisites = response.data.prerequisites;
            }
            
            if (response.data.faq) {
                course.faq = response.data.faq;
            }
            
            if (response.data.announcements) {
                course.announcements = response.data.announcements;
            }
            
            return {
                success: true,
                course: course,
                access_info: response.data.access_info || {},
                download_permissions: response.data.download_permissions || {},
                expiration_info: response.data.expiration_info || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération du cours:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                if (error.status === 403) {
                    return {
                        success: false,
                        error: 'Vous n\'avez pas accès à ce cours',
                        code: 'access_denied',
                        requiresEnrollment: true
                    };
                }
                
                if (error.status === 404) {
                    return {
                        success: false,
                        error: 'Cours non trouvé',
                        code: 'course_not_found'
                    };
                }
                
                return {
                    success: false,
                    error: error.userMessage,
                    type: error.type || 'unknown'
                };
            }
            
            // Ancien système (fallback)
            if (error.response?.status === 403) {
                return {
                    success: false,
                    error: 'Vous n\'avez pas accès à ce cours',
                    code: 'access_denied',
                    requiresEnrollment: true
                };
            }
            
            if (error.response?.status === 404) {
                return {
                    success: false,
                    error: 'Cours non trouvé',
                    code: 'course_not_found'
                };
            }
            
            return {
                success: false,
                error: error.message,
                type: error.type || 'unknown'
            };
        }
    }
    
    // Télécharger un fichier avec progress et resume - VERSION MISE À JOUR AVEC HEADER REFERER
    async downloadFile(fileUrl, savePath, onProgress, options = {}) {
        try {
            console.log('[API] Téléchargement du fichier:', { 
                fileUrl: fileUrl.substring(0, 100) + '...', 
                savePath,
                isSecureUrl: fileUrl.includes('/wp-json/col-lms/v1/media/secure-download')
            });
            
            // Vérifier si c'est une URL sécurisée de votre API
            const isSecureUrl = fileUrl.includes('/wp-json/col-lms/v1/media/secure-download');
            
            const fsSync = require('fs');
            const dir = path.dirname(savePath);
            
            // Créer le dossier parent si nécessaire
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
                console.log('[API] Dossier créé:', dir);
            }
            
            const {
                timeout = 300000,
                maxRetries = 3,
                chunkSize = 1024 * 1024,
                resumable = true
            } = options;
            
            // Support de la reprise de téléchargement
            let startByte = 0;
            if (resumable) {
                try {
                    const stats = await fs.stat(savePath);
                    startByte = stats.size;
                    console.log('[API] Reprise du téléchargement à:', startByte, 'octets');
                } catch (e) {
                    startByte = 0;
                }
            }
            
            const headers = this.getHeaders();
            if (startByte > 0) {
                headers['Range'] = `bytes=${startByte}-`;
            }
            
            // IMPORTANT: Ajouter le Referer pour contourner la protection .htaccess
            headers['Referer'] = 'https://teachmemore.fr/';
            
            // Pour les URLs sécurisées, s'assurer que le token est dans les headers
            if (isSecureUrl && this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
                console.log('[API] Header Authorization ajouté pour URL sécurisée');
            }
            
            // Toujours inclure l'authentification pour teachmemore.fr
            const isTeachMemoreUrl = fileUrl.includes('teachmemore.fr');
            if (isTeachMemoreUrl && this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
                console.log('[API] Authorization ajoutée pour teachmemore.fr');
            }
            
            // Ajouter des headers supplémentaires
            headers['User-Agent'] = 'LearnPress-Offline/1.0.0';
            
            console.log('[API] Headers de téléchargement:', {
                hasAuth: !!headers['Authorization'],
                hasRange: !!headers['Range'],
                hasReferer: !!headers['Referer'],
                referer: headers['Referer'],
                deviceId: headers['X-Device-ID']
            });
            
            const response = await axios({
                url: fileUrl,
                method: 'GET',
                responseType: 'stream',
                headers,
                timeout,
                withCredentials: true, // Important pour les cookies WordPress
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 300 || status === 206; // Accept 206 for partial content
                },
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.lengthComputable) {
                        const total = progressEvent.total + startByte;
                        const loaded = progressEvent.loaded + startByte;
                        const percent = Math.round((loaded * 100) / total);
                        
                        onProgress({
                            percent: percent,
                            loaded: loaded,
                            total: total,
                            speed: this.calculateDownloadSpeed(loaded, progressEvent.timeStamp)
                        });
                    }
                }
            });
            
            console.log('[API] Réponse de téléchargement:', {
                status: response.status,
                contentType: response.headers['content-type'],
                contentLength: response.headers['content-length']
            });
            
            // Écriture avec append pour la reprise
            const writer = fsSync.createWriteStream(savePath, { 
                flags: startByte > 0 ? 'a' : 'w' 
            });
            
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log('[API] Téléchargement terminé:', savePath);
                    resolve({
                        success: true,
                        path: savePath,
                        size: writer.bytesWritten + startByte,
                        resumed: startByte > 0
                    });
                });
                
                writer.on('error', (error) => {
                    console.error('[API] Erreur d\'écriture:', error);
                    
                    // Retry automatique en cas d'erreur
                    if (options.retryCount < maxRetries) {
                        console.log(`[API] Retry téléchargement (${options.retryCount + 1}/${maxRetries})`);
                        setTimeout(() => {
                            this.downloadFile(fileUrl, savePath, onProgress, {
                                ...options,
                                retryCount: (options.retryCount || 0) + 1
                            }).then(resolve).catch(reject);
                        }, 2000 * Math.pow(2, options.retryCount || 0));
                    } else {
                        reject(error);
                    }
                });
                
                response.data.on('error', (error) => {
                    console.error('[API] Erreur de stream:', error);
                    writer.destroy();
                    
                    // Si c'est une erreur 401 sur une URL sécurisée, le token a peut-être expiré
                    if (error.response?.status === 401 && isSecureUrl) {
                        console.log('[API] Token expiré pour le téléchargement');
                        reject({
                            ...error,
                            tokenExpired: true,
                            message: 'Token de téléchargement expiré'
                        });
                    } else {
                        reject(error);
                    }
                });
            });
            
        } catch (error) {
            console.error('[API] Erreur lors du téléchargement:', error);
            console.error('[API] Status:', error.response?.status);
            console.error('[API] Headers:', error.response?.headers);
            
            // Si c'est une erreur 401 sur une URL sécurisée, le token a peut-être expiré
            if (error.response?.status === 401 && fileUrl.includes('secure-download')) {
                console.log('[API] Token expiré pour le téléchargement, besoin de rafraîchir les URLs');
                error.tokenExpired = true;
                error.needsRefresh = true;
            }
            
            // Si c'est une erreur 403, cela peut être dû au Referer manquant
            if (error.response?.status === 403) {
                console.log('[API] Erreur 403 - Vérifiez le header Referer');
                error.message = 'Accès refusé. Le header Referer pourrait être requis.';
            }
            
            // Si c'est une erreur 404
            if (error.response?.status === 404) {
                console.log('[API] Erreur 404 - Fichier non trouvé');
                error.message = 'Fichier non trouvé sur le serveur.';
            }
            
            throw error;
        }
    }
    
    // Calculer la vitesse de téléchargement
    calculateDownloadSpeed(loaded, timestamp) {
        if (!this.downloadStartTime) {
            this.downloadStartTime = timestamp;
            this.downloadStartBytes = 0;
        }
        
        const elapsedTime = (timestamp - this.downloadStartTime) / 1000;
        const bytesTransferred = loaded - this.downloadStartBytes;
        
        if (elapsedTime > 0) {
            return bytesTransferred / elapsedTime;
        }
        
        return 0;
    }
    
    // Synchroniser la progression
    async syncProgress(progressData) {
        try {
            console.log('[API] Synchronisation de la progression...');
            
            const payload = {
                lessons: progressData.lessons || [],
                quizzes: progressData.quizzes || [],
                assignments: progressData.assignments || [],
                certificates: progressData.certificates || [],
                notes: progressData.notes || [],
                bookmarks: progressData.bookmarks || [],
                last_sync: progressData.lastSync,
                device_id: this.deviceId,
                sync_version: '2.0'
            };
            
            const response = await this.makeRequest({
                method: 'POST',
                url: '/progress/sync',
                data: payload
            }, {
                maxRetries: 3,
                onRetry: (attempt, delay) => {
                    console.log(`[API] Synchronisation de la progression, tentative ${attempt}`);
                }
            });
            
            console.log('[API] Progression synchronisée:', {
                synced: response.data.synced_count,
                conflicts: response.data.conflicts?.length || 0
            });
            
            return {
                success: true,
                synced: response.data.synced_count || 0,
                conflicts: response.data.conflicts || [],
                serverTime: response.data.server_time,
                sync_id: response.data.sync_id,
                next_sync_recommended: response.data.next_sync_recommended,
                server_changes: response.data.server_changes || []
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la synchronisation:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                return {
                    success: false,
                    error: error.userMessage,
                    type: error.type || 'sync_error',
                    retryable: error.serverError || error.networkError
                };
            }
            
            return {
                success: false,
                error: error.message,
                type: error.type || 'sync_error',
                retryable: error.response?.status >= 500
            };
        }
    }
    
    // Récupérer les informations de média
    async getMediaInfo(courseId) {
        try {
            console.log('[API] Récupération des infos média pour le cours:', courseId);
            
            const response = await this.makeRequest({
                method: 'GET',
                url: `/courses/${courseId}/media`
            }, {
                maxRetries: 2
            });
            
            console.log('[API] Infos média récupérées:', {
                mediaCount: response.data.media?.length || 0,
                totalSize: response.data.total_size
            });
            
            return {
                success: true,
                media: response.data.media || [],
                total_size: response.data.total_size || 0,
                video_count: response.data.video_count || 0,
                document_count: response.data.document_count || 0,
                formats_available: response.data.formats_available || [],
                quality_options: response.data.quality_options || [],
                download_urls: response.data.download_urls || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des médias:', error);
            
            // Si c'est déjà un objet errorInfo
            if (error.userMessage) {
                return {
                    success: false,
                    error: error.userMessage,
                    media: []
                };
            }
            
            return {
                success: false,
                error: error.message,
                media: []
            };
        }
    }
    
    // Récupérer les médias d'un cours avec URLs sécurisées
    async getCourseMedia(courseId, options = {}) {
        try {
            const params = {
                include_videos: options.include_videos !== undefined ? options.include_videos : true,
                include_documents: options.include_documents !== undefined ? options.include_documents : true
            };
            
            console.log('[API] getCourseMedia appelé:', { courseId, params });
            
            const response = await this.makeRequest({
                method: 'GET',
                url: `/courses/${courseId}/media`,
                params: params
            }, {
                maxRetries: 2
            });
            
            console.log('[API] Media response:', {
                count: response.data?.count,
                totalSize: response.data?.total_size,
                hasVideos: response.data?.media?.some(m => m.type === 'video'),
                sampleMedia: response.data?.media?.[0] ? {
                    type: response.data.media[0].type,
                    hasUrl: !!response.data.media[0].url,
                    hasDownloadUrl: !!response.data.media[0].download_url
                } : null
            });
            
            return {
                success: true,
                media: response.data?.media || [],
                count: response.data?.count || 0,
                totalSize: response.data?.total_size || 0
            };
            
        } catch (error) {
            console.error('[API] Erreur getCourseMedia:', error);
            return {
                success: false,
                error: error.message,
                media: []
            };
        }
    }
    
    // Télécharger un média spécifique
    async downloadMedia(mediaUrl, savePath, onProgress, options = {}) {
        console.log('[API] downloadMedia appelé:', {
            mediaUrl: mediaUrl.substring(0, 100) + '...',
            savePath,
            hasOptions: !!options
        });
        
        return this.downloadFile(mediaUrl, savePath, onProgress, {
            ...options,
            resumable: true,
            maxRetries: 5
        });
    }
    
    // Rafraîchir les URLs de téléchargement si expirées
    async refreshMediaUrls(courseId, mediaIds) {
        try {
            console.log('[API] Rafraîchissement des URLs de média...', {
                courseId,
                mediaCount: mediaIds?.length || 0
            });
            
            const response = await this.getCourseMedia(courseId, {
                include_videos: true,
                include_documents: true
            });
            
            if (!response.success) {
                throw new Error(response.error);
            }
            
            // Créer un map des nouvelles URLs
            const urlMap = new Map();
            response.media.forEach(media => {
                if (media.download_url) {
                    urlMap.set(media.id, media.download_url);
                    console.log('[API] Nouvelle URL pour média:', media.id);
                }
            });
            
            console.log('[API] URLs rafraîchies:', urlMap.size);
            
            return {
                success: true,
                urls: urlMap
            };
            
        } catch (error) {
            console.error('[API] Erreur lors du rafraîchissement des URLs:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Déconnexion
    async logout() {
        try {
            console.log('[API] Déconnexion...');
            
            if (this.token) {
                await this.makeRequest({
                    method: 'POST',
                    url: '/auth/logout',
                    data: {
                        device_id: this.deviceId,
                        token: this.token
                    }
                }, {
                    maxRetries: 1 // Pas besoin de réessayer plusieurs fois pour le logout
                });
            }
        } catch (error) {
            console.warn('[API] Erreur lors de la déconnexion côté serveur:', error);
        } finally {
            this.clearTokens();
            console.log('[API] Tokens nettoyés');
        }
    }
    
    // Forcer la déconnexion
    forceLogout() {
        console.log('[API] Déconnexion forcée');
        this.clearTokens();
        
        if (typeof window !== 'undefined' && window.electronAPI) {
            window.electronAPI.emit('force-logout', { reason: 'invalid_token' });
        }
    }
    
    // Nettoyer les tokens
    clearTokens() {
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.refreshInProgress = false;
        this.requestQueue = [];
        this.cachedSubscription = null;
        this.lastSubscriptionCheck = null;
        console.log('[API] Tokens et cache nettoyés');
    }
    
    // Rafraîchir le token
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Pas de refresh token disponible');
        }
        
        // Éviter les appels multiples simultanés
        if (this.refreshInProgress) {
            console.log('[API] Refresh déjà en cours, mise en attente...');
            
            // Attendre que le refresh en cours se termine
            const maxWait = 10000; // 10 secondes max
            const startWait = Date.now();
            
            while (this.refreshInProgress && (Date.now() - startWait) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (this.refreshInProgress) {
                throw new Error('Timeout en attendant le refresh token');
            }
            
            // Vérifier si le token a été mis à jour
            if (this.token) {
                return { success: true, token: this.token };
            } else {
                throw new Error('Refresh échoué');
            }
        }
        
        this.refreshInProgress = true;
        const refreshStartTime = Date.now();
        
        try {
            console.log('[API] Tentative de refresh token...');
            
            // Limiter le temps du refresh
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await axios.post(
                `${this.apiUrl}/wp-json/col-lms/v1/auth/refresh`,
                {
                    refresh_token: this.refreshToken,
                    device_id: this.deviceId
                },
                {
                    timeout: 15000,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Device-ID': this.deviceId
                    },
                    signal: controller.signal
                }
            );
            
            clearTimeout(timeoutId);
            
            console.log('[API] Réponse refresh:', {
                hasToken: !!response.data.token,
                hasRefreshToken: !!response.data.refresh_token
            });
            
            if (response.data.token) {
                this.token = response.data.token;
                
                if (response.data.refresh_token && response.data.refresh_token !== this.refreshToken) {
                    this.refreshToken = response.data.refresh_token;
                }
                
                console.log('[API] Refresh token réussi');
                
                // Traiter la queue des requêtes en attente
                this.processQueuedRequests();
                
                return { success: true, token: this.token };
            }
            
            throw new Error('Token non reçu lors du refresh');
            
        } catch (error) {
            console.error('[API] Erreur de rafraîchissement du token:', error);
            
            // Si le refresh token est invalide, forcer la déconnexion
            if (error.response?.status === 401 || error.response?.status === 403) {
                this.forceLogout();
            }
            
            throw error;
            
        } finally {
            this.refreshInProgress = false;
            
            // Log de debug
            const refreshDuration = Date.now() - refreshStartTime;
            console.log(`[API] Refresh terminé en ${refreshDuration}ms`);
        }
    }
    
    // Créer un package de téléchargement - VERSION MISE À JOUR AVEC URLs SÉCURISÉES
    async createCoursePackage(courseId, options = {}) {
        try {
            console.log('[API] createCoursePackage appelé:', { courseId, options });
            
            // D'abord, essayer de récupérer les médias via l'endpoint media
            let mediaResponse = null;
            try {
                mediaResponse = await this.getCourseMedia(courseId, {
                    include_videos: options.includeVideos !== false,
                    include_documents: options.includeDocuments !== false
                });
                
                console.log('[API] Médias récupérés via getCourseMedia:', {
                    success: mediaResponse.success,
                    count: mediaResponse.media?.length || 0,
                    hasSecureUrls: mediaResponse.media?.some(m => !!m.download_url)
                });
            } catch (error) {
                console.log('[API] Erreur getCourseMedia, on continue avec l\'approche alternative');
            }
            
            // Si on a des médias avec des URLs sécurisées, les utiliser
            if (mediaResponse?.success && mediaResponse.media?.length > 0) {
                const files = [];
                let totalSize = 0;
                
                for (const media of mediaResponse.media) {
                    // Utiliser download_url en priorité, sinon url
                    const downloadUrl = media.download_url || media.url;
                    
                    if (!downloadUrl) {
                        console.warn('[API] Média sans URL:', media);
                       continue;
                   }
                   
                   // Filtrer selon les options
                   if (media.type === 'video' && !options.includeVideos) continue;
                   if (media.type === 'document' && !options.includeDocuments) continue;
                   
                   files.push({
                       id: media.id,
                       name: media.filename,
                       url: downloadUrl,
                       originalUrl: media.url,
                       size: media.size || 100000000,
                       type: media.type,
                       lessonId: media.lesson_id,
                       lessonTitle: media.lesson_title,
                       path: `${media.type}s/${media.filename}`,
                       source: 'api_media_secure',
                       mimeType: media.mime_type || 'application/octet-stream',
                       requiresAuth: true,
                       expiresIn: media.expires_in || 3600
                   });
                   
                   totalSize += media.size || 100000000;
                   
                   console.log('[API] Fichier ajouté avec URL sécurisée:', {
                       name: media.filename,
                       type: media.type,
                       hasSecureUrl: !!media.download_url
                   });
               }
               
               if (files.length > 0) {
                   console.log('[API] Package créé avec URLs sécurisées:', {
                       filesCount: files.length,
                       totalSize
                   });
                   
                   return {
                       success: true,
                       packageId: `secure-${courseId}-${Date.now()}`,
                       files: files,
                       totalSize: totalSize,
                       estimatedTime: Math.ceil(totalSize / (1024 * 1024)), // 1MB/s estimation
                       metadata: {
                           course: {
                               id: courseId,
                               title: mediaResponse.courseTitle || 'Cours',
                           },
                           generatedAt: new Date().toISOString(),
                           version: '2.0',
                           method: 'secure_urls'
                       }
                   };
               }
           }
           
           // Si pas de médias avec URLs sécurisées, essayer l'endpoint standard
           try {
               console.log('[API] Tentative avec l\'endpoint package standard...');
               
               const response = await this.makeRequest({
                   method: 'POST',
                   url: `/courses/${courseId}/package`,
                   data: {
                       options: {
                           include_videos: options.includeVideos !== false,
                           include_documents: options.includeDocuments !== false,
                           video_quality: options.videoQuality || 'high',
                           compress: options.compress || false
                       }
                   }
               }, {
                   maxRetries: 1,
                   onRetry: (attempt, delay) => {
                       console.log(`[API] Création du package de téléchargement, tentative ${attempt}`);
                   }
               });
               
               console.log('[API] createCoursePackage réponse:', response.data);
               
               if (response.data.success) {
                   // Gérer le cas où le package est en cours de création
                   if (response.data.status === 'processing') {
                       console.log('[API] Package en cours de création, on passe à l\'approche alternative');
                       throw { status: 404 }; // Forcer l'utilisation de l'approche alternative
                   }
                   
                   return {
                       success: true,
                       packageUrl: response.data.package?.download_url || response.data.package_url || response.data.download_url,
                       packageId: response.data.package?.id || response.data.package_id,
                       files: response.data.package?.files || response.data.files || [],
                       totalSize: response.data.package?.total_size || response.data.total_size || response.data.estimated_size || 0,
                       estimatedTime: response.data.estimated_time || 0,
                       expiresAt: response.data.expires_at,
                       checksums: response.data.checksums || {},
                       metadata: response.data.metadata || {}
                   };
               }
           } catch (error) {
               // Si l'endpoint n'existe pas (404), utiliser l'approche alternative
               if (error.status === 404 || error.response?.status === 404) {
                   console.log('[API] Endpoint prepare-download non trouvé, utilisation de l\'approche alternative');
                   // Continuer avec l'approche alternative ci-dessous
               } else {
                   // Pour toute autre erreur, la propager
                   throw error;
               }
           }
           
           // APPROCHE ALTERNATIVE : Construire la liste des fichiers manuellement
           console.log('[API] Construction manuelle du package de téléchargement...');
           
           // Récupérer les détails du cours
           const courseDetails = await this.getCourseDetails(courseId);
           if (!courseDetails.success) {
               throw new Error('Impossible de récupérer les détails du cours');
           }
           
           const course = courseDetails.course;
           const files = [];
           let totalSize = 0;
           
           console.log('[API] Cours récupéré pour package:', {
               id: course.id,
               title: course.title,
               sectionsCount: course.sections?.length || 0
           });
           
           // 1. Ajouter la miniature du cours
           if (course.thumbnail) {
               files.push({
                   id: `thumbnail-${courseId}`,
                   name: 'course-thumbnail.jpg',
                   url: course.thumbnail,
                   size: 200000, // Estimation 200KB
                   type: 'image',
                   path: 'images/course-thumbnail.jpg'
               });
               totalSize += 200000;
           }
           
           // 2. Parcourir les sections et leçons
           if (course.sections && Array.isArray(course.sections)) {
               for (const section of course.sections) {
                   if (section.lessons && Array.isArray(section.lessons)) {
                       for (const lesson of section.lessons) {
                           console.log(`[API] Analyse de la leçon: ${lesson.title} (ID: ${lesson.id || lesson.lesson_id})`);
                           
                           // NOUVELLE APPROCHE : Vérifier d'abord les médias déjà fournis par l'API
                           if (lesson.media) {
                               // Si on a des vidéos dans lesson.media.videos
                               if (lesson.media.videos && Array.isArray(lesson.media.videos) && options.includeVideos !== false) {
                                   console.log(`[API] ${lesson.media.videos.length} vidéos trouvées dans lesson.media.videos`);
                                   
                                   for (const video of lesson.media.videos) {
                                       if (video.url || video.download_url) {
                                           const videoName = video.filename || `lesson-${lesson.id || lesson.lesson_id}-video-${files.filter(f => f.type === 'video').length + 1}.mp4`;
                                           
                                           files.push({
                                               id: video.id || `video-${lesson.id || lesson.lesson_id}-${files.filter(f => f.type === 'video').length}`,
                                               name: videoName,
                                               url: video.download_url || video.url, // Priorité à download_url
                                               originalUrl: video.url, // Garder l'URL originale pour référence
                                               size: video.size || 100000000,
                                               type: 'video',
                                               lessonId: lesson.id || lesson.lesson_id,
                                               lessonTitle: lesson.title,
                                               path: `videos/${videoName}`,
                                               source: 'api_media',
                                               mimeType: video.mime_type || 'video/mp4',
                                               requiresAuth: true,
                                               expiresIn: video.expires_in || 3600
                                           });
                                           
                                           totalSize += video.size || 100000000;
                                           
                                           console.log(`[API] Vidéo ajoutée depuis API:`, {
                                               url: video.url?.substring(0, 50) + '...',
                                               hasSecureUrl: !!video.download_url
                                           });
                                       }
                                   }
                               }
                               
                               // Si on a des documents dans lesson.media.documents
                               if (lesson.media.documents && Array.isArray(lesson.media.documents) && options.includeDocuments !== false) {
                                   console.log(`[API] ${lesson.media.documents.length} documents trouvés dans lesson.media.documents`);
                                   
                                   for (const doc of lesson.media.documents) {
                                       if (doc.url || doc.download_url) {
                                           const docName = doc.filename || `lesson-${lesson.id || lesson.lesson_id}-doc-${files.filter(f => f.type === 'document').length + 1}`;
                                           
                                           files.push({
                                               id: doc.id || `doc-${lesson.id || lesson.lesson_id}-${files.filter(f => f.type === 'document').length}`,
                                               name: docName,
                                               url: doc.download_url || doc.url, // Priorité à download_url
                                               originalUrl: doc.url,
                                               size: doc.size || 2000000,
                                               type: 'document',
                                               lessonId: lesson.id || lesson.lesson_id,
                                               lessonTitle: lesson.title,
                                               path: `documents/${docName}`,
                                               source: 'api_media',
                                               mimeType: doc.mime_type || 'application/pdf',
                                               requiresAuth: true,
                                               expiresIn: doc.expires_in || 3600
                                           });
                                           
                                           totalSize += doc.size || 2000000;
                                           
                                           console.log(`[API] Document ajouté depuis API:`, {
                                               url: doc.url?.substring(0, 50) + '...',
                                               hasSecureUrl: !!doc.download_url
                                           });
                                       }
                                   }
                               }
                           }
                           
                           // FALLBACK : Si pas de médias dans lesson.media, analyser le contenu
                           if ((!lesson.media || !lesson.media.videos || lesson.media.videos.length === 0) && lesson.content && options.includeVideos !== false) {
                               console.log(`[API] Pas de vidéos dans lesson.media, analyse du contenu...`);
                               
                               // Parser les vidéos depuis le contenu HTML
                               const videoBlockRegex = /<!-- wp:video[^>]*-->.*?<video[^>]*src="([^"]+)".*?<\/video>.*?<!-- \/wp:video -->/gis;
                               let match;
                               
                               while ((match = videoBlockRegex.exec(lesson.content)) !== null) {
                                   const videoUrl = match[1];
                                   console.log(`[API] Vidéo trouvée dans contenu: ${videoUrl}`);
                                   
                                   if (videoUrl && videoUrl.includes('/wp-content/uploads/')) {
                                       const videoName = `lesson-${lesson.id || lesson.lesson_id}-video-${files.filter(f => f.type === 'video').length + 1}.mp4`;
                                       files.push({
                                           id: `video-${lesson.id || lesson.lesson_id}-content`,
                                           name: videoName,
                                           url: videoUrl,
                                           size: 100000000,
                                           type: 'video',
                                           lessonId: lesson.id || lesson.lesson_id,
                                           lessonTitle: lesson.title,
                                           path: `videos/${videoName}`,
                                           source: 'content_parsing'
                                       });
                                       totalSize += 100000000;
                                   }
                               }
                               
                               // Chercher aussi les URLs MP4 directes
                               const mp4Regex = /(https?:\/\/[^"\'\s<>]+\.mp4)/gi;
                               const mp4Matches = lesson.content.match(mp4Regex) || [];
                               
                               for (const mp4Url of mp4Matches) {
                                   if (!files.some(f => f.url === mp4Url) && mp4Url.includes('/wp-content/uploads/')) {
                                       console.log(`[API] URL MP4 trouvée: ${mp4Url}`);
                                       
                                       const videoName = `lesson-${lesson.id || lesson.lesson_id}-video-${files.filter(f => f.type === 'video').length + 1}.mp4`;
                                       files.push({
                                           id: `video-${lesson.id || lesson.lesson_id}-url`,
                                           name: videoName,
                                           url: mp4Url,
                                           size: 100000000,
                                           type: 'video',
                                           lessonId: lesson.id || lesson.lesson_id,
                                           lessonTitle: lesson.title,
                                           path: `videos/${videoName}`,
                                           source: 'direct_url'
                                       });
                                       totalSize += 100000000;
                                   }
                               }
                           }
                           
                           // Vérifier aussi video_url (meta LearnPress)
                           if (lesson.video_url && lesson.video_url.trim() !== '' && !files.some(f => f.url === lesson.video_url) && options.includeVideos !== false) {
                               console.log(`[API] Vidéo trouvée dans lesson.video_url: ${lesson.video_url}`);
                               const videoName = `lesson-${lesson.id || lesson.lesson_id}-video-meta.mp4`;
                               files.push({
                                   id: `video-${lesson.id || lesson.lesson_id}-meta`,
                                   name: videoName,
                                   url: lesson.video_url,
                                   size: 100000000,
                                   type: 'video',
                                   lessonId: lesson.id || lesson.lesson_id,
                                   lessonTitle: lesson.title,
                                   path: `videos/${videoName}`,
                                   source: 'lesson_meta'
                               });
                               totalSize += 100000000;
                           }
                           
                           // Ajouter le contenu HTML de la leçon
                           if (lesson.content) {
                               const htmlName = `lesson-${lesson.id || lesson.lesson_id}-content.html`;
                               files.push({
                                   id: `content-${lesson.id || lesson.lesson_id}`,
                                   name: htmlName,
                                   content: lesson.content,
                                   size: lesson.content.length * 2,
                                   type: 'html',
                                   lessonId: lesson.id || lesson.lesson_id,
                                   path: `content/${htmlName}`
                               });
                               totalSize += lesson.content.length * 2;
                           }
                       }
                   }
               }
           }
           
           // Si aucun fichier trouvé, créer au moins le metadata
           if (files.length === 0) {
               console.warn('[API] Aucun fichier multimédia trouvé dans le cours');
               
               // Ajouter au moins le contenu textuel
               files.push({
                   id: `metadata-${courseId}`,
                   name: 'course-content.json',
                   content: JSON.stringify(course, null, 2),
                   size: JSON.stringify(course).length,
                   type: 'json',
                   path: 'metadata/course-content.json'
               });
               totalSize = JSON.stringify(course).length;
           }
           
           console.log(`[API] Package créé: ${files.length} fichiers, taille totale: ${totalSize} octets`);
           console.log('[API] Types de fichiers:', {
               videos: files.filter(f => f.type === 'video').length,
               documents: files.filter(f => f.type === 'document').length,
               images: files.filter(f => f.type === 'image').length,
               autres: files.filter(f => !['video', 'document', 'image'].includes(f.type)).length
           });
           
           return {
               success: true,
               packageId: `local-${courseId}-${Date.now()}`,
               files: files,
               totalSize: totalSize,
               estimatedTime: Math.ceil(totalSize / (1024 * 1024)), // 1MB/s estimation
               metadata: {
                   course: {
                       id: course.id || course.course_id,
                       title: course.title,
                       instructor: course.instructor_name,
                       sections_count: course.sections?.length || 0,
                       lessons_count: course.lessons_count || 0
                   },
                   generatedAt: new Date().toISOString(),
                   version: '1.0',
                   method: 'fallback'
               }
           };
           
       } catch (error) {
           console.error('[API] Erreur createCoursePackage:', error);
           
           // Si c'est déjà un objet errorInfo
           if (error.userMessage) {
               return {
                   success: false,
                   error: error.userMessage,
                   type: error.type || 'unknown'
               };
           }
           
           return {
               success: false,
               error: error.message || 'Erreur lors de la création du package',
               type: 'unknown'
           };
       }
   }
       
   // Vérifier le statut d'un package
   async getPackageStatus(packageId) {
       try {
           console.log('[API] Vérification du statut du package:', packageId);
           
           const response = await this.makeRequest({
               method: 'GET',
               url: `/packages/${packageId}/status`
           }, {
               maxRetries: 2
           });
           
           console.log('[API] Statut du package:', response.data);
           
           return {
               success: true,
               status: response.data.status,
               progress: response.data.progress || 0,
               message: response.data.message || '',
               downloadUrl: response.data.download_url,
               expiresAt: response.data.expires_at,
               estimatedTimeRemaining: response.data.estimated_time_remaining || 0
           };
           
       } catch (error) {
           console.error('[API] Erreur lors de la vérification du package:', error);
           
           // Si c'est déjà un objet errorInfo
           if (error.userMessage) {
               return {
                   success: false,
                   error: error.userMessage
               };
           }
           
           return {
               success: false,
               error: error.message
           };
       }
   }
   
   // Télécharger un cours complet
   async downloadCourse(courseId, downloadPath, onProgress, options = {}) {
       try {
           console.log(`[API] Début du téléchargement du cours ${courseId}`);
           console.log('[API] Options de téléchargement:', options);
           
           onProgress && onProgress({ status: 'creating_package', progress: 0 });
           
           const packageResult = await this.createCoursePackage(courseId, options);
           console.log('[API] Résultat createCoursePackage:', {
               success: packageResult.success,
               packageId: packageResult.packageId,
               filesCount: packageResult.files?.length,
               totalSize: packageResult.totalSize,
               hasSecureUrls: packageResult.files?.some(f => f.url?.includes('secure-download'))
           });
           
           if (!packageResult.success) {
               throw new Error(packageResult.error);
           }
           
           if (packageResult.packageId && !packageResult.packageId.startsWith('local-')) {
               let packageReady = false;
               let attempts = 0;
               const maxAttempts = 60;
               
               while (!packageReady && attempts < maxAttempts) {
                   const statusResult = await this.getPackageStatus(packageResult.packageId);
                   
                   if (statusResult.success) {
                       if (statusResult.status === 'ready') {
                           packageReady = true;
                           packageResult.packageUrl = statusResult.downloadUrl;
                       } else if (statusResult.status === 'error') {
                           throw new Error(statusResult.message || 'Erreur lors de la préparation du package');
                       } else {
                           onProgress && onProgress({
                               status: 'preparing_package',
                               progress: statusResult.progress || 0,
                               message: statusResult.message
                           });
                       }
                   }
                   
                   if (!packageReady) {
                       await new Promise(resolve => setTimeout(resolve, 5000));
                       attempts++;
                   }
               }
               
               if (!packageReady) {
                   throw new Error('Timeout lors de la préparation du package');
               }
           }
           
           // Si c'est un package local (approche alternative)
           if (packageResult.packageId && packageResult.packageId.startsWith('local-')) {
               console.log('[API] Utilisation du téléchargement individuel des fichiers');
               
               const coursePath = path.join(downloadPath, `course-${courseId}`);
               await fs.mkdir(coursePath, { recursive: true });
               console.log('[API] Dossier du cours créé:', coursePath);
               
               // Sauvegarder les métadonnées du cours
               if (packageResult.metadata) {
                   await fs.writeFile(
                       path.join(coursePath, 'course-metadata.json'),
                       JSON.stringify(packageResult.metadata, null, 2)
                   );
                   console.log('[API] Métadonnées sauvegardées');
               }
               
               // Télécharger chaque fichier
               let downloadedCount = 0;
               let failedCount = 0;
               const totalFiles = packageResult.files.length;
               const failedFiles = [];
               
               console.log(`[API] Début du téléchargement de ${totalFiles} fichiers`);
               
               for (const file of packageResult.files) {
                   onProgress && onProgress({
                       status: 'downloading',
                       progress: Math.round((downloadedCount / totalFiles) * 100),
                       currentFile: file.name,
                       message: `Téléchargement de ${file.name}`
                   });
                   
                   const filePath = path.join(coursePath, file.name);
                   const fileDir = path.dirname(filePath);
                   await fs.mkdir(fileDir, { recursive: true });
                   
                   try {
                       console.log(`[API] Téléchargement fichier ${downloadedCount + 1}/${totalFiles}: ${file.name}`);
                       
                       // Si c'est un contenu direct (pas une URL)
                       if (file.content && !file.url) {
                           console.log(`[API] Écriture du contenu direct: ${file.name}`);
                           await fs.writeFile(filePath, file.content);
                           downloadedCount++;
                       } else if (file.url) {
                           // Gérer les URLs expirées
                           let currentUrl = file.url;
                           let retryWithRefresh = false;
                           
                           try {
                               await this.downloadFile(
                                   currentUrl,
                                   filePath,
                                   (fileProgress) => {
                                       const overallProgress = Math.round(
                                           ((downloadedCount + (fileProgress.percent / 100)) / totalFiles) * 100
                                       );
                                       onProgress && onProgress({
                                           status: 'downloading',
                                           progress: overallProgress,
                                           currentFile: file.name,
                                           fileProgress: fileProgress.percent,
                                           loaded: fileProgress.loaded,
                                           total: fileProgress.total,
                                           speed: fileProgress.speed
                                       });
                                   },
                                   options
                               );
                               
                               downloadedCount++;
                               console.log(`[API] Fichier téléchargé avec succès: ${file.name}`);
                               
                           } catch (downloadError) {
                               console.error(`[API] Erreur téléchargement ${file.name}:`, downloadError);
                               
                               // Si c'est une erreur de token expiré et qu'on a un lessonId
                               if (downloadError.tokenExpired && file.lessonId && !retryWithRefresh) {
                                   console.log('[API] Token expiré, tentative de rafraîchissement des URLs...');
                                   
                                   try {
                                       const refreshResult = await this.refreshMediaUrls(courseId, [file.id]);
                                       if (refreshResult.success && refreshResult.urls.has(file.id)) {
                                           currentUrl = refreshResult.urls.get(file.id);
                                           retryWithRefresh = true;
                                           
                                           console.log('[API] Nouvelle tentative avec URL rafraîchie');
                                           
                                           // Réessayer avec la nouvelle URL
                                           await this.downloadFile(
                                               currentUrl,
                                               filePath,
                                               (fileProgress) => {
                                                   const overallProgress = Math.round(
                                                       ((downloadedCount + (fileProgress.percent / 100)) / totalFiles) * 100
                                                   );
                                                   onProgress && onProgress({
                                                       status: 'downloading',
                                                       progress: overallProgress,
                                                       currentFile: file.name,
                                                       fileProgress: fileProgress.percent,
                                                       loaded: fileProgress.loaded,
                                                       total: fileProgress.total,
                                                       speed: fileProgress.speed
                                                   });
                                               },
                                               options
                                           );
                                           
                                           downloadedCount++;
                                           console.log(`[API] Fichier téléchargé après rafraîchissement: ${file.name}`);
                                       }
                                   } catch (refreshError) {
                                       console.error('[API] Échec du rafraîchissement:', refreshError);
                                       throw downloadError;
                                   }
                               } else {
                                   throw downloadError;
                               }
                           }
                       }
                   } catch (fileError) {
                       console.error(`[API] Erreur lors du téléchargement de ${file.name}:`, fileError);
                       failedCount++;
                       failedFiles.push({
                           name: file.name,
                           error: fileError.message || 'Erreur inconnue'
                       });
                       // Continuer avec les autres fichiers
                   }
               }
               
               onProgress && onProgress({ 
                   status: 'completed', 
                   progress: 100,
                   downloadedFiles: downloadedCount,
                   failedFiles: failedCount
               });
               
               console.log('[API] Téléchargement terminé:', {
                   downloadedFiles: downloadedCount,
                   failedFiles: failedCount,
                   totalFiles: totalFiles
               });
               
               if (failedCount > 0) {
                   console.warn('[API] Fichiers échoués:', failedFiles);
               }
               
               return {
                   success: true,
                   packagePath: coursePath,
                   packageId: packageResult.packageId,
                   downloadedFiles: downloadedCount,
                   failedFiles: failedCount,
                   failedFilesList: failedFiles,
                   totalFiles: totalFiles,
                   files: packageResult.files,
                   metadata: packageResult.metadata
               };
           }
           
           // Téléchargement du package complet (si l'API le supporte)
           onProgress && onProgress({ status: 'downloading', progress: 0 });
           
           const packagePath = path.join(downloadPath, `course-${courseId}.zip`);
           
           const downloadResult = await this.downloadFile(
               packageResult.packageUrl,
               packagePath,
               (progress) => {
                   onProgress && onProgress({
                       status: 'downloading',
                       progress: progress.percent,
                       loaded: progress.loaded,
                       total: progress.total,
                       speed: progress.speed
                   });
               },
               {
                   ...options,
                   resumable: true,
                   maxRetries: 3
               }
           );
           
           onProgress && onProgress({ status: 'completed', progress: 100 });
           
           console.log('[API] Package complet téléchargé:', downloadResult);
           
           return {
               success: true,
               packagePath: downloadResult.path,
               packageId: packageResult.packageId,
               size: downloadResult.size,
               files: packageResult.files,
               checksums: packageResult.checksums
           };
           
       } catch (error) {
           console.error('[API] Erreur lors du téléchargement du cours:', error);
           onProgress && onProgress({ status: 'error', error: error.message });
           
           return {
               success: false,
               error: error.message,
               type: error.type || 'download_error'
           };
       }
   }
   
   // Obtenir les métriques de performance
   getMetrics() {
       return {
           ...this.metrics,
           isConnected: !!this.token,
           lastRefresh: this.lastSubscriptionCheck,
           hasRefreshToken: !!this.refreshToken
       };
   }
   
   // Test de connectivité
   async testConnection() {
       try {
           console.log('[API] Test de connexion...');
           const startTime = Date.now();
           
           const response = await axios.get(`${this.apiUrl}/wp-json/col-lms/v1/ping`, {
               timeout: 5000
           });
           
           const responseTime = Date.now() - startTime;
           
           console.log('[API] Test de connexion réussi:', {
               responseTime,
               serverTime: response.data.server_time,
               version: response.data.version
           });
           
           return {
               success: true,
               responseTime,
               serverTime: response.data.server_time,
               version: response.data.version || '1.0.0',
               status: response.data.status || 'ok'
           };
       } catch (error) {
           console.error('[API] Test de connexion échoué:', error);
           return {
               success: false,
               error: error.message,
               type: error.type || 'connection_error'
           };
       }
   }
}

module.exports = LearnPressAPIClient;