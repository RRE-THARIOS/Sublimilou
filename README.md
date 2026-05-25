# Subliminaux ✦

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

### 3. Variables d’environnement (recommandé)

Dans Netlify → **Site configuration** → **Environment variables** :

| Variable | Valeur | Obligatoire |
|----------|--------|-------------|
| `YOUTUBE_PROXY_SECRET` | Une phrase longue au hasard | Recommandé |
| `COBALT_API_KEY` | Clé API [cobalt.tools](https://cobalt.tools) | Si l’import YouTube échoue souvent |
| `COBALT_API_URL` | `https://api.cobalt.tools` | Non (défaut) |

Puis **Trigger deploy** une fois.

L’import essaie d’abord des instances **Piped** (gratuit), puis **Cobalt** si tu as mis une clé.

### 4. Sur son iPhone

1. Ouvre l’URL Netlify dans **Safari**
2. Partager → **Sur l’écran d’accueil**
3. Utilise l’app comme une app native

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
- Bibliothèque, tags, playlists
- Lecture en boucle
- Minuteur sommeil (fade out)
- Media Session (contrôles écran verrouillé quand iOS le permet)
- PWA installable, zéro pub

## Coût

Gratuit (Netlify Free + GitHub) pour usage perso.
