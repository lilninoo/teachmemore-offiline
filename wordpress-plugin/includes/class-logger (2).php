<?php
/**
 * Système de logs pour COL LMS Offline API
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Logger {
    
    private static $instance = null;
    
    /**
     * Niveaux de log
     */
    const LEVEL_DEBUG = 100;
    const LEVEL_INFO = 200;
    const LEVEL_WARNING = 300;
    const LEVEL_ERROR = 400;
    const LEVEL_CRITICAL = 500;
    
    /**
     * Actions importantes à toujours logger
     */
    private static $critical_actions = array(
        'login',
        'failed_login',
        'logout',
        'create_package',
        'download_file',
        'sync_progress',
        'revoke_device',
        'api_error'
    );
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        // Hook pour nettoyer les logs automatiquement
        add_action('col_lms_cleanup_logs', array($this, 'cleanup_old_logs'));
        
        // Programmer le nettoyage si pas déjà fait
        if (!wp_next_scheduled('col_lms_cleanup_logs')) {
            wp_schedule_event(time(), 'daily', 'col_lms_cleanup_logs');
        }
    }
    
    /**
     * Logger une action
     */
    public static function log($action, $details = array(), $level = self::LEVEL_INFO) {
        global $wpdb;
        
        // Vérifier si on doit logger cette action
        if (!self::should_log($action, $level)) {
            return false;
        }
        
        $user_id = get_current_user_id();
        $ip_address = self::get_client_ip();
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
        
        // Enrichir les détails avec des infos contextuelles
        $enriched_details = array_merge($details, array(
            'level' => $level,
            'level_name' => self::get_level_name($level),
            'timestamp' => time(),
            'memory_usage' => memory_get_usage(true),
            'request_uri' => $_SERVER['REQUEST_URI'] ?? '',
            'request_method' => $_SERVER['REQUEST_METHOD'] ?? ''
        ));
        
        // Nettoyer les données sensibles
        $enriched_details = self::sanitize_log_data($enriched_details);
        
        $result = $wpdb->insert(
            $wpdb->prefix . 'col_lms_logs',
            array(
                'user_id' => $user_id ?: null,
                'action' => $action,
                'details' => wp_json_encode($enriched_details),
                'ip_address' => $ip_address,
                'user_agent' => $user_agent,
                'created_at' => current_time('mysql')
            )
        );
        
        // Si c'est une erreur critique, notifier
        if ($level >= self::LEVEL_ERROR) {
            self::handle_critical_log($action, $enriched_details);
        }
        
        return $result !== false;
    }
    
    /**
     * Logger un debug
     */
    public static function debug($message, $details = array()) {
        return self::log('debug', array_merge(array('message' => $message), $details), self::LEVEL_DEBUG);
    }
    
    /**
     * Logger une info
     */
    public static function info($message, $details = array()) {
        return self::log('info', array_merge(array('message' => $message), $details), self::LEVEL_INFO);
    }
    
    /**
     * Logger un warning
     */
    public static function warning($message, $details = array()) {
        return self::log('warning', array_merge(array('message' => $message), $details), self::LEVEL_WARNING);
    }
    
    /**
     * Logger une erreur
     */
    public static function error($message, $details = array()) {
        return self::log('error', array_merge(array('message' => $message), $details), self::LEVEL_ERROR);
    }
    
    /**
     * Logger une erreur critique
     */
    public static function critical($message, $details = array()) {
        return self::log('critical', array_merge(array('message' => $message), $details), self::LEVEL_CRITICAL);
    }
    
    /**
     * Logger une exception
     */
    public static function log_exception($exception, $action = 'exception') {
        $details = array(
            'message' => $exception->getMessage(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => $exception->getTraceAsString(),
            'code' => $exception->getCode()
        );
        
        return self::log($action, $details, self::LEVEL_ERROR);
    }
    
    /**
     * Obtenir les logs avec filtres
     */
    public static function get_logs($args = array()) {
        global $wpdb;
        
        $defaults = array(
            'user_id' => null,
            'action' => null,
            'level' => null,
            'since' => null,
            'until' => null,
            'limit' => 100,
            'offset' => 0,
            'orderby' => 'created_at',
            'order' => 'DESC'
        );
        
        $args = wp_parse_args($args, $defaults);
        
        $where_conditions = array('1=1');
        $where_values = array();
        
        if ($args['user_id']) {
            $where_conditions[] = 'user_id = %d';
            $where_values[] = $args['user_id'];
        }
        
        if ($args['action']) {
            $where_conditions[] = 'action = %s';
            $where_values[] = $args['action'];
        }
        
        if ($args['since']) {
            $where_conditions[] = 'created_at >= %s';
            $where_values[] = $args['since'];
        }
        
        if ($args['until']) {
            $where_conditions[] = 'created_at <= %s';
            $where_values[] = $args['until'];
        }
        
        $where_clause = implode(' AND ', $where_conditions);
        $order_clause = sprintf('ORDER BY %s %s', $args['orderby'], $args['order']);
        $limit_clause = sprintf('LIMIT %d OFFSET %d', $args['limit'], $args['offset']);
        
        $query = "SELECT * FROM {$wpdb->prefix}col_lms_logs WHERE {$where_clause} {$order_clause} {$limit_clause}";
        
        if (!empty($where_values)) {
            $query = $wpdb->prepare($query, $where_values);
        }
        
        $logs = $wpdb->get_results($query);
        
        // Décoder les détails JSON
        foreach ($logs as &$log) {
            $log->details = json_decode($log->details, true);
        }
        
        return $logs;
    }
    
    /**
     * Obtenir les statistiques de logs
     */
    public static function get_stats($period = '24 HOUR') {
        global $wpdb;
        
        $stats = array();
        
        // Total par action
        $stats['by_action'] = $wpdb->get_results($wpdb->prepare("
            SELECT action, COUNT(*) as count
            FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s)
            GROUP BY action
            ORDER BY count DESC
        ", $period));
        
        // Total par utilisateur
        $stats['by_user'] = $wpdb->get_results($wpdb->prepare("
            SELECT user_id, COUNT(*) as count
            FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s)
            AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY count DESC
            LIMIT 10
        ", $period));
        
        // Erreurs récentes
        $stats['recent_errors'] = $wpdb->get_results($wpdb->prepare("
            SELECT action, details, created_at
            FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s)
            AND (action LIKE '%%error%%' OR action LIKE '%%failed%%')
            ORDER BY created_at DESC
            LIMIT 10
        ", $period));
        
        // Activité par heure
        $stats['hourly_activity'] = $wpdb->get_results($wpdb->prepare("
            SELECT HOUR(created_at) as hour, COUNT(*) as count
            FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s)
            GROUP BY HOUR(created_at)
            ORDER BY hour
        ", $period));
        
        return $stats;
    }
    
    /**
     * Nettoyer les vieux logs
     */
    public function cleanup_old_logs($force = false) {
        global $wpdb;
        
        // Nettoyer une fois par jour seulement, sauf si forcé
        if (!$force) {
            $last_cleanup = get_transient('col_lms_logs_cleanup');
            if ($last_cleanup) {
                return;
            }
        }
        
        $retention_days = get_option('col_lms_log_retention_days', 30);
        
        $deleted = $wpdb->query($wpdb->prepare("
            DELETE FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)
        ", $retention_days));
        
        // Garder toujours les logs critiques plus longtemps
        $critical_retention = $retention_days * 3; // 3x plus longtemps
        
        $wpdb->query($wpdb->prepare("
            DELETE FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)
            AND action NOT IN ('" . implode("','", self::$critical_actions) . "')
        ", $critical_retention));
        
        set_transient('col_lms_logs_cleanup', true, DAY_IN_SECONDS);
        
        self::info('Nettoyage des logs effectué', array(
            'deleted_logs' => $deleted,
            'retention_days' => $retention_days
        ));
        
        return $deleted;
    }
    
    /**
     * Exporter les logs
     */
    public static function export_logs($format = 'csv', $args = array()) {
        $logs = self::get_logs($args);
        
        switch ($format) {
            case 'csv':
                return self::export_to_csv($logs);
            case 'json':
                return wp_json_encode($logs);
            default:
                return false;
        }
    }
    
    /**
     * Vérifier si on doit logger cette action
     */
    private static function should_log($action, $level) {
        // Toujours logger les actions critiques
        if (in_array($action, self::$critical_actions)) {
            return true;
        }
        
        // Vérifier le niveau de log minimum
        $min_level = get_option('col_lms_min_log_level', self::LEVEL_INFO);
        if ($level < $min_level) {
            return false;
        }
        
        // En mode debug, tout logger
        if (defined('WP_DEBUG') && WP_DEBUG) {
            return true;
        }
        
        return true;
    }
    
    /**
     * Obtenir l'IP du client
     */
    private static function get_client_ip() {
        $ip_headers = array(
            'HTTP_CF_CONNECTING_IP',     // Cloudflare
            'HTTP_X_FORWARDED_FOR',      // Proxy
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR'                // Standard
        );
        
        foreach ($ip_headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ip = $_SERVER[$header];
                
                // Si multiple IPs, prendre la première
                if (strpos($ip, ',') !== false) {
                    $ip = trim(explode(',', $ip)[0]);
                }
                
                // Valider l'IP
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    return $ip;
                }
            }
        }
        
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
    
    /**
     * Nettoyer les données sensibles des logs
     */
    private static function sanitize_log_data($data) {
        $sensitive_keys = array(
            'password',
            'token',
            'refresh_token',
            'secret',
            'key',
            'authorization',
            'cookie'
        );
        
        foreach ($data as $key => $value) {
            if (is_string($key)) {
                $key_lower = strtolower($key);
                foreach ($sensitive_keys as $sensitive) {
                    if (strpos($key_lower, $sensitive) !== false) {
                        $data[$key] = '[REDACTED]';
                        break;
                    }
                }
            }
            
            if (is_array($value)) {
                $data[$key] = self::sanitize_log_data($value);
            }
        }
        
        return $data;
    }
    
    /**
     * Obtenir le nom du niveau
     */
    private static function get_level_name($level) {
        $levels = array(
            self::LEVEL_DEBUG => 'DEBUG',
            self::LEVEL_INFO => 'INFO',
            self::LEVEL_WARNING => 'WARNING',
            self::LEVEL_ERROR => 'ERROR',
            self::LEVEL_CRITICAL => 'CRITICAL'
        );
        
        return $levels[$level] ?? 'UNKNOWN';
    }
    
    /**
     * Gérer les logs critiques
     */
    private static function handle_critical_log($action, $details) {
        // Notifier les admins en cas d'erreur critique
        if (get_option('col_lms_notify_on_errors', false)) {
            $admin_email = get_option('admin_email');
            
            $subject = sprintf(
                '[%s] Erreur API COL LMS - %s',
                get_bloginfo('name'),
                $action
            );
            
            $message = sprintf(
                "Une erreur critique s'est produite dans l'API COL LMS :\n\n" .
                "Action: %s\n" .
                "Heure: %s\n" .
                "Détails: %s\n\n" .
                "Vérifiez les logs pour plus d'informations.",
                $action,
                current_time('mysql'),
                wp_json_encode($details, JSON_PRETTY_PRINT)
            );
            
            wp_mail($admin_email, $subject, $message);
        }
        
        // Logger dans le fichier d'erreur WordPress si disponible
        if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
            error_log(sprintf(
                '[COL LMS API] %s: %s',
                $action,
                wp_json_encode($details)
            ));
        }
    }
    
    /**
     * Exporter vers CSV
     */
    private static function export_to_csv($logs) {
        $output = fopen('php://temp', 'r+');
        
        // Headers
        fputcsv($output, array('ID', 'User ID', 'Action', 'IP', 'Created At', 'Details'));
        
        foreach ($logs as $log) {
            fputcsv($output, array(
                $log->id,
                $log->user_id,
                $log->action,
                $log->ip_address,
                $log->created_at,
                is_array($log->details) ? wp_json_encode($log->details) : $log->details
            ));
        }
        
        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);
        
        return $csv;
    }
}
