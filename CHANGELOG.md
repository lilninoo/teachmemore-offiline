# Changelog

Tous les changements notables de ce projet seront documentés dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

### À venir
- Support des annotations et notes dans les leçons
- Export PDF des certificats
- Mode présentation pour les formateurs
- Statistiques détaillées de progression
- Support multi-langues

## [1.0.0] - 2024-01-15

### Ajouté
- 🎉 Version initiale de LearnPress Offline
- ✅ Authentification sécurisée avec sites WordPress LearnPress
- 📥 Téléchargement de cours pour consultation hors ligne
- 🔐 Chiffrement AES-256 de toutes les données
- 📊 Suivi de progression local avec synchronisation
- 🎥 Lecteur vidéo intégré avec reprise de lecture
- 📝 Support complet des quiz
- 🔄 Synchronisation bidirectionnelle automatique
- 🌐 Mode hors ligne complet
- 🎨 Interface moderne avec support du mode sombre
- 📱 Design responsive
- 💾 Gestion intelligente du stockage
- 🔍 Recherche dans les cours téléchargés
- ⚡ Mise à jour automatique de l'application

### Sécurité
- Chiffrement de la base de données SQLite
- Chiffrement individuel des fichiers média
- Tokens JWT avec expiration
- Stockage sécurisé des credentials
- Protection contre les injections SQL
- Validation stricte des entrées utilisateur

### Technique
- Electron 27.0.0
- Node.js 16+
- SQLite avec better-sqlite3
- Architecture modulaire
- Tests unitaires et d'intégration
- CI/CD avec GitHub Actions

## [0.9.0-beta] - 2023-12-01

### Ajouté
- Version bêta pour tests internes
- Fonctionnalités de base de téléchargement
- Interface utilisateur initiale
- Authentification simple

### Corrigé
- Problèmes de performance sur Windows
- Erreurs de synchronisation intermittentes
- Fuites mémoire dans le lecteur vidéo

### Modifié
- Refactoring complet de l'architecture
- Migration vers TypeScript (annulée)
- Amélioration de la gestion des erreurs

## [0.5.0-alpha] - 2023-10-15

### Ajouté
- Première version alpha
- Proof of concept fonctionnel
- Tests avec un nombre limité d'utilisateurs

### Connu
- Performance non optimisée
- Interface utilisateur basique
- Bugs de synchronisation
- Pas de chiffrement

---

## Types de changements

- **Ajouté** pour les nouvelles fonctionnalités.
- **Modifié** pour les changements aux fonctionnalités existantes.
- **Obsolète** pour les fonctionnalités qui seront bientôt supprimées.
- **Supprimé** pour les fonctionnalités supprimées.
- **Corrigé** pour les corrections de bugs.
- **Sécurité** en cas de vulnérabilités.

## Liens

- [Comparer les versions](https://github.com/votre-repo/learnpress-offline-app/compare)
- [Historique des releases](https://github.com/votre-repo/learnpress-offline-app/releases)
- [Documentation technique](https://docs.votre-site.com)
- [Guide de contribution](CONTRIBUTING.md)
