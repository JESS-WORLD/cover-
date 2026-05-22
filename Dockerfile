FROM node:20-slim

WORKDIR /app

# Install production deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY server.mjs ./
COPY backup.mjs ./
COPY public ./public
COPY data ./data

# Stash a copy of the seed data outside the mount path so we can
# seed an empty volume on first boot.
RUN cp -r data data-seed

# Fly/Railway inject PORT at runtime; default to 4040 for local
ENV PORT=4040
EXPOSE 4040

# On start: if the volume is empty, copy the seed data in. Then run.
CMD sh -c '\
  if [ ! -f data/case-studies.json ]; then \
    echo "[init] Seeding data from image..."; \
    cp -rn data-seed/. data/ 2>/dev/null || true; \
  fi && \
  mkdir -p data/media && \
  node server.mjs'
