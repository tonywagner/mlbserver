FROM node:16-alpine

RUN apk update && apk add tzdata

# Create app directory
WORKDIR /mlbserver

# Add data directory
VOLUME /mlbserver/data_directory 

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

EXPOSE 9999 10000
CMD [ "node", "index.js", "--env", "--port", "9999", "--multiview_port", "10000", "--data_directory", "/mlbserver/data_directory" ]
