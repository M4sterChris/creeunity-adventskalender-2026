FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PRIVATE_CALENDAR_DIR=/content CALENDAR_DATA_DIR=/data
COPY --chown=node:node package.json index.html styles.css script.js theme.js github-editor.js text-format.js puzzles.js puzzle-client.js media.js ./
COPY --chown=node:node assets ./assets
COPY --chown=node:node server ./server
COPY --chown=node:node tools/publish-doors.mjs tools/send-file.mjs ./tools/
USER node
EXPOSE 8080
CMD ["node", "server/app.mjs"]
