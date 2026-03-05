function createMenu({ Menu, shell, dialog, app, mainWindow, autoUpdater, log, isDev }) {
    const template = [
        {
            label: 'Fichier',
            submenu: [
                {
                    label: 'Synchroniser',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('sync-courses');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Paramètres',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('open-settings');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Déconnexion',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('logout');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quitter',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Édition',
            submenu: [
                { role: 'undo', label: 'Annuler' },
                { role: 'redo', label: 'Rétablir' },
                { type: 'separator' },
                { role: 'cut', label: 'Couper' },
                { role: 'copy', label: 'Copier' },
                { role: 'paste', label: 'Coller' },
                { role: 'selectall', label: 'Tout sélectionner' }
            ]
        },
        {
            label: 'Affichage',
            submenu: [
                { role: 'reload', label: 'Recharger' },
                { role: 'forcereload', label: 'Forcer le rechargement' },
                { type: 'separator' },
                { role: 'resetzoom', label: 'Réinitialiser le zoom' },
                { role: 'zoomin', label: 'Zoom avant' },
                { role: 'zoomout', label: 'Zoom arrière' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Plein écran' }
            ]
        },
        {
            label: 'Fenêtre',
            submenu: [
                { role: 'minimize', label: 'Réduire' },
                { role: 'close', label: 'Fermer' }
            ]
        },
        {
            label: 'Aide',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        shell.openExternal('https://docs.votre-site.com');
                    }
                },
                {
                    label: 'Support',
                    click: () => {
                        shell.openExternal('https://support.votre-site.com');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Afficher les logs',
                    click: () => {
                        const logPath = log.transports.file.getFile().path;
                        shell.showItemInFolder(logPath);
                    }
                },
                { type: 'separator' },
                {
                    label: 'À propos',
                    click: () => {
                        if (mainWindow) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'À propos',
                                message: 'LearnPress Offline',
                                detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}`,
                                buttons: ['OK']
                            });
                        }
                    }
                },
                {
                    label: 'Vérifier les mises à jour',
                    click: () => {
                        autoUpdater.checkForUpdatesAndNotify();
                    }
                }
            ]
        }
    ];
    
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                { role: 'about', label: 'À propos de LearnPress Offline' },
                { type: 'separator' },
                {
                    label: 'Préférences...',
                    accelerator: 'Cmd+,',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('open-settings');
                        }
                    }
                },
                { type: 'separator' },
                { role: 'services', label: 'Services', submenu: [] },
                { type: 'separator' },
                { role: 'hide', label: 'Masquer LearnPress Offline' },
                { role: 'hideothers', label: 'Masquer les autres' },
                { role: 'unhide', label: 'Tout afficher' },
                { type: 'separator' },
                { role: 'quit', label: 'Quitter LearnPress Offline' }
            ]
        });
        
        const windowMenuIndex = template.findIndex(m => m.label === 'Fenêtre');
        if (windowMenuIndex !== -1) {
            template[windowMenuIndex].submenu = [
                { role: 'minimize', label: 'Réduire' },
                { role: 'zoom', label: 'Zoom' },
                { type: 'separator' },
                { role: 'front', label: 'Tout ramener au premier plan' }
            ];
        }
    }
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

module.exports = { createMenu };
