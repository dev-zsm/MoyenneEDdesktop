
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const root = path.resolve(__dirname, '..', '..');
const svgPath = path.join(root, 'renderer', 'assets', 'logo.svg');
const svg = fs.readFileSync(svgPath);

function renderPng(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

(async () => {
  const png256 = renderPng(256);
  fs.writeFileSync(path.join(root, 'renderer', 'assets', 'logo.png'), png256);
  console.log('✓ logo.png (256)');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => renderPng(s));
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  console.log('✓ build/icon.ico (' + sizes.join(', ') + ')');
})();
