const { app, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const log = require('electron-log');

async function getOrCreateEncryptionKey() {
    const keyFile = path.join(app.getPath('userData'), '.key');
    const useSafeStorage = safeStorage.isEncryptionAvailable();

    try {
        const exists = await fs.access(keyFile).then(() => true).catch(() => false);
        if (exists) {
            const raw = await fs.readFile(keyFile);

            if (useSafeStorage) {
                try {
                    const key = safeStorage.decryptString(raw);
                    if (key && key.length === 64) return key;
                } catch (decryptErr) {
                    log.warn('safeStorage decrypt failed, trying plaintext fallback:', decryptErr.message);
                    const plainKey = raw.toString('utf8').trim();
                    if (plainKey && plainKey.length === 64) {
                        log.info('Migrating plaintext key to safeStorage');
                        const encrypted = safeStorage.encryptString(plainKey);
                        await fs.writeFile(keyFile, encrypted, { mode: 0o600 });
                        return plainKey;
                    }
                }
            } else {
                const key = raw.toString('utf8').trim();
                if (key && key.length === 64) return key;
            }
        }
    } catch (error) {
        log.error('Erreur lors de la lecture de la clé:', error);
    }

    const key = crypto.randomBytes(32).toString('hex');

    try {
        const userDataPath = app.getPath('userData');
        await fs.mkdir(userDataPath, { recursive: true }).catch(() => {});

        if (useSafeStorage) {
            const encrypted = safeStorage.encryptString(key);
            await fs.writeFile(keyFile, encrypted, { mode: 0o600 });
            log.info('Nouvelle clé de chiffrement créée (safeStorage)');
        } else {
            await fs.writeFile(keyFile, key, { mode: 0o600 });
            log.warn('safeStorage indisponible, clé stockée en texte brut');
        }
    } catch (error) {
        log.error('Erreur lors de la sauvegarde de la clé:', error);
    }

    return key;
}

module.exports = { getOrCreateEncryptionKey };
