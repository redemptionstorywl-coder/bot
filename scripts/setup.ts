/* eslint-disable no-console */
/**
 * `npm run setup` — vérifie l'environnement avant le premier lancement :
 *  1. version de Node
 *  2. présence et validité du fichier .env
 *  3. connexion MySQL
 *  4. état des migrations Prisma (et propose de les appliquer)
 *  5. validité du token Discord (appel REST /users/@me)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadEnv, maskSecret } from '../src/config/env';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', violet: '\x1b[35m', dim: '\x1b[2m' };
const ok = (m: string) => console.log(`${C.green}✔${C.reset} ${m}`);
const ko = (m: string) => console.log(`${C.red}✖${C.reset} ${m}`);
const warn = (m: string) => console.log(`${C.yellow}▲${C.reset} ${m}`);
const title = (m: string) => console.log(`\n${C.violet}${m}${C.reset}`);

let failures = 0;
const fail = (m: string) => {
  failures++;
  ko(m);
};

async function main(): Promise<void> {
  console.log(`${C.violet}\n  Redemption Story Studio — Assistant d'installation\n${C.reset}`);

  title('1. Node.js');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} détecté — Node 22 LTS ou supérieur requis (https://nodejs.org)`);

  title('2. Fichier .env');
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    fail('.env introuvable. Copiez .env.example vers .env puis complétez-le.');
    return finish();
  }
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
    ok(`Variables valides (token : ${maskSecret(env.DISCORD_TOKEN)}, client : ${env.CLIENT_ID})`);
    if (!env.DISCORD_CLIENT_SECRET) warn('DISCORD_CLIENT_SECRET vide : la connexion au dashboard sera désactivée.');
    if (env.SESSION_SECRET.startsWith('change-me')) warn('SESSION_SECRET est la valeur par défaut : changez-la en production.');
    if (env.FIVEM_API_KEY.startsWith('change-me')) warn('FIVEM_API_KEY est la valeur par défaut : changez-la avant de brancher un serveur FiveM.');
  } catch (err) {
    fail((err as Error).message);
    return finish();
  }

  title('3. Base de données MySQL');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$connect();
    const [row] = await prisma.$queryRaw<{ v: string }[]>`SELECT VERSION() as v`;
    ok(`Connexion réussie (MySQL ${row?.v ?? '?'})`);
    title('4. Migrations Prisma');
    try {
      const out = execSync('npx prisma migrate status', { stdio: 'pipe', env: process.env }).toString();
      if (/Database schema is up to date/i.test(out)) ok('Schéma à jour');
      else {
        warn('Des migrations sont en attente. Application avec `prisma migrate deploy`…');
        execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
        ok('Migrations appliquées');
      }
    } catch (err) {
      const msg = (err as { stdout?: Buffer; message: string }).stdout?.toString() ?? (err as Error).message;
      if (/No migration found|migrations directory/i.test(msg)) {
        warn('Aucune migration trouvée : synchronisation du schéma avec `prisma db push`…');
        execSync('npx prisma db push', { stdio: 'inherit', env: process.env });
        ok('Schéma synchronisé');
      } else fail(`Migrations : ${msg.trim().split('\n').slice(-3).join(' ')}`);
    }
    await prisma.$disconnect();
  } catch (err) {
    fail(`Connexion impossible : ${(err as Error).message.split('\n')[0]}`);
    console.log(`${C.dim}  Vérifiez DATABASE_URL (mysql://utilisateur:motdepasse@hote:3306/base) et que la base existe :\n  CREATE DATABASE redemption_story CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;${C.reset}`);
  }

  title('5. Connexion Discord');
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` } });
    if (res.ok) {
      const me = (await res.json()) as { username: string; id: string };
      ok(`Token valide — connecté en tant que ${me.username} (${me.id})`);
      if (me.id !== env.CLIENT_ID) warn(`CLIENT_ID (${env.CLIENT_ID}) ne correspond pas à l'ID de l'application du token (${me.id}).`);
    } else fail(`Token refusé par Discord (HTTP ${res.status}). Régénérez-le dans le Developer Portal > Bot.`);
  } catch (err) {
    fail(`Impossible de joindre Discord : ${(err as Error).message}`);
  }

  finish(env.CLIENT_ID);
}

function finish(clientId?: string): void {
  console.log('');
  if (failures === 0) {
    ok('Tout est prêt ! Lancez `npm run dev` (développement) ou `npm run build && npm start` (production).');
    if (clientId) console.log(`${C.dim}  Invitation du bot : https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands${C.reset}`);
  } else ko(`${failures} problème(s) à corriger avant de lancer le bot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  ko(`Erreur inattendue : ${(err as Error).message}`);
  process.exit(1);
});
