// encryption.js - Module de chiffrement pour sécuriser les données avec support streaming

const crypto = require('crypto');
const fs = require('fs').promises;
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');

class EncryptionManager {
    constructor() {
        // Algorithmes
        this.algorithm = 'aes-256-gcm';
        this.streamAlgorithm = 'aes-256-ctr'; // CTR pour le streaming
        
        // Tailles
        this.keyLength = 32; // 256 bits
        this.ivLength = 16;  // 128 bits
        this.saltLength = 32; // 256 bits
        this.tagLength = 16; // 128 bits
        this.iterations = 100000; // PBKDF2 iterations
        
        // Configuration streaming
        this.streamBufferSize = 64 * 1024; // 64KB chunks
    }

    // Générer une clé de chiffrement sécurisée
    generateKey() {
        return crypto.randomBytes(this.keyLength).toString('hex');
    }

    // Dériver une clé à partir d'un mot de passe
    deriveKey(password, salt) {
        return crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, 'sha256');
    }

    // Chiffrer des données (pour petites données - métadonnées, etc.)
    encrypt(data, key) {
        try {
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Générer un IV aléatoire
            const iv = crypto.randomBytes(this.ivLength);
            
            // Créer le cipher
            const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
            
            // Chiffrer les données
            const encrypted = Buffer.concat([
                cipher.update(data, 'utf8'),
                cipher.final()
            ]);
            
            // Obtenir le tag d'authentification
            const authTag = cipher.getAuthTag();
            
            // Combiner toutes les parties
            const combined = Buffer.concat([
                iv,
                authTag,
                encrypted
            ]);
            
            return combined.toString('base64');
        } catch (error) {
            throw new Error(`Erreur de chiffrement: ${error.message}`);
        }
    }

    // Déchiffrer des données
    decrypt(encryptedData, key) {
        try {
            // Convertir depuis base64
            const combined = Buffer.from(encryptedData, 'base64');
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Extraire les composants
            const iv = combined.slice(0, this.ivLength);
            const authTag = combined.slice(this.ivLength, this.ivLength + this.tagLength);
            const encrypted = combined.slice(this.ivLength + this.tagLength);
            
            // Créer le decipher
            const decipher = crypto.createDecipheriv(this.algorithm, keyBuffer, iv);
            decipher.setAuthTag(authTag);
            
            // Déchiffrer
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            return decrypted.toString('utf8');
        } catch (error) {
            throw new Error(`Erreur de déchiffrement: ${error.message}`);
        }
    }

    // ==================== CHIFFREMENT OPTIMISÉ POUR LE STREAMING ====================

    // Chiffrer un fichier pour le streaming (utilise AES-CTR)
    async encryptFileForStreaming(inputPath, outputPath, key) {
        try {
            console.log('[Encryption] Chiffrement pour streaming:', inputPath);
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Générer un IV aléatoire
            const iv = crypto.randomBytes(this.ivLength);
            
            // Créer le cipher CTR
            const cipher = crypto.createCipheriv(this.streamAlgorithm, keyBuffer, iv);
            
            // Créer les streams
            const input = createReadStream(inputPath, { highWaterMark: this.streamBufferSize });
            const output = createWriteStream(outputPath);
            
            // Écrire l'IV au début du fichier
            output.write(iv);
            
            // Pipeline de chiffrement
            await pipeline(input, cipher, output);
            
            // Obtenir la taille finale
            const stats = await fs.stat(outputPath);
            
            console.log('[Encryption] Fichier chiffré pour streaming:', {
                algorithm: this.streamAlgorithm,
                size: stats.size,
                ivSize: iv.length
            });
            
            return {
                success: true,
                outputPath,
                size: stats.size,
                algorithm: this.streamAlgorithm,
                iv: iv.toString('hex')
            };
            
        } catch (error) {
            throw new Error(`Erreur lors du chiffrement streaming: ${error.message}`);
        }
    }

    // Déchiffrer un fichier streamable
    async decryptStreamableFile(inputPath, outputPath, key) {
        try {
            // Convertir la clé
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Lire l'IV (16 premiers octets)
            const fileHandle = await fs.open(inputPath, 'r');
            const ivBuffer = Buffer.alloc(this.ivLength);
            await fileHandle.read(ivBuffer, 0, this.ivLength, 0);
            await fileHandle.close();
            
            // Créer le decipher
            const decipher = crypto.createDecipheriv(this.streamAlgorithm, keyBuffer, ivBuffer);
            
            // Créer les streams (skip les 16 premiers octets qui sont l'IV)
            const input = createReadStream(inputPath, { 
                start: this.ivLength,
                highWaterMark: this.streamBufferSize 
            });
            const output = createWriteStream(outputPath);
            
            // Pipeline de déchiffrement
            await pipeline(input, decipher, output);
            
            return {
                success: true,
                outputPath,
                size: (await fs.stat(outputPath)).size
            };
            
        } catch (error) {
            throw new Error(`Erreur lors du déchiffrement streaming: ${error.message}`);
        }
    }

    // Créer un stream de déchiffrement CTR pour une plage spécifique
    createDecryptStreamForRange(key, iv, startByte = 0) {
        const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
        const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'hex');
        
        if (this.streamAlgorithm === 'aes-256-ctr') {
            // Pour CTR, calculer le bon counter pour la position
            if (startByte > 0) {
                const blockSize = 16;
                const startBlock = Math.floor(startByte / blockSize);
                const counter = Buffer.from(ivBuffer);
                
                // Incrémenter le counter
                for (let i = 0; i < startBlock; i++) {
                    for (let j = counter.length - 1; j >= 0; j--) {
                        if (++counter[j] !== 0) break;
                    }
                }
                
                return crypto.createDecipheriv(this.streamAlgorithm, keyBuffer, counter);
            }
        }
        
        return crypto.createDecipheriv(this.streamAlgorithm, keyBuffer, ivBuffer);
    }

    // ==================== CHIFFREMENT STANDARD (POUR DOCUMENTS, MÉTADONNÉES) ====================

    // Chiffrer un fichier standard (utilise GCM pour l'intégrité)
    async encryptFile(inputPath, outputPath, key) {
        try {
            // Lire le fichier
            const data = await fs.readFile(inputPath);
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Générer un IV aléatoire
            const iv = crypto.randomBytes(this.ivLength);
            
            // Créer le cipher
            const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
            
            // Chiffrer les données
            const encrypted = Buffer.concat([
                cipher.update(data),
                cipher.final()
            ]);
            
            // Obtenir le tag d'authentification
            const authTag = cipher.getAuthTag();
            
            // Écrire le fichier chiffré
            await fs.writeFile(outputPath, Buffer.concat([
                iv,
                authTag,
                encrypted
            ]));
            
            return {
                success: true,
                outputPath,
                size: encrypted.length,
                algorithm: this.algorithm
            };
        } catch (error) {
            throw new Error(`Erreur lors du chiffrement du fichier: ${error.message}`);
        }
    }

    // Déchiffrer un fichier standard
    async decryptFile(inputPath, outputPath, key) {
        try {
            // Lire le fichier chiffré
            const encryptedData = await fs.readFile(inputPath);
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Extraire les composants
            const iv = encryptedData.slice(0, this.ivLength);
            const authTag = encryptedData.slice(this.ivLength, this.ivLength + this.tagLength);
            const encrypted = encryptedData.slice(this.ivLength + this.tagLength);
            
            // Créer le decipher
            const decipher = crypto.createDecipheriv(this.algorithm, keyBuffer, iv);
            decipher.setAuthTag(authTag);
            
            // Déchiffrer
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            // Écrire le fichier déchiffré
            await fs.writeFile(outputPath, decrypted);
            
            return {
                success: true,
                outputPath,
                size: decrypted.length
            };
        } catch (error) {
            throw new Error(`Erreur lors du déchiffrement du fichier: ${error.message}`);
        }
    }

    // ==================== DÉTECTION DU TYPE DE FICHIER ====================

    // Déterminer si un fichier doit utiliser le chiffrement streaming
    async shouldUseStreamingEncryption(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const ext = path.extname(filePath).toLowerCase();
            
            // Utiliser streaming pour :
            // 1. Fichiers > 50MB
            // 2. Fichiers vidéo/audio
            const streamingExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.m4a'];
            const largeFileThreshold = 50 * 1024 * 1024; // 50MB
            
            return stats.size > largeFileThreshold || streamingExtensions.includes(ext);
            
        } catch (error) {
            return false;
        }
    }

    // Chiffrer automatiquement selon le type
    async encryptFileAuto(inputPath, outputPath, key) {
        const useStreaming = await this.shouldUseStreamingEncryption(inputPath);
        
        if (useStreaming) {
            console.log('[Encryption] Utilisation du chiffrement streaming pour:', inputPath);
            return await this.encryptFileForStreaming(inputPath, outputPath, key);
        } else {
            console.log('[Encryption] Utilisation du chiffrement standard pour:', inputPath);
            return await this.encryptFile(inputPath, outputPath, key);
        }
    }

    // ==================== UTILITAIRES ====================

    // Hash d'un fichier ou d'une chaîne
    async hash(data, algorithm = 'sha256') {
        if (typeof data === 'string') {
            // Hash d'une chaîne
            return crypto.createHash(algorithm).update(data, 'utf8').digest('hex');
        } else if (Buffer.isBuffer(data)) {
            // Hash d'un buffer
            return crypto.createHash(algorithm).update(data).digest('hex');
        } else {
            // Hash d'un fichier avec streaming
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash(algorithm);
                const stream = createReadStream(data);
                
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', reject);
            });
        }
    }

    // Vérifier l'intégrité d'un fichier
    async verifyIntegrity(filePath, expectedHash, algorithm = 'sha256') {
        const actualHash = await this.hash(filePath, algorithm);
        return actualHash === expectedHash;
    }

    // Obtenir les métadonnées d'un fichier chiffré
    async getEncryptedFileMetadata(filePath) {
        try {
            const fileHandle = await fs.open(filePath, 'r');
            const headerBuffer = Buffer.alloc(32); // IV + authTag potentiel
            
            await fileHandle.read(headerBuffer, 0, 32, 0);
            await fileHandle.close();
            
            // Essayer de déterminer le type
            const stats = await fs.stat(filePath);
            
            // Si le fichier a exactement IV + authTag + data, c'est probablement GCM
            // Sinon, c'est probablement CTR
            const iv = headerBuffer.slice(0, 16);
            const possibleAuthTag = headerBuffer.slice(16, 32);
            
            return {
                iv: iv.toString('hex'),
                algorithm: 'unknown', // À déterminer selon le contexte
                fileSize: stats.size,
                dataStart: 16, // Après l'IV
                hasAuthTag: false // À déterminer
            };
            
        } catch (error) {
            throw new Error(`Erreur lecture métadonnées: ${error.message}`);
        }
    }

    // Nettoyer les données sensibles de la mémoire
    secureClear(buffer) {
        if (Buffer.isBuffer(buffer)) {
            buffer.fill(0);
        }
    }

    // Générer un mot de passe sécurisé
    generatePassword(length = 16, options = {}) {
        const defaults = {
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true
        };
        
        const opts = { ...defaults, ...options };
        let charset = '';
        
        if (opts.uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (opts.lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (opts.numbers) charset += '0123456789';
        if (opts.symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        let password = '';
        const randomBytes = crypto.randomBytes(length);
        
        for (let i = 0; i < length; i++) {
            password += charset[randomBytes[i] % charset.length];
        }
        
        return password;
    }

    // Générer une paire de clés pour signature
    generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        
        return { publicKey, privateKey };
    }

    // Signer des données
    sign(data, privateKey) {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        sign.end();
        return sign.sign(privateKey, 'hex');
    }

    // Vérifier une signature
    verify(data, signature, publicKey) {
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKey, signature, 'hex');
    }
}

// Singleton
let instance = null;

class EncryptionService {
    constructor() {
        if (!instance) {
            instance = new EncryptionManager();
        }
        return instance;
    }
}

module.exports = new EncryptionService();