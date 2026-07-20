FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ packages/
# products/pgr overrides @egovernments/digit-ui-module-pgr via esbuild alias
COPY products/ products/
# scripts/vendor-digit-ui-css.js is the prebuild step npm run build depends on
COPY scripts/ scripts/
COPY src/ src/
COPY public/ public/
COPY scripts/ scripts/
COPY esbuild.build.js postcss.config.js tailwind.config.ts ./
RUN npm install --legacy-peer-deps
# npm run build = prebuild (vendored themeable CSS into public/vendor/) + esbuild;
# invoking esbuild.build.js directly skips the prebuild and ships a broken-theme bundle
RUN npm run build

FROM nginx:mainline-alpine
RUN mkdir -p /var/web/digit-ui
COPY --from=build /app/build/ /var/web/digit-ui/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
