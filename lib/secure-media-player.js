// secure-media-player.js - Version optimisée avec déchiffrement en streaming

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Transform } = require('stream');

class SecureMediaPlayer {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.activeStreams = new Map();
        this.metadataCache = new Map(); // Cache uniquement pour IV et authTag
        this.server = null;
        this.port = 0;
    }

    // Initialiser le serveur
    async initialize() {
        const express = require('express');
        const app = express();
        
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.setHeader('Accept-Ranges', 'bytes');
            next();
        });
        
        app.get('/stream/:streamId', (req, res) => {
            this.handleStreamRequest(req, res);
        });
        
        return new Promise((resolve, reject) => {
            this.server = app.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                console.log(`[SecureMediaPlayer] Serveur démarré sur le port ${this.port}`);
                resolve(this.port);
            });
            
            this.server.on('error', reject);
        });
    }

    // Créer une URL de streaming
    async createStreamUrl(encryptedFilePath, mimeType = 'video/mp4') {
        try {
            if (!fs.existsSync(encryptedFilePath)) {
                throw new Error('Fichier non trouvé');
            }
            
            const streamId = crypto.randomBytes(16).toString('hex');
            const stats = fs.statSync(encryptedFilePath);
            
            // Lire uniquement les métadonnées de chiffrement (IV et authTag)
            const metadata = await this.readEncryptionMetadata(encryptedFilePath);
            
            // Calculer la taille réelle des données (sans IV et authTag)
            const realDataSize = stats.size - 16 - 16; // -IV -authTag
            
            this.activeStreams.set(streamId, {
                filePath: encryptedFilePath,
                mimeType,
                fileSize: stats.size,
                realDataSize,
                metadata,
                createdAt: Date.now(),
                accessCount: 0
            });
            
            // Nettoyer après 1 heure
            setTimeout(() => {
                this.activeStreams.delete(streamId);
                this.metadataCache.delete(streamId);
            }, 3600000);
            
            return `http://127.0.0.1:${this.port}/stream/${streamId}`;
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur création URL:', error);
            throw error;
        }
    }

    // Lire uniquement les métadonnées de chiffrement
    async readEncryptionMetadata(filePath) {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, { 
                start: 0, 
                end: 15, // Lire seulement l'IV
                highWaterMark: 16 
            });
            
            let iv = null;
            
            stream.on('data', (chunk) => {
                iv = chunk;
            });
            
            stream.on('end', async () => {
                // Lire l'authTag à la fin
                const stats = fs.statSync(filePath);
                const authTagStream = fs.createReadStream(filePath, {
                    start: stats.size - 16,
                    end: stats.size - 1,
                    highWaterMark: 16
                });
                
                let authTag = null;
                
                authTagStream.on('data', (chunk) => {
                    authTag = chunk;
                });
                
                authTagStream.on('end', () => {
                    resolve({ iv, authTag });
                });
                
                authTagStream.on('error', reject);
            });
            
            stream.on('error', reject);
        });
    }

    // Gérer les requêtes de streaming
    handleStreamRequest(req, res) {
        const { streamId } = req.params;
        const streamInfo = this.activeStreams.get(streamId);
        
        if (!streamInfo) {
            return res.status(404).send('Stream non trouvé');
        }
        
        streamInfo.accessCount++;
        
        try {
            const range = req.headers.range;
            
            if (range) {
                this.handleRangeRequestOptimized(req, res, streamInfo, streamId);
            } else {
                this.handleFullRequestOptimized(req, res, streamInfo, streamId);
            }
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur streaming:', error);
            res.status(500).send('Erreur de streaming');
        }
    }

    // Requête avec Range optimisée
    handleRangeRequestOptimized(req, res, streamInfo, streamId) {
        const { filePath, mimeType, realDataSize, metadata } = streamInfo;
        const range = req.headers.range;
        
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : realDataSize - 1;
        
        if (start >= realDataSize || end >= realDataSize) {
            res.writeHead(416, {
                'Content-Range': `bytes */${realDataSize}`
            });
            return res.end();
        }
        
        const chunkSize = (end - start) + 1;
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${realDataSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mimeType,
            'Cache-Control': 'no-cache'
        });
        
        // Créer un stream de déchiffrement pour la plage demandée
        this.createDecryptStreamForRange(filePath, metadata, start, end)
            .then(decryptStream => {
                decryptStream.pipe(res);
                
                decryptStream.on('error', (err) => {
                    console.error('[SecureMediaPlayer] Erreur déchiffrement:', err);
                    res.end();
                });
            })
            .catch(err => {
                console.error('[SecureMediaPlayer] Erreur création stream:', err);
                res.status(500).end();
            });
    }

    // Requête complète optimisée
    handleFullRequestOptimized(req, res, streamInfo, streamId) {
        const { filePath, mimeType, realDataSize, metadata } = streamInfo;
        
        res.writeHead(200, {
            'Content-Length': realDataSize,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
        });
        
        this.createDecryptStreamForRange(filePath, metadata, 0, realDataSize - 1)
            .then(decryptStream => {
                decryptStream.pipe(res);
                
                decryptStream.on('error', (err) => {
                    console.error('[SecureMediaPlayer] Erreur déchiffrement:', err);
                    res.end();
                });
            })
            .catch(err => {
                console.error('[SecureMediaPlayer] Erreur création stream:', err);
                res.status(500).end();
            });
    }

    // Créer un stream de déchiffrement pour une plage spécifique
    async createDecryptStreamForRange(filePath, metadata, start, end) {
        const { iv, authTag } = metadata;
        
        // Ajuster les positions pour tenir compte de l'IV
        const encryptedStart = start + 16; // +16 pour l'IV
        const encryptedEnd = end + 16;
        
        // Créer le stream de lecture
        const readStream = fs.createReadStream(filePath, {
            start: encryptedStart,
            end: encryptedEnd,
            highWaterMark: 64 * 1024 // Buffer de 64KB
        });
        
        // Créer le déchiffreur
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(this.encryptionKey, 'hex'),
            iv
        );
        
        // IMPORTANT: Pour GCM, on doit désactiver la vérification du tag pour le streaming partiel
        // car on ne peut pas vérifier l'authenticité sur une portion du fichier
        decipher.setAutoPadding(false);
        
        // Créer un transform stream pour gérer le déchiffrement bloc par bloc
        const decryptTransform = new Transform({
            transform(chunk, encoding, callback) {
                try {
                    const decrypted = decipher.update(chunk);
                    callback(null, decrypted);
                } catch (err) {
                    callback(err);
                }
            },
            
            flush(callback) {
                try {
                    // Pour un stream partiel, on ne peut pas appeler final()
                    // car on n'a pas tout le contenu pour vérifier le tag
                    callback();
                } catch (err) {
                    callback(err);
                }
            }
        });
        
        return readStream.pipe(decryptTransform);
    }

    // Alternative : Utiliser un mode de chiffrement adapté au streaming
    async createStreamUrlWithCTR(encryptedFilePath, mimeType = 'video/mp4') {
        // Pour un vrai streaming sécurisé, il faudrait utiliser AES-CTR au lieu de GCM
        // car CTR permet le déchiffrement à n'importe quelle position
        console.log('[SecureMediaPlayer] Mode CTR recommandé pour le streaming vidéo');
        
        // Implémenter AES-CTR pour un vrai seeking...
    }

    // Nettoyer
    async cleanup() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('[SecureMediaPlayer] Serveur fermé');
                    resolve();
                });
            });
        }
    }
}

// Singleton
let playerInstance = null;

function getSecureMediaPlayer(encryptionKey) {
    if (!playerInstance) {
        playerInstance = new SecureMediaPlayer(encryptionKey);
    }
    return playerInstance;
}

module.exports = {
    SecureMediaPlayer,
    getSecureMediaPlayer
};