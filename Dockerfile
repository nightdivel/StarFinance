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

# Copy full source code
COPY . .

# Build frontend for root path
ENV BASE_PATH=/
ENV VITE_API_BASE_URL=/
RUN cd frontend && npm run build

EXPOSE 3000

# On container start: run DB migrations then start backend server
CMD ["sh", "-c", "cd backend && npm run migrate:all && npm start"]