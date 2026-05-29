/**
 * Gera todos os ícones PWA a partir de src/assets/icon/logo.svg
 * usando Sharp (já instalado nas dependências).
 *
 * Saída: placarpro/public/icons/*.png
 *
 * Ícones normais: ocupam 100% do canvas (sem padding).
 * Ícones maskable: aplicam ~12% de padding pra respeitar a "safe zone"
 * que evita corte quando o Android aplica máscaras (círculo, squircle).
 *
 * Uso: cd placarpro && node scripts/gerar-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.resolve(__dirname, '..', 'src', 'assets', 'icon', 'logo.svg');
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(SOURCE)) {
  console.error(`Source não encontrado: ${SOURCE}`);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Configuração dos ícones — [filename, size, isMaskable]
const ICONS = [
  ['favicon-16.png',         16,  false],
  ['favicon-32.png',         32,  false],
  ['icon-72x72.png',         72,  false],
  ['icon-96x96.png',         96,  false],
  ['icon-128x128.png',       128, false],
  ['icon-144x144.png',       144, false],
  ['icon-152x152.png',       152, false],
  ['icon-192x192.png',       192, false],
  ['icon-384x384.png',       384, false],
  ['icon-512x512.png',       512, false],
  ['apple-touch-icon.png',   180, false],
  // Maskable — com padding pra safe zone (Android adaptive icons)
  ['icon-maskable-192x192.png', 192, true],
  ['icon-maskable-512x512.png', 512, true],
];

/** Lê o SVG fonte uma vez (em memória) pra reusar em todas as gerações. */
const svgBuffer = fs.readFileSync(SOURCE);

/**
 * Gera 1 ícone. Pra maskable, aplica 12% de padding (safe zone) com
 * fundo navy (--ion-color-primary) — bate com o tema do app.
 */
async function gerarIcone(filename, size, isMaskable) {
  const out = path.join(OUT_DIR, filename);
  const navy = { r: 28, g: 46, b: 61, alpha: 1 }; // #000000

  if (isMaskable) {
    // Maskable: renderiza o logo em ~76% do canvas, centralizado, com
    // fundo navy preenchendo o resto (safe zone de 12% de cada lado).
    const innerSize = Math.round(size * 0.76);
    const offset = Math.round((size - innerSize) / 2);

    const logoBuffer = await sharp(svgBuffer)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 4, background: navy },
    })
      .composite([{ input: logoBuffer, left: offset, top: offset }])
      .png()
      .toFile(out);
  } else {
    // Normal: renderiza o logo ocupando 100% do canvas, fundo transparente.
    await sharp(svgBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
  }
  console.log(`✓ ${filename} (${size}x${size}${isMaskable ? ' maskable' : ''})`);
}

(async () => {
  console.log(`Gerando ${ICONS.length} ícones de ${path.basename(SOURCE)} → ${path.relative(process.cwd(), OUT_DIR)}/\n`);
  for (const [filename, size, isMaskable] of ICONS) {
    try {
      await gerarIcone(filename, size, isMaskable);
    } catch (err) {
      console.error(`✗ ${filename} — erro:`, err.message);
      process.exitCode = 1;
    }
  }
  console.log('\nPronto.');
})();
