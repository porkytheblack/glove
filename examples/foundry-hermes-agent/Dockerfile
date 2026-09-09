FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter glove-foundry-hermes-example... --if-present build

ENV NODE_ENV=production
ENV HERMES_DATA_DIR=/data
ENV FOUNDRY_HOST=0.0.0.0
ENV FOUNDRY_PORT=4244

VOLUME ["/data"]
EXPOSE 4244
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4244/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

WORKDIR /app/examples/foundry-hermes-agent
CMD ["pnpm", "start"]
