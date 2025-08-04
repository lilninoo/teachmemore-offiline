<?php
/**
 * Plugin Name: COL LMS Offline API
 * Plugin URI: https://votre-site.com/
 * Description: API REST avancée pour application mobile LMS avec support LearnPress et Paid Memberships Pro
 * Version: 1.2.0
 * Author: COL Team
 * License: GPL v2 or later
 * Text Domain: col-lms-offline-api
 * Domain Path: /languages
 * Requires at least: 5.8
 * Tested up to: 6.4
 * Requires PHP: 7.4
 * Network: false
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit('Accès direct interdit.');
}

// SÉCURITÉ : Gérer les erreurs de manière appropriée
if (!defined('WP_DEBUG') || !WP_DEBUG) {
    // En production, masquer les erreurs PHP mais les logger
    error_reporting(E_ERROR | E_PARSE);
    ini_set('display_errors', 0);
    ini_set('log_errors', 1);
}

// Fonction de logging sécurisée
function col_lms_log_error($message, $context = array()) {
    if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
        error_log('[COL LMS API] ' . $message . ' - Context: ' . wp_json_encode($context));
    }
}

// Vérifier la version PHP minimum
if (version_compare(PHP_VERSION, '7.4', '<')) {
    add_action('admin_notices', function() {
        echo '<div class="notice notice-error"><p>';
        echo sprintf(
            __('COL LMS Offline API nécessite PHP 7.4 ou supérieur. Version actuelle : %s', 'col-lms-offline-api'),
            PHP_VERSION
        );
        echo '</p></div>';
    });
    return;
}

// Constantes du plugin
define('COL_LMS_API_VERSION', '1.2.0');
define('COL_LMS_API_PATH', plugin_dir_path(__FILE__));
define('COL_LMS_API_URL', plugin_dir_url(__FILE__));
define('COL_LMS_API_NAMESPACE', 'col-lms/v1');
define('COL_LMS_API_BASENAME', plugin_basename(__FILE__));
define('COL_LMS_API_FILE', __FILE__);
define('COL_LMS_API_MIN_WP_VERSION', '5.8');
define('COL_LMS_API_MIN_LP_VERSION', '4.0');

// Charger l'autoloader si disponible
if (file_exists(COL_LMS_API_PATH . 'vendor/autoload.php')) {
    require_once COL_LMS_API_PATH . 'vendor/autoload.php';
}

// Charger les classes requises
require_once COL_LMS_API_PATH . 'includes/class-migration.php';

// Gérer l'output pour les requêtes API uniquement
add_action('rest_api_init', function() {
    if (strpos($_SERVER['REQUEST_URI'] ?? '', '/wp-json/' . COL_LMS_API_NAMESPACE) !== false) {
        // Nettoyer l'output seulement pour nos endpoints
        ob_start();
        
        add_filter('rest_pre_serve_request', function($served, $result, $request, $server) {
            if (ob_get_level() && ob_get_length() > 0) {
                ob_clean();
            }
            return $served;
        }, 10, 4);
    }
}, 5);

/**
 * Classe principale du plugin COL LMS Offline API
 */
final class COL_LMS_Offline_API {
    
    private static $instance = null;
    private $namespace = COL_LMS_API_NAMESPACE;
    private $initialized = false;
    private $loaded_classes = array();
    private $config = array();
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->setup_constants();
        $this->includes();
        $this->init_hooks();
    }
    
    private function __clone() {}
    
    public function __wakeup() {
        throw new Exception(__('Impossible de désérialiser une instance de ', 'col-lms-offline-api') . __CLASS__);
    }
    
    private function setup_constants() {
        if (!defined('COL_LMS_API_ENV')) {
            define('COL_LMS_API_ENV', wp_get_environment_type());
        }
        
        if (!defined('COL_LMS_API_DEBUG')) {
            define('COL_LMS_API_DEBUG', defined('WP_DEBUG') && WP_DEBUG);
        }
        
        if (!defined('COL_LMS_REQUIRE_HTTPS')) {
            define('COL_LMS_REQUIRE_HTTPS', !COL_LMS_API_DEBUG);
        }
        
        if (!defined('COL_LMS_API_INCLUDES')) {
            define('COL_LMS_API_INCLUDES', COL_LMS_API_PATH . 'includes/');
        }
        
        if (!defined('COL_LMS_API_ADMIN')) {
            define('COL_LMS_API_ADMIN', COL_LMS_API_PATH . 'admin/');
        }
    }
    
    private function includes() {
        $includes = array(
            'includes/class-api.php',
            'includes/class-auth.php',
            'includes/class-courses.php',
            'includes/class-sync.php',
            'includes/class-packages.php',
            'includes/class-jwt.php',
            'includes/class-logger.php'
        );
        
        foreach ($includes as $file) {
            $file_path = COL_LMS_API_PATH . $file;
            if (file_exists($file_path)) {
                require_once $file_path;
                $this->loaded_classes[] = basename($file, '.php');
            } else {
                col_lms_log_error(sprintf(__('Fichier requis manquant : %s', 'col-lms-offline-api'), $file));
            }
        }
        
        if (is_admin()) {
            $admin_file = COL_LMS_API_PATH . 'admin/class-admin.php';
            if (file_exists($admin_file)) {
                require_once $admin_file;
                $this->loaded_classes[] = 'class-admin';
            } else {
                col_lms_log_error('Fichier admin manquant : admin/class-admin.php');
            }
        }
    }
    
    private function init_hooks() {
        add_action('init', array($this, 'init'), 0);
        add_action('rest_api_init', array($this, 'register_routes'));
        add_action('rest_api_init', array($this, 'init_rest_components'), 5);
        add_action('plugins_loaded', array($this, 'load_textdomain'));
        
        register_activation_hook(COL_LMS_API_FILE, array($this, 'activate'));
        register_deactivation_hook(COL_LMS_API_FILE, array($this, 'deactivate'));
        
        add_action('col_lms_cleanup_tokens', array($this, 'cleanup_expired_tokens'));
        add_action('col_lms_create_package', array($this, 'create_package_handler'));
        add_action('col_lms_cleanup_packages', array($this, 'cleanup_old_packages'));
        
        add_action('wp_login_failed', array($this, 'handle_failed_login'));
        add_action('wp_logout', array($this, 'handle_logout'));
        
        add_action('upgrader_process_complete', array($this, 'handle_plugin_update'), 10, 2);
        
        add_filter('determine_current_user', array($this, 'determine_current_user'), 20);
        add_filter('rest_pre_dispatch', array($this, 'rest_pre_dispatch'), 10, 3);
        
        add_action('init', array($this, 'handle_secure_downloads'));
        
        if (is_admin()) {
            add_action('wp_ajax_col_lms_dismiss_notice', array($this, 'ajax_dismiss_notice'));
        }
    }
    
    public function init() {
        if ($this->initialized) {
            return;
        }
        
        if (!$this->check_compatibility()) {
            return;
        }
        
        $this->load_config();
        $this->init_components();
        $this->schedule_events();
        
        $this->initialized = true;
        
        do_action('col_lms_api_loaded', $this);
        
        if (COL_LMS_API_DEBUG) {
            col_lms_log_error('Plugin initialisé avec succès', array(
                'version' => COL_LMS_API_VERSION,
                'loaded_classes' => $this->loaded_classes
            ));
        }
    }
    
    public function init_rest_components() {
        if (!$this->is_api_enabled()) {
            return;
        }
        
        if (!class_exists('LearnPress')) {
            return;
        }
        
        $components = array(
            'COL_LMS_Auth',
            'COL_LMS_Courses',
            'COL_LMS_Sync',
            'COL_LMS_Packages',
            'COL_LMS_API'
        );
        
        foreach ($components as $component) {
            if (class_exists($component)) {
                $component::instance();
            }
        }
        
        do_action('col_lms_rest_components_loaded', $this);
    }
    
    private function check_compatibility() {
        $errors = array();
        
        if (version_compare(get_bloginfo('version'), COL_LMS_API_MIN_WP_VERSION, '<')) {
            $errors[] = sprintf(
                __('WordPress %s ou supérieur requis. Version actuelle : %s', 'col-lms-offline-api'),
                COL_LMS_API_MIN_WP_VERSION,
                get_bloginfo('version')
            );
        }
        
        if (!class_exists('LearnPress')) {
            $errors[] = __('LearnPress doit être installé et activé.', 'col-lms-offline-api');
        }
        
        $required_extensions = array('json', 'openssl', 'curl');
        foreach ($required_extensions as $extension) {
            if (!extension_loaded($extension)) {
                $errors[] = sprintf(__('Extension PHP manquante : %s', 'col-lms-offline-api'), $extension);
            }
        }
        
        if (!empty($errors)) {
            add_action('admin_notices', function() use ($errors) {
                foreach ($errors as $error) {
                    echo '<div class="notice notice-error"><p><strong>COL LMS API:</strong> ' . esc_html($error) . '</p></div>';
                }
            });
            return false;
        }
        
        return true;
    }
    
    private function load_config() {
        $defaults = array(
            'api_enabled' => true,
            'require_membership' => false,
            'token_lifetime' => 3600,
            'max_devices_per_user' => 5,
            'enable_rate_limiting' => true,
            'rate_limit_requests' => 100,
            'rate_limit_window' => 3600,
            'enable_logging' => true,
            'log_level' => 'info',
            'package_expiry_hours' => 24,
            'max_package_size' => 2147483648,
            'enable_encryption' => true
        );
        
        $this->config = wp_parse_args(get_option('col_lms_api_config', array()), $defaults);
        $this->config = apply_filters('col_lms_api_config', $this->config);
    }
    
    private function init_components() {
        do_action('col_lms_init_components', $this);
    }
    
    private function schedule_events() {
        $events = array(
            'col_lms_cleanup_tokens' => 'hourly',
            'col_lms_cleanup_packages' => 'daily',
            'col_lms_cleanup_logs' => 'daily',
            'col_lms_generate_stats' => 'weekly'
        );
        
        foreach ($events as $hook => $schedule) {
            if (!wp_next_scheduled($hook)) {
                wp_schedule_event(time(), $schedule, $hook);
            }
        }
    }
    
    public function load_textdomain() {
        load_plugin_textdomain(
            'col-lms-offline-api',
            false,
            dirname(COL_LMS_API_BASENAME) . '/languages/'
        );
    }
    
    public function register_routes() {
        if (!$this->is_api_enabled()) {
            return;
        }
        
        register_rest_route($this->namespace, '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'api_status'),
            'permission_callback' => '__return_true'
        ));
        
        register_rest_route($this->namespace, '/health', array(
            'methods' => 'GET',
            'callback' => array($this, 'health_check'),
            'permission_callback' => array($this, 'check_admin_permission')
        ));
        
        do_action('col_lms_register_routes', $this->namespace);
    }
    
    public function api_status($request) {
        return array(
            'status' => 'active',
            'version' => COL_LMS_API_VERSION,
            'namespace' => $this->namespace,
            'server_time' => current_time('mysql'),
            'timezone' => wp_timezone_string(),
            'endpoints' => array(
                'auth' => rest_url($this->namespace . '/auth'),
                'courses' => rest_url($this->namespace . '/courses'),
                'sync' => rest_url($this->namespace . '/sync'),
                'packages' => rest_url($this->namespace . '/packages')
            ),
            'requirements' => array(
                'wordpress' => array(
                    'version' => get_bloginfo('version'),
                    'multisite' => is_multisite()
                ),
                'learnpress' => array(
                    'active' => class_exists('LearnPress'),
                    'version' => defined('LP_PLUGIN_VERSION') ? LP_PLUGIN_VERSION : 'unknown'
                ),
                'pmpro' => array(
                    'active' => function_exists('pmpro_hasMembershipLevel'),
                    'version' => defined('PMPRO_VERSION') ? PMPRO_VERSION : 'unknown'
                )
            )
        );
    }
    
    public function health_check($request) {
        if (!current_user_can('manage_options')) {
            return new WP_Error('insufficient_permissions', __('Permissions insuffisantes.', 'col-lms-offline-api'));
        }
        
        global $wpdb;
        
        $health = array(
            'status' => 'healthy',
            'checks' => array(),
            'timestamp' => current_time('mysql')
        );
        
        // Vérifier si les tables existent
        $tables_exist = true;
        $required_tables = array('col_lms_tokens', 'col_lms_packages', 'col_lms_logs');
        
        foreach ($required_tables as $table) {
            $table_name = $wpdb->prefix . $table;
            if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
                $tables_exist = false;
                break;
            }
        }
        
        $health['checks']['database'] = array(
            'status' => $tables_exist ? 'pass' : 'fail',
            'message' => $tables_exist ? 'Tables de base de données OK' : 'Tables manquantes - Réactivez le plugin'
        );
        
        $upload_dir = wp_upload_dir();
        $packages_dir = $upload_dir['basedir'] . '/col-lms-packages';
        
        $health['checks']['file_permissions'] = array(
            'status' => (is_dir($packages_dir) && is_writable($packages_dir)) ? 'pass' : 'warning',
            'message' => (is_dir($packages_dir) && is_writable($packages_dir)) ? 'Permissions fichiers OK' : 'Dossier packages manquant ou non accessible'
        );
        
        $next_cleanup = wp_next_scheduled('col_lms_cleanup_tokens');
        $health['checks']['cron'] = array(
            'status' => $next_cleanup ? 'pass' : 'fail',
            'message' => $next_cleanup ? 'Tâches CRON programmées' : 'Tâches CRON non programmées',
            'next_cleanup' => $next_cleanup ? date('Y-m-d H:i:s', $next_cleanup) : null
        );
        
        $failing_checks = array_filter($health['checks'], function($check) {
            return $check['status'] === 'fail';
        });
        
        if (!empty($failing_checks)) {
            $health['status'] = 'degraded';
        }
        
        return $health;
    }
    
    public function activate() {
        if (!class_exists('LearnPress')) {
            deactivate_plugins(COL_LMS_API_BASENAME);
            wp_die(__('COL LMS Offline API nécessite LearnPress pour fonctionner.', 'col-lms-offline-api'));
        }
        
        if (class_exists('COL_LMS_Migration')) {
            COL_LMS_Migration::instance()->run();
        }
        
        $this->schedule_events();
        
        flush_rewrite_rules();
        
        update_option('col_lms_api_version', COL_LMS_API_VERSION);
        update_option('col_lms_api_activated_time', current_time('mysql'));
        
        do_action('col_lms_api_activated');
    }
    
    public function deactivate() {
        $hooks = array(
            'col_lms_cleanup_tokens',
            'col_lms_cleanup_packages',
            'col_lms_cleanup_logs',
            'col_lms_generate_stats'
        );
        
        foreach ($hooks as $hook) {
            wp_clear_scheduled_hook($hook);
        }
        
        flush_rewrite_rules();
        
        do_action('col_lms_api_deactivated');
    }
    
    public function cleanup_expired_tokens() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name) {
            $deleted = $wpdb->query("DELETE FROM $table_name WHERE expires_at < NOW()");
            
            if ($deleted > 0 && class_exists('COL_LMS_Logger')) {
                COL_LMS_Logger::info('Tokens expirés nettoyés', array('count' => $deleted));
            }
        }
    }
    
    public function cleanup_old_packages() {
        if (class_exists('COL_LMS_Packages')) {
            COL_LMS_Packages::instance()->cleanup_old_packages();
        }
    }
    
    public function create_package_handler($package_id) {
        if (class_exists('COL_LMS_Packages')) {
            COL_LMS_Packages::instance()->process_package($package_id);
        }
    }
    
    public function handle_secure_downloads() {
        if (isset($_GET['col_lms_download']) && !empty($_GET['col_lms_download'])) {
            if (class_exists('COL_LMS_Packages')) {
                COL_LMS_Packages::instance()->handle_download();
            }
        }
    }
    
    public function handle_failed_login($username) {
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::warning('Tentative de connexion échouée', array(
                'username' => $username,
                'ip' => $this->get_client_ip()
            ));
        }
    }
    
    public function handle_logout($user_id) {
        if ($this->get_config('logout_revoke_tokens')) {
            global $wpdb;
            $table_name = $wpdb->prefix . 'col_lms_tokens';
            
            if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name) {
                $wpdb->delete($table_name, array('user_id' => $user_id), array('%d'));
            }
        }
    }
    
    public function handle_plugin_update($upgrader, $hook_extra) {
        if (isset($hook_extra['plugins']) && in_array(COL_LMS_API_BASENAME, $hook_extra['plugins'])) {
            if (class_exists('COL_LMS_Migration')) {
                COL_LMS_Migration::instance()->check_version();
            }
        }
    }
    
    public function determine_current_user($user_id) {
        if (!defined('REST_REQUEST') || !REST_REQUEST) {
            return $user_id;
        }
        
        $request_uri = $_SERVER['REQUEST_URI'] ?? '';
        if (strpos($request_uri, '/wp-json/' . $this->namespace) === false) {
            return $user_id;
        }
        
        return $user_id;
    }
    
    public function rest_pre_dispatch($result, $server, $request) {
        $route = $request->get_route();
        if (strpos($route, '/' . $this->namespace) !== 0) {
            return $result;
        }
        
        if (!$this->is_api_enabled()) {
            return new WP_Error(
                'api_disabled',
                __('API temporairement désactivée.', 'col-lms-offline-api'),
                array('status' => 503)
            );
        }
        
        if (COL_LMS_API_DEBUG) {
            col_lms_log_error('Requête API', array(
                'route' => $route,
                'method' => $request->get_method(),
                'ip' => $this->get_client_ip()
            ));
        }
        
        return $result;
    }
    
    public function ajax_dismiss_notice() {
        if (!wp_verify_nonce($_POST['_wpnonce'] ?? '', 'col_lms_dismiss_notice')) {
            wp_die(__('Nonce invalide', 'col-lms-offline-api'));
        }
        
        $notice = sanitize_text_field($_POST['notice'] ?? '');
        if ($notice === 'pmpro') {
            update_user_meta(get_current_user_id(), 'col_lms_pmpro_notice_dismissed', true);
        }
        
        wp_die();
    }
    
    public function is_api_enabled() {
        return (bool) get_option('col_lms_api_enabled', true);
    }
    
    public function check_admin_permission($request) {
        return current_user_can('manage_options');
    }
    
    public function get_config($key, $default = null) {
        return isset($this->config[$key]) ? $this->config[$key] : $default;
    }
    
    public function set_config($key, $value) {
        $this->config[$key] = $value;
        update_option('col_lms_api_config', $this->config);
    }
    
    private function get_client_ip() {
        $ip_headers = array(
            'HTTP_CF_CONNECTING_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR'
        );
        
        foreach ($ip_headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ip = $_SERVER[$header];
                if (strpos($ip, ',') !== false) {
                    $ip = trim(explode(',', $ip)[0]);
                }
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    return $ip;
                }
            }
        }
        
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
}

// Initialiser le plugin
function col_lms_offline_api_init() {
    return COL_LMS_Offline_API::instance();
}

add_action('plugins_loaded', 'col_lms_offline_api_init', 10);

// Fonctions utilitaires globales
function col_lms_api() {
    return COL_LMS_Offline_API::instance();
}

function col_lms_api_is_available() {
    return col_lms_api()->is_api_enabled();
}

function col_lms_get_config($key, $default = null) {
    return col_lms_api()->get_config($key, $default);
}

// Hook de vérification de compatibilité
add_action('plugins_loaded', function() {
    if (!class_exists('LearnPress')) {
        add_action('admin_notices', function() {
            ?>
            <div class="notice notice-error">
                <p><?php _e('COL LMS Offline API nécessite LearnPress pour fonctionner. Veuillez installer et activer LearnPress.', 'col-lms-offline-api'); ?></p>
            </div>
            <?php
        });
    }
}, 11);
