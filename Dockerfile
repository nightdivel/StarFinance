FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies
RUN npm install
RUN cd frontend && npm install
RUN cd backend && npm install

# Copy source code
COPY . .

# Build frontend
# Set base path for Vite production build to support subpath deployment (/economy/)
ENV BASE_PATH=/economy/
# Route API requests through Nginx subpath as well
ENV VITE_API_BASE_URL=/economy
RUN cd frontend && npm run build

EXPOSE 3000

CMD ["npm", "start"]