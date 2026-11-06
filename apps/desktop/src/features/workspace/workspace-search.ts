/**
 * @feature NAV-02 Workspace URL state
 * Owns: the search params of the workspace route (which tab is open, which file, which diff scope, which
 * pull request the PR tab shows) and the codec that turns a DiffScope into a URL string and back. The URL is
 * the single source of truth for the open tab, so reload, back and forward all land on the same view.
 * Behaviour: ui-map.md 2 (search params carry the active tab; with none set the route restores the chat tab
 * that workspace had open last), 3.2 (tab types), 3.6 (git panel tabs and diff scopes).
 * Our design choice: shorter names than Conductor's `activeTabType`/`specialTab*` set, one `tab` kind
 * (session, terminal, file, comment, pr, browser; the cloud desktop tab is out of scope), and the diff scope as
 * one string ("branch", "uncommitted", "target:main", "commit:abc123", "turn:<session>:<turn>",
 * "range:10:11" for a run of stack pull requests, PR-08).
 * Must handle: a bad or unknown value is dropped instead of failing the page; values that look like numbers
 * (a file called "404", a numeric id) arrive as numbers from the URL parser and are turned back into strings;
 * a scope string with unknown kind or missing parts gives null.
 * Test first: parse({ tab: "nope" }) drops tab; formatDiffScope and parseDiffScope round-trip every kind.
 */
import { zSessionId, zTurnId } from "@conducted/protocol";
import { z } from "zod";
import type { DiffScope } from "../../core/api.ts";
import { GIT_PANEL_TABS } from "../../core/model.ts";

export const WORKSPACE_TAB_KINDS = [
	"session",
	"terminal",
	"file",
	"comment",
	"pr",
	"browser",
] as const;
export type WorkspaceTabKind = (typeof WORKSPACE_TAB_KINDS)[number];

/** The URL parser turns "404" into the number 404. Ids and paths must stay strings. */
const looseString = z
	.union([z.string(), z.number()])
	.transform((value) => String(value))
	.pipe(z.string().min(1));

/** A field that is dropped (not an error) when its value is wrong. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

export const zWorkspaceSearch = z.object({
	tab: lenient(z.enum(WORKSPACE_TAB_KINDS)),
	sessionId: lenient(looseString),
	terminalId: lenient(looseString),
	path: lenient(looseString),
	fileMode: lenient(z.enum(["diff", "edit"])),
	/** Rendered or source view for files that have both (Markdown, SVG). */
	fileView: lenient(z.enum(["source", "rendered"])),
	line: lenient(z.number().int().positive()),
	commentId: lenient(looseString),
	browserUrl: lenient(looseString),
	/** Which pull request the PR tab shows. The URL parser may hand it over as text. */
	pr: lenient(z.coerce.number().int().positive()),
	gitTab: lenient(z.enum(GIT_PANEL_TABS)),
	scope: lenient(looseString),
});
export type WorkspaceSearch = z.infer<typeof zWorkspaceSearch>;

export function formatDiffScope(scope: DiffScope): string {
	switch (scope.kind) {
		case "branch":
		case "uncommitted":
			return scope.kind;
		case "target":
			return `target:${scope.branch}`;
		case "commit":
			return `commit:${scope.sha}`;
		case "turn":
			return `turn:${scope.sessionId}:${scope.turnId}`;
		case "range":
			return ["range", ...scope.prNumbers].join(":");
	}
}

/** A pull request number in the URL: a positive whole number with no leading zero. */
const PR_NUMBER = /^[1-9]\d*$/;

export function parseDiffScope(text: string): DiffScope | null {
	if (text === "branch") return { kind: "branch" };
	if (text === "uncommitted") return { kind: "uncommitted" };
	const colon = text.indexOf(":");
	if (colon < 0) return null;
	const kind = text.slice(0, colon);
	const rest = text.slice(colon + 1);
	if (rest.length === 0) return null;
	if (kind === "target") return { kind: "target", branch: rest };
	if (kind === "commit") return { kind: "commit", sha: rest };
	if (kind === "turn") {
		const [sessionId, turnId, ...extra] = rest.split(":");
		const session = zSessionId.safeParse(sessionId);
		const turn = zTurnId.safeParse(turnId);
		if (extra.length > 0 || !session.success || !turn.success) return null;
		return { kind: "turn", sessionId: session.data, turnId: turn.data };
	}
	if (kind === "range") {
		const numbers = rest.split(":");
		if (!numbers.every((number) => PR_NUMBER.test(number))) return null;
		return { kind: "range", prNumbers: numbers.map(Number) };
	}
	return null;
}
