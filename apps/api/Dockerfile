# Built from the monorepo root, e.g.:
#   docker build -f apps/api/Dockerfile -t vocably-api .
# node:sqlite (used by license-store.ts) requires Node >=22.5 — see the
# `engines` field in the root package.json.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY apps/extension/package.json apps/extension/package.json
RUN npm ci
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build --workspace=@vocably/core
RUN npm run build --workspace=@vocably/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --omit=dev --workspace=@vocably/api --workspace=@vocably/core
# node_modules/@vocably/core is an npm-workspaces symlink straight to
# packages/core, whose package.json points `main` at the TS source — fine
# for Vite/Vitest, which handle .ts directly, but Node refuses to
# type-strip anything found under node_modules at runtime. Point this
# image's copy at the compiled output instead; the real repo file (used
# for dev/test) is left untouched since this only edits the image.
RUN npm pkg set main=./dist/index.js types=./dist/index.d.ts --workspace=@vocably/core
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/core/dist packages/core/dist

# Mount a volume at this path and point LICENSE_DB_PATH at a file inside it
# — the container filesystem itself is not persistent across deploys.
VOLUME /data

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
