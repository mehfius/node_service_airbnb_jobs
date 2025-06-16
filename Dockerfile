FROM node:24-slim

# Instala dependências do sistema, ngrok e puppeteer (como você já tem)
RUN apt-get update && \
    apt-get install -y curl unzip git libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxfixes3 libxi6 libxtst6 && \
    rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
    | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
    && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
    | tee /etc/apt/sources.list.d/ngrok.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ngrok \
    && rm -rf /var/lib/apt/lists/*


WORKDIR /app

# Copia package.json e package-lock.json primeiro para usar cache do npm install
COPY package*.json ./
RUN npm install

# Depois copia o resto do código
COPY . .

# Define o comando padrão para iniciar o app
CMD ["node", "index.js"]
