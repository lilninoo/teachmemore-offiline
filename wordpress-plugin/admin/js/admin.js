/**
 * Scripts d'administration pour COL LMS Offline API
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

(function($) {
    'use strict';
    
    let charts = {};
    
    /**
     * Initialisation
     */
    $(document).ready(function() {
        initTabs();
        initActions();
        initCharts();
        initRealTimeUpdates();
        initTooltips();
        initFormValidation();
        initTableFilters();
    });
    
    /**
     * Gestion des onglets
     */
    function initTabs() {
        $('.nav-tab').on('click', function(e) {
            e.preventDefault();
            
            const target = $(this).attr('href');
            
            // Mettre à jour les onglets
            $('.nav-tab').removeClass('nav-tab-active');
            $(this).addClass('nav-tab-active');
            
            // Afficher le contenu correspondant
            $('.tab-content').hide();
            $(target).show();
            
            // Sauvegarder l'onglet actif
            if (typeof(Storage) !== "undefined") {
                localStorage.setItem('col_lms_active_tab', target);
            }
        });
        
        // Restaurer l'onglet actif
        if (typeof(Storage) !== "undefined") {
            const activeTab = localStorage.getItem('col_lms_active_tab');
            if (activeTab && $(activeTab).length) {
                $(`a[href="${activeTab}"]`).trigger('click');
            }
        }
    }
    
    /**
     * Actions rapides
     */
    function initActions() {
        // Test de l'API
        $('#test-api').on('click', function() {
            const button = $(this);
            testApi(button);
        });
        
        // Nettoyage des tokens expirés
        $('#clear-expired-tokens').on('click', function() {
            const button = $(this);
            clearExpiredTokens(button);
        });
        
        // Export des statistiques
        $('#export-stats').on('click', function() {
            exportStats();
        });
        
        // Révocation de tokens
        $(document).on('click', '.revoke-token', function() {
            const tokenId = $(this).data('token-id');
            revokeToken(tokenId, $(this));
        });
        
        // Refresh manuel des stats
        $('#refresh-stats').on('click', function() {
            refreshDashboard();
        });
        
        // Filtres d'activité
        $('#apply-filters').on('click', function() {
            applyActivityFilters();
        });
    }
    
    /**
     * Initialiser les graphiques
     */
    function initCharts() {
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js non disponible');
            return;
        }
        
        // Attendre un peu que la page soit complètement chargée
        setTimeout(function() {
            loadChartData();
        }, 1000);
    }
    
    /**
     * Charger les données des graphiques
     */
    function loadChartData() {
        if (typeof col_lms_admin === 'undefined') {
            console.error('Variables admin non disponibles');
            return;
        }
        
        $.ajax({
            url: col_lms_admin.ajax_url,
            type: 'POST',
            data: {
                action: 'col_lms_get_stats',
                nonce: col_lms_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    createApiActivityChart(response.data.api_activity);
                    createPopularCoursesChart(response.data.popular_courses);
                } else {
                    console.error('Erreur lors du chargement des statistiques:', response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Erreur AJAX:', error);
                showNotice('error', 'Erreur lors du chargement des statistiques');
            }
        });
    }
    
    /**
     * Graphique d'activité API
     */
    function createApiActivityChart(data) {
        const canvas = document.getElementById('api-activity-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // Préparer les données
        const labels = data.map(item => {
            const date = new Date(item.date);
            return date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
        });
        
        const values = data.map(item => parseInt(item.count) || 0);
        
        if (charts.apiActivity) {
            charts.apiActivity.destroy();
        }
        
        charts.apiActivity = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Requêtes API',
                    data: values,
                    borderColor: 'rgb(102, 126, 234)',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }
    
    /**
     * Graphique des cours populaires
     */
    function createPopularCoursesChart(data) {
        const canvas = document.getElementById('popular-courses-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // Limiter à 5 cours max pour la lisibilité
        const limitedData = data.slice(0, 5);
        
        const labels = limitedData.map(item => 
            item.title ? truncateText(item.title, 30) : `Cours #${item.course_id}`
        );
        
        const values = limitedData.map(item => parseInt(item.downloads) || 0);
        
        if (charts.popularCourses) {
            charts.popularCourses.destroy();
        }
        
        charts.popularCourses = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Téléchargements',
                    data: values,
                    backgroundColor: [
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(118, 75, 162, 0.8)',
                        'rgba(72, 187, 120, 0.8)',
                        'rgba(246, 173, 85, 0.8)',
                        'rgba(245, 101, 101, 0.8)'
                    ],
                    borderColor: [
                        'rgb(102, 126, 234)',
                        'rgb(118, 75, 162)',
                        'rgb(72, 187, 120)',
                        'rgb(246, 173, 85)',
                        'rgb(245, 101, 101)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    },
                    x: {
                        ticks: {
                            maxRotation: 45
                        }
                    }
                }
            }
        });
    }
    
    /**
     * Tester l'API
     */
    function testApi(button) {
        const originalText = button.text();
        
        button.prop('disabled', true)
              .text(col_lms_admin.strings.loading || 'Test en cours...')
              .addClass('updating-message');
        
        $.ajax({
            url: col_lms_admin.ajax_url,
            type: 'POST',
            data: {
                action: 'col_lms_test_api',
                nonce: col_lms_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    showNotice('success', col_lms_admin.strings.test_success + ` (HTTP ${response.data.status_code})`);
                } else {
                    showNotice('error', col_lms_admin.strings.test_failed + ': ' + (response.data.message || 'Erreur inconnue'));
                }
            },
            error: function(xhr, status, error) {
                showNotice('error', 'Erreur de connexion lors du test: ' + error);
            },
            complete: function() {
                button.prop('disabled', false)
                      .text(originalText)
                      .removeClass('updating-message');
            }
        });
    }
    
    /**
     * Nettoyer les tokens expirés
     */
    function clearExpiredTokens(button) {
        if (!confirm(col_lms_admin.strings.confirm_clear_tokens)) {
            return;
        }
        
        const originalText = button.text();
        
        button.prop('disabled', true)
              .text('Nettoyage...')
              .addClass('updating-message');
        
        $.ajax({
            url: col_lms_admin.ajax_url,
            type: 'POST',
            data: {
                action: 'col_lms_clear_tokens',
                nonce: col_lms_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    showNotice('success', response.data.message);
                    refreshDashboard();
                } else {
                    showNotice('error', 'Erreur lors du nettoyage');
                }
            },
            error: function() {
                showNotice('error', 'Erreur de connexion');
            },
            complete: function() {
                button.prop('disabled', false)
                      .text(originalText)
                      .removeClass('updating-message');
            }
        });
    }
    
    /**
     * Exporter les statistiques
     */
    function exportStats() {
        $.ajax({
            url: col_lms_admin.ajax_url,
            type: 'POST',
            data: {
                action: 'col_lms_export_stats',
                nonce: col_lms_admin.nonce,
                format: 'csv'
            },
            success: function(response) {
                if (response.success) {
                    showNotice('success', response.data.message);
                    if (response.data.download_url) {
                        window.open(response.data.download_url, '_blank');
                    }
                } else {
                    showNotice('error', 'Erreur lors de l\'export');
                }
            },
            error: function() {
                showNotice('error', 'Erreur de connexion');
            }
        });
    }
    
    /**
     * Révoquer un token
     */
    function revokeToken(tokenId, button) {
        if (!confirm('Êtes-vous sûr de vouloir révoquer ce token ?')) {
            return;
        }
        
        button.prop('disabled', true).text('Révocation...');
        
        $.ajax({
            url: col_lms_admin.ajax_url,
            type: 'POST',
            data: {
                action: 'col_lms_revoke_token',
                token_id: tokenId,
                nonce: col_lms_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    button.closest('tr').fadeOut();
                    showNotice('success', 'Token révoqué avec succès');
                } else {
                    showNotice('error', 'Erreur lors de la révocation');
                    button.prop('disabled', false).text('Révoquer');
                }
            },
            error: function() {
                showNotice('error', 'Erreur de connexion');
                button.prop('disabled', false).text('Révoquer');
            }
        });
    }
    
    /**
     * Rafraîchir le tableau de bord
     */
    function refreshDashboard() {
        // Recharger les statistiques
        loadChartData();
        
        // Recharger les stats numériques
        $('.stat-number').each(function() {
            $(this).addClass('pulse');
            setTimeout(() => {
                $(this).removeClass('pulse');
            }, 1000);
        });
        
        showNotice('success', 'Tableau de bord mis à jour');
        
        // Recharger la page après 2 secondes pour actualiser les données
        setTimeout(function() {
            window.location.reload();
        }, 2000);
    }
    
    /**
     * Mises à jour en temps réel
     */
    function initRealTimeUpdates() {
        // Mettre à jour toutes les 5 minutes
        setInterval(function() {
            loadChartData();
        }, 5 * 60 * 1000);
        
        // Mettre à jour les heures "il y a X temps"
        setInterval(function() {
            updateRelativeTimes();
        }, 60 * 1000);
    }
    
    /**
     * Mettre à jour les temps relatifs
     */
    function updateRelativeTimes() {
        $('[data-timestamp]').each(function() {
            const timestamp = $(this).data('timestamp');
            const relativeTime = getRelativeTime(timestamp);
            $(this).text(relativeTime);
        });
    }
    
    /**
     * Obtenir le temps relatif
     */
    function getRelativeTime(timestamp) {
        const now = Date.now();
        const time = new Date(timestamp).getTime();
        const diff = Math.floor((now - time) / 1000);
        
        if (diff < 60) return 'À l\'instant';
        if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
        return `Il y a ${Math.floor(diff / 86400)} j`;
    }
    
    /**
     * Initialiser les tooltips
     */
    function initTooltips() {
        // Tooltips simples
        $('[data-tooltip]').hover(
            function() {
                const tooltip = $('<div class="col-lms-tooltip">')
                    .text($(this).data('tooltip'))
                    .appendTo('body');
                    
                $(this).data('tooltip-element', tooltip);
            },
            function() {
                const tooltip = $(this).data('tooltip-element');
                if (tooltip) {
                    tooltip.remove();
                }
            }
        ).mousemove(function(e) {
            const tooltip = $(this).data('tooltip-element');
            if (tooltip) {
                tooltip.css({
                    left: e.pageX + 10,
                    top: e.pageY - 30
                });
            }
        });
    }
    
    /**
     * Afficher une notice
     */
    function showNotice(type, message) {
        // Supprimer les anciennes notices temporaires
        $('.col-lms-notice-temp').remove();
        
        const notice = $(`
            <div class="notice notice-${type} is-dismissible col-lms-notice-temp">
                <p>${message}</p>
                <button type="button" class="notice-dismiss">
                    <span class="screen-reader-text">Dismiss this notice.</span>
                </button>
            </div>
        `);
        
        $('.wrap h1').after(notice);
        
        // Auto-dismiss après 5 secondes
        setTimeout(() => {
            notice.fadeOut(() => notice.remove());
        }, 5000);
        
        // Click pour dismiss
        notice.find('.notice-dismiss').on('click', function() {
            notice.fadeOut(() => notice.remove());
        });
    }
    
    /**
     * Tronquer le texte
     */
    function truncateText(text, length) {
        return text.length > length ? text.substring(0, length) + '...' : text;
    }
    
    /**
     * Validation des formulaires
     */
    function initFormValidation() {
        // Validation des champs requis
        $('form[data-validate]').on('submit', function(e) {
            let isValid = true;
            
            $(this).find('[required]').each(function() {
                const field = $(this);
                const value = field.val().trim();
                
                if (!value) {
                    field.addClass('error');
                    isValid = false;
                } else {
                    field.removeClass('error');
                }
            });
            
            if (!isValid) {
                e.preventDefault();
                showNotice('error', 'Veuillez remplir tous les champs requis');
            }
        });
        
        // Validation en temps réel
        $('[required]').on('input', function() {
            const field = $(this);
            const value = field.val().trim();
            
            if (value) {
                field.removeClass('error');
            }
        });
    }
    
    /**
     * Gestion des filtres de tableau
     */
    function initTableFilters() {
        // Recherche dans les tableaux
        $('.col-lms-table-search').on('input', function() {
            const searchTerm = $(this).val().toLowerCase();
            const table = $($(this).data('target'));
            
            table.find('tbody tr').each(function() {
                const rowText = $(this).text().toLowerCase();
                $(this).toggle(rowText.includes(searchTerm));
            });
        });
        
        // Filtres par colonne
        $('.col-lms-column-filter').on('change', function() {
            const filterValue = $(this).val();
            const column = $(this).data('column');
            const table = $($(this).data('target'));
            
            table.find('tbody tr').each(function() {
                const cellText = $(this).find(`td:nth-child(${column})`).text().trim();
                
                if (filterValue === '' || cellText === filterValue) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        });
    }
    
    /**
     * Appliquer les filtres d'activité
     */
    function applyActivityFilters() {
        const actionFilter = $('#filter-action').val();
        const userFilter = $('#filter-user').val().toLowerCase();
        
        $('.activity-table tbody tr').each(function() {
            const row = $(this);
            const action = row.find('td:nth-child(2)').text().trim();
            const user = row.find('td:nth-child(3)').text().toLowerCase();
            
            let showRow = true;
            
            if (actionFilter && action !== actionFilter) {
                showRow = false;
            }
            
            if (userFilter && !user.includes(userFilter)) {
                showRow = false;
            }
            
            row.toggle(showRow);
        });
    }
    
    /**
     * Gérer les erreurs globales
     */
    window.addEventListener('error', function(e) {
        console.error('Erreur JavaScript:', e.error);
    });
    
    // Exposer certaines fonctions globalement pour les tests
    window.colLmsAdmin = {
        refreshDashboard: refreshDashboard,
        showNotice: showNotice,
        loadChartData: loadChartData,
        testApi: function() { testApi($('#test-api')); }
    };
    
})(jQuery);

// Fonction globale pour charger les graphiques (compatible avec l'ancien code)
function loadChartData() {
    if (window.colLmsAdmin && window.colLmsAdmin.loadChartData) {
        window.colLmsAdmin.loadChartData();
    }
}
