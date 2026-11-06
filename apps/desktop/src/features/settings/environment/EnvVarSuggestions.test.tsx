import { AGENT_PROVIDER_TABLE, signInEnvVars } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { isReservedEnvVarName } from "../../../core/services/settings.ts";
import { EnvironmentPage } from "../pages/EnvironmentPage.tsx";
import { EnvVarSuggestions, suggestEnvVars } from "./EnvVarSuggestions.tsx";

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
	await screen.findByLabelText("Name");
	return test;
}

describe("SET-11 EnvVarSuggestions", () => {
	it("hides a name already set in the scope and still offers the other proxy names", () => {
		render(<EnvVarSuggestions query="prox" existingNames={["HTTPS_PROXY"]} onPick={() => {}} />);

		expect(screen.queryByRole("button", { name: /HTTPS_PROXY/ })).toBeNull();
		expect(screen.getByRole("button", { name: /HTTP_PROXY/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /NO_PROXY/ })).toBeTruthy();
	});

	it("picks a suggested name and never a value", () => {
		const onPick = vi.fn();
		render(<EnvVarSuggestions query="openai_api" existingNames={[]} onPick={onPick} />);

		fireEvent.click(screen.getByRole("button", { name: /OPENAI_API_KEY/ }));

		expect(onPick).toHaveBeenCalledWith("OPENAI_API_KEY");
	});

	it("hides the list when nothing matches", () => {
		render(<EnvVarSuggestions query="zzzzzz" existingNames={[]} onPick={() => {}} />);

		expect(screen.queryByRole("list", { name: "Suggested variables" })).toBeNull();
	});

	it("never suggests a name the app sets itself", () => {
		render(<EnvVarSuggestions query="" existingNames={[]} onPick={() => {}} />);

		const names = screen.getAllByRole("button").map((button) => button.textContent ?? "");
		expect(names.some((name) => name.startsWith("CONDUCTED_"))).toBe(false);
		// The list itself holds no reserved name: nothing filters them out at run time.
		expect(suggestEnvVars("", []).filter((entry) => isReservedEnvVarName(entry.name))).toEqual([]);
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

		const outside = suggestEnvVars("", [])
			.filter((entry) => entry.group !== "proxy" && !tableNames.has(entry.name))
			.map((entry) => entry.name);

		expect(outside).toEqual([
			"ANTHROPIC_AUTH_TOKEN",
			"AWS_REGION",
			"AWS_PROFILE",
			"CODEX_API_KEY",
			"CODEX_ACCESS_TOKEN",
		]);
	});

	it("says a secret's value goes to the Keychain", () => {
		render(<EnvVarSuggestions query="anthropic_api" existingNames={[]} onPick={() => {}} />);

		const option = screen.getByRole("button", { name: /ANTHROPIC_API_KEY/ });
		expect(option.textContent).toContain("Keychain");
	});
});

describe("SET-11 Environment form suggestions", () => {
	it("offers a suggestion in the real page and fills only the name field", async () => {
		await mountEnvironmentPage(["HTTPS_PROXY"]);
		await screen.findByText("HTTPS_PROXY", { selector: "td" });

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "prox" } });

		expect(screen.queryByRole("button", { name: /HTTPS_PROXY/ })).toBeNull();
		const suggestion = screen.getByRole("button", { name: /HTTP_PROXY/ });
		fireEvent.click(suggestion);

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("HTTP_PROXY"),
		);
		expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("");
	});

	it("moves through suggestions with the arrow keys and picks with Enter", async () => {
		await mountEnvironmentPage();

		const name = screen.getByLabelText("Name");
		fireEvent.change(name, { target: { value: "https_pro" } });
		fireEvent.keyDown(name, { key: "ArrowDown" });
		fireEvent.keyDown(name, { key: "Enter" });

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("HTTPS_PROXY"),
		);
	});

	it("hides the suggestions with Escape and leaves the typed text", async () => {
		await mountEnvironmentPage();

		const name = screen.getByLabelText("Name");
		fireEvent.change(name, { target: { value: "prox" } });
		expect(screen.getByRole("button", { name: /HTTP_PROXY/ })).toBeTruthy();

		fireEvent.keyDown(name, { key: "Escape" });

		expect(screen.queryByRole("button", { name: /HTTP_PROXY/ })).toBeNull();
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("prox");
	});
});
