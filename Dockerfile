# Build stage
FROM node:16-alpine AS builder

# Installer les dépendances pour la compilation native
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    libc6-compat \
    linux-headers

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package*.json ./

# Installer les dépendances
RUN npm ci --only=production

# Copier le reste de l'application
COPY . .

# Build l'application
RUN npm run build-linux

# Runtime stage
FROM electronuserland/builder:wine

# Installer les dépendances runtime
RUN apt-get update && apt-get install -y \
    libgtk-3-0 \
    libnotify-dev \
    libnss3 \
    libxss1 \
    libasound2 \
    libxtst6 \
    xauth \
    xvfb \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Créer un utilisateur non-root
RUN groupadd -r electron && useradd -r -g electron -G audio,video electron

# Définir le répertoire de travail
WORKDIR /app

# Copier l'application depuis le builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Changer le propriétaire
RUN chown -R electron:electron /app

# Utiliser l'utilisateur non-root
USER electron

# Variables d'environnement
ENV ELECTRON_DISABLE_SECURITY_WARNINGS=true \
    ELECTRON_ENABLE_LOGGING=true

# Exposer le port pour le débogage (optionnel)
EXPOSE 9229

# Commande par défaut
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1024x768x24", "npm", "start"]
