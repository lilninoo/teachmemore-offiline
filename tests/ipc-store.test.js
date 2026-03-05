const { expect } = require('chai');
const sinon = require('sinon');

describe('IPC Store Handlers', () => {
    let handlers;
    let mockStore;
    let mockIpcMain;

    beforeEach(() => {
        handlers = {};
        mockIpcMain = {
            handle: sinon.stub().callsFake((channel, handler) => {
                handlers[channel] = handler;
            })
        };
        mockStore = {
            get: sinon.stub(),
            set: sinon.stub(),
            delete: sinon.stub(),
            clear: sinon.stub()
        };

        const { setupStoreHandlers } = require('../lib/ipc/store');
        setupStoreHandlers(mockIpcMain, { store: mockStore });
    });

    afterEach(() => {
        sinon.restore();
        delete require.cache[require.resolve('../lib/ipc/store')];
    });

    describe('store-get', () => {
        const SENSITIVE_KEYS = ['token', 'refreshToken', 'tokenExpiry', 'lastMembershipCheck'];

        SENSITIVE_KEYS.forEach(key => {
            it(`should block sensitive key "${key}"`, () => {
                const result = handlers['store-get']({}, key);
                expect(result).to.be.undefined;
                expect(mockStore.get.called).to.be.false;
            });
        });

        it('should allow non-sensitive keys', () => {
            mockStore.get.withArgs('theme').returns('dark');
            const result = handlers['store-get']({}, 'theme');
            expect(result).to.equal('dark');
            expect(mockStore.get.calledOnceWith('theme')).to.be.true;
        });

        it('should allow "apiUrl" key', () => {
            mockStore.get.withArgs('apiUrl').returns('https://example.com');
            const result = handlers['store-get']({}, 'apiUrl');
            expect(result).to.equal('https://example.com');
        });

        it('should return undefined for unset non-sensitive key', () => {
            mockStore.get.withArgs('language').returns(undefined);
            const result = handlers['store-get']({}, 'language');
            expect(result).to.be.undefined;
        });
    });

    describe('store-set', () => {
        const SENSITIVE_KEYS = ['token', 'refreshToken', 'tokenExpiry', 'lastMembershipCheck'];

        SENSITIVE_KEYS.forEach(key => {
            it(`should block sensitive key "${key}"`, () => {
                const result = handlers['store-set']({}, key, 'value');
                expect(result).to.deep.include({ success: false });
                expect(result.error).to.be.a('string');
                expect(mockStore.set.called).to.be.false;
            });
        });

        it('should return { success: true } for allowed keys', () => {
            const result = handlers['store-set']({}, 'theme', 'dark');
            expect(result).to.deep.equal({ success: true });
            expect(mockStore.set.calledOnceWith('theme', 'dark')).to.be.true;
        });

        it('should accept complex values', () => {
            const bounds = { x: 0, y: 0, width: 800, height: 600 };
            const result = handlers['store-set']({}, 'windowBounds', bounds);
            expect(result).to.deep.equal({ success: true });
            expect(mockStore.set.calledOnceWith('windowBounds', bounds)).to.be.true;
        });
    });

    describe('store-delete', () => {
        const SENSITIVE_KEYS = ['token', 'refreshToken', 'tokenExpiry', 'lastMembershipCheck'];

        SENSITIVE_KEYS.forEach(key => {
            it(`should block sensitive key "${key}"`, () => {
                const result = handlers['store-delete']({}, key);
                expect(result).to.deep.include({ success: false });
                expect(mockStore.delete.called).to.be.false;
            });
        });

        it('should allow deleting non-sensitive keys', () => {
            const result = handlers['store-delete']({}, 'theme');
            expect(result).to.deep.equal({ success: true });
            expect(mockStore.delete.calledOnceWith('theme')).to.be.true;
        });
    });

    describe('store-clear', () => {
        it('should clear the store and return success', () => {
            const result = handlers['store-clear']();
            expect(result).to.deep.equal({ success: true });
            expect(mockStore.clear.calledOnce).to.be.true;
        });
    });

    describe('handler registration', () => {
        it('should register all 4 handlers', () => {
            expect(mockIpcMain.handle.callCount).to.equal(4);
            expect(handlers).to.have.all.keys('store-get', 'store-set', 'store-delete', 'store-clear');
        });
    });
});
