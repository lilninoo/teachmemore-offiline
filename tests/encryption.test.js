const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

const encryption = require('../lib/encryption');

describe('EncryptionManager', () => {
    let tmpDir;

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enc-test-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    describe('generateKey()', () => {
        it('should return a 64-character hex string', () => {
            const key = encryption.generateKey();
            expect(key).to.be.a('string');
            expect(key).to.have.lengthOf(64);
            expect(key).to.match(/^[0-9a-f]{64}$/);
        });

        it('should generate unique keys on each call', () => {
            const key1 = encryption.generateKey();
            const key2 = encryption.generateKey();
            expect(key1).to.not.equal(key2);
        });
    });

    describe('encrypt() / decrypt()', () => {
        it('should round-trip with a valid hex key', () => {
            const key = encryption.generateKey();
            const plaintext = 'Hello, World!';
            const encrypted = encryption.encrypt(plaintext, key);
            expect(encrypted).to.be.a('string');
            expect(encrypted).to.not.equal(plaintext);
            const decrypted = encryption.decrypt(encrypted, key);
            expect(decrypted).to.equal(plaintext);
        });

        it('should round-trip with a Buffer key', () => {
            const keyBuffer = crypto.randomBytes(32);
            const plaintext = 'Buffer key test';
            const encrypted = encryption.encrypt(plaintext, keyBuffer);
            const decrypted = encryption.decrypt(encrypted, keyBuffer);
            expect(decrypted).to.equal(plaintext);
        });

        it('should produce different ciphertext for same plaintext (random IV)', () => {
            const key = encryption.generateKey();
            const plaintext = 'same message';
            const enc1 = encryption.encrypt(plaintext, key);
            const enc2 = encryption.encrypt(plaintext, key);
            expect(enc1).to.not.equal(enc2);
        });

        it('should handle empty string', () => {
            const key = encryption.generateKey();
            const encrypted = encryption.encrypt('', key);
            const decrypted = encryption.decrypt(encrypted, key);
            expect(decrypted).to.equal('');
        });

        it('should handle unicode text', () => {
            const key = encryption.generateKey();
            const plaintext = '日本語テスト 🔐 émojis';
            const encrypted = encryption.encrypt(plaintext, key);
            const decrypted = encryption.decrypt(encrypted, key);
            expect(decrypted).to.equal(plaintext);
        });

        it('should throw on encrypt with invalid key (wrong length)', () => {
            expect(() => encryption.encrypt('data', 'shortkey')).to.throw(/chiffrement/i);
        });

        it('should throw on decrypt with wrong key', () => {
            const key1 = encryption.generateKey();
            const key2 = encryption.generateKey();
            const encrypted = encryption.encrypt('secret', key1);
            expect(() => encryption.decrypt(encrypted, key2)).to.throw(/déchiffrement/i);
        });

        it('should throw on decrypt with corrupted data', () => {
            const key = encryption.generateKey();
            expect(() => encryption.decrypt('not-valid-base64!!!', key)).to.throw();
        });
    });

    describe('hash()', () => {
        it('should produce consistent SHA-256 output for a string', async () => {
            const hash1 = await encryption.hash('hello');
            const hash2 = await encryption.hash('hello');
            expect(hash1).to.equal(hash2);
            expect(hash1).to.match(/^[0-9a-f]{64}$/);
        });

        it('should produce different hashes for different inputs', async () => {
            const hash1 = await encryption.hash('hello');
            const hash2 = await encryption.hash('world');
            expect(hash1).to.not.equal(hash2);
        });

        it('should hash a Buffer', async () => {
            const buf = Buffer.from('test data');
            const hash = await encryption.hash(buf);
            expect(hash).to.be.a('string');
            expect(hash).to.have.lengthOf(64);
        });

        it('should match known SHA-256 value', async () => {
            const hash = await encryption.hash('test');
            const expected = crypto.createHash('sha256').update('test', 'utf8').digest('hex');
            expect(hash).to.equal(expected);
        });
    });

    describe('deriveKey()', () => {
        it('should derive a 32-byte key from password and salt', () => {
            const derived = encryption.deriveKey('password', 'salt');
            expect(Buffer.isBuffer(derived)).to.be.true;
            expect(derived).to.have.lengthOf(32);
        });

        it('should produce consistent output for same inputs', () => {
            const d1 = encryption.deriveKey('pass', 'salt');
            const d2 = encryption.deriveKey('pass', 'salt');
            expect(d1.equals(d2)).to.be.true;
        });

        it('should produce different keys for different passwords', () => {
            const d1 = encryption.deriveKey('pass1', 'salt');
            const d2 = encryption.deriveKey('pass2', 'salt');
            expect(d1.equals(d2)).to.be.false;
        });

        it('should produce different keys for different salts', () => {
            const d1 = encryption.deriveKey('pass', 'salt1');
            const d2 = encryption.deriveKey('pass', 'salt2');
            expect(d1.equals(d2)).to.be.false;
        });
    });

    describe('shouldUseStreamingEncryption()', () => {
        it('should return true for video extensions', async () => {
            const videoFile = path.join(tmpDir, 'video.mp4');
            await fsp.writeFile(videoFile, Buffer.alloc(1024));
            const result = await encryption.shouldUseStreamingEncryption(videoFile);
            expect(result).to.be.true;
        });

        it('should return true for audio extensions', async () => {
            const audioFile = path.join(tmpDir, 'audio.mp3');
            await fsp.writeFile(audioFile, Buffer.alloc(1024));
            const result = await encryption.shouldUseStreamingEncryption(audioFile);
            expect(result).to.be.true;
        });

        it('should return true for files larger than 50MB', async () => {
            const bigFile = path.join(tmpDir, 'bigfile.txt');
            const fd = await fsp.open(bigFile, 'w');
            await fd.truncate(51 * 1024 * 1024);
            await fd.close();
            const result = await encryption.shouldUseStreamingEncryption(bigFile);
            expect(result).to.be.true;
        });

        it('should return false for small non-media files', async () => {
            const smallFile = path.join(tmpDir, 'small.txt');
            await fsp.writeFile(smallFile, 'small data');
            const result = await encryption.shouldUseStreamingEncryption(smallFile);
            expect(result).to.be.false;
        });

        it('should return false for non-existent files', async () => {
            const result = await encryption.shouldUseStreamingEncryption('/nonexistent/file.txt');
            expect(result).to.be.false;
        });
    });

    describe('encryptFile() / decryptFile()', () => {
        it('should round-trip a file using GCM encryption', async () => {
            const key = encryption.generateKey();
            const original = 'This is test file content for GCM encryption.';
            const inputPath = path.join(tmpDir, 'input.txt');
            const encPath = path.join(tmpDir, 'encrypted.bin');
            const decPath = path.join(tmpDir, 'decrypted.txt');

            await fsp.writeFile(inputPath, original);

            const encResult = await encryption.encryptFile(inputPath, encPath, key);
            expect(encResult.success).to.be.true;
            expect(encResult.algorithm).to.equal('aes-256-gcm');

            const encData = await fsp.readFile(encPath);
            expect(encData.toString()).to.not.equal(original);

            const decResult = await encryption.decryptFile(encPath, decPath, key);
            expect(decResult.success).to.be.true;

            const decrypted = await fsp.readFile(decPath, 'utf8');
            expect(decrypted).to.equal(original);
        });

        it('should fail to decrypt with wrong key', async () => {
            const key1 = encryption.generateKey();
            const key2 = encryption.generateKey();
            const inputPath = path.join(tmpDir, 'input.txt');
            const encPath = path.join(tmpDir, 'encrypted.bin');
            const decPath = path.join(tmpDir, 'decrypted.txt');

            await fsp.writeFile(inputPath, 'secret data');
            await encryption.encryptFile(inputPath, encPath, key1);

            try {
                await encryption.decryptFile(encPath, decPath, key2);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.match(/déchiffrement|Unsupported state|error/i);
            }
        });

        it('should handle binary files', async () => {
            const key = encryption.generateKey();
            const binaryData = crypto.randomBytes(2048);
            const inputPath = path.join(tmpDir, 'binary.bin');
            const encPath = path.join(tmpDir, 'encrypted.bin');
            const decPath = path.join(tmpDir, 'decrypted.bin');

            await fsp.writeFile(inputPath, binaryData);
            await encryption.encryptFile(inputPath, encPath, key);
            await encryption.decryptFile(encPath, decPath, key);

            const result = await fsp.readFile(decPath);
            expect(result.equals(binaryData)).to.be.true;
        });
    });

    describe('encryptFileForStreaming() / decryptStreamableFile()', () => {
        it('should round-trip a file using CTR streaming encryption', async () => {
            const key = encryption.generateKey();
            const original = 'Streaming encryption test content with enough data.';
            const inputPath = path.join(tmpDir, 'stream_input.txt');
            const encPath = path.join(tmpDir, 'stream_encrypted.bin');
            const decPath = path.join(tmpDir, 'stream_decrypted.txt');

            await fsp.writeFile(inputPath, original);

            const encResult = await encryption.encryptFileForStreaming(inputPath, encPath, key);
            expect(encResult.success).to.be.true;
            expect(encResult.algorithm).to.equal('aes-256-ctr');
            expect(encResult.iv).to.be.a('string').with.lengthOf(32);

            const decResult = await encryption.decryptStreamableFile(encPath, decPath, key);
            expect(decResult.success).to.be.true;

            const decrypted = await fsp.readFile(decPath, 'utf8');
            expect(decrypted).to.equal(original);
        });

        it('should prepend IV as first 16 bytes of encrypted file', async () => {
            const key = encryption.generateKey();
            const inputPath = path.join(tmpDir, 'iv_input.txt');
            const encPath = path.join(tmpDir, 'iv_encrypted.bin');

            await fsp.writeFile(inputPath, 'test');

            const result = await encryption.encryptFileForStreaming(inputPath, encPath, key);
            const fileData = await fsp.readFile(encPath);
            const ivFromFile = fileData.slice(0, 16).toString('hex');
            expect(ivFromFile).to.equal(result.iv);
        });

        it('should handle larger binary data', async () => {
            const key = encryption.generateKey();
            const binaryData = crypto.randomBytes(128 * 1024);
            const inputPath = path.join(tmpDir, 'large_stream.bin');
            const encPath = path.join(tmpDir, 'large_enc.bin');
            const decPath = path.join(tmpDir, 'large_dec.bin');

            await fsp.writeFile(inputPath, binaryData);
            await encryption.encryptFileForStreaming(inputPath, encPath, key);
            await encryption.decryptStreamableFile(encPath, decPath, key);

            const result = await fsp.readFile(decPath);
            expect(result.equals(binaryData)).to.be.true;
        });
    });

    describe('createDecryptStreamForRange()', () => {
        it('should return a decipher for startByte = 0', () => {
            const key = encryption.generateKey();
            const iv = crypto.randomBytes(16);
            const decipher = encryption.createDecryptStreamForRange(key, iv, 0);
            expect(decipher).to.exist;
            expect(typeof decipher.update).to.equal('function');
        });

        it('should return a decipher with adjusted counter for non-zero start', () => {
            const key = encryption.generateKey();
            const iv = crypto.randomBytes(16);
            const decipher = encryption.createDecryptStreamForRange(key, iv, 1024);
            expect(decipher).to.exist;
            expect(typeof decipher.update).to.equal('function');
        });

        it('should accept hex string key and iv', () => {
            const key = encryption.generateKey();
            const iv = crypto.randomBytes(16).toString('hex');
            const decipher = encryption.createDecryptStreamForRange(key, iv, 0);
            expect(decipher).to.exist;
        });
    });

    describe('secureClear()', () => {
        it('should zero out a buffer', () => {
            const buf = Buffer.from([1, 2, 3, 4, 5]);
            encryption.secureClear(buf);
            for (let i = 0; i < buf.length; i++) {
                expect(buf[i]).to.equal(0);
            }
        });

        it('should be a no-op for non-buffer input', () => {
            expect(() => encryption.secureClear('string')).to.not.throw();
            expect(() => encryption.secureClear(null)).to.not.throw();
            expect(() => encryption.secureClear(undefined)).to.not.throw();
        });
    });

    describe('generatePassword()', () => {
        it('should generate a password of default length 16', () => {
            const pw = encryption.generatePassword();
            expect(pw).to.have.lengthOf(16);
        });

        it('should generate a password of specified length', () => {
            const pw = encryption.generatePassword(24);
            expect(pw).to.have.lengthOf(24);
        });

        it('should include only uppercase when other options disabled', () => {
            const pw = encryption.generatePassword(32, {
                uppercase: true,
                lowercase: false,
                numbers: false,
                symbols: false
            });
            expect(pw).to.match(/^[A-Z]+$/);
        });

        it('should include only lowercase when other options disabled', () => {
            const pw = encryption.generatePassword(32, {
                uppercase: false,
                lowercase: true,
                numbers: false,
                symbols: false
            });
            expect(pw).to.match(/^[a-z]+$/);
        });

        it('should include only numbers when other options disabled', () => {
            const pw = encryption.generatePassword(32, {
                uppercase: false,
                lowercase: false,
                numbers: true,
                symbols: false
            });
            expect(pw).to.match(/^[0-9]+$/);
        });

        it('should include symbols when enabled', () => {
            const pw = encryption.generatePassword(100, {
                uppercase: false,
                lowercase: false,
                numbers: false,
                symbols: true
            });
            expect(pw).to.match(/^[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]+$/);
        });
    });
});
