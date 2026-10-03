import path from 'node:path';

/**
 * Chemins des ressources du dashboard, résolus relativement à ce fichier :
 *  - dev  (tsx)  : <racine>/dashboard/lib → <racine>/dashboard/views
 *  - prod (dist) : <racine>/dist/dashboard/lib → <racine>/dist/dashboard/views (copiées par scripts/copy-assets.js)
 */
export const DASHBOARD_ROOT = path.resolve(__dirname, '..');
export const VIEWS_DIR = path.join(DASHBOARD_ROOT, 'views');
export const PUBLIC_DIR = path.join(DASHBOARD_ROOT, 'public');
