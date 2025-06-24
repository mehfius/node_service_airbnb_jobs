FROM node:24-slim

WORKDIR /app

# Copia package.json e package-lock.json primeiro para usar cache do npm install
COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]