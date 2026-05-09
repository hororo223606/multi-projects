FROM mcr.microsoft.com/playwright:v1.45.3-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./

RUN npm cache clean --force \
  && npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]