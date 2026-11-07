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
The Worker is `apps/cloud`; the product sandbox image is `apps/cloud/sandbox` (CLOUD-04). This run
used the spike image that preceded it; the product image replaced that carrier. The driver built the desktop's
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
   not set it, so the sidecar refused to start. The Worker's container environment sets the product
   image's `/opt/conducted/agent-binaries`, and the entry creates the writable folders.
2. The WebSocket relay must frame one JSON-RPC message per line before the sidecar's Unix socket.
   The spike driver added the newline itself; the desktop's tunnel leaves framing to the transport,
   so the Rust relay now appends it and the cloud transport splits incoming frames on newlines.
3. The spike image installed Claude Code at `/usr/local/bin/claude`, not in the sidecar's managed
   program folder. CLOUD-04's product image installs the managed copies, so a cloud launch now
   carries no Mac path at all.

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

## Follow-up: keep work across restarts (CLOUD-06, 2026-11-07)

Built the parts the spike's criterion 4 said the product needs: an R2 `DirectoryBackup` of `/workspace`, the agents' transcript folders and a restore when a stopped sandbox starts, driven by the turn-end signal the entry reads from the relay (D105). Run on the owner's account with the product image, one `basic` instance, Worker `conducted-dev-c06-131323`.

- **Cold start after the deploy:** `POST /w/c06-live/start` took **10.1 s** round trip; the Worker reported `readyMs` **9,333 ms**, with the sidecar ready **818 ms** after the entry started.
- **A successful Claude turn:** 7 session events, idle **7.3 s** after the send. The turn-end hook saved three objects straight away: `/workspace` **20,311 B**, `/root/.claude` **41,075 B**, `/root/.codex` **261 B**.
- **The restart:** `kill -TERM 1` inside the container (the entry's own shutdown path) took the sandbox out; the Durable Object reported `running: false` **1.1 s** later. `POST /start` then took **1.4 s** (1,372 ms) and restored the three directories before it answered.
- **What came back:** the uncommitted `wip.txt` ("uncommitted work"), both marker files in `/root/.claude` and `/root/.codex`, the real Claude transcript `projects/-workspace-repo/59fb91db-….jsonl` (184 KB of `/root/.claude` restored), and all 8 `refs/conducted/checkpoints` refs of the session.
- **The chat rehydrated:** a follow-up sent to the restored chat id with `resume.agentSessionId` finished in **16.6 s** with 7 events and answered with the exact first prompt, "Reply with the single word pong and nothing else."
- **One object per directory:** the cleanup Worker's list found exactly the 3 current objects; each turn's save had deleted the 3 it replaced.

A bug the run found, fixed before the restart check: the Durable Object read each relayed WebSocket frame as one JSON message, but the sidecar's Unix socket coalesces several NDJSON lines into one chunk. The idle line was inside a multi-line frame, so the object missed it and kept the keep-alive alarm running. `noteTurn` now reads every line of a frame in order, and a test covers a coalesced working+idle frame.

Everything was deleted: Worker `conducted-dev-c06-131323`, its container application `conducted-dev-c06-sandbox-131323` (`4340dbfde03a49c7a55a3261d076546a`), the image `conducted-dev-c06-131323-workspace-sandbox:wrangler-mw6fcmcq` (`sha256:d2dd8adf…`), the R2 bucket `conducted-dev-c06-131323` and its 3 objects, and the local Docker image by id `d2dd8adfc27e`. Final `wrangler containers list`, `containers images list` and `r2 bucket list` each have no `conducted-dev-c06` entry.

Not measured or not built: a turn that ends while the desktop is disconnected (the entry sees sidecar lines only through the app's WebSocket, so that turn is saved at the next connected turn end); the sidecar's write-ahead event log is not part of the backup, as the spike's loss list has it.

## CLOUD-05 follow-up run (2026-11-07)

The Worker's outbound handler was run on the owner's account to show the sandbox reaching the
model API and GitHub without holding either credential. Worker `conducted-dev-c05-1310`, the
product image from CLOUD-04, the `basic` instance, and the same route and Durable Object as the
CLOUD-03 run. The driver called `/w/ws1/start` and `/w/ws1/exec` with the pairing token; every
command ran inside the container. Secrets were put with `wrangler secret put` from the Keychain
and `gh auth token` by pipe. The Anthropic check used `/v1/models`, so no model tokens were spent.

- **Deploy:** 77.8 s to upload and deploy, including the image build and "ready to run". The
  container application was `conducted-cloud-sandbox`; the image tag was `wrangler-mw6f5zvp`.
- **Cold start:** `POST /w/ws1/start` answered in **11,128 ms**, with the sidecar ready **867 ms**
  after the container's main process started.
- **Warm start:** the next `POST /w/ws1/start` answered in **9 ms** (`started: false`), 91 ms
  including the round trip.
- **No credential in the sandbox:** `sh -c` printing the lengths of `GH_TOKEN`,
  `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` printed 0, 0 and 0.
- **Anthropic swap:** `curl` to `https://api.anthropic.com/v1/models` with
  `x-api-key: provided-by-worker` answered **200** (0.18 s at the server; 250 ms round trip).
- **GitHub swap:** `curl` to `https://api.github.com/user` with no `Authorization` header
  answered **200** (0.32 s at the server; 369 ms round trip).
- **`gh` with the placeholder:** `gh api user` exited 4 with "gh auth login" when the sandbox
  held no `GH_TOKEN`. With `GH_TOKEN=provided-by-worker` in the command's environment it exited 0
  and printed the same login as the Mac's `gh`. This is the placeholder D104 names.
- **Git:** `git ls-remote https://github.com/jahala/conducted.git HEAD` exited 0 and returned
  `a21e71b1b7e53c54cf044f3f956e85b6045d66d3`.
- **Package registries:** `https://registry.npmjs.org/left-pad` answered **200** (0.02 s);
  `https://registry.npmjs.org.example.com/` answered **403**.
- **Outside the allow-list:** `https://example.com/` answered **403** and the Worker logged the
  refusal without a credential.
- **Not measured:** the OpenAI key swap live, because this Mac has no `api.openai.com` Keychain
  entry; it is covered by the workerd tests. The Anthropic check proves the key swap, not a model
  turn.

Everything the run created was deleted: the Worker `conducted-dev-c05-1310` (the URL then answered
404), its container application `conducted-cloud-sandbox` (`00e188fedf75462081861c171b970576`),
and the image `conducted-dev-c05-1310-workspace-sandbox:wrangler-mw6f5zvp`. Both
`wrangler containers list` and `wrangler containers images list` then held no `conducted` entry.
The local `apps/cloud/sandbox/build/` folder and the driver, its JSON record and the pairing-token
file in `/tmp` were trashed. No local Docker image was built.

### CLOUD-05 second run: the sandbox's git environment (2026-11-07)

Run after the container environment gained the `GH_TOKEN` placeholder and the `GIT_*` scrub.
Worker `conducted-dev-c05-1320`, the same product image and `basic` instance.

- **Cold start:** 6,897 ms, with the sidecar ready 500 ms after the container's main process
  started. **Warm start:** 4 ms (58 ms round trip).
- **The environment:** `GH_TOKEN` had length 18 (the `provided-by-worker` placeholder), and
  `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` were absent.
- **`gh` with no per-command environment:** `gh api user` exited 0 and matched the Mac's login.
- **Git over an SSH remote:** `git ls-remote git@github.com:jahala/conducted.git HEAD` exited 0
  and returned `67075a2b513e6b99d66f8c007dc0932bed393f24`, so `url.https://github.com/.insteadOf`
  rewrote the SSH URL to HTTPS and the Worker added the token.
- **The rest of the scrub:** `git config --get core.hooksPath` printed `/dev/null`;
  `git config --get credential.helper` was empty; `git config --get-regexp '^url\.'` printed both
  the `git@github.com:` and `ssh://git@github.com/` rewrites.
- **The swaps:** Anthropic `/v1/models` answered 200 (0.23 s at the server); npm answered 200;
  `example.com` answered 403.

Everything was deleted: the Worker `conducted-dev-c05-1320` (URL 404), its container application
`conducted-cloud-sandbox` (`81addf386f7146a3a8816216b51e103f`), and the image
`conducted-dev-c05-1320-workspace-sandbox:wrangler-mw6fjhw5`. Both container lists then held no
`conducted` entry. The local build folder and `/tmp` files were trashed.

## Follow-up: pairing with the Worker (CLOUD-07, 2026-11-07)

A throwaway Worker under the owner's account, named `conducted-dev-c07-131515`, deployed from
`apps/cloud` with the product sandbox image (`conducted-dev-c07-131515-workspace-sandbox`,
`wrangler-mw6feown`, digest `sha256:28d8ad87fee6…`). No sandbox was started: the pairing route
touches no Durable Object, so this run cost no sandbox time.

| Check (`GET /pair` unless noted)                         | Answer                                                    | Time     |
| -------------------------------------------------------- | --------------------------------------------------------- | -------- |
| a bearer token that is the Worker's `PAIRING_TOKEN`       | 200, `{"service":"conducted-cloud","paired":true}`         | 0.099 s  |
| no token                                                 | 401                                                       | 0.425 s  |
| a wrong token                                            | 401                                                       | 0.052 s  |
| `POST` with the right token                              | 405                                                       | 0.051 s  |
| the shell's own `ask_worker_for_pairing` (temporary Rust integration test) | good token accepted, wrong token refused | 0.09 s   |

The 0.425 s on the first request is the Worker's cold start; every later answer was about 0.05 s.
The deploy took 17.5 s to upload and 2.1 s to publish its triggers; the image was cached from the
CLOUD-04 local build. The Rust test used `cloud::ask_worker_for_pairing`, the function
`cloud_pair` calls; it was removed after the run.

Not exercised in this live run: the macOS Keychain writes of `cloud_pair`/`cloud_unpair` (their
storage is the same `keychain.rs` round trip PLAT-10 tests, and the save order is the ordering
`cloud.rs`'s unit test describes), and the Connections form in a running app window (the container
test over the real composition root and the Connections page test cover it).

Everything the run created was deleted: Worker `conducted-dev-c07-131515` (its URL now answers
404), container application `conducted-dev-c07-sandbox-131515` (`4cea4f9a…`), registry image
`conducted-dev-c07-131515-workspace-sandbox:wrangler-mw6feown`, and the local Docker tag. Final
`wrangler containers list` and `wrangler containers images list` hold no `c07` entry. The local
`apps/cloud/sandbox/build/` folder was removed, and the token file and run notes under `/tmp` were
trashed.

## Follow-up: cloud terminals, run scripts and previews (CLOUD-09, 2026-11-07)

Built the terminal WebSocket and the preview proxy on the owner's account with the product image,
one `basic` instance, Worker `conducted-dev-c09-1408`, driven from this Mac with Node's `ws` client.
The driver opened the Worker's `/w/c09-live/terminal` WebSocket with the pairing token in the
`Authorization` header, sent one JSON `start` message, and read base64 `data`, `exit` and `error`
messages back.

- **Cold start:** `/start` answered in **15,318 ms** round trip, with the Worker reporting
  `readyMs` **14,386 ms** and the sidecar ready 1,175 ms after the entry started.
- **Warm start:** **123 ms** round trip, `readyMs` **25 ms**, `started: false`.
- **A command terminal:** the WebSocket opened in **140 ms**; `ready` arrived at **160 ms**, the
  first output byte at **165 ms**, and `exit: 0` at **167 ms**. The output was
  `HELLO_FROM_CLOUD`. This is the `run` shape a run script uses.
- **An interactive terminal:** `ready` at **141 ms**, first prompt byte at **151 ms**. A resize to
  100x30 and typing `echo INTERACTIVE_OK` both took effect, and `exit` typed in it ended the
  process with code 0.
- **Strict shell options for a cloud setup script:** a command beginning
  `set -euo pipefail\nprintf 'SETUP_OK\n'\nfalse\nprintf 'UNREACHABLE\n'` printed `SETUP_OK` and
  exited **1**; `UNREACHABLE` was absent. In the desktop this prefix is added only for a cloud
  host (`run-scripts.setup.test.ts`).
- **A preview:** a Node HTTP server on port 3000 was started inside the sandbox. `POST
  /w/c09-live/preview-url` with `{"port":3000}` 200'd with a URL, and fetching that URL with no
  pairing token answered **200** with body `preview ok`, in **139 ms** including the URL request.
  A URL with one character changed in its token answered **403**; port 22 answered **400**.
- **Deploy:** the first deploy uploaded the image and Worker in **40.25 s**; a redeploy of code
  only took **7.88 s**.

A bug the run found, fixed before the passing run: a Durable Object RPC method that returns a
`Response` carrying a `webSocket` throws `DataCloneError` ("Could not serialize object of type
\"WebSocket\"") and the Worker answers 500. The terminal and preview routes now go through the
object's own `fetch` handler, where a 101 response and a streamed proxy body are allowed. The
same applies to a preview that upgrades a WebSocket.

Not measured or not built:

- **Previews are under the Worker's hostname, not their own.** The URL is
  `/w/<name>/preview/<token>/<port>/...`, so a dev server that builds absolute asset URLs from `/`
  will not render through it. The spike's note that previews need their own hostname still stands;
  a hostname per preview needs a custom domain and a wildcard route, which this run did not test.
  D108 records the choice and the gap.
- **Terminal text is a bounded line mirror, not a VT screen.** The renderer holds the real screen;
  the mirror serves the agent's output tool and the saved scrollback.
- **No reconnect.** A terminal that loses its stream ends and shows "Connection lost."; it does not
  resume. The sidecar relay's reconnect backoff does not apply to a terminal process.

Everything the run created was deleted: the Worker `conducted-dev-c09-1408` (the URL then answered
404 with Cloudflare error 1042), the container application `conducted-cloud-sandbox`
(`8589fc968e1c466294841c155b90dab9`), the image
`conducted-dev-c09-1408-workspace-sandbox:wrangler-mw6hb5fq`
(`sha256:db4d337bebafc1bf90aeb4122b7148854c29693a72f54e705af088665a42ebac`), the R2 bucket
`conducted-cloud-backups`, and the local Docker image by id `db4d337bebaf`. Final
`wrangler containers list` and `containers images list` held no `conducted` entry, the bucket list
held no `conducted-cloud-backups`, and the local `apps/cloud/sandbox/build/` folder and the run's
`/tmp` files were trashed.

## Follow-up: the deploy flow (CLOUD-08, 2026-11-07)

The app carries its deploy inputs as Tauri resources: `scripts/cloud/prepare-deploy.ts` builds the
sandbox image inputs, bundles the Worker with `wrangler deploy --dry-run` against a config with no
containers, and writes `worker.js`, `deploy.json`, the sandbox `Dockerfile` and `build/` to
`apps/desktop/src-tauri/resources/cloud` (183 MB). One live deploy and uninstall ran through the
Rust `deploy_worker` and `uninstall_worker` from `tests/cloud_deploy_live.rs`, with the repository's
pinned wrangler 4.158.0 and the owner's Docker:

| Check | Result |
| --- | --- |
| deploy, under `conducted-dev-c08-153711` | 73,581 ms |
| the Worker's own `/pair` with the made token | answered 200, `conducted-cloud` |
| uninstall | 14,089 ms |
| the Worker URL after the uninstall | no longer answers the pairing check |
| `containers list --json` for `<name>-sandbox` | gone |
| `containers images list --json`, images named `<name>-…` | none |
| `r2 bucket list` for `<name>` | gone |

The deploy uploads the pre-bundled Worker (`no_bundle: true`) and builds the sandbox image from the
bundled Dockerfile; the bucket name is the Worker name and the container application is
`<worker>-sandbox`. Everything the run made was deleted by its own uninstall, and the final lists
held no `conducted-dev-c08` entry. The local Docker image the build left,
`registry.cloudflare.com/…/conducted-dev-c08-153711-workspace-sandbox:wrangler-mw6kh6io`, was
removed by its id `a6914abad2f6`.

Two command facts the run needed:

- wrangler 4.128.0 (the copy on this Mac's PATH) refuses the sandbox's `durable_object` container
  config: it accepts `scheduling_policy` only `regional`, `moon` or `default`. wrangler 4.158.0,
  the version the repository pins, accepts it. The app therefore refuses a wrangler older than
  4.158 and says to run `npm install -g wrangler@latest`.
- `wrangler r2 bucket list` has no `--json` flag; it prints one `name:           <bucket>` line per
  bucket. `wrangler containers list --json` and `containers images list --json` answer arrays whose
  entries carry `id`/`name` and `name`/`tags`. The uninstall reads those.

Cloudflare's docs (read 2026-11-07) make Docker necessary for our policy: under
`durable_object`, a registry image must be a digest-pinned Cloudflare-managed-registry reference
(`registry.cloudflare.com/<ACCOUNT_ID>/<REPOSITORY>@sha256:<DIGEST>`), and Docker Hub, ECR and GAR
are refused. The deprecated `default` policy accepts those registries without Docker but fixes one
image and instance type in the config. Sources:
https://developers.cloudflare.com/containers/guides/image-management/,
https://developers.cloudflare.com/containers/configuration/scheduling-policy/,
https://developers.cloudflare.com/containers/guides/deploy/.
