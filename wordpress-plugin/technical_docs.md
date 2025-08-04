# Documentation Technique - COL LMS Offline API

## Vue d'ensemble

COL LMS Offline API est un plugin WordPress qui fournit une API REST complète pour permettre l'apprentissage hors ligne avec LearnPress. Il permet aux applications desktop de télécharger des cours, synchroniser la progression et gérer les données utilisateur de manière sécurisée.

## Architecture

### Structure du Plugin

```
col-lms-offline-api/
├── learnpress-offline-api.php       # Fichier principal du plugin
├── uninstall.php                    # Script de désinstallation
├── config-example.php               # Configuration exemple
├── includes/                        # Classes principales
│   ├── class-api.php               # Classe de base API
│   ├── class-auth.php              # Authentification
│   ├── class-courses.php           # Gestion des cours
│   ├── class-sync.php              # Synchronisation
│   ├── class-packages.php          # Packages de téléchargement
│   ├── class-jwt.php               # Gestion JWT
│   ├── class-logger.php            # Système de logs
│   ├── class-migration.php         # Migrations DB
│   └── class-admin.php             # Interface admin
├── admin/                          # Interface d'administration
│   ├── css/admin.css              # Styles admin
│   └── js/admin.js                # Scripts admin
├── languages/                      # Traductions
│   └── col-lms-offline-api.pot    # Template de traduction
└── wordpress-plugin/               # Documentation WordPress
    └── README.md                   # Guide d'installation
```

### Classes Principales

#### COL_LMS_API_Base
Classe abstraite de base pour tous les endpoints API. Fournit :
- Authentification JWT
- Vérification des permissions
- Gestion des erreurs
- Rate limiting
- Logging

#### COL_LMS_Auth
Gestion de l'authentification :
- Login/logout
- Génération et validation des tokens JWT
- Gestion des refresh tokens
- Support multi-appareils
- Intégration Paid Memberships Pro

#### COL_LMS_Courses
Gestion des cours :
- Liste et détails des cours
- Vérification d'accès
- Curriculum et contenu
- Médias et attachments
- Création de packages

#### COL_LMS_Sync
Synchronisation des données :
- Progression des leçons
- Résultats des quiz
- Notes utilisateur
- Gestion des conflits
- Synchronisation bidirectionnelle

#### COL_LMS_Packages
Création et gestion des packages :
- Téléchargement de cours complets
- Compression et chiffrement
- Gestion des médias
- Téléchargements sécurisés

## Base de Données

### Tables Créées

#### `wp_col_lms_tokens`
Stockage des tokens d'authentification :

```sql
CREATE TABLE wp_col_lms_tokens (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    user_id bigint(20) NOT NULL,
    device_id varchar(255) NOT NULL,
    device_name varchar(255),
    device_type varchar(50) DEFAULT 'desktop',
    token_hash varchar(255) NOT NULL,
    refresh_token_hash varchar(255) NOT NULL,
    expires_at datetime NOT NULL,
    last_used datetime,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY user_device (user_id, device_id),
    KEY token_hash (token_hash),
    KEY expires_at (expires_at)
);
```

#### `wp_col_lms_packages`
Gestion des packages de cours :

```sql
CREATE TABLE wp_col_lms_packages (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    package_id varchar(255) NOT NULL,
    user_id bigint(20) NOT NULL,
    course_id bigint(20) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    progress int(3) DEFAULT 0,
    options longtext,
    files longtext,
    estimated_size bigint(20) DEFAULT 0,
    actual_size bigint(20) DEFAULT 0,
    error_message text,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    completed_at datetime,
    PRIMARY KEY (id),
    UNIQUE KEY package_id (package_id),
    KEY user_course (user_id, course_id)
);
```

#### `wp_col_lms_logs`
Système de logging :

```sql
CREATE TABLE wp_col_lms_logs (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    user_id bigint(20),
    action varchar(50) NOT NULL,
    details longtext,
    ip_address varchar(45),
    user_agent text,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY user_action (user_id, action),
    KEY created_at (created_at)
);
```

#### `wp_col_lms_sync_log`
Logs de synchronisation :

```sql
CREATE TABLE wp_col_lms_sync_log (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    user_id bigint(20) NOT NULL,
    sync_type varchar(50) NOT NULL,
    items_synced int(11) DEFAULT 0,
    items_failed int(11) DEFAULT 0,
    conflicts_detected int(11) DEFAULT 0,
    sync_data longtext,
    device_id varchar(255),
    client_timestamp datetime,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY user_sync (user_id, sync_type)
);
```

## Endpoints API

### Authentification (`/auth`)

#### POST `/auth/login`
Connexion utilisateur :

**Paramètres :**
```json
{
    "username": "string",
    "password": "string",
    "device_id": "string",
    "device_name": "string (optionnel)",
    "device_type": "string (optionnel)"
}
```

**Réponse :**
```json
{
    "success": true,
    "token": "jwt_token",
    "refresh_token": "refresh_token",
    "expires_in": 3600,
    "user": {
        "id": 123,
        "username": "user@example.com",
        "display_name": "John Doe",
        "membership": {
            "is_active": true,
            "level_name": "Premium"
        }
    }
}
```

#### POST `/auth/refresh`
Renouvellement de token :

**Paramètres :**
```json
{
    "refresh_token": "string",
    "device_id": "string"
}
```

#### POST `/auth/logout`
Déconnexion :

**Paramètres :**
```json
{
    "all_devices": false
}
```

### Cours (`/courses`)

#### GET `/courses`
Liste des cours accessibles :

**Paramètres de requête :**
- `page` : Page (défaut: 1)
- `per_page` : Nombre par page (défaut: 20, max: 100)
- `search` : Recherche textuelle
- `category` : ID de catégorie
- `level` : Niveau (beginner, intermediate, expert)
- `enrolled_only` : Seulement les cours inscrits

**Réponse :**
```json
{
    "courses": [
        {
            "id": 123,
            "title": "Cours de JavaScript",
            "description": "Description du cours",
            "thumbnail": "url_image",
            "instructor": {
                "name": "John Teacher",
                "avatar": "url_avatar"
            },
            "stats": {
                "lessons_count": 15,
                "quizzes_count": 3,
                "duration": "5 hours"
            },
            "price": {
                "amount": 99.99,
                "is_free": false
            }
        }
    ],
    "total": 150,
    "pages": 8
}
```

#### GET `/courses/{id}`
Détails d'un cours :

**Réponse :**
```json
{
    "course": {
        "id": 123,
        "title": "Cours de JavaScript",
        "content": "Contenu HTML du cours",
        "sections": [
            {
                "id": 1,
                "title": "Introduction",
                "items": [
                    {
                        "id": 456,
                        "title": "Première leçon",
                        "type": "lp_lesson",
                        "duration": "15 minutes",
                        "status": "completed"
                    }
                ]
            }
        ],
        "user_progress": {
            "status": "enrolled",
            "progress": 75,
            "start_time": "2024-01-15 10:00:00"
        }
    }
}
```

#### POST `/courses/{id}/package`
Créer un package de téléchargement :

**Paramètres :**
```json
{
    "options": {
        "include_videos": true,
        "include_documents": true,
        "include_images": true,
        "compress_images": false,
        "video_quality": "original",
        "encryption_enabled": true
    }
}
```

**Réponse :**
```json
{
    "success": true,
    "package_id": "uuid-package-id",
    "status": "processing",
    "estimated_size": 104857600,
    "estimated_size_human": "100 MB",
    "message": "Package en cours de création."
}
```

### Packages (`/packages`)

#### GET `/packages/{id}/status`
Statut d'un package :

**Réponse :**
```json
{
    "package_id": "uuid-package-id",
    "status": "completed",
    "progress": 100,
    "created_at": "2024-01-15 10:00:00",
    "completed_at": "2024-01-15 10:05:00",
    "actual_size": 98304000,
    "actual_size_human": "93.75 MB",
    "files": [
        {
            "filename": "manifest.json",
            "size": 2048,
            "type": "application/json"
        }
    ],
    "download_url": "rest_url/packages/uuid/download",
    "expires_at": "2024-01-16 10:05:00"
}
```

#### GET `/packages/{id}/download`
Télécharger un package :

**Réponse :**
```json
{
    "download_url": "https://site.com/?col_lms_download=token",
    "expires_in": 3600,
    "package_info": {
        "size": 98304000,
        "size_human": "93.75 MB",
        "files_count": 25
    }
}
```

### Synchronisation (`/sync`)

#### POST `/sync/progress`
Synchroniser la progression :

**Paramètres :**
```json
{
    "progress_data": {
        "lessons": [
            {
                "id": 456,
                "status": "completed",
                "progress": 100,
                "time_spent": 900,
                "end_time": "2024-01-15 11:00:00"
            }
        ],
        "quizzes": [
            {
                "id": 789,
                "attempt_data": {
                    "answers": {
                        "question_1": "answer_a",
                        "question_2": "answer_b"
                    },
                    "start_time": "2024-01-15 11:05:00",
                    "end_time": "2024-01-15 11:15:00"
                }
            }
        ]
    },
    "device_id": "string",
    "timestamp": 1642248000
}
```

**Réponse :**
```json
{
    "success": true,
    "synced": [
        {
            "type": "lesson",
            "id": 456,
            "status": "completed"
        }
    ],
    "conflicts": [],
    "errors": [],
    "sync_id": "uuid-sync-id",
    "server_timestamp": "2024-01-15 11:30:00"
}
```

#### GET `/sync/pull`
Récupérer les données à synchroniser :

**Paramètres de requête :**
- `since` : Date/heure de dernière sync
- `types` : Types de données (courses, progress, quizzes)
- `course_ids` : IDs des cours spécifiques

## Sécurité

### Authentification JWT

Le plugin utilise JSON Web Tokens (JWT) pour l'authentification :

1. **Structure du token :**
   ```json
   {
     "iss": "https://votre-site.com",
     "aud": "col-lms-offline",
     "iat": 1642248000,
     "exp": 1642251600,
     "user_id": 123,
     "device_id": "device-uuid",
     "nonce": "random-string"
   }
   ```

2. **Validation :**
   - Signature HMAC-SHA256
   - Vérification de l'expiration
   - Validation de l'émetteur
   - Vérification en base de données

### Rate Limiting

Protection contre les abus :
- Limite configurable par IP
- Fenêtre de temps glissante
- Bypass pour les IPs whitelistées

### Chiffrement

Les données sensibles sont chiffrées :
- Packages de cours (AES-256)
- Tokens JWT signés
- Données de synchronisation

## Configuration

### Variables d'Environnement

```php
// Activer/désactiver l'API
define('COL_LMS_API_ENABLED', true);

// Permettre HTTP (dev seulement)
define('COL_LMS_ALLOW_HTTP', false);

// Durée de vie des tokens (secondes)
define('COL_LMS_TOKEN_LIFETIME', 3600);

// Taille max des packages (octets)
define('COL_LMS_MAX_PACKAGE_SIZE', 2147483648);

// Mode debug
define('COL_LMS_DEBUG_MODE', false);
```

### Options WordPress

Le plugin utilise les options WordPress pour la configuration :

```php
// Obtenir une option
$api_enabled = get_option('col_lms_api_enabled', true);

// Options principales
$options = array(
    'col_lms_api_enabled',
    'col_lms_require_membership',
    'col_lms_token_lifetime',
    'col_lms_max_devices_per_user',
    'col_lms_enable_rate_limiting',
    'col_lms_package_expiry_hours'
);
```

## Tâches CRON

Le plugin programme plusieurs tâches automatiques :

### Nettoyage des Tokens Expirés
```php
// Fréquence : Horaire
add_action('col_lms_cleanup_expired', 'cleanup_expired_data');
```

### Traitement des Packages
```php
// Fréquence : Toutes les 5 minutes
add_action('col_lms_process_packages', 'process_pending_packages');
```

### Nettoyage des Logs
```php
// Fréquence : Quotidienne
add_action('col_lms_cleanup_logs', 'cleanup_old_logs');
```

## Hooks et Filtres

### Actions Disponibles

```php
// Après création d'un package
do_action('col_lms_package_created', $package_id, $user_id, $course_id);

// Après synchronisation
do_action('col_lms_sync_completed', $user_id, $sync_results);

// Avant suppression d'un package
do_action('col_lms_before_package_delete', $package_id);
```

### Filtres Disponibles

```php
// Modifier les options de package
$options = apply_filters('col_lms_package_options', $options, $course_id);

// Filtrer les cours accessibles
$courses = apply_filters('col_lms_accessible_courses', $courses, $user_id);

// Modifier les données de synchronisation
$sync_data = apply_filters('col_lms_sync_data', $sync_data, $user_id);
```

## Intégration Paid Memberships Pro

### Vérification d'Accès

```php
// Vérifier l'abonnement
if (function_exists('pmpro_getMembershipLevelForUser')) {
    $level = pmpro_getMembershipLevelForUser($user_id);
    
    if ($level && !$this->is_level_expired($level)) {
        // Utilisateur a accès
    }
}
```

### Configuration des Niveaux

```php
// Niveaux autorisés
$allowed_levels = get_option('col_lms_allowed_membership_levels');

// Vérifier si le niveau est autorisé
if (empty($allowed_levels) || in_array($level->id, $allowed_levels)) {
    // Accès autorisé
}
```

## Debugging et Logs

### Niveaux de Log

```php
COL_LMS_Logger::debug('Message de debug');
COL_LMS_Logger::info('Information générale');
COL_LMS_Logger::warning('Avertissement');
COL_LMS_Logger::error('Erreur');
COL_LMS_Logger::critical('Erreur critique');
```

### Consultation des Logs

Les logs sont accessibles via :
1. Interface d'administration WordPress
2. Table `wp_col_lms_logs`
3. Fichiers de log WordPress (si activés)

### Debug Mode

En mode debug, le plugin logge plus d'informations :
```php
if (defined('COL_LMS_DEBUG_MODE') && COL_LMS_DEBUG_MODE) {
    COL_LMS_Logger::debug('Information détaillée', $context);
}
```

## Performance et Optimisation

### Cache

```php
// Cache des requêtes fréquentes
$cache_key = 'col_lms_user_courses_' . $user_id;
$courses = get_transient($cache_key);

if (false === $courses) {
    $courses = $this->get_user_courses($user_id);
    set_transient($cache_key, $courses, 300);
}
```

### Optimisations Base de Données

1. **Index composites** pour les requêtes fréquentes
2. **Pagination** pour les grandes listes
3. **Requêtes préparées** pour la sécurité
4. **Nettoyage automatique** des données anciennes

### Gestion Mémoire

```php
// Traitement par lots pour éviter les timeouts
$batch_size = get_option('col_lms_sync_batch_size', 100);
$items = array_chunk($all_items, $batch_size);

foreach ($items as $batch) {
    $this->process_batch($batch);
    
    // Libérer la mémoire
    wp_cache_flush();
}
```

## Tests et Monitoring

### Tests Unitaires

```php
// Structure recommandée pour les tests
class COL_LMS_Auth_Test extends WP_UnitTestCase {
    
    public function test_login_with_valid_credentials() {
        $user_id = $this->factory->user->create();
        $auth = COL_LMS_Auth::instance();
        
        $result = $auth->login($request);
        
        $this->assertTrue($result['success']);
        $this->assertNotEmpty($result['token']);
    }
}
```

### Monitoring

Points clés à surveiller :
1. **Taux d'erreur API** (< 1%)
2. **Temps de réponse** (< 2s)
3. **Utilisation mémoire** (< 512MB)
4. **Taille des packages** (suivre la croissance)
5. **Activité de synchronisation** (détecter les anomalies)

### Métriques Disponibles

```php
// Statistiques d'utilisation
$stats = array(
    'total_api_calls' => $wpdb->get_var("SELECT COUNT(*) FROM wp_col_lms_logs"),
    'active_users' => $wpdb->get_var("SELECT COUNT(DISTINCT user_id) FROM wp_col_lms_tokens WHERE expires_at > NOW()"),
    'packages_created' => $wpdb->get_var("SELECT COUNT(*) FROM wp_col_lms_packages WHERE status = 'completed'")
);
```

## Dépannage

### Problèmes Courants

#### Erreurs d'Authentification
```
Error: invalid_credentials
Solution: Vérifier les identifiants et les permissions utilisateur
```

#### Packages qui Échouent
```
Error: package_creation_failed
Solution: Vérifier l'espace disque et les permissions de fichiers
```

#### Conflits de Synchronisation
```
Error: sync_conflict
Solution: Utiliser la résolution automatique ou manuelle des conflits
```

### Commandes de Diagnostic

```php
// Vérifier l'état de l'API
$health_check = COL_LMS_Migration::instance()->health_check();

// Nettoyer manuellement
COL_LMS_Packages::instance()->cleanup_old_packages();

// Forcer une synchronisation
update_user_meta($user_id, '_col_lms_force_full_sync', true);
```

### Logs de Debug

```php
// Activer le debug pour un utilisateur spécifique
update_user_meta($user_id, '_col_lms_debug_enabled', true);

// Consulter les dernières erreurs
$recent_errors = COL_LMS_Logger::get_logs(array(
    'level' => COL_LMS_Logger::LEVEL_ERROR,
    'since' => date('Y-m-d H:i:s', strtotime('-1 hour')),
    'limit' => 50
));
```

## Migration et Maintenance

### Sauvegarde

Avant toute mise à jour majeure :

```bash
# Sauvegarder la base de données
wp db export col_lms_backup_$(date +%Y%m%d).sql

# Sauvegarder les fichiers de packages
tar -czf packages_backup_$(date +%Y%m%d).tar.gz wp-content/uploads/col-lms-packages/
```

### Mise à Jour

Le plugin gère automatiquement les migrations :

```php
// Vérifier la version et migrer si nécessaire
COL_LMS_Migration::instance()->check_version();
```

### Maintenance Préventive

```php
// Nettoyage manuel mensuel
wp cron event run col_lms_cleanup_expired
wp cron event run col_lms_cleanup_logs
wp cron event run col_lms_cleanup_packages
```

## Sécurité et Conformité

### Conformité RGPD

Le plugin respecte le RGPD :
1. **Données minimales** : collecte seulement les données nécessaires
2. **Consentement** : utilise les mécanismes WordPress existants
3. **Droit à l'oubli** : suppression automatique lors de la désinstallation
4. **Transparence** : logs d'activité consultables

### Audit de Sécurité

Points de vérification réguliers :
1. **Tokens expirés** supprimés automatiquement
2. **Logs sensibles** nettoyés régulièrement  
3. **Permissions** vérifiées à chaque requête
4. **Rate limiting** actif et configuré
5. **HTTPS** forcé en production

Cette documentation technique fournit une vue complète du plugin COL LMS Offline API. Pour des questions spécifiques ou des problèmes non couverts, consultez les logs du plugin ou contactez le support technique.
