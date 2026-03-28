FROM node:22-alpine

WORKDIR /app

COPY package*.json .npmrc ./

ARG NODE_AUTH_TOKEN
RUN if [ -n "$NODE_AUTH_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc; \
    fi
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8788

CMD ["sh", "-c", "npm run migrate && npm run start"]
