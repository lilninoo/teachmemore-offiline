// scripts/clean.js
// Script unique pour nettoyer les fichiers locaux et les données d'authentification LearnPress Offline

const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

// Déterminer le chemin userData
const userDataPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'learnpress-offline')
  : path.join(os.homedir(), '.config', 'learnpress-offline');

// Initialiser le store Electron
const store = new Store();

console.log('\n--- Nettoyage LearnPress Offline ---\n');
console.log('Chemin userData :', userDataPath);

// 1. Nettoyage des fichiers locaux spécifiques
const filesToClean = [
  'config.json',
  '.key',
  'database/courses.db'
];

console.log('\n→ Nettoyage des fichiers :');

filesToClean.forEach(file => {
  const filePath = path.join(userDataPath, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`✓ Supprimé : ${file}`);
    } catch (error) {
      console.error(`✗ Erreur lors de la suppression de ${file} :`, error.message);
    }
  } else {
    console.log(`- Fichier introuvable : ${file}`);
  }
});

// 2. Nettoyage des données d'authentification
console.log('\n→ Nettoyage des données d\'authentification :');

console.log('- URL API :', store.get('apiUrl') || 'Aucune');
console.log('- Username :', store.get('username') || 'Aucun');
console.log('- Token présent :', !!store.get('token'));
console.log('- Refresh token présent :', !!store.get('refreshToken'));

const keysToDelete = [
  'token',
  'refreshToken',
  'userId',
  'lastSync',
  'membershipRestrictions'
];

keysToDelete.forEach(key => {
  if (store.has(key)) {
    store.delete(key);
    console.log(`✓ Supprimé : ${key}`);
  }
});

// 3. Nettoyage complet (--full)
if (process.argv.includes('--full')) {
  console.log('\n⚠ Nettoyage complet activé');

  // Supprimer toutes les données du store
  store.clear();
  console.log('✓ Toutes les données du store ont été supprimées');

  // Supprimer tout le dossier userData
  try {
    fs.rmSync(userDataPath, { recursive: true, force: true });
    console.log('✓ Dossier userData complètement supprimé');
  } catch (error) {
    console.error('✗ Erreur lors de la suppression du dossier userData :', error.message);
  }
} else {
  console.log('\nℹ Pour un nettoyage complet, utilisez : node scripts/clean.js --full');
}

console.log('\n✅ Nettoyage terminé ! Vous pouvez relancer l\'application.\n');
