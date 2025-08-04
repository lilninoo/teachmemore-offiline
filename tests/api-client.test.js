const { expect } = require('chai');
const LearnPressAPIClient = require('../lib/api-client');

describe('LearnPressAPIClient', () => {
    let client;
    
    beforeEach(() => {
        client = new LearnPressAPIClient('https://test.com', 'test-device');
    });
    
    describe('login', () => {
        it('devrait gérer les erreurs d\'abonnement', async () => {
            // Mock de la réponse 403
            client.client.post = async () => {
                const error = new Error();
                error.response = {
                    status: 403,
                    data: { code: 'no_membership', message: 'Abonnement requis' }
                };
                throw error;
            };
            
            const result = await client.login('user', 'pass');
            
            expect(result.success).to.be.false;
            expect(result.requiresMembership).to.be.true;
            expect(result.error).to.include('abonnement');
        });
    });
});
