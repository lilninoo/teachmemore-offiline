// Système de migration
function migrate(db, transaction) {
    try {
        // Vérifier la version de la DB
        let currentVersion = 0;
        try {
            const result = db.prepare("SELECT value FROM user_settings WHERE key = 'db_version'").get();
            currentVersion = result ? parseInt(result.value) : 0;
        } catch (error) {
            // Table user_settings n'existe pas encore
            currentVersion = 0;
        }
        
        const targetVersion = 2; // Version cible
        
        if (currentVersion < targetVersion) {
            console.log(`Migration de la DB v${currentVersion} vers v${targetVersion}`);
            
            // Utiliser correctement la transaction
            const runMigration = transaction(() => {
                // Migrations par version
                if (currentVersion < 1) {
                    migrateToV1(db);
                }
                if (currentVersion < 2) {
                    migrateToV2(db);
                }
                
                // Mettre à jour la version
                db.prepare(`
                    INSERT OR REPLACE INTO user_settings (key, value, type) 
                    VALUES ('db_version', ?, 'number')
                `).run(targetVersion.toString());
            });
            
            // Exécuter la transaction
            runMigration();
            
            console.log('Migration terminée');
        }
    } catch (error) {
        console.error('Erreur lors de la migration:', error);
    }
}

// Migration vers v1
function migrateToV1(db) {
    // Ajouter des colonnes manquantes si nécessaire
    const alterations = [
        "ALTER TABLE courses ADD COLUMN file_size INTEGER DEFAULT 0",
        "ALTER TABLE courses ADD COLUMN rating REAL DEFAULT 0",
        "ALTER TABLE courses ADD COLUMN completion_percentage REAL DEFAULT 0",
        "ALTER TABLE lessons ADD COLUMN difficulty TEXT DEFAULT 'normal'",
        "ALTER TABLE lessons ADD COLUMN estimated_time INTEGER DEFAULT 0"
    ];
    
    alterations.forEach(sql => {
        try {
            db.exec(sql);
        } catch (error) {
            // Ignorer si la colonne existe déjà
            if (!error.message.includes('duplicate column name')) {
                console.warn('Erreur SQL ignorée:', error.message);
            }
        }
    });
}

// Migration vers v2
function migrateToV2(db) {
    const alterations = [
        "ALTER TABLE media ADD COLUMN thumbnail_path TEXT",
        "ALTER TABLE media ADD COLUMN download_priority INTEGER DEFAULT 5",
        "ALTER TABLE quizzes ADD COLUMN best_score REAL DEFAULT 0",
        "ALTER TABLE quizzes ADD COLUMN time_spent INTEGER DEFAULT 0"
    ];
    
    alterations.forEach(sql => {
        try {
            db.exec(sql);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                console.warn('Erreur SQL ignorée:', error.message);
            }
        }
    });
}

module.exports = { migrate };
