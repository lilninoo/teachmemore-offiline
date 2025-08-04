<?php
/**
 * Gestion des packages de cours pour l'API COL LMS
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Packages extends COL_LMS_API_Base {
    
    private static $instance = null;
    
    /**
     * Statuts des packages
     */
    const STATUS_PENDING = 'pending';
    const STATUS_PROCESSING = 'processing';
    const STATUS_COMPLETED = 'completed';
    const STATUS_ERROR = 'error';
    const STATUS_CANCELLED = 'cancelled';
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('rest_api_init', array($this, 'register_routes'));
        $this->init_package_hooks();
    }
    
    /**
     * Initialiser les hooks spécifiques aux packages
     */
    private function init_package_hooks() {
        // Hook pour traiter les packages
        add_action('col_lms_process_package', array($this, 'process_package'));
        
        // Nettoyage automatique
        add_action('col_lms_cleanup_packages', array($this, 'cleanup_old_packages'));
        
        if (!wp_next_scheduled('col_lms_cleanup_packages')) {
            wp_schedule_event(time(), 'daily', 'col_lms_cleanup_packages');
        }
    }
    
    /**
     * Enregistrer les routes
     */
    public function register_routes() {
        // Statut d'un package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_package_status'),
            'permission_callback' => array($this, 'check_package_access'),
            'args' => array(
                'id' => array(
                    'validate_callback' => function($param) {
                        return preg_match('/^[a-zA-Z0-9-]+$/', $param);
                    }
                )
            )
        ));
        
        // Télécharger un package complet
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/download', array(
            'methods' => 'GET',
            'callback' => array($this, 'download_package'),
            'permission_callback' => array($this, 'check_package_access')
        ));
        
        // Télécharger un fichier spécifique du package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/files/(?P<file>[^/]+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'download_package_file'),
            'permission_callback' => array($this, 'check_package_access'),
            'args' => array(
                'file' => array(
                    'sanitize_callback' => 'sanitize_file_name'
                )
            )
        ));
        
        // Annuler un package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/cancel', array(
            'methods' => 'POST',
            'callback' => array($this, 'cancel_package'),
            'permission_callback' => array($this, 'check_package_access')
        ));
        
        // Liste des packages d'un utilisateur
        register_rest_route($this->namespace, '/packages', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_user_packages'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'status' => array(
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return in_array($param, array('pending', 'processing', 'completed', 'error', 'cancelled'));
                    }
                ),
                'course_id' => array(
                    'sanitize_callback' => 'absint'
                ),
                'limit' => array(
                    'sanitize_callback' => 'absint',
                    'default' => 20
                )
            )
        ));
        
        // Supprimer un package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)', array(
            'methods' => 'DELETE',
            'callback' => array($this, 'delete_package'),
            'permission_callback' => array($this, 'check_package_access')
        ));
        
        // Créer un package depuis un manifeste
        register_rest_route($this->namespace, '/packages/from-manifest', array(
            'methods' => 'POST',
            'callback' => array($this, 'create_from_manifest'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'manifest' => array(
                    'required' => true,
                    'type' => 'object'
                )
            )
        ));
    }
    
    /**
     * Créer un package
     */
    public function create($course_id, $user_id, $options = array()) {
        global $wpdb;
        
        // Valider les options
        $default_options = array(
            'include_videos' => true,
            'include_documents' => true,
            'include_images' => true,
            'compress_images' => false,
            'video_quality' => 'original',
            'encryption_enabled' => get_option('col_lms_enable_encryption', true),
            'expiry_hours' => get_option('col_lms_package_expiry_hours', 24)
        );
        
        $options = wp_parse_args($options, $default_options);
        
        // Vérifier les limites
        $max_packages = get_option('col_lms_max_packages_per_user', 10);
        $current_packages = $this->get_user_active_packages_count($user_id);
        
        if ($current_packages >= $max_packages) {
            return new WP_Error(
                'package_limit_exceeded',
                sprintf(__('Limite de %d packages simultanés atteinte.', 'col-lms-offline-api'), $max_packages)
            );
        }
        
        // Générer un ID unique
        $package_id = wp_generate_uuid4();
        
        // Estimer la taille
        $estimated_size = $this->estimate_package_size($course_id, $options);
        $max_size = get_option('col_lms_max_package_size', 2147483648); // 2GB
        
        if ($estimated_size > $max_size) {
            return new WP_Error(
                'package_too_large',
                sprintf(
                    __('Package trop volumineux (%s). Limite: %s', 'col-lms-offline-api'),
                    size_format($estimated_size),
                    size_format($max_size)
                )
            );
        }
        
        // Vérifier si la table existe
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if (!$table_exists) {
            return new WP_Error('table_missing', __('Table des packages non trouvée.', 'col-lms-offline-api'));
        }
        
        // Insérer dans la base
        $result = $wpdb->insert(
            $wpdb->prefix . 'col_lms_packages',
            array(
                'package_id' => $package_id,
                'user_id' => $user_id,
                'course_id' => $course_id,
                'status' => self::STATUS_PENDING,
                'progress' => 0,
                'options' => wp_json_encode($options),
                'estimated_size' => $estimated_size,
                'created_at' => current_time('mysql')
            ),
            array('%s', '%d', '%d', '%s', '%d', '%s', '%d', '%s')
        );
        
        if ($result === false) {
            return new WP_Error('database_error', __('Erreur lors de la création du package.', 'col-lms-offline-api'));
        }
        
        // Programmer le traitement
        wp_schedule_single_event(time() + 10, 'col_lms_process_package', array($package_id));
        
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::info('Package créé', array(
                'package_id' => $package_id,
                'course_id' => $course_id,
                'user_id' => $user_id,
                'estimated_size' => $estimated_size
            ));
        }
        
        return $package_id;
    }
    
    /**
     * Obtenir le statut d'un package
     */
    public function get_package_status($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
            AND user_id = %d
        ", $package_id, $user_id));
        
        if (!$package) {
            return $this->error_response(
                'not_found',
                __('Package non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        $response = array(
            'package_id' => $package_id,
            'status' => $package->status,
            'progress' => intval($package->progress),
            'created_at' => $package->created_at,
            'estimated_size' => intval($package->estimated_size),
            'estimated_size_human' => size_format($package->estimated_size)
        );
        
        if ($package->status === self::STATUS_COMPLETED) {
            $response['files'] = json_decode($package->files, true);
            $response['manifest'] = $this->get_package_manifest($package_id);
            $response['completed_at'] = $package->completed_at;
            $response['actual_size'] = intval($package->actual_size);
            $response['actual_size_human'] = size_format($package->actual_size);
            $response['download_url'] = $this->get_package_download_url($package_id);
            $response['expires_at'] = $this->calculate_expiry_time($package);
        }
        
        if ($package->status === self::STATUS_ERROR) {
            $response['error'] = $package->error_message;
        }
        
        if ($package->status === self::STATUS_PROCESSING) {
            $response['eta'] = $this->estimate_completion_time($package);
        }
        
        return $response;
    }
    
    /**
     * Télécharger un package complet
     */
    public function download_package($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $this->get_package($package_id, $user_id);
        
        if (!$package) {
            return $this->error_response('not_found', __('Package non trouvé.', 'col-lms-offline-api'), 404);
        }
        
        if ($package->status !== self::STATUS_COMPLETED) {
            return $this->error_response(
                'package_not_ready',
                __('Package non disponible pour téléchargement.', 'col-lms-offline-api'),
                400
            );
        }
        
        // Vérifier l'expiration
        if ($this->is_package_expired($package)) {
            return $this->error_response(
                'package_expired',
                __('Package expiré.', 'col-lms-offline-api'),
                410
            );
        }
        
        // Créer un token de téléchargement temporaire
        $download_token = wp_generate_password(32, false);
        set_transient(
            'col_lms_download_' . $download_token,
            array(
                'package_id' => $package_id,
                'user_id' => $user_id,
                'type' => 'package',
                'expires' => time() + 3600
            ),
            3600
        );
        
        // Logger le téléchargement
        $this->log_action('package_download_requested', array(
            'package_id' => $package_id,
            'course_id' => $package->course_id
        ));
        
        return array(
            'download_url' => add_query_arg(
                array('col_lms_download' => $download_token),
                home_url()
            ),
            'expires_in' => 3600,
            'package_info' => array(
                'size' => intval($package->actual_size),
                'size_human' => size_format($package->actual_size),
                'files_count' => count(json_decode($package->files, true))
            )
        );
    }
    
    /**
     * Télécharger un fichier spécifique du package
     */
    public function download_package_file($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $file_name = $request->get_param('file');
        $user_id = $this->get_current_user_id();
        
        $package = $this->get_package($package_id, $user_id);
        
        if (!$package || $package->status !== self::STATUS_COMPLETED) {
            return $this->error_response('not_found', __('Fichier non trouvé.', 'col-lms-offline-api'), 404);
        }
        
        // Vérifier que le fichier est dans la liste
        $files = json_decode($package->files, true);
        $file_info = null;
        
        foreach ($files as $file) {
            if ($file['filename'] === $file_name) {
                $file_info = $file;
                break;
            }
        }
        
        if (!$file_info) {
            return $this->error_response('file_not_found', __('Fichier non trouvé dans le package.', 'col-lms-offline-api'), 404);
        }
        
        // Créer un token de téléchargement temporaire
        $download_token = wp_generate_password(32, false);
        set_transient(
            'col_lms_download_' . $download_token,
            array(
                'file_path' => $file_info['path'],
                'package_id' => $package_id,
                'user_id' => $user_id,
                'type' => 'file',
                'filename' => $file_name,
                'expires' => time() + 3600
            ),
            3600
        );
        
        return array(
            'download_url' => add_query_arg(
                array('col_lms_download' => $download_token),
                home_url()
            ),
            'expires_in' => 3600,
            'file_info' => $file_info
        );
    }
    
    /**
     * Annuler un package
     */
    public function cancel_package($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $this->get_package($package_id, $user_id);
        
        if (!$package) {
            return $this->error_response('not_found', __('Package non trouvé.', 'col-lms-offline-api'), 404);
        }
        
        if (!in_array($package->status, array(self::STATUS_PENDING, self::STATUS_PROCESSING))) {
            return $this->error_response(
                'cannot_cancel',
                __('Ce package ne peut pas être annulé.', 'col-lms-offline-api'),
                400
            );
        }
        
        // Mettre à jour le statut
        $wpdb->update(
            $wpdb->prefix . 'col_lms_packages',
            array(
                'status' => self::STATUS_CANCELLED,
                'error_message' => 'Annulé par l\'utilisateur'
            ),
            array('package_id' => $package_id),
            array('%s', '%s'),
            array('%s')
        );
        
        // Nettoyer les fichiers partiels si ils existent
        $this->cleanup_package_files($package_id);
        
        $this->log_action('package_cancelled', array('package_id' => $package_id));
        
        return array(
            'success' => true,
            'message' => __('Package annulé avec succès.', 'col-lms-offline-api')
        );
    }
    
    /**
     * Obtenir les packages d'un utilisateur
     */
    public function get_user_packages($request) {
        global $wpdb;
        
        $user_id = $this->get_current_user_id();
        $status = $request->get_param('status');
        $course_id = $request->get_param('course_id');
        $limit = $request->get_param('limit');
        
        $where_conditions = array('user_id = %d');
        $where_values = array($user_id);
        
        if ($status) {
            $where_conditions[] = 'status = %s';
            $where_values[] = $status;
        }
        
        if ($course_id) {
            $where_conditions[] = 'course_id = %d';
            $where_values[] = $course_id;
        }
        
        $where_clause = implode(' AND ', $where_conditions);
        
        $query = "
            SELECT p.*, c.post_title as course_title
            FROM {$wpdb->prefix}col_lms_packages p
            LEFT JOIN {$wpdb->posts} c ON p.course_id = c.ID
            WHERE $where_clause
            ORDER BY p.created_at DESC
            LIMIT %d
        ";
        
        $packages = $wpdb->get_results($wpdb->prepare($query, array_merge($where_values, array($limit))));
        
        $formatted_packages = array();
        
        foreach ($packages as $package) {
            $package_data = array(
                'package_id' => $package->package_id,
                'course_id' => $package->course_id,
                'course_title' => $package->course_title,
                'status' => $package->status,
                'progress' => intval($package->progress),
                'created_at' => $package->created_at,
                'estimated_size' => intval($package->estimated_size),
                'estimated_size_human' => size_format($package->estimated_size)
            );
            
            if ($package->status === self::STATUS_COMPLETED) {
                $package_data['completed_at'] = $package->completed_at;
                $package_data['actual_size'] = intval($package->actual_size);
                $package_data['actual_size_human'] = size_format($package->actual_size);
                $package_data['expires_at'] = $this->calculate_expiry_time($package);
                $package_data['is_expired'] = $this->is_package_expired($package);
            }
            
            if ($package->status === self::STATUS_ERROR) {
                $package_data['error'] = $package->error_message;
            }
            
            $formatted_packages[] = $package_data;
        }
        
        return array(
            'packages' => $formatted_packages,
            'total' => count($formatted_packages)
        );
    }
    
    /**
     * Supprimer un package
     */
    public function delete_package($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $this->get_package($package_id, $user_id);
        
        if (!$package) {
            return $this->error_response('not_found', __('Package non trouvé.', 'col-lms-offline-api'), 404);
        }
        
        // Supprimer les fichiers
        $this->cleanup_package_files($package_id);
        
        // Supprimer de la base
        $wpdb->delete(
            $wpdb->prefix . 'col_lms_packages',
            array('package_id' => $package_id),
            array('%s')
        );
        
        $this->log_action('package_deleted', array('package_id' => $package_id));
        
        return array(
            'success' => true,
            'message' => __('Package supprimé avec succès.', 'col-lms-offline-api')
        );
    }
    
    /**
     * Traiter la queue de packages
     */
    public function process_queue() {
        global $wpdb;
        
        // Vérifier que la table existe
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if (!$table_exists) {
            return;
        }
        
        // Récupérer les packages en attente
        $pending_packages = $wpdb->get_results("
            SELECT package_id FROM {$wpdb->prefix}col_lms_packages
            WHERE status = '" . self::STATUS_PENDING . "'
            ORDER BY created_at ASC
            LIMIT 3
        ");
        
        foreach ($pending_packages as $package) {
            $this->process_package($package->package_id);
        }
    }
    
    /**
     * Traiter un package
     */
    public function process_package($package_id) {
        global $wpdb;
        
        // Vérifier que la table existe
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if (!$table_exists) {
            return;
        }
        
        // Récupérer le package
        $package = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
        ", $package_id));
        
        if (!$package || $package->status !== self::STATUS_PENDING) {
            return;
        }
        
        try {
            // Marquer comme en cours
            $this->update_package_status($package_id, self::STATUS_PROCESSING, 0);
            
            $options = json_decode($package->options, true);
            
            // Vérifier que LearnPress est disponible
            if (!function_exists('learn_press_get_course')) {
                throw new Exception(__('LearnPress non disponible.', 'col-lms-offline-api'));
            }
            
            $course = learn_press_get_course($package->course_id);
            
            if (!$course) {
                throw new Exception(__('Cours non trouvé.', 'col-lms-offline-api'));
            }
            
            // Créer le dossier du package
            $package_dir = $this->get_package_directory($package_id);
            
            if (!wp_mkdir_p($package_dir)) {
                throw new Exception(__('Impossible de créer le dossier du package.', 'col-lms-offline-api'));
            }
            
            $files = array();
            $manifest = array(
                'package_id' => $package_id,
                'course_id' => $package->course_id,
                'title' => $course->get_title(),
                'version' => get_post_meta($package->course_id, '_lp_course_version', true) ?: 1,
                'created_at' => current_time('mysql'),
                'options' => $options,
                'sections' => array()
            );
            
            // Progression : 10%
            $this->update_package_status($package_id, self::STATUS_PROCESSING, 10);
            
            // Traiter l'image principale
            if ($options['include_images'] && ($thumbnail_id = get_post_thumbnail_id($package->course_id))) {
                $thumbnail_file = $this->copy_media_to_package($thumbnail_id, $package_dir, 'course_thumbnail');
                if ($thumbnail_file) {
                    $files[] = $thumbnail_file;
                    $manifest['thumbnail'] = $thumbnail_file['filename'];
                }
            }
            
            // Progression : 20%
            $this->update_package_status($package_id, self::STATUS_PROCESSING, 20);
            
            // Traiter le curriculum de manière simplifiée
            $curriculum = $course->get_curriculum();
            $total_items = 0;
            $processed_items = 0;
            
            if ($curriculum) {
                foreach ($curriculum as $section) {
                    $items = $section->get_items();
                    if ($items) {
                        $total_items += count($items);
                    }
                }
            }
            
            if ($curriculum) {
                foreach ($curriculum as $section_index => $section) {
                    $section_data = array(
                        'id' => $section->get_id(),
                        'title' => $section->get_title(),
                        'description' => $section->get_description(),
                        'items' => array()
                    );
                    
                    $items = $section->get_items();
                    if ($items) {
                        foreach ($items as $item) {
                            $processed_items++;
                            
                            $item_data = array(
                                'id' => $item->get_id(),
                                'title' => $item->get_title(),
                                'type' => $item->get_item_type(),
                                'duration' => $item->get_duration()
                            );
                            
                            // Traiter selon le type de manière simplifiée
                            if ($item->get_item_type() === 'lp_lesson') {
                                // Traitement simplifié des leçons
                                $lesson_post = get_post($item->get_id());
                                if ($lesson_post) {
                                    $item_data['content'] = $lesson_post->post_content;
                                    $item_data['excerpt'] = $lesson_post->post_excerpt;
                                }
                                
                                // Vidéo externe
                                $video_url = get_post_meta($item->get_id(), '_lp_lesson_video_url', true);
                                if ($video_url) {
                                    $item_data['video_url'] = $video_url;
                                    $item_data['video_type'] = get_post_meta($item->get_id(), '_lp_lesson_video_type', true);
                                }
                                
                            } elseif ($item->get_item_type() === 'lp_quiz') {
                                // Traitement simplifié des quiz
                                $item_data['quiz_data'] = array(
                                    'id' => $item->get_id(),
                                    'title' => $item->get_title(),
                                    'questions_count' => 0
                                );
                            }
                            
                            $section_data['items'][] = $item_data;
                            
                            // Mettre à jour la progression
                            $progress = 20 + (70 * $processed_items / max($total_items, 1));
                            $this->update_package_status($package_id, self::STATUS_PROCESSING, $progress);
                        }
                    }
                    
                    $manifest['sections'][] = $section_data;
                }
            }
            
            // Sauvegarder le manifeste
            $manifest_file = $package_dir . '/manifest.json';
            file_put_contents($manifest_file, wp_json_encode($manifest, JSON_PRETTY_PRINT));
            
            $files[] = array(
                'filename' => 'manifest.json',
                'path' => $manifest_file,
                'size' => filesize($manifest_file),
                'type' => 'application/json'
            );
            
            // Créer un fichier ZIP si demandé
            if (($options['create_zip'] ?? true) && class_exists('ZipArchive')) {
                $zip_file = $this->create_package_zip($package_dir, $files, $package_id);
                if ($zip_file) {
                    $files[] = $zip_file;
                }
            }
            
            // Calculer la taille finale
            $actual_size = array_sum(array_column($files, 'size'));
            
            // Progression : 100%
            $wpdb->update(
                $wpdb->prefix . 'col_lms_packages',
                array(
                    'status' => self::STATUS_COMPLETED,
                    'progress' => 100,
                    'files' => wp_json_encode($files),
                    'actual_size' => $actual_size,
                    'completed_at' => current_time('mysql')
                ),
                array('package_id' => $package_id),
                array('%s', '%d', '%s', '%d', '%s'),
                array('%s')
            );
            
            if (class_exists('COL_LMS_Logger')) {
                COL_LMS_Logger::info('Package créé avec succès', array(
                    'package_id' => $package_id,
                    'files_count' => count($files),
                    'actual_size' => $actual_size
                ));
            }
            
        } catch (Exception $e) {
            $wpdb->update(
                $wpdb->prefix . 'col_lms_packages',
                array(
                    'status' => self::STATUS_ERROR,
                    'error_message' => $e->getMessage()
                ),
                array('package_id' => $package_id),
                array('%s', '%s'),
                array('%s')
            );
            
            if (class_exists('COL_LMS_Logger')) {
                COL_LMS_Logger::error('Erreur création package', array(
                    'package_id' => $package_id,
                    'error' => $e->getMessage()
                ));
            }
        }
    }
    
    /**
     * Gérer le téléchargement direct
     */
    public function handle_download() {
        $token = sanitize_text_field($_GET['col_lms_download'] ?? '');
        $download_data = get_transient('col_lms_download_' . $token);
        
        if (!$download_data || $download_data['expires'] < time()) {
            wp_die(__('Lien de téléchargement invalide ou expiré.', 'col-lms-offline-api'), 'Lien expiré', array('response' => 410));
        }
        
        if ($download_data['type'] === 'package') {
            $this->stream_package_download($download_data);
        } else {
            $this->stream_file_download($download_data);
        }
        
        // Supprimer le token
        delete_transient('col_lms_download_' . $token);
        exit;
    }
    
    /**
     * Nettoyer les anciens packages
     */
    public function cleanup_old_packages() {
        global $wpdb;
        
        // Vérifier que la table existe
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if (!$table_exists) {
            return;
        }
        
        $expiry_hours = get_option('col_lms_package_expiry_hours', 24);
        
        // Récupérer les packages expirés
        $expired_packages = $wpdb->get_col($wpdb->prepare("
            SELECT package_id FROM {$wpdb->prefix}col_lms_packages
            WHERE status = %s
            AND completed_at < DATE_SUB(NOW(), INTERVAL %d HOUR)
        ", self::STATUS_COMPLETED, $expiry_hours));
        
        foreach ($expired_packages as $package_id) {
            $this->cleanup_package_files($package_id);
        }
        
        // Supprimer les packages en erreur après 7 jours
        $wpdb->query($wpdb->prepare("
            DELETE FROM {$wpdb->prefix}col_lms_packages
            WHERE status IN (%s, %s)
            AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
        ", self::STATUS_ERROR, self::STATUS_CANCELLED));
        
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::info('Nettoyage des packages effectué', array(
                'expired_packages' => count($expired_packages)
            ));
        }
    }
    
    /**
     * Vérifier l'accès à un package
     */
    public function check_package_access($request) {
        if (!$this->check_auth($request)) {
            return false;
        }
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $this->get_package($package_id, $user_id);
        
        return $package !== null;
    }

    // Méthodes privées utilitaires simplifiées
    
    private function get_package($package_id, $user_id) {
        global $wpdb;
        
        return $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
            AND user_id = %d
        ", $package_id, $user_id));
    }
    
    private function get_user_active_packages_count($user_id) {
        global $wpdb;
        
        return $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(*)
            FROM {$wpdb->prefix}col_lms_packages
            WHERE user_id = %d
            AND status IN (%s, %s, %s)
        ", $user_id, self::STATUS_PENDING, self::STATUS_PROCESSING, self::STATUS_COMPLETED));
    }
    
    private function estimate_package_size($course_id, $options) {
        // Estimation simplifiée
        return 10 * 1024 * 1024; // 10MB par défaut
    }
    
    private function update_package_status($package_id, $status, $progress) {
        global $wpdb;
        
        $wpdb->update(
            $wpdb->prefix . 'col_lms_packages',
            array(
                'status' => $status,
                'progress' => intval($progress)
            ),
            array('package_id' => $package_id),
            array('%s', '%d'),
            array('%s')
        );
    }
    
    private function get_package_directory($package_id) {
        $upload_dir = wp_upload_dir();
        return $upload_dir['basedir'] . '/col-lms-packages/' . $package_id;
    }
    
    private function get_package_manifest($package_id) {
        $manifest_file = $this->get_package_directory($package_id) . '/manifest.json';
        
        if (file_exists($manifest_file)) {
            return json_decode(file_get_contents($manifest_file), true);
        }
        
        return null;
    }
    
    private function copy_media_to_package($attachment_id, $package_dir, $prefix = '') {
        $file_path = get_attached_file($attachment_id);
        
        if (!$file_path || !file_exists($file_path)) {
            return null;
        }
        
        $filename = $prefix . '_' . basename($file_path);
        $destination = $package_dir . '/' . $filename;
        
        if (copy($file_path, $destination)) {
            return array(
                'filename' => $filename,
                'path' => $destination,
                'size' => filesize($destination),
                'type' => get_post_mime_type($attachment_id),
                'original_id' => $attachment_id
            );
        }
        
        return null;
    }
    
    private function create_package_zip($package_dir, $files, $package_id) {
        if (!class_exists('ZipArchive')) {
            return null;
        }
        
        $zip = new ZipArchive();
        $zip_filename = $package_id . '.zip';
        $zip_path = $package_dir . '/' . $zip_filename;
        
        if ($zip->open($zip_path, ZipArchive::CREATE) !== TRUE) {
            return null;
        }
        
        foreach ($files as $file) {
            if (file_exists($file['path'])) {
                $zip->addFile($file['path'], $file['filename']);
            }
        }
        
        $zip->close();
        
        return array(
            'filename' => $zip_filename,
            'path' => $zip_path,
            'size' => filesize($zip_path),
            'type' => 'application/zip'
        );
    }
    
    private function cleanup_package_files($package_id) {
        $package_dir = $this->get_package_directory($package_id);
        
        if (is_dir($package_dir)) {
            $this->delete_directory($package_dir);
        }
    }
    
    private function delete_directory($dir) {
        if (!is_dir($dir)) {
            return false;
        }
        
        $files = array_diff(scandir($dir), array('.', '..'));
        
        foreach ($files as $file) {
            $path = $dir . DIRECTORY_SEPARATOR . $file;
            is_dir($path) ? $this->delete_directory($path) : unlink($path);
        }
        
        return rmdir($dir);
    }
    
    private function calculate_expiry_time($package) {
        $expiry_hours = get_option('col_lms_package_expiry_hours', 24);
        return date('Y-m-d H:i:s', strtotime($package->completed_at) + ($expiry_hours * 3600));
    }
    
    private function is_package_expired($package) {
        $expiry_time = $this->calculate_expiry_time($package);
        return strtotime($expiry_time) < time();
    }
    
    private function get_package_download_url($package_id) {
        return rest_url($this->namespace . '/packages/' . $package_id . '/download');
    }
    
    private function estimate_completion_time($package) {
        // Estimation basée sur la progression actuelle
        $progress = max($package->progress, 1);
        $elapsed = time() - strtotime($package->created_at);
        $total_time = ($elapsed * 100) / $progress;
        $remaining = $total_time - $elapsed;
        
        return max($remaining, 0);
    }
    
    private function stream_package_download($download_data) {
        $package_id = $download_data['package_id'];
        $package_dir = $this->get_package_directory($package_id);
        $zip_file = $package_dir . '/' . $package_id . '.zip';
        
        if (!file_exists($zip_file)) {
            wp_die(__('Fichier package non trouvé.', 'col-lms-offline-api'));
        }
        
        $this->stream_file($zip_file, $package_id . '.zip');
    }
    
    private function stream_file_download($download_data) {
        $file_path = $download_data['file_path'];
        $filename = $download_data['filename'];
        
        if (!file_exists($file_path)) {
            wp_die(__('Fichier non trouvé.', 'col-lms-offline-api'));
        }
        
        $this->stream_file($file_path, $filename);
    }
    
    private function stream_file($file_path, $filename) {
        // Headers pour forcer le téléchargement
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . basename($filename) . '"');
        header('Content-Length: ' . filesize($file_path));
        header('Cache-Control: no-cache, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        
        // Streaming pour les gros fichiers
        $handle = fopen($file_path, 'rb');
        if ($handle) {
            while (!feof($handle)) {
                echo fread($handle, 8192);
                flush();
            }
            fclose($handle);
        }
    }
    
    // Méthodes manquantes pour compatibilité
    public function create_from_manifest($request) {
        return $this->error_response(
            'not_implemented',
            __('Fonctionnalité non implémentée.', 'col-lms-offline-api'),
            501
        );
    }
}