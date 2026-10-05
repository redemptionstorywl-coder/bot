/* Modération › Protection : « Débannir tout le monde » — nombre de bannis, progression en direct (sondage toutes les 2 s), annulation. */
(function () {
  'use strict';
  var UI = window.UI;
  var root = document.querySelector('[data-unban-all]');
  if (!UI || !root) return;
  var statusUrl = root.getAttribute('data-status-url');
  var cancelUrl = root.getAttribute('data-cancel-url');
  var countEl = root.querySelector('[data-unban-count]');
  var form = root.querySelector('[data-unban-form]');
  var submit = root.querySelector('[data-unban-submit]');
  var progress = root.querySelector('[data-unban-progress]');
  var text = root.querySelector('[data-unban-text]');
  var pct = root.querySelector('[data-unban-pct]');
  var bar = root.querySelector('[data-unban-bar]');
  var cancelBtn = root.querySelector('[data-unban-cancel]');
  var timer = null;
  var wasRunning = root.hasAttribute('data-running');
  var allowedInitially = submit ? !submit.disabled : false;

  function n(v) { return Number(v || 0).toLocaleString('fr-FR'); }
  function render(data) {
    var job = data && data.job;
    var running = Boolean(job && job.running);
    if (countEl) {
      if (running) countEl.textContent = 'Débannissement en cours…';
      else if (data && typeof data.count === 'number') countEl.textContent = data.count ? n(data.count) + ' membre(s) banni(s) actuellement.' : 'Aucun membre n’est banni sur ce serveur.';
      else countEl.textContent = 'Nombre de bannis indisponible : le bot doit avoir la permission « Bannir des membres ».';
    }
    if (submit && !running) submit.disabled = !allowedInitially || (data && data.count === 0);
    if (form) form.hidden = running;
    if (progress) progress.hidden = !job;
    if (job) {
      var processed = (job.done || 0) + (job.failed || 0);
      var ratio = job.total ? Math.min(100, Math.round((processed / job.total) * 100)) : (running ? 0 : 100);
      if (bar) bar.style.width = ratio + '%';
      if (pct) pct.textContent = job.total ? ratio + ' %' : '';
      var state = running ? (job.total ? 'En cours' : 'Récupération de la liste des bannis') : job.cancelled ? 'Arrêté' : 'Terminé';
      if (text) text.textContent = state + (job.total ? ' : ' + n(job.done) + ' débanni(s), ' + n(job.failed) + ' échec(s) sur ' + n(job.total) : '');
      if (cancelBtn) cancelBtn.hidden = !running;
    }
    if (wasRunning && !running && job) {
      UI.toast(job.cancelled ? 'Débannissement arrêté : ' + n(job.done) + ' membre(s) débanni(s).' : 'Débannissement terminé : ' + n(job.done) + ' membre(s) débanni(s).', job.failed ? 'warning' : 'success', 6000);
    }
    wasRunning = running;
    clearTimeout(timer);
    if (running) timer = setTimeout(poll, 2000);
  }
  function poll() {
    UI.api('GET', statusUrl).then(render).catch(function () {
      if (countEl) countEl.textContent = 'Nombre de bannis indisponible pour le moment.';
      if (wasRunning) { clearTimeout(timer); timer = setTimeout(poll, 4000); }
    });
  }
  if (cancelBtn) cancelBtn.addEventListener('click', function () {
    cancelBtn.classList.add('is-loading');
    UI.api('POST', cancelUrl, {}).then(function (res) {
      UI.toast(res && res.cancelled ? 'Arrêt demandé : le débannissement s’arrête après le membre en cours.' : 'Aucun débannissement en cours.', 'info');
      poll();
    }).catch(function (err) { UI.toast(err.message || 'Arrêt impossible.', 'error'); }).then(function () { cancelBtn.classList.remove('is-loading'); });
  });
  poll();
})();
