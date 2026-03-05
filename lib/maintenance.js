const fs = require('fs').promises;
const path = require('path');

let maintenanceInterval = null;

function startMaintenance({ app, getDatabase, getMainWindow, log, config }) {
    performMaintenance({ app, getDatabase, getMainWindow, log });
    
    maintenanceInterval = setInterval(async () => {
        await performMaintenance({ app, getDatabase, getMainWindow, log });
    }, config.storage.cleanupInterval);
}

function stopMaintenance() {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = null;
    }
}

async function performMaintenance({ app, getDatabase, getMainWindow, log }) {
    try {
        log.info('Début de la maintenance périodique');
        
        const database = getDatabase();
        if (database && database.isInitialized) {
            await database.cleanupExpiredData();
            
            const stats = database.getStats();
            log.info('Stats DB:', stats);
        }
        
        cleanOldLogs({ app, log });
        
        const diskSpace = await checkDiskSpace({ app });
        if (diskSpace.free < 1024 * 1024 * 1024) {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('low-disk-space', {
                    free: diskSpace.free,
                    used: diskSpace.used
                });
            }
        }
        
        log.info('Maintenance périodique terminée');
    } catch (error) {
        log.error('Erreur lors de la maintenance:', error);
    }
}

async function checkDiskSpace({ app }) {
    try {
        const checkDiskSpace = require('check-disk-space').default;
        const userDataPath = app.getPath('userData');
        const diskSpace = await checkDiskSpace(userDataPath);
        
        return {
            free: diskSpace.free,
            total: diskSpace.size,
            used: diskSpace.size - diskSpace.free
        };
    } catch (error) {
        return {
            free: 10 * 1024 * 1024 * 1024,
            total: 100 * 1024 * 1024 * 1024,
            used: 90 * 1024 * 1024 * 1024
        };
    }
}

async function cleanOldLogs({ app, log }) {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    const exists = await fs.access(logsDir).then(() => true).catch(() => false);
    if (!exists) return;

    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
        const files = await fs.readdir(logsDir);
        for (const file of files) {
            const filePath = path.join(logsDir, file);
            try {
                const stats = await fs.stat(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    log.info('Ancien log supprimé:', file);
                }
            } catch (err) {
                log.warn('Erreur lors de la vérification du fichier:', err);
            }
        }
    } catch (error) {
        log.warn('Erreur lors du nettoyage des logs:', error);
    }
}

module.exports = {
    startMaintenance,
    stopMaintenance,
    performMaintenance,
    checkDiskSpace,
    cleanOldLogs
};
