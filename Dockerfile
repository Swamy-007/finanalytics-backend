FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Remove dev dependencies after build to keep image lean
RUN npm prune --production

# Cloud Run injects PORT=8080 at runtime
EXPOSE 8080

CMD ["node", "dist/app.js"]
