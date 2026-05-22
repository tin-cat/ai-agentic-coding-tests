# syntax=docker/dockerfile:1

# better-sqlite3 is a native addon. We compile it in a build stage that has the
# toolchain, then copy only the result into a slim runtime image. Both stages
# share the same base (Debian bookworm), so the compiled binary is ABI-compatible.

# ---- build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain used only if a prebuilt better-sqlite3 binary isn't available for
# the target platform; removed with this stage so it never reaches the runtime.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install production deps against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code.
COPY server.js ./
COPY public ./public

# ---- runtime stage --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Bring over the installed modules and app from the build stage.
COPY --from=build /app /app

# The SQLite database lives on a mounted volume (see DB_PATH), never in the image.
ENV PORT=3000 \
	DB_PATH=/data/chat.db

EXPOSE 3000

# Run as the unprivileged "node" user that ships with the base image.
USER node

CMD ["node", "server.js"]
