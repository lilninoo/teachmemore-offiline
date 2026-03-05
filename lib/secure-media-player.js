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
        this.metadataCache = new Map(); // Cache uniquement pour IV
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

    // Ajouter une méthode pour détecter le type de chiffrement
    async detectEncryptionType(filePath) {
        try {
            const stats = fs.statSync(filePath);
            const fileHandle = await fs.open(filePath, 'r');
            
            // Lire l'en-tête pour détecter le type
            const headerBuffer = Buffer.alloc(32);
            await fileHandle.read(headerBuffer, 0, 32, 0);
            await fileHandle.close();
            
            // Si le fichier a été chiffré avec CTR, il aura seulement l'IV (16 bytes)
            // Si c'est GCM, il aura IV + authTag (32 bytes)
            
            // Pour CTR : données commencent à l'octet 16
            // Pour GCM : données commencent à l'octet 16, authTag à la fin
            
            return {
                algorithm: 'aes-256-ctr', // Utiliser CTR pour le streaming
                ivSize: 16,
                dataStart: 16
            };
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur détection type:', error);
            return null;
        }
    }

    // Créer une URL de streaming
    async createStreamUrl(encryptedFilePath, mimeType = 'video/mp4') {
        try {
            if (!fs.existsSync(encryptedFilePath)) {
                throw new Error('Fichier non trouvé');
            }
            
            const streamId = crypto.randomBytes(16).toString('hex');
            const stats = fs.statSync(encryptedFilePath);
            
            // Lire les métadonnées de chiffrement (IV)
            const metadata = await this.readEncryptionMetadata(encryptedFilePath);
            
            // Calculer la taille réelle des données (sans IV) - CTR format: IV(16) + data
            const realDataSize = stats.size - 16;
            
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

    // Lire les métadonnées de chiffrement (IV uniquement - CTR n'utilise pas authTag)
    async readEncryptionMetadata(filePath) {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, {
                start: 0,
                end: 15,
                highWaterMark: 16
            });
            let iv = null;
            stream.on('data', (chunk) => { iv = chunk; });
            stream.on('end', () => resolve({ iv }));
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

    // Créer un stream de déchiffrement pour une plage spécifique (AES-256-CTR avec support du seeking)
    async createDecryptStreamForRange(filePath, metadata, start, end) {
        const { iv } = metadata;
        const keyBuffer = Buffer.from(this.encryptionKey, 'hex');

        const blockSize = 16;
        const startBlock = Math.floor(start / blockSize);
        const byteOffsetInBlock = start % blockSize;

        // Calculer le compteur pour le bloc de départ en incrémentant l'IV
        const counter = Buffer.from(iv);
        let carry = startBlock;
        for (let j = counter.length - 1; j >= 0 && carry > 0; j--) {
            const sum = counter[j] + (carry & 0xff);
            counter[j] = sum & 0xff;
            carry = (carry >> 8) + (sum >> 8);
        }

        const decipher = crypto.createDecipheriv('aes-256-ctr', keyBuffer, counter);

        // Lire depuis le fichier chiffré, en ignorant l'en-tête IV (16 octets)
        const encryptedStart = (startBlock * blockSize) + 16;
        const endBlock = Math.floor(end / blockSize);
        const encryptedEnd = 16 + (endBlock + 1) * blockSize - 1;

        const readStream = fs.createReadStream(filePath, {
            start: encryptedStart,
            end: encryptedEnd,
            highWaterMark: 64 * 1024
        });

        // Si la position de départ n'est pas alignée sur un bloc, ignorer les octets initiaux après déchiffrement
        if (byteOffsetInBlock > 0) {
            let skipped = 0;
            const skipTransform = new Transform({
                transform(chunk, encoding, callback) {
                    if (skipped < byteOffsetInBlock) {
                        const toSkip = Math.min(byteOffsetInBlock - skipped, chunk.length);
                        skipped += toSkip;
                        if (toSkip < chunk.length) {
                            callback(null, chunk.slice(toSkip));
                        } else {
                            callback();
                        }
                    } else {
                        callback(null, chunk);
                    }
                }
            });
            return readStream.pipe(decipher).pipe(skipTransform);
        }

        return readStream.pipe(decipher);
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