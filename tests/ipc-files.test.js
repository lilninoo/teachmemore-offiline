const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;

describe('IPC File Handlers', () => {
    let handlers;
    let mockIpcMain;
    let userDataPath;

    beforeEach(async () => {
        handlers = {};
        userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'ipc-files-test-'));

        mockIpcMain = {
            handle: sinon.stub().callsFake((channel, handler) => {
                handlers[channel] = handler;
            })
        };

        const mockApp = {
            getPath: sinon.stub().withArgs('userData').returns(userDataPath)
        };

        const mockDialog = {
            showSaveDialog: sinon.stub().resolves({ canceled: false, filePath: '/tmp/save.txt' }),
            showOpenDialog: sinon.stub().resolves({ canceled: false, filePaths: ['/tmp/open.txt'] }),
            showMessageBox: sinon.stub().resolves({ response: 0 }),
            showErrorBox: sinon.stub()
        };

        const mockMainWindow = {};

        const { setupFileHandlers } = require('../lib/ipc/files');
        setupFileHandlers(mockIpcMain, {
            app: mockApp,
            dialog: mockDialog,
            mainWindow: mockMainWindow
        });
    });

    afterEach(async () => {
        sinon.restore();
        delete require.cache[require.resolve('../lib/ipc/files')];
        await fsp.rm(userDataPath, { recursive: true, force: true });
    });

    describe('file-read', () => {
        it('should block paths outside userData', async () => {
            const result = await handlers['file-read']({}, '/etc/passwd');
            expect(result.success).to.be.false;
            expect(result.error).to.match(/access denied/i);
        });

        it('should block path traversal attacks', async () => {
            const traversal = path.join(userDataPath, '..', '..', '..', 'etc', 'passwd');
            const result = await handlers['file-read']({}, traversal);
            expect(result.success).to.be.false;
            expect(result.error).to.match(/access denied/i);
        });

        it('should allow reading files inside userData', async () => {
            const filePath = path.join(userDataPath, 'test.txt');
            await fsp.writeFile(filePath, 'hello world');

            const result = await handlers['file-read']({}, filePath);
            expect(result.success).to.be.true;
            expect(result.data).to.equal('hello world');
        });

        it('should return error for non-existent files inside userData', async () => {
            const filePath = path.join(userDataPath, 'nonexistent.txt');
            const result = await handlers['file-read']({}, filePath);
            expect(result.success).to.be.false;
            expect(result.error).to.be.a('string');
        });
    });

    describe('file-write', () => {
        it('should block paths outside userData', async () => {
            const result = await handlers['file-write']({}, {
                filePath: '/tmp/outside.txt',
                data: 'malicious'
            });
            expect(result.success).to.be.false;
            expect(result.error).to.match(/access denied/i);
        });

        it('should block path traversal in write', async () => {
            const traversal = path.join(userDataPath, '..', 'escape.txt');
            const result = await handlers['file-write']({}, {
                filePath: traversal,
                data: 'bad'
            });
            expect(result.success).to.be.false;
        });

        it('should write files inside userData', async () => {
            const filePath = path.join(userDataPath, 'output.txt');
            const result = await handlers['file-write']({}, {
                filePath,
                data: 'written content'
            });
            expect(result.success).to.be.true;
            const content = await fsp.readFile(filePath, 'utf8');
            expect(content).to.equal('written content');
        });
    });

    describe('file-delete', () => {
        it('should block paths outside userData', async () => {
            const result = await handlers['file-delete']({}, '/etc/hosts');
            expect(result.success).to.be.false;
            expect(result.error).to.match(/access denied/i);
        });

        it('should block path traversal in delete', async () => {
            const traversal = path.join(userDataPath, '..', '..', 'important.txt');
            const result = await handlers['file-delete']({}, traversal);
            expect(result.success).to.be.false;
        });

        it('should delete files inside userData', async () => {
            const filePath = path.join(userDataPath, 'deleteme.txt');
            await fsp.writeFile(filePath, 'temp');

            const result = await handlers['file-delete']({}, filePath);
            expect(result.success).to.be.true;

            try {
                await fsp.access(filePath);
                expect.fail('File should have been deleted');
            } catch (e) {
                expect(e.code).to.equal('ENOENT');
            }
        });
    });

    describe('file-exists', () => {
        it('should block paths outside userData', async () => {
            const result = await handlers['file-exists']({}, '/etc/passwd');
            expect(result).to.be.false;
        });

        it('should return true for existing files inside userData', async () => {
            const filePath = path.join(userDataPath, 'exists.txt');
            await fsp.writeFile(filePath, 'data');
            const result = await handlers['file-exists']({}, filePath);
            expect(result).to.be.true;
        });

        it('should return false for non-existent files inside userData', async () => {
            const filePath = path.join(userDataPath, 'nope.txt');
            const result = await handlers['file-exists']({}, filePath);
            expect(result).to.be.false;
        });
    });

    describe('file-create-directory', () => {
        it('should block directories outside userData', async () => {
            const result = await handlers['file-create-directory']({}, '/tmp/outside-dir');
            expect(result.success).to.be.false;
        });

        it('should create directories inside userData', async () => {
            const dirPath = path.join(userDataPath, 'subdir', 'nested');
            const result = await handlers['file-create-directory']({}, dirPath);
            expect(result.success).to.be.true;

            const stat = await fsp.stat(dirPath);
            expect(stat.isDirectory()).to.be.true;
        });
    });

    describe('file-get-media-path', () => {
        it('should return path within userData/media', () => {
            const result = handlers['file-get-media-path']({}, 'video.mp4');
            expect(result).to.equal(path.join(userDataPath, 'media', 'video.mp4'));
        });
    });

    describe('path traversal attack vectors', () => {
        const attacks = [
            '../../../etc/passwd',
            '..\\..\\..\\windows\\system32\\config\\sam',
            'subdir/../../..',
            '%2e%2e%2f%2e%2e%2f',
        ];

        attacks.forEach(attack => {
            it(`should block traversal: "${attack}"`, async () => {
                const maliciousPath = path.join(userDataPath, attack);
                const resolved = path.resolve(maliciousPath);
                if (!resolved.startsWith(userDataPath + path.sep) && resolved !== userDataPath) {
                    const result = await handlers['file-read']({}, maliciousPath);
                    expect(result.success).to.be.false;
                }
            });
        });
    });
});
