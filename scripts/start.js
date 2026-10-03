/* eslint-disable no-console */
// Point d'entrée de `npm start` : compile si nécessaire, applique les migrations, puis lance le bot.
// Permet un déploiement sur Render/Railway/Heroku même si la commande de build est un simple `npm install`.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'dist', 'src', 'index.js');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root, env: process.env });

if (!fs.existsSync(entry)) {
  console.log('▶ dist/ absent : compilation du projet…');
  run('npx prisma generate');
  run('npx tsc -p tsconfig.json');
  run('node scripts/copy-assets.js');
}

if (process.env.SKIP_MIGRATIONS !== '1') {
  try {
    console.log('▶ Application des migrations Prisma…');
    run('npx prisma migrate deploy');
  } catch (err) {
    console.error('▲ Migrations non appliquées :', err.message);
  }
}

require(entry);
