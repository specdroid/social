FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json* ./server/
COPY client/package.json client/package-lock.json* ./client/

WORKDIR /app/server
RUN npm ci

WORKDIR /app/client
RUN npm ci

WORKDIR /app
COPY server/ ./server/
COPY client/ ./client/

RUN cp .env.example server/.env 2>/dev/null || true

WORKDIR /app/server
RUN npx prisma generate
RUN npm run build

WORKDIR /app/client
RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache nginx ca-certificates tini

WORKDIR /app

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/prisma ./server/prisma

COPY --from=builder /app/client/dist ./client/dist

COPY nginx.conf /etc/nginx/nginx.conf
COPY ecosystem.config.js ./

RUN npm install -g pm2

RUN mkdir -p /app/logs /app/auth_info_baileys

COPY .env.example /app/server/.env

EXPOSE 80 443

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "nginx && pm2-runtime start ecosystem.config.js"]
