#!/usr/bin/env node
/**
 * Gera ícones PWA a partir de src/assets/icon/logo.svg.
 *
 * Saída:
 *   public/icons/icon-{72,96,128,144,152,192,384,512}.png  (purpose "any")
 *   public/icons/icon-maskable-{192,512}.png               (purpose "maskable")
 *   public/icons/apple-touch-icon.png                      (180x180)
 *   public/icons/favicon-32.png                            (32x32 favicon)
 *   public/icons/favicon-16.png                            (16x16 favicon)
 *
 * Estratégia "maskable":
 *   - Android adaptive icons recortam o ícone em formas variadas (círculo,
 *     squircle, etc.). O "safe zone" é um círculo de 80% no centro.
 *   - Geramos uma versão com padding de 20% (cor do tema #000000) pra que
 *     a logo NUNCA seja cortada, independente da máscara.
 *   - A versão "any" usa o SVG full-bleed (sem padding extra).
 *
 * Como rodar:
 *   node scripts/generate-pwa-icons.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_SVG = path.join(PROJECT_ROOT, 'src', 'assets', 'icon', 'logo.svg');
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'icons');

// Cor de fundo do ícone (branco — pra contraste com a logo navy).
const BG_COLOR = '#ffffff';

// Tamanhos pro purpose "any" — logo full-bleed.
const SIZES_ANY = [72, 96, 128, 144, 152, 192, 384, 512];

// Tamanhos pro purpose "maskable" — Android exige só 192 e 512.
const SIZES_MASKABLE = [192, 512];

async function main() {
  if (!fs.existsSync(SRC_SVG)) {
    console.error(`[generate-pwa-icons] SVG não encontrado: ${SRC_SVG}`);
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const svgBuffer = fs.readFileSync(SRC_SVG);

  // ───── 1. PURPOSE "any" ──────────────────────────────────
  // Logo direto, sem padding. Background transparente.
  for (const size of SIZES_ANY) {
    const outPath = path.join(OUT_DIR, `icon-${size}x${size}.png`);
    await sharp(svgBuffer, { density: 384 })
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`✔ icon-${size}x${size}.png`);
  }

  // ───── 2. PURPOSE "maskable" ─────────────────────────────
  // Logo com 20% de padding + background da cor do tema.
  // Safe zone: círculo centralizado de 80% do canvas.
  for (const size of SIZES_MASKABLE) {
    const outPath = path.join(OUT_DIR, `icon-maskable-${size}x${size}.png`);
    // Logo ocupa 78% do canvas — próximo do limite seguro (80% safe zone
    // do Android adaptive icons) pra ficar o maior possível sem cortar.
    const logoSize = Math.round(size * 0.78);
    const padding = Math.round((size - logoSize) / 2);

    // Renderiza o SVG no tamanho da logo (60% do total).
    const logoPng = await sharp(svgBuffer, { density: 384 })
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Cria canvas com cor de tema e centraliza a logo.
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: BG_COLOR,
      },
    })
      .composite([{ input: logoPng, top: padding, left: padding }])
      .png({ compressionLevel: 9 })
      .toFile(outPath);

    console.log(`✔ icon-maskable-${size}x${size}.png`);
  }

  // ───── 3. apple-touch-icon (iOS) ─────────────────────────
  // iOS NÃO suporta transparência no apple-touch-icon — usa cor de fundo.
  // Tamanho oficial: 180x180.
  {
    const APPLE_SIZE = 180;
    // Logo ocupa 92% do canvas (margem mínima pros cantos arredondados do iOS).
    const logoSize = Math.round(APPLE_SIZE * 0.92);
    const padding = Math.round((APPLE_SIZE - logoSize) / 2);

    const logoPng = await sharp(svgBuffer, { density: 384 })
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: APPLE_SIZE,
        height: APPLE_SIZE,
        channels: 4,
        background: BG_COLOR,
      },
    })
      .composite([{ input: logoPng, top: padding, left: padding }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, 'apple-touch-icon.png'));

    console.log(`✔ apple-touch-icon.png (180x180)`);
  }

  // ───── 4. Favicons ───────────────────────────────────────
  for (const size of [16, 32]) {
    await sharp(svgBuffer, { density: 384 })
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, `favicon-${size}.png`));
    console.log(`✔ favicon-${size}.png`);
  }

  console.log('\n[generate-pwa-icons] Concluído!');
  console.log(`  → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('[generate-pwa-icons] Falhou:', err);
  process.exit(1);
});
