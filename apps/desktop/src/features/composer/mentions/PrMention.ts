/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: The '#' trigger: search of pull requests and issues, and the chip it inserts.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues; selecting writes a PR context file and
 * inserts a chip), services-map.md 5B (Linear and GitHub issues).
 * Our design choice: Needs GitHub through `gh` (PR-01) and, for issues, the Linear link (PR-09).
 * With neither available the trigger explains what is missing instead of staying silent.
 * Must handle: Not signed in to GitHub (popup says how to sign in); offline; rate limited; no
 * matches; the selected PR is from another repository; the context file write fails (chip not
 * inserted, toast shown).
 * Test first: Typing '#12' offers PR 12 when it exists; choosing it inserts a chip with the number
 * and title.
 */
import { notImplemented } from "@conducted/shared";
import type { Node } from "@tiptap/react";

export interface PrMentionItem {
	kind: "pull_request" | "issue";
	number: number;
	title: string;
	url: string;
}

export interface PrMentionDeps {
	search: (query: string) => Promise<PrMentionItem[]>;
}

export function createPrMention(_props: PrMentionDeps): Node {
	return notImplemented("COMP-05");
}
