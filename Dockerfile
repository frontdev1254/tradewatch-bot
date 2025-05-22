FROM node:20-alpine

WORKDIR /usr/src/app

# Copia apenas os arquivos de dependência
COPY package*.json ./

# Instala as dependências e o PM2 global
RUN npm install -g pm2 && npm install

# Só depois copia o resto da aplicação
COPY . .

EXPOSE 3000

CMD ["pm2-runtime", "config/ecosystem.config.js"]