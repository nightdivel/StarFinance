FROM node:18-alpine

WORKDIR /app

# System dependencies (CA certificates, curl for healthchecks)
RUN apk add --no-cache ca-certificates curl && update-ca-certificates

# Copy package manifests for root, frontend, and backend
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies
RUN npm install \
 && cd frontend && npm install \
 && cd ../backend && npm install

# Copy default auth images before copying the rest of the source
# Remove any existing auth files first
RUN rm -f ./backend/public/auth-icon.* ./backend/public/auth-bg.*
COPY docs/logo.webp ./backend/public/auth-icon.webp
COPY docs/star-citizen-drake-corsair-ucox3arcnaxkfrdm.webp ./backend/public/auth-bg.webp

# Copy the rest of the source code
COPY . .

# Build frontend for /economy path
ENV BASE_PATH=/economy/
ENV VITE_API_BASE_URL=/economy
RUN cd frontend && npm run build

EXPOSE 3000

# On container start: run DB migrations then start backend server
CMD ["sh", "-c", "cd backend && npm run migrate:all && npm start"]