# Plan: cloud workspaces and Claude Remote Control

Status: approved in principle (2026-11-04). The details below are a first design with open questions; a spike settles them before the work is scaffolded. Decisions: D018 and D019 in [decisions.md](../decisions.md).

## Part 1. Cloud workspaces on the user's own Cloudflare account

### What the user gets

A workspace can live in the cloud instead of on the Mac. The agent keeps working when the laptop sleeps or is closed, several heavy tasks do not slow the Mac down, and the same desktop app shows local and cloud workspaces side by side.

### The model: bring your own Cloudflare

The user deploys our open-source Worker to their own Cloudflare account and adds their own model key. We run no servers, hold no user data and bill nobody.

What it costs the user, from Cloudflare's pricing pages (read 2026-11-04):

- The Sandbox SDK needs the Workers Paid plan: 5 US dollars a month. The free plan has no containers.
- A `standard-1` sandbox (1/2 vCPU, 4 GiB memory, 8 GB disk) costs about 4 to 7 US cents per hour while it runs. Memory and disk are billed while awake; CPU only when busy. The plan includes about 6 such hours a month.
- Model tokens go to the user's own provider account.

Sources: [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [limits](https://developers.cloudflare.com/containers/platform-details/limits/), [Sandbox](https://developers.cloudflare.com/sandbox/), [coding agent runner](https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/).

### How it fits our architecture

```
Desktop app ──HTTPS / WebSocket──▶ user's Worker ──▶ Workspace Durable Object ──▶ Sandbox (container)
  (UI, local DB)                    (auth, routes)     (one per workspace:          git, shell, files,
                                                        state, keep-alive,          our sidecar, agent CLIs
                                                        relay, secrets)
```

- **The sidecar runs inside the sandbox unchanged.** Its session core, runners and write-ahead log already take their I/O as parameters. In the cloud, its NDJSON stream travels over a WebSocket through the Worker instead of a Unix socket. Conductor reuses its session core the same way for its cloud workspaces (research: sessions.md section 0).
- **The UI gains a host per workspace.** Today `core/` runs git, shell, files and terminals on the Mac through the Platform. A workspace names its host (`local`, or `cloud` with the Worker URL and sandbox id), and every git, shell, file, terminal and chat call checks it before it runs (CLOUD-01, D092). A local host goes on to the Platform as before; a cloud host's calls belong to the Worker (CLOUD-03) and the cloud runtime (CLOUD-09). This is the seam D004 removed.
- **Secrets never enter the sandbox.** Following Cloudflare's runner example, the model key lives in AI Gateway or as a Worker secret. The sandbox gets a placeholder key, and the Worker's outbound handler swaps in the real credential. The GitHub token is handled the same way for `git` and `gh`.
- **Network is closed by default.** The outbound allow-list holds GitHub, the model gateway and the package registries the setup script needs.
- **The desktop database stays the record.** Cloud workspaces' events arrive over the same protocol and are stored locally, as for local workspaces.

### What has to be figured out (the spike answers these)

1. **Startup time.** How long from "create workspace" to the first agent token, cold and warm. Cloudflare's docs suggest about a minute for a cold container.
2. **Keeping work.** The sandbox disk is wiped when it stops. Candidates: push a work-in-progress ref to GitHub at each turn end, sandbox snapshots (kept 30 days), or an R2 directory backup on stop. Pick one, and say what is lost if the sandbox dies mid-turn.
3. **Keeping the agent alive.** Work inside the container does not count as activity. The Durable Object must hold an alarm while a turn runs, and let the sandbox sleep when idle (cost).
4. **Authentication between the desktop app and the user's Worker.** A pairing token made at deploy time and kept in the Keychain, or Cloudflare Access.
5. **Deploying.** A "Deploy to Cloudflare" button, or a setup flow in the app that runs `wrangler` with the user's login. The container image is built in the user's account from our Dockerfile.
6. **Which agents run in the cloud.** Claude Code with an API key works per Cloudflare's example. Codex, OpenCode and Pi have runner variants in Cloudflare's docs. A Claude Pro or Max subscription in a cloud machine must be checked against Anthropic's terms before we offer it.
7. **Terminals, run scripts and previews.** Through the sandbox's exec streaming and WebSocket terminal, and previews through the Worker's port forwarding.

### Spike and kill criterion

Build the smallest path: deploy the Worker to a test account, start a sandbox with our sidecar, and run one Claude turn from the desktop app with its events stored locally.

Kill criterion: drop the cloud option, and keep the notes, if any of these fails:

- a warm start to the first token takes over 15 seconds;
- a cold start takes over 2 minutes;
- an active hour costs over 0.15 US dollars in sandbox time;
- work in progress cannot be kept across a sandbox restart.

### Spike result (2026-11-06): passes all four

On the owner's Cloudflare account, with `@cloudflare/sandbox` 1.0.3, the `basic` instance (1/4 vCPU, 1 GiB) and our unchanged sidecar behind a small WebSocket bridge, driven from this Mac with events stored through the desktop's database code. Full numbers and method: [cloud-spike-2026-11-06.md](../research/cloud-spike-2026-11-06.md); the spike code is on the `spike/cloud` branch.

- **Warm start to the first token:** 2.3 to 8.8 s (limit 15 s).
- **Cold start:** 14.5 s after a deploy, 5.4 s after a restart (limit 2 minutes).
- **An active hour:** about 0.019 US dollars measured; 0.082 on `basic` and 0.110 on `standard-1` with the CPU busy all hour (limit 0.15).
- **Work kept across a restart:** yes, with an R2 backup of the workspace and the agent's transcripts; the backup must run at each turn end, since a sandbox that dies mid-turn loses everything after the last one.
- What the build needs that the spike found: a Linux build of the sidecar; the Rust shell owns the cloud connection (the web view cannot set WebSocket headers); a pairing token as a Worker secret; a package allow-list for setup scripts; the sidecar telling the Worker a turn is running, so a long turn survives the laptop closing; deleting a Worker leaves its container application billing, so an uninstall deletes both.

## Part 2. Claude Remote Control

### What the user gets

Any Claude chat in Conducted can be opened in claude.ai/code or the Claude app on a phone. From there the user reads along, sends follow-ups, answers approvals and questions, and interrupts. The agent keeps running in Conducted, locally or in a cloud workspace. Conductor does not offer this: its bundled Claude Agent SDK has the code for it, but nothing in Conductor calls it (research check, 2026-11-04).

### What Anthropic documents (read 2026-11-04)

- [Remote Control](https://code.claude.com/docs/en/remote-control) connects claude.ai/code or the Claude mobile app to a Claude Code session on the user's machine. Code and files stay on the machine; the phone is a window into the session. It makes outbound HTTPS requests only.
- It is documented for interactive sessions: `claude --remote-control`, `/remote-control`, `claude remote-control` server mode, and the `remoteControlAtStartup` setting ("each interactive Claude Code process registers one remote session").
- It needs a claude.ai login on a Pro, Max, Ultra, Team or Enterprise plan. API keys are not supported. It is off when `ANTHROPIC_BASE_URL` points anywhere but Anthropic, and for Bedrock, Vertex, zero-data-retention and HIPAA organizations.
- Nothing in the Agent SDK docs, the headless page or the CLI reference covers Remote Control for stream-json or SDK-driven sessions.

### What the installed SDK contains (not in the docs)

`@anthropic-ai/claude-agent-sdk` 0.3.318 ships an export `@anthropic-ai/claude-agent-sdk/bridge`, marked `@alpha`: "breaking changes here do NOT bump the package major". It has `createCodeSession`, `fetchRemoteCredentials` and `attachBridgeSession`. A host app writes the session's messages to claude.ai and receives the remote user's messages, permission answers, interrupts, model and permission-mode changes, and renames through callbacks. It authenticates with the user's claude.ai OAuth token. The SDK's query object also has an internal `enableRemoteControl` control request that is not in its public types.

### Two paths

|           | A. Let Claude Code connect itself                                                                                          | B. Our own bridge through the SDK's alpha API                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| How       | Start our `claude` processes with Remote Control on: the `remoteControlAtStartup` setting, or the internal control request | The session manager attaches each chat with `attachBridgeSession` and mirrors our events to claude.ai |
| Covers    | Claude chats only                                                                                                          | Any agent, if we translate our neutral messages to Claude's format for display                        |
| Stability | Relies on behaviour the docs do not promise for SDK sessions                                                               | Relies on an alpha API that can break in any release                                                  |
| Work      | Small                                                                                                                      | Larger                                                                                                |

Either way, the session manager must accept input that did not come from the desktop: a message typed on the phone starts or steers a turn, and an approval answered on the phone resolves our open interaction. Each message records who sent it (desktop or claude.ai). When both answer the same question, the first answer wins and the other is shown as superseded.

### Constraints

- Remote Control needs the claude.ai login, so it does not work for chats that run on an API key.
- It is off when `ANTHROPIC_BASE_URL` points away from Anthropic. In cloud workspaces that use the AI Gateway key swap from Part 1, Remote Control would need the sandbox to reach Anthropic directly with the claude.ai login. This needs a decision in the spike.

### Spike and kill criterion

1. Try path A on one SDK-driven chat with `remoteControlAtStartup` on. Check three things: the chat appears in claude.ai/code; a message typed there arrives in our stream; an approval answered there resolves.
2. If A fails, try path B with `attachBridgeSession` on the same chat.
3. Drop the feature until Anthropic documents SDK support if neither works without reverse-engineering an undocumented protocol. Any alpha API we use is pinned to an exact SDK version and covered by a contract test.

### Spike result (2026-11-06): path A passes

Run on this Mac with the claude.ai login, `@anthropic-ai/claude-agent-sdk` 0.3.318 and Claude Code 2.1.319, from `spike/remote-control/probe.mjs`; the owner did the claude.ai side by hand.

- **The setting alone does nothing.** `settings: { remoteControlAtStartup: true }` on an SDK chat starts no bridge: no `bridge_state` message, no session on claude.ai.
- **The query object's `enableRemoteControl(true, name)` works.** It is on the SDK's query object but not in its public types. It answers `{ session_url, bridge_session_id, bridge_epoch, ... }` and the stream reports `bridge_state` `ready`, then `connected`.
- **Check 1, the chat appears:** passed. The session URL opened the chat on claude.ai/code, with its first reply.
- **Check 2, a message typed there arrives:** passed. Each message the owner sent started a turn in our stream (tool calls, results, the reply and `result`). The text the owner typed is not in the stream; the turn carries its `user_message_uuid`, so the app reads the text from the agent's own transcript.
- **Check 3, an approval answered there resolves:** passed. A write asked our `canUseTool` (as the sidecar's permission handler does), then the answer from claude.ai settled it: the request's `signal` aborted after 4 s and the tool ran. The app must read that abort as "answered elsewhere" and close its own card.
- **Path B (`attachBridgeSession`) was not needed.**

Verdict against the kill criterion: path A works without reverse-engineering a protocol, through one SDK method that is not in the public types. As the criterion asks, the SDK stays pinned to an exact version, and a contract test fails when `enableRemoteControl` or its answer's shape changes (D074).

## Order

1. Add the `Host` seam to the shared contracts (CLOUD-01). Done: the host value and its check (D092).
2. Run the Remote Control spike (small, local, needs a claude.ai subscription). Done: path A passed (D074).
3. Run the cloud spike on a test Cloudflare account. Done: it passed (D075).
4. Build the parts the spikes confirm. Remote Control is built (RC-02 to RC-04): a per-chat switch in a Claude chat's composer, messages and approvals from claude.ai, and its settings page. The host seam is built (CLOUD-01); the Worker, sandbox and terminals are built (CLOUD-03 to CLOUD-06, CLOUD-09); pairing is built (CLOUD-07); the deploy flow is built (CLOUD-08, D109); the other cloud rows (CLOUD-10 to CLOUD-18) are next.
5. Keep work across sandbox restarts (CLOUD-06). Done: the sandbox saves `/workspace` and the agents' transcript folders to R2 at each turn end, and a start of a stopped sandbox restores them (D105).
6. Terminals, run scripts and previews (CLOUD-09). Done: a cloud workspace's terminal and run-script doors reach a PTY in the sandbox over the Worker's terminal WebSocket, and a port is shared through the Worker's preview path (D108). An interactive cloud terminal reconnects with backoff after its stream drops; a one-shot script still ends with "Connection lost." An action's "Can run in" writes `available_in`, and a cloud workspace shows the action's Cloud and Local variants; the Local variant waits for CLOUD-11's mirror. Previews are not on their own hostname.
7. Deploy and remove the Worker from the app (CLOUD-08). Done: the Connections page runs the user's `wrangler` from the Worker and sandbox-image inputs the app carries as Tauri resources, sets the pairing token as a Worker secret, pairs this Mac, and removes the Worker, its container application and its images and bucket together; a cloud workspace's archive, unarchive and delete reach its Worker (D109). The user installs wrangler (an npm package) and runs Docker, because Cloudflare's `durable_object` policy builds the image from our Dockerfile; D109 records why a prebuilt image does not fit.
