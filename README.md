# LearnPress Offline App

Application desktop sécurisée pour l'apprentissage hors ligne avec LearnPress WordPress.

## 🚀 Fonctionnalités

- ✅ **Authentification sécurisée** avec votre site WordPress LearnPress
- 📥 **Téléchargement de cours** pour consultation hors ligne
- 🔐 **Chiffrement AES-256** de toutes les données sensibles
- 📊 **Suivi de progression** avec synchronisation automatique
- 🎥 **Lecteur vidéo intégré** avec reprise de lecture
- 📝 **Support des quiz** et devoirs
- 🔄 **Synchronisation bidirectionnelle** avec le serveur
- 🌐 **Mode hors ligne complet**
- 📱 **Interface responsive** et moderne
- 🎨 **Support du mode sombre**

## 📋 Prérequis

- Node.js v16 ou supérieur
- npm ou yarn
- Site WordPress avec LearnPress installé
- Plugin API LearnPress (côté WordPress)

## 🛠️ Installation

```bash
# Cloner le repository
git clone https://github.com/votre-repo/learnpress-offline-app.git
cd learnpress-offline-app

# Installer les dépendances
npm install

# Lancer l'application en développement
npm start
```

## 🏗️ Build

```bash
# Build pour Windows
npm run build-win

# Build pour macOS
npm run build-mac

# Build pour Linux
npm run build-linux

# Build pour toutes les plateformes
npm run build-all
```

## 📁 Structure du Projet

```
learnpress-offline-app/
├── main.js                 # Process principal Electron
├── preload.js              # Bridge sécurisé
├── src/
│   ├── index.html          # Interface principale
│   ├── splash.html         # Écran de démarrage
│   ├── css/
│   │   └── app.css         # Styles globaux
│   └── js/
│       ├── app.js          # Logique principale
│       ├── auth.js         # Authentification
│       ├── courses.js      # Gestion des cours
│       ├── player.js       # Lecteur de contenu
│       ├── sync.js         # Synchronisation
│       └── utils.js        # Utilitaires
├── lib/
│   ├── api-client.js       # Client API LearnPress
│   ├── database.js         # Base SQLite chiffrée
│   ├── encryption.js       # Module de chiffrement
│   └── ipc-handlers.js     # Gestionnaires IPC
├── database/
│   └── schema.sql          # Structure de la DB
└── build/
    └── entitlements.mac.plist  # Permissions macOS
```

## 🔧 Configuration WordPress

### Plugin API requis

L'application nécessite un plugin API côté WordPress. Voici les endpoints requis :

```php
// Authentification
POST /wp-json/col-lp/v1/auth/login
POST /wp-json/col-lp/v1/auth/refresh
GET  /wp-json/col-lp/v1/auth/verify

// Cours
GET  /wp-json/col-lp/v1/courses
GET  /wp-json/col-lp/v1/courses/{id}
POST /wp-json/col-lp/v1/courses/{id}/package

// Progression
POST /wp-json/col-lp/v1/progress/sync
```

## 🔐 Sécurité

### Chiffrement des données

- **Base de données** : SQLite avec chiffrement AES-256
- **Fichiers médias** : Chiffrés individuellement
- **Tokens** : Stockés de manière sécurisée via electron-store
- **Communications** : HTTPS uniquement

### Bonnes pratiques

1. Ne jamais stocker de mots de passe en clair
2. Utiliser des tokens JWT avec expiration
3. Chiffrer tous les contenus téléchargés
4. Implémenter une politique d'expiration des cours

## 🎯 Utilisation

### Première connexion

1. Lancer l'application
2. Entrer l'URL de votre site WordPress
3. Se connecter avec vos identifiants LearnPress
4. L'application synchronise automatiquement vos cours

### Télécharger un cours

1. Cliquer sur "Télécharger un cours"
2. Sélectionner le cours souhaité
3. Choisir les options (vidéos, documents)
4. Le cours est téléchargé et chiffré localement

### Mode hors ligne

- Les cours téléchargés sont accessibles sans connexion
- La progression est sauvegardée localement
- Synchronisation automatique au retour en ligne

## 🐛 Dépannage

### Problèmes courants

**Erreur de connexion**
- Vérifier l'URL du site WordPress
- Vérifier que le plugin API est installé
- Vérifier les identifiants

**Téléchargement échoué**
- Vérifier l'espace disque disponible
- Vérifier la connexion internet
- Réessayer le téléchargement

**Problèmes de synchronisation**
- Vérifier la connexion internet
- Se reconnecter si nécessaire
- Forcer la synchronisation manuelle

### Logs

Les logs sont stockés dans :
- Windows : `%USERPROFILE%\AppData\Roaming\learnpress-offline\logs`
- macOS : `~/Library/Logs/learnpress-offline`
- Linux : `~/.config/learnpress-offline/logs`

## 📝 Développement

### Variables d'environnement

```bash
NODE_ENV=development    # Mode développement
DEBUG_MODE=true        # Activer les logs détaillés
```

### Tests

```bash
# Lancer les tests
npm test

# Tests avec couverture
npm run test:coverage
```

### Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🤝 Support

- Documentation : [https://docs.votre-site.com](https://docs.votre-site.com)
- Issues : [GitHub Issues](https://github.com/votre-repo/issues)
- Email : support@votre-site.com

## 🙏 Remerciements

- [Electron](https://www.electronjs.org/)
- [LearnPress](https://thimpress.com/learnpress/)
- [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3)
- Tous les contributeurs

---

Développé avec ❤️ pour la communauté LearnPress
