FROM node:20-alpine
WORKDIR /app
# Копируем package.json и package-lock.json из backend
COPY ../../backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
# Копируем весь backend
COPY ../../backend ./backend
EXPOSE 3000
CMD ["node", "backend/services/tools/server.js"]
