FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000
RUN mkdir -p data uploads && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
