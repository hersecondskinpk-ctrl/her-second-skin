FROM node:22-alpine

WORKDIR /app

# Copy application files
COPY package.json ./
COPY . .

# Ensure storage directories exist
RUN mkdir -p /data/uploads

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV HSS_DATA_DIR=/data
ENV HSS_DATABASE_PATH=/data/her-second-skin.sqlite
ENV HSS_UPLOAD_DIR=/data/uploads

EXPOSE 8080

CMD ["node", "server.js"]
