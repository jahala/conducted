import type { ModelInfo, SessionConfig } from "@conducted/protocol";
import { ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import "../../test/dom-polyfills.ts";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import type { Actions } from "../../core/api.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Session } from "../../core/model.ts";
import type { AgentCatalogState } from "../../core/services/agent-catalog.ts";
import type { FavoriteModel, FavoriteModelsState } from "../../core/services/favorite-models.ts";
import type { SessionsState } from "../../core/services/sessions.ts";
import type { SettingsState } from "../../core/services/settings.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

const sessionId = "chat-1" as SessionId;
const workspaceId = "ws-1" as WorkspaceId;

const model = (values: Partial<ModelInfo> & Pick<ModelInfo, "id" | "label">): ModelInfo => ({
	status: "picker",
	isNew: false,
	isDefault: false,
	efforts: ["low", "medium", "high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: true,
	supportsFastMode: true,
	...values,
});

const config = (values: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "claude",
	model: "m1",
	effort: "max",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...values,
});

const favorite = (id: string, values: Partial<FavoriteModel["config"]>): FavoriteModel => ({
	id,
	position: Number(id.replace(/\D/g, "")) || 0,
	config: {
		agent: "claude",
		model: "m1",
		effort: "high",
		fastMode: false,
		...values,
	},
});

interface HarnessOptions {
	session?: Session;
	models?: ModelInfo[];
	/** What loading another agent's models returns. Defaults to `models`. */
	loadedModels?: ModelInfo[];
	favorites?: FavoriteModel[];
	/** The saved `keybinding_overrides_v1` text. */
	keybindings?: string;
	/** Loading another agent's models waits until the test resolves it. */
	lateModels?: boolean;
}

const harness = (options: HarnessOptions = {}) => {
	const session: Session = options.session ?? {
		id: sessionId,
		workspaceId,
		title: null,
		config: config(),
		agentSessionId: null,
		forkResumeNativeMessageId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		contextWindowTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: null,
		createdAt: 1,
		updatedAt: 1,
	};
	const modelList = options.models ?? [
		model({ id: "m1", label: "Model One", efforts: ["low", "medium", "high", "max"] }),
		model({
			id: "m2",
			label: "Model Two",
			efforts: ["high"],
			defaultEffort: "high",
		}),
	];
	const sessions = createStore<SessionsState>(() => ({
		loaded: true,
		sessions: { [sessionId]: session },
		byWorkspace: { [workspaceId]: [sessionId] },
		liveStates: {},
		cancelling: {},
		events: {},
		progress: {},
		sending: {},
		openInteractions: {},
		viewingSessionId: null,
	}));
	const loadModelsLater = {
		calls: [] as { resolve: (models: ModelInfo[]) => void }[],
	};
	const agentCatalog = {
		store: createStore<AgentCatalogState>(() => ({
			installs: {
				state: "ready",
				data: [
					{
						agent: "claude",
						installed: true,
						authenticated: true,
					},
					{
						agent: "codex",
						installed: true,
						authenticated: true,
					},
					{
						agent: "cursor",
						installed: true,
						authenticated: true,
					},
				],
			},
			models: { claude: { state: "ready", data: modelList } },
			slashCommands: {},
		})),
		loadModels: vi.fn(async () => {
			if (options.lateModels !== true) return ok(options.loadedModels ?? modelList);
			return new Promise<ReturnType<typeof ok<ModelInfo[]>>>((resolve) => {
				loadModelsLater.calls.push({ resolve: (models) => resolve(ok(models)) });
			});
		}),
	};
	const favoriteModels = {
		store: createStore<FavoriteModelsState>(() => ({
			loaded: true,
			favorites: options.favorites ?? [],
		})),
		start: vi.fn(async () => ok(undefined)),
		add: vi.fn(async () => ok(favorite("1", {}))),
		remove: vi.fn(async () => ok(undefined)),
		reorder: vi.fn(async () => ok(undefined)),
	};
	const settings = createStore<SettingsState>(() => ({
		loaded: true,
		values: {
			visible_provider_models: "",
			keybinding_overrides_v1: options.keybindings ?? "",
		},
		dropped: [],
		warnings: [],
	}));
	const updateConfig = vi.fn(async () => ok(undefined));
	const create = vi.fn(async () => ok(session));
	const actions = {
		sessions: { updateConfig, create },
	} as unknown as Actions;
	const platform = {
		app: { writeLog: vi.fn(), onDeepLink: () => () => {} },
		menu: {
			setShortcuts: vi.fn(async () => ok({ applied: [], rejected: [] })),
			onCommand: () => () => {},
		},
	};
	const container = {
		platform,
		services: {
			commands: { isEnabled: vi.fn(() => true), run: vi.fn(async () => ok(undefined)) },
			sessions: { store: sessions },
			agentCatalog,
			favoriteModels,
			settings: {
				store: settings,
				get: <T,>(key: string) => (settings.getState().values[key] ?? "") as unknown as T,
			},
		},
		actions,
	} as unknown as Container;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	return { sessions, favoriteModels, updateConfig, create, wrapper, loadModelsLater };
};

const openPicker = async () => {
	fireEvent.click(screen.getByRole("button", { name: "Model picker" }));
	return screen.findByRole("button", { name: /Model Two/ });
};

describe("COMP-02 model picker", () => {
	it("choosing a model that supports only 'high' effort updates the config to 'high'", async () => {
		const { updateConfig, wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		const modelTwo = await openPicker();
		fireEvent.click(modelTwo);
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ model: "m2", effort: "high" }),
			),
		);
	});

	it("says the effort changed when the chosen model lacks the current effort", async () => {
		const { wrapper } = harness();
		render(
			<>
				<ModelPicker sessionId={sessionId} />
				<Toaster />
			</>,
			{ wrapper },
		);
		const modelTwo = await openPicker();
		fireEvent.click(modelTwo);
		expect(await screen.findByText("Effort changed to High")).toBeTruthy();
	});

	it("chooses an agent's model only from the picker's list, and says No models found otherwise", async () => {
		const { updateConfig, wrapper } = harness({
			loadedModels: [model({ id: "hidden", label: "Hidden", status: "hidden", isDefault: true })],
		});
		render(
			<>
				<ModelPicker sessionId={sessionId} />
				<Toaster />
			</>,
			{ wrapper },
		);
		await openPicker();
		fireEvent.click(screen.getByRole("button", { name: "Codex" }));
		expect(await screen.findByText("No models found")).toBeTruthy();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("shows the live fast-mode shortcut after a rebind", async () => {
		const { wrapper } = harness({
			keybindings: JSON.stringify({ "chat.toggleFastMode": ["Cmd+Alt+F"] }),
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		expect(screen.getByText("⌥⌘F")).toBeTruthy();
	});

	it("does not apply an unavailable favourite from its shortcut", async () => {
		const { updateConfig, wrapper } = harness({
			favorites: [favorite("1", { model: "ghost" })],
		});
		render(
			<>
				<ModelPicker sessionId={sessionId} />
				<Toaster />
			</>,
			{ wrapper },
		);
		fireEvent.keyDown(document.body, { key: "1", metaKey: true, ctrlKey: true });
		expect(await screen.findByText("That model is no longer available")).toBeTruthy();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("says No models found when the search matches nothing", async () => {
		const { wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
			target: { value: "nothing here" },
		});
		expect(await screen.findByText("No models found")).toBeTruthy();
	});

	it("toggles fast mode from the Fast control", async () => {
		const { updateConfig, wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		fireEvent.click(screen.getByRole("button", { name: /Fast/ }));
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ fastMode: true }),
			),
		);
	});

	it("shows Not supported for this model when the model is unknown", async () => {
		const { wrapper } = harness({
			session: {
				id: sessionId,
				workspaceId,
				title: null,
				config: config({ model: "ghost" }),
				agentSessionId: null,
				forkResumeNativeMessageId: null,
				unreadCount: 0,
				contextUsedTokens: null,
				contextWindowTokens: null,
				queuePausedAt: null,
				closedAt: null,
				lastUserMessageAt: null,
				createdAt: 1,
				updatedAt: 1,
			},
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		expect(await screen.findByText("Not supported for this model")).toBeTruthy();
	});

	it("selects the second loadout with Cmd+Ctrl+2 while the picker is closed", async () => {
		const { updateConfig, wrapper } = harness({
			favorites: [favorite("1", {}), favorite("2", { model: "m2" })],
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "2", metaKey: true, ctrlKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ model: "m2" }),
			),
		);
	});

	it("opens with Cmd+/", async () => {
		const { wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "/", metaKey: true });
		expect(await screen.findByRole("textbox", { name: "Search models" })).toBeTruthy();
	});

	it("toggles fast mode with Cmd+Shift+E", async () => {
		const { updateConfig, wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "e", metaKey: true, shiftKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ fastMode: true }),
			),
		);
	});

	it("cycles the effort with Cmd+Shift+/", async () => {
		const { updateConfig, wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "/", metaKey: true, shiftKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ effort: "low" }),
			),
		);
	});

	it("follows a rebind: the new key cycles the effort and the shipped key does not", async () => {
		const { updateConfig, wrapper } = harness({
			keybindings: JSON.stringify({ "chat.cycleEffort": ["Cmd+Alt+J"] }),
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "/", metaKey: true, shiftKey: true });
		expect(updateConfig).not.toHaveBeenCalled();
		fireEvent.keyDown(document.body, { key: "j", metaKey: true, altKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ effort: "low" }),
			),
		);
	});

	it("applies only the newest of two agent choices whose models arrive out of order", async () => {
		const { sessions, wrapper, loadModelsLater, updateConfig } = harness({ lateModels: true });
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		fireEvent.click(screen.getByRole("button", { name: "Codex" }));
		fireEvent.click(screen.getByRole("button", { name: "Cursor" }));
		await waitFor(() => expect(loadModelsLater.calls.length).toBe(2));
		loadModelsLater.calls[1]?.resolve([model({ id: "cursor-model", label: "Cursor Model" })]);
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ agent: "cursor", model: "cursor-model" }),
			),
		);
		loadModelsLater.calls[0]?.resolve([model({ id: "codex-model", label: "Codex Model" })]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(updateConfig).toHaveBeenCalledTimes(1);
		expect(sessions.getState().sessions[sessionId]).toBeDefined();
	});

	it("lists the ACP agents in the Agent section", async () => {
		const { wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		expect(screen.getByRole("button", { name: "OpenCode" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Pi" })).toBeTruthy();
	});
});
