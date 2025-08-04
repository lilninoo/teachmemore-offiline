<?php
/**
 * Gestion des tokens JWT
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_JWT {
    
    private static $instance = null;
    private $secret_key;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->secret_key = $this->get_secret_key();
    }
    
    /**
     * Obtenir la clé secrète
     */
    private function get_secret_key() {
        $key = get_option('col_lms_jwt_secret');
        
        if (!$key) {
            $key = wp_generate_password(64, true, true);
            update_option('col_lms_jwt_secret', $key);
        }
        
        return $key;
    }
    
    /**
     * Créer un token
     */
    public function create_token($user_id, $device_id, $expiry = 3600) {
        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        
        $payload = json_encode([
            'iss' => get_site_url(),
            'aud' => 'col-lms-offline',
            'iat' => time(),
            'exp' => time() + $expiry,
            'user_id' => $user_id,
            'device_id' => $device_id,
            'nonce' => wp_generate_password(12, false)
        ]);
        
        $base64_header = $this->base64url_encode($header);
        $base64_payload = $this->base64url_encode($payload);
        
        $signature = hash_hmac(
            'sha256', 
            $base64_header . '.' . $base64_payload, 
            $this->secret_key, 
            true
        );
        
        $base64_signature = $this->base64url_encode($signature);
        
        return $base64_header . '.' . $base64_payload . '.' . $base64_signature;
    }
    
    /**
     * Valider un token
     */
    public function validate_token($token) {
        $parts = explode('.', $token);
        
        if (count($parts) !== 3) {
            return false;
        }
        
        list($header, $payload, $signature) = $parts;
        
        // Vérifier la signature
        $expected_signature = $this->base64url_encode(hash_hmac(
            'sha256', 
            $header . '.' . $payload, 
            $this->secret_key, 
            true
        ));
        
        if ($signature !== $expected_signature) {
            return false;
        }
        
        // Décoder le payload
        $payload_data = json_decode($this->base64url_decode($payload), true);
        
        // Vérifier l'expiration
        if (!isset($payload_data['exp']) || $payload_data['exp'] < time()) {
            return false;
        }
        
        // Vérifier l'émetteur
        if (!isset($payload_data['iss']) || $payload_data['iss'] !== get_site_url()) {
            return false;
        }
        
        return $payload_data;
    }
    
    /**
     * Créer un refresh token
     */
    public function create_refresh_token($user_id, $device_id) {
        return wp_hash($user_id . $device_id . wp_generate_password(32, true, true) . time());
    }
    
    /**
     * Base64 URL encode
     */
    private function base64url_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
    
    /**
     * Base64 URL decode
     */
    private function base64url_decode($data) {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
