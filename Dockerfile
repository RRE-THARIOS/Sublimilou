# ── Étape 1 : build frontend (Vite = devDependency) ──
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && test -f dist/index.html \
  && grep -q '/assets/' dist/index.html \
  && ! grep -q '/src/main.js' dist/index.html

# ── Étape 2 : runtime (API + fichiers statiques) ──
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Cache bust : changer YTDLP_DATE force le re-téléchargement du binaire
ARG YTDLP_DATE=2026-06-28
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 8080

CMD ["node", "server/index.mjs"]
