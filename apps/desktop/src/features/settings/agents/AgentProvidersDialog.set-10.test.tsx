import type { AgentInstall, AgentProvider } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { providerKeychainRef } from "../../../core/services/agent-catalog.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AgentProvidersDialog } from "./AgentProvidersDialog.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), toastError: vi.fn() }));

vi.mock("../../../ui/Toast.tsx", () => ({
	toast: toasts.toast,
	toastError: toasts.toastError,
}));

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.container.sidecar.stop();
	test?.close();
	test = undefined;
});

beforeEach(() => {
	toasts.toast.mockReset();
	toasts.toastError.mockReset();
});

const install: AgentInstall = {
	agent: "acp",
	acpAgent: "opencode",
	installed: true,
};

const providers: AgentProvider[] = [
	{ id: "deepseek", label: "DeepSeek", keyEnvVars: ["DEEPSEEK_API_KEY"] },
	{ id: "openrouter", label: "OpenRouter", keyEnvVars: ["OPENROUTER_API_KEY"] },
	{
		id: "custom",
		label: "Custom provider",
		keyEnvVars: ["OPENAI_API_KEY", "OPENCODE_WORKSPACE_ID"],
	},
];

interface SidecarRequest {
	id?: number;
	method?: string;
}

const requests = (current: TestContainer): SidecarRequest[] =>
	current.memory.controls.sidecarSent.flatMap((line) => {
		try {
			return [JSON.parse(line) as SidecarRequest];
		} catch {
			return [];
		}
	});

async function mounted() {
	test = createTestContainer();
	await test.container.services.settings.start();
	expect((await test.container.sidecar.start()).ok).toBe(true);
	render(
		<ServicesProvider container={test.container}>
			<AgentProvidersDialog open install={install} onOpenChange={() => {}} onSignIn={() => {}} />
		</ServicesProvider>,
	);

	await waitFor(() =>
		expect(
			requests(test as TestContainer).some((request) => request.method === "listAgentProviders"),
		).toBe(true),
	);
	const request = requests(test).find((sent) => sent.method === "listAgentProviders");
	if (request?.id === undefined) throw new Error("no listAgentProviders request");
	test.memory.controls.emitSidecarLine(
		JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { providers } }),
	);
	return test;
}

async function choose(selectName: string, optionName: string) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: selectName }), { key: "Enter" });
	fireEvent.keyDown(await screen.findByRole("option", { name: optionName }), { key: "Enter" });
}

describe("SET-10 OpenCode providers", () => {
	it("lists the catalogue and saves a key for the chosen provider", async () => {
		const current = await mounted();

		await choose("Provider", "DeepSeek");
		expect(await screen.findByLabelText("DeepSeek")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("DeepSeek"), {
			target: { value: "sk-deepseek" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("API key saved"));
		const key = {
			agent: "acp" as const,
			acpAgent: "opencode" as const,
			provider: "deepseek",
			envVar: "DEEPSEEK_API_KEY",
		};
		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual({
			ok: true,
			value: "sk-deepseek",
		});
		expect(
			current.container.services.agentCatalog.store.getState().providerKeys?.["acp:opencode"],
		).toEqual({
			state: "ready",
			data: [
				{
					agent: "acp",
					acpAgent: "opencode",
					provider: "deepseek",
					envVar: "DEEPSEEK_API_KEY",
					source: "entered",
				},
			],
		});
	});

	it("saves the Filter models list the picker reads", async () => {
		const current = await mounted();

		fireEvent.change(screen.getByLabelText("Filter models"), {
			target: { value: "anthropic/claude-sonnet, openai/gpt-5" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save filter" }));

		await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith("Model filter saved"));
		expect(current.container.services.settings.get("visible_provider_models")).toBe(
			"anthropic/claude-sonnet, openai/gpt-5",
		);
	});

	it("shows the sidecar's failure instead of an empty provider list", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		expect((await test.container.sidecar.start()).ok).toBe(true);
		render(
			<ServicesProvider container={test.container}>
				<AgentProvidersDialog open install={install} onOpenChange={() => {}} onSignIn={() => {}} />
			</ServicesProvider>,
		);
		await waitFor(() =>
			expect(
				requests(test as TestContainer).some((request) => request.method === "listAgentProviders"),
			).toBe(true),
		);
		const request = requests(test).find((sent) => sent.method === "listAgentProviders");
		if (request?.id === undefined) throw new Error("no listAgentProviders request");
		test.memory.controls.emitSidecarLine(
			JSON.stringify({
				jsonrpc: "2.0",
				id: request.id,
				error: { code: -32000, message: "The sidecar is not running" },
			}),
		);

		expect((await screen.findByRole("alert")).textContent).toContain("The sidecar is not running");
	});
});
