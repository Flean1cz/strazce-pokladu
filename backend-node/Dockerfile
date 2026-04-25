FROM node:20-alpine

WORKDIR /app

# Závislosti
COPY package.json .
RUN npm install --production

# Kód
COPY server.js .

# Adresář pro SQLite
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
