const { expect } = require('chai');
const sinon = require('sinon');
const LearnPressAPIClient = require('../lib/api-client');

describe('LearnPressAPIClient', () => {
    let client;
    
    beforeEach(() => {
        client = new LearnPressAPIClient('https://test.com', 'test-device');
    });

    afterEach(() => {
        sinon.restore();
    });
    
    describe('login', () => {
        it('devrait gérer les erreurs d\'abonnement', async () => {
            sinon.stub(client, 'client').callsFake(async () => {
                const error = new Error('Membership required');
                error.response = {
                    status: 403,
                    data: { code: 'no_active_membership', message: 'Abonnement requis' }
                };
                throw error;
            });
            
            const result = await client.login('user', 'pass');
            
            expect(result.success).to.be.false;
            expect(result.requiresMembership).to.be.true;
        });

        it('devrait gérer une connexion réussie', async () => {
            sinon.stub(client, 'client').callsFake(async () => ({
                status: 200,
                data: {
                    token: 'test-token',
                    refresh_token: 'test-refresh',
                    user: { id: 1, username: 'testuser' }
                }
            }));

            const result = await client.login('testuser', 'pass');

            expect(result.success).to.be.true;
            expect(client.token).to.equal('test-token');
            expect(client.refreshToken).to.equal('test-refresh');
        });
    });
});
