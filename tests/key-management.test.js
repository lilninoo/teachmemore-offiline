const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');

describe('Key Management - getOrCreateEncryptionKey()', () => {
    let tmpDir;
    let mockApp;
    let mockSafeStorage;
    let mockLog;

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'key-mgmt-test-'));

        mockApp = {
            getPath: sinon.stub().withArgs('userData').returns(tmpDir)
        };

        mockSafeStorage = {
            isEncryptionAvailable: sinon.stub(),
            encryptString: sinon.stub(),
            decryptString: sinon.stub()
        };

        mockLog = {
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub()
        };
    });

    afterEach(async () => {
        sinon.restore();
        Object.keys(require.cache).forEach(key => {
            if (key.includes('key-management')) delete require.cache[key];
        });
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    function loadModule() {
        const Module = require('module');
        const originalResolve = Module._resolveFilename;
        const stub = sinon.stub(Module, '_resolveFilename').callsFake(function (request, parent, ...args) {
            if (request === 'electron') {
                return request;
            }
            if (request === 'electron-log') {
                return request;
            }
            return originalResolve.call(this, request, parent, ...args);
        });

        const electronExports = { app: mockApp, safeStorage: mockSafeStorage };
        require.cache[require.resolve('electron')] = {
            id: 'electron',
            filename: 'electron',
            loaded: true,
            exports: electronExports
        };
        require.cache['electron'] = require.cache[require.resolve('electron')];

        require.cache[require.resolve('electron-log')] = {
            id: 'electron-log',
            filename: 'electron-log',
            loaded: true,
            exports: mockLog
        };
        require.cache['electron-log'] = require.cache[require.resolve('electron-log')];

        delete require.cache[require.resolve('../lib/key-management')];
        const mod = require('../lib/key-management');
        stub.restore();
        return mod;
    }

    it('should generate a new key when no key file exists', async () => {
        mockSafeStorage.isEncryptionAvailable.returns(false);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.be.a('string').with.lengthOf(64);
        expect(key).to.match(/^[0-9a-f]{64}$/);

        const keyFile = path.join(tmpDir, '.key');
        const written = await fsp.readFile(keyFile, 'utf8');
        expect(written).to.equal(key);
    });

    it('should read existing plaintext key from file when safeStorage unavailable', async () => {
        const existingKey = crypto.randomBytes(32).toString('hex');
        const keyFile = path.join(tmpDir, '.key');
        await fsp.writeFile(keyFile, existingKey, { mode: 0o600 });

        mockSafeStorage.isEncryptionAvailable.returns(false);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.equal(existingKey);
    });

    it('should use safeStorage to encrypt new key when available', async () => {
        mockSafeStorage.isEncryptionAvailable.returns(true);
        const fakeEncrypted = Buffer.from('encrypted-data');
        mockSafeStorage.encryptString.returns(fakeEncrypted);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.be.a('string').with.lengthOf(64);
        expect(mockSafeStorage.encryptString.calledOnce).to.be.true;

        const keyFile = path.join(tmpDir, '.key');
        const raw = await fsp.readFile(keyFile);
        expect(raw.equals(fakeEncrypted)).to.be.true;
    });

    it('should decrypt key with safeStorage when available and key file exists', async () => {
        const originalKey = crypto.randomBytes(32).toString('hex');
        const fakeEncrypted = Buffer.from('safe-storage-encrypted');
        const keyFile = path.join(tmpDir, '.key');
        await fsp.writeFile(keyFile, fakeEncrypted, { mode: 0o600 });

        mockSafeStorage.isEncryptionAvailable.returns(true);
        mockSafeStorage.decryptString.withArgs(sinon.match.any).returns(originalKey);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.equal(originalKey);
        expect(mockSafeStorage.decryptString.calledOnce).to.be.true;
    });

    it('should migrate plaintext key to safeStorage on decrypt failure', async () => {
        const plaintextKey = crypto.randomBytes(32).toString('hex');
        const keyFile = path.join(tmpDir, '.key');
        await fsp.writeFile(keyFile, plaintextKey, { mode: 0o600 });

        mockSafeStorage.isEncryptionAvailable.returns(true);
        mockSafeStorage.decryptString.throws(new Error('decrypt failed'));
        const fakeEncrypted = Buffer.from('newly-encrypted');
        mockSafeStorage.encryptString.withArgs(plaintextKey).returns(fakeEncrypted);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.equal(plaintextKey);
        expect(mockSafeStorage.encryptString.calledOnceWith(plaintextKey)).to.be.true;
        expect(mockLog.info.calledWithMatch(/migrat/i)).to.be.true;

        const raw = await fsp.readFile(keyFile);
        expect(raw.equals(fakeEncrypted)).to.be.true;
    });

    it('should generate new key when existing key file has invalid content', async () => {
        const keyFile = path.join(tmpDir, '.key');
        await fsp.writeFile(keyFile, 'too-short', { mode: 0o600 });

        mockSafeStorage.isEncryptionAvailable.returns(false);

        const { getOrCreateEncryptionKey } = loadModule();
        const key = await getOrCreateEncryptionKey();

        expect(key).to.be.a('string').with.lengthOf(64);
        expect(key).to.not.equal('too-short');
    });
});
