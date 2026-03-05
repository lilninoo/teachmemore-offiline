function createSplashWindow({ BrowserWindow, path, onCreated }) {
    const splashWindow = new BrowserWindow({
        width: 600,
        height: 400,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    
    splashWindow.loadFile(path.join(__dirname, '..', 'src/splash.html'));
    
    splashWindow.on('closed', () => {
        if (onCreated) onCreated(null);
    });
    
    if (onCreated) onCreated(splashWindow);
    return splashWindow;
}

function createMainWindow({ BrowserWindow, path, shell, contextMenu, store, config, isDev, splashWindow, isQuitting, onCreated }) {
    const windowBounds = store ? store.get('windowBounds') : null;
    
    const mainWindow = new BrowserWindow({
        width: windowBounds?.width || config.window.width,
        height: windowBounds?.height || config.window.height,
        x: windowBounds?.x,
        y: windowBounds?.y,
        minWidth: config.window.minWidth,
        minHeight: config.window.minHeight,
        show: false,
        icon: path.join(__dirname, '..', 'assets/icons/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'preload.js'),
            webSecurity: !isDev,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            navigateOnDragDrop: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    });
    
    mainWindow.loadFile(path.join(__dirname, '..', 'src/index.html'));
    
    contextMenu({
        window: mainWindow,
        showInspectElement: isDev,
        showSearchWithGoogle: false,
        showCopyImage: true,
        prepend: () => []
    });
    
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });
    
    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
    
    if (isDev) {
        mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
            event.preventDefault();
            callback(true);
        });
    }
    
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            setTimeout(() => {
                if (splashWindow && !splashWindow.isDestroyed()) {
                    splashWindow.close();
                }
                mainWindow.show();
                
                const token = store ? store.get('token') : null;
                if (token) {
                    mainWindow.webContents.send('auto-login-success');
                }
            }, 1500);
        } else {
            mainWindow.show();
        }
    });
    
    mainWindow.on('close', (event) => {
        if (!isQuitting() && process.platform === 'darwin') {
            event.preventDefault();
            mainWindow.hide();
            return;
        }
        
        if (!mainWindow.isDestroyed() && store && store.set) {
            const bounds = mainWindow.getBounds();
            store.set('windowBounds', bounds);
        }
    });
    
    mainWindow.on('closed', () => {
        if (onCreated) onCreated(null);
    });
    
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    
    if (onCreated) onCreated(mainWindow);
    return mainWindow;
}

module.exports = { createSplashWindow, createMainWindow };
