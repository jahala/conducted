import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { GitPage } from "./GitPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("SET-02 GitPage", () => {
	it("previews a custom branch prefix", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GitPage />
			</ServicesProvider>,
		);

		const type = screen.getByRole("combobox", { name: "Branch name prefix" });
		fireEvent.keyDown(type, { key: "Enter" });
		const custom = await screen.findByRole("option", { name: "Custom text" });
		fireEvent.keyDown(custom, { key: "Enter" });

		const prefix = screen.getByLabelText("Custom branch prefix");
		fireEvent.change(prefix, { target: { value: "feature/" } });
		fireEvent.blur(prefix);

		await waitFor(() =>
			expect(screen.getByTestId("branch-prefix-preview").textContent).toBe("feature/<name>"),
		);
	});
});
