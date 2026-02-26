FROM node:22-slim

# Install build tools for native deps (bcrypt, pg)
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./

# Install all dependencies
RUN npm install --legacy-peer-deps

# Copy source and build
COPY src ./src
COPY tsconfig.json ./
RUN npx tsc

# Prune dev dependencies
RUN npm prune --omit=dev --legacy-peer-deps 2>/dev/null; exit 0

EXPOSE 3001

CMD ["node", "dist/index.js"]
