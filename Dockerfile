FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 8080

CMD node_modules/.bin/prisma migrate deploy && node dist/src/main
