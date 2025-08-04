// auth.test.js - Tests pour le module d'authentification
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const { app, BrowserWindow } = require('electron');

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
            // Mock de la réponse axios
            const mockResponse = {
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
            };
            
            sinon.stub(client.client, 'post').resolves(mockResponse);
            
            const result = await client.login('testuser', 'password123');
            
            expect(result.success).to.be.true;
            expect(result.user).to.deep.equal(mockResponse.data.user);
            expect(result.membership).to.deep.equal(mockResponse.data.user.membership);
            expect(client.token).to.equal('test-token');
            expect(client.refreshToken).to.equal('test-refresh-token');
        });
        
        it('devrait gérer l\'erreur d\'abonnement Paid Memberships Pro', async () => {
            const errorResponse = {
                response: {
                    status: 403,
                    data: {
                        code: 'no_membership',
                        message: 'Vous devez avoir un abonnement actif pour utiliser l\'application'
                    }
                }
            };
            
            sinon.stub(client.client, 'post').rejects(errorResponse);
            
            const result = await client.login('testuser', 'password123');
            
            expect(result.success).to.be.false;
            expect(result.requiresMembership).to.be.true;
            expect(result.error).to.include('abonnement actif');
        });
        
        it('devrait rafraîchir le token avec succès', async () => {
            client.refreshToken = 'old-refresh-token';
            
            const mockResponse = {
                data: {
                    token: 'new-token',
                    expires_in: 3600
                }
            };
            
            sinon.stub(client.client, 'post').resolves(mockResponse);
            
            const result = await client.refreshAccessToken();
            
            expect(result.success).to.be.true;
            expect(client.token).to.equal('new-token');
        });
        
        it('devrait vérifier l\'abonnement actif', async () => {
            const mockResponse = {
                data: {
                    is_active: true,
                    subscription: {
                        status: 'active',
                        level_id: 1,
                        level_name: 'Premium',
                        expires_at: '2024-12-31'
                    }
                }
            };
            
            sinon.stub(client.client, 'get').resolves(mockResponse);
            
            const result = await client.verifySubscription();
            
            expect(result.success).to.be.true;
            expect(result.isActive).to.be.true;
            expect(result.subscription.level_name).to.equal('Premium');
        });
        
        it('devrait détecter un abonnement expiré', async () => {
            const mockResponse = {
                data: {
                    is_active: false,
                    subscription: {
                        status: 'expired',
                        level_id: 1,
                        level_name: 'Premium',
                        expires_at: '2023-01-01'
                    }
                }
            };
            
            sinon.stub(client.client, 'get').resolves(mockResponse);
            
            const result = await client.verifySubscription();
            
            expect(result.success).to.be.true;
            expect(result.isActive).to.be.false;
            expect(result.subscription.status).to.equal('expired');
        });
    });
    
    describe('IPC Handlers - Authentification', () => {
        const { setupIpcHandlers } = require('../lib/ipc-handlers');
        let ipcMain, context;
        
        beforeEach(() => {
            ipcMain = {
                handle: sinon.stub()
            };
            
            context = {
                store: mockStore,
                deviceId: 'test-device-id',
                app: { getPath: sinon.stub().returns('/test/path') },
                dialog: {},
                mainWindow: { webContents: { send: sinon.stub() } },
                getApiClient: sinon.stub().returns(mockApiClient),
                setApiClient: sinon.stub(),
                getDatabase: sinon.stub()
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
        const SecureDatabase = require('../lib/database');
        let db, tempDbPath;
        
        beforeEach(() => {
            tempDbPath = path.join(__dirname, 'temp-test.db');
            db = new SecureDatabase(tempDbPath, 'test-encryption-key');
        });
        
        afterEach(() => {
            if (db) {
                db.close();
            }
            // Nettoyer le fichier de test
            const fs = require('fs');
            if (fs.existsSync(tempDbPath)) {
                fs.unlinkSync(tempDbPath);
            }
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
        
        it('devrait chiffrer et déchiffrer les données des cours', () => {
            const courseData = {
                course_id: 1,
                title: 'Test Course',
                description: 'Description secrète',
                thumbnail: 'https://example.com/image.jpg',
                instructor_name: 'John Doe',
                instructor_id: 1,
                lessons_count: 10,
                sections_count: 3,
                version: 1
            };
            
            db.saveCourse(courseData);
            const retrieved = db.getCourse(1);
            
            expect(retrieved.title).to.equal(courseData.title);
            expect(retrieved.description).to.equal(courseData.description);
            expect(retrieved.thumbnail).to.equal(courseData.thumbnail);
            
            // Vérifier que les données sont bien chiffrées dans la DB
            const raw = db.db.prepare('SELECT * FROM courses WHERE course_id = ?').get(1);
            expect(raw.description).to.not.equal(courseData.description);
            expect(raw.thumbnail_encrypted).to.not.equal(courseData.thumbnail);
        });
        
        it('devrait gérer la synchronisation de la progression', () => {
            // Créer une leçon
            db.saveLesson({
                lesson_id: 1,
                section_id: 1,
                title: 'Test Lesson',
                type: 'video',
                content: 'Contenu de la leçon'
            });
            
            // Mettre à jour la progression
            db.updateLessonProgress(1, 50, false);
            
            // Vérifier la file de synchronisation
            const unsyncedItems = db.getUnsyncedItems();
            expect(unsyncedItems).to.have.length(1);
            expect(unsyncedItems[0].entity_type).to.equal('lesson');
            expect(unsyncedItems[0].action).to.equal('progress');
            expect(unsyncedItems[0].data.progress).to.equal(50);
        });
    });
});

// Tests d'intégration
describe('Tests d\'intégration - Authentification avec Paid Memberships Pro', () => {
    it('devrait vérifier l\'abonnement après connexion', async () => {
        const LearnPressAPIClient = require('../lib/api-client');
        const client = new LearnPressAPIClient('https://test.com', 'test-device');
        
        // Mock de la connexion réussie
        sinon.stub(client.client, 'post').withArgs('/auth/login').resolves({
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
        });
        
        // Mock de la vérification d'abonnement
        sinon.stub(client.client, 'get').withArgs('/auth/verify').resolves({
            data: {
                is_active: true,
                subscription: {
                    status: 'active',
                    level_name: 'Gold',
                    expires_at: '2024-12-31'
                }
            }
        });
        
        // Se connecter
        const loginResult = await client.login('user', 'pass');
        expect(loginResult.success).to.be.true;
        
        // Vérifier l'abonnement
        const verifyResult = await client.verifySubscription();
        expect(verifyResult.isActive).to.be.true;
        expect(verifyResult.subscription.level_name).to.equal('Gold');
    });
});
