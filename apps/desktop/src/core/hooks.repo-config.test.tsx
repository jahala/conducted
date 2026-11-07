import { appError, ok, type RepoId } from "@conducted/shared";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useRepoConfig } from "./hooks.ts";
import type { RepoConfig } from "./model.ts";
import type { RepoState } from "./services/repo.ts";

const repoId = "repo-1" as RepoId;

const config: RepoConfig = {
	setupScript: "pnpm install",
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [".env"],
	previewUrls: [],
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: null,
	prompts: {
		general: null,
		codeReview: null,
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
};

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	test.close();
});

function renderConfig(state: RepoState, loadConfig = vi.fn(async () => ok(config))) {
	const service = test.container.services.repo;
	service.store.setState(state);
	vi.spyOn(service, "loadConfig").mockImplementation(loadConfig);
	return renderHook(() => useRepoConfig(repoId), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		),
	});
}

describe("PRJ-04 useRepoConfig", () => {
	it("returns the loaded config", () => {
		const { result } = renderConfig({
			loaded: true,
			reposById: {},
			order: [],
			configs: { [repoId]: config },
		});
		expect(result.current).toEqual({ state: "ready", data: config });
	});

	it("loads the config once and reports loading until it arrives", () => {
		const loadConfig = vi.fn(async () => ok(config));
		const { result } = renderConfig(
			{ loaded: true, reposById: {}, order: [], configs: {} },
			loadConfig,
		);
		expect(result.current).toEqual({ state: "loading" });
		expect(loadConfig).toHaveBeenCalledWith(repoId);
	});

	it("reports the file error", () => {
		const failure = appError("settings_file_invalid", "The settings file is invalid.");
		const { result } = renderConfig({
			loaded: true,
			reposById: {},
			order: [],
			configs: {},
			configErrors: { [repoId]: failure },
		});
		expect(result.current).toEqual({ state: "error", error: failure });
	});
});
