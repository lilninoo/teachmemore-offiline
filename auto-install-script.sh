#!/bin/bash
# install.sh - Script d'installation automatique LearnPress Offline

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logo ASCII
echo -e "${BLUE}"
cat << "EOF"
 _                           ____                         
| |    ___  __ _ _ __ _ __ |  _ \ _ __ ___  ___ ___     
| |   / _ \/ _` | '__| '_ \| |_) | '__/ _ \/ __/ __|    
| |__|  __/ (_| | |  | | | |  __/| | |  __/\__ \__ \    
|_____\___|\__,_|_|  |_| |_|_|   |_|  \___||___/___/    
                                                         
          ___   __  __ _ _              
         / _ \ / _|/ _| (_)_ __   ___   
        | | | | |_| |_| | | '_ \ / _ \  
        | |_| |  _|  _| | | | | |  __/  
         \___/|_| |_| |_|_|_| |_|\___|  
                                        
EOF
echo -e "${NC}"

echo -e "${GREEN}=== Installation de LearnPress Offline ===${NC}\n"

# Vérifier le système d'exploitation
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
fi

echo -e "🖥️  Système détecté : ${YELLOW}$OS${NC}\n"

# Fonction pour vérifier les prérequis
check_prerequisites() {
    echo -e "${BLUE}📋 Vérification des prérequis...${NC}"
    
    # Vérifier Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        echo -e "✅ Node.js installé : $NODE_VERSION"
    else
        echo -e "❌ Node.js n'est pas installé"
        echo -e "${YELLOW}Veuillez installer Node.js v16+ depuis : https://nodejs.org${NC}"
        exit 1
    fi
    
    # Vérifier npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        echo -e "✅ npm installé : v$NPM_VERSION"
    else
        echo -e "❌ npm n'est pas installé"
        exit 1
    fi
    
    # Vérifier Git
    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        echo -e "✅ Git installé : $GIT_VERSION"
    else
        echo -e "⚠️  Git n'est pas installé (optionnel)"
    fi
    
    echo ""
}

# Fonction pour créer la structure du projet
create_project_structure() {
    echo -e "${BLUE}📁 Création de la structure du projet...${NC}"
    
    # Créer les dossiers nécessaires
    directories=(
        "src/js"
        "src/css"
        "lib"
        "assets/icons"
        "assets/images"
        "database"
        "build"
        "scripts"
        "tests"
        "wordpress-plugin"
        ".github/workflows"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
        echo -e "✅ Créé : $dir"
    done
    
    echo ""
}

# Fonction pour télécharger les fichiers depuis GitHub
download_files() {
    echo -e "${BLUE}📥 Téléchargement des fichiers...${NC}"
    
    # Si vous avez un repository GitHub
    if [ ! -z "$GITHUB_REPO" ]; then
        git clone "$GITHUB_REPO" temp_download
        cp -r temp_download/* .
        rm -rf temp_download
        echo -e "✅ Fichiers téléchargés depuis GitHub"
    else
        echo -e "${YELLOW}⚠️  Veuillez copier manuellement tous les fichiers fournis${NC}"
    fi
    
    echo ""
}

# Fonction pour installer les dépendances
install_dependencies() {
    echo -e "${BLUE}📦 Installation des dépendances...${NC}"
    
    if [ -f "package.json" ]; then
        npm install
        echo -e "✅ Dépendances installées"
    else
        echo -e "❌ package.json non trouvé"
        echo -e "${YELLOW}Créez d'abord tous les fichiers du projet${NC}"
        exit 1
    fi
    
    echo ""
}

# Fonction pour configurer l'environnement
setup_environment() {
    echo -e "${BLUE}⚙️  Configuration de l'environnement...${NC}"
    
    # Générer la clé de chiffrement
    if [ ! -f ".env" ]; then
        npm run generate-key
        echo -e "✅ Clé de chiffrement générée"
    else
        echo -e "✅ Fichier .env déjà présent"
    fi
    
    # Créer les icônes par défaut si nécessaire
    if [ ! -f "assets/icons/icon.png" ]; then
        echo -e "${YELLOW}⚠️  Créez une icône 1024x1024 dans assets/icons/icon.png${NC}"
    fi
    
    echo ""
}

# Fonction pour tester l'installation
test_installation() {
    echo -e "${BLUE}🧪 Test de l'installation...${NC}"
    
    # Lancer les tests
    npm test
    
    if [ $? -eq 0 ]; then
        echo -e "✅ Tests passés avec succès"
    else
        echo -e "⚠️  Certains tests ont échoué"
    fi
    
    echo ""
}

# Fonction pour afficher les prochaines étapes
show_next_steps() {
    echo -e "${GREEN}🎉 Installation terminée !${NC}\n"
    
    echo -e "${BLUE}📝 Prochaines étapes :${NC}"
    echo -e "1. Installer le plugin WordPress dans votre site"
    echo -e "2. Créer une icône 1024x1024 si ce n'est pas fait"
    echo -e "3. Tester l'application : ${YELLOW}npm start${NC}"
    echo -e "4. Builder pour distribution : ${YELLOW}npm run build-$OS${NC}"
    
    echo -e "\n${BLUE}🚀 Commandes utiles :${NC}"
    echo -e "- Démarrer en dev : ${YELLOW}npm run dev${NC}"
    echo -e "- Lancer les tests : ${YELLOW}npm test${NC}"
    echo -e "- Nettoyer : ${YELLOW}npm run clean${NC}"
    echo -e "- Build : ${YELLOW}npm run build-all${NC}"
    
    echo -e "\n${BLUE}📚 Documentation :${NC}"
    echo -e "- Guide complet : ${YELLOW}README.md${NC}"
    echo -e "- Installation : ${YELLOW}INSTALLATION.md${NC}"
    echo -e "- Contribution : ${YELLOW}CONTRIBUTING.md${NC}"
}

# Menu principal
main_menu() {
    echo -e "${BLUE}Que souhaitez-vous faire ?${NC}"
    echo "1) Installation complète (recommandé)"
    echo "2) Vérifier les prérequis seulement"
    echo "3) Installer les dépendances seulement"
    echo "4) Configurer l'environnement seulement"
    echo "5) Quitter"
    
    read -p "Votre choix (1-5) : " choice
    
    case $choice in
        1)
            check_prerequisites
            create_project_structure
            install_dependencies
            setup_environment
            test_installation
            show_next_steps
            ;;
        2)
            check_prerequisites
            ;;
        3)
            install_dependencies
            ;;
        4)
            setup_environment
            ;;
        5)
            echo -e "\n${BLUE}Au revoir !${NC}"
            exit 0
            ;;
        *)
            echo -e "\n${RED}Choix invalide${NC}"
            main_menu
            ;;
    esac
}

# Vérifier si le script est lancé dans le bon dossier
if [ ! -f "package.json" ] && [ "$1" != "--init" ]; then
    echo -e "${YELLOW}⚠️  Attention : package.json non trouvé${NC}"
    echo -e "Assurez-vous d'être dans le dossier du projet ou utilisez --init\n"
    read -p "Continuer quand même ? (o/n) : " continue_anyway
    if [ "$continue_anyway" != "o" ]; then
        exit 1
    fi
fi

# Lancer le menu principal
main_menu

echo -e "\n${GREEN}✨ Script terminé !${NC}"