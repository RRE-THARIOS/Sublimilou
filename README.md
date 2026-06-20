# Sublimilou ✦

App perso pour écouter des subliminaux : colle un lien YouTube → l’audio est importé sur le téléphone → playlists, tags, boucle, minuteur sommeil. Sans pub.

Hébergement : **[Fly.io](https://fly.io)** (serveur Node + yt-dlp, pas Netlify / nginx).

---

## Option Cloud (Supabase)

Sublimilou fonctionne sans cloud (100% local).  
Si tu veux synchroniser entre appareils, utilise Supabase.

### 1) Créer le projet + schéma

1. Crée un projet sur [supabase.com](https://supabase.com)
2. Dans SQL Editor, exécute le fichier `supabase/schema.sql`
3. Dans `Authentication > URL Configuration`, ajoute ton domaine (`https://sublimilou.fly.dev`)

### 2) Variables d’environnement front

Dans `.env` local et/ou sur ton hébergeur front :

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 3) Utilisation dans l’app

- Ouvre l’app, onglet Accueil
- Clique **Connecter**
- Entre ton email (magic link)
- Les pistes/playlists sont sauvegardées local + cloud automatiquement

> Le cloud reste optionnel : sans variables Supabase, l’app reste en mode local uniquement.

---

## Déploiement Fly.io (prod)

### Prérequis

- Compte [fly.io](https://fly.io)
- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) : `brew install flyctl`
- Clé API [Cobalt](https://cobalt.tools) (recommandé pour l’import YouTube depuis le cloud)

### 1. Première fois

```bash
cd ~/Desktop/subliminaux
fly auth login
fly launch --no-deploy
```

Réponds aux questions (région **cdg** = Paris si proposé). Le `fly.toml` est déjà dans le repo.

### 2. Secrets (obligatoire en prod)

```bash
fly secrets set YOUTUBE_PROXY_SECRET="une-longue-phrase-secrète"
```

**Import YouTube** — au moins une des deux options :

| Option | Commande |
|--------|----------|
| Clé API Cobalt | `fly secrets set COBALT_API_KEY="…"` |
| Cookies YouTube (yt-dlp) | voir [Cookies YouTube pour yt-dlp](#cookies-youtube-pour-yt-dlp) |

### 3. Déployer

```bash
fly deploy
```

URL de l’app : `https://sublimilou.fly.dev` (ou le nom choisi à `fly launch`).

### 4. iPhone

1. Ouvre l’URL Fly dans **Safari**
2. Partager → **Sur l’écran d’accueil**
3. Lance la lecture depuis l’**icône** (pas un onglet Safari)

---

## Développement local

**Terminal 1** — API + fichiers buildés :

```bash
npm install
npm run build
npm run dev:server
```

→ [http://localhost:8080](http://localhost:8080)

**Terminal 2** — interface avec rechargement à chaud :

```bash
npm run dev
```

→ [http://localhost:5173](http://localhost:5173) (proxy `/api` → 8080)

Copie `.env.example` en `.env` et remplis `COBALT_API_KEY` pour tester l’import comme en prod.

### iPhone en local (tunnel)

```bash
# Terminal 1 : npm run dev:server
# Terminal 2 : npm run tunnel
```

Ouvre l’URL ngrok sur l’iPhone → Sur l’écran d’accueil.

---

## Cookies YouTube pour yt-dlp

YouTube traite le serveur Fly comme un bot. Les **cookies** d’une session connectée disent à YouTube : « c’est un utilisateur normal », et yt-dlp peut récupérer l’audio.

### Principe

1. Tu te connectes à YouTube dans **Chrome ou Firefox** (compte Google).
2. Tu exportes les cookies du site `youtube.com` en fichier **Netscape** (`cookies.txt`).
3. Sublimilou passe ce fichier à yt-dlp à chaque import (`--cookies cookies.txt`).

### Export des cookies (une fois)

1. Installe l’extension **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)** (Chrome) ou l’équivalent Firefox recommandé par [yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp).
2. Va sur **https://www.youtube.com** (connecté).
3. Clique l’extension → exporte pour **youtube.com** → enregistre `cookies.txt` sur ton Mac.

**Sécurité :** ce fichier = accès à ton compte Google. Ne l’envoie à personne, ne le commit pas. Idéal : un compte Google dédié (pas ton compte principal).

### Fly.io (production)

Le fichier est encodé en base64 et stocké comme secret Fly :

```bash
cd ~/Desktop/subliminaux
fly secrets set YTDLP_COOKIES_B64="$(base64 < cookies.txt | tr -d '\n')" -a sublimilou
fly deploy
```

Au démarrage, le serveur écrit `/tmp/youtube-cookies.txt` et définit `YTDLP_COOKIES_PATH` automatiquement.

Vérifier dans les logs après un import :

```bash
fly logs -a sublimilou | grep -i cookies
# → « ytdlp cookies: chargés depuis YTDLP_COOKIES_B64 »
```

### Dev local

Dans `.env` :

```env
YTDLP_COOKIES_PATH=./cookies.txt
```

Puis `npm run build && npm run dev:server`.

### Entretien

- Les cookies **expirent** (souvent après quelques semaines). Si l’import re-bloque : ré-exporte `cookies.txt` et refais `fly secrets set YTDLP_COOKIES_B64=…`.
- Si Google demande une **validation 2FA**, refais l’export juste après t’être connecté.

---

## Fonctionnalités

- Import YouTube → stockage local (IndexedDB)
- **Créer** : musique YouTube + affirmations (TTS + mix)
- Bibliothèque, tags, playlists
- Lecture arrière-plan + PWA
- Mode sombre

---

## Coût Fly.io

- Plan gratuit limité ; une petite VM **512 Mo** (~quelques €/mois si dépassement)
- `auto_stop_machines` : la machine s’arrête sans trafic → économie
- Pas de double facturation « bande passante proxy » si Cobalt renvoie un lien **direct** (téléphone ↔ Cobalt)

---

## Ancien Netlify

Le dossier `netlify/` reste dans le repo mais **n’est plus utilisé**. Tout passe par `server/`.
