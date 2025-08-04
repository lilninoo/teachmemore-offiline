// notarize.js - Script de notarisation pour macOS
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    
    // Ne notariser que pour macOS
    if (electronPlatformName !== 'darwin') {
        return;
    }
    
    // Vérifier que les variables d'environnement sont définies
    if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
        console.warn('⚠️  Notarisation ignorée : Variables Apple non définies');
        console.warn('   Définissez APPLE_ID, APPLE_ID_PASSWORD et APPLE_TEAM_ID');
        return;
    }
    
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);
    
    console.log('🍎 Notarisation de l\'application macOS...');
    console.log(`   App: ${appPath}`);
    
    try {
        await notarize({
            appBundleId: 'com.teachmemore.learnpress-offline',
            appPath: appPath,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
        });
        
        console.log('✅ Notarisation réussie !');
    } catch (error) {
        console.error('❌ Erreur lors de la notarisation :', error);
        throw error;
    }
};
