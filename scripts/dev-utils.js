#!/usr/bin/env node
// dev-utils.js - Scripts utilitaires pour le développement

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Couleurs pour la console
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m'
};

// Commande principale
const command = process.argv[2];

switch (command) {
    case 'generate-key':
        generateEncryptionKey();
        break;
    case 'clean':
        cleanProject();
        break;
    case 'reset-db':
        resetDatabase();
        break;
    case 'check-deps':
        checkDependencies();
        break;
    case 'create-icons':
        createIcons();
        break;
    case 'dev-setup':
        setupDevelopment();
        break;
    case 'test-api':
        testAPI();
        break;
    default:
        showHelp();
}

// Générer une clé de chiffrement
function generateEncryptionKey() {
    console.log(`${colors.blue}Génération d'une nouvelle clé de chiffrement...${colors.reset}`);
    
    const key = crypto.randomBytes(32).toString('hex');
    const envPath = path.join(process.cwd(), '.env');
    
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/ENCRYPTION_KEY=.*/, `ENCRYPTION_KEY=${key}`);
    } else {
        envContent = `# Configuration de l'application
NODE_ENV=development
ENCRYPTION_KEY=${key}
DEBUG_MODE=false
`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log(`${colors.green}✓ Clé générée et sauvegardée dans .env${colors.reset}`);
    console.log(`${colors.yellow}⚠️  N'oubliez pas de sauvegarder cette clé de manière sécurisée!${colors.reset}`);
}

// Nettoyer le projet
function cleanProject() {
    console.log(`${colors.blue}Nettoyage du projet...${colors.reset}`);
    
    const dirsToClean = [
        'dist',
        'out',
        'node_modules/.cache',
        'coverage',
        '.nyc_output',
        'tmp',
        'temp'
    ];
    
    const filesToClean = [
        'npm-debug.log',
        'yarn-error.log',
        '.DS_Store'
    ];
    
    // Nettoyer les dossiers
    dirsToClean.forEach(dir => {
        const fullPath = path.join(process.cwd(), dir);
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`${colors.green}✓ Supprimé: ${dir}${colors.reset}`);
        }
    });
    
    // Nettoyer les fichiers
    filesToClean.forEach(file => {
        const fullPath = path.join(process.cwd(), file);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`${colors.green}✓ Supprimé: ${file}${colors.reset}`);
        }
    });
    
    // Nettoyer les fichiers .DS_Store récursivement
    try {
        execSync('find . -name ".DS_Store" -type f -delete', { stdio: 'pipe' });
        console.log(`${colors.green}✓ Tous les fichiers .DS_Store supprimés${colors.reset}`);
    } catch (e) {
        // Ignorer l'erreur sur Windows
    }
    
    console.log(`${colors.green}✓ Nettoyage terminé!${colors.reset}`);
}

// Réinitialiser la base de données
function resetDatabase() {
    console.log(`${colors.blue}Réinitialisation de la base de données...${colors.reset}`);
    
    const dbPath = path.join(process.cwd(), 'database', 'courses.db');
    
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log(`${colors.green}✓ Base de données supprimée${colors.reset}`);
    }
    
    // Créer le dossier si nécessaire
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    console.log(`${colors.yellow}ℹ️  La base de données sera recréée au prochain démarrage${colors.reset}`);
}

// Vérifier les dépendances
function checkDependencies() {
    console.log(`${colors.blue}Vérification des dépendances...${colors.reset}`);
    
    try {
        // Vérifier les vulnérabilités
        console.log(`${colors.yellow}Recherche de vulnérabilités...${colors.reset}`);
        const auditResult = execSync('npm audit --json', { encoding: 'utf8' });
        const audit = JSON.parse(auditResult);
        
        if (audit.metadata.vulnerabilities.total > 0) {
            console.log(`${colors.red}⚠️  ${audit.metadata.vulnerabilities.total} vulnérabilités trouvées:${colors.reset}`);
            console.log(`  - Critiques: ${audit.metadata.vulnerabilities.critical}`);
            console.log(`  - Hautes: ${audit.metadata.vulnerabilities.high}`);
            console.log(`  - Moyennes: ${audit.metadata.vulnerabilities.moderate}`);
            console.log(`  - Faibles: ${audit.metadata.vulnerabilities.low}`);
            console.log(`\n${colors.yellow}Exécutez 'npm audit fix' pour corriger${colors.reset}`);
        } else {
            console.log(`${colors.green}✓ Aucune vulnérabilité trouvée${colors.reset}`);
        }
        
        // Vérifier les mises à jour
        console.log(`\n${colors.yellow}Vérification des mises à jour...${colors.reset}`);
        try {
            execSync('npx npm-check-updates', { stdio: 'inherit' });
        } catch (e) {
            console.log(`${colors.yellow}Installez npm-check-updates: npm i -g npm-check-updates${colors.reset}`);
        }
        
    } catch (error) {
        console.error(`${colors.red}Erreur lors de la vérification${colors.reset}`);
    }
}

// Créer les icônes de l'application
function createIcons() {
    console.log(`${colors.blue}Création des icônes...${colors.reset}`);
    
    const iconPath = path.join(process.cwd(), 'assets', 'icons');
    
    // Vérifier que le fichier source existe
    const sourcePath = path.join(iconPath, 'icon.png');
    if (!fs.existsSync(sourcePath)) {
        console.error(`${colors.red}✗ Fichier source icon.png non trouvé dans assets/icons/${colors.reset}`);
        console.log(`${colors.yellow}Créez un fichier PNG de 1024x1024 pixels${colors.reset}`);
        return;
    }
    
    try {
        // Utiliser electron-icon-builder si installé
        execSync('npx electron-icon-builder --input=assets/icons/icon.png --output=build', {
            stdio: 'inherit'
        });
        console.log(`${colors.green}✓ Icônes créées avec succès${colors.reset}`);
    } catch (error) {
        console.log(`${colors.yellow}Installez electron-icon-builder: npm i -D electron-icon-builder${colors.reset}`);
        console.log(`${colors.yellow}Ou créez manuellement:${colors.reset}`);
        console.log('  - icon.ico (Windows): 256x256');
        console.log('  - icon.icns (macOS): 1024x1024');
        console.log('  - icon.png (Linux): 512x512');
    }
}

// Configuration initiale pour le développement
function setupDevelopment() {
    console.log(`${colors.bright}${colors.blue}Configuration de l'environnement de développement${colors.reset}`);
    
    const steps = [
        {
            name: 'Installation des dépendances',
            check: () => fs.existsSync('node_modules'),
            action: () => execSync('npm install', { stdio: 'inherit' })
        },
        {
            name: 'Génération de la clé de chiffrement',
            check: () => fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').includes('ENCRYPTION_KEY'),
            action: () => generateEncryptionKey()
        },
        {
            name: 'Création des dossiers',
            check: () => fs.existsSync('database') && fs.existsSync('courses') && fs.existsSync('media'),
            action: () => {
                ['database', 'courses', 'media', 'logs', 'temp'].forEach(dir => {
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                });
            }
        },
        {
            name: 'Copie du fichier d\'exemple',
            check: () => fs.existsSync('.env'),
            action: () => {
                if (fs.existsSync('.env.example')) {
                    fs.copyFileSync('.env.example', '.env');
                }
            }
        }
    ];
    
    steps.forEach(step => {
        process.stdout.write(`${step.name}... `);
        if (step.check()) {
            console.log(`${colors.green}✓${colors.reset}`);
        } else {
            step.action();
            console.log(`${colors.green}✓${colors.reset}`);
        }
    });
    
    console.log(`\n${colors.green}${colors.bright}✓ Configuration terminée!${colors.reset}`);
    console.log(`${colors.blue}Démarrez l'application avec: npm start${colors.reset}`);
}

// Tester l'API WordPress
async function testAPI() {
    console.log(`${colors.blue}Test de l'API WordPress...${colors.reset}`);
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));
    
    try {
        const apiUrl = await question('URL du site WordPress: ');
        const username = await question('Nom d\'utilisateur: ');
        const password = await question('Mot de passe: ');
        
        console.log(`\n${colors.yellow}Test de connexion...${colors.reset}`);
        
        // Simuler un appel API
        const axios = require('axios');
        const response = await axios.post(`${apiUrl}/wp-json/col-lp/v1/auth/login`, {
            username,
            password,
            device_id: 'test-device'
        });
        
        if (response.data.token) {
            console.log(`${colors.green}✓ Connexion réussie!${colors.reset}`);
            console.log(`Token: ${response.data.token.substring(0, 20)}...`);
            
            // Tester la récupération des cours
            console.log(`\n${colors.yellow}Récupération des cours...${colors.reset}`);
            const coursesResponse = await axios.get(`${apiUrl}/wp-json/col-lp/v1/courses`, {
                headers: {
                    'Authorization': `Bearer ${response.data.token}`
                }
            });
            
            console.log(`${colors.green}✓ ${coursesResponse.data.courses.length} cours trouvés${colors.reset}`);
        }
        
    } catch (error) {
        console.error(`${colors.red}✗ Erreur: ${error.message}${colors.reset}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Message: ${error.response.data.message || 'Erreur inconnue'}`);
        }
    } finally {
        rl.close();
    }
}

// Afficher l'aide
function showHelp() {
    console.log(`
${colors.bright}LearnPress Offline - Scripts de développement${colors.reset}

${colors.yellow}Usage:${colors.reset}
  npm run dev-utils <commande>

${colors.yellow}Commandes disponibles:${colors.reset}
  ${colors.green}generate-key${colors.reset}   Générer une nouvelle clé de chiffrement
  ${colors.green}clean${colors.reset}          Nettoyer les fichiers temporaires et builds
  ${colors.green}reset-db${colors.reset}       Réinitialiser la base de données
  ${colors.green}check-deps${colors.reset}     Vérifier les dépendances et vulnérabilités
  ${colors.green}create-icons${colors.reset}   Créer les icônes pour toutes les plateformes
  ${colors.green}dev-setup${colors.reset}      Configuration initiale pour le développement
  ${colors.green}test-api${colors.reset}       Tester la connexion à l'API WordPress

${colors.yellow}Exemples:${colors.reset}
  npm run dev-utils generate-key
  npm run dev-utils dev-setup
`);
}
