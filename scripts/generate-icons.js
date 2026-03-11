#!/usr/bin/env node
// generate-icons.js - Génère les icônes pour toutes les plateformes
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'assets', 'icons', 'icon.png');
const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');

const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function generateIcons() {
    if (!fs.existsSync(SOURCE)) {
        console.error('Source icon not found:', SOURCE);
        process.exit(1);
    }

    fs.mkdirSync(BUILD_DIR, { recursive: true });
    fs.mkdirSync(ICONS_DIR, { recursive: true });

    // Linux: PNGs at various sizes
    for (const size of LINUX_SIZES) {
        const outPath = path.join(ICONS_DIR, `${size}x${size}.png`);
        await sharp(SOURCE).resize(size, size).png().toFile(outPath);
        console.log(`  ✓ ${size}x${size}.png`);
    }

    // Windows: .ico (multi-size)
    const icoBuffers = [];
    for (const size of ICO_SIZES) {
        const buf = await sharp(SOURCE).resize(size, size).png().toBuffer();
        icoBuffers.push(buf);
    }
    const icoBuffer = await pngToIco(icoBuffers);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuffer);
    console.log('  ✓ icon.ico');

    // macOS: 512x512 PNG (electron-builder converts to .icns on macOS)
    // Also provide a 1024x1024 icon.png for electron-builder
    await sharp(SOURCE).resize(1024, 1024).png().toFile(path.join(BUILD_DIR, 'icon.png'));
    console.log('  ✓ icon.png (1024x1024 for macOS .icns conversion)');

    // Course file association icon
    const courseIcoBuffers = [];
    for (const size of ICO_SIZES) {
        const buf = await sharp(SOURCE).resize(size, size).png().toBuffer();
        courseIcoBuffers.push(buf);
    }
    const courseIco = await pngToIco(courseIcoBuffers);
    fs.writeFileSync(path.join(BUILD_DIR, 'course-icon.ico'), courseIco);
    console.log('  ✓ course-icon.ico');

    console.log('\nIcons generated successfully!');
}

generateIcons().catch(err => {
    console.error('Error generating icons:', err);
    process.exit(1);
});