const path = require('path');

function setupDeepLinking({ app, getMainWindow, log }) {
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('learnpress', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('learnpress');
    }
    
    const deeplinkingUrl = process.argv.find((arg) => arg.startsWith('learnpress://'));
    if (deeplinkingUrl) {
        handleDeepLink({ getMainWindow, log }, deeplinkingUrl);
    }
    
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink({ getMainWindow, log }, url);
    });
}

function handleDeepLink({ getMainWindow, log }, url) {
    log.info('Deep link reçu:', url);
    
    const mainWindow = getMainWindow();
    try {
        const urlParts = url.replace('learnpress://', '').split('/');
        const type = urlParts[0];
        const id = urlParts[1];
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('deep-link', { type, id });
            
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (error) {
        log.error('Erreur lors du traitement du deep link:', error);
    }
}

module.exports = { setupDeepLinking, handleDeepLink };
