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
            const errorInfo = {
                type: 'response',
                status: 403,
                data: { code: 'no_active_membership', message: 'Abonnement requis' },
                userMessage: 'Accès refusé. Vérifiez vos permissions.'
            };

            sinon.stub(client, 'makeRequest').rejects(errorInfo);

            const result = await client.login('user', 'pass');

            expect(result.success).to.be.false;
            expect(result.requiresMembership).to.be.true;
            expect(result.code).to.equal('no_active_membership');
        });
    });
});
