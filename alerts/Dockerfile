FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
ENV PORT=8095
EXPOSE 8095
USER node
CMD ["node", "server.js"]
