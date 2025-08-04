<?php
/**
 * Classe de migration pour COL LMS Offline API
 * 
 * Gère les mises à jour de la base de données et la migration des données
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Migration {
    
    private static $instance = null;
    
    /**
     * Version actuelle de la DB
     */
    private $db_version = '1.0.0';
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('admin_init', array($this, 'check_version'));
    }
    
    /**
     * Vérifier si une migration est nécessaire
     */
    public function check_version() {
        $current_version = get_option('col_lms_db_version', '0');
        
        if (version_compare($current_version, $this->db_version, '<')) {
            $this->run();
        }
    }
    
    /**
     * Exécuter les migrations
     */
    public function run() {
        global $wpdb;
        
        $current_version = get_option('col_lms_db_version', '0');
        
        // Désactiver les erreurs pendant la migration
        $wpdb->hide_errors();
        
        try {
            // Migration depuis 0 (première installation)
            if ($current_version === '0') {
                $this->create_initial_tables();
                $this->setup_default_options();
                $this->create_api_user_role();
                $this->create_initial_directories();
            }
            
            // Futures migrations version par version
            if (version_compare($current_version, '1.0.1', '<')) {
                // $this->migrate_to_1_0_1();
            }
            
            if (version_compare($current_version, '1.1.0', '<')) {
                // $this->migrate_to_1_1_0();
            }
            
            // Mettre à jour la version
            update_option('col_lms_db_version', $this->db_version);
            
            COL_LMS_Logger::info('Migration terminée avec succès', array(
                'from_version' => $current_version,
                'to_version' => $this->db_version
            ));
            
        } catch (Exception $e) {
            COL_LMS_Logger::error('Erreur lors de la migration', array(
                'error' => $e->getMessage(),
                'from_version' => $current_version
            ));
            
            // En cas d'erreur, on peut choisir de continuer ou d'arrêter
            // Pour l'instant, on continue mais on loggue l'erreur
        }
        
        // Réactiver les erreurs
        $wpdb->show_errors();
    }
    
    /**
     * Créer les tables initiales
     */
    private function create_initial_tables() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        
        // Table des tokens d'authentification
        $table_tokens = $wpdb->prefix . 'col_lms_tokens';
        $sql_tokens = "CREATE TABLE IF NOT EXISTS $table_tokens (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            device_id varchar(255) NOT NULL,
            device_name varchar(255) DEFAULT NULL,
            device_type varchar(50) DEFAULT 'desktop',
            token_hash varchar(255) NOT NULL,
            refresh_token_hash varchar(255) NOT NULL,
            expires_at datetime NOT NULL,
            last_used datetime DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_device (user_id, device_id),
            KEY token_hash (token_hash),
            KEY expires_at (expires_at),
            KEY user_id (user_id),
            KEY device_id (device_id)
        ) $charset_collate;";
        
        // Table des packages de cours
        $table_packages = $wpdb->prefix . 'col_lms_packages';
        $sql_packages = "CREATE TABLE IF NOT EXISTS $table_packages (
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
            completed_at datetime DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY package_id (package_id),
            KEY user_course (user_id, course_id),
            KEY status (status),
            KEY created_at (created_at),
            KEY user_id (user_id)
        ) $charset_collate;";
        
        // Table des logs d'activité
        $table_logs = $wpdb->prefix . 'col_lms_logs';
        $sql_logs = "CREATE TABLE IF NOT EXISTS $table_logs (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) DEFAULT NULL,
            action varchar(50) NOT NULL,
            details longtext,
            ip_address varchar(45),
            user_agent text,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_action (user_id, action),
            KEY created_at (created_at),
            KEY action (action)
        ) $charset_collate;";
        
        // Table des logs de synchronisation
        $table_sync_log = $wpdb->prefix . 'col_lms_sync_log';
        $sql_sync_log = "CREATE TABLE IF NOT EXISTS $table_sync_log (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            sync_type varchar(50) NOT NULL,
            items_synced int(11) DEFAULT 0,
            items_failed int(11) DEFAULT 0,
            conflicts_detected int(11) DEFAULT 0,
            sync_data longtext,
            device_id varchar(255),
            client_timestamp datetime DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_sync (user_id, sync_type),
            KEY created_at (created_at),
            KEY user_id (user_id)
        ) $charset_collate;";
        
        // Table pour les conflits de synchronisation
        $table_conflicts = $wpdb->prefix . 'col_lms_sync_conflicts';
        $sql_conflicts = "CREATE TABLE IF NOT EXISTS $table_conflicts (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            object_type varchar(50) NOT NULL,
            object_id bigint(20) NOT NULL,
            conflict_type varchar(50) NOT NULL,
            client_data longtext,
            server_data longtext,
            resolution varchar(50) DEFAULT 'pending',
            resolved_at datetime DEFAULT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_object (user_id, object_type, object_id),
            KEY resolution (resolution),
            KEY created_at (created_at)
        ) $charset_collate;";
        
        // Table pour les statistiques d'utilisation
        $table_stats = $wpdb->prefix . 'col_lms_usage_stats';
        $sql_stats = "CREATE TABLE IF NOT EXISTS $table_stats (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            stat_type varchar(50) NOT NULL,
            stat_value longtext,
            date_recorded date NOT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY user_stat_date (user_id, stat_type, date_recorded),
            KEY stat_type (stat_type),
            KEY date_recorded (date_recorded)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        
        // Exécuter les créations de tables
        dbDelta($sql_tokens);
        dbDelta($sql_packages);
        dbDelta($sql_logs);
        dbDelta($sql_sync_log);
        dbDelta($sql_conflicts);
        dbDelta($sql_stats);
        
        // Créer les index supplémentaires pour optimiser les performances
        $this->create_additional_indexes();
        
        COL_LMS_Logger::info('Tables créées avec succès');
    }
    
    /**
     * Créer des index supplémentaires pour optimiser les performances
     */
    private function create_additional_indexes() {
        global $wpdb;
        
        // Index composites pour les requêtes fréquentes
        $indexes = array(
            // Tokens actifs par utilisateur
            "CREATE INDEX idx_active_user_tokens ON {$wpdb->prefix}col_lms_tokens (user_id, expires_at) WHERE expires_at > NOW()",
            
            // Packages en cours par utilisateur
            "CREATE INDEX idx_user_active_packages ON {$wpdb->prefix}col_lms_packages (user_id, status, created_at) WHERE status IN ('pending', 'processing', 'completed')",
            
            // Logs récents par action
            "CREATE INDEX idx_recent_logs_by_action ON {$wpdb->prefix}col_lms_logs (action, created_at)",
            
            // Synchronisations par utilisateur et date
            "CREATE INDEX idx_user_sync_recent ON {$wpdb->prefix}col_lms_sync_log (user_id, created_at)",
            
            // Conflits non résolus
            "CREATE INDEX idx_unresolved_conflicts ON {$wpdb->prefix}col_lms_sync_conflicts (resolution, created_at) WHERE resolution = 'pending'"
        );
        
        foreach ($indexes as $index_sql) {
            // Ignorer les erreurs car certains index peuvent déjà exister
            $wpdb->query($index_sql);
        }
    }
    
    /**
     * Configurer les options par défaut
     */
    private function setup_default_options() {
        // Options générales
        $general_options = array(
            'col_lms_api_enabled' => true,
            'col_lms_require_membership' => false,
            'col_lms_allowed_membership_levels' => array(),
            'col_lms_token_lifetime' => 3600, // 1 heure
            'col_lms_refresh_token_lifetime' => 604800, // 7 jours
            'col_lms_max_devices_per_user' => 5,
            'col_lms_api_version' => COL_LMS_API_VERSION
        );
        
        // Options de sécurité
        $security_options = array(
            'col_lms_enable_rate_limiting' => true,
            'col_lms_rate_limit_requests' => 100,
            'col_lms_rate_limit_window' => 3600, // 1 heure
            'col_lms_enable_ip_whitelist' => false,
            'col_lms_ip_whitelist' => array(),
            'col_lms_enable_encryption' => true,
            'col_lms_min_log_level' => COL_LMS_Logger::LEVEL_INFO,
            'col_lms_log_retention_days' => 30,
            'col_lms_notify_on_errors' => false
        );
        
        // Options de téléchargement
        $download_options = array(
            'col_lms_enable_course_packages' => true,
            'col_lms_package_expiry_hours' => 24,
            'col_lms_max_package_size' => 2147483648, // 2GB
            'col_lms_max_packages_per_user' => 10,
            'col_lms_allowed_file_types' => array(
                'video' => array('mp4', 'webm', 'ogv', 'avi', 'mov'),
                'audio' => array('mp3', 'ogg', 'wav', 'm4a'),
                'document' => array('pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'rtf'),
                'image' => array('jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'),
                'archive' => array('zip', 'rar', '7z')
            )
        );
        
        // Options de synchronisation
        $sync_options = array(
            'col_lms_enable_progress_sync' => true,
            'col_lms_sync_batch_size' => 100,
            'col_lms_auto_sync_interval' => 3600, // 1 heure
            'col_lms_sync_log_retention' => 30, // 30 jours
            'col_lms_conflict_resolution_strategy' => 'server_wins'
        );
        
        // Options de maintenance
        $maintenance_options = array(
            'col_lms_cleanup_old_data_days' => 30,
            'col_lms_enable_debug_mode' => false,
            'col_lms_maintenance_mode' => false
        );
        
        // Statistiques initiales
        $stats_options = array(
            'col_lms_stats' => array(
                'total_api_calls' => 0,
                'total_downloads' => 0,
                'total_sync_operations' => 0,
                'total_users_registered' => 0,
                'last_reset' => current_time('mysql'),
                'installation_date' => current_time('mysql')
            )
        );
        
        // Ajouter toutes les options
        $all_options = array_merge(
            $general_options,
            $security_options,
            $download_options,
            $sync_options,
            $maintenance_options,
            $stats_options
        );
        
        foreach ($all_options as $option_name => $option_value) {
            add_option($option_name, $option_value);
        }
        
        // Générer et stocker la clé JWT si elle n'existe pas
        if (!get_option('col_lms_jwt_secret')) {
            $jwt_secret = wp_generate_password(64, true, true);
            add_option('col_lms_jwt_secret', $jwt_secret);
        }
        
        COL_LMS_Logger::info('Options par défaut configurées');
    }
    
    /**
     * Créer le rôle utilisateur pour l'API
     */
    private function create_api_user_role() {
        // Capacités pour les utilisateurs de l'API
        $capabilities = array(
            'read' => true,
            'col_lms_use_api' => true,
            'col_lms_download_courses' => true,
            'col_lms_sync_progress' => true
        );
        
        // Créer le rôle s'il n'existe pas
        if (!get_role('col_lms_api_user')) {
            add_role(
                'col_lms_api_user',
                __('Utilisateur API LearnPress Offline', 'col-lms-offline-api'),
                $capabilities
            );
        }
        
        // Ajouter les capacités aux rôles existants
        $roles_with_api_access = array(
            'administrator' => array_merge($capabilities, array(
                'col_lms_manage_api' => true,
                'col_lms_view_logs' => true,
                'col_lms_manage_packages' => true
            )),
            'lp_teacher' => $capabilities,
            'subscriber' => $capabilities
        );
        
        foreach ($roles_with_api_access as $role_name => $caps) {
            $role = get_role($role_name);
            if ($role) {
                foreach ($caps as $cap => $grant) {
                    $role->add_cap($cap, $grant);
                }
            }
        }
        
        COL_LMS_Logger::info('Rôles et capacités configurés');
    }
    
    /**
     * Créer les dossiers initiaux
     */
    private function create_initial_directories() {
        $upload_dir = wp_upload_dir();
        $directories = array(
            $upload_dir['basedir'] . '/col-lms-packages' => 'Packages de cours',
            $upload_dir['basedir'] . '/col-lms-temp' => 'Fichiers temporaires',
            $upload_dir['basedir'] . '/col-lms-logs' => 'Logs exportés',
            $upload_dir['basedir'] . '/col-lms-cache' => 'Cache API'
        );
        
        foreach ($directories as $dir => $description) {
            if (!file_exists($dir)) {
                wp_mkdir_p($dir);
                
                // Ajouter .htaccess pour sécuriser
                $htaccess_content = "# COL LMS API - {$description}\n";
                $htaccess_content .= "Order deny,allow\n";
                $htaccess_content .= "Deny from all\n";
                $htaccess_content .= "<Files ~ \"\\.(json|zip)$\">\n";
                $htaccess_content .= "    Allow from all\n";
                $htaccess_content .= "</Files>\n";
                
                file_put_contents($dir . '/.htaccess', $htaccess_content);
                
                // Ajouter index.php vide
                file_put_contents($dir . '/index.php', '<?php // Silence is golden');
                
                // Ajouter un fichier README
                $readme_content = "# {$description}\n\n";
                $readme_content .= "Ce dossier est utilisé par le plugin COL LMS Offline API.\n";
                $readme_content .= "Ne pas supprimer sauf si vous désinstallez le plugin.\n\n";
                $readme_content .= "Créé le: " . current_time('mysql') . "\n";
                
                file_put_contents($dir . '/README.txt', $readme_content);
            }
        }
        
        COL_LMS_Logger::info('Dossiers initiaux créés');
    }
    
    /**
     * Migration vers version 1.0.1 (exemple pour futures versions)
     */
    private function migrate_to_1_0_1() {
        global $wpdb;
        
        // Exemple: Ajouter une nouvelle colonne
        $wpdb->query("ALTER TABLE {$wpdb->prefix}col_lms_tokens ADD COLUMN session_id VARCHAR(255) DEFAULT NULL");
        
        // Exemple: Mettre à jour des données existantes
        $wpdb->update(
            $wpdb->prefix . 'col_lms_packages',
            array('status' => 'pending'),
            array('status' => 'waiting') // Ancien statut
        );
        
        COL_LMS_Logger::info('Migration 1.0.1 effectuée');
    }
    
    /**
     * Effectuer des vérifications de santé
     */
    public function health_check() {
        global $wpdb;
        
        $issues = array();
        
        // Vérifier les tables
        $required_tables = array(
            'col_lms_tokens',
            'col_lms_packages',
            'col_lms_logs',
            'col_lms_sync_log',
            'col_lms_sync_conflicts',
            'col_lms_usage_stats'
        );
        
        foreach ($required_tables as $table) {
            $table_name = $wpdb->prefix . $table;
            if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
                $issues[] = sprintf(
                    __('Table %s manquante', 'col-lms-offline-api'),
                    $table_name
                );
            }
        }
        
        // Vérifier les plugins requis
        if (!class_exists('LearnPress')) {
            $issues[] = __('LearnPress n\'est pas installé ou activé', 'col-lms-offline-api');
        }
        
        // Vérifier HTTPS
        if (!is_ssl() && !defined('COL_LMS_ALLOW_HTTP')) {
            $issues[] = __('HTTPS est recommandé pour la sécurité de l\'API', 'col-lms-offline-api');
        }
        
        // Vérifier les permissions des dossiers
        $upload_dir = wp_upload_dir();
        $required_dirs = array(
            $upload_dir['basedir'] . '/col-lms-packages',
            $upload_dir['basedir'] . '/col-lms-temp'
        );
        
        foreach ($required_dirs as $dir) {
            if (!is_writable($dir)) {
                $issues[] = sprintf(
                    __('Le dossier %s n\'est pas accessible en écriture', 'col-lms-offline-api'),
                    $dir
                );
            }
        }
        
        // Vérifier la configuration PHP
        $php_requirements = array(
            'memory_limit' => '128M',
            'max_execution_time' => 30,
            'upload_max_filesize' => '32M'
        );
        
        foreach ($php_requirements as $setting => $min_value) {
            $current_value = ini_get($setting);
            
            if ($setting === 'memory_limit' || $setting === 'upload_max_filesize') {
                if (wp_convert_hr_to_bytes($current_value) < wp_convert_hr_to_bytes($min_value)) {
                    $issues[] = sprintf(
                        __('Configuration PHP %s trop faible: %s (minimum recommandé: %s)', 'col-lms-offline-api'),
                        $setting,
                        $current_value,
                        $min_value
                    );
                }
            } elseif ($current_value < $min_value) {
                $issues[] = sprintf(
                    __('Configuration PHP %s trop faible: %s (minimum recommandé: %s)', 'col-lms-offline-api'),
                    $setting,
                    $current_value,
                    $min_value
                );
            }
        }
        
        // Vérifier les extensions PHP
        $required_extensions = array('json', 'openssl', 'curl', 'zip');
        foreach ($required_extensions as $extension) {
            if (!extension_loaded($extension)) {
                $issues[] = sprintf(
                    __('Extension PHP manquante: %s', 'col-lms-offline-api'),
                    $extension
                );
            }
        }
        
        return $issues;
    }
    
    /**
     * Nettoyer lors de la désinstallation
     */
    public static function uninstall() {
        global $wpdb;
        
        // Supprimer les tables
        $tables = array(
            $wpdb->prefix . 'col_lms_tokens',
            $wpdb->prefix . 'col_lms_packages',
            $wpdb->prefix . 'col_lms_logs',
            $wpdb->prefix . 'col_lms_sync_log',
            $wpdb->prefix . 'col_lms_sync_conflicts',
            $wpdb->prefix . 'col_lms_usage_stats'
        );
        
        foreach ($tables as $table) {
            $wpdb->query("DROP TABLE IF EXISTS $table");
        }
        
        // Supprimer les options
        $option_patterns = array(
            'col_lms_%',
            'col_lms_db_version',
            'col_lms_jwt_secret'
        );
        
        foreach ($option_patterns as $pattern) {
            $wpdb->query($wpdb->prepare("
                DELETE FROM {$wpdb->options} 
                WHERE option_name LIKE %s
            ", $pattern));
        }
        
        // Supprimer les user meta
        $user_meta_keys = array(
            '_col_lms_last_sync',
            '_col_lms_device_limit_notified',
            '_col_lms_api_usage_stats',
            '_col_lms_notes',
            '_col_lms_sync_conflicts'
        );
        
        foreach ($user_meta_keys as $meta_key) {
            $wpdb->delete(
                $wpdb->usermeta,
                array('meta_key' => $meta_key)
            );
        }
        
        // Supprimer les post meta
        $post_meta_keys = array(
            '_lp_course_version',
            '_col_lms_download_count',
            '_col_lms_package_data'
        );
        
        foreach ($post_meta_keys as $meta_key) {
            $wpdb->delete(
                $wpdb->postmeta,
                array('meta_key' => $meta_key)
            );
        }
        
        // Supprimer les transients
        $wpdb->query("
            DELETE FROM {$wpdb->options} 
            WHERE option_name LIKE '_transient_col_lms_%' 
               OR option_name LIKE '_transient_timeout_col_lms_%'
        ");
        
        // Pour multisite
        if (is_multisite()) {
            $wpdb->query("
                DELETE FROM {$wpdb->sitemeta} 
                WHERE meta_key LIKE '%col_lms_%'
            ");
        }
        
        // Nettoyer les tâches cron
        $cron_hooks = array(
            'col_lms_cleanup_expired',
            'col_lms_process_packages',
            'col_lms_cleanup_logs',
            'col_lms_auto_sync',
            'col_lms_cleanup_packages'
        );
        
        foreach ($cron_hooks as $hook) {
            wp_clear_scheduled_hook($hook);
        }
        
        // Supprimer les capacités ajoutées
        $capabilities = array(
            'col_lms_use_api',
            'col_lms_download_courses',
            'col_lms_sync_progress',
            'col_lms_manage_api',
            'col_lms_view_logs',
            'col_lms_manage_packages'
        );
        
        // Récupérer tous les rôles
        $roles = wp_roles()->get_names();
        
        foreach ($roles as $role_name => $role_display_name) {
            $role = get_role($role_name);
            if ($role) {
                foreach ($capabilities as $cap) {
                    $role->remove_cap($cap);
                }
            }
        }
        
        // Supprimer le rôle personnalisé
        remove_role('col_lms_api_user');
        
        // Supprimer les fichiers uploadés
        self::cleanup_uploaded_files();
        
        // Log de la désinstallation
        error_log('[COL LMS API] Plugin désinstallé - toutes les données supprimées');
    }
    
    /**
     * Nettoyer les fichiers uploadés
     */
    private static function cleanup_uploaded_files() {
        $upload_dir = wp_upload_dir();
        $plugin_dirs = array(
            $upload_dir['basedir'] . '/col-lms-packages',
            $upload_dir['basedir'] . '/col-lms-temp',
            $upload_dir['basedir'] . '/col-lms-logs',
            $upload_dir['basedir'] . '/col-lms-cache'
        );
        
        foreach ($plugin_dirs as $dir) {
            if (is_dir($dir)) {
                self::delete_directory($dir);
            }
        }
    }
    
    /**
     * Supprimer récursivement un dossier
     */
    private static function delete_directory($dir) {
        if (!is_dir($dir)) {
            return false;
        }
        
        $files = array_diff(scandir($dir), array('.', '..'));
        
        foreach ($files as $file) {
            $path = $dir . DIRECTORY_SEPARATOR . $file;
            
            if (is_dir($path)) {
                self::delete_directory($path);
            } else {
                unlink($path);
            }
        }
        
        return rmdir($dir);
    }
    
    /**
     * Exporter les données avant migration (utile pour les sauvegardes)
     */
    public function export_data_before_migration() {
        global $wpdb;
        
        $export_data = array(
            'timestamp' => current_time('mysql'),
            'version' => get_option('col_lms_db_version'),
            'tables' => array()
        );
        
        $tables = array(
            'col_lms_tokens',
            'col_lms_packages',
            'col_lms_sync_log'
        );
        
        foreach ($tables as $table) {
            $table_name = $wpdb->prefix . $table;
            $data = $wpdb->get_results("SELECT * FROM $table_name", ARRAY_A);
            $export_data['tables'][$table] = $data;
        }
        
        // Sauvegarder dans un fichier
        $upload_dir = wp_upload_dir();
        $backup_file = $upload_dir['basedir'] . '/col-lms-backup-' . date('Y-m-d-H-i-s') . '.json';
        
        file_put_contents($backup_file, wp_json_encode($export_data, JSON_PRETTY_PRINT));
        
        COL_LMS_Logger::info('Sauvegarde créée avant migration', array(
            'backup_file' => $backup_file,
            'tables_count' => count($tables)
        ));
        
        return $backup_file;
    }
}

// Hook de désinstallation
register_uninstall_hook(COL_LMS_API_BASENAME, array('COL_LMS_Migration', 'uninstall'));
