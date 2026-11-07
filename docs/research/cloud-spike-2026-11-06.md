# CLOUD-02 spike results: our sidecar in a Cloudflare sandbox

Run on 2026-11-06 against the owner's Cloudflare account, judged by the kill criteria in `docs/plans/cloud-and-remote.md` Part 1.

**Verdict: pass.** All four kill criteria pass with wide margins. Every number below comes from a run whose raw record is in `runs/` (one JSON file per command).

## What was built

```
this Mac: scripts/drive.sh ──wss + Bearer token──▶ Worker conducted-spike-cloud ──▶ Durable Object (one per sandbox name)
  JSON-RPC lines from packages/protocol               auth, routes, Outbound handler      starts the container, relays the WebSocket,
  events stored with the desktop's repositories                                           backs up and restores directories (R2)
                                                                                                   │ getTcpPort(8080)
                                                                     container (basic): bridge ──Unix socket──▶ sidecar (unchanged) ──▶ Claude Code 2.1.318
```

- **Sandbox SDK line.** `@cloudflare/sandbox` 1.0.3, the npm `latest` tag and the 1.0 API (a Durable Object drives `ctx.container`, helper classes such as `DirectoryBackup`). The `sandbox-stable` skill on this Mac still describes the 0.x API, which Cloudflare now files under "Sandbox SDK 0.x". The `sandbox-next` skill matches 1.0, so I followed it and the current docs.
- **Sidecar.** It runs unchanged. `scripts/build.sh` compiles `packages/sidecar/src/main.ts` with `bun build --compile --target bun-linux-x64-baseline`. The real change would be a `linux-x64` row in `SIDECAR_TARGETS` (`packages/sidecar/src/packaging.ts`). The baseline target matters: the plain `bun-linux-x64` build needs AVX2 and crashed under local amd64 emulation ("Illegal instruction"). I did not try it on Cloudflare.
- **Bridge.** `container/bridge.ts` is the container's main process. It starts the sidecar, reads its `SOCKET_PATH=` handshake and relays each WebSocket on port 8080 to the Unix socket, byte for byte. This is the cloud half of what the Rust shell does locally.
- **Driver.** `driver/drive.ts` speaks the sidecar protocol over the Worker's WebSocket. It stores every session event through the desktop's own code: `createSessionEventRepository`, `createSessionRepository`, `createWorkspaceRepository` and `createRepoRepository` from `apps/desktop/src/core/db`. Underneath is a SQLite file built from the app's migrations 0001 to 0004. Each event is acknowledged with `eventPersisted` after the append, and each `deliverEvent` replay is answered with `{ persisted: true }`. The four chats stored 80 events: 9 user messages, 44 agent messages, 18 checkpoints and 9 turn ends. `scripts/drive.sh` bundles the driver with esbuild, for two reasons: Node 26's type stripping refuses the parameter property in `packages/shared/src/not-implemented.ts`, and Bun has no `node:sqlite`.
- **Key handling.** The plan's design, as specified. The sandbox's agent gets `ANTHROPIC_API_KEY=provided-by-worker` through `launch.providerKeys`. The Worker's `Outbound` entrypoint swaps in the real key from a Worker secret for `api.anthropic.com`, and answers 403 for everything else. Checked inside the running sandbox: the Claude process's environment held exactly one `ANTHROPIC_API_KEY`, the placeholder. `https://example.com/` and `https://registry.npmjs.org/` both got 403.
- **Model and turns.** `claude-haiku-5-5` at effort `low` (the cheapest model on Anthropic's models page, read 2026-11-06). 9 turns of the 10 allowed.
- **Instance.** `basic` (1/4 vCPU, 1 GiB, 4 GB disk) for every run. With one chat open, the processes used about 330 MB: Claude Code 183 MB RSS, sidecar 100 to 109 MB, bridge 44 MB. A second chat added 176 MB, leaving 657 MB of the 998 MB free. `lite` (256 MiB) cannot hold one chat, so I did not start it.

## Kill criteria

"First token" here is the first agent event the desktop stores that carries model output (text, thinking or a tool call). The sidecar sends whole agent messages, not token deltas, so this is the moment the app could first show output. The real first token comes a little earlier. All times are measured by the driver on this Mac, from just before its `POST /start` call. The Worker ran in Cloudflare's Oslo location (OSL).

### 1. Warm start to the first token over 15 s: **pass** (worst 8.8 s)

The sandbox was already running for these turns.

| Run (`runs/`)              | Case                                                              | First agent event | First token |
| -------------------------- | ----------------------------------------------------------------- | ----------------- | ----------- |
| `…T11-50-26-962Z-turn` (2) | same chat, agent process already running                          | 1.05 s            | 2.29 s      |
| `…T12-01-29-477Z-turn` (4) | same chat                                                         | 0.87 s            | 2.45 s      |
| `…T13-16-49-265Z-turn` (9) | same chat                                                         | 1.43 s            | 3.12 s      |
| `…T11-55-34-868Z-turn` (3) | new chat: the agent process starts                                | 4.09 s            | 5.25 s      |
| `…T13-11-47-998Z-turn` (7) | chat resumed from a restored transcript, agent starts with resume | 1.85 s            | 3.12 s      |
| `…T12-07-25-934Z-turn` (5) | chat resumed from a restored transcript, agent starts with resume | 6.75 s            | 8.83 s      |

The slowest case is the agent's own start with resume on a 1/4 vCPU instance. It was 1.8 s in one run and 6.7 s in the other.

### 2. Cold start over 2 minutes: **pass** (worst 14.5 s)

The sandbox was stopped before these runs. The times include container start, sidecar start, WebSocket, agent start and first output.

| Run                                                 | Case                                                                   | Sandbox ready                           | First token    |
| --------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | -------------- |
| `…T11-45-05-892Z-turn` (1)                          | first start after deploy                                               | 10.7 s                                  | 14.5 s         |
| `…T13-11-27-162Z-turn` (6)                          | after `destroy()`, new chat                                            | 1.0 s                                   | 5.4 s          |
| `…T13-13-10-917Z-turn` (8)                          | new sandbox name, so a new Durable Object                              | 6.0 s                                   | 10.3 s         |
| `…T13-11-42…-start`, two `…-restore`, then turn (7) | reopen a stopped workspace: start, restore 2 directories, resumed turn | 2.1 s start, 0.65 s and 0.62 s restores | 6.5 s in total |
| `…T12-07-04-471Z-start`                             | after `destroy()`, start only                                          | 1.2 s                                   | (no turn)      |

The sidecar itself was ready 0.53 to 0.70 s after the container's main process started (`health.sidecarMs`). Not measured: a location that has never pulled the image. `wrangler deploy` reported the image "ready to run" before the first start.

### 3. Active hour over 0.15 US dollars of sandbox time: **pass** (0.019 US dollars measured, 0.082 worst case)

Prices are from [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), page dated 2026-10-05, read 2026-11-06. Memory costs 0.0000025 US dollars per GiB-second and disk 0.00000007 per GB-second, both billed on the provisioned size while the instance runs. CPU costs 0.000020 per vCPU-second of active use.

CPU was measured with `/sys/fs/cgroup/cpu.stat` (`usage_usec`) inside the container, as deltas over a window. The counter covers the whole VM, and Cloudflare reuses VMs between instances (uptime 4.2 h on a 6-second-old instance), so only deltas count.

- During a turn (turn 9, between two `exec` reads around `…T13-16-49-265Z-turn`): 0.94 CPU-seconds in a 7.9 s window, which is 11.9 % of one vCPU.
- Idle, with the sidecar and an idle Claude process alive: 1.77 CPU-seconds in 180 s, which is 0.98 %.
- The VM shows 1 CPU (`nproc`), so 100 % of one vCPU is the ceiling.

| Instance                | Memory per hour | Disk per hour | CPU at the measured 11.9 % | Hour total | Worst case, 100 % of 1 vCPU |
| ----------------------- | --------------- | ------------- | -------------------------- | ---------- | --------------------------- |
| basic (used)            | 0.0090          | 0.0010        | 0.0086                     | **0.019**  | **0.082**                   |
| standard-1 (the plan's) | 0.0360          | 0.0020        | 0.0086                     | 0.047      | 0.110                       |

All amounts are in US dollars, before the Workers Paid plan's included usage. Every cell is under 0.15. Real work (installs, builds, tests) uses more CPU than these turns did, which is why the worst-case column matters. Durable Object, Worker and R2 charges are separate and are not sandbox time.

### 4. Work in progress lost across a sandbox restart: **pass** (kept, with an R2 directory backup)

**Method.** I used the plan's "R2 directory backup", taken explicitly and not on stop (the docs say not to rely on SIGTERM). It uses `DirectoryBackup` from `@cloudflare/sandbox` into the R2 bucket `conducted-spike-cloud-backups`, for two directories: `/workspace` (the repository) and `/root/.claude` (Claude's transcripts, for resume).

**Proof**, in `runs/`, in order:

1. Wrote `/workspace/repo/wip.txt` (uncommitted). The agent had written `notes.txt` and `done.txt` in earlier turns.
2. `backup /workspace`: 21,431 bytes in 0.89 s. `backup /root/.claude`: 51,839 bytes in 0.65 s.
3. `destroy()`, then started a new instance: `cat wip.txt` failed with "No such file or directory", and `/root/.claude` was gone. A restart without the method loses everything.
4. Restored `/workspace` in 0.19 s and `/root/.claude` in 0.13 s, measured inside the Durable Object. `wip.txt`, `notes.txt` and `done.txt` came back with their content, `git status` matched, and all 8 checkpoint refs under `refs/conducted` were there.
5. A turn on the restored chat resumed Claude's session. Asked, without tools, for the first thing it was asked in the chat, it answered correctly ("list the files in this folder"). Turn 7 did the same after a second restart.

**What is lost if the sandbox dies mid-turn:** everything written since the last backup. That includes the files the agent changed in that turn, the transcript of that turn, and any events still in the sidecar's write-ahead log (`/var/conducted/outbox`) that the desktop had not acknowledged.

This happened once, by accident. Instance 2 stopped by itself 10 minutes after the last request (the inactivity timeout). Turn 5 had run after the last backup, so its transcript was never saved. The product should back up at every turn end, and after the desktop acknowledges the turn's events.

**Why not snapshots.** Container snapshots (`snapshotContainer()`) save the whole filesystem, installed dependencies included, which would suit the product. But no API lists or deletes them; they expire after 30 days. That breaks this spike's "delete everything" rule, so I did not test them. They are also in public beta. Pushing a work-in-progress ref to GitHub was out of reach: the spike had no GitHub access.

## The plan's questions 3, 4 and 7

**3. Keeping the agent alive.**

- _Disconnect test, turn 4._ The desktop disconnected 2 s after the send was acknowledged and stayed away 45 s. The turn finished inside the sandbox. On reconnect, the sidecar replayed the 7 missed events through `deliverEvent`, and the desktop stored them. The write-ahead log works over the cloud path unchanged.
- _While the desktop is connected._ The Durable Object accepts both ends of the WebSocket, so it stays active and the sandbox keeps running.
- _Once nobody connects._ The instance stops after the inactivity timeout (10 minutes here), whatever runs inside it. This was seen: instance 2 stopped about 10 minutes after its last request.
- _The gap._ The Durable Object sees turn state (`liveState` working or idle) only while the desktop is connected, because that state flows through the relay. A turn that outlasts the timeout with the laptop closed needs another signal. For example, the sidecar or bridge could report turn start and end to the Durable Object through an intercepted internal hostname, and the Durable Object would hold an alarm while a turn runs. Not built and not measured.

**4. Authentication between the app and the Worker.**

- _The token._ A pairing token works. 32 random bytes are made at setup and stored as a Worker secret. On the Mac the spike kept it in a mode-600 file; the product would use the Keychain. It is checked in constant time on every route before any Durable Object is touched.
- _Without it._ A request without the token gets 401 and starts nothing.
- _WebSocket._ The token travels in the `Authorization` header. Node's WebSocket can set headers; WKWebView's cannot. In the app the Rust shell already owns the sidecar relay, so it would hold the cloud WebSocket too and set the header.
- _Not tried._ Cloudflare Access.

**7. Terminals, run scripts and previews.**

- _What was shown._ The path a terminal or preview would use (Worker, Durable Object, `getTcpPort()`, a WebSocket into a container port) carried the sidecar protocol. 20 JSON-RPC round trips took 148 ms minimum, 159 ms median and 257 ms maximum (`runs/2026-11-06T13-12-35Z-rtt.json`, `driver/rtt.mjs`). Typing in a terminal would feel like SSH to a distant server.
- _Run scripts._ `exec()` ran every measurement command.
- _Not exercised._ PTY terminals (`exec` with `pty`) and previews. The docs say previews need their own hostname, so one preview cannot read another's cookies or storage.
- _Network._ Setup and run scripts that fetch packages need the allow-list: npm got 403 here, as the plan intends.

## Other findings

- `wrangler` 4.158 refuses `max_instances` for containers with the `durable_object` scheduling policy. One instance at a time held because the spike used one sandbox name at a time.
- Deleting the Worker leaves its container application running and billing; Wrangler warns about this. The product's uninstall must delete the application, its images and its bucket explicitly.
- A spike bug started one extra sandbox. My `backup` route started a stopped sandbox (it called the shared setup), which backed up the bare image. It was fixed and redeployed (version `b26dc57b`). The product's backup must never start a sandbox.

## Resources created and deleted

The raw log is `runs/resources.log`; the final lists are in `runs/cleanup-proof.txt`. All times are UTC on 2026-11-06.

| Resource                                                                                                                    | Created        | Deleted                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| R2 bucket `conducted-spike-cloud-backups`                                                                                   | 11:42:29       | 13:22:39 (a bucket delete succeeds only when it is empty)  |
| Worker `conducted-spike-cloud`, versions `0b64e69d` and `b26dc57b`, with its Durable Object class `ConductedSpikeWorkspace` | 11:44:27       | 13:22:16, `wrangler delete`                                |
| Container application `conducted-spike-cloud-sandbox` (`62fd892f…`)                                                         | 11:44:27       | 13:22:21, `wrangler containers delete`                     |
| Image `conducted-spike-cloud-conductedspikeworkspace-sandbox:wrangler-mw4wnflu`                                             | 11:44:27       | 13:22:31, `wrangler containers images delete`              |
| Secrets `PAIRING_TOKEN`, `ANTHROPIC_API_KEY` on that Worker                                                                 | 11:44:44       | with the Worker (`secret list` answers "not found")        |
| Backup objects `928835d1…`, `dac0c2cd…`, `f2de38c2…` in the bucket                                                          | 12:06 to 12:20 | 13:21:45, `DirectoryBackup.delete()` (`runs/…forget.json`) |
| Durable Object storage of `conducted-spike-ws1` and `conducted-spike-ws2`                                                   | during runs    | 13:21:45, `deleteAll()`                                    |

The final checks found no `conducted` entry in any of these lists:

- `wrangler containers list`
- `wrangler containers images list`
- `wrangler r2 bucket list`

`wrangler deployments list --name conducted-spike-cloud` and `wrangler secret list` both answer that the Worker does not exist, and the workers.dev URL answers 404.

Wrangler has no command that lists Durable Object namespaces. The namespace's deletion with its Worker is therefore not proven by a list; the dashboard's Durable Objects page would show it.

On this Mac, the spike's two local Docker images were removed. `/tmp/conducted-spike-cloud` (the test database, the pairing token and the bundle) and `/tmp/cspike-docs` were trashed. The spike made no other local files outside the worktree.

## Spend

- **Sandbox starts:** 6 of the 20 allowed. They were starts 1 to 6 in `runs/resources.log`; start 3 was the bug above. One instance ran at a time.
- **Sandbox time:** about 50 minutes on `basic`, in total. At the rates above that is about 0.008 US dollars of memory, 0.001 of disk and at most 0.001 of CPU, so about 0.01 US dollars. That is inside the Workers Paid plan's included monthly usage. I did not read the account's bill.
- **Model:** 9 turns, 0.023 US dollars in total, as reported by Claude Code on each turn's usage item.

## Not measured

- A turn longer than the inactivity timeout with the desktop gone (the alarm design in question 3).
- A cold start in a location without the image already pulled.
- Container snapshots, PTY terminals and previews.
- Which location the container ran in.
- AI Gateway. The key was a Worker secret, which the plan allows.

## How to run it again

From `spike/cloud`:

1. `npm ci`, `npm run types` (generates the Worker types `npm run typecheck` needs) and `scripts/build.sh`.
2. `wrangler r2 bucket create conducted-spike-cloud-backups`, then `wrangler deploy`.
3. Put the two secrets by piping (see `worker/index.ts`).
4. `SPIKE_URL=<workers.dev URL> scripts/drive.sh turn <name> <chat> "<prompt>"`.
5. Delete everything afterwards as in the table above.

## CLOUD-03 follow-up run (2026-11-07)

The first build of the cloud rows, run on the same account and with the same `basic` instance, to
show that the Worker and its Durable Object carry the desktop's own git, shell, file and chat calls.
The Worker is `apps/cloud`; the sandbox image is the spike image above, carried into
`apps/cloud/container` until CLOUD-04 builds the product's image. The driver built the desktop's
real container (`createContainer`, the git service and the sessions service) over the Platform's
`cloud` group; the Rust relay was replaced in the driver by the `ws` package, because the driver
runs in Node.

- **Cold start after the deploy:** `POST /w/ws1/start` answered in **8.0 s** (8,036 ms), with the
  bridge reporting the sidecar ready **441 ms** after the container's main process started.
- **First git status on a cold sandbox:** **7.4 s** (7,435 ms), including the container start.
- **Warm git status:** **0.51 s** and **0.62 s** in two runs.
- **Warm chat turn:** the first agent event arrived **4.1 s** after the send (9.2 s in a second
  run); the turn ended **5.6 s** (10.7 s) later with the text `pong`.
- **Secrets:** the sandbox held only `ANTHROPIC_API_KEY=provided-by-worker`. The Worker's outbound
  handler swapped the real key from a Worker secret for `api.anthropic.com`; the pairing token was a
  Worker secret checked on every route.

Three findings the spike did not have, all fixed before the run passed:

1. The current sidecar requires `CONDUCTED_AGENT_BINARIES_DIR`; the spike image's environment did
   not set it, so the sidecar refused to start. The Worker's container environment now sets it and
   the bridge creates the folder.
2. The WebSocket relay must frame one JSON-RPC message per line before the sidecar's Unix socket.
   The spike driver added the newline itself; the desktop's tunnel leaves framing to the transport,
   so the Rust relay now appends it and the cloud transport splits incoming frames on newlines.
3. The spike image installs Claude Code at `/usr/local/bin/claude`, not in the sidecar's managed
   program folder. A cloud launch therefore names that path until CLOUD-04 installs the managed
   copy.

Everything the run created was deleted: Worker `conducted-dev-cloud03-1107`, its container
application `conducted-cloud-sandbox`, the image `wrangler-mw68dv5s` and the Worker's secrets. The
container was left stopped, so no sandbox billed after the run.

## Follow-up: the product image (CLOUD-04, 2026-11-07)

Built `apps/cloud/sandbox/Dockerfile` on this Mac with `nice -n 10 docker build --platform linux/amd64`, started it, ran the checks below inside it, then removed the container (`a2bd5306cff8`, stopped and removed by id) and the image (`sha256:18184a9b383a…`, removed by id).

| Check, inside the running container         | Output                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `git --version`                             | `git version 2.47.3`                                          |
| `gh --version`                              | `gh version 2.100.0 (2026-09-03)`                             |
| `claude --version`                          | `2.1.308 (Claude Code)`                                       |
| `codex --version`                           | `codex-cli 0.164.0`                                           |
| one JSON-RPC request through the entry      | `{"jsonrpc":"2.0","id":1,"result":{"known":false}}`           |

- **Image size:** 595,921,691 bytes (596 MB decimal) as `docker image inspect` reports it.
- **Managed paths:** `claude`, `codex` and `gh` sit at `/opt/conducted/agent-binaries/<program>/<version>/<program>`, with links in `/opt/conducted/bin`, which is first on PATH.
- **The sidecar's health:** the entry's `/health` went from 503 to 200 after 3.2 s; the sidecar itself was ready 3.1 s after the entry started, under this Mac's amd64 emulation.
- **Emulation note, not an image defect:** `gh --version` crashed in Go's regexp setup under Docker's QEMU (`sigsegv` in `regexp.mergeRuneSets`). With `GODEBUG=asyncpreemptoff=1` it printed the version above. The variable is a QEMU workaround and is not baked into the image; Cloudflare's containers run real amd64.
