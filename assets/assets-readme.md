# Assets Required for LearnPress Offline

## 📁 Structure des dossiers

```
assets/
├── icons/
│   ├── icon.png           # 1024x1024 - Icon source pour toutes les plateformes
│   ├── icon.ico          # Windows icon (multi-résolution)
│   ├── icon.icns         # macOS icon
│   └── linux/
│       ├── 16x16.png
│       ├── 32x32.png
│       ├── 48x48.png
│       ├── 64x64.png
│       ├── 128x128.png
│       ├── 256x256.png
│       └── 512x512.png
├── images/
│   ├── placeholder.png    # 400x300 - Image par défaut pour les cours
│   ├── logo.svg          # Logo vectoriel de l'application
│   └── splash/
│       ├── splash.png    # 800x600 - Splash screen
│       └── splash@2x.png # 1600x1200 - Splash screen haute résolution
└── build/
    ├── installerHeader.bmp    # 150x57 - Header pour l'installeur Windows
    └── installerSidebar.bmp   # 164x314 - Sidebar pour l'installeur Windows
```

## 🎨 Création des assets

### 1. Icon principal (icon.png)
- **Dimensions** : 1024x1024 pixels
- **Format** : PNG avec transparence
- **Design** : Logo simple et reconnaissable
- **Couleurs** : Utiliser le violet (#667eea) comme couleur principale

### 2. Génération automatique des icons
Utiliser `electron-icon-builder` :
```bash
npm install -D electron-icon-builder
npx electron-icon-builder --input=assets/icons/icon.png --output=build
```

### 3. Placeholder pour les cours
Créer une image simple avec :
- Fond gris clair (#f5f5f5)
- Icône de livre ou graduation cap au centre
- Texte "Aucune image" (optionnel)

### 4. Images pour l'installeur Windows
- **installerHeader.bmp** : Banner horizontal avec le logo et nom de l'app
- **installerSidebar.bmp** : Design vertical avec gradient violet

## 🛠️ Outils recommandés

1. **Design** : Figma, Sketch, Adobe XD
2. **Édition** : GIMP, Photoshop, Affinity Designer
3. **Optimisation** : ImageOptim, TinyPNG
4. **Conversion** : 
   - PNG → ICO : [ConvertICO](https://convertico.com/)
   - PNG → ICNS : `iconutil` (macOS) ou [CloudConvert](https://cloudconvert.com/)

## 📐 Guidelines de design

### Couleurs
```css
:root {
  --primary: #667eea;
  --primary-dark: #5a67d8;
  --secondary: #764ba2;
  --success: #48bb78;
  --warning: #f6ad55;
  --danger: #f56565;
  --dark: #2d3748;
  --light: #f7fafc;
}
```

### Typographie
- **Logo** : Sans-serif bold (ex: Montserrat, Poppins)
- **Interface** : System fonts

### Style
- Design moderne et épuré
- Coins arrondis (8-12px)
- Ombres subtiles
- Gradients doux

## 📦 Assets temporaires

En attendant la création des vrais assets, vous pouvez utiliser :

### Générer un placeholder SVG
```html
<!-- Sauvegarder comme placeholder.svg -->
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="300" fill="#f5f5f5"/>
  <text x="200" y="150" text-anchor="middle" fill="#999" font-size="20">
    Image du cours
  </text>
</svg>
```

### Icon temporaire
```html
<!-- Sauvegarder comme icon.svg -->
<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="#667eea" rx="200"/>
  <text x="512" y="600" text-anchor="middle" fill="white" font-size="400" font-weight="bold">
    LP
  </text>
</svg>
```

Convertir en PNG :
```bash
# Avec ImageMagick
convert -background none icon.svg -resize 1024x1024 icon.png
```

## ✅ Checklist des assets

- [ ] `icon.png` - 1024x1024
- [ ] `icon.ico` - Multi-résolution pour Windows
- [ ] `icon.icns` - Pour macOS
- [ ] Icons Linux (toutes les tailles)
- [ ] `placeholder.png` - Image par défaut
- [ ] `installerHeader.bmp` - Header Windows
- [ ] `installerSidebar.bmp` - Sidebar Windows
- [ ] `logo.svg` - Logo vectoriel
- [ ] Favicon pour la version web (si applicable)

## 🚀 Script de génération

Créer `scripts/generate-icons.js` :
```javascript
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const inputFile = path.join(__dirname, '../assets/icons/icon.png');
const outputDir = path.join(__dirname, '../build/icons');

async function generateIcons() {
    await fs.mkdir(outputDir, { recursive: true });
    
    for (const size of sizes) {
        await sharp(inputFile)
            .resize(size, size)
            .toFile(path.join(outputDir, `${size}x${size}.png`));
        
        console.log(`✓ Généré ${size}x${size}.png`);
    }
}

generateIcons().catch(console.error);
```

Puis exécuter : `node scripts/generate-icons.js`