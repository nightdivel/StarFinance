FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmjs.org/ \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-fund --no-audit; else npm install --omit=dev --no-fund --no-audit; fi

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4005

EXPOSE 4005

CMD ["npm", "start"]
