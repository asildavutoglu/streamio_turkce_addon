FROM node:20-alpine

WORKDIR /app

# Install system packages (libarchive-tools/bsdtar handles zip, xz, lzma2)
RUN apk add --no-cache libarchive-tools p7zip tar

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=7000

EXPOSE 7000

CMD ["node", "src/index.js"]
