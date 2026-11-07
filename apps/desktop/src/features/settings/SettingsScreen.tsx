/**
 * @feature SET-02 SettingsScreen
 * Owns: the settings route. A left navigation with search, and the page for `page`. Entry point
 * embedded by the router.
 * Behaviour: ui-map.md 6 (layout: left nav with a search box, Back and Esc to leave, repository
 * picker in the Repositories group; pages by group). Conductor's frame (renderApp, the settings
 * layout @11782342): the screen fills the window with no strip above it; the page column starts
 * with a 40 px top bar that is a window drag region and holds "Open settings.toml" at its right,
 * then the page scrolls with 40 px sides and a 56rem column. Cloud pages (organization, members, cloud
 * computer) and Conductor's phone-pairing remote control are left out; the Remote control page holds
 * our claude.ai Remote Control settings (RC-04, D019).
 * Data: useRepos for the Repositories group. Each page reads its own data.
 * Children: SettingsNav, SettingsSearch, one page component per UserSettingsPageId and
 * RepoSettingsPageId (pages/*.tsx, repo/*.tsx).
 * Our design choice: `page` is "general", "account", "key-bindings", ... for user pages and
 * "repo:<repoId>:<page>" for repository pages, parsed by parseSettingsPage. The router gives
 * repository pages their own address, `/settings/repos/$repoId/$page`, and passes them here in the
 * "repo:" form; `go()` navigates to that address.
 * Must handle: an unknown page string (designed "page not found" state with a link to General),
 * a repository id that no longer exists, repositories still loading, Esc and the Back button
 * leaving the settings screen, and a search result opening its page and highlighting the setting.
 * Test first: page "git" renders the Git page, and "nope" renders the page-not-found state.
 */
import type { RepoId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useLiveShortcut, useRepos } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { OpenSettingsFileButton } from "./OpenSettingsFileButton.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { AdvancedPage } from "./pages/AdvancedPage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { AppearancePage } from "./pages/AppearancePage.tsx";
import { ConnectionsPage } from "./pages/ConnectionsPage.tsx";
import { DefaultModelsPage } from "./pages/DefaultModelsPage.tsx";
import { EnvironmentPage } from "./pages/EnvironmentPage.tsx";
import { ExperimentalPage } from "./pages/ExperimentalPage.tsx";
import { GeneralPage } from "./pages/GeneralPage.tsx";
import { GitPage } from "./pages/GitPage.tsx";
import { KeyboardShortcutsPage } from "./pages/KeyboardShortcutsPage.tsx";
import { RemoteControlPage } from "./pages/RemoteControlPage.tsx";
import { RepoActionsPage } from "./repo/RepoActionsPage.tsx";
import { RepoMiscPage } from "./repo/RepoMiscPage.tsx";
import { RepoPromptsPage } from "./repo/RepoPromptsPage.tsx";
import { RepoScriptsPage } from "./repo/RepoScriptsPage.tsx";
import { SettingsNav } from "./SettingsNav.tsx";
import { SettingsSearch } from "./SettingsSearch.tsx";
import {
	parseSettingsPage,
	type RepoSettingsPageId,
	type SettingsTarget,
	type UserSettingsPageId,
} from "./settings-pages.ts";
import { buildSettingsIndex, type SearchableSetting } from "./settings-search.ts";

export interface SettingsScreenProps {
	page: string;
	/** Test and embedding seam: otherwise the router's own navigation is used. */
	onNavigate?: (target: SettingsTarget) => void;
	onBack?: () => void;
}

function UserPage({
	page,
	focusSettingKey,
}: {
	page: UserSettingsPageId;
	focusSettingKey: string | null;
}) {
	switch (page) {
		case "general":
			return <GeneralPage focusSettingKey={focusSettingKey} />;
		case "account":
			return <AccountPage focusSettingKey={focusSettingKey} />;
		case "key-bindings":
			return <KeyboardShortcutsPage focusSettingKey={focusSettingKey} />;
		case "default-models":
			return <DefaultModelsPage focusSettingKey={focusSettingKey} />;
		case "git":
			return <GitPage focusSettingKey={focusSettingKey} />;
		case "connections":
			return <ConnectionsPage focusSettingKey={focusSettingKey} />;
		case "experimental":
			return <ExperimentalPage focusSettingKey={focusSettingKey} />;
		case "advanced":
			return <AdvancedPage focusSettingKey={focusSettingKey} />;
		case "agents":
			return <AgentsPage />;
		case "appearance":
			return (
				<NotBuiltYet area="Appearance settings" resetKey="appearance">
					<AppearancePage focusSettingKey={focusSettingKey} />
				</NotBuiltYet>
			);
		case "environment":
			return <EnvironmentPage focusSettingKey={focusSettingKey} />;
		case "remote-control":
			return <RemoteControlPage focusSettingKey={focusSettingKey} />;
	}
}

function RepoPage({ page, repoId }: { page: RepoSettingsPageId; repoId: RepoId }) {
	switch (page) {
		case "scripts":
			return <RepoScriptsPage repoId={repoId} />;
		case "actions":
			return <RepoActionsPage repoId={repoId} />;
		case "prompts":
			return <RepoPromptsPage repoId={repoId} />;
		case "misc":
			return <RepoMiscPage repoId={repoId} />;
	}
}

export function SettingsScreen({ page, onNavigate, onBack }: SettingsScreenProps) {
	const navigate = useNavigate();
	const parsed = parseSettingsPage(page);
	const repos = useRepos();
	const [focusSettingKey, setFocusSettingKey] = useState<string | null>(null);
	const [repoChoice, setRepoChoice] = useState<string | null>(null);
	const searchInput = useRef<HTMLInputElement>(null);

	const target = parsed.ok ? parsed.value : null;
	const targetRepoId = target?.kind === "repo" ? target.repoId : null;
	const pickedRepoId = targetRepoId ?? repoChoice;
	const firstRepoId = repos.state === "ready" ? repos.data[0]?.id : undefined;

	useEffect(() => {
		if (targetRepoId !== null) setRepoChoice(targetRepoId);
	}, [targetRepoId]);

	useEffect(() => {
		if (repoChoice !== null) return;
		if (repos.state !== "ready" || repos.data.length === 0) return;
		setRepoChoice(repos.data[0]?.id ?? null);
	}, [repoChoice, repos]);

	const go = (next: SettingsTarget) => {
		if (onNavigate !== undefined) {
			onNavigate(next);
			return;
		}
		if (next.kind === "user") {
			void navigate({ to: "/settings/$page", params: { page: next.page } });
		} else {
			void navigate({
				to: "/settings/repos/$repoId/$page",
				params: { repoId: next.repoId, page: next.page },
			});
		}
	};

	const leave = () => {
		if (onBack !== undefined) {
			onBack();
			return;
		}
		void navigate({ to: "/" });
	};

	const searchShortcut = useLiveShortcut("settings.search");
	useCommandHandler("settings.search", "modal", () => {
		searchInput.current?.focus();
		return true;
	});
	useCommandHandler("settings.close", "modal", () => {
		leave();
		return true;
	});

	const index = useMemo(() => {
		const all = buildSettingsIndex();
		if (pickedRepoId !== null) return all;
		return all.filter((setting) => typeof setting.page === "string");
	}, [pickedRepoId]);

	const openSearchResult = (setting: SearchableSetting) => {
		setFocusSettingKey(setting.key);
		if (typeof setting.page === "string") {
			go({ kind: "user", page: setting.page });
			return;
		}
		const repoId = pickedRepoId ?? firstRepoId;
		if (repoId === undefined) return;
		go({ kind: "repo", repoId: repoId as RepoId, page: setting.page.repoPage });
	};

	if (!parsed.ok) {
		return (
			<div
				data-command-scope="dialog"
				data-testid="settings-screen"
				className="flex h-full items-center justify-center bg-canvas p-8 text-fg"
			>
				<EmptyState
					title="Settings page not found"
					body={parsed.error.message}
					action={
						<Button variant="secondary" onClick={() => go({ kind: "user", page: "general" })}>
							Go to General
						</Button>
					}
				/>
			</div>
		);
	}

	const active = parsed.value;
	const repoIsMissing =
		active.kind === "repo" &&
		repos.state === "ready" &&
		!repos.data.some((repo) => repo.id === active.repoId);

	const content = (() => {
		if (repoIsMissing) {
			return (
				<EmptyState
					title="Pick a project"
					body="Choose a project in the Repositories group to edit its settings."
					action={
						<Button variant="secondary" onClick={() => go({ kind: "user", page: "general" })}>
							Go to General
						</Button>
					}
				/>
			);
		}
		if (active.kind === "user") {
			return <UserPage page={active.page} focusSettingKey={focusSettingKey} />;
		}
		return <RepoPage page={active.page} repoId={active.repoId} />;
	})();

	return (
		<div
			data-command-scope="dialog"
			data-testid="settings-screen"
			className="flex h-full min-h-0 bg-canvas text-fg"
		>
			<SettingsNav
				active={active}
				repos={
					repos.state === "ready"
						? repos.data.map((repo) => ({ id: repo.id, name: repo.name }))
						: []
				}
				reposLoading={repos.state === "loading"}
				onNavigate={go}
				onBack={leave}
				searchSlot={
					<SettingsSearch
						index={index}
						onOpen={openSearchResult}
						inputRef={searchInput}
						searchShortcut={searchShortcut}
					/>
				}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div
					data-tauri-drag-region
					data-testid="settings-top-bar"
					className="flex h-10 shrink-0 items-center justify-end border-b border-border px-10"
				>
					<OpenSettingsFileButton
						file={active.kind === "repo" ? { repoId: active.repoId } : "user"}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-10 pt-6 pb-8">
					<div className="min-w-0 max-w-[var(--settings-content-width)] pb-14">{content}</div>
				</div>
			</main>
		</div>
	);
}
