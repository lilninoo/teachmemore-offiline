# Guide de Contribution

Merci de votre intérêt pour contribuer à LearnPress Offline ! Ce document explique comment participer au développement du projet.

## 🤝 Code de Conduite

En participant à ce projet, vous acceptez de respecter notre code de conduite :
- Être respectueux et inclusif
- Accepter les critiques constructives
- Se concentrer sur ce qui est le mieux pour la communauté
- Faire preuve d'empathie envers les autres contributeurs

## 🚀 Comment Contribuer

### 1. Signaler des Bugs

Avant de créer un rapport de bug, vérifiez que le problème n'a pas déjà été signalé dans les [issues](https://github.com/votre-repo/learnpress-offline-app/issues).

**Pour signaler un bug :**
1. Utilisez le template "Bug Report"
2. Incluez :
   - Description claire du problème
   - Étapes pour reproduire
   - Comportement attendu vs observé
   - Screenshots si applicable
   - Informations système (OS, version de l'app)
   - Logs d'erreur

### 2. Suggérer des Fonctionnalités

Les suggestions sont les bienvenues ! Créez une issue avec le label "enhancement" et incluez :
- Description détaillée de la fonctionnalité
- Cas d'usage
- Mockups ou exemples si possible

### 3. Contribuer au Code

#### Configuration de l'Environnement

```bash
# 1. Fork le repository
# 2. Clone votre fork
git clone https://github.com/votre-username/learnpress-offline-app.git
cd learnpress-offline-app

# 3. Ajouter le repo original comme upstream
git remote add upstream https://github.com/votre-repo/learnpress-offline-app.git

# 4. Installer les dépendances
npm install

# 5. Configuration initiale
npm run dev-setup
```

#### Workflow de Développement

1. **Créer une branche**
   ```bash
   git checkout -b feature/ma-fonctionnalite
   # ou
   git checkout -b fix/mon-bug-fix
   ```

2. **Développer**
   - Suivre les conventions de code
   - Ajouter des tests pour les nouvelles fonctionnalités
   - Mettre à jour la documentation si nécessaire

3. **Tester**
   ```bash
   # Lancer les tests
   npm test
   
   # Vérifier le linting
   npm run lint
   
   # Tester l'application
   npm run dev
   ```

4. **Commit**
   ```bash
   git add .
   git commit -m "type: description courte
   
   Description détaillée si nécessaire"
   ```

5. **Push et Pull Request**
   ```bash
   git push origin feature/ma-fonctionnalite
   ```
   Puis créer une Pull Request sur GitHub

## 📝 Conventions

### Commits

Suivre la convention [Conventional Commits](https://www.conventionalcommits.org/) :

- `feat:` Nouvelle fonctionnalité
- `fix:` Correction de bug
- `docs:` Documentation
- `style:` Formatage, points-virgules manquants, etc.
- `refactor:` Refactoring du code
- `test:` Ajout ou modification de tests
- `chore:` Maintenance, configuration, etc.

**Exemples :**
```
feat: ajouter support du téléchargement par lots
fix: corriger crash lors du changement de leçon
docs: mettre à jour guide d'installation
```

### Code Style

- **JavaScript** : ESLint avec configuration fournie
- **Indentation** : 4 espaces
- **Quotes** : Simple quotes pour JS
- **Point-virgules** : Toujours
- **Longueur de ligne** : Max 100 caractères
- **Nommage** :
  - Variables/fonctions : camelCase
  - Classes : PascalCase
  - Constantes : UPPER_SNAKE_CASE
  - Fichiers : kebab-case

### Tests

- Tout nouveau code doit être testé
- Maintenir la couverture au-dessus de 80%
- Tests unitaires avec Mocha/Chai
- Tests d'intégration pour les fonctionnalités critiques

**Structure des tests :**
```javascript
describe('Module', () => {
    describe('Fonction', () => {
        it('devrait faire X quand Y', () => {
            // Arrange
            // Act
            // Assert
        });
    });
});
```

### Documentation

- Commenter les fonctions complexes avec JSDoc
- Mettre à jour le README si nécessaire
- Documenter les breaking changes dans CHANGELOG

**Exemple JSDoc :**
```javascript
/**
 * Télécharge un cours depuis le serveur
 * @param {number} courseId - ID du cours
 * @param {Object} options - Options de téléchargement
 * @param {boolean} options.includeVideos - Inclure les vidéos
 * @returns {Promise<Object>} Résultat du téléchargement
 * @throws {Error} Si le cours n'existe pas
 */
async function downloadCourse(courseId, options = {}) {
    // ...
}
```

## 🔄 Process de Review

1. **Auto-review** : Vérifiez votre code avant de soumettre
2. **Tests** : Tous les tests doivent passer
3. **CI/CD** : Les checks automatiques doivent être verts
4. **Code Review** : Au moins 1 approbation requise
5. **Merge** : Squash and merge par défaut

## 🏗️ Architecture

### Structure des Dossiers

```
src/          # Code source frontend
lib/          # Modules backend
tests/        # Tests unitaires et d'intégration
assets/       # Ressources statiques
database/     # Schémas et migrations
```

### Flux de Données

```
Renderer Process → IPC → Main Process → API/Database
                    ↑                        ↓
                    ←────── Response ────────
```

### Sécurité

- Toujours valider les entrées utilisateur
- Utiliser les APIs exposées via preload
- Chiffrer toutes les données sensibles
- Ne jamais stocker de mots de passe en clair

## 📦 Release Process

1. Créer une branche `release/vX.Y.Z`
2. Mettre à jour :
   - Version dans package.json
   - CHANGELOG.md
   - README.md si nécessaire
3. Créer une PR vers `main`
4. Après merge, créer un tag
5. La CI créera automatiquement la release

## 🆘 Besoin d'Aide ?

- 💬 [Discussions GitHub](https://github.com/votre-repo/learnpress-offline-app/discussions)
- 📧 Email : dev@votre-site.com
- 🐛 [Issues](https://github.com/votre-repo/learnpress-offline-app/issues)

## 🙏 Remerciements

Merci à tous les contributeurs qui rendent ce projet possible !

---

**Note :** Ce guide est en constante évolution. N'hésitez pas à suggérer des améliorations !
