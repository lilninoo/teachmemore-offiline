// auth.test.js - Tests pour le module d'authentification
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');

// Tests unitaires pour l'authentification
describe('Module d\'authentification', () => {
    let mockStore, mockApiClient;
    
    beforeEach(() => {
        // Mock du store
        mockStore = {
            get: sinon.stub(),
            set: sinon.stub(),
            delete: sinon.stub(),
            clear: sinon.stub()
        };
        
        // Mock de l'API client
        mockApiClient = {
            login: sinon.stub(),
            logout: sinon.stub(),
            refreshAccessToken: sinon.stub(),
            verifySubscription: sinon.stub()
        };
    });
    
    afterEach(() => {
        sinon.restore();
    });
    
    describe('API Client - Authentification', () => {
        const LearnPressAPIClient = require('../lib/api-client');
        let client;
        
        beforeEach(() => {
            client = new LearnPressAPIClient('https://test.com', 'test-device-id');
        });
        
        it('devrait gérer une connexion réussie', async () => {
            sinon.stub(client, 'client').callsFake(async () => ({
                status: 200,
                data: {
                    token: 'test-token',
                    refresh_token: 'test-refresh-token',
                    expires_in: 3600,
                    user: {
                        id: 1,
                        username: 'testuser',
                        email: 'test@example.com',
                        membership: {
                            level_id: 1,
                            level_name: 'Premium',
                            expires_at: '2024-12-31'
                        }
                    }
                }
            }));
            
            const result = await client.login('testuser', 'password123');
            
            expect(result.success).to.be.true;
            expect(client.token).to.equal('test-token');
            expect(client.refreshToken).to.equal('test-refresh-token');
        });
        
        it('devrait gérer l\'erreur d\'abonnement Paid Memberships Pro', async () => {
            sinon.stub(client, 'client').callsFake(async () => {
                const error = new Error('Membership required');
                error.response = {
                    status: 403,
                    data: {
                        code: 'no_active_membership',
                        message: 'Vous devez avoir un abonnement actif pour utiliser l\'application'
                    }
                };
                throw error;
            });
            
            const result = await client.login('testuser', 'password123');
            
            expect(result.success).to.be.false;
            expect(result.requiresMembership).to.be.true;
        });
        
        it('devrait rafraîchir le token avec succès', async () => {
            client.refreshToken = 'old-refresh-token';
            const axios = require('axios');
            
            sinon.stub(axios, 'post').resolves({
                data: {
                    token: 'new-token',
                    expires_in: 3600
                }
            });
            
            const result = await client.refreshAccessToken();
            
            expect(result.success).to.be.true;
            expect(client.token).to.equal('new-token');
        });
        
        it('devrait vérifier l\'abonnement actif', async () => {
            sinon.stub(client, 'client').callsFake(async () => ({
                status: 200,
                data: {
                    subscription: {
                        is_active: true,
                        status: 'active',
                        level_id: 1,
                        level_name: 'Premium',
                        expires_at: '2024-12-31'
                    }
                }
            }));
            
            const result = await client.verifySubscription();
            
            expect(result.success).to.be.true;
            expect(result.isActive).to.be.true;
            expect(result.subscription.level_name).to.equal('Premium');
        });
        
        it('devrait détecter un abonnement expiré', async () => {
            sinon.stub(client, 'client').callsFake(async () => ({
                status: 200,
                data: {
                    subscription: {
                        is_active: false,
                        status: 'expired',
                        level_id: 1,
                        level_name: 'Premium',
                        expires_at: '2023-01-01'
                    }
                }
            }));
            
            const result = await client.verifySubscription();
            
            expect(result.success).to.be.true;
            expect(result.isActive).to.be.false;
            expect(result.subscription.status).to.equal('expired');
        });
    });
    
    describe('IPC Handlers - Authentification', () => {
        const { setupIpcHandlers } = require('../lib/ipc/index');
        let ipcMain, context;
        
        beforeEach(() => {
            ipcMain = {
                handle: sinon.stub(),
                on: sinon.stub()
            };
            
            context = {
                store: mockStore,
                deviceId: 'test-device-id',
                app: { getPath: sinon.stub().returns('/test/path'), getVersion: sinon.stub().returns('1.0.0') },
                dialog: {},
                mainWindow: { webContents: { send: sinon.stub() }, isDestroyed: () => false },
                getApiClient: sinon.stub().returns(mockApiClient),
                setApiClient: sinon.stub(),
                getDatabase: sinon.stub(),
                getDownloadManager: sinon.stub(),
                getMediaPlayer: sinon.stub(),
                errorHandler: { handleError: sinon.stub(), getRecentErrors: sinon.stub().returns([]) },
                config: { isFeatureEnabled: sinon.stub().returns(true) },
                encryptionKey: 'a'.repeat(64),
                getSecureMediaPlayer: sinon.stub()
            };
            
            setupIpcHandlers(ipcMain, context);
        });
        
        it('devrait enregistrer le handler api-login', () => {
            const loginHandler = ipcMain.handle.args.find(
                args => args[0] === 'api-login'
            );
            expect(loginHandler).to.exist;
        });
        
        it('devrait enregistrer le handler api-verify-subscription', () => {
            const verifyHandler = ipcMain.handle.args.find(
                args => args[0] === 'api-verify-subscription'
            );
            expect(verifyHandler).to.exist;
        });
    });
    
    describe('Base de données sécurisée', () => {
        let SecureDatabase;
        let db, tempDbPath;

        before(function() {
            try {
                SecureDatabase = require('../lib/database');
            } catch (e) {
                this.skip();
            }
        });
        
        beforeEach(function() {
            if (!SecureDatabase) return this.skip();
            tempDbPath = path.join(__dirname, 'temp-auth-test.db');
            db = new SecureDatabase(tempDbPath, 'a'.repeat(64));
        });
        
        afterEach(() => {
            if (db) db.close();
            const fs = require('fs');
            try { fs.unlinkSync(tempDbPath); } catch (e) {}
            try { fs.unlinkSync(tempDbPath + '-wal'); } catch (e) {}
            try { fs.unlinkSync(tempDbPath + '-shm'); } catch (e) {}
        });
        
        it('devrait créer les tables nécessaires', () => {
            const tables = db.db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).all();
            
            const tableNames = tables.map(t => t.name);
            expect(tableNames).to.include('courses');
            expect(tableNames).to.include('sections');
            expect(tableNames).to.include('lessons');
            expect(tableNames).to.include('media');
            expect(tableNames).to.include('quizzes');
            expect(tableNames).to.include('sync_log');
        });
        
        it('devrait sauvegarder et récupérer un cours', () => {
            const courseData = {
                course_id: 1,
                title: 'Test Course',
                description: 'Description secrète',
                instructor_name: 'John Doe',
                instructor_id: 1,
                lessons_count: 10,
                sections_count: 3,
                downloaded_at: new Date().toISOString(),
                local_path: '/test/path'
            };
            
            db.saveCourse(courseData);
            const retrieved = db.getCourse(1);
            
            expect(retrieved).to.not.be.null;
            expect(retrieved.title).to.equal(courseData.title);
            expect(retrieved.instructor_name).to.equal(courseData.instructor_name);
        });
        
        it('devrait gérer la synchronisation de la progression', async () => {
            db.saveCourse({
                course_id: 1, title: 'C1', instructor_name: 'I',
                sections_count: 1, lessons_count: 1,
                downloaded_at: new Date().toISOString(), local_path: '/x'
            });
            db.db.prepare(`INSERT INTO sections (section_id, course_id, title) VALUES (1, 1, 'Section 1')`).run();
            
            await db.saveLesson({
                lesson_id: 1,
                section_id: 1,
                title: 'Test Lesson',
                type: 'video',
                order_index: 0,
                completed: 0,
                progress: 0
            });
            
            db.updateLessonProgress(1, 50, false);
            
            const unsyncedItems = db.getUnsyncedItems();
            expect(unsyncedItems.length).to.be.greaterThan(0);
        });
    });
});

// Tests d'intégration
describe('Tests d\'intégration - Authentification avec Paid Memberships Pro', () => {
    it('devrait vérifier l\'abonnement après connexion', async () => {
        const LearnPressAPIClient = require('../lib/api-client');
        const client = new LearnPressAPIClient('https://test.com', 'test-device');
        
        sinon.stub(client, 'client').callsFake(async (config) => {
            if (config.url === '/auth/login') {
                return {
                    status: 200,
                    data: {
                        token: 'test-token',
                        refresh_token: 'refresh-token',
                        user: {
                            id: 1,
                            membership: {
                                level_id: 2,
                                level_name: 'Gold',
                                expires_at: '2024-12-31'
                            }
                        }
                    }
                };
            }
            if (config.url === '/auth/verify') {
                return {
                    status: 200,
                    data: {
                        subscription: {
                            is_active: true,
                            status: 'active',
                            level_name: 'Gold',
                            expires_at: '2024-12-31'
                        }
                    }
                };
            }
            throw new Error('Unexpected request: ' + config.url);
        });
        
        const loginResult = await client.login('user', 'pass');
        expect(loginResult.success).to.be.true;
        
        const verifyResult = await client.verifySubscription();
        expect(verifyResult.isActive).to.be.true;
        expect(verifyResult.subscription.level_name).to.equal('Gold');
    });
});
