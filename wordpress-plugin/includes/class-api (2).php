<?php
/**
 * Classe de base pour l'API
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Classe de base abstraite pour les endpoints API
 */
abstract class COL_LMS_API_Base {
    
    protected $namespace = COL_LMS_API_NAMESPACE;
    
    /**
     * Obtenir l'utilisateur actuel depuis le token
     */
    protected function get_current_user_id() {
        $auth_header = $this->get_auth_header();
        
        if (!$auth_header || strpos($auth_header, 'Bearer ') !== 0) {
            return false;
        }
        
        $token = substr($auth_header, 7);
        $payload = COL_LMS_JWT::instance()->validate_token($token);
        
        if (!$payload) {
            return false;
        }
        
        // Vérifier que le token existe en base
        global $wpdb;
        $exists = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}col_lms_tokens 
            WHERE user_id = %d 
            AND device_id = %s 
            AND token_hash = %s 
            AND expires_at > NOW()
        ", $payload['user_id'], $payload['device_id'], wp_hash($token)));
        
        if (!$exists) {
            return false;
        }
        
        // Mettre à jour la dernière utilisation
        $wpdb->update(
            $wpdb->prefix . 'col_lms_tokens',
            ['last_used' => current_time('mysql')],
            [
                'user_id' => $payload['user_id'],
                'device_id' => $payload['device_id']
            ]
        );
        
        return $payload['user_id'];
    }
    
    /**
     * Obtenir le header d'autorisation
     */
    protected function get_auth_header() {
        // Méthode 1: Headers Apache
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if (isset($headers['Authorization'])) {
                return $headers['Authorization'];
            }
            if (isset($headers['authorization'])) {
                return $headers['authorization'];
            }
        }
        
        // Méthode 2: Variables serveur
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            return $_SERVER['HTTP_AUTHORIZATION'];
        }
        
        // Méthode 3: Redirection Apache
        if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        
        return false;
    }
    
    /**
     * Vérifier l'authentification
     */
    public function check_auth($request) {
        if (!get_option('col_lms_api_enabled')) {
            return new WP_Error(
                'api_disabled',
                __('API temporairement désactivée.', 'col-lms-offline-api'),
                array('status' => 503)
            );
        }
        
        return $this->get_current_user_id() !== false;
    }
    
    /**
     * Vérifier les permissions
     */
    protected function check_permission($capability = 'col_lms_use_api') {
        $user_id = $this->get_current_user_id();
        
        if (!$user_id) {
            return false;
        }
        
        return user_can($user_id, $capability);
    }
    
    /**
     * Réponse d'erreur standard
     */
    protected function error_response($code, $message, $status = 400) {
        return new WP_Error($code, $message, array('status' => $status));
    }
    
    /**
     * Logger une action
     */
    protected function log_action($action, $data = array()) {
        $user_id = $this->get_current_user_id();
        
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::log($action, array_merge($data, [
                'user_id' => $user_id,
                'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
                'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? ''
            ]));
        }
    }
    
    /**
     * Vérifier le rate limiting
     */
    protected function check_rate_limit($identifier = null) {
        if (!get_option('col_lms_enable_rate_limiting')) {
            return true;
        }
        
        $max_requests = get_option('col_lms_rate_limit_requests', 100);
        $window = get_option('col_lms_rate_limit_window', 3600);
        
        if (!$identifier) {
            $identifier = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        }
        
        $key = 'col_lms_rate_limit_' . md5($identifier);
        $current_requests = get_transient($key) ?: 0;
        
        if ($current_requests >= $max_requests) {
            return false;
        }
        
        set_transient($key, $current_requests + 1, $window);
        return true;
    }
}

/**
 * Classe principale de l'API
 */
class COL_LMS_API extends COL_LMS_API_Base {
    
    private static $instance = null;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('rest_api_init', array($this, 'register_routes'));
    }
    
    /**
     * Enregistrer les routes générales
     */
    public function register_routes() {
        // Route de test
        register_rest_route($this->namespace, '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_status'),
            'permission_callback' => '__return_true'
        ));
        
        // Route de vérification avec auth
        register_rest_route($this->namespace, '/verify', array(
            'methods' => 'GET',
            'callback' => array($this, 'verify_access'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Route d'information système
        register_rest_route($this->namespace, '/info', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_system_info'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Obtenir le statut de l'API
     */
    public function get_status($request) {
        $enabled = get_option('col_lms_api_enabled', true);
        
        return array(
            'status' => $enabled ? 'active' : 'disabled',
            'version' => COL_LMS_API_VERSION,
            'server_time' => current_time('mysql'),
            'endpoints' => array(
                'auth' => home_url('/wp-json/' . $this->namespace . '/auth'),
                'courses' => home_url('/wp-json/' . $this->namespace . '/courses'),
                'sync' => home_url('/wp-json/' . $this->namespace . '/sync'),
                'packages' => home_url('/wp-json/' . $this->namespace . '/packages')
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
    
    /**
     * Vérifier l'accès
     */
    public function verify_access($request) {
        $user_id = $this->get_current_user_id();
        $user = get_userdata($user_id);
        
        if (!$user) {
            return $this->error_response(
                'user_not_found',
                __('Utilisateur non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        return array(
            'success' => true,
            'user' => array(
                'id' => $user->ID,
                'username' => $user->user_login,
                'email' => $user->user_email,
                'display_name' => $user->display_name,
                'roles' => $user->roles,
                'capabilities' => array(
                    'col_lms_use_api' => user_can($user, 'col_lms_use_api'),
                    'col_lms_download_courses' => user_can($user, 'col_lms_download_courses'),
                    'col_lms_sync_progress' => user_can($user, 'col_lms_sync_progress')
                )
            ),
            'server_time' => current_time('mysql')
        );
    }
    
    /**
     * Obtenir les informations système
     */
    public function get_system_info($request) {
        global $wpdb;
        
        // Vérifier les permissions admin
        $user_id = $this->get_current_user_id();
        if (!user_can($user_id, 'manage_options')) {
            return $this->error_response(
                'insufficient_permissions',
                __('Permissions insuffisantes.', 'col-lms-offline-api'),
                403
            );
        }
        
        return array(
            'database' => array(
                'version' => $wpdb->db_version(),
                'charset' => $wpdb->charset,
                'collate' => $wpdb->collate
            ),
            'server' => array(
                'php_version' => PHP_VERSION,
                'memory_limit' => ini_get('memory_limit'),
                'max_execution_time' => ini_get('max_execution_time'),
                'upload_max_filesize' => ini_get('upload_max_filesize'),
                'post_max_size' => ini_get('post_max_size')
            ),
            'plugin_options' => array(
                'api_enabled' => get_option('col_lms_api_enabled'),
                'require_membership' => get_option('col_lms_require_membership'),
                'token_lifetime' => get_option('col_lms_token_lifetime'),
                'max_devices_per_user' => get_option('col_lms_max_devices_per_user'),
                'enable_rate_limiting' => get_option('col_lms_enable_rate_limiting'),
                'enable_course_packages' => get_option('col_lms_enable_course_packages')
            ),
            'statistics' => array(
                'active_tokens' => $wpdb->get_var("
                    SELECT COUNT(*) FROM {$wpdb->prefix}col_lms_tokens 
                    WHERE expires_at > NOW()
                "),
                'total_packages' => $wpdb->get_var("
                    SELECT COUNT(*) FROM {$wpdb->prefix}col_lms_packages
                "),
                'completed_packages' => $wpdb->get_var("
                    SELECT COUNT(*) FROM {$wpdb->prefix}col_lms_packages 
                    WHERE status = 'completed'
                ")
            )
        );
    }
}