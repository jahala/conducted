import { ok } from "@conducted/shared";
import { Extension } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { buildComposerExtensions } from "./composer-extensions.ts";

const deps = {
	files: { search: () => [] },
	pullRequests: {
		search: async () => ok({ items: [] }),
		attach: async () => ok(""),
		onError: () => {},
	},
	slash: { commands: [], onRun: () => {} },
	builders: {
		pullRequests: () => Extension.create({ name: "prMention" }),
		slash: () => Extension.create({ name: "slashCommands" }),
	},
};

describe("COMP-04 Composer extensions", () => {
	it("builds the base kit and one extension for each of the three triggers", () => {
		const extensions = buildComposerExtensions(deps);
		expect(extensions).toHaveLength(4);
		expect(extensions.map((extension) => extension.name)).toEqual([
			"starterKit",
			"fileMention",
			"prMention",
			"slashCommands",
		]);
	});

	it("leaves the '#' trigger out when the caller passes no pull request search", () => {
		const { pullRequests: _left, ...withoutPullRequests } = deps;
		const extensions = buildComposerExtensions(withoutPullRequests);
		expect(extensions.map((extension) => extension.name)).toEqual([
			"starterKit",
			"fileMention",
			"slashCommands",
		]);
	});
});
