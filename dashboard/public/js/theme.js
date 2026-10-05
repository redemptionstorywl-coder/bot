/* Thème de l'interface, appliqué avant le premier rendu (script synchrone dans <head>, aucun script inline : CSP self).
 * Choix mémorisé dans localStorage (`rs-theme` = dark | light) ; sans choix, prefers-color-scheme décide (voir app.css). */
(function () {
  'use strict';
  try {
    var t = window.localStorage.getItem('rs-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* stockage indisponible (navigation privée…) : thème du système */ }
})();
