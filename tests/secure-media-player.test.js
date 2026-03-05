const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

describe('SecureMediaPlayer', () => {
    let SecureMediaPlayer;
    let tmpDir;
    let encryptionKey;

    before(() => {
        // Mock electron's app before requiring the module
        const Module = require('module');
        const origResolve = Module._resolveFilename;
        const stub = sinon.stub(Module, '_resolveFilename').callsFake(function (request, parent, ...args) {
            if (request === 'electron') return request;
            return origResolve.call(this, request, parent, ...args);
        });

        require.cache[require.resolve('electron')] = {
            id: 'electron', filename: 'electron', loaded: true,
            exports: {
                app: { getPath: sinon.stub().returns(os.tmpdir()) }
            }
        };
        require.cache['electron'] = require.cache[require.resolve('electron')];

        const mod = require('../lib/secure-media-player');
        SecureMediaPlayer = mod.SecureMediaPlayer;

        stub.restore();
    });

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'smp-test-'));
        encryptionKey = crypto.randomBytes(32).toString('hex');
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    async function createEncryptedFile(content) {
        const keyBuffer = Buffer.from(encryptionKey, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-ctr', keyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
        const filePath = path.join(tmpDir, `encrypted_${crypto.randomBytes(4).toString('hex')}.bin`);
        await fsp.writeFile(filePath, Buffer.concat([iv, encrypted]));
        return { filePath, iv };
    }

    describe('constructor', () => {
        it('should initialize with encryption key', () => {
            const player = new SecureMediaPlayer(encryptionKey);
            expect(player.encryptionKey).to.equal(encryptionKey);
            expect(player.activeStreams).to.be.instanceOf(Map);
            expect(player.server).to.be.null;
        });
    });

    describe('initialize()', () => {
        let player;

        afterEach(async () => {
            if (player && player.server) {
                await player.cleanup();
            }
        });

        it('should start a local express server on a random port', async () => {
            player = new SecureMediaPlayer(encryptionKey);
            const port = await player.initialize();
            expect(port).to.be.a('number');
            expect(port).to.be.greaterThan(0);
            expect(player.port).to.equal(port);
            expect(player.server).to.not.be.null;
        });
    });

    describe('createStreamUrl()', () => {
        let player;

        beforeEach(async () => {
            player = new SecureMediaPlayer(encryptionKey);
            await player.initialize();
        });

        afterEach(async () => {
            if (player && player.server) await player.cleanup();
        });

        it('should generate a valid stream URL', async () => {
            const { filePath } = await createEncryptedFile(Buffer.from('test video data'));
            const url = await player.createStreamUrl(filePath, 'video/mp4');

            expect(url).to.be.a('string');
            expect(url).to.match(/^http:\/\/127\.0\.0\.1:\d+\/stream\/[0-9a-f]{32}$/);
        });

        it('should register the stream in activeStreams', async () => {
            const { filePath } = await createEncryptedFile(Buffer.from('data'));
            const url = await player.createStreamUrl(filePath);

            const streamId = url.split('/stream/')[1];
            expect(player.activeStreams.has(streamId)).to.be.true;

            const info = player.activeStreams.get(streamId);
            expect(info.filePath).to.equal(filePath);
            expect(info.mimeType).to.equal('video/mp4');
            expect(info.accessCount).to.equal(0);
        });

        it('should throw for non-existent file', async () => {
            try {
                await player.createStreamUrl('/nonexistent/file.bin');
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.match(/non trouvé|not found/i);
            }
        });
    });

    describe('readEncryptionMetadata()', () => {
        let player;

        beforeEach(() => {
            player = new SecureMediaPlayer(encryptionKey);
        });

        it('should read 16-byte IV from start of file', async () => {
            const iv = crypto.randomBytes(16);
            const data = crypto.randomBytes(100);
            const filePath = path.join(tmpDir, 'meta.bin');
            await fsp.writeFile(filePath, Buffer.concat([iv, data]));

            const metadata = await player.readEncryptionMetadata(filePath);
            expect(metadata.iv).to.exist;
            expect(Buffer.isBuffer(metadata.iv)).to.be.true;
            expect(metadata.iv.length).to.equal(16);
            expect(metadata.iv.equals(iv)).to.be.true;
        });
    });

    describe('createDecryptStreamForRange()', () => {
        let player;

        beforeEach(() => {
            player = new SecureMediaPlayer(encryptionKey);
        });

        it('should decrypt block-aligned range correctly', async () => {
            const plaintext = Buffer.alloc(256, 0);
            for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 256;

            const { filePath, iv } = await createEncryptedFile(plaintext);

            const stream = await player.createDecryptStreamForRange(filePath, { iv }, 0, plaintext.length - 1);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const result = Buffer.concat(chunks);
            expect(result.slice(0, plaintext.length).equals(plaintext)).to.be.true;
        });

        it('should decrypt non-block-aligned start offset', async () => {
            const plaintext = Buffer.alloc(256);
            for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 256;

            const { filePath, iv } = await createEncryptedFile(plaintext);

            const startByte = 5;
            const stream = await player.createDecryptStreamForRange(filePath, { iv }, startByte, plaintext.length - 1);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const result = Buffer.concat(chunks);
            const expected = plaintext.slice(startByte);
            expect(result.slice(0, expected.length).equals(expected)).to.be.true;
        });
    });

    describe('cleanup()', () => {
        it('should close the server', async () => {
            const player = new SecureMediaPlayer(encryptionKey);
            await player.initialize();
            expect(player.server).to.not.be.null;

            await player.cleanup();
            // After cleanup, trying to listen on the same server should not work
            // The test just verifies cleanup resolves without error
        });

        it('should be a no-op if server is null', async () => {
            const player = new SecureMediaPlayer(encryptionKey);
            await player.cleanup(); // should not throw
        });
    });
});
