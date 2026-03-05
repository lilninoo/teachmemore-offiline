// secure-media-player.js - Streaming server with dual AES-256-CTR/GCM decryption

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const encryption = require('./encryption');

const IV_SIZE = 16;

class SecureMediaPlayer {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.activeStreams = new Map();
        this.server = null;
        this.port = 0;
    }

    async initialize() {
        const express = require('express');
        const expressApp = express();

        expressApp.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '127.0.0.1');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.setHeader('Accept-Ranges', 'bytes');
            if (req.method === 'OPTIONS') return res.sendStatus(204);
            next();
        });

        expressApp.get('/stream/:streamId', (req, res) => this.handleStreamRequest(req, res));
        expressApp.head('/stream/:streamId', (req, res) => this.handleHeadRequest(req, res));

        return new Promise((resolve, reject) => {
            this.server = expressApp.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                console.log(`[SecureMediaPlayer] Server started on port ${this.port}`);
                resolve(this.port);
            });
            this.server.on('error', reject);
        });
    }

    async detectEncryptionFormat(filePath) {
        const keyBuffer = Buffer.isBuffer(this.encryptionKey)
            ? this.encryptionKey
            : Buffer.from(this.encryptionKey, 'hex');

        const fd = fs.openSync(filePath, 'r');
        const iv = Buffer.alloc(IV_SIZE);
        fs.readSync(fd, iv, 0, IV_SIZE, 0);

        const sample = Buffer.alloc(16);
        fs.readSync(fd, sample, 0, 16, IV_SIZE);
        fs.closeSync(fd);

        // Try CTR first
        try {
            const ctrDecipher = crypto.createDecipheriv('aes-256-ctr', keyBuffer, iv);
            const decrypted = ctrDecipher.update(sample);
            if (this.looksLikeMedia(decrypted)) {
                return 'ctr';
            }
        } catch (e) { /* ignore */ }

        // Try GCM (old format without authTag)
        try {
            const gcmDecipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
            const decrypted = gcmDecipher.update(sample);
            if (this.looksLikeMedia(decrypted)) {
                return 'gcm';
            }
        } catch (e) { /* ignore */ }

        // Default to GCM for backward compatibility
        return 'gcm';
    }

    looksLikeMedia(buffer) {
        if (buffer.length < 8) return false;
        const sig = buffer.slice(4, 8).toString('ascii');
        // MP4 signatures
        if (sig === 'ftyp' || sig === 'moov' || sig === 'mdat' || sig === 'free') return true;
        // WebM/MKV
        if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
        // FLV
        if (buffer[0] === 0x46 && buffer[1] === 0x4c && buffer[2] === 0x56) return true;
        // AVI
        if (buffer.slice(0, 4).toString('ascii') === 'RIFF') return true;
        // Also check for any non-null start (basic heuristic)
        return false;
    }

    async createStreamUrl(encryptedFilePath, mimeType = 'video/mp4') {
        if (!fs.existsSync(encryptedFilePath)) {
            throw new Error(`File not found: ${encryptedFilePath}`);
        }

        const streamId = crypto.randomBytes(16).toString('hex');
        const stats = fs.statSync(encryptedFilePath);
        const format = await this.detectEncryptionFormat(encryptedFilePath);
        const dataSize = stats.size - IV_SIZE;

        const fd = fs.openSync(encryptedFilePath, 'r');
        const iv = Buffer.alloc(IV_SIZE);
        fs.readSync(fd, iv, 0, IV_SIZE, 0);
        fs.closeSync(fd);

        this.activeStreams.set(streamId, {
            filePath: encryptedFilePath,
            mimeType,
            fileSize: stats.size,
            dataSize,
            iv,
            format,
            createdAt: Date.now(),
            accessCount: 0
        });

        const timeout = setTimeout(() => this.activeStreams.delete(streamId), 3600000);
        this.activeStreams.get(streamId)._timeout = timeout;

        const url = `http://127.0.0.1:${this.port}/stream/${streamId}`;
        console.log(`[SecureMediaPlayer] Stream created: ${streamId} (${dataSize} bytes, format=${format})`);
        return url;
    }

    handleHeadRequest(req, res) {
        const stream = this.activeStreams.get(req.params.streamId);
        if (!stream) return res.sendStatus(404);

        res.writeHead(200, {
            'Content-Type': stream.mimeType,
            'Content-Length': stream.dataSize,
            'Accept-Ranges': stream.format === 'ctr' ? 'bytes' : 'none'
        });
        res.end();
    }

    handleStreamRequest(req, res) {
        const streamId = req.params.streamId;
        const stream = this.activeStreams.get(streamId);

        if (!stream) {
            console.error(`[SecureMediaPlayer] Stream not found: ${streamId}`);
            return res.sendStatus(404);
        }

        stream.accessCount++;

        if (stream.format === 'ctr') {
            this.handleCTRStream(req, res, stream);
        } else {
            this.handleGCMStream(req, res, stream);
        }
    }

    handleCTRStream(req, res, stream) {
        const { filePath, mimeType, dataSize, iv } = stream;
        const rangeHeader = req.headers.range;

        let start = 0;
        let end = dataSize - 1;

        if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            start = parseInt(parts[0], 10) || 0;
            end = parts[1] ? parseInt(parts[1], 10) : dataSize - 1;

            if (start >= dataSize || end >= dataSize) {
                res.writeHead(416, { 'Content-Range': `bytes */${dataSize}` });
                return res.end();
            }
        }

        const chunkSize = end - start + 1;
        const headers = {
            'Content-Type': mimeType,
            'Content-Length': chunkSize,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
        };

        if (rangeHeader) {
            headers['Content-Range'] = `bytes ${start}-${end}/${dataSize}`;
            res.writeHead(206, headers);
        } else {
            res.writeHead(200, headers);
        }

        if (req.method === 'HEAD') return res.end();

        const fileStream = fs.createReadStream(filePath, {
            start: IV_SIZE + start,
            end: IV_SIZE + end,
            highWaterMark: 64 * 1024
        });

        const keyBuffer = Buffer.isBuffer(this.encryptionKey)
            ? this.encryptionKey
            : Buffer.from(this.encryptionKey, 'hex');

        const decipher = encryption.createDecryptStreamForRange(keyBuffer, iv, start);

        fileStream.on('error', (err) => {
            console.error(`[SecureMediaPlayer] File read error: ${err.message}`);
            if (!res.headersSent) res.sendStatus(500);
            else res.end();
        });

        decipher.on('error', (err) => {
            console.error(`[SecureMediaPlayer] CTR decrypt error: ${err.message}`);
            if (!res.headersSent) res.sendStatus(500);
            else res.end();
        });

        fileStream.pipe(decipher).pipe(res);

        res.on('close', () => {
            fileStream.destroy();
            decipher.destroy();
        });
    }

    handleGCMStream(req, res, stream) {
        const { filePath, mimeType, dataSize, iv } = stream;

        const headers = {
            'Content-Type': mimeType,
            'Content-Length': dataSize,
            'Accept-Ranges': 'none',
            'Cache-Control': 'no-store'
        };

        res.writeHead(200, headers);

        if (req.method === 'HEAD') return res.end();

        const keyBuffer = Buffer.isBuffer(this.encryptionKey)
            ? this.encryptionKey
            : Buffer.from(this.encryptionKey, 'hex');

        const fileStream = fs.createReadStream(filePath, {
            start: IV_SIZE,
            highWaterMark: 64 * 1024
        });

        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);

        fileStream.on('error', (err) => {
            console.error(`[SecureMediaPlayer] File read error: ${err.message}`);
            if (!res.headersSent) res.sendStatus(500);
            else res.end();
        });

        decipher.on('error', (err) => {
            // GCM without authTag throws on final() — expected for old format
            console.warn(`[SecureMediaPlayer] GCM stream ended (no authTag): ${err.message}`);
        });

        fileStream.pipe(decipher).pipe(res);

        res.on('close', () => {
            fileStream.destroy();
            decipher.destroy();
        });
    }

    removeStream(streamId) {
        const stream = this.activeStreams.get(streamId);
        if (stream) {
            if (stream._timeout) clearTimeout(stream._timeout);
            this.activeStreams.delete(streamId);
        }
    }

    async cleanup() {
        for (const [id, stream] of this.activeStreams) {
            if (stream._timeout) clearTimeout(stream._timeout);
        }
        this.activeStreams.clear();

        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('[SecureMediaPlayer] Server stopped');
                    resolve();
                });
            });
        }
    }
}

let playerInstance = null;

function getSecureMediaPlayer(encryptionKey) {
    if (!playerInstance) {
        playerInstance = new SecureMediaPlayer(encryptionKey);
    }
    return playerInstance;
}

module.exports = { SecureMediaPlayer, getSecureMediaPlayer };
