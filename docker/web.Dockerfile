# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /web/dist /usr/share/nginx/html
# Templates in /etc/nginx/templates are rendered with envsubst into conf.d on
# start, so one image works wherever the backend's name differs.
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_UPSTREAM=backend:8000
EXPOSE 80
