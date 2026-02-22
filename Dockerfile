FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8788

CMD ["sh", "-c", "npm run migrate && npm run start"]
