import type { ModelInfo, SessionConfig } from "@conducted/protocol";
import { appError, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { FavoriteModel } from "../../core/favorite-model.ts";
import type { Session } from "../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { clickPointer } from "../../test/pointer-drag.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test.close();
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
	/** The chat's models failed to load. */
	modelsError?: boolean;
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
	const { services, actions } = test.container;
	const sessions = services.sessions.store;
	sessions.setState({
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
	});
	const loadModelsLater = {
		calls: [] as { resolve: (models: ModelInfo[]) => void }[],
	};
	services.agentCatalog.store.setState({
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
		models:
			options.modelsError === true
				? { claude: { state: "error", error: appError("models_failed", "No answer.") } }
				: { claude: { state: "ready", data: modelList } },
		slashCommands: {},
	});
	vi.spyOn(services.agentCatalog, "loadModels").mockImplementation(async () => {
		if (options.lateModels !== true) return ok(options.loadedModels ?? modelList);
		return new Promise<ReturnType<typeof ok<ModelInfo[]>>>((resolve) => {
			loadModelsLater.calls.push({ resolve: (models) => resolve(ok(models)) });
		});
	});
	const favoriteModels = services.favoriteModels;
	favoriteModels.store.setState({ loaded: true, favorites: options.favorites ?? [] });
	services.settings.store.setState({
		loaded: true,
		values: {
			visible_provider_models: "",
			keybinding_overrides_v1: options.keybindings ?? "",
		},
		dropped: [],
		warnings: [],
	});
	const updateConfig = vi.fn(async () => ok(undefined));
	const create = vi.fn(async () => ok(session));
	vi.spyOn(actions.sessions, "updateConfig").mockImplementation(updateConfig);
	vi.spyOn(actions.sessions, "create").mockImplementation(create);
	services.commands.isEnabled = () => true;
	services.commands.run = async () => ok(undefined);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	return { sessions, favoriteModels, updateConfig, create, wrapper, loadModelsLater };
};

/**
 * Models, agents and efforts sit in flyouts, as in Conductor's model menu, so a test opens the flyout
 * first. It presses like a pointer: a flyout that closes because another opened would otherwise hand
 * focus back to its row, and that focus closes the new flyout (issue #609).
 */
const openFlyout = async (name: "Agent" | "Model" | "Effort") => {
	clickPointer(await screen.findByRole("button", { name }));
};

const openPicker = async () => {
	fireEvent.click(screen.getByRole("button", { name: "Model picker" }));
	await openFlyout("Model");
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
		await openFlyout("Agent");
		fireEvent.click(screen.getByRole("button", { name: "Codex" }));
		expect(await screen.findByText("No models found")).toBeTruthy();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("names the model by its full label on the trigger and in the model list, as Conductor does", async () => {
		const { wrapper } = harness({
			models: [
				model({ id: "m1", label: "Opus 5.5", shortLabel: "Opus" }),
				model({ id: "m2", label: "Model Two" }),
			],
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		expect(screen.getByRole("button", { name: "Model picker" }).textContent).toContain("Opus 5.5");
		await openPicker();
		expect(screen.getByRole("button", { name: /^Opus 5\.5/ })).toBeTruthy();
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
		// The default model is loadout 1; the first favourite is loadout 2.
		fireEvent.keyDown(document.body, { key: "2", metaKey: true, ctrlKey: true });
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
				queuePausedAt: null,
				closedAt: null,
				lastUserMessageAt: null,
				createdAt: 1,
				updatedAt: 1,
			},
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		// Effort is a row with a submenu, as in Conductor's picker; its choices open under it.
		await openFlyout("Effort");
		expect(await screen.findByText("Not supported for this model")).toBeTruthy();
	});

	// Conductor's loadout starts with the default model, so the favourites are loadouts 2 to 5.
	it("selects the third loadout, the second favourite, with Cmd+Ctrl+3 while the picker is closed", async () => {
		const { updateConfig, wrapper } = harness({
			favorites: [favorite("1", {}), favorite("2", { model: "m2" })],
		});
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "3", metaKey: true, ctrlKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ model: "m2" }),
			),
		);
	});

	it("selects the default model with Cmd+Ctrl+1, the loadout's first", async () => {
		const { updateConfig, wrapper } = harness({ favorites: [favorite("1", { model: "m2" })] });
		test.container.services.settings.store.setState((state) => ({
			values: {
				...state.values,
				default_model: "m2",
				default_claude_effort_level: "low",
				default_fast_mode: false,
			},
		}));
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.keyDown(document.body, { key: "1", metaKey: true, ctrlKey: true });
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ model: "m2", effort: "low" }),
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
		await openFlyout("Agent");
		fireEvent.click(screen.getByRole("button", { name: "Codex" }));
		await openFlyout("Agent");
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
		await openFlyout("Agent");
		expect(screen.getByRole("button", { name: "OpenCode" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Pi" })).toBeTruthy();
	});

	it("says Conductor's mid-chat model warning when the model changes in a started chat", async () => {
		const { wrapper } = harness();
		test.container.services.sessions.store.setState((state) => ({
			sessions: {
				...state.sessions,
				[sessionId]: { ...state.sessions[sessionId]!, lastUserMessageAt: 1 },
			},
		}));
		render(
			<>
				<ModelPicker sessionId={sessionId} />
				<Toaster />
			</>,
			{ wrapper },
		);
		const modelTwo = await openPicker();
		fireEvent.click(modelTwo);
		expect(
			await screen.findByText(
				"FYI: When you switch models mid-chat, your next response will be slower and use more tokens.",
			),
		).toBeTruthy();
	});

	it("a click on the Effort row while the Model flyout is open opens the Effort flyout", async () => {
		const { wrapper } = harness();
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		await openFlyout("Effort");
		expect(await screen.findByRole("button", { name: "Low" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Model Two/ })).toBeNull();
	});

	it("says Conductor's mid-chat effort warning when the effort changes", async () => {
		const { wrapper } = harness();
		test.container.services.sessions.store.setState((state) => ({
			sessions: {
				...state.sessions,
				[sessionId]: { ...state.sessions[sessionId]!, lastUserMessageAt: 1 },
			},
		}));
		render(
			<>
				<ModelPicker sessionId={sessionId} />
				<Toaster />
			</>,
			{ wrapper },
		);
		await openPicker();
		await openFlyout("Effort");
		fireEvent.click(await screen.findByRole("button", { name: "Low" }));
		expect(
			await screen.findByText(
				"FYI: When you switch effort mid-chat with Claude, your next response will be slower and use more tokens.",
			),
		).toBeTruthy();
	});

	it("marks a row that opens a new chat with Conductor's 'Opens in new chat'", async () => {
		const { wrapper } = harness();
		test.container.services.sessions.store.setState((state) => ({
			sessions: {
				...state.sessions,
				[sessionId]: { ...state.sessions[sessionId]!, lastUserMessageAt: 1 },
			},
		}));
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		await openPicker();
		await openFlyout("Agent");
		expect(
			(await screen.findAllByRole("img", { name: "Opens in new chat" })).length,
		).toBeGreaterThan(0);
	});

	it("says 'Could not load models.' when the model list fails", async () => {
		const { wrapper } = harness({ modelsError: true });
		render(<ModelPicker sessionId={sessionId} />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Model picker" }));
		await openFlyout("Model");
		expect(await screen.findByText("Could not load models.")).toBeTruthy();
	});
});
