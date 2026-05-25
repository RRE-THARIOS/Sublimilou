# Sublimilou ✦

App perso pour écouter des subliminaux : colle un lien YouTube → l’audio est importé sur le téléphone → playlists, tags, boucle, minuteur sommeil. Sans pub.

## Déploiement (une seule manip de ta part)

### 1. Pousser sur GitHub

```bash
cd ~/Desktop/subliminaux
git init
git add .
git commit -m "App subliminaux"
gh repo create subliminaux --private --source=. --push
```

(Sans `gh` : crée un repo vide sur github.com, puis `git remote add origin …` et `git push -u origin main`.)

### 2. Connecter Netlify à GitHub (5 min, une fois)

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Choisis **GitHub** → repo `subliminaux`
3. Netlify détecte tout seul :
   - Build : `npm run build`
   - Publish : `dist`
   - Functions : `netlify/functions`
4. **Deploy site**

### 3. Variables d’environnement (optionnel)

| Variable | Valeur |
|----------|--------|
| `YOUTUBE_PROXY_SECRET` | Phrase secrète (recommandé) |
| `COBALT_API_KEY` | Secours si yt-dlp échoue en prod |

L’import YouTube fonctionne **sans clé** grâce à yt-dlp (téléchargé auto sur Netlify au 1er import).

### 4. Sur son iPhone (écoute verrouillée + autre app)

1. Ouvre l’URL Netlify dans **Safari**
2. Partager → **Sur l’écran d’accueil** (obligatoire pour la lecture en arrière-plan)
3. Lance la lecture **depuis l’app installée** (pas seulement un onglet Safari)
4. Verrouille ou change d’app : les contrôles apparaissent sur l’écran de verrouillage / dans le centre de contrôle (pochette, titre, ⏯, suivant/précédent)

## Développement local

Interface seule :

```bash
npm install
npm run dev
```

Avec les fonctions YouTube (import) :

```bash
npx netlify-cli dev
```

Ouvre l’URL affichée (souvent `http://localhost:8888`).

## Fonctionnalités

- Import YouTube → stockage local (IndexedDB)
- **Créer** : musique YouTube + affirmations (texte manuel, voix très basse en boucle, mix gratuit)
- Bibliothèque, tags, playlists
- Lecture en boucle
- Minuteur sommeil (fade out)
- Lecture en arrière-plan + **mode lecteur** (écran verrouillé, centre de contrôle iOS / Android)
- PWA installable, zéro pub

## Coût

Gratuit (Netlify Free + GitHub + synthèse vocale Edge) pour usage perso.

L’onglet **Créer** utilise la fonction `tts-batch` (voix Microsoft Edge, sans clé API) et le mixage se fait dans le navigateur.
