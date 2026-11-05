/**
 * @feature COMP-04 Composer extensions
 * Owns: The list of TipTap extensions the editor loads, built from the trigger extensions for @, #
 * and /.
 * Behaviour: ui-map.md 3.5 (triggers: '@' files and directories, plans, terminal output, linked
 * directories; '#' pull requests and issues; '/' built-in commands, project commands and skills).
 * Our design choice: A function from dependencies to extensions, so the editor can be tested with
 * stand-in search functions. The trigger builders are inputs, so an editor can be assembled while a
 * sibling trigger is still a placeholder; the default builders are that trigger's own feature. The
 * fourth Conductor trigger (a section sign for saved snippets) is not verified and is left out.
 * Must handle: each trigger is an independent extension; the base kit removes the marks and blocks
 * the plain-text composer does not use.
 * Test first: buildComposerExtensions returns one extension for each of the three triggers plus the
 * base kit.
 */
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createFileMention, type FileMentionDeps } from "./mentions/FileMention.ts";
import { createPrMention, type PrMentionDeps } from "./mentions/PrMention.ts";
import { createSlashCommands, type SlashCommandDeps } from "./mentions/SlashCommandExtension.ts";

export interface ComposerExtensionBuilders {
	files?: (deps: FileMentionDeps) => Extensions[number];
	pullRequests?: (deps: PrMentionDeps) => Extensions[number];
	slash?: (deps: SlashCommandDeps) => Extensions[number];
}

export interface ComposerExtensionDeps {
	files: FileMentionDeps;
	pullRequests: PrMentionDeps;
	slash: SlashCommandDeps;
	/** Defaults to the trigger's own builder. Tests pass one for a trigger that is still unbuilt. */
	builders?: ComposerExtensionBuilders;
}

/** The base editor kit: plain text only, because the agent receives plain text. */
export const composerBaseKit = StarterKit.configure({
	blockquote: false,
	bold: false,
	bulletList: false,
	code: false,
	codeBlock: false,
	heading: false,
	horizontalRule: false,
	italic: false,
	link: false,
	listItem: false,
	listKeymap: false,
	orderedList: false,
	strike: false,
	underline: false,
});

export function buildComposerExtensions({
	files,
	pullRequests,
	slash,
	builders = {},
}: ComposerExtensionDeps): Extensions {
	const buildFiles = builders.files ?? createFileMention;
	const buildPullRequests = builders.pullRequests ?? createPrMention;
	const buildSlash = builders.slash ?? createSlashCommands;
	return [composerBaseKit, buildFiles(files), buildPullRequests(pullRequests), buildSlash(slash)];
}
