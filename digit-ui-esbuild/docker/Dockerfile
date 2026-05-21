FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
COPY packages/ packages/
COPY src/ src/
COPY public/ public/
COPY esbuild.build.js ./
RUN npm install --legacy-peer-deps
RUN node esbuild.build.js

FROM nginx:mainline-alpine
RUN mkdir -p /var/web/digit-ui
COPY --from=build /app/build/ /var/web/digit-ui/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
