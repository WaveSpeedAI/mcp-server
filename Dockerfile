# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist

# Drop root before running the server (CWE-250). The node:*-alpine images
# already ship an unprivileged `node` user, so no useradd is needed.
USER node

# MCP stdio server
ENTRYPOINT ["node", "dist/index.js"]
