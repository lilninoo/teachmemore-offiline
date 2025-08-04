// download-manager.js - Gestionnaire de téléchargement amélioré avec système de queue et support des URLs sécurisées
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { createWriteStream, createReadStream } = require('fs');
const zlib = require('zlib');
const sharp = require('sharp'); // Pour la compression d'images
const ffmpeg = require('fluent-ffmpeg'); // Pour la compression vidéo
//const ffmpeg = require('./ffmpeg-wrapper');

class DownloadManager {
    constructor(database, encryption, apiClient) {
        this.db = database;
        this.encryption = encryption;
        this.apiClient = apiClient;

        console.log('[DownloadManager] Initialisation:', {
            hasDatabase: !!database,
            hasEncryption: !!encryption,
            hasApiClient: !!apiClient
        });

        // Configuration de compression
        this.compressionSettings = {
            video: {
                enabled: true,
                quality: 28, // CRF pour x264 (18-28, plus élevé = plus compressé)
                maxWidth: 1280,
                maxHeight: 720,
                codec: 'libx264',
                preset: 'medium'
            },
            image: {
                enabled: true,
                quality: 85,
                maxWidth: 1920,
                maxHeight: 1080,
                format: 'jpeg'
            },
            document: {
                enabled: true,
                pdfCompression: true
            }
        };
        
        // Système de queue amélioré
        this.downloadQueue = [];
        this.activeDownloads = new Map();
        this.pausedDownloads = new Map();
        this.maxConcurrent = 2;
        this.activeCount = 0;
        
        // État de la connexion
        this.isOnline = true;
        this.retryAttempts = new Map();
        this.maxRetries = 3;
        
        // Événements
        this.eventHandlers = new Map();
        
        // Statistiques
        this.statistics = {
            totalDownloaded: 0,
            totalFailed: 0,
            totalSize: 0,
            sessionStartTime: Date.now()
        };
        
        // Démarrer le processeur de queue
        this.startQueueProcessor();
        
        // Surveiller l'état de la connexion
        this.startConnectionMonitor();
        
        console.log('[DownloadManager] Initialisation terminée');
    }
    
    // Système de queue amélioré
    async queueCourseDownload(courseId, options = {}) {
        try {
            console.log('[DownloadManager] ==> queueCourseDownload appelé:', { courseId, options });
            console.log('[DownloadManager] État actuel:', {
                queueLength: this.downloadQueue.length,
                activeCount: this.activeCount,
                activeDownloadsSize: this.activeDownloads.size,
                isOnline: this.isOnline,
                hasApiClient: !!this.apiClient
            });
            
            // Vérifier l'apiClient
            if (!this.apiClient) {
                console.error('[DownloadManager] ERREUR: apiClient non défini !');
                return {
                    success: false,
                    error: 'Client API non initialisé'
                };
            }
            
            // Vérifier la connexion
            if (!this.isOnline) {
                console.log('[DownloadManager] Pas de connexion Internet');
                return {
                    success: false,
                    error: 'Aucune connexion Internet. Le téléchargement démarrera automatiquement lorsque la connexion sera rétablie.'
                };
            }
            
            // Vérifier si le téléchargement n'est pas déjà en cours ou en queue
            const existingDownload = this.findExistingDownload(courseId);
            if (existingDownload) {
                console.log('[DownloadManager] Téléchargement existant trouvé:', {
                    id: existingDownload.id,
                    status: existingDownload.status,
                    progress: existingDownload.progress
                });
                
                if (existingDownload.status === 'paused') {
                    return await this.resumeDownload(existingDownload.id);
                }
                return {
                    success: false,
                    error: 'Ce cours est déjà en téléchargement',
                    downloadId: existingDownload.id,
                    status: existingDownload.status,
                    progress: existingDownload.progress
                };
            }
            
            // Vérifier si le cours n'est pas déjà téléchargé
            const existingCourse = await this.db.getCourse(courseId);
            console.log('[DownloadManager] Cours existant dans DB:', {
                exists: !!existingCourse,
                version: existingCourse?.version,
                forceUpdate: options.forceUpdate
            });
            
            if (existingCourse && !options.forceUpdate) {
                const courseDetails = await this.apiClient.getCourseDetails(courseId);
                const hasUpdate = courseDetails.success && 
                                courseDetails.course.version > (existingCourse.version || 1);
                
                console.log('[DownloadManager] Vérification des mises à jour:', {
                    hasUpdate,
                    currentVersion: existingCourse.version || 1,
                    latestVersion: courseDetails.course?.version || 1
                });
                
                return {
                    success: false,
                    error: 'Le cours est déjà téléchargé',
                    requiresUpdate: hasUpdate,
                    currentVersion: existingCourse.version || 1,
                    latestVersion: courseDetails.course?.version || 1
                };
            }
            
            // Récupérer les détails du cours
            console.log('[DownloadManager] Récupération des détails du cours...');
            const courseDetails = await this.apiClient.getCourseDetails(courseId);
            
            if (!courseDetails.success) {
                console.error('[DownloadManager] Échec récupération détails:', courseDetails);
                throw new Error(courseDetails.error || 'Erreur lors du chargement des détails du cours');
            }
            
            const course = courseDetails.course;
            console.log('[DownloadManager] Cours récupéré:', {
                id: course.id,
                title: course.title,
                sectionsCount: course.sections?.length || 0,
                lessonsCount: course.lessons_count || 0,
                hasMedia: !!(course.sections?.some(s => s.lessons?.some(l => l.media)))
            });
            
            // Estimer la taille du téléchargement
            const estimatedSize = await this.estimateDownloadSize(course, options);
            console.log('[DownloadManager] Taille estimée:', this.formatBytes(estimatedSize));
            
            // Créer l'objet de téléchargement
            const downloadId = `download-${courseId}-${Date.now()}`;
            const download = {
                id: downloadId,
                courseId,
                course: courseDetails.course,
                options: {
                    includeVideos: options.includeVideos !== false,
                    includeDocuments: options.includeDocuments !== false,
                    videoQuality: options.videoQuality || 'high',
                    compress: options.compress || false,
                    priority: options.priority || 5,
                    forceUpdate: options.forceUpdate || false
                },
                status: 'queued',
                progress: 0,
                totalSize: estimatedSize,
                downloadedSize: 0,
                files: [],
                currentFile: null,
                startTime: null,
                pausedAt: null,
                error: null,
                retryCount: 0,
                speed: 0,
                eta: null,
                statistics: {
                    filesDownloaded: 0,
                    filesFailed: 0,
                    compressionSaved: 0
                }
            };
            
            // Ajouter à la queue selon la priorité
            this.insertIntoQueue(download);
            
            const queuePosition = this.getQueuePosition(downloadId);
            console.log('[DownloadManager] Téléchargement ajouté à la queue:', {
                downloadId,
                queuePosition,
                priority: download.options.priority
            });
            
            // Émettre l'événement
            this.emit('download-queued', download);
            
            // Démarrer immédiatement si possible
            if (this.activeCount < this.maxConcurrent) {
                console.log('[DownloadManager] Démarrage immédiat possible');
                setTimeout(() => this.processQueue(), 100);
            }
            
            return {
                success: true,
                downloadId,
                message: 'Téléchargement ajouté à la file d\'attente',
                queuePosition,
                estimatedSize,
                estimatedTime: this.estimateDownloadTime(estimatedSize)
            };
            
        } catch (error) {
            console.error('[DownloadManager] Erreur lors de l\'ajout à la queue:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Estimer la taille du téléchargement
    async estimateDownloadSize(course, options) {
        console.log('[DownloadManager] Estimation de la taille...');
        let totalSize = 0;
        
        // Estimer selon le type de contenu
        if (options.includeVideos) {
            const videoCount = this.countContentType(course, 'video');
            const avgVideoSize = options.compress ? 50 * 1024 * 1024 : 150 * 1024 * 1024; // 50MB ou 150MB
            totalSize += videoCount * avgVideoSize;
            console.log(`[DownloadManager] Vidéos: ${videoCount} x ${this.formatBytes(avgVideoSize)}`);
        }
        
        if (options.includeDocuments) {
            const docCount = this.countContentType(course, 'document');
            const avgDocSize = 5 * 1024 * 1024; // 5MB
            totalSize += docCount * avgDocSize;
            console.log(`[DownloadManager] Documents: ${docCount} x ${this.formatBytes(avgDocSize)}`);
        }
        
        // Ajouter une marge pour les métadonnées
        totalSize += 10 * 1024 * 1024; // 10MB
        
        console.log(`[DownloadManager] Taille totale estimée: ${this.formatBytes(totalSize)}`);
        return totalSize;
    }
    
    // Compter le type de contenu
    countContentType(course, type) {
        let count = 0;
        if (course.sections) {
            for (const section of course.sections) {
                if (section.lessons) {
                    count += section.lessons.filter(l => l.type === type).length;
                }
            }
        }
        return count;
    }
    
    // Estimer le temps de téléchargement
    estimateDownloadTime(size) {
        // Supposer une vitesse moyenne de 5 Mbps
        const avgSpeedBps = 5 * 1024 * 1024 / 8; // 5 Mbps en bytes/sec
        const seconds = Math.ceil(size / avgSpeedBps);
        console.log(`[DownloadManager] Temps estimé: ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
        return seconds;
    }
    
    // Insérer dans la queue selon la priorité
    insertIntoQueue(download) {
        const priority = download.options.priority || 5;
        console.log(`[DownloadManager] Insertion dans queue avec priorité ${priority}`);
        
        // Trouver la position d'insertion
        let insertIndex = this.downloadQueue.length;
        for (let i = 0; i < this.downloadQueue.length; i++) {
            if ((this.downloadQueue[i].options.priority || 5) < priority) {
                insertIndex = i;
                break;
            }
        }
        
        this.downloadQueue.splice(insertIndex, 0, download);
        console.log(`[DownloadManager] Inséré à la position ${insertIndex} sur ${this.downloadQueue.length}`);
    }
    
    // Processeur de queue
    startQueueProcessor() {
        console.log('[DownloadManager] Démarrage du processeur de queue');
        this.queueInterval = setInterval(() => {
            this.processQueue();
        }, 1000); // Vérifier toutes les secondes
    }
    
    async processQueue() {
        // Ne pas traiter si offline
        if (!this.isOnline) {
            return;
        }
        
        // Ne pas dépasser la limite de téléchargements simultanés
        if (this.activeCount >= this.maxConcurrent) {
            return;
        }
        
        // Prendre le prochain téléchargement de la queue
        const nextDownload = this.downloadQueue.find(d => d.status === 'queued');
        if (!nextDownload) {
            return;
        }
        
        console.log('[DownloadManager] ==> DÉMARRAGE TÉLÉCHARGEMENT depuis queue:', {
            downloadId: nextDownload.id,
            courseId: nextDownload.courseId,
            courseTitle: nextDownload.course?.title,
            priority: nextDownload.options.priority,
            queueLength: this.downloadQueue.length
        });
        
        // Démarrer le téléchargement
        this.activeCount++;
        nextDownload.status = 'starting';
        this.activeDownloads.set(nextDownload.id, nextDownload);
        
        // Retirer de la queue
        const index = this.downloadQueue.indexOf(nextDownload);
        if (index > -1) {
            this.downloadQueue.splice(index, 1);
            console.log(`[DownloadManager] Retiré de la queue à l'index ${index}`);
        }
        
        try {
            await this.startDownload(nextDownload);
        } catch (error) {
            console.error('[DownloadManager] Erreur lors du démarrage:', error);
            this.handleDownloadError(nextDownload, error);
        }
    }
    
    // Démarrer un téléchargement
    async startDownload(download) {
        console.log('[DownloadManager] ==> startDownload:', {
            downloadId: download.id,
            courseId: download.courseId,
            status: download.status,
            retryCount: download.retryCount
        });
        
        download.status = 'preparing';
        download.startTime = Date.now();
        this.emit('download-started', download);
        
        try {
            // Vérifier que l'apiClient est disponible
            if (!this.apiClient) {
                console.error('[DownloadManager] ERREUR CRITIQUE: apiClient non disponible !');
                throw new Error('Client API non disponible dans DownloadManager');
            }
            
            const { course, options } = download;
            
            // Créer le dossier du cours
            const coursePath = this.getCoursePath(download.courseId);
            await fs.mkdir(coursePath, { recursive: true });
            console.log('[DownloadManager] Dossier créé:', coursePath);
            
            // Créer les sous-dossiers
            await this.createCourseStructure(coursePath);
            
            // Créer le package côté serveur
            download.status = 'creating-package';
            this.emit('download-progress', download);
            
            console.log('[DownloadManager] Création du package côté serveur...');
            const packageResult = await this.createPackageWithRetry(download);
            console.log('[DownloadManager] Package créé:', {
                success: packageResult.success,
                filesCount: packageResult.files?.length || 0,
                totalSize: this.formatBytes(packageResult.totalSize),
                hasSecureUrls: packageResult.files?.some(f => f.url?.includes('secure-download'))
            });
            
            if (!packageResult.success) {
                throw new Error(packageResult.error || 'Erreur lors de la création du package');
            }
            
            download.totalSize = packageResult.totalSize;
            download.files = packageResult.files;
            
            // Sauvegarder les métadonnées
            await this.saveCourseMetadata(course, coursePath);
            
            // Télécharger les fichiers
            download.status = 'downloading';
            await this.downloadFiles(download, packageResult.files, coursePath);
            
            // Compresser si demandé
            if (options.compress) {
                download.status = 'compressing';
                this.emit('download-progress', download);
                await this.compressDownloadedFiles(coursePath, download);
            }
            
            // Sauvegarder dans la base de données
            await this.saveCourseToDatabase(course, coursePath, download);
            
            // Mettre à jour les statistiques
            this.statistics.totalDownloaded++;
            this.statistics.totalSize += download.totalSize;
            
            // Marquer comme terminé
            download.status = 'completed';
            download.progress = 100;
            download.completedAt = Date.now();
            download.duration = download.completedAt - download.startTime;
            
            this.emit('download-completed', download);
            
            console.log('[DownloadManager] TÉLÉCHARGEMENT TERMINÉ AVEC SUCCÈS:', {
                courseId: download.courseId,
                duration: Math.round(download.duration / 1000) + 's',
                filesDownloaded: download.statistics.filesDownloaded,
                filesFailed: download.statistics.filesFailed,
                compressionSaved: this.formatBytes(download.statistics.compressionSaved)
            });
            
            // Nettoyer
            this.cleanupDownload(download);
            
        } catch (error) {
            console.error('[DownloadManager] ERREUR dans startDownload:', error);
            this.handleDownloadError(download, error);
        }
    }
    
    // Créer la structure des dossiers
    async createCourseStructure(coursePath) {
        console.log('[DownloadManager] Création de la structure des dossiers...');
        const folders = ['videos', 'documents', 'images', 'temp', 'metadata'];
        for (const folder of folders) {
            const folderPath = path.join(coursePath, folder);
            await fs.mkdir(folderPath, { recursive: true });
            console.log(`[DownloadManager] Dossier créé: ${folder}`);
        }
    }
    
    // Télécharger les fichiers avec reprise
    async downloadFiles(download, files, coursePath) {
        console.log('[DownloadManager] ==> downloadFiles appelé:', {
            filesCount: files.length,
            downloadId: download.id,
            courseId: download.courseId,
            coursePath: coursePath
        });
        
        // Log détaillé de chaque fichier
        console.log('[DownloadManager] Fichiers à télécharger:');
        files.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file.name}:`, {
                type: file.type,
                hasUrl: !!file.url,
                hasContent: !!file.content,
                size: this.formatBytes(file.size),
                source: file.source || 'unknown',
                isSecureUrl: file.url?.includes('secure-download'),
                requiresAuth: file.requiresAuth,
                expiresIn: file.expiresIn
            });
        });
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            console.log(`[DownloadManager] >>> Traitement fichier ${i+1}/${files.length}: ${file.name}`, {
                type: file.type,
                hasUrl: !!file.url,
                hasContent: !!file.content,
                url: file.url ? file.url.substring(0, 100) + '...' : 'N/A',
                isSecureUrl: file.url?.includes('secure-download')
            });
            
            // Vérifier si le téléchargement est en pause
            if (download.status === 'paused') {
                console.log('[DownloadManager] Téléchargement en pause');
                throw new Error('Download paused');
            }
            
            // Vérifier la connexion
            if (!this.isOnline) {
                console.log('[DownloadManager] Pas de connexion Internet');
                throw new Error('No internet connection');
            }
            
            download.currentFile = file.name;
            download.currentFileIndex = i;
            
            try {
                // IMPORTANT : Filtrer selon les options de téléchargement
                const shouldDownload = this.shouldDownloadFile(file, download.options);
                
                if (!shouldDownload) {
                    console.log(`[DownloadManager] Fichier ignoré selon les options: ${file.name}`);
                    continue;
                }
                
                const result = await this.downloadFileWithResume(
                    file,
                    coursePath,
                    download,
                    (progress) => {
                        this.updateDownloadProgress(download, i, files.length, progress);
                    }
                );
                
                console.log(`[DownloadManager] Résultat téléchargement ${file.name}:`, {
                    success: result.success,
                    size: result.size ? this.formatBytes(result.size) : 'N/A',
                    encrypted: result.encrypted,
                    resumed: result.resumed
                });
                
                if (result.success) {
                    download.downloadedSize += file.size;
                    download.statistics.filesDownloaded++;
                }
                
            } catch (error) {
                console.error(`[DownloadManager] ERREUR fichier ${file.name}:`, error);
                download.statistics.filesFailed++;
                
                // Si c'est une pause, propager l'erreur
                if (download.status === 'paused') {
                    throw error;
                }
                
                // Pour les erreurs critiques, arrêter
                if (this.shouldAbortOnError(error)) {
                    console.error('[DownloadManager] Erreur critique, arrêt du téléchargement');
                    throw error;
                }
                
                // Sinon, continuer avec les autres fichiers
                console.log('[DownloadManager] Poursuite malgré l\'erreur...');
            }
        }
        
        console.log('[DownloadManager] downloadFiles terminé:', {
            filesDownloaded: download.statistics.filesDownloaded,
            filesFailed: download.statistics.filesFailed,
            totalFiles: files.length
        });
    }

    shouldDownloadFile(file, options) {
        console.log(`[DownloadManager] shouldDownloadFile: ${file.name}`, {
            type: file.type,
            includeVideos: options.includeVideos,
            includeDocuments: options.includeDocuments
        });
        
        // Vérifier le type de fichier
        if (file.type === 'video' && !options.includeVideos) {
            console.log('[DownloadManager] Vidéo ignorée (option)');
            return false;
        }
        
        if ((file.type === 'document' || file.type === 'pdf') && !options.includeDocuments) {
            console.log('[DownloadManager] Document ignoré (option)');
            return false;
        }
        
        // Les fichiers HTML de contenu sont toujours téléchargés
        if (file.type === 'html' || file.type === 'json') {
            console.log('[DownloadManager] Fichier HTML/JSON toujours téléchargé');
            return true;
        }
        
        // Par défaut, télécharger
        return true;
    }
    
    // Télécharger un fichier avec support de la reprise
    async downloadFileWithResume(file, coursePath, download, onProgress) {
        console.log(`[DownloadManager] ==> downloadFileWithResume: ${file.name}`);
        
        const fileType = this.getMediaType(file.name);
        const subFolder = this.getSubFolder(fileType);
        const tempPath = path.join(coursePath, 'temp', file.name);
        const finalPath = path.join(coursePath, subFolder, file.name);
        
        console.log('[DownloadManager] Chemins:', {
            tempPath,
            finalPath,
            fileType,
            subFolder
        });
        
        try {
            // Créer les dossiers
            await fs.mkdir(path.dirname(tempPath), { recursive: true });
            await fs.mkdir(path.dirname(finalPath), { recursive: true });

            // Si le fichier a du contenu direct (pas d'URL)
            if (file.content && !file.url) {
                console.log(`[DownloadManager] Écriture du contenu direct: ${file.name}`);
                
                // Écrire le contenu directement
                await fs.writeFile(tempPath, file.content, 'utf8');
                
                // Simuler la progression
                onProgress({
                    loaded: file.size,
                    total: file.size,
                    percent: 100
                });
                
                // Chiffrer le fichier
                console.log(`[DownloadManager] Chiffrement: ${file.name}`);
                const encryptionResult = await this.encryptFile(tempPath, finalPath, this.db.encryptionKey);
                
                // Supprimer le fichier temporaire
                await fs.unlink(tempPath);
                
                // Sauvegarder les métadonnées
                await this.saveFileMetadata({
                    ...file,
                    encryptionInfo: encryptionResult
                }, finalPath, coursePath);
                
                return {
                    success: true,
                    path: finalPath,
                    encrypted: true
                };
            }
            
            // Si pas d'URL, erreur
            if (!file.url) {
                throw new Error('Aucune URL ou contenu pour le fichier');
            }
            
            console.log(`[DownloadManager] URL de téléchargement: ${file.url.substring(0, 100)}...`);
            console.log(`[DownloadManager] URL sécurisée: ${file.url.includes('secure-download') ? 'OUI' : 'NON'}`);
            
            // Vérifier si le fichier existe déjà partiellement
            let startByte = 0;
            let tempStats = null;
            try {
                tempStats = await fs.stat(tempPath);
                startByte = tempStats.size;
                console.log(`[DownloadManager] Reprise du téléchargement à ${this.formatBytes(startByte)}`);
            } catch (e) {
                // Le fichier n'existe pas, commencer depuis le début
                console.log('[DownloadManager] Nouveau téléchargement (pas de fichier temporaire)');
            }
            
            // Si le fichier est déjà complet
            if (startByte >= file.size) {
                console.log(`[DownloadManager] Fichier déjà téléchargé: ${file.name}`);
                // Chiffrer et déplacer
                await this.encryptFile(tempPath, finalPath, this.db.encryptionKey);
                await fs.unlink(tempPath);
                return { success: true, path: finalPath, encrypted: true, skipped: true };
            }
            
            // Télécharger avec reprise et gestion des tokens expirés
            console.log(`[DownloadManager] Téléchargement: ${file.name} (${this.formatBytes(file.size)})`);
            
            let downloadResult;
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount <= maxRetries) {
                try {
                    console.log(`[DownloadManager] Tentative ${retryCount + 1}/${maxRetries + 1}`);
                    
                    downloadResult = await this.apiClient.downloadFile(
                        file.url,
                        tempPath,
                        (progress) => {
                            const adjustedProgress = {
                                ...progress,
                                loaded: progress.loaded + startByte,
                                total: file.size,
                                percent: ((progress.loaded + startByte) / file.size) * 100
                            };
                            onProgress(adjustedProgress);
                        },
                        {
                            resumable: true,
                            startByte: startByte,
                            expectedSize: file.size
                        }
                    );
                    
                    console.log('[DownloadManager] Téléchargement réussi');
                    break; // Succès, sortir de la boucle
                    
                } catch (downloadError) {
                    console.error(`[DownloadManager] Erreur téléchargement ${file.name}:`, {
                        message: downloadError.message,
                        tokenExpired: downloadError.tokenExpired,
                        needsRefresh: downloadError.needsRefresh,
                        retryCount
                    });
                    
                    // Si c'est une erreur de token expiré et qu'on peut rafraîchir
                    if (downloadError.tokenExpired && file.url?.includes('secure-download') && retryCount < maxRetries) {
                        console.log('[DownloadManager] Token expiré, tentative de rafraîchissement...');
                        
                        try {
                            // Rafraîchir les URLs via l'API
                            const refreshResult = await this.apiClient.refreshMediaUrls(download.courseId, [file.id]);
                            console.log('[DownloadManager] Résultat rafraîchissement:', refreshResult);
                            
                            if (refreshResult.success && refreshResult.urls.has(file.id)) {
                                file.url = refreshResult.urls.get(file.id);
                                console.log('[DownloadManager] URL rafraîchie, nouvelle tentative...');
                                retryCount++;
                                continue;
                            } else {
                                console.error('[DownloadManager] Impossible de rafraîchir l\'URL');
                            }
                        } catch (refreshError) {
                            console.error('[DownloadManager] Échec du rafraîchissement:', refreshError);
                        }
                    }
                    
                    throw downloadError;
                }
            }
            
            if (!downloadResult || !downloadResult.success) {
                throw new Error(downloadResult?.error || 'Échec du téléchargement');
            }
            
            // Vérifier l'intégrité si un checksum est fourni
            if (file.checksum) {
                console.log('[DownloadManager] Vérification du checksum...');
                const isValid = await this.verifyChecksum(tempPath, file.checksum);
                if (!isValid) {
                    console.error('[DownloadManager] Checksum invalide !');
                    throw new Error('Échec de la vérification du checksum');
                }
                console.log('[DownloadManager] Checksum valide');
            }
            
            // Chiffrer le fichier
            console.log(`[DownloadManager] Chiffrement: ${file.name}`);
            const encryptionResult = await this.encryptFile(tempPath, finalPath, this.db.encryptionKey);
            console.log('[DownloadManager] Chiffrement terminé:', encryptionResult);
            
            // Supprimer le fichier temporaire
            await fs.unlink(tempPath);
            console.log('[DownloadManager] Fichier temporaire supprimé');
            
            // Sauvegarder les métadonnées
            await this.saveFileMetadata({
                ...file,
                encryptionInfo: encryptionResult
            }, finalPath, coursePath);
            
            return {
                success: true,
                path: finalPath,
                encrypted: true
            };
            
        } catch (error) {
            console.error(`[DownloadManager] ERREUR téléchargement ${file.name}:`, error);
            
            // Ne pas supprimer le fichier temporaire en cas d'erreur (pour la reprise)
            if (error.message !== 'Download paused') {
                try {
                    // Vérifier si le fichier temporaire est corrompu
                    const stats = await fs.stat(tempPath);
                    if (stats.size === 0) {
                        console.log('[DownloadManager] Suppression du fichier temporaire vide');
                        await fs.unlink(tempPath);
                    }
                } catch (e) {
                    // Ignorer
                }
            }
            
            throw error;
        }
    }
    
    // Nouvelle méthode pour rafraîchir toutes les URLs d'un téléchargement
    async refreshDownloadUrls(download) {
        try {
            console.log('[DownloadManager] ==> refreshDownloadUrls pour le téléchargement');
            
            // Obtenir tous les IDs de médias qui ont besoin d'être rafraîchis
            const mediaIds = download.files
                .filter(f => f.url?.includes('secure-download'))
                .map(f => f.id);
            
            if (mediaIds.length === 0) {
                console.log('[DownloadManager] Aucune URL sécurisée à rafraîchir');
                return { success: true };
            }
            
            console.log(`[DownloadManager] Rafraîchissement de ${mediaIds.length} URLs:`, mediaIds);
            
            // Appeler l'API pour rafraîchir
            const refreshResult = await this.apiClient.refreshMediaUrls(download.courseId, mediaIds);
            console.log('[DownloadManager] Résultat rafraîchissement global:', refreshResult);
            
            if (refreshResult.success) {
                // Mettre à jour les URLs dans les fichiers
                let updatedCount = 0;
                download.files.forEach(file => {
                    if (refreshResult.urls.has(file.id)) {
                        const oldUrl = file.url;
                        file.url = refreshResult.urls.get(file.id);
                        updatedCount++;
                        console.log(`[DownloadManager] URL mise à jour pour: ${file.name}`, {
                            old: oldUrl?.substring(0, 50) + '...',
                            new: file.url?.substring(0, 50) + '...'
                        });
                    }
                });
                
                console.log(`[DownloadManager] ${updatedCount} URLs mises à jour sur ${mediaIds.length}`);
                return { success: true, updatedCount };
            }
            
            return refreshResult;
            
        } catch (error) {
            console.error('[DownloadManager] Erreur lors du rafraîchissement des URLs:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Déterminer le sous-dossier selon le type
    getSubFolder(type) {
        const folders = {
            'video': 'videos',
            'audio': 'videos',
            'document': 'documents',
            'image': 'images',
            'other': 'documents'
        };
        return folders[type] || 'documents';
    }
    
    // Vérifier le checksum d'un fichier
    async verifyChecksum(filePath, expectedChecksum) {
        console.log('[DownloadManager] Vérification checksum...');
        const hash = crypto.createHash('sha256');
        const stream = createReadStream(filePath);
        
        for await (const chunk of stream) {
            hash.update(chunk);
        }
        
        const actualChecksum = hash.digest('hex');
        const isValid = actualChecksum === expectedChecksum;
        
        console.log('[DownloadManager] Checksum:', {
            expected: expectedChecksum,
            actual: actualChecksum,
            valid: isValid
        });
        
        return isValid;
    }
    
    // Chiffrer un fichier
    async encryptFile(inputPath, outputPath, key) {
        console.log('[DownloadManager] Chiffrement du fichier...');
        const algorithm = 'aes-256-gcm';
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
        
        const input = createReadStream(inputPath);
        const output = createWriteStream(outputPath);
        
        // Écrire l'IV au début du fichier
        output.write(iv);
        
        // Chiffrer le fichier
        await pipeline(input, cipher, output);
        
        // Ajouter le tag d'authentification
        const authTag = cipher.getAuthTag();
        await fs.appendFile(outputPath, authTag);
        
        const result = {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            algorithm
        };
        
        console.log('[DownloadManager] Chiffrement terminé:', {
            algorithm,
            ivLength: iv.length,
            authTagLength: authTag.length
        });
        
        return result;
    }
    
    // Compresser les fichiers téléchargés
    async compressDownloadedFiles(coursePath, download) {
        console.log('[DownloadManager] Début de la compression...');
        
        const videosPath = path.join(coursePath, 'videos');
        const imagesPath = path.join(coursePath, 'images');
        
        let savedSpace = 0;
        
        // Compresser les vidéos
        if (download.options.includeVideos && this.compressionSettings.video.enabled) {
            try {
                const videoFiles = await fs.readdir(videosPath);
                console.log(`[DownloadManager] ${videoFiles.length} vidéos à compresser`);
                
                for (const file of videoFiles) {
                    const filePath = path.join(videosPath, file);
                    const originalSize = (await fs.stat(filePath)).size;
                    
                    console.log(`[DownloadManager] Compression vidéo: ${file}`);
                    await this.compressVideo(filePath);
                    
                    const newSize = (await fs.stat(filePath)).size;
                    savedSpace += originalSize - newSize;
                    
                    console.log(`[DownloadManager] Vidéo compressée: ${this.formatBytes(originalSize)} -> ${this.formatBytes(newSize)}`);
                }
            } catch (e) {
                console.error('[DownloadManager] Erreur compression vidéos:', e);
            }
        }
        
        // Compresser les images
        if (this.compressionSettings.image.enabled) {
            try {
                const imageFiles = await fs.readdir(imagesPath);
                console.log(`[DownloadManager] ${imageFiles.length} images à compresser`);
                
                for (const file of imageFiles) {
                    const filePath = path.join(imagesPath, file);
                    const originalSize = (await fs.stat(filePath)).size;
                    
                    console.log(`[DownloadManager] Compression image: ${file}`);
                    await this.compressImage(filePath);
                    
                    const newSize = (await fs.stat(filePath)).size;
                    savedSpace += originalSize - newSize;
                    
                    console.log(`[DownloadManager] Image compressée: ${this.formatBytes(originalSize)} -> ${this.formatBytes(newSize)}`);
                }
            } catch (e) {
                console.error('[DownloadManager] Erreur compression images:', e);
            }
        }
        
        download.statistics.compressionSaved = savedSpace;
        console.log(`[DownloadManager] Espace économisé par compression: ${this.formatBytes(savedSpace)}`);
    }
    
    // Compresser une vidéo
    async compressVideo(filePath) {
        return new Promise((resolve, reject) => {
            const tempPath = filePath + '.tmp';
            const settings = this.compressionSettings.video;
            
            console.log('[DownloadManager] Compression vidéo avec ffmpeg:', {
                input: filePath,
                output: tempPath,
                settings
            });
            
            ffmpeg(filePath)
                .outputOptions([
                    `-c:v ${settings.codec}`,
                    `-crf ${settings.quality}`,
                    `-preset ${settings.preset}`,
                    `-vf scale='min(${settings.maxWidth},iw)':'min(${settings.maxHeight},ih)'`,
                    '-c:a aac',
                    '-b:a 128k'
                ])
                .save(tempPath)
                .on('end', async () => {
                    try {
                        await fs.unlink(filePath);
                        await fs.rename(tempPath, filePath);
                        console.log('[DownloadManager] Compression vidéo terminée');
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('error', (err) => {
                    console.error('[DownloadManager] Erreur ffmpeg:', err);
                    reject(err);
                });
        });
    }
    
    // Compresser une image
    async compressImage(filePath) {
        const settings = this.compressionSettings.image;
        const tempPath = filePath + '.tmp';
        
        console.log('[DownloadManager] Compression image avec sharp:', {
            input: filePath,
            settings
        });
        
        await sharp(filePath)
            .resize(settings.maxWidth, settings.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: settings.quality })
            .toFile(tempPath);
        
        await fs.unlink(filePath);
        await fs.rename(tempPath, filePath);
        
        console.log('[DownloadManager] Compression image terminée');
    }
    
    // Créer le package avec retry
    async createPackageWithRetry(download) {
        let lastError;
        const maxAttempts = 3;
        
        console.log('[DownloadManager] ==> createPackageWithRetry');
        
        for (let i = 0; i < maxAttempts; i++) {
            try {
                console.log(`[DownloadManager] Tentative création package ${i + 1}/${maxAttempts}`);
                
                // Utiliser l'API createCoursePackage qui gère maintenant les URLs sécurisées
                console.log('[DownloadManager] Appel de createCoursePackage...');
                const packageResult = await this.apiClient.createCoursePackage(download.courseId, download.options);
                
                if (!packageResult.success) {
                    throw new Error(packageResult.error || 'Erreur lors de la création du package');
                }
                
                console.log('[DownloadManager] Package créé avec succès:', {
                    filesCount: packageResult.files?.length || 0,
                    totalSize: this.formatBytes(packageResult.totalSize),
                    hasVideos: packageResult.files?.some(f => f.type === 'video'),
                    hasSecureUrls: packageResult.files?.some(f => f.url?.includes('secure-download'))
                });
                
                // Log détaillé des fichiers avec URLs sécurisées
                if (packageResult.files && packageResult.files.length > 0) {
                    console.log('[DownloadManager] Fichiers dans le package:');
                    packageResult.files.forEach((file, index) => {
                        console.log(`  ${index + 1}. ${file.name} (${file.type})`, {
                            hasUrl: !!file.url,
                            isSecureUrl: file.url?.includes('secure-download'),
                            requiresAuth: file.requiresAuth,
                            expiresIn: file.expiresIn,
                            source: file.source
                        });
                    });
                }
                
                return packageResult;
                
            } catch (error) {
                lastError = error;
                console.error(`[DownloadManager] Erreur création package (tentative ${i + 1}):`, error);
            }
            
            if (i < maxAttempts - 1) {
                const delay = 2000 * (i + 1);
                console.log(`[DownloadManager] Attente ${delay}ms avant nouvelle tentative...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
        
    // Sauvegarder les métadonnées du cours
    async saveCourseMetadata(course, coursePath) {
        console.log('[DownloadManager] Sauvegarde des métadonnées du cours...');
        
        const metadata = {
            id: course.id,
            title: course.title,
            description: course.description,
            instructor: {
                id: course.instructor_id || course.instructor?.id,
                name: course.instructor_name || course.instructor?.name || 'Instructeur'
            },
            thumbnail: course.thumbnail,
            sections: course.sections?.map(section => ({
                id: section.id,
                title: section.title,
                order: section.order || section.order_index || 0,
                lessons: section.lessons?.map(lesson => ({
                    id: lesson.id,
                    title: lesson.title,
                    type: lesson.type,
                    duration: lesson.duration,
                    order: lesson.order || lesson.order_index || 0,
                    hasVideo: lesson.type === 'video',
                    hasAttachments: (lesson.attachments?.length || 0) > 0
                }))
            })),
            statistics: {
                sectionsCount: course.sections?.length || 0,
                lessonsCount: course.lessons_count || 0,
                totalDuration: course.duration || 0,
                videosCount: this.countContentType(course, 'video'),
                documentsCount: this.countContentType(course, 'document')
            },
            downloadedAt: new Date().toISOString(),
            version: course.version || 1,
            expiresAt: course.expires_at || null
        };
        
        const metadataPath = path.join(coursePath, 'metadata', 'course.json');
        await fs.mkdir(path.dirname(metadataPath), { recursive: true });
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        
        // Chiffrer le fichier de métadonnées
        const encryptedPath = metadataPath + '.enc';
        await this.encryptFile(metadataPath, encryptedPath, this.db.encryptionKey);
        await fs.unlink(metadataPath);
        
        console.log('[DownloadManager] Métadonnées sauvegardées et chiffrées');
    }
    
    // Sauvegarder les métadonnées d'un fichier
    async saveFileMetadata(file, encryptedPath, coursePath) {
        console.log(`[DownloadManager] Sauvegarde métadonnées fichier: ${file.name}`);
        
        const metadata = {
            originalName: file.name,
            encryptedPath: path.relative(coursePath, encryptedPath),
            size: file.size,
            mimeType: file.mimeType || 'application/octet-stream',
            checksum: file.checksum,
            encryptionInfo: file.encryptionInfo,
            downloadedAt: new Date().toISOString()
        };
        
        // Ajouter au manifest
        const manifestPath = path.join(coursePath, 'metadata', 'manifest.json');
        let manifest = { files: [], version: 1 };
        
        try {
            const encManifestPath = manifestPath + '.enc';
            if (await fs.access(encManifestPath).then(() => true).catch(() => false)) {
                // Déchiffrer le manifest existant
                const decrypted = await this.decryptFile(encManifestPath, this.db.encryptionKey);
                manifest = JSON.parse(decrypted);
            }
        } catch (e) {
            console.log('[DownloadManager] Nouveau manifest');
        }
        
        // Ajouter ou mettre à jour le fichier
        const existingIndex = manifest.files.findIndex(f => f.originalName === file.name);
        if (existingIndex >= 0) {
            manifest.files[existingIndex] = metadata;
        } else {
            manifest.files.push(metadata);
        }
        
        // Sauvegarder et chiffrer
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        const encManifestPath = manifestPath + '.enc';
        await this.encryptFile(manifestPath, encManifestPath, this.db.encryptionKey);
        await fs.unlink(manifestPath);
        
        console.log('[DownloadManager] Métadonnées fichier sauvegardées');
    }
    
    // Déchiffrer un fichier (pour la lecture)
    async decryptFile(encryptedPath, key) {
        console.log('[DownloadManager] Déchiffrement du fichier...');
        
        const data = await fs.readFile(encryptedPath);
        const iv = data.slice(0, 16);
        const authTag = data.slice(-16);
        const encrypted = data.slice(16, -16);
        
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(key, 'hex'),
            iv
        );
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        
        return decrypted.toString('utf8');
    }
    
    // Sauvegarder le cours dans la base de données
    async saveCourseToDatabase(course, coursePath, download) {
        try {
            console.log('[DownloadManager] ==> Sauvegarde du cours dans la base de données...');
            
            // Préparer les données du cours
            const courseData = {
                course_id: course.id || course.course_id,
                title: course.title || 'Sans titre',
                description: course.description || '',
                thumbnail_encrypted: null,
                instructor_name: course.instructor_name || course.instructor?.name || 'Instructeur',
                instructor_id: course.instructor_id || course.instructor?.id || null,
                lessons_count: course.lessons_count || 0,
                sections_count: course.sections?.length || course.sections_count || 0,
                duration: course.duration || null,
                difficulty_level: course.difficulty_level || course.difficulty || 'intermediate',
                category: course.category || null,
                tags: JSON.stringify(course.tags || []),
                price: course.price || 0,
                currency: course.currency || 'EUR',
                downloaded_at: new Date().toISOString(),
                last_accessed: new Date().toISOString(),
                expires_at: course.expires_at || null,
                version: course.version || 1,
                checksum: null,
                metadata: JSON.stringify({
                    download_size: download.totalSize,
                    download_duration: download.duration || null,
                    download_date: new Date().toISOString(),
                    files_count: download.files?.length || 0
                }),
                file_size: download.totalSize || 0,
                download_progress: 100,
                is_favorite: 0,
                rating: course.rating || 0,
                completion_percentage: 0,
                local_path: coursePath,
                is_synced: 0
            };
            
            console.log('[DownloadManager] Données du cours préparées:', {
                course_id: courseData.course_id,
                title: courseData.title,
                sections_count: courseData.sections_count,
                file_size: this.formatBytes(courseData.file_size)
            });
            
            // Gérer la miniature
            if (course.thumbnail) {
                let thumbnailUrl = null;
                
                if (typeof course.thumbnail === 'string') {
                    thumbnailUrl = course.thumbnail;
                } else if (course.thumbnail && typeof course.thumbnail === 'object') {
                    thumbnailUrl = course.thumbnail.url || 
                                  course.thumbnail.full || 
                                  course.thumbnail.large || 
                                  course.thumbnail.medium;
                }
                
                if (thumbnailUrl && typeof thumbnailUrl === 'string' && thumbnailUrl !== 'false') {
                    courseData.thumbnail_encrypted = this.encryption.encrypt(thumbnailUrl, this.db.encryptionKey);
                    console.log('[DownloadManager] Miniature chiffrée');
                }
            }
            
            // Sauvegarder le cours principal
            await this.db.saveCourse(courseData);
            console.log('[DownloadManager] Cours sauvegardé avec succès');
            
            // Sauvegarder les sections et leçons
            if (course.sections && Array.isArray(course.sections)) {
                console.log(`[DownloadManager] Sauvegarde de ${course.sections.length} sections...`);
                
                for (const section of course.sections) {
                    const sectionData = {
                        section_id: section.id || section.section_id,
                        course_id: course.id || course.course_id,
                        title: section.title || 'Section sans titre',
                        description: section.description || '',
                        order_index: section.order || section.order_index || 0,
                        lessons_count: section.lessons?.length || section.lessons_count || 0,
                        duration: section.duration || null,
                        created_at: new Date().toISOString()
                    };
                    
                    await this.db.saveSection(sectionData);
                    console.log(`[DownloadManager] Section sauvegardée: ${sectionData.title}`);
                    
                    if (section.lessons && Array.isArray(section.lessons)) {
                        console.log(`[DownloadManager] Sauvegarde de ${section.lessons.length} leçons...`);
                        
                        for (const lesson of section.lessons) {
                            const lessonData = {
                                lesson_id: lesson.id || lesson.lesson_id,
                                section_id: section.id || section.section_id,
                                title: lesson.title || 'Leçon sans titre',
                                type: lesson.type || 'text',
                                content_encrypted: lesson.content ? 
                                    this.encryption.encrypt(JSON.stringify(lesson.content), this.db.encryptionKey) : null,
                                duration: lesson.duration || null,
                                order_index: lesson.order || lesson.order_index || 0,
                                completed: 0,
                                completed_at: null,
                                progress: 0,
                                last_position: 0,
                                preview: lesson.preview ? 1 : 0,
                                points: lesson.points || 0,
                                attachments: JSON.stringify(lesson.attachments || []),
                                difficulty: lesson.difficulty || 'normal',
                                estimated_time: lesson.estimated_time || 0,
                                views_count: 0,
                                notes_count: 0,
                                bookmarks: JSON.stringify([]),
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            };
                            
                            await this.db.saveLesson(lessonData);
                        }
                    }
                }
            }
            
            // Sauvegarder les informations des fichiers
            if (download.files && Array.isArray(download.files)) {
                console.log(`[DownloadManager] Sauvegarde de ${download.files.length} médias...`);
                
                for (const file of download.files) {
                    const fileType = this.getMediaType(file.name);
                    const subFolder = this.getSubFolder(fileType);
                    const encryptedPath = path.join(coursePath, subFolder, file.name);
                    
                    const mediaData = {
                        media_id: crypto.randomBytes(16).toString('hex'),
                        lesson_id: file.lessonId || null,
                        course_id: course.id || course.course_id,
                        type: fileType,
                        filename: file.name,
                        original_filename: file.originalName || file.name,
                        path_encrypted: this.encryption.encrypt(encryptedPath, this.db.encryptionKey),
                        url_encrypted: file.url ? this.encryption.encrypt(file.url, this.db.encryptionKey) : null,
                        size: file.size || 0,
                        mime_type: file.mimeType || 'application/octet-stream',
                        duration: file.duration || null,
                        resolution: file.resolution || null,
                        bitrate: file.bitrate || null,
                        quality: file.quality || null,
                        checksum: file.checksum || null,
                        thumbnail_path: file.thumbnailPath || null,
                        download_priority: file.priority || 5,
                        downloaded_at: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    };
                    
                    await this.db.saveMedia(mediaData);
                }
            }
            
            // Ajouter une entrée dans les statistiques d'utilisation
            await this.db.db.prepare(`
                INSERT INTO usage_stats (event_type, entity_type, entity_id, metadata, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                'course_downloaded',
                'course',
                course.id || course.course_id,
                JSON.stringify({
                    download_duration: download.duration,
                    total_size: download.totalSize,
                    files_count: download.files?.length || 0,
                    compression_saved: download.statistics?.compressionSaved || 0
                }),
                new Date().toISOString()
            );
            
            console.log(`[DownloadManager] Cours ${course.id} sauvegardé complètement dans la DB`);
            
        } catch (error) {
            console.error('[DownloadManager] ERREUR lors de la sauvegarde dans la DB:', error);
            throw error;
        }
    }
    
    // Déterminer le type de média
    getMediaType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'];
        const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
        const docExts = ['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx', '.xls', '.xlsx'];
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp', '.webp'];
        
        if (videoExts.includes(ext)) return 'video';
        if (audioExts.includes(ext)) return 'audio';
        if (docExts.includes(ext)) return 'document';
        if (imageExts.includes(ext)) return 'image';
        
        return 'other';
    }
    
    // Pause d'un téléchargement
    async pauseDownload(downloadId) {
        console.log('[DownloadManager] Pause du téléchargement:', downloadId);
        
        const download = this.activeDownloads.get(downloadId);
        if (!download || download.status !== 'downloading') {
            console.log('[DownloadManager] Téléchargement non trouvé ou non actif');
            return { success: false, error: 'Téléchargement non trouvé ou non actif' };
        }
        
        download.status = 'paused';
        download.pausedAt = Date.now();
        
        // Déplacer vers les téléchargements en pause
        this.pausedDownloads.set(downloadId, download);
        this.activeDownloads.delete(downloadId);
        this.activeCount--;
        
        this.emit('download-paused', download);
        
        console.log('[DownloadManager] Téléchargement mis en pause');
        
        // Traiter la queue
        this.processQueue();
        
        return { success: true, message: 'Téléchargement mis en pause' };
    }
    
    // Reprendre un téléchargement
    async resumeDownload(downloadId) {
        console.log('[DownloadManager] Reprise du téléchargement:', downloadId);
        
        const download = this.pausedDownloads.get(downloadId);
        if (!download) {
            console.log('[DownloadManager] Téléchargement en pause non trouvé');
            return { success: false, error: 'Téléchargement en pause non trouvé' };
        }
        
        // Vérifier si on peut reprendre
        if (this.activeCount >= this.maxConcurrent) {
            console.log('[DownloadManager] Limite de téléchargements simultanés atteinte, ajout à la queue');
            
            // Ajouter à la queue avec priorité élevée
            download.status = 'queued';
            download.options.priority = 10; // Priorité élevée pour la reprise
            this.insertIntoQueue(download);
            this.pausedDownloads.delete(downloadId);
            
            return {
                success: true,
                message: 'Téléchargement ajouté à la queue',
                queuePosition: this.getQueuePosition(downloadId)
            };
        }
        
        // Reprendre immédiatement
        download.status = 'resuming';
        download.pausedAt = null;
        
        this.pausedDownloads.delete(downloadId);
        this.activeDownloads.set(downloadId, download);
        this.activeCount++;
        
        this.emit('download-resumed', download);
        
        console.log('[DownloadManager] Reprise immédiate du téléchargement');
        
// Reprendre le téléchargement
       this.startDownload(download);
       
       return { success: true, message: 'Téléchargement repris' };
   }
   
   // Annuler un téléchargement
   async cancelDownload(downloadId, deleteFiles = false) {
       console.log('[DownloadManager] Annulation du téléchargement:', downloadId, { deleteFiles });
       
       let download = this.activeDownloads.get(downloadId);
       
       if (!download) {
           download = this.pausedDownloads.get(downloadId);
           if (download) {
               this.pausedDownloads.delete(downloadId);
               console.log('[DownloadManager] Téléchargement trouvé dans pausedDownloads');
           } else {
               // Chercher dans la queue
               const index = this.downloadQueue.findIndex(d => d.id === downloadId);
               if (index > -1) {
                   download = this.downloadQueue[index];
                   this.downloadQueue.splice(index, 1);
                   console.log('[DownloadManager] Téléchargement trouvé dans la queue');
               }
           }
       } else {
           this.activeDownloads.delete(downloadId);
           this.activeCount--;
           console.log('[DownloadManager] Téléchargement trouvé dans activeDownloads');
       }
       
       if (!download) {
           console.log('[DownloadManager] Téléchargement non trouvé');
           return { success: false, error: 'Téléchargement non trouvé' };
       }
       
       download.status = 'cancelled';
       this.emit('download-cancelled', download);
       
       // Nettoyer les fichiers si demandé
       if (deleteFiles) {
           try {
               const coursePath = this.getCoursePath(download.courseId);
               console.log('[DownloadManager] Suppression des fichiers:', coursePath);
               await fs.rmdir(coursePath, { recursive: true });
               console.log('[DownloadManager] Fichiers supprimés');
           } catch (error) {
               console.error('[DownloadManager] Erreur lors de la suppression des fichiers:', error);
           }
       }
       
       // Traiter la queue si nécessaire
       if (this.activeCount < this.maxConcurrent) {
           this.processQueue();
       }
       
       console.log('[DownloadManager] Téléchargement annulé avec succès');
       return { success: true, message: 'Téléchargement annulé' };
   }
   
   // Gestion des erreurs avec retry
   async handleDownloadError(download, error) {
       console.error('[DownloadManager] ==> handleDownloadError:', {
           downloadId: download.id,
           courseId: download.courseId,
           error: error.message,
           tokenExpired: error.tokenExpired,
           retryCount: download.retryCount
       });
       
       download.error = error.message;
       download.lastErrorAt = Date.now();
       
       // Si c'est une pause, ne pas réessayer
       if (download.status === 'paused') {
           console.log('[DownloadManager] Téléchargement en pause, pas de retry');
           return;
       }
       
       // Si c'est une erreur de token expiré, essayer de rafraîchir toutes les URLs
       if (error.tokenExpired && download.files?.some(f => f.url?.includes('secure-download'))) {
           console.log('[DownloadManager] Erreur de token détectée, rafraîchissement global des URLs...');
           
           const refreshResult = await this.refreshDownloadUrls(download);
           if (refreshResult.success) {
               console.log('[DownloadManager] URLs rafraîchies, reprise du téléchargement...');
               download.retryCount++;
               return this.startDownload(download);
           } else {
               console.error('[DownloadManager] Échec du rafraîchissement des URLs');
           }
       }
       
       // Si c'est une erreur réseau et qu'on peut réessayer
       if (this.isRetryableError(error) && download.retryCount < this.maxRetries) {
           download.retryCount++;
           download.status = 'retrying';
           
           console.log(`[DownloadManager] Nouvelle tentative (${download.retryCount}/${this.maxRetries})`);
           
           this.emit('download-retry', download);
           
           // Attendre avant de réessayer (backoff exponentiel)
           const delay = Math.min(1000 * Math.pow(2, download.retryCount), 30000);
           console.log(`[DownloadManager] Attente de ${delay}ms avant retry...`);
           
           await new Promise(resolve => setTimeout(resolve, delay));
           
           // Vérifier si toujours actif
           if (this.activeDownloads.has(download.id)) {
               console.log('[DownloadManager] Reprise après retry...');
               return this.startDownload(download);
           }
       }
       
       // Échec définitif
       download.status = 'error';
       download.failedAt = Date.now();
       this.statistics.totalFailed++;
       
       console.error('[DownloadManager] Échec définitif du téléchargement');
       
       this.emit('download-error', download);
       this.cleanupDownload(download);
   }
   
   // Vérifier si l'erreur est récupérable
   isRetryableError(error) {
       const retryableErrors = [
           'ECONNRESET',
           'ETIMEDOUT',
           'ENOTFOUND',
           'ECONNREFUSED',
           'No internet connection',
           'EHOSTUNREACH',
           'ENETUNREACH',
           'EPIPE',
           'ERR_STREAM_PREMATURE_CLOSE',
           'Token de téléchargement expiré'
       ];
       
       // Ajouter aussi la vérification de la propriété tokenExpired
       if (error.tokenExpired) {
           console.log('[DownloadManager] Erreur avec tokenExpired = true, retry possible');
           return true;
       }
       
       const isRetryable = retryableErrors.some(e => 
           error.code === e || error.message?.includes(e)
       );
       
       console.log('[DownloadManager] isRetryableError:', {
           errorCode: error.code,
           errorMessage: error.message,
           isRetryable
       });
       
       return isRetryable;
   }
   
   // Vérifier si on doit abandonner après une erreur
   shouldAbortOnError(error) {
       const criticalErrors = [
           'ENOSPC', // Espace disque insuffisant
           'EACCES', // Permission refusée
           'EPERM',  // Opération non permise
           'Encryption failed',
           'Invalid course data',
           'ENOMEM' // Mémoire insuffisante
       ];
       
       const shouldAbort = criticalErrors.some(e => 
           error.code === e || error.message?.includes(e)
       );
       
       console.log('[DownloadManager] shouldAbortOnError:', {
           errorCode: error.code,
           errorMessage: error.message,
           shouldAbort
       });
       
       return shouldAbort;
   }
   
   // Nettoyer après un téléchargement
   cleanupDownload(download) {
       console.log('[DownloadManager] Nettoyage du téléchargement:', download.id);
       
       this.activeDownloads.delete(download.id);
       this.activeCount--;
       
       // Supprimer des retry attempts
       this.retryAttempts.delete(download.id);
       
       // Nettoyer les fichiers temporaires
       this.cleanupTempFiles(download.courseId).catch(console.error);
       
       console.log('[DownloadManager] Nettoyage terminé, traitement de la queue...');
       
       // Traiter la queue
       setTimeout(() => {
           this.processQueue();
       }, 100);
   }
   
   // Nettoyer les fichiers temporaires
   async cleanupTempFiles(courseId) {
       try {
           console.log('[DownloadManager] Nettoyage des fichiers temporaires pour le cours:', courseId);
           
           const coursePath = this.getCoursePath(courseId);
           const tempPath = path.join(coursePath, 'temp');
           
           const files = await fs.readdir(tempPath).catch(() => []);
           console.log(`[DownloadManager] ${files.length} fichiers temporaires trouvés`);
           
           for (const file of files) {
               await fs.unlink(path.join(tempPath, file)).catch(() => {});
           }
           
           console.log('[DownloadManager] Fichiers temporaires nettoyés');
       } catch (e) {
           // Ignorer les erreurs
           console.log('[DownloadManager] Pas de fichiers temporaires à nettoyer');
       }
   }
   
   // Trouver un téléchargement existant
   findExistingDownload(courseId) {
       console.log('[DownloadManager] Recherche de téléchargement existant pour le cours:', courseId);
       
       // Vérifier dans les téléchargements actifs
       for (const [id, download] of this.activeDownloads) {
           if (download.courseId === courseId) {
               console.log('[DownloadManager] Trouvé dans activeDownloads:', id);
               return download;
           }
       }
       
       // Vérifier dans la queue
       const queuedDownload = this.downloadQueue.find(d => d.courseId === courseId);
       if (queuedDownload) {
           console.log('[DownloadManager] Trouvé dans la queue:', queuedDownload.id);
           return queuedDownload;
       }
       
       // Vérifier dans les téléchargements en pause
       for (const [id, download] of this.pausedDownloads) {
           if (download.courseId === courseId) {
               console.log('[DownloadManager] Trouvé dans pausedDownloads:', id);
               return download;
           }
       }
       
       console.log('[DownloadManager] Aucun téléchargement existant trouvé');
       return null;
   }
   
   // Obtenir la position dans la queue
   getQueuePosition(downloadId) {
       const index = this.downloadQueue.findIndex(d => d.id === downloadId);
       return index === -1 ? -1 : index + 1;
   }
   
   // Obtenir le chemin du cours
   getCoursePath(courseId) {
       const coursesDir = path.join(
           path.dirname(this.db.dbPath),
           'courses'
       );
       return path.join(coursesDir, `course-${courseId}`);
   }
   
   // Mettre à jour la progression
   updateDownloadProgress(download, fileIndex, totalFiles, fileProgress) {
       const fileWeight = 1 / totalFiles;
       const baseProgress = (fileIndex / totalFiles) * 100;
       const currentFileProgress = (fileProgress.percent || 0) * fileWeight;
       
       download.progress = Math.min(Math.round(baseProgress + currentFileProgress), 100);
       download.speed = fileProgress.speed || 0;
       download.eta = this.calculateETA(download);
       
       // Mettre à jour les statistiques de vitesse
       if (download.speed > 0) {
           if (!download.speedHistory) download.speedHistory = [];
           download.speedHistory.push(download.speed);
           
           // Garder seulement les 10 dernières mesures
           if (download.speedHistory.length > 10) {
               download.speedHistory.shift();
           }
           
           // Calculer la vitesse moyenne
           download.avgSpeed = download.speedHistory.reduce((a, b) => a + b, 0) / download.speedHistory.length;
       }
       
       // Log périodique de la progression (tous les 5%)
       if (download.progress % 5 === 0 && download.lastLoggedProgress !== download.progress) {
           console.log(`[DownloadManager] Progression: ${download.progress}%`, {
               currentFile: download.currentFile,
               speed: this.formatBytes(download.speed) + '/s',
               eta: download.eta ? `${Math.floor(download.eta / 60)}m ${download.eta % 60}s` : 'N/A'
           });
           download.lastLoggedProgress = download.progress;
       }
       
       this.emit('download-progress', download);
   }
   
   // Calculer le temps restant estimé
   calculateETA(download) {
       if (!download.speed || download.speed === 0) return null;
       
       const remainingSize = download.totalSize - download.downloadedSize;
       const remainingSeconds = remainingSize / (download.avgSpeed || download.speed);
       
       return Math.round(remainingSeconds);
   }
   
   // Formater la taille en octets
   formatBytes(bytes) {
       if (bytes === 0) return '0 B';
       
       const k = 1024;
       const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
       const i = Math.floor(Math.log(bytes) / Math.log(k));
       
       return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
   }
   
   // Obtenir l'état d'un téléchargement
   getDownloadStatus(downloadId) {
       console.log('[DownloadManager] getDownloadStatus:', downloadId);
       
       const download = this.activeDownloads.get(downloadId) || 
                       this.pausedDownloads.get(downloadId) ||
                       this.downloadQueue.find(d => d.id === downloadId);
       
       if (download) {
           console.log('[DownloadManager] Téléchargement trouvé:', {
               status: download.status,
               progress: download.progress,
               location: this.activeDownloads.has(downloadId) ? 'active' :
                        this.pausedDownloads.has(downloadId) ? 'paused' : 'queue'
           });
       } else {
           console.log('[DownloadManager] Téléchargement non trouvé');
       }
       
       return download;
   }
   
   // Obtenir tous les téléchargements
   getAllDownloads() {
       console.log('[DownloadManager] getAllDownloads appelé');
       
       const all = [];
       
       // Actifs
       for (const [id, download] of this.activeDownloads) {
           all.push({ ...download, location: 'active' });
       }
       
       // En pause
       for (const [id, download] of this.pausedDownloads) {
           all.push({ ...download, location: 'paused' });
       }
       
       // En queue
       all.push(...this.downloadQueue.map(d => ({ ...d, location: 'queue' })));
       
       console.log('[DownloadManager] Total téléchargements:', {
           total: all.length,
           active: this.activeDownloads.size,
           paused: this.pausedDownloads.size,
           queued: this.downloadQueue.length
       });
       
       // Trier par statut et priorité
       return all.sort((a, b) => {
           const statusOrder = {
               'downloading': 0,
               'preparing': 1,
               'creating-package': 2,
               'compressing': 3,
               'paused': 4,
               'queued': 5,
               'error': 6,
               'completed': 7
           };
           
           const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
           if (statusDiff !== 0) return statusDiff;
           
           return (b.options?.priority || 5) - (a.options?.priority || 5);
       });
   }
   
   // Obtenir les statistiques
   getStatistics() {
       const activeStats = {
           active: this.activeCount,
           queued: this.downloadQueue.length,
           paused: this.pausedDownloads.size,
           total: this.activeCount + this.downloadQueue.length + this.pausedDownloads.size
       };
       
       const stats = {
           ...this.statistics,
           ...activeStats,
           sessionDuration: Date.now() - this.statistics.sessionStartTime,
           averageSpeed: this.calculateAverageSpeed()
       };
       
       console.log('[DownloadManager] Statistiques:', stats);
       
       return stats;
   }
   
   // Calculer la vitesse moyenne
   calculateAverageSpeed() {
       let totalSpeed = 0;
       let count = 0;
       
       for (const [id, download] of this.activeDownloads) {
           if (download.avgSpeed > 0) {
               totalSpeed += download.avgSpeed;
               count++;
           }
       }
       
       return count > 0 ? totalSpeed / count : 0;
   }
   
   // Surveiller l'état de la connexion
   startConnectionMonitor() {
       console.log('[DownloadManager] Démarrage du moniteur de connexion');
       
       this.connectionInterval = setInterval(async () => {
           const wasOnline = this.isOnline;
           
           // Vérifier la connexion en essayant de résoudre un DNS
           try {
               await require('dns').promises.resolve4('google.com');
               this.isOnline = true;
           } catch (e) {
               this.isOnline = false;
           }
           
           // Si l'état a changé
           if (wasOnline !== this.isOnline) {
               console.log('[DownloadManager] État de connexion changé:', this.isOnline ? 'EN LIGNE' : 'HORS LIGNE');
               this.setOnlineStatus(this.isOnline);
           }
       }, 5000); // Vérifier toutes les 5 secondes
   }
   
   // Définir l'état de connexion
   setOnlineStatus(isOnline) {
       this.isOnline = isOnline;
       
       if (isOnline) {
           console.log('[DownloadManager] Connexion rétablie');
           this.emit('connection-restored');
           
           // Reprendre les téléchargements qui étaient en pause à cause de la connexion
           for (const [id, download] of this.pausedDownloads) {
               if (download.pausedReason === 'no-connection') {
                   console.log('[DownloadManager] Reprise automatique du téléchargement:', id);
                   this.resumeDownload(id);
               }
           }
           
           // Traiter la queue
           this.processQueue();
           
       } else {
           console.log('[DownloadManager] Connexion perdue');
           this.emit('connection-lost');
           
           // Mettre en pause tous les téléchargements actifs
           for (const [id, download] of this.activeDownloads) {
               if (download.status === 'downloading') {
                   download.pausedReason = 'no-connection';
                   console.log('[DownloadManager] Mise en pause automatique:', id);
                   this.pauseDownload(id);
               }
           }
       }
   }
   
   // Émettre des événements
   emit(event, data) {
       // Log pour le débogage (sauf download-progress pour éviter le spam)
       if (event !== 'download-progress') {
           console.log(`[DownloadManager] EVENT: ${event}`, {
               downloadId: data?.id,
               status: data?.status,
               progress: data?.progress
           });
       }
       
       // Utiliser IPC pour envoyer au renderer
       try {
           const { BrowserWindow } = require('electron');
           const windows = BrowserWindow.getAllWindows();
           
           windows.forEach(window => {
               if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
                   window.webContents.send(`download-manager:${event}`, data);
               }
           });
       } catch (e) {
           console.error('[DownloadManager] Erreur envoi IPC:', e);
       }
       
       // Appeler les handlers locaux
       const handlers = this.eventHandlers.get(event) || [];
       handlers.forEach(handler => {
           try {
               handler(data);
           } catch (e) {
               console.error(`[DownloadManager] Erreur handler ${event}:`, e);
           }
       });
   }
   
   // S'abonner aux événements
   on(event, handler) {
       console.log('[DownloadManager] Ajout handler pour:', event);
       
       if (!this.eventHandlers.has(event)) {
           this.eventHandlers.set(event, []);
       }
       this.eventHandlers.get(event).push(handler);
   }
   
   // Se désabonner
   off(event, handler) {
       const handlers = this.eventHandlers.get(event);
       if (handlers) {
           const index = handlers.indexOf(handler);
           if (index > -1) {
               handlers.splice(index, 1);
               console.log('[DownloadManager] Handler retiré pour:', event);
           }
       }
   }
   
   // Arrêter le gestionnaire
   async shutdown() {
       console.log('[DownloadManager] ==> ARRÊT EN COURS...');
       
       // Arrêter les intervalles
       if (this.queueInterval) {
           clearInterval(this.queueInterval);
           console.log('[DownloadManager] Processeur de queue arrêté');
       }
       if (this.connectionInterval) {
           clearInterval(this.connectionInterval);
           console.log('[DownloadManager] Moniteur de connexion arrêté');
       }
       
       // Mettre en pause tous les téléchargements actifs
       const activeIds = Array.from(this.activeDownloads.keys());
       console.log(`[DownloadManager] Mise en pause de ${activeIds.length} téléchargements actifs`);
       
       for (const id of activeIds) {
           await this.pauseDownload(id);
       }
       
       console.log('[DownloadManager] ARRÊT TERMINÉ');
   }
}

module.exports = DownloadManager;