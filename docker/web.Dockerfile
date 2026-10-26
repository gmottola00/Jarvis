# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
