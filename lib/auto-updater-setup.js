const path = require('path');

function setupAutoUpdater({ autoUpdater, getMainWindow, dialog, log, Notification, setIsQuitting }) {
    autoUpdater.on('checking-for-update', () => {
        log.info('Vérification des mises à jour...');
    });

    autoUpdater.on('update-available', (info) => {
        log.info('Mise à jour disponible:', info.version);
        
        const mainWindow = getMainWindow();
        if (mainWindow) {
            const notification = new Notification({
                title: 'Mise à jour disponible',
                body: `Une nouvelle version (${info.version}) est disponible. Elle sera téléchargée en arrière-plan.`,
                icon: path.join(__dirname, '..', 'assets/icons/icon.png')
            });
            
            notification.show();
        }
    });

    autoUpdater.on('update-not-available', () => {
        log.info('Aucune mise à jour disponible');
    });

    autoUpdater.on('error', (err) => {
        log.error('Erreur lors de la mise à jour:', err);
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-progress', progressObj);
        }
    });

    autoUpdater.on('update-downloaded', () => {
        log.info('Mise à jour téléchargée');
        
        const mainWindow = getMainWindow();
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Mise à jour prête',
                message: 'La mise à jour a été téléchargée. L\'application va redémarrer pour l\'installer.',
                buttons: ['Redémarrer maintenant', 'Plus tard']
            }).then((result) => {
                if (result.response === 0) {
                    setIsQuitting(true);
                    autoUpdater.quitAndInstall();
                }
            });
        }
    });
}

module.exports = { setupAutoUpdater };
