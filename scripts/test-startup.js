// test-startup.js - Test de démarrage sans electron
const path = require('path');
const fs = require('fs');

console.log('Test de démarrage...\n');

// Vérifier les dépendances critiques
const deps = ['electron', 'electron-store', 'better-sqlite3', 'axios'];
deps.forEach(dep => {
    try {
        require.resolve(dep);
        console.log(`✓ ${dep} installé`);
    } catch (e) {
        console.log(`✗ ${dep} manquant - Exécutez: npm install`);
    }
});

// Vérifier les fichiers importants
const files = ['main.js', 'preload.js', 'src/index.html'];
files.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✓ ${file} existe`);
    } else {
        console.log(`✗ ${file} manquant`);
    }
});

console.log('\nSi tout est OK, lancez: npm start');