# Imagen del workspace del Studio (I5-1, ADR 0019): code-server + Claude Code con settings administrados.
# Todo fijado: imágenes por digest, Claude Code, corepack y gh por versión exacta (gh con verificación de hash).
# Los controles de esta imagen son PREVENTIVOS; los que garantizan siguen siendo la CI, el ruleset y el token
# de la GitHub App sin permiso sobre workflows (I5-2).
FROM node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS node

FROM codercom/code-server:4.146.0@sha256:fc708b18f6c613b5a9d00f1d1801e58376d3df9c5b5de77f5c02d67b711f99c9

ARG CLAUDE_CODE_VERSION=2.1.332
ARG GH_VERSION=2.106.0
ARG GH_SHA256=d76d387b8fe7619b9b7bfdf40883fa2b38f6e80cf773a3f4b1fcd5e8070ab346

USER root

# Node 26 (el mismo de la plataforma y los módulos) para pnpm verify y para Claude Code.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# jq para los hooks; libatomic1 la necesita el binario de Node; git ya viene en la imagen de code-server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq libatomic1 ca-certificates curl \
 && curl -fsSL -o /tmp/gh.deb "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.deb" \
 && echo "${GH_SHA256}  /tmp/gh.deb" | sha256sum -c - \
 && apt-get install -y --no-install-recommends /tmp/gh.deb \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /tmp/gh.deb /var/lib/apt/lists/*

# Claude Code y corepack/pnpm instalados como root en /usr/local: el usuario no puede actualizarlos ni cambiarlos.
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" corepack@0.36.0 \
 && corepack enable pnpm \
 && npm cache clean --force

# Settings administrados (los lee Claude Code en /etc/claude-code/) y hooks: de root y de solo lectura.
COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY hooks/ /opt/plataforma/hooks/
RUN chown -R root:root /etc/claude-code /opt/plataforma \
 && chmod 0755 /etc/claude-code /opt/plataforma /opt/plataforma/hooks \
 && chmod 0444 /etc/claude-code/managed-settings.json \
 && chmod 0555 /opt/plataforma/hooks/*.sh \
 && /opt/plataforma/hooks/probar-hooks.sh

# Sin actualizaciones automáticas: la versión la fija esta imagen [a validar con la versión instalada].
ENV DISABLE_AUTOUPDATER=1

USER coder
WORKDIR /home/coder
