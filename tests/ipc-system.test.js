const { expect } = require('chai');
const sinon = require('sinon');

describe('IPC System Handlers', () => {
    let handlers;
    let onHandlers;
    let mockIpcMain;
    let mockMainWindow;
    let mockStore;
    let mockApp;
    let mockErrorHandler;
    let mockConfig;
    let mockShell;

    beforeEach(() => {
        handlers = {};
        onHandlers = {};

        mockShell = {
            openExternal: sinon.stub().resolves()
        };

        // Inject electron mock into require cache so internal require('electron') calls work
        require.cache[require.resolve('electron')] = {
            id: 'electron', filename: 'electron', loaded: true,
            exports: {
                shell: mockShell,
                net: { isOnline: sinon.stub().returns(true) },
                Notification: Object.assign(
                    sinon.stub().returns({ on: sinon.stub(), show: sinon.stub() }),
                    { isSupported: sinon.stub().returns(false) }
                )
            }
        };

        mockIpcMain = {
            handle: sinon.stub().callsFake((channel, handler) => {
                handlers[channel] = handler;
            }),
            on: sinon.stub().callsFake((channel, handler) => {
                onHandlers[channel] = handler;
            })
        };

        mockMainWindow = {
            isDestroyed: sinon.stub().returns(false),
            isMinimized: sinon.stub().returns(false),
            restore: sinon.stub(),
            focus: sinon.stub(),
            webContents: {
                send: sinon.stub()
            }
        };

        mockStore = {
            get: sinon.stub(),
            set: sinon.stub()
        };

        mockApp = {
            getVersion: sinon.stub().returns('1.0.0'),
            getPath: sinon.stub().withArgs('userData').returns('/fake/userData')
        };

        mockErrorHandler = {
            handleError: sinon.stub().resolves(),
            getRecentErrors: sinon.stub().returns([])
        };

        mockConfig = {
            isFeatureEnabled: sinon.stub().returns(true)
        };

        const { setupSystemHandlers } = require('../lib/ipc/system');
        setupSystemHandlers(mockIpcMain, {
            store: mockStore,
            deviceId: 'test-device-123',
            app: mockApp,
            mainWindow: mockMainWindow,
            getApiClient: sinon.stub().returns({}),
            getDatabase: sinon.stub().returns({}),
            getDownloadManager: sinon.stub().returns({}),
            errorHandler: mockErrorHandler,
            config: mockConfig
        });
    });

    afterEach(() => {
        sinon.restore();
        delete require.cache[require.resolve('../lib/ipc/system')];
        delete require.cache[require.resolve('electron')];
    });

    describe('force-emit-event', () => {
        const ALLOWED_EVENTS = [
            'sync-courses', 'sync-completed', 'sync-error',
            'download-progress', 'download-completed', 'download-error',
            'download-cancelled', 'course-downloaded',
            'membership-status-changed', 'membership-expiring-soon',
            'connection-status-changed', 'update-progress'
        ];

        ALLOWED_EVENTS.forEach(eventName => {
            it(`should allow whitelisted event "${eventName}"`, () => {
                const result = handlers['force-emit-event']({}, eventName, { data: 'test' });
                expect(result.success).to.be.true;
                expect(mockMainWindow.webContents.send.calledOnceWith(eventName, { data: 'test' })).to.be.true;
            });
        });

        it('should block non-whitelisted events', () => {
            const result = handlers['force-emit-event']({}, 'execute-code', { payload: 'evil' });
            expect(result.success).to.be.false;
            expect(result.error).to.include('execute-code');
            expect(mockMainWindow.webContents.send.called).to.be.false;
        });

        it('should block arbitrary event names', () => {
            const malicious = ['eval', 'shell-exec', 'fs-write', 'require-module'];
            malicious.forEach(evt => {
                mockMainWindow.webContents.send.resetHistory();
                const result = handlers['force-emit-event']({}, evt, {});
                expect(result.success).to.be.false;
                expect(mockMainWindow.webContents.send.called).to.be.false;
            });
        });

        it('should fail when mainWindow is destroyed', () => {
            mockMainWindow.isDestroyed.returns(true);
            const result = handlers['force-emit-event']({}, 'sync-courses', {});
            expect(result.success).to.be.false;
        });
    });

    describe('open-external', () => {
        it('should allow valid HTTPS URLs', async () => {
            const result = await handlers['open-external']({}, 'https://example.com');
            expect(result.success).to.be.true;
        });

        it('should block non-HTTPS URLs (http)', async () => {
            const result = await handlers['open-external']({}, 'http://example.com');
            expect(result.success).to.be.false;
            expect(result.error).to.match(/https/i);
        });

        it('should block file:// URLs', async () => {
            const result = await handlers['open-external']({}, 'file:///etc/passwd');
            expect(result.success).to.be.false;
        });

        it('should block javascript: URLs', async () => {
            const result = await handlers['open-external']({}, 'javascript:alert(1)');
            expect(result.success).to.be.false;
        });

        it('should block ftp: URLs', async () => {
            const result = await handlers['open-external']({}, 'ftp://evil.com/payload');
            expect(result.success).to.be.false;
        });

        it('should block invalid URLs', async () => {
            const result = await handlers['open-external']({}, 'not a url');
            expect(result.success).to.be.false;
        });

        it('should block data: URLs', async () => {
            const result = await handlers['open-external']({}, 'data:text/html,<h1>evil</h1>');
            expect(result.success).to.be.false;
        });
    });

    describe('get-device-id', () => {
        it('should return the device id', () => {
            const result = handlers['get-device-id']();
            expect(result).to.equal('test-device-123');
        });
    });

    describe('get-app-version', () => {
        it('should return app version', () => {
            const result = handlers['get-app-version']();
            expect(result).to.equal('1.0.0');
        });
    });

    describe('get-app-path', () => {
        it('should return userData path', () => {
            const result = handlers['get-app-path']();
            expect(result).to.equal('/fake/userData');
        });
    });

    describe('log-error', () => {
        it('should forward error to errorHandler', async () => {
            const err = { message: 'test error', stack: 'at line 1' };
            const result = await handlers['log-error']({}, err);
            expect(result).to.deep.equal({ success: true });
            expect(mockErrorHandler.handleError.calledOnce).to.be.true;
        });
    });

    describe('get-membership-restrictions', () => {
        it('should return null when no restrictions', () => {
            mockStore.get.withArgs('membershipRestrictions').returns(undefined);
            const result = handlers['get-membership-restrictions']();
            expect(result).to.be.null;
        });

        it('should return restrictions when set', () => {
            const restrictions = { maxCourses: 5 };
            mockStore.get.withArgs('membershipRestrictions').returns(restrictions);
            const result = handlers['get-membership-restrictions']();
            expect(result).to.deep.equal(restrictions);
        });
    });

    describe('check-feature-access', () => {
        it('should return true when no restrictions', () => {
            mockStore.get.withArgs('membershipRestrictions').returns(undefined);
            const result = handlers['check-feature-access']({}, 'download');
            expect(result).to.be.true;
        });

        it('should delegate to config.isFeatureEnabled when restrictions exist', () => {
            mockStore.get.withArgs('membershipRestrictions').returns({ limited: true });
            mockConfig.isFeatureEnabled.returns(false);
            const result = handlers['check-feature-access']({}, 'premium-feature');
            expect(result).to.be.false;
            expect(mockConfig.isFeatureEnabled.calledOnce).to.be.true;
        });
    });

    describe('debug-info', () => {
        it('should return status object', () => {
            mockStore.get.withArgs('token').returns('tok');
            mockStore.get.withArgs('refreshToken').returns('ref');
            const result = handlers['debug-info']();
            expect(result).to.have.all.keys(
                'apiClient', 'database', 'downloadManager', 'mainWindow', 'store', 'tokens'
            );
            expect(result.tokens.hasToken).to.be.true;
            expect(result.tokens.hasRefreshToken).to.be.true;
        });
    });

    describe('handler registration', () => {
        it('should register expected handlers', () => {
            const expectedChannels = [
                'get-device-id', 'get-app-version', 'get-app-path',
                'open-external', 'force-emit-event', 'debug-info',
                'get-membership-restrictions', 'check-feature-access'
            ];
            expectedChannels.forEach(ch => {
                expect(handlers).to.have.property(ch);
            });
        });

        it('should register renderer-log on-handler', () => {
            expect(onHandlers).to.have.property('renderer-log');
        });
    });
});
