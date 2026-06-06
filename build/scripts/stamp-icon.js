
const fs = require('fs');
const path = require('path');
const rceditMod = require('rcedit');
const rcedit = rceditMod.rcedit || rceditMod.default || rceditMod;

const root = path.resolve(__dirname, '..', '..');
const exePath = path.join(root, 'dist', 'win-unpacked', 'MoyenneED Desktop.exe');
const icoPath = path.join(root, 'build', 'icon.ico');

(async () => {
  if (!fs.existsSync(exePath)) {
    console.error('✗ exe introuvable :', exePath);
    console.error('  Lance d\'abord le build (npm run build:win).');
    process.exit(1);
  }
  if (!fs.existsSync(icoPath)) {
    console.error('✗ icône introuvable :', icoPath);
    process.exit(1);
  }

  const pkg = require(path.join(root, 'package.json'));
  await rcedit(exePath, {
    icon: icoPath,
    'version-string': {
      ProductName: 'MoyenneED Desktop',
      FileDescription: 'MoyenneED Desktop',
      CompanyName: 'minec',
      LegalCopyright: '',
      OriginalFilename: 'MoyenneED Desktop.exe',
      InternalName: 'MoyenneED Desktop',
    },
    'file-version': pkg.version,
    'product-version': pkg.version,
  });
  console.log('✓ Icône MEDD gravée dans l\'exe :', path.basename(exePath));
})().catch((e) => {
  console.error('✗ Échec de la gravure de l\'icône :', e.message);
  process.exit(1);
});
