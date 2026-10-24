# syntax=docker/dockerfile:1.7
#
# skein-frontend — React + Vite SPA, served by nginx-unprivileged on
# port 5102. Independent deployment artefact (was previously baked
# into skein-web's wwwroot/; split in May 2026 so frontend-only
# changes do not roll the BFF and disrupt SignalR sessions).
#
# Stages:
#   1. frontend-build  — node:22-alpine, runs `npm ci` + `npm run build`
#                        producing dist/. APP_VERSION baked into
#                        /version.json before the build so the bundle
#                        carries its own deployed-version identifier.
#   2. runtime         — nginxinc/nginx-unprivileged:1.27-alpine with
#                        diagnostic utilities, dist copied to nginx
#                        document root, project nginx.conf as the
#                        default server, security-headers snippet.

# ============ Stage 1: frontend-build ============
FROM node:22-alpine AS frontend-build

WORKDIR /build

# Restore in a separate layer so dependency restore is cached when
# only source files change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# APP_VERSION baked into /version.json (Vite auto-copies public/* into
# dist/). nginx serves /version.json with Cache-Control: no-store, the
# SPA polls every 60s and shows an "update available" banner when the
# deployed version diverges from the one the client loaded.
#
# sk-285.7.2.69 — `public/version.json` is COMMITTED, holding the same
# `dev` this ARG defaults to, and the line below overwrites it. The file
# in the tree is what makes the version readable when the app runs
# outside an image (vite dev): without it the fetch is answered with
# index.html, `res.json()` throws, and the account menu quietly loses
# the version row §6 asks for.
ARG APP_VERSION=dev
RUN echo "{\"version\":\"${APP_VERSION}\"}" > public/version.json

RUN npm run build

# ============ Stage 2: runtime ============
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Diagnostic utilities so operators
# can debug a live pod: HTTP probes, network reach, DNS resolution,
# TCP port checks.
USER root
RUN apk add --no-cache \
    curl \
    iputils-ping \
    bind-tools \
    netcat-openbsd
USER nginx

# Built bundle → nginx document root.
COPY --from=frontend-build /build/dist /usr/share/nginx/html

# Project nginx config — replaces the default conf.d/default.conf.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Security-headers snippet — must live under /etc/nginx/snippets so
# the `include /etc/nginx/snippets/security-headers.conf;` directives
# in nginx.conf resolve.
USER root
RUN mkdir -p /etc/nginx/snippets
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
# sk-674.18 T059 — headers of the token pages (Referrer-Policy: no-referrer, CSP).
COPY nginx-token-page-headers.conf /etc/nginx/snippets/token-page-headers.conf

# The license text travels with every copy of the image (BSL 1.1 requires it).
COPY LICENSE /licenses/LICENSE

USER nginx

# Default port — can be overridden via the PORT env var by the
# container runtime; nginx itself listens on whatever `listen`
# directive is baked into nginx.conf (5102 by default).
ENV PORT=5102
EXPOSE 5102
