# --- Build Stage ---
FROM node:18-alpine AS build

# Set environment variable to skip the automatic Chromium download by Puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install system-level dependencies for Chromium on Alpine
RUN apk update && apk add --no-cache \
    tzdata \
    udev \
    ttf-freefont \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates

# Create app directory
WORKDIR /mlbserver

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

# --- Runtime Stage ---
FROM node:20-alpine AS runtime

# Install only the necessary runtime dependencies again
RUN apk add --no-cache \
    tzdata \
    udev \
    ttf-freefont \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates

# Set the executable path for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /mlbserver
# Copy built application from the build stage
COPY --from=build /mlbserver .

# Add data directory
VOLUME /mlbserver/data_directory 

EXPOSE 9999 10000
CMD [ "node", "index.js", "--env", "--port", "9999", "--multiview_port", "10000", "--data_directory", "/mlbserver/data_directory" ]
