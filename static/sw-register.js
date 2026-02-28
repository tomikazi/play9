/* Register the service worker and reload when a new version is active */
(function () {
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/play9/sw.js', { scope: '/play9/' })
      .then(function (reg) {
        reg.addEventListener('updatefound', function () {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        setInterval(function () {
          reg.update();
        }, 60 * 60 * 1000);
      })
      .catch(function () {});
  });
})();
