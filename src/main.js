import { initApp } from './app.js';
import { initTheme } from './theme.js';
import { runSplash } from './splash.js';
import './splash.css';
import './style.css';
import './theme.css';

Promise.all([initTheme(), runSplash(), initApp()]).catch((err) => {
  console.error(err);
  document.body.classList.remove('splash-active');
  document.getElementById('splash')?.remove();
});
