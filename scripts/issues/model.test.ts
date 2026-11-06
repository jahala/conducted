/**
 * The issue sync must read every backlog row, keep its dependencies, and render items grouped by
 * kind, with the hidden marker it uses to find the issue again.
 */
import { expect, test } from "bun:test";
import {
	isRateLimited,
	labelsOf,
	MARKER,
	milestoneOf,
	parseBacklog,
	parseHeader,
	parseItems,
	parseOnly,
	renderIssue,
	scanBacklog,
} from "./model.ts";

const BACKLOG = `# Feature backlog

## Chat (CHAT)

| ID | Feature | Owner | Research | P | Status | Needs |
|---|---|---|---|---|---|---|
| CHAT-02 | Send a message as a new turn | D/core/services | sessions-and-chats "What happens" | 1 | stub | SIDE-03 |
| CHAT-03 | Steer a running turn | D/core/services, S/session | sessions-and-chats | 2 | stub | CHAT-02, SIDE-04 |

## Planned: cloud workspaces and Remote Control (CLOUD, RC)

| ID | Feature | Owner | Research | P | Status |
|---|---|---|---|---|---|
| CLOUD-02 | Cloud spike | apps/cloud | cloud-and-remote.md | 1 | planned |
`;

test("reads rows from every section, with needs and the section as epic", () => {
	const rows = parseBacklog(BACKLOG);
	expect(rows.map((r) => r.id)).toEqual(["CHAT-02", "CHAT-03", "CLOUD-02"]);
	expect(rows[1]?.needs).toEqual(["CHAT-02", "SIDE-04"]);
	expect(rows[1]?.epic).toBe("Chat");
	expect(rows[2]?.epic).toBe("cloud workspaces and Remote Control");
	expect(rows[2]?.needs).toEqual([]);
});

test("labels and milestones follow the plan", () => {
	const [chat2, chat3, cloud] = parseBacklog(BACKLOG);
	if (!chat2 || !chat3 || !cloud) throw new Error("rows missing");
	expect(milestoneOf(chat2)).toBe("First slice");
	expect(milestoneOf(cloud)).toBe("Cloud");
	expect(labelsOf(chat3)).toEqual(["area:chat", "priority:2", "layer:core", "layer:sidecar"]);
	expect(labelsOf(cloud)).toContain("needs-spike");
});

test("header fields are read across wrapped comment lines", () => {
	const text = `/**
 * @feature CHAT-03 Steer
 * Owns: pushing a message into the live turn
 *   and tracking when it was read.
 * Test first: a steer stays pending until read.
 */`;
	const { ids, file } = parseHeader("a.ts", text);
	expect(ids).toEqual(["CHAT-03"]);
	expect(file.owns).toBe("pushing a message into the live turn and tracking when it was read.");
	expect(file.testFirst).toBe("a steer stays pending until read.");
});

test("an issue lists items by kind, links blockers, and carries its marker", () => {
	const [, chat3] = parseBacklog(BACKLOG);
	if (!chat3) throw new Error("row missing");
	const items = parseItems(
		"id\tkind\titem\tresearch\tstatus\nCHAT-03\taction\tSteer from the queue\tui-map 3.4\tpartly\nCHAT-03\tstate\tPending steer shown\tui-map 3.4\tcovered\n",
	);
	const body = renderIssue(chat3, items, [], new Map([["CHAT-02", 12]]));
	expect(body.startsWith(MARKER("CHAT-03"))).toBe(true);
	expect(body).toContain("Blocked by: #12 CHAT-02, SIDE-04");
	expect(body).toContain("**action**");
	expect(body).toContain("- [ ] Steer from the queue _(scaffold: partly)_ · ui-map 3.4");
	expect(body).toContain("Everything this feature covers (2)");
});

const HEAD =
	"| ID | Feature | Owner | Research | P | Status | Needs |\n|---|---|---|---|---|---|---|\n";

test("a planned issue names the cloud plan only for cloud and Remote Control rows", () => {
	const text = `## Platform (PLAT)\n\n${HEAD}| PLAT-28 | Program manager | R/binaries.rs | A2 | 2 | planned |  |\n\n## Planned: cloud workspaces and Remote Control (CLOUD, RC)\n\n${HEAD}| CLOUD-02 | Cloud spike | apps/cloud | Part 1 | 1 | planned |  |\n| RC-01 | Remote Control spike | S/runners | Part 2 | 2 | planned |  |\n`;
	const [plat, cloud, remote] = parseBacklog(text);
	if (!plat || !cloud || !remote) throw new Error("rows missing");
	const plan = "docs/plans/cloud-and-remote.md";
	expect(renderIssue(cloud, [], [], new Map())).toContain(plan);
	expect(renderIssue(remote, [], [], new Map())).toContain(plan);
	const body = renderIssue(plat, [], [], new Map());
	expect(body).not.toContain(plan);
	expect(body).toContain(
		"Planned: not ready to build yet; it waits for a spike or a decision first.",
	);
});

test("a row with a bad status, priority or need is reported, never dropped or defaulted", () => {
	const text = `## Chat (CHAT)\n\n${HEAD}| CHAT-01 | A | D/core | r | 1 | wip |  |\n| CHAT-02 | B | D/core | r | 9 | stub |  |\n| CHAT-03 | C | D/core | r | 1 | stub | SIDE-3 |\n`;
	const { rows, problems } = scanBacklog(text);
	expect(problems).toEqual([
		'CHAT-01 has status "wip"; use stub, done or planned',
		'CHAT-02 has priority "9"; use 1, 2 or 3',
		'CHAT-03 needs "SIDE-3", which is not a feature id',
	]);
	expect(rows.map((r) => r.id)).toEqual(["CHAT-03"]);
	expect(() => parseBacklog(text)).toThrow("CHAT-01 has status");
});

test("--only: absent means all, a missing or malformed value is an error", () => {
	expect(parseOnly(["bun", "sync.ts", "--apply"])).toEqual({ only: null });
	expect(parseOnly(["--apply", "--only", "A-01,B-02"])).toEqual({
		only: new Set(["A-01", "B-02"]),
	});
	expect("error" in parseOnly(["--apply", "--only"])).toBe(true);
	expect("error" in parseOnly(["--only", "--apply"])).toBe(true);
	expect(parseOnly(["--only", "A-01,oops"])).toEqual({
		error: "--only has values that are not feature ids: oops",
	});
});

test("only a rate limit is retried; a permission refusal is not", () => {
	expect(isRateLimited("You have exceeded a secondary rate limit")).toBe(true);
	expect(isRateLimited("HTTP 429: slow down")).toBe(true);
	expect(isRateLimited("HTTP 403: Resource not accessible by integration")).toBe(false);
});
