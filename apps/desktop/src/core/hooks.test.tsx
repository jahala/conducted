import { appError, type RepoId } from "@conducted/shared";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { ServicesProvider } from "./context.tsx";
import { useRepos } from "./hooks.ts";
import type { Repo } from "./model.ts";
import type { RepoState } from "./services/repo.ts";

const repo = (id: string, name: string): Repo => ({
	id: id as RepoId,
	name,
	rootPath: `/code/${name}`,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

function renderRepos(state: RepoState) {
	const store = createStore<RepoState>(() => state);
	return renderHook(() => useRepos(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={{ services: { repo: { store } } } as never}>
				{children}
			</ServicesProvider>
		),
	});
}

describe("PRJ-01 useRepos", () => {
	it("reports loading until the first list arrives", () => {
		const { result } = renderRepos({ loaded: false, reposById: {}, order: [], configs: {} });
		expect(result.current).toEqual({ state: "loading" });
	});

	it("returns projects in sidebar order", () => {
		const first = repo("repo-1", "alpha");
		const second = repo("repo-2", "beta");
		const { result } = renderRepos({
			loaded: true,
			reposById: { [first.id]: first, [second.id]: second },
			order: [second.id, first.id],
			configs: {},
		});
		expect(result.current).toEqual({ state: "ready", data: [second, first] });
	});

	it("reports the error when the table could not be read", () => {
		const failure = appError("db", "Database is locked");
		const { result } = renderRepos({
			loaded: true,
			reposById: {},
			order: [],
			configs: {},
			error: failure,
		});
		expect(result.current).toEqual({ state: "error", error: failure });
	});
});
