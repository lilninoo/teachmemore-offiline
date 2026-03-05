// navigation.js - Navigation setup (extracted from inline script in index.html)

window.navigationDebug = {
  modulesLoaded: false,
  navigationReady: false,
  lastNavigation: null
};

document.addEventListener('DOMContentLoaded', () => {
  console.log('=== INITIALISATION NAVIGATION ===');
  
  if (!window.showContentPage) {
    window.showContentPage = function(pageId) {
      console.log(`[Navigation Local] Affichage de la page: ${pageId}`);
      
      document.querySelectorAll('.content-page').forEach(page => {
        page.classList.add('hidden');
        page.style.display = 'none';
      });
      
      const targetPage = document.getElementById(`${pageId}-content`);
      if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.style.display = 'block';
        
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
          const titles = {
            'dashboard': 'Tableau de bord',
            'courses': 'Mes cours',
            'downloads': 'Téléchargements',
            'progress': 'Ma progression'
          };
          pageTitle.textContent = titles[pageId] || pageId;
        }
      }
    };
  }
  
  if (!window.loadPageContent) {
    window.loadPageContent = function(page) {
      console.log(`[Navigation Local] Chargement du contenu: ${page}`);
      
      switch(page) {
        case 'dashboard':
          if (window.loadDashboardData) {
            window.loadDashboardData();
          }
          break;
          
        case 'courses':
          if (window.loadCoursesPage) {
            window.loadCoursesPage();
          } else if (window.loadCourses) {
            window.loadCourses();
          }
          break;
          
        case 'downloads':
          if (window.loadDownloadsPage) {
            window.loadDownloadsPage();
          } else {
            const container = document.getElementById('downloads-list');
            if (container) {
              container.innerHTML = '<p>Module de téléchargements en cours de chargement...</p>';
            }
          }
          break;
          
        case 'progress':
          if (window.loadProgressPage) {
            window.loadProgressPage();
          } else {
            const container = document.getElementById('progress-container');
            if (container) {
              container.innerHTML = '<p>Module de progression en cours de chargement...</p>';
            }
          }
          break;
      }
    };
  }
  
  let checkAttempts = 0;
  const maxAttempts = 50;
  
  const checkModulesLoaded = () => {
    checkAttempts++;
    
    const modulesStatus = {
      downloads: typeof window.loadDownloadsPage === 'function',
      progress: typeof window.loadProgressPage === 'function',
      courses: typeof window.loadCoursesPage === 'function',
      showContent: typeof window.showContentPage === 'function',
      loadContent: typeof window.loadPageContent === 'function'
    };
    
    console.log(`[Navigation] Tentative ${checkAttempts}/${maxAttempts}`, modulesStatus);
    
    const essentialModulesLoaded = modulesStatus.downloads && 
                                  modulesStatus.progress;
    
    if (essentialModulesLoaded) {
      console.log('[Navigation] ✅ Modules essentiels chargés');
      window.navigationDebug.modulesLoaded = true;
      setupNavigation();
    } else if (checkAttempts >= maxAttempts) {
      console.error('[Navigation] ⚠️ Timeout - Configuration de la navigation quand même');
      setupNavigation();
    } else {
      setTimeout(checkModulesLoaded, 100);
    }
  };
  
  const setupNavigation = () => {
    console.log('[Navigation] Configuration de la navigation...');
    
    const navItems = document.querySelectorAll('.nav-item');
    console.log(`[Navigation] ${navItems.length} éléments de navigation trouvés`);
    
    navItems.forEach((item) => {
      const newItem = item.cloneNode(true);
      item.parentNode.replaceChild(newItem, item);
      
      newItem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const page = newItem.dataset.page;
        console.log(`[Navigation] Clic sur: ${page}`);
        window.navigationDebug.lastNavigation = page;
        
        if (!page) {
          console.error('[Navigation] Pas de data-page sur l\'élément');
          return;
        }
        
        const contentPage = document.getElementById(`${page}-content`);
        if (!contentPage) {
          console.error(`[Navigation] Page de contenu non trouvée: ${page}-content`);
          return;
        }
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        newItem.classList.add('active');
        
        window.showContentPage(page);
        window.loadPageContent(page);
      });
    });
    
    window.navigationDebug.navigationReady = true;
    console.log('[Navigation] ✅ Navigation configurée avec succès');
    
    window.navigateTo = (page) => {
      console.log(`[Navigation] Navigation programmatique vers: ${page}`);
      const navItem = document.querySelector(`[data-page="${page}"]`);
      if (navItem) {
        navItem.click();
      } else {
        console.error(`[Navigation] Élément de navigation non trouvé pour: ${page}`);
      }
    };
  };
  
  checkModulesLoaded();
});

window.debugNavigation = () => {
  console.log('=== DEBUG NAVIGATION ===');
  console.log('État:', window.navigationDebug);
  console.log('Modules disponibles:', {
    loadDownloadsPage: typeof window.loadDownloadsPage,
    loadProgressPage: typeof window.loadProgressPage,
    loadCoursesPage: typeof window.loadCoursesPage,
    showContentPage: typeof window.showContentPage,
    loadPageContent: typeof window.loadPageContent,
    loadDashboardData: typeof window.loadDashboardData,
    loadCourses: typeof window.loadCourses
  });
  console.log('Pages de contenu:', {
    dashboard: !!document.getElementById('dashboard-content'),
    courses: !!document.getElementById('courses-content'),
    downloads: !!document.getElementById('downloads-content'),
    progress: !!document.getElementById('progress-content')
  });
};

window.testNavigation = (page) => {
  console.log(`[Navigation] Test de navigation vers: ${page}`);
  if (window.navigateTo) {
    window.navigateTo(page);
  } else {
    console.error('[Navigation] navigateTo non disponible');
  }
};

window.reloadPage = (page) => {
  console.log(`[Navigation] Rechargement de la page: ${page}`);
  if (window.loadPageContent) {
    window.loadPageContent(page);
  }
};
