import { getSetting, setSetting } from './db.js';
import { iconMoon, iconSun } from './icons.js';

const STORAGE_KEY = 'sublimilou-theme';
const META_COLORS = { light: '#FFF9F5', dark: '#241f26' };

export function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

  try {
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    /* quota / mode privé */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? META_COLORS.dark : META_COLORS.light);

  syncThemeToggleUi();
}

function syncThemeToggleUi() {
  const btn = document.getElementById('toggle-theme');
  if (!btn) return;

  const dark = getTheme() === 'dark';
  btn.setAttribute('aria-label', dark ? 'Activer le mode clair' : 'Activer le mode sombre');
  btn.setAttribute('aria-pressed', String(dark));

  const slot = btn.querySelector('.ui-icon');
  if (slot) slot.innerHTML = dark ? iconSun : iconMoon;
}

export function mountThemeToggle() {
  const btn = document.getElementById('toggle-theme');
  if (!btn || btn.dataset.mounted === 'true') return;

  btn.dataset.mounted = 'true';
  syncThemeToggleUi();

  btn.addEventListener('click', () => {
    void toggleTheme();
  });
}

export async function initTheme() {
  let theme = 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    } else {
      const fromDb = await getSetting('theme', 'light');
      if (fromDb === 'dark' || fromDb === 'light') theme = fromDb;
    }
  } catch {
    /* ignore */
  }

  applyTheme(theme);
}

export async function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await setSetting('theme', next);
}
