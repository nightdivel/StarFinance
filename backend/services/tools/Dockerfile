FROM node:20-alpine
WORKDIR /app
COPY ../../package*.json ./
RUN npm install --omit=dev
COPY ../../backend ./backend
EXPOSE 3000
CMD ["node", "backend/services/tools/server.js"]
