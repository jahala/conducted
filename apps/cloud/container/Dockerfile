# CLOUD-03 carrier for the CLOUD-02 spike image: our sidecar (compiled for linux-x64), the
# WebSocket bridge and Claude Code. CLOUD-04 replaces it with the product's image.
# Built by `wrangler deploy`; scripts/build-container.sh fills build/ first.
FROM node:24-trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash ca-certificates git ripgrep procps \
	&& rm -rf /var/lib/apt/lists/*

# The version the sidecar's Claude Agent SDK (0.3.318) was built against.
RUN npm install --global @anthropic-ai/claude-code@2.1.318 && claude --version

# The helper the @cloudflare/sandbox classes run (DirectoryBackup). Same version as the npm package.
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

COPY build/conducted-sidecar build/bridge /opt/conducted/
COPY build/bin/ /opt/conducted/bin/

# A small git repository stands in for a workspace (the spike has no GitHub access).
RUN git config --global user.name "conducted spike" \
	&& git config --global user.email "spike@conducted.invalid" \
	&& git config --global init.defaultBranch main \
	&& mkdir -p /workspace/repo && cd /workspace/repo \
	&& git init -q && printf '# spike workspace\n' > README.md && git add README.md \
	&& git commit -q -m "initial"

WORKDIR /workspace/repo
ENTRYPOINT ["/opt/conducted/bridge"]
