/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for choosing the avatar source from a saved icon and a repository's remote.
 * Test first: a GitHub remote without a saved icon gives its owner avatar.
 */
import type { RepoId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Repo } from "../../core/model.ts";
import {
	emojiIconValue,
	fileIconPath,
	fileIconValue,
	githubOwnerOf,
	repoIconSource,
} from "./repo-icon.ts";

function repo(changes: Partial<Repo> = {}): Repo {
	return {
		id: "repo-1" as RepoId,
		name: "conducted",
		rootPath: "/code/conducted",
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
		...changes,
	};
}

describe("PRJ-05 repository avatar sources", () => {
	it("reads a stored emoji", () => {
		expect(repoIconSource(repo({ icon: emojiIconValue("🚀") }))).toEqual({
			kind: "emoji",
			emoji: "🚀",
		});
	});

	it("treats a value with no known prefix as no icon, so the fallbacks apply", () => {
		expect(repoIconSource(repo({ icon: "🧪" }))).toEqual({ kind: "letter", letter: "C" });
	});

	it("reads an uploaded icon path", () => {
		const value = fileIconValue("/app/icons/repo-1.png");
		expect(fileIconPath(value)).toBe("/app/icons/repo-1.png");
		expect(repoIconSource(repo({ icon: value }))).toEqual({
			kind: "file",
			path: "/app/icons/repo-1.png",
		});
	});

	it("uses a GitHub owner avatar when no icon is saved", () => {
		expect(repoIconSource(repo({ remoteUrl: "git@github.com:jahala/conducted.git" }))).toEqual({
			kind: "owner",
			url: "https://github.com/jahala.png?size=64",
		});
	});

	it("uses another remote's favicon when no icon is saved", () => {
		expect(repoIconSource(repo({ remoteUrl: "https://gitlab.com/jahala/conducted.git" }))).toEqual({
			kind: "favicon",
			url: "https://gitlab.com/favicon.ico",
		});
	});

	it("falls back to the repository's first letter", () => {
		expect(repoIconSource(repo({ name: "conducted" }))).toEqual({
			kind: "letter",
			letter: "C",
		});
	});

	it("names only a GitHub remote as an owner", () => {
		expect(githubOwnerOf("https://github.com/jahala/conducted")).toBe("jahala");
		expect(githubOwnerOf("https://gitlab.com/jahala/conducted")).toBeNull();
		expect(githubOwnerOf(null)).toBeNull();
	});
});
