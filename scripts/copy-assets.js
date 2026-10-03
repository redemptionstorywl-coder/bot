// Copie les ressources non-TS dans dist/ après compilation (locales, vues EJS, fichiers statiques).
const fs = require('node:fs');
const path = require('node:path');

function copyDir(src, dest, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, filter);
    else if (filter(s)) fs.copyFileSync(s, d);
  }
}

const root = path.resolve(__dirname, '..');
copyDir(path.join(root, 'src/locales'), path.join(root, 'dist/src/locales'), (f) => f.endsWith('.json'));
copyDir(path.join(root, 'dashboard/views'), path.join(root, 'dist/dashboard/views'));
copyDir(path.join(root, 'dashboard/public'), path.join(root, 'dist/dashboard/public'));
console.log('✔ Ressources copiées dans dist/');
