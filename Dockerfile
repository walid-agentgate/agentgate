FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
COPY examples ./examples
COPY schema ./schema
COPY assets ./assets
COPY standalone.html README.md LICENSE SECURITY.md ./
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["node", "bin/agentgate.js", "dev"]
