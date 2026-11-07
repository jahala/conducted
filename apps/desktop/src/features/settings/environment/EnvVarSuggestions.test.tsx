import { AGENT_PROVIDER_TABLE, signInEnvVars } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { isReservedEnvVarName } from "../../../core/services/settings.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { EnvironmentPage } from "../pages/EnvironmentPage.tsx";
import {
	DOCUMENTED_ENV_VARS,
	documentedMeaning,
	orderSetNames,
	unsetDocumentedEnvVars,
} from "./EnvVarSuggestions.tsx";
import { EnvVarTable } from "./EnvVarTable.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountEnvironmentPage(existing: readonly string[] = []) {
	test = createTestContainer();
	await test.container.services.settings.start();
	for (const name of existing) {
		const saved = await test.container.services.settings.setEnvVar(name, "value", "global");
		expect(saved.ok).toBe(true);
	}
	render(
		<ServicesProvider container={test.container}>
			<EnvironmentPage />
		</ServicesProvider>,
	);
	await screen.findByRole("button", { name: /Show documented variables/ });
	return test;
}

/** The table with no variables set and the documented names behind their link. */
function renderDocumented(setNames: readonly string[], onSave = vi.fn(async () => true)) {
	render(
		<EnvVarTable
			scopeLabel="shared"
			rows={setNames.map((name) => ({ name, hasValue: true, editable: true, canRename: false }))}
			documented={unsetDocumentedEnvVars(setNames)}
			onReveal={async () => "value"}
			onCopy={() => undefined}
			onSave={onSave}
			onDelete={async () => true}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /Show documented variables/ }));
	return { onSave };
}

describe("SET-11 documented variables", () => {
	it("leaves a name already set out of the unset list and still offers the other proxy names", () => {
		renderDocumented(["HTTPS_PROXY"]);

		expect(screen.queryByRole("button", { name: "Set HTTPS_PROXY" })).toBeNull();
		expect(screen.getByRole("button", { name: "Set HTTP_PROXY" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Set NO_PROXY" })).toBeTruthy();
	});

	it("sets a documented name with its name fixed and no value", async () => {
		const { onSave } = renderDocumented([]);

		fireEvent.click(screen.getByRole("button", { name: "Set OPENAI_API_KEY" }));

		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		const name = within(panel).getByLabelText("Name") as HTMLInputElement;
		expect(name.value).toBe("OPENAI_API_KEY");
		expect(name.disabled).toBe(true);
		expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("");
		fireEvent.change(within(panel).getByLabelText("Value"), { target: { value: "sk-1" } });
		fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				name: "OPENAI_API_KEY",
				value: "sk-1",
				previousName: null,
			}),
		);
	});

	it("keeps the unset names behind their link, with the count", () => {
		render(
			<EnvVarTable
				scopeLabel="shared"
				rows={[]}
				documented={unsetDocumentedEnvVars([])}
				onReveal={async () => null}
				onCopy={() => undefined}
				onSave={async () => true}
				onDelete={async () => true}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Set HTTP_PROXY" })).toBeNull();
		const link = screen.getByRole("button", {
			name: `Show documented variables (${DOCUMENTED_ENV_VARS.length})`,
		});
		fireEvent.click(link);
		expect(screen.getAllByText("Not set")).toHaveLength(DOCUMENTED_ENV_VARS.length);
		fireEvent.click(screen.getByRole("button", { name: "Hide documented variables" }));
		expect(screen.queryByRole("button", { name: "Set HTTP_PROXY" })).toBeNull();
	});

	it("never documents a name the app sets itself", () => {
		renderDocumented([]);

		const names = screen
			.getAllByRole("button", { name: /^Set / })
			.map((button) => button.getAttribute("aria-label") ?? "");
		expect(names.some((name) => name.startsWith("Set CONDUCTED_"))).toBe(false);
		// The list itself holds no reserved name: nothing filters them out at run time.
		expect(DOCUMENTED_ENV_VARS.filter((entry) => isReservedEnvVarName(entry.name))).toEqual([]);
	});

	it("names outside the agent-provider table are only the ones the table does not own", () => {
		const tableNames = new Set(
			(["claude", "codex", "cursor"] as const).flatMap((agent) => {
				const facts = AGENT_PROVIDER_TABLE[agent];
				return [
					...(facts.baseUrlEnvVar === undefined ? [] : [facts.baseUrlEnvVar]),
					...facts.signIns.flatMap((signIn) => [
						...signInEnvVars(signIn),
						...(signIn.routingEnvVar === undefined ? [] : [signIn.routingEnvVar]),
					]),
				];
			}),
		);
		const proxies = new Set(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]);

		const outside = DOCUMENTED_ENV_VARS.filter(
			(entry) => !proxies.has(entry.name) && !tableNames.has(entry.name),
		).map((entry) => entry.name);

		expect(outside).toEqual([
			"ANTHROPIC_AUTH_TOKEN",
			"AWS_REGION",
			"AWS_PROFILE",
			"ANTHROPIC_VERTEX_PROJECT_ID",
			"CODEX_API_KEY",
			"AI_GATEWAY_API_KEY",
			"OPENAI_ORG",
			"OPENAI_PROJECT",
			"CODEX_ACCESS_TOKEN",
		]);
	});

	// The meanings are Conductor's (renderApp lSt @10708808).
	it("gives Conductor's meaning under a documented name", () => {
		renderDocumented([]);

		const name = screen.getByText("ANTHROPIC_API_KEY");
		const cell = name.closest("td");
		expect(cell?.textContent).toContain("Authenticates Claude Code with the Anthropic API.");
		expect(documentedMeaning("anthropic_api_key")).toBe(
			"Authenticates Claude Code with the Anthropic API.",
		);
	});
});

describe("SET-11 documented variables on the Environment page", () => {
	it("sets a documented name from the real page and stores only what was typed", async () => {
		const mounted = await mountEnvironmentPage(["HTTPS_PROXY"]);
		expect(await screen.findByText("HTTPS_PROXY")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Show documented variables/ }));
		expect(screen.queryByRole("button", { name: "Set HTTPS_PROXY" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Set HTTP_PROXY" }));
		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("");
		fireEvent.change(within(panel).getByLabelText("Value"), {
			target: { value: "http://proxy:8080" },
		});
		fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));

		await waitFor(async () =>
			expect(await mounted.memory.platform.keychain.get("env:global:HTTP_PROXY")).toEqual({
				ok: true,
				value: "http://proxy:8080",
			}),
		);
	});

	it("lists a set documented name first, with its meaning, then the others by name", async () => {
		await mountEnvironmentPage(["ZED", "NO_PROXY", "ALPHA"]);
		await screen.findByText("ZED");

		const names = screen
			.getAllByRole("row")
			.map((row) => row.querySelector(".font-mono")?.textContent ?? "");
		expect(names).toEqual(["NO_PROXY", "ALPHA", "ZED"]);
		expect(screen.getByText("Skips the proxy for matching hosts and domains.")).toBeTruthy();
		expect(orderSetNames(["ZED", "NO_PROXY", "ALPHA"])).toEqual(["NO_PROXY", "ALPHA", "ZED"]);
	});

	it("closes the side panel with Escape and keeps the documented list open", async () => {
		await mountEnvironmentPage();

		fireEvent.click(screen.getByRole("button", { name: /Show documented variables/ }));
		fireEvent.click(screen.getByRole("button", { name: "Set HTTP_PROXY" }));
		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		fireEvent.keyDown(within(panel).getByLabelText("Value"), { key: "Escape" });

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByRole("button", { name: "Set HTTP_PROXY" })).toBeTruthy();
	});
});
