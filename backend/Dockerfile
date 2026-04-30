FROM node:18-alpine

# docker CLI + docker-compose + git needed for admin deploy endpoint
RUN apk add --no-cache docker-cli docker-compose git

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
