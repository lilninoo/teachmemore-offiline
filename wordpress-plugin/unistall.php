<?php
/**
 * Script de désinstallation pour COL LMS Offline API
 * 
 * Ce fichier est exécuté lorsque le plugin est supprimé via l'admin WordPress.
 * Il nettoie toutes les données créées par le plugin.
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Si la désinstallation n'est pas appelée depuis WordPress, sortir
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

/**
 * Nettoyer toutes les données du plugin
 */
function col_lms_uninstall_cleanup() {
    global $wpdb;
    
    // 1. Supprimer les tables
    $tables = array(
        $wpdb->prefix . 'col_lms_tokens',
        $wpdb->prefix . 'col_lms_packages',
        $wpdb->prefix . 'col_lms_logs',
        $wpdb->prefix . 'col_lms_sync_log',
        $wpdb->prefix . 'col_lms_activity_log'
    );
    
    foreach ($tables as $table) {
        $wpdb->query("DROP TABLE IF EXISTS $table");
    }
    
    // 2. Supprimer les options
    $options = array(
        // Version et configuration
        'col_lms_db_version',
        'col_lms_api_enabled',
        'col_lms_jwt_secret',
        
        // Paramètres généraux
        'col_lms_require_membership',
        'col_lms_allowed_membership_levels',
        'col_lms_token_lifetime',
        'col_lms_refresh_token_lifetime',
        'col_lms_max_devices_per_user',
        
        // Paramètres de sécurité
        'col_lms_enable_rate_limiting',
        'col_lms_rate_limit_requests',
        'col_lms_rate_limit_window',
        'col_lms_enable_ip_whitelist',
        'col_lms_ip_whitelist',
        'col_lms_min_log_level',
        'col_lms_log_retention_days',
        'col_lms_notify_on_errors',
        
        // Paramètres de téléchargement
        'col_lms_enable_course_packages',
        'col_lms_package_expiry_hours',
        'col_lms_max_package_size',
        'col_lms_allowed_file_types',
        
        // Paramètres de synchronisation
        'col_lms_enable_progress_sync',
        'col_lms_sync_batch_size',
        'col_lms_cleanup_old_data_days',
        
        // Statistiques
        'col_lms_stats'
    );
    
    foreach ($options as $option) {
        delete_option($option);
        
        // Supprimer aussi les versions avec site_id pour multisite
        delete_site_option($option);
    }
    
    // 3. Supprimer les user meta créés par le plugin
    $user_meta_keys = array(
        '_col_lms_last_sync',
        '_col_lms_device_limit_notified',
        '_col_lms_api_usage_stats'
    );
    
    foreach ($user_meta_keys as $meta_key) {
        $wpdb->delete(
            $wpdb->usermeta,
            array('meta_key' => $meta_key)
        );
    }
    
    // 4. Supprimer les post meta créés par le plugin
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
    
    // 5. Supprimer les transients
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
    
    // 6. Nettoyer les tâches cron
    $cron_hooks = array(
        'col_lms_cleanup_expired',
        'col_lms_process_packages',
        'col_lms_cleanup_logs',
        'col_lms_sync_user_data',
        'col_lms_send_stats_report'
    );
    
    foreach ($cron_hooks as $hook) {
        wp_clear_scheduled_hook($hook);
    }
    
    // 7. Supprimer les capacités ajoutées
    $capabilities = array(
        'col_lms_use_api',
        'col_lms_download_courses',
        'col_lms_sync_progress',
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
    
    // 8. Supprimer le rôle personnalisé
    remove_role('col_lms_api_user');
    
    // 9. Supprimer les fichiers uploadés
    col_lms_cleanup_uploaded_files();
    
    // 10. Log de la désinstallation
    error_log('[COL LMS API] Plugin désinstallé - toutes les données supprimées');
}

/**
 * Nettoyer les fichiers uploadés par le plugin
 */
function col_lms_cleanup_uploaded_files() {
    $upload_dir = wp_upload_dir();
    $plugin_upload_dir = $upload_dir['basedir'] . '/col-lms-packages';
    
    if (is_dir($plugin_upload_dir)) {
        col_lms_delete_directory($plugin_upload_dir);
    }
    
    // Nettoyer les fichiers temporaires
    $temp_dir = sys_get_temp_dir() . '/col-lms-temp';
    if (is_dir($temp_dir)) {
        col_lms_delete_directory($temp_dir);
    }
}

/**
 * Supprimer récursivement un dossier
 */
function col_lms_delete_directory($dir) {
    if (!is_dir($dir)) {
        return false;
    }
    
    $files = array_diff(scandir($dir), array('.', '..'));
    
    foreach ($files as $file) {
        $path = $dir . DIRECTORY_SEPARATOR . $file;
        
        if (is_dir($path)) {
            col_lms_delete_directory($path);
        } else {
            unlink($path);
        }
    }
    
    return rmdir($dir);
}

/**
 * Nettoyer les données multisite
 */
function col_lms_cleanup_multisite() {
    if (!is_multisite()) {
        return;
    }
    
    global $wpdb;
    
    // Récupérer tous les sites
    $sites = get_sites(array('number' => 0));
    
    foreach ($sites as $site) {
        switch_to_blog($site->blog_id);
        
        // Exécuter le nettoyage pour chaque site
        col_lms_uninstall_cleanup();
        
        restore_current_blog();
    }
}

/**
 * Vérifications de sécurité avant désinstallation
 */
function col_lms_pre_uninstall_checks() {
    // Vérifier que l'utilisateur a les permissions
    if (!current_user_can('activate_plugins')) {
        return false;
    }
    
    // Vérifier le nonce si disponible
    if (isset($_REQUEST['_wpnonce'])) {
        if (!wp_verify_nonce($_REQUEST['_wpnonce'], 'bulk-plugins')) {
            return false;
        }
    }
    
    return true;
}

/**
 * Sauvegarder les données importantes avant suppression (optionnel)
 */
function col_lms_backup_before_uninstall() {
    // Cette fonction peut être utilisée pour créer une sauvegarde
    // des données importantes avant la suppression complète
    
    global $wpdb;
    
    $backup_data = array(
        'timestamp' => current_time('mysql'),
        'version' => get_option('col_lms_db_version'),
        'total_users' => $wpdb->get_var("SELECT COUNT(DISTINCT user_id) FROM {$wpdb->prefix}col_lms_tokens"),
        'total_packages' => $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}col_lms_packages"),
        'settings' => array(
            'api_enabled' => get_option('col_lms_api_enabled'),
            'require_membership' => get_option('col_lms_require_membership'),
            'max_devices' => get_option('col_lms_max_devices_per_user')
        )
    );
    
    // Sauvegarder dans les logs WordPress
    error_log('[COL LMS API] Sauvegarde avant désinstallation: ' . wp_json_encode($backup_data));
    
    // Optionnel: envoyer par email à l'admin
    $admin_email = get_option('admin_email');
    if ($admin_email) {
        wp_mail(
            $admin_email,
            'COL LMS API - Sauvegarde avant désinstallation',
            'Données sauvegardées: ' . wp_json_encode($backup_data, JSON_PRETTY_PRINT)
        );
    }
}

// Exécution de la désinstallation
if (col_lms_pre_uninstall_checks()) {
    // Optionnel: créer une sauvegarde
    col_lms_backup_before_uninstall();
    
    // Nettoyer les données
    col_lms_uninstall_cleanup();
    
    // Nettoyer le multisite si applicable
    if (is_multisite()) {
        col_lms_cleanup_multisite();
    }
    
    // Force le vidage du cache
    if (function_exists('wp_cache_flush')) {
        wp_cache_flush();
    }
    
    // Message de confirmation dans les logs
    error_log('[COL LMS API] Désinstallation terminée avec succès');
}
