# Plugin COL LMS Offline API

Plugin WordPress pour l'API REST de l'application LearnPress Offline avec support Paid Memberships Pro.

## 📋 Prérequis

- WordPress 5.8 ou supérieur
- PHP 7.4 ou supérieur
- LearnPress 4.0 ou supérieur
- Paid Memberships Pro 2.5 ou supérieur (optionnel mais recommandé)

## 🚀 Installation

### 1. Installation des plugins requis

1. **LearnPress** (obligatoire)
   - Aller dans WordPress Admin > Extensions > Ajouter
   - Rechercher "LearnPress"
   - Installer et activer

2. **Paid Memberships Pro** (recommandé)
   - Aller dans WordPress Admin > Extensions > Ajouter
   - Rechercher "Paid Memberships Pro"
   - Installer et activer

### 2. Installation du plugin COL LMS Offline API

1. Télécharger le dossier `wordpress-plugin`
2. Le renommer en `col-lms-offline-api`
3. Le placer dans `/wp-content/plugins/`
4. Activer le plugin depuis WordPress Admin

### 3. Configuration de Paid Memberships Pro

#### Créer les niveaux d'abonnement
1. Aller dans **Memberships > Membership Levels**
2. Créer vos niveaux (ex: Gratuit, Premium, Gold)
3. Configurer les prix et durées

#### Restreindre l'accès aux cours
1. Installer l'addon **PMPro Courses** (gratuit)
2. Dans chaque cours LearnPress, aller dans l'onglet "Require Membership"
3. Sélectionner les niveaux d'abonnement qui peuvent accéder au cours

#### Configuration des catégories (optionnel)
Pour restreindre par catégorie de cours :
1. Créer des catégories de cours dans LearnPress
2. Dans PMPro, aller dans **Memberships > Advanced Settings**
3. Configurer les restrictions par catégorie

### 4. Configuration du plugin API

Le plugin crée automatiquement les tables nécessaires lors de l'activation.

#### Tester l'API
Utilisez un outil comme Postman pour tester :

```bash
# Connexion
POST https://votre-site.com/wp-json/col-lms/v1/auth/login
Content-Type: application/json

{
    "username": "votre-username",
    "password": "votre-password",
    "device_id": "test-device-123"
}
```

## 🔒 Sécurité

### Configuration HTTPS (obligatoire)
L'API doit être accessible uniquement via HTTPS. Configurez un certificat SSL sur votre serveur.

### Headers de sécurité
Ajoutez dans votre `.htaccess` :
```apache
# CORS pour l'app desktop
Header set Access-Control-Allow-Origin "app://."
Header set Access-Control-Allow-Methods "GET, POST, OPTIONS"
Header set Access-Control-Allow-Headers "Authorization, Content-Type"

# Sécurité
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "DENY"
```

### Limite de taux
Pour éviter les abus, installez un plugin comme "Limit Login Attempts Reloaded".

## 🎯 Configuration des cours

### Structure recommandée
1. **Cours gratuits** : Accessibles sans abonnement
2. **Cours Premium** : Nécessitent un abonnement actif
3. **Cours exclusifs** : Réservés à certains niveaux

### Métadonnées importantes
Pour chaque cours, renseignez :
- **Durée** : Important pour l'estimation de téléchargement
- **Niveau** : Débutant, Intermédiaire, Avancé
- **Version** : Pour gérer les mises à jour

### Médias
- **Vidéos** : Hébergez sur votre serveur ou utilisez Vimeo/YouTube
- **Documents** : PDF, DOCX, etc. attachés aux leçons
- **Images** : Optimisez pour le web (max 1920px de large)

## 🔄 Webhooks et automatisation

### Notification de mise à jour de cours
Créez un hook pour notifier les utilisateurs :

```php
// Dans functions.php de votre thème
add_action('save_post_lp_course', function($post_id) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    
    // Incrémenter la version du cours
    $version = get_post_meta($post_id, '_lp_course_version', true);
    update_post_meta($post_id, '_lp_course_version', intval($version) + 1);
    
    // Notifier les utilisateurs (implémenter selon vos besoins)
    do_action('col_lms_course_updated', $post_id);
});
```

### Expiration automatique des tokens
Le plugin nettoie automatiquement les tokens expirés toutes les heures.

## 📊 Monitoring

### Logs
Les erreurs d'API sont loggées dans :
- `/wp-content/debug.log` (si WP_DEBUG_LOG est activé)

### Statistiques d'utilisation
Pour suivre l'utilisation :
```sql
-- Nombre d'utilisateurs actifs
SELECT COUNT(DISTINCT user_id) FROM wp_col_lms_tokens 
WHERE expires_at > NOW();

-- Téléchargements par cours
SELECT course_id, COUNT(*) as downloads 
FROM wp_col_lms_packages 
GROUP BY course_id;
```

## 🚨 Dépannage

### "No membership" error
- Vérifier que l'utilisateur a un abonnement actif dans PMPro
- Vérifier les restrictions du cours

### Token invalide
- Les tokens expirent après 1 heure
- Utiliser le refresh token pour obtenir un nouveau token

### Téléchargement lent
- Optimiser la taille des médias
- Utiliser un CDN pour les fichiers volumineux
- Activer la compression côté serveur

## 📱 Support

Pour toute question :
- Documentation : [https://docs.votre-site.com](https://docs.votre-site.com)
- Support : support@votre-site.com

## 📄 Changelog

### Version 1.0.0
- Version initiale
- Support LearnPress + Paid Memberships Pro
- API REST complète
- Système de tokens JWT
- Création de packages de cours
