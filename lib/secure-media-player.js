// secure-media-player.js - Streaming server with AES-256-CTR range-based decryption

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

    async createStreamUrl(encryptedFilePath, mimeType = 'video/mp4') {
        if (!fs.existsSync(encryptedFilePath)) {
            throw new Error(`File not found: ${encryptedFilePath}`);
        }

        const streamId = crypto.randomBytes(16).toString('hex');
        const stats = fs.statSync(encryptedFilePath);
        const iv = await this.readIV(encryptedFilePath);
        const dataSize = stats.size - IV_SIZE;

        this.activeStreams.set(streamId, {
            filePath: encryptedFilePath,
            mimeType,
            fileSize: stats.size,
            dataSize,
            iv,
            createdAt: Date.now(),
            accessCount: 0
        });

        const timeout = setTimeout(() => this.activeStreams.delete(streamId), 3600000);
        this.activeStreams.get(streamId)._timeout = timeout;

        const url = `http://127.0.0.1:${this.port}/stream/${streamId}`;
        console.log(`[SecureMediaPlayer] Stream created: ${streamId} (${dataSize} bytes)`);
        return url;
    }

    async readIV(filePath) {
        const fd = fs.openSync(filePath, 'r');
        const iv = Buffer.alloc(IV_SIZE);
        fs.readSync(fd, iv, 0, IV_SIZE, 0);
        fs.closeSync(fd);
        return iv;
    }

    handleHeadRequest(req, res) {
        const stream = this.activeStreams.get(req.params.streamId);
        if (!stream) return res.sendStatus(404);

        res.writeHead(200, {
            'Content-Type': stream.mimeType,
            'Content-Length': stream.dataSize,
            'Accept-Ranges': 'bytes'
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
            'Cache-Control': 'no-store'
        };

        if (rangeHeader) {
            headers['Content-Range'] = `bytes ${start}-${end}/${dataSize}`;
            res.writeHead(206, headers);
        } else {
            res.writeHead(200, headers);
        }

        if (req.method === 'HEAD') return res.end();

        const fileStart = IV_SIZE + start;
        const fileEnd = IV_SIZE + end;

        const fileStream = fs.createReadStream(filePath, {
            start: fileStart,
            end: fileEnd,
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
            console.error(`[SecureMediaPlayer] Decrypt error: ${err.message}`);
            if (!res.headersSent) res.sendStatus(500);
            else res.end();
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
