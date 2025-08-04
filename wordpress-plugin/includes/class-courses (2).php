<?php
/**
 * Gestion des cours pour l'API COL LMS
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Courses extends COL_LMS_API_Base {
    
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
     * Enregistrer les routes
     */
    public function register_routes() {
        // Liste des cours
        register_rest_route($this->namespace, '/courses', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_courses'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'page' => array(
                    'default' => 1,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function($param) {
                        return $param > 0;
                    }
                ),
                'per_page' => array(
                    'default' => 20,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function($param) {
                        return $param > 0 && $param <= 100;
                    }
                ),
                'search' => array(
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'category' => array(
                    'sanitize_callback' => 'absint'
                ),
                'level' => array(
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return in_array($param, array('beginner', 'intermediate', 'expert', 'all'));
                    }
                ),
                'instructor' => array(
                    'sanitize_callback' => 'absint'
                ),
                'enrolled_only' => array(
                    'sanitize_callback' => 'rest_sanitize_boolean',
                    'default' => false
                )
            )
        ));
        
        // Détails d'un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_details'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'id' => array(
                    'validate_callback' => function($param) {
                        return is_numeric($param);
                    }
                ),
                'include_sections' => array(
                    'sanitize_callback' => 'rest_sanitize_boolean',
                    'default' => true
                )
            )
        ));
        
        // Médias d'un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/media', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_media'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'include_videos' => array(
                    'sanitize_callback' => 'rest_sanitize_boolean',
                    'default' => true
                ),
                'include_documents' => array(
                    'sanitize_callback' => 'rest_sanitize_boolean',
                    'default' => true
                )
            )
        ));
        
        // Créer un package
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/package', array(
            'methods' => 'POST',
            'callback' => array($this, 'create_package'),
            'permission_callback' => array($this, 'check_download_permission'),
            'args' => array(
                'options' => array(
                    'type' => 'object',
                    'default' => array(),
                    'properties' => array(
                        'include_videos' => array('type' => 'boolean', 'default' => true),
                        'include_documents' => array('type' => 'boolean', 'default' => true),
                        'include_images' => array('type' => 'boolean', 'default' => true),
                        'compress_images' => array('type' => 'boolean', 'default' => true),
                        'video_quality' => array('type' => 'string', 'default' => 'original'),
                        'encryption_enabled' => array('type' => 'boolean', 'default' => true)
                    )
                )
            )
        ));
        
        // S'inscrire à un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/enroll', array(
            'methods' => 'POST',
            'callback' => array($this, 'enroll_course'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Contenu d'une leçon
        register_rest_route($this->namespace, '/lessons/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_lesson_content'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'include_attachments' => array(
                    'sanitize_callback' => 'rest_sanitize_boolean',
                    'default' => true
                )
            )
        ));
        
        // Contenu d'un quiz
        register_rest_route($this->namespace, '/quizzes/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_quiz_content'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Catégories de cours
        register_rest_route($this->namespace, '/courses/categories', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_categories'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Instructeurs
        register_rest_route($this->namespace, '/instructors', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_instructors'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Obtenir la liste des cours
     */
    public function get_courses($request) {
        $user_id = $this->get_current_user_id();
        
        $args = array(
            'post_type' => 'lp_course',
            'posts_per_page' => $request->get_param('per_page'),
            'paged' => $request->get_param('page'),
            'post_status' => 'publish',
            'meta_query' => array(),
            'tax_query' => array()
        );
        
        // Recherche
        if ($search = $request->get_param('search')) {
            $args['s'] = $search;
        }
        
        // Catégorie
        if ($category = $request->get_param('category')) {
            $args['tax_query'][] = array(
                'taxonomy' => 'course_category',
                'field' => 'term_id',
                'terms' => $category
            );
        }
        
        // Niveau
        if ($level = $request->get_param('level')) {
            if ($level !== 'all') {
                $args['meta_query'][] = array(
                    'key' => '_lp_level',
                    'value' => $level,
                    'compare' => '='
                );
            }
        }
        
        // Instructeur
        if ($instructor = $request->get_param('instructor')) {
            $args['author'] = $instructor;
        }
        
        // Seulement les cours inscrits
        if ($request->get_param('enrolled_only')) {
            $enrolled_courses = $this->get_user_enrolled_courses($user_id);
            if (empty($enrolled_courses)) {
                return array(
                    'courses' => array(),
                    'total' => 0,
                    'pages' => 0
                );
            }
            $args['post__in'] = $enrolled_courses;
        }
        
        // Appliquer les filtres selon l'abonnement
        $args = $this->apply_membership_filters($args, $user_id);
        
        $query = new WP_Query($args);
        $courses = array();
        
        foreach ($query->posts as $post) {
            // Vérifier l'accès
            if (!$this->user_can_access_course($user_id, $post->ID)) {
                continue;
            }
            
            $courses[] = $this->format_course_data($post->ID, false);
        }
        
        $this->log_action('list_courses', array(
            'total_found' => $query->found_posts,
            'page' => $request->get_param('page'),
            'search' => $search
        ));
        
        return array(
            'courses' => $courses,
            'total' => $query->found_posts,
            'pages' => $query->max_num_pages,
            'current_page' => $request->get_param('page')
        );
    }
    
    /**
     * Obtenir les détails d'un cours
     */
    public function get_course_details($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        $include_sections = $request->get_param('include_sections');
        
        // Vérifier l'accès
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return $this->error_response(
                'not_found',
                __('Cours non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Formater les données complètes
        $course_data = $this->format_course_data($course_id, true);
        
        // Ajouter le curriculum si demandé
        if ($include_sections) {
            $course_data['sections'] = $this->get_course_curriculum($course_id);
        }
        
        // Ajouter les statistiques d'avancement
        $course_data['progress_stats'] = $this->get_course_progress_stats($course_id, $user_id);
        
        $this->log_action('view_course', array('course_id' => $course_id));
        
        return array(
            'course' => $course_data,
            'access_info' => array(
                'can_download' => $this->check_permission('col_lms_download_courses'),
                'enrollment_required' => !$course->is_free()
            )
        );
    }
    
    /**
     * Obtenir les médias d'un cours
     */
    public function get_course_media($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        $include_videos = $request->get_param('include_videos');
        $include_documents = $request->get_param('include_documents');
        
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        $media = $this->collect_course_media($course_id, array(
            'include_videos' => $include_videos,
            'include_documents' => $include_documents
        ));
        
        return array(
            'media' => $media,
            'count' => count($media),
            'total_size' => array_sum(array_column($media, 'size')),
            'size_human' => size_format(array_sum(array_column($media, 'size')))
        );
    }
    
    /**
     * Créer un package de téléchargement
     */
    public function create_package($request) {
        $course_id = $request->get_param('id');
        $options = $request->get_param('options');
        $user_id = $this->get_current_user_id();
        
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Vérifier la limite de taille
        $estimated_size = $this->estimate_package_size($course_id, $options);
        $max_size = get_option('col_lms_max_package_size', 2147483648); // 2GB
        
        if ($estimated_size > $max_size) {
            return $this->error_response(
                'package_too_large',
                sprintf(
                    __('Le package estimé (%s) dépasse la limite autorisée (%s).', 'col-lms-offline-api'),
                    size_format($estimated_size),
                    size_format($max_size)
                ),
                413
            );
        }
        
        // Créer le package
        if (class_exists('COL_LMS_Packages')) {
            $package_id = COL_LMS_Packages::instance()->create($course_id, $user_id, $options);
            
            if (is_wp_error($package_id)) {
                return $package_id;
            }
            
            $this->log_action('create_package', array(
                'course_id' => $course_id,
                'package_id' => $package_id,
                'estimated_size' => $estimated_size
            ));
            
            return array(
                'success' => true,
                'package_id' => $package_id,
                'status' => 'processing',
                'estimated_size' => $estimated_size,
                'estimated_size_human' => size_format($estimated_size),
                'message' => __('Package en cours de création.', 'col-lms-offline-api')
            );
        }
        
        return $this->error_response(
            'packages_disabled',
            __('Les packages ne sont pas disponibles.', 'col-lms-offline-api'),
            503
        );
    }
    
    /**
     * S'inscrire à un cours
     */
    public function enroll_course($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return $this->error_response(
                'not_found',
                __('Cours non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Vérifier si l'utilisateur peut s'inscrire
        $can_enroll = $course->can_enroll();
        if (is_wp_error($can_enroll)) {
            return $this->error_response(
                'enrollment_failed',
                $can_enroll->get_error_message(),
                400
            );
        }
        
        // Effectuer l'inscription
        $user = learn_press_get_user($user_id);
        $result = $user->enroll($course_id);
        
        if (is_wp_error($result)) {
            return $this->error_response(
                'enrollment_failed',
                $result->get_error_message(),
                400
            );
        }
        
        $this->log_action('enroll_course', array('course_id' => $course_id));
        
        return array(
            'success' => true,
            'message' => __('Inscription réussie au cours.', 'col-lms-offline-api'),
            'course_data' => $this->get_course_progress_stats($course_id, $user_id)
        );
    }
    
    /**
     * Obtenir le contenu d'une leçon
     */
    public function get_lesson_content($request) {
        $lesson_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        $include_attachments = $request->get_param('include_attachments');
        
        // Vérifier l'accès via le cours parent
        $course_id = $this->get_lesson_course($lesson_id);
        
        if (!$course_id || !$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à cette leçon.', 'col-lms-offline-api'),
                403
            );
        }
        
        $lesson = learn_press_get_lesson($lesson_id);
        if (!$lesson) {
            return $this->error_response(
                'not_found',
                __('Leçon non trouvée.', 'col-lms-offline-api'),
                404
            );
        }
        
        $lesson_data = array(
            'id' => $lesson_id,
            'title' => $lesson->get_title(),
            'content' => apply_filters('the_content', $lesson->get_content()),
            'excerpt' => $lesson->get_excerpt(),
            'duration' => $lesson->get_duration(),
            'preview' => $lesson->is_preview(),
            'video_url' => get_post_meta($lesson_id, '_lp_lesson_video_url', true),
            'video_type' => get_post_meta($lesson_id, '_lp_lesson_video_type', true),
            'order' => $lesson->get_order(),
            'course_id' => $course_id
        );
        
        if ($include_attachments) {
            $lesson_data['attachments'] = $this->get_lesson_attachments($lesson_id);
            $lesson_data['materials'] = $this->get_lesson_materials($lesson_id);
        }
        
        // Ajouter la progression utilisateur
        $user = learn_press_get_user($user_id);
        $user_item = $user->get_item($lesson_id, $course_id);
        
        if ($user_item) {
            $lesson_data['user_progress'] = array(
                'status' => $user_item->get_status(),
                'start_time' => $user_item->get_start_time(),
                'end_time' => $user_item->get_end_time(),
                'time_spent' => $user_item->get_time_spent()
            );
        }
        
        $this->log_action('view_lesson', array(
            'lesson_id' => $lesson_id,
            'course_id' => $course_id
        ));
        
        return array('lesson' => $lesson_data);
    }
    
    /**
     * Obtenir le contenu d'un quiz
     */
    public function get_quiz_content($request) {
        $quiz_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès
        $course_id = $this->get_lesson_course($quiz_id);
        
        if (!$course_id || !$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce quiz.', 'col-lms-offline-api'),
                403
            );
        }
        
        $quiz = learn_press_get_quiz($quiz_id);
        if (!$quiz) {
            return $this->error_response(
                'not_found',
                __('Quiz non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        $quiz_data = array(
            'id' => $quiz_id,
            'title' => $quiz->get_title(),
            'content' => $quiz->get_content(),
            'duration' => $quiz->get_duration(),
            'passing_grade' => $quiz->get_passing_grade(),
            'questions_count' => $quiz->count_questions(),
            'retake_count' => $quiz->get_retake_count(),
            'negative_marking' => $quiz->get_negative_marking(),
            'instant_check' => $quiz->get_instant_check(),
            'course_id' => $course_id
        );
        
        // Ajouter les questions si l'utilisateur peut commencer le quiz
        $user = learn_press_get_user($user_id);
        $can_start = $user->can_start_quiz($quiz_id, $course_id);
        
        if ($can_start) {
            $quiz_data['questions'] = $this->get_quiz_questions($quiz_id);
        }
        
        // Ajouter les tentatives précédentes
        $quiz_data['attempts'] = $this->get_user_quiz_attempts($user_id, $quiz_id, $course_id);
        
        $this->log_action('view_quiz', array(
            'quiz_id' => $quiz_id,
            'course_id' => $course_id
        ));
        
        return array('quiz' => $quiz_data);
    }
    
    /**
     * Obtenir les catégories de cours
     */
    public function get_course_categories($request) {
        $terms = get_terms(array(
            'taxonomy' => 'course_category',
            'hide_empty' => true,
            'orderby' => 'name',
            'order' => 'ASC'
        ));
        
        if (is_wp_error($terms)) {
            return array('categories' => array());
        }
        
        $categories = array();
        foreach ($terms as $term) {
            $categories[] = array(
                'id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'description' => $term->description,
                'count' => $term->count,
                'parent' => $term->parent
            );
        }
        
        return array('categories' => $categories);
    }
    
    /**
     * Obtenir les instructeurs
     */
    public function get_instructors($request) {
        $instructors = get_users(array(
            'role__in' => array('administrator', 'lp_teacher'),
            'meta_query' => array(
                array(
                    'key' => 'col_lms_instructor_enabled',
                    'value' => '1',
                    'compare' => '='
                )
            )
        ));
        
        $formatted_instructors = array();
        foreach ($instructors as $instructor) {
            $course_count = count_user_posts($instructor->ID, 'lp_course');
            
            if ($course_count > 0) {
                $formatted_instructors[] = array(
                    'id' => $instructor->ID,
                    'name' => $instructor->display_name,
                    'avatar' => get_avatar_url($instructor->ID),
                    'bio' => get_user_meta($instructor->ID, 'description', true),
                    'course_count' => $course_count
                );
            }
        }
        
        return array('instructors' => $formatted_instructors);
    }
    
    /**
     * Vérifier les permissions de téléchargement
     */
    public function check_download_permission($request) {
        if (!$this->check_auth($request)) {
            return false;
        }
        
        return $this->check_permission('col_lms_download_courses');
    }
    
    /**
     * Formater les données d'un cours
     */
    private function format_course_data($course_id, $detailed = false) {
        $course = learn_press_get_course($course_id);
        $post = get_post($course_id);
        $instructor = get_userdata($post->post_author);
        
        $data = array(
            'id' => $course_id,
            'title' => $course->get_title(),
            'slug' => $post->post_name,
            'description' => $course->get_description(),
            'excerpt' => $course->get_excerpt(),
            'thumbnail' => get_the_post_thumbnail_url($course_id, 'large'),
            'featured_image' => array(
                'url' => get_the_post_thumbnail_url($course_id, 'full'),
                'thumbnail' => get_the_post_thumbnail_url($course_id, 'thumbnail'),
                'medium' => get_the_post_thumbnail_url($course_id, 'medium')
            ),
            'instructor' => array(
                'id' => $instructor->ID,
                'name' => $instructor->display_name,
                'avatar' => get_avatar_url($instructor->ID),
                'bio' => get_user_meta($instructor->ID, 'description', true)
            ),
            'stats' => array(
                'lessons_count' => $course->count_items('lp_lesson'),
                'quizzes_count' => $course->count_items('lp_quiz'),
                'sections_count' => count($course->get_sections()),
                'students_enrolled' => $course->get_users_enrolled()
            ),
            'duration' => $course->get_duration(),
            'level' => get_post_meta($course_id, '_lp_level', true) ?: 'all',
            'language' => get_post_meta($course_id, '_lp_language', true) ?: 'fr',
            'price' => array(
                'amount' => $course->get_price(),
                'sale_price' => $course->get_sale_price(),
                'is_free' => $course->is_free(),
                'currency' => learn_press_get_currency()
            ),
            'categories' => wp_get_post_terms($course_id, 'course_category', array('fields' => 'names')),
            'tags' => wp_get_post_terms($course_id, 'course_tag', array('fields' => 'names')),
            'meta' => array(
                'version' => get_post_meta($course_id, '_lp_course_version', true) ?: 1,
                'last_updated' => $post->post_modified,
                'created_at' => $post->post_date,
                'status' => $post->post_status
            )
        );
        
        if ($detailed) {
            $data['content'] = apply_filters('the_content', $course->get_content());
            $data['requirements'] = get_post_meta($course_id, '_lp_requirements', true);
            $data['target_audiences'] = get_post_meta($course_id, '_lp_target_audiences', true);
            $data['key_features'] = get_post_meta($course_id, '_lp_key_features', true);
            $data['faqs'] = get_post_meta($course_id, '_lp_faqs', true);
            $data['what_will_learn'] = get_post_meta($course_id, '_lp_what_will_learn', true);
        }
        
        // Ajouter la progression de l'utilisateur
        $user_id = $this->get_current_user_id();
        if ($user_id) {
            $user = learn_press_get_user($user_id);
            $course_data = $user->get_course_data($course_id);
            
            if ($course_data) {
                $data['user_progress'] = array(
                    'status' => $course_data->get_status(),
                    'progress' => $course_data->get_results('result'),
                    'start_time' => $course_data->get_start_time(),
                    'end_time' => $course_data->get_end_time(),
                    'expiration_time' => $course_data->get_expiration_time(),
                    'is_enrolled' => true
                );
            } else {
                $data['user_progress'] = array(
                    'is_enrolled' => false,
                    'can_enroll' => !is_wp_error($course->can_enroll())
                );
            }
        }
        
        return $data;
    }
    
    /**
     * Obtenir le curriculum d'un cours
     */
    private function get_course_curriculum($course_id) {
        $course = learn_press_get_course($course_id);
        $curriculum = $course->get_curriculum();
        $sections_data = array();
        
        if (!$curriculum) {
            return $sections_data;
        }
        
        foreach ($curriculum as $section) {
            $section_data = array(
                'id' => $section->get_id(),
                'title' => $section->get_title(),
                'description' => $section->get_description(),
                'order' => $section->get_order(),
                'items' => array()
            );
            
            $items = $section->get_items();
            if ($items) {
                foreach ($items as $item) {
                    $item_data = array(
                        'id' => $item->get_id(),
                        'title' => $item->get_title(),
                        'type' => $item->get_item_type(),
                        'duration' => $item->get_duration(),
                        'preview' => $item->is_preview(),
                        'order' => $item->get_order(),
                        'status' => 'locked'
                    );
                    
                    // Ajouter des données spécifiques selon le type
                    if ($item->get_item_type() === 'lp_quiz') {
                        $quiz = learn_press_get_quiz($item->get_id());
                        if ($quiz) {
                            $item_data['questions_count'] = $quiz->count_questions();
                            $item_data['passing_grade'] = $quiz->get_passing_grade();
                            $item_data['retake_count'] = $quiz->get_retake_count();
                            $item_data['duration'] = $quiz->get_duration();
                        }
                    } elseif ($item->get_item_type() === 'lp_lesson') {
                        $lesson = learn_press_get_lesson($item->get_id());
                        if ($lesson) {
                            $item_data['video_url'] = get_post_meta($item->get_id(), '_lp_lesson_video_url', true);
                            $item_data['has_video'] = !empty($item_data['video_url']);
                        }
                    }
                    
                    // Ajouter le statut utilisateur
                    $user_id = $this->get_current_user_id();
                    if ($user_id) {
                        $user = learn_press_get_user($user_id);
                        $user_item = $user->get_item($item->get_id(), $course_id);
                        
                        if ($user_item) {
                            $item_data['status'] = $user_item->get_status();
                            $item_data['user_progress'] = array(
                                'completed' => $user_item->is_completed(),
                                'started' => $user_item->is_started(),
                                'start_time' => $user_item->get_start_time(),
                                'end_time' => $user_item->get_end_time()
                            );
                        }
                    }
                    
                    $section_data['items'][] = $item_data;
                }
            }
            
            $sections_data[] = $section_data;
        }
        
        return $sections_data;
    }
    
    // Méthodes utilitaires privées - Suite dans le prochain artifact...
    
    /**
     * Estimer la taille d'un package
     */
    private function estimate_package_size($course_id, $options) {
        $media = $this->collect_course_media($course_id, $options);
        $total_size = array_sum(array_column($media, 'size'));
        
        // Ajouter une marge pour les métadonnées et compression
        return $total_size * 1.2;
    }
    
    /**
     * Collecter les médias d'un cours
     */
    private function collect_course_media($course_id, $options = array()) {
        $media = array();
        $course = learn_press_get_course($course_id);
        
        $default_options = array(
            'include_videos' => true,
            'include_documents' => true,
            'include_images' => true
        );
        
        $options = wp_parse_args($options, $default_options);
        
        // Image principale
        if ($options['include_images'] && ($thumbnail_id = get_post_thumbnail_id($course_id))) {
            $media[] = $this->format_media_data($thumbnail_id, 'course_thumbnail');
        }
        
        // Parcourir le curriculum
        $curriculum = $course->get_curriculum();
        if ($curriculum) {
            foreach ($curriculum as $section) {
                $items = $section->get_items();
                if ($items) {
                    foreach ($items as $item) {
                        if ($item->get_item_type() === 'lp_lesson') {
                            $lesson_media = $this->get_lesson_media($item->get_id(), $options);
                            $media = array_merge($media, $lesson_media);
                        }
                    }
                }
            }
        }
        
        return $media;
    }
    
    /**
     * Obtenir les médias d'une leçon
     */
    private function get_lesson_media($lesson_id, $options) {
        $media = array();
        
        // Vidéos
        if ($options['include_videos']) {
            $video_url = get_post_meta($lesson_id, '_lp_lesson_video_url', true);
            if ($video_url) {
                $media[] = array(
                    'id' => 'video_' . $lesson_id,
                    'type' => 'video_external',
                    'url' => $video_url,
                    'lesson_id' => $lesson_id,
                    'size' => 0 // Les vidéos externes n'ont pas de taille
                );
            }
        }
        
        // Documents et images
        if ($options['include_documents'] || $options['include_images']) {
            $attachments = get_posts(array(
                'post_type' => 'attachment',
                'posts_per_page' => -1,
                'post_parent' => $lesson_id
            ));
            
            foreach ($attachments as $attachment) {
                $mime_type = get_post_mime_type($attachment->ID);
                
                $include = false;
                if ($options['include_documents'] && strpos($mime_type, 'application/') === 0) {
                    $include = true;
                }
                if ($options['include_images'] && strpos($mime_type, 'image/') === 0) {
                    $include = true;
                }
                
                if ($include) {
                    $media[] = $this->format_media_data($attachment->ID, 'lesson_attachment', $lesson_id);
                }
            }
        }
        
        return $media;
    }
    
    /**
     * Formater les données d'un média
     */
    private function format_media_data($attachment_id, $context = '', $parent_id = 0) {
        $file_path = get_attached_file($attachment_id);
        $url = wp_get_attachment_url($attachment_id);
        $metadata = wp_get_attachment_metadata($attachment_id);
        
        return array(
            'id' => $attachment_id,
            'title' => get_the_title($attachment_id),
            'filename' => basename($file_path),
            'url' => $url,
            'type' => get_post_mime_type($attachment_id),
            'size' => file_exists($file_path) ? filesize($file_path) : 0,
            'context' => $context,
            'parent_id' => $parent_id,
            'metadata' => $metadata
        );
    }
    
    /**
     * Obtenir les pièces jointes d'une leçon
     */
    private function get_lesson_attachments($lesson_id) {
        $attachments = array();
        
        $media = get_posts(array(
            'post_type' => 'attachment',
            'posts_per_page' => -1,
            'post_parent' => $lesson_id
        ));
        
        foreach ($media as $attachment) {
            $file_path = get_attached_file($attachment->ID);
            $attachments[] = array(
                'id' => $attachment->ID,
                'title' => $attachment->post_title,
                'filename' => basename($file_path),
                'url' => wp_get_attachment_url($attachment->ID),
                'type' => $attachment->post_mime_type,
                'size' => file_exists($file_path) ? filesize($file_path) : 0,
                'download_url' => wp_get_attachment_url($attachment->ID)
            );
        }
        
        return $attachments;
    }
    
    /**
     * Obtenir les matériaux d'une leçon
     */
    private function get_lesson_materials($lesson_id) {
        $materials = get_post_meta($lesson_id, '_lp_lesson_materials', true);
        
        if (!$materials || !is_array($materials)) {
            return array();
        }
        
        $formatted_materials = array();
        
        foreach ($materials as $material) {
            if (isset($material['file_id']) && $material['file_id']) {
                $formatted_materials[] = array(
                    'id' => $material['file_id'],
                    'title' => $material['title'] ?? get_the_title($material['file_id']),
                    'url' => wp_get_attachment_url($material['file_id']),
                    'type' => get_post_mime_type($material['file_id']),
                    'size' => filesize(get_attached_file($material['file_id'])) ?: 0
                );
            }
        }
        
        return $formatted_materials;
    }
    
    /**
     * Obtenir les cours inscrits d'un utilisateur
     */
    private function get_user_enrolled_courses($user_id) {
        $user = learn_press_get_user($user_id);
        return $user->get_enrolled_courses();
    }
    
    /**
     * Obtenir les statistiques de progression d'un cours
     */
    private function get_course_progress_stats($course_id, $user_id) {
        $user = learn_press_get_user($user_id);
        $course_data = $user->get_course_data($course_id);
        
        if (!$course_data) {
            return null;
        }
        
        return array(
            'progress_percent' => $course_data->get_results('result'),
            'completed_items' => $course_data->get_completed_items(),
            'total_items' => $course_data->get_total_items(),
            'status' => $course_data->get_status(),
            'grade' => $course_data->get_results('grade'),
            'start_time' => $course_data->get_start_time(),
            'end_time' => $course_data->get_end_time()
        );
    }
    
    /**
     * Obtenir les questions d'un quiz
     */
    private function get_quiz_questions($quiz_id) {
        $quiz = learn_press_get_quiz($quiz_id);
        $questions = array();
        $question_ids = $quiz->get_question_ids();
        
        foreach ($question_ids as $question_id) {
            $question = learn_press_get_question($question_id);
            
            if ($question) {
                $questions[] = array(
                    'id' => $question_id,
                    'title' => $question->get_title(),
                    'content' => $question->get_content(),
                    'type' => $question->get_type(),
                    'options' => $question->get_data('answer_options'),
                    'explanation' => $question->get_data('explanation'),
                    'order' => $question->get_order()
                );
            }
        }
        
        return $questions;
    }
    
    /**
     * Obtenir les tentatives de quiz d'un utilisateur
     */
    private function get_user_quiz_attempts($user_id, $quiz_id, $course_id) {
        global $wpdb;
        
        $attempts = $wpdb->get_results($wpdb->prepare("
            SELECT ui.*, uim.meta_value as results
            FROM {$wpdb->prefix}learnpress_user_items ui
            LEFT JOIN {$wpdb->prefix}learnpress_user_itemmeta uim 
                ON ui.user_item_id = uim.learnpress_user_item_id 
                AND uim.meta_key = 'results'
            WHERE ui.user_id = %d 
            AND ui.item_id = %d 
            AND ui.ref_id = %d
            AND ui.item_type = 'lp_quiz'
            ORDER BY ui.start_time DESC
        ", $user_id, $quiz_id, $course_id));
        
        $formatted_attempts = array();
        
        foreach ($attempts as $attempt) {
            $results = maybe_unserialize($attempt->results);
            
            $formatted_attempts[] = array(
                'id' => $attempt->user_item_id,
                'status' => $attempt->status,
                'grade' => $results['grade'] ?? 0,
                'points' => $results['user_points'] ?? 0,
                'max_points' => $results['question_points'] ?? 0,
                'passed' => $results['passed'] ?? false,
                'start_time' => $attempt->start_time,
                'end_time' => $attempt->end_time
            );
        }
        
        return $formatted_attempts;
    }
    
    /**
     * Vérifier l'accès à un cours
     */
    private function user_can_access_course($user_id, $course_id) {
        // Admin a toujours accès
        if (user_can($user_id, 'manage_options')) {
            return true;
        }
        
        // Instructeur du cours
        if (get_post_field('post_author', $course_id) == $user_id) {
            return true;
        }
        
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return false;
        }
        
        // Cours gratuit ou preview
        if ($course->is_free() || $course->is_preview()) {
            return true;
        }
        
        // Vérifier l'inscription LearnPress
        $user = learn_press_get_user($user_id);
        $course_data = $user->get_course_data($course_id);
        
        if ($course_data && in_array($course_data->get_status(), array('enrolled', 'finished'))) {
            return true;
        }
        
        // Vérifier avec PMPro si actif
        if (function_exists('pmpro_has_membership_access')) {
            $hasaccess = pmpro_has_membership_access($course_id, $user_id, true);
            if ($hasaccess[0]) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Obtenir le cours d'une leçon/quiz
     */
    private function get_lesson_course($item_id) {
        global $wpdb;
        
        $course_id = $wpdb->get_var($wpdb->prepare("
            SELECT s.section_course_id 
            FROM {$wpdb->prefix}learnpress_section_items si
            JOIN {$wpdb->prefix}learnpress_sections s ON si.section_id = s.section_id
            WHERE si.item_id = %d
            LIMIT 1
        ", $item_id));
        
        return $course_id;
    }
    
    /**
     * Appliquer les filtres d'abonnement
     */
    private function apply_membership_filters($args, $user_id) {
        if (!function_exists('pmpro_getMembershipLevelForUser')) {
            return $args;
        }
        
        $level = pmpro_getMembershipLevelForUser($user_id);
        
        if (!$level && get_option('col_lms_require_membership')) {
            // Utilisateur sans abonnement - montrer seulement les cours gratuits
            $args['meta_query'][] = array(
                'key' => '_lp_price',
                'value' => '0',
                'compare' => '='
            );
        } elseif ($level) {
            // Filtrer selon les catégories autorisées du niveau
            $allowed_categories = get_option('pmpro_level_' . $level->id . '_categories', array());
            
            if (!empty($allowed_categories)) {
                $args['tax_query'][] = array(
                    'taxonomy' => 'course_category',
                    'field' => 'term_id',
                    'terms' => $allowed_categories
                );
            }
        }
        
        return $args;
    }
}