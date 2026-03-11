#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates every icon / image asset that electron-builder expects
 * from a single source PNG located at assets/icons/icon.png.
 *
 * Outputs:
 *   build/icon.png            – 512 × 512 master icon
 *   build/icon.ico            – Windows multi-resolution ICO (16‑256)
 *   build/course-icon.ico     – file-association icon for .lpcourse
 *   build/icons/NxN.png       – Linux icon set (16 → 512)
 *   build/background.png      – macOS DMG background (540 × 380)
 *   build/installerHeader.bmp – NSIS assisted-installer header (150 × 57)
 *   build/installerSidebar.bmp– NSIS assisted-installer sidebar (164 × 314)
 *
 * Requirements (already in devDependencies):
 *   - sharp
 *   - png-to-ico
 */

const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const path = require('path');
const fs = require('fs');

const SOURCE = path.resolve(__dirname, '..', 'assets', 'icons', 'icon.png');
const BUILD = path.resolve(__dirname, '..', 'build');
const ICONS_DIR = path.join(BUILD, 'icons');

const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const BRAND = {
  primary: { r: 102, g: 126, b: 234 },    // #667eea
  secondary: { r: 118, g: 75, b: 162 },    // #764ba2
  dark: { r: 45, g: 55, b: 72 },           // #2d3748
  light: { r: 247, g: 250, b: 252 },       // #f7fafc
};

// ─── helpers ────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function resizeIcon(size) {
  return sharp(SOURCE)
    .resize(size, size, { kernel: size < 64 ? sharp.kernel.lanczos3 : sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Encode raw RGBA pixels into an uncompressed 24-bit BMP (no alpha).
 * Sharp gives us raw RGBA; BMP rows are bottom-up, padded to 4 bytes.
 */
function rgbaToBmp(rawRgba, width, height) {
  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const paddedRow = rowBytes + rowPadding;
  const pixelDataSize = paddedRow * height;
  const fileSize = 54 + pixelDataSize;

  const buf = Buffer.alloc(fileSize);

  // BMP file header (14 bytes)
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  // DIB header – BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);       // planes
  buf.writeUInt16LE(24, 28);      // bits per pixel
  buf.writeUInt32LE(0, 30);       // compression (none)
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);     // horizontal DPI (~72)
  buf.writeInt32LE(2835, 42);     // vertical DPI
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // Pixel data (bottom-up, BGR)
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const a = rawRgba[srcIdx + 3] / 255;
      // Alpha-blend onto white background
      buf[offset++] = Math.round(rawRgba[srcIdx + 2] * a + 255 * (1 - a)); // B
      buf[offset++] = Math.round(rawRgba[srcIdx + 1] * a + 255 * (1 - a)); // G
      buf[offset++] = Math.round(rawRgba[srcIdx + 0] * a + 255 * (1 - a)); // R
    }
    for (let p = 0; p < rowPadding; p++) buf[offset++] = 0;
  }

  return buf;
}

// ─── generators ─────────────────────────────────────────────────────

async function generateMasterIcon() {
  console.log('📦 Generating build/icon.png (512×512)...');
  await sharp(SOURCE)
    .resize(512, 512, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(BUILD, 'icon.png'));
  console.log('   ✓ build/icon.png');
}

async function generateLinuxIcons() {
  console.log('🐧 Generating Linux icons in build/icons/...');
  ensureDir(ICONS_DIR);

  for (const size of LINUX_SIZES) {
    const buf = await resizeIcon(size);
    const outPath = path.join(ICONS_DIR, `${size}x${size}.png`);
    fs.writeFileSync(outPath, buf);
    console.log(`   ✓ ${size}x${size}.png`);
  }
}

async function generateWindowsIco() {
  console.log('🪟  Generating build/icon.ico (multi-resolution)...');

  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    pngBuffers.push(await resizeIcon(size));
  }

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), icoBuffer);
  console.log('   ✓ build/icon.ico');
}

async function generateCourseIcon() {
  console.log('📄 Generating build/course-icon.ico...');

  // Overlay a small document badge on the app icon
  const baseSize = 128;
  const base = await sharp(SOURCE)
    .resize(baseSize, baseSize, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Create a small "page" overlay (bottom-right corner)
  const badgeSize = 48;
  const badge = await sharp({
    create: {
      width: badgeSize,
      height: badgeSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 230 },
    },
  })
    .png()
    .toBuffer();

  const badgeRounded = await sharp(badge)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${badgeSize}" height="${badgeSize}">
            <rect x="4" y="2" width="${badgeSize - 8}" height="${badgeSize - 4}" rx="4" fill="white" stroke="#667eea" stroke-width="2"/>
            <line x1="12" y1="14" x2="${badgeSize - 12}" y2="14" stroke="#667eea" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="22" x2="${badgeSize - 16}" y2="22" stroke="#b794f4" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="30" x2="${badgeSize - 12}" y2="30" stroke="#667eea" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="38" x2="${badgeSize - 20}" y2="38" stroke="#b794f4" stroke-width="2" stroke-linecap="round"/>
          </svg>`
        ),
        blend: 'over',
      },
    ])
    .png()
    .toBuffer();

  const composited = await sharp(base)
    .composite([
      { input: badgeRounded, left: baseSize - badgeSize, top: baseSize - badgeSize },
    ])
    .png()
    .toBuffer();

  // Generate ICO from the composited image at multiple sizes
  const sizes = [16, 32, 48, 64, 128];
  const pngBuffers = [];
  for (const s of sizes) {
    pngBuffers.push(
      await sharp(composited)
        .resize(s, s, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    );
  }

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(BUILD, 'course-icon.ico'), icoBuffer);
  console.log('   ✓ build/course-icon.ico');
}

async function generateDmgBackground() {
  console.log('🍎 Generating build/background.png (540×380 DMG)...');

  const w = 540;
  const h = 380;

  // Gradient background from primary to secondary
  const svgGradient = `
    <svg width="${w}" height="${h}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="50%" style="stop-color:#16213e"/>
          <stop offset="100%" style="stop-color:#0f3460"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.3"/>
          <stop offset="100%" style="stop-color:#764ba2;stop-opacity:0.3"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#bg)"/>
      <rect x="0" y="${h - 80}" width="${w}" height="80" fill="url(#accent)"/>
      <text x="${w / 2}" y="50" text-anchor="middle" fill="rgba(255,255,255,0.6)"
            font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="600">
        LearnPress Offline
      </text>
      <text x="${w / 2}" y="75" text-anchor="middle" fill="rgba(255,255,255,0.3)"
            font-family="Helvetica, Arial, sans-serif" font-size="12">
        Glissez l'application dans le dossier Applications
      </text>
      <!-- Arrow hint -->
      <line x1="200" y1="230" x2="340" y2="230" stroke="rgba(255,255,255,0.15)"
            stroke-width="3" stroke-linecap="round" stroke-dasharray="8,6"/>
      <polygon points="345,225 360,230 345,235" fill="rgba(255,255,255,0.15)"/>
    </svg>`;

  await sharp(Buffer.from(svgGradient))
    .png()
    .toFile(path.join(BUILD, 'background.png'));

  console.log('   ✓ build/background.png');
}

async function generateNsisHeader() {
  console.log('🪟  Generating build/installerHeader.bmp (150×57)...');

  const w = 150;
  const h = 57;
  const iconSize = 40;

  // Create base with brand gradient
  const svgHeader = `
    <svg width="${w}" height="${h}">
      <defs>
        <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#667eea"/>
          <stop offset="100%" style="stop-color:#764ba2"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#hg)"/>
      <text x="${w - 8}" y="35" text-anchor="end" fill="rgba(255,255,255,0.9)"
            font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="600">
        LearnPress
      </text>
      <text x="${w - 8}" y="48" text-anchor="end" fill="rgba(255,255,255,0.6)"
            font-family="Helvetica, Arial, sans-serif" font-size="9">
        Offline
      </text>
    </svg>`;

  const headerBase = await sharp(Buffer.from(svgHeader)).png().toBuffer();

  // Composite the app icon onto the left side
  const iconBuf = await sharp(SOURCE)
    .resize(iconSize, iconSize, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const composited = await sharp(headerBase)
    .composite([{ input: iconBuf, left: 8, top: Math.round((h - iconSize) / 2) }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bmp = rgbaToBmp(composited.data, composited.info.width, composited.info.height);
  fs.writeFileSync(path.join(BUILD, 'installerHeader.bmp'), bmp);
  console.log('   ✓ build/installerHeader.bmp');
}

async function generateNsisSidebar() {
  console.log('🪟  Generating build/installerSidebar.bmp (164×314)...');

  const w = 164;
  const h = 314;
  const iconSize = 80;

  const svgSidebar = `
    <svg width="${w}" height="${h}">
      <defs>
        <linearGradient id="sg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#667eea"/>
          <stop offset="60%" style="stop-color:#764ba2"/>
          <stop offset="100%" style="stop-color:#5a3e85"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sg)"/>
      <text x="${w / 2}" y="${h - 50}" text-anchor="middle" fill="rgba(255,255,255,0.85)"
            font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600">
        LearnPress
      </text>
      <text x="${w / 2}" y="${h - 34}" text-anchor="middle" fill="rgba(255,255,255,0.6)"
            font-family="Helvetica, Arial, sans-serif" font-size="11">
        Offline
      </text>
    </svg>`;

  const sidebarBase = await sharp(Buffer.from(svgSidebar)).png().toBuffer();

  const iconBuf = await sharp(SOURCE)
    .resize(iconSize, iconSize, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const composited = await sharp(sidebarBase)
    .composite([{ input: iconBuf, left: Math.round((w - iconSize) / 2), top: 60 }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bmp = rgbaToBmp(composited.data, composited.info.width, composited.info.height);
  fs.writeFileSync(path.join(BUILD, 'installerSidebar.bmp'), bmp);
  console.log('   ✓ build/installerSidebar.bmp');
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   LearnPress Offline – Icon Generator        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ Source icon not found: ${SOURCE}`);
    console.error('   Place a PNG (ideally 1024×1024) at assets/icons/icon.png');
    process.exit(1);
  }

  const meta = await sharp(SOURCE).metadata();
  console.log(`📐 Source: ${meta.width}×${meta.height} (${meta.format}, ${meta.hasAlpha ? 'with' : 'no'} alpha)`);
  if (meta.width < 512) {
    console.log('   ⚠  Source is smaller than 512px — upscaled icons may look blurry.');
    console.log('      For best quality, provide a 1024×1024 source.\n');
  }
  console.log('');

  ensureDir(BUILD);

  await generateMasterIcon();
  await generateLinuxIcons();
  await generateWindowsIco();
  await generateCourseIcon();
  await generateDmgBackground();
  await generateNsisHeader();
  await generateNsisSidebar();

  console.log('');
  console.log('✅ All icons generated successfully!');
  console.log('');
  console.log('Generated files:');
  console.log('  build/icon.png             – Master icon (512×512)');
  console.log('  build/icon.ico             – Windows app icon');
  console.log('  build/course-icon.ico      – .lpcourse file association icon');
  console.log('  build/icons/*.png          – Linux icon set');
  console.log('  build/background.png       – macOS DMG background');
  console.log('  build/installerHeader.bmp  – NSIS installer header');
  console.log('  build/installerSidebar.bmp – NSIS installer sidebar');
  console.log('');
  console.log('⚠  macOS .icns: electron-builder auto-generates icon.icns from');
  console.log('   build/icon.png when building on macOS. No manual step needed.');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
