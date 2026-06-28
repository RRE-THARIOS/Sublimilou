/**
 * Génère un thumbnail SVG data URI pour un audio.
 * colors : [fond1, fond2, fond3, ondes, orbe]
 */
export function generateAudioThumbnail({ colors, label }) {
  const [c1, c2, c3, cWave, cOrb] = colors;
  const dots = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    const r = 28;
    const x = (50 + Math.cos(angle) * r).toFixed(1);
    const y = (50 + Math.sin(angle) * r).toFixed(1);
    const size = (1.2 + (i % 3) * 0.6).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${cOrb}" opacity="0.55"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="55%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${cOrb}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${cOrb}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="14" fill="url(#g)"/>
  <rect width="100" height="100" rx="14" fill="url(#glow)"/>
  <path d="M8,54 Q18,38 28,54 Q38,70 48,54 Q58,38 68,54 Q78,70 88,54"
        stroke="${cWave}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M8,62 Q22,48 36,62 Q50,76 64,62 Q76,50 88,62"
        stroke="${cWave}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.35"/>
  <circle cx="50" cy="50" r="18" fill="${cOrb}" opacity="0.15"/>
  <circle cx="50" cy="50" r="10" fill="${cOrb}" opacity="0.25"/>
  <circle cx="50" cy="50" r="4.5" fill="${cOrb}" opacity="0.7"/>
  ${dots}
  <text x="50" y="87" text-anchor="middle" font-family="system-ui,sans-serif"
        font-size="8" font-weight="600" fill="${cWave}" opacity="0.8" letter-spacing="0.5">${label}</text>
</svg>`;

  try {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  } catch {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

/**
 * Musiques disponibles pour créer un subliminal.
 * Pour en ajouter une : déposer le fichier dans public/audio/ et ajouter une entrée ici.
 */
export const BUNDLED_AUDIOS = [
  {
    id: '963hz-manifestation',
    title: '963hz – Manifestation 5 min',
    description: 'Fréquence 963hz · Méditation de visualisation',
    file: '/audio/963hz-manifestation.mp4',
    duration: 300,
    mimeType: 'audio/mp4',
    colors: ['#9b7fc4', '#d48faa', '#f0c4a0', 'rgba(255,245,235,0.9)', '#ffe8d0'],
    label: '963 HZ',
  },
];
