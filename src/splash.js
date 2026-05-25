const DEFAULT_DURATION_MS = 2000;
const DEFAULT_FADE_MS = 520;

/**
 * Écran d’accueil au lancement (~2 s), puis fondu vers l’app.
 * @returns {Promise<void>}
 */
export function runSplash({ duration = DEFAULT_DURATION_MS, fade = DEFAULT_FADE_MS } = {}) {
  const el = document.getElementById('splash');
  if (!el) {
    document.body.classList.remove('splash-active');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      el.classList.add('is-visible');
    });

    window.setTimeout(() => {
      el.classList.add('is-leaving');
      document.body.classList.remove('splash-active');

      window.setTimeout(() => {
        el.remove();
        resolve();
      }, fade);
    }, duration);
  });
}
