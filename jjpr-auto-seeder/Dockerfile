FROM mcr.microsoft.com/playwright:v1.45.3-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./

RUN corepack enable \
  && corepack prepare pnpm@9.15.4 --activate \
  && pnpm install --prod --ignore-scripts --no-frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]