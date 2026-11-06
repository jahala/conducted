import type { AgentInstall } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { providerKeychainRef } from "../../../core/services/agent-catalog.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AgentsPage } from "../pages/AgentsPage.tsx";
import { AgentProvidersDialog } from "./AgentProvidersDialog.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), toastError: vi.fn() }));

vi.mock("../../../ui/Toast.tsx", () => ({
	toast: toasts.toast,
	toastError: toasts.toastError,
}));

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

beforeEach(() => {
	toasts.toast.mockReset();
	toasts.toastError.mockReset();
});

const install = (changes: Partial<AgentInstall> = {}): AgentInstall => ({
	agent: "claude",
	installed: true,
	authenticated: false,
	...changes,
});

async function mount(value: AgentInstall, onSignIn = vi.fn()) {
	test = createTestContainer();
	await test.container.services.settings.start();
	render(
		<ServicesProvider container={test.container}>
			<AgentProvidersDialog open install={value} onOpenChange={() => {}} onSignIn={onSignIn} />
		</ServicesProvider>,
	);
	return { current: test, onSignIn };
}

async function choose(selectName: string, optionName: string) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: selectName }), { key: "Enter" });
	fireEvent.keyDown(await screen.findByRole("option", { name: optionName }), { key: "Enter" });
}

describe("SET-09 provider keys", () => {
	it("opens the Providers dialog from the Agents page", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		test.container.services.agentCatalog.setInstalls([install()]);
		vi.spyOn(test.container.actions.agents, "refresh").mockResolvedValue(ok(undefined));
		render(
			<ServicesProvider container={test.container}>
				<AgentsPage />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Providers" }));

		expect(await screen.findByRole("heading", { name: "Providers" })).toBeTruthy();
		expect(screen.getByLabelText("Anthropic API key")).toBeTruthy();
	});

	it("saves an Anthropic API key, then removes it from the Keychain", async () => {
		const { current } = await mount(install());

		fireEvent.change(screen.getByLabelText("Anthropic API key"), {
			target: { value: "sk-ant-secret" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const key = {
			agent: "claude" as const,
			acpAgent: null,
			provider: "anthropic",
			envVar: "ANTHROPIC_API_KEY",
		};
		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual({
			ok: true,
			value: "sk-ant-secret",
		});
		fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key removed"));
		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual({
			ok: true,
			value: null,
		});
	});

	it("records 'Use the key from this Mac' without storing a secret", async () => {
		const { current } = await mount(install());

		fireEvent.click(screen.getByRole("checkbox", { name: "Use the key from this Mac" }));
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key imported from env"));
		expect(current.container.services.agentCatalog.store.getState().providerKeys?.claude).toEqual({
			state: "ready",
			data: [
				{
					agent: "claude",
					acpAgent: null,
					provider: "anthropic",
					envVar: "ANTHROPIC_API_KEY",
					source: "this_mac",
				},
			],
		});
	});

	it("saves a Claude Code subscription token", async () => {
		const { current } = await mount(install());

		await choose("Provider", "Claude Code subscription");
		fireEvent.change(screen.getByLabelText("Claude Code subscription token"), {
			target: { value: "oauth-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const key = {
			agent: "claude" as const,
			acpAgent: null,
			provider: "anthropic",
			envVar: "CLAUDE_CODE_OAUTH_TOKEN",
		};
		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual({
			ok: true,
			value: "oauth-token",
		});
	});

	it("saves a Bedrock API key and the provider choice", async () => {
		const { current } = await mount(install());

		await choose("Provider", "Amazon Bedrock");
		await waitFor(() =>
			expect(current.container.services.settings.get("claude_provider")).toBe("bedrock"),
		);
		fireEvent.change(screen.getByLabelText("Bedrock API key"), {
			target: { value: "bedrock-key" },
		});
		fireEvent.change(screen.getByLabelText("Region"), { target: { value: "eu-north-1" } });
		fireEvent.change(screen.getByLabelText("Test model"), {
			target: { value: "anthropic.claude-test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Bedrock credentials" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const base = { agent: "claude" as const, acpAgent: null, provider: "bedrock" };
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({ ...base, envVar: "AWS_BEARER_TOKEN_BEDROCK" }),
			),
		).toEqual({ ok: true, value: "bedrock-key" });
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({ ...base, envVar: "ANTHROPIC_MODEL" }),
			),
		).toEqual({ ok: true, value: "anthropic.claude-test" });
		await waitFor(() =>
			expect(current.container.services.settings.get("bedrock_region")).toBe("eu-north-1"),
		);
	});

	it("refuses an incomplete Bedrock form and saves AWS access keys when complete", async () => {
		const { current } = await mount(install());

		await choose("Provider", "Amazon Bedrock");
		fireEvent.click(screen.getByRole("button", { name: "Save Bedrock credentials" }));
		expect(await screen.findByText("Enter all required Bedrock fields.")).toBeTruthy();

		await choose("Bedrock credentials", "AWS access keys");
		fireEvent.change(screen.getByLabelText("Access key ID"), { target: { value: "AKIA123" } });
		fireEvent.change(screen.getByLabelText("Secret access key"), {
			target: { value: "secret-key" },
		});
		fireEvent.change(screen.getByLabelText("Session token (optional)"), {
			target: { value: "session-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Bedrock credentials" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const base = { agent: "claude" as const, acpAgent: null, provider: "bedrock" };
		for (const [envVar, value] of [
			["AWS_ACCESS_KEY_ID", "AKIA123"],
			["AWS_SECRET_ACCESS_KEY", "secret-key"],
			["AWS_SESSION_TOKEN", "session-token"],
		] as const) {
			expect(
				await current.memory.platform.keychain.get(providerKeychainRef({ ...base, envVar })),
			).toEqual({ ok: true, value });
		}
	});

	it("saves the Vertex project and application credentials", async () => {
		const { current } = await mount(install());

		await choose("Provider", "Google Vertex AI");
		fireEvent.change(screen.getByLabelText("Vertex project"), {
			target: { value: "my-gcp-project" },
		});
		fireEvent.change(screen.getByLabelText("Application credentials"), {
			target: { value: "/Users/me/credentials.json" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Vertex settings" }));

		await waitFor(() =>
			expect(current.container.services.settings.get("vertex_project_id")).toBe("my-gcp-project"),
		);
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({
					agent: "claude",
					acpAgent: null,
					provider: "vertex",
					envVar: "GOOGLE_APPLICATION_CREDENTIALS",
				}),
			),
		).toEqual({ ok: true, value: "/Users/me/credentials.json" });
	});

	it("offers the Codex ChatGPT account, starts its sign-in, and saves an OpenAI key", async () => {
		const { current, onSignIn } = await mount(
			install({ agent: "codex", authenticated: true, authMethod: "chatgpt" }),
		);

		expect(screen.getByText("Codex is signed in with your ChatGPT plan.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Sign in with ChatGPT" }));
		expect(onSignIn).toHaveBeenCalledTimes(1);

		await choose("Provider", "OpenAI API key");
		fireEvent.change(screen.getByLabelText("OpenAI API key"), {
			target: { value: "sk-openai" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({
					agent: "codex",
					acpAgent: null,
					provider: "openai",
					envVar: "OPENAI_API_KEY",
				}),
			),
		).toEqual({ ok: true, value: "sk-openai" });
	});

	it("saves a Cursor API key", async () => {
		const { current } = await mount(install({ agent: "cursor" }));

		fireEvent.change(screen.getByLabelText("Cursor API key"), {
			target: { value: "cursor-key" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({
					agent: "cursor",
					acpAgent: null,
					provider: "cursor",
					envVar: "CURSOR_API_KEY",
				}),
			),
		).toEqual({ ok: true, value: "cursor-key" });
	});

	it("opens the Custom provider dialog and saves its key and optional workspace ID", async () => {
		const { current } = await mount(install());

		await choose("Provider", "Custom provider");
		expect(await screen.findByRole("heading", { name: "Custom provider" })).toBeTruthy();
		fireEvent.change(screen.getByLabelText("API key"), {
			target: { value: "custom-key" },
		});
		fireEvent.change(screen.getByLabelText("Workspace ID (optional)"), {
			target: { value: "workspace-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const base = { agent: "claude" as const, acpAgent: null, provider: "custom" };
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({ ...base, envVar: "ANTHROPIC_API_KEY" }),
			),
		).toEqual({ ok: true, value: "custom-key" });
		expect(
			await current.memory.platform.keychain.get(
				providerKeychainRef({ ...base, envVar: "ANTHROPIC_WORKSPACE_ID" }),
			),
		).toEqual({ ok: true, value: "workspace-1" });
		await waitFor(() =>
			expect(current.container.services.settings.get("claude_provider")).toBe("custom"),
		);
	});
});
