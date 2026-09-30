# BTRpro production image. Works on Railway, Render, or Fly.io.
# Mount a persistent volume at /data: the SQLite database and uploaded files live there.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/btrpro.db \
    UPLOAD_DIR=/data/uploads \
    PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
