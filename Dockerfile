FROM node:lts-alpine

# Create app directory
WORKDIR /usr/src/app

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV PORT=3006

# Install dependencies first to take advantage of Docker layer caching
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi

# Copy remaining source files
COPY . .

EXPOSE 3006

CMD ["node", "server.js"]