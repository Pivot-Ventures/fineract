FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app/data
# Inside the container only: the compose network reaches it, nothing publishes the port.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8095 \
    ALERTS_DATA_DIR=/app/data
EXPOSE 8095
VOLUME /app/data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8095)+'/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
