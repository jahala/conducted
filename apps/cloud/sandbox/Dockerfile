# CLOUD-04 sandbox image: git, gh, Claude Code, Codex, Cursor's SDK and our sidecar.
#
# The programs sit at the managed-program paths the sidecar's finder reads (D088, PLAT-28):
# `/opt/conducted/agent-binaries/<program>/<version>/<program>`, with a link in
# `/opt/conducted/bin`. A managed agent never falls back to a copy on PATH. Cursor's SDK is a
# package tree rather than a program: `/opt/conducted/agent-binaries/cursor/<version>/node_modules/`
# with a `cursor/current` link, the layout the program manager leaves on the Mac (AGENT-09, D083).
#
# Build the two programs into build/ first, then this image:
#   bun apps/cloud/sandbox/build.ts
#   docker build --platform linux/amd64 -t conducted-sandbox apps/cloud/sandbox
#
# No secret is baked in. The model key and the GitHub token reach the sandbox only through the
# Worker's outbound handler (CLOUD-05); the sandbox itself holds placeholders at most.
FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d

ENV DEBIAN_FRONTEND=noninteractive
ENV CONDUCTED_APP_VERSION=0.3.1
ENV CONDUCTED_LOG_LEVEL=info
ENV PATH=/opt/conducted/bin:$PATH

# Git (the version the app pins), ripgrep (the agents' search), sshd for CLOUD-12 and the base
# tools the releases need. Debian trixie pins, read from the base image on 2026-11-07.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bash \
		ca-certificates \
		curl \
		git=1:2.47.3-0+deb13u1 \
		openssh-client \
		openssh-server \
		procps \
		ripgrep=14.1.1-1+b4 \
	&& rm -rf /var/lib/apt/lists/*

# CLOUD-12: host keys for sshd. The entry starts sshd on loopback only; the Worker installs the
# Mac's public key in /root/.ssh/authorized_keys at each start.
RUN ssh-keygen -A \
	&& mkdir -p /root/.ssh /run/sshd

# The two folders the managed-program layout needs: the links and our scripts, and the copies.
RUN mkdir -p /opt/conducted/bin /opt/conducted/agent-binaries

# GitHub CLI 2.100.0, the version the app pins (D024). The SHA-256 is GitHub's asset digest.
RUN set -eux; \
	curl -fsSL -o /tmp/gh.tar.gz \
		https://github.com/cli/cli/releases/download/v2.100.0/gh_2.100.0_linux_amd64.tar.gz; \
	echo "e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be  /tmp/gh.tar.gz" | sha256sum -c -; \
	tar -xzf /tmp/gh.tar.gz -C /tmp; \
	install -D -m 0755 /tmp/gh_2.100.0_linux_amd64/bin/gh /opt/conducted/agent-binaries/gh/2.100.0/gh; \
	ln -s /opt/conducted/agent-binaries/gh/2.100.0/gh /opt/conducted/bin/gh; \
	rm -rf /tmp/gh.tar.gz /tmp/gh_2.100.0_linux_amd64

# Claude Code 2.1.308, the version the app pins. The Linux x64 package is Anthropic's native
# release; npm checks the registry's integrity for it.
RUN npm install --prefix /tmp/claude --no-save --ignore-scripts --no-audit --no-fund \
		@anthropic-ai/claude-code-linux-x64@2.1.308 \
	&& install -D -m 0755 /tmp/claude/node_modules/@anthropic-ai/claude-code-linux-x64/claude \
		/opt/conducted/agent-binaries/claude/2.1.308/claude \
	&& ln -s /opt/conducted/agent-binaries/claude/2.1.308/claude /opt/conducted/bin/claude \
	&& rm -rf /tmp/claude

# Codex 0.164.0, the version the app pins. The upstream musl binary is static. The SHA-256 is
# GitHub's asset digest.
RUN set -eux; \
	curl -fsSL -o /tmp/codex.tar.gz \
		https://github.com/openai/codex/releases/download/rust-v0.164.0/codex-x86_64-unknown-linux-musl.tar.gz; \
	echo "90dd0b03b28afcb7fa733a4f73b413db2916a47347efd43fb669cc1c774ee8e4  /tmp/codex.tar.gz" | sha256sum -c -; \
	tar -xzf /tmp/codex.tar.gz -C /tmp; \
	install -D -m 0755 /tmp/codex-x86_64-unknown-linux-musl /opt/conducted/agent-binaries/codex/0.164.0/codex; \
	ln -s /opt/conducted/agent-binaries/codex/0.164.0/codex /opt/conducted/bin/codex; \
	rm -rf /tmp/codex.tar.gz /tmp/codex-x86_64-unknown-linux-musl

# Cursor's SDK 1.3.1, the version the app installs on demand (AGENT-09), plus the Linux x64 native
# package the SDK publishes for this image. The tree is the app's release feed's exact tree (D123).
# npm checks the registry's integrity for every package.
RUN npm install --prefix /tmp/cursor --no-save --ignore-scripts --no-audit --no-fund \
		@cursor/sdk@1.3.1 \
		@cursor/sdk-linux-x64@1.3.1 \
		@bufbuild/protobuf@1.10.0 \
		@connectrpc/connect@1.7.0 \
		@connectrpc/connect-web@1.7.0 \
		@statsig/js-client@3.31.0 \
		@statsig/client-core@3.31.0 \
		zod@4.6.7 \
	&& mkdir -p /opt/conducted/agent-binaries/cursor/1.3.1 \
	&& cp -a /tmp/cursor/node_modules /opt/conducted/agent-binaries/cursor/1.3.1/node_modules \
	&& ln -s /opt/conducted/agent-binaries/cursor/1.3.1 /opt/conducted/agent-binaries/cursor/current \
	&& rm -rf /tmp/cursor

# The Cloudflare Sandbox helper the Worker's exec and backup calls need, from the same release.
COPY --from=cloudflare/sandbox:1.0.3@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

# The two programs and the three scripts are staged by `bun apps/cloud/sandbox/build.ts`.
COPY build/conducted-sidecar /opt/conducted/conducted-sidecar
COPY build/entry /opt/conducted/entry
COPY build/bin/checkpointer.sh build/bin/git-busy-check.sh build/bin/spotlighter.sh /opt/conducted/bin/
RUN chmod 0755 /opt/conducted/conducted-sidecar /opt/conducted/entry \
	&& chmod 0755 /opt/conducted/bin/checkpointer.sh /opt/conducted/bin/git-busy-check.sh /opt/conducted/bin/spotlighter.sh

# The Worker mirrors a repository into /workspace; the sidecar writes its outbox and logs under
# /var/conducted. The entry creates the writable folders it needs, but they exist for a first run.
RUN mkdir -p /workspace \
		/var/conducted/outbox \
		/var/conducted/completions \
		/var/conducted/cursor-sdk-store \
		/var/conducted/log

WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/opt/conducted/entry"]
