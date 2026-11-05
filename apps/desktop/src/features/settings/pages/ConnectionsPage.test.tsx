import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { ConnectionsPage } from "./ConnectionsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountPage() {
	test = createTestContainer();
	await test.container.services.settings.start();
	const set = vi.spyOn(test.container.actions.settings, "set");
	render(
		<ServicesProvider container={test.container}>
			<ConnectionsPage />
		</ServicesProvider>,
	);
	return { set, container: test.container };
}

describe("SET-02 ConnectionsPage", () => {
	it("rejects a range whose first port is above its last and does not save", async () => {
		const { set } = await mountPage();
		fireEvent.change(screen.getByLabelText("First port"), { target: { value: "3000" } });
		fireEvent.change(screen.getByLabelText("Last port"), { target: { value: "2000" } });
		fireEvent.click(screen.getByRole("button", { name: "Save port range" }));

		expect(
			screen.getByText("The first port must be lower than or equal to the last port."),
		).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});

	it("rejects a range that includes port 22", async () => {
		const { set } = await mountPage();
		fireEvent.change(screen.getByLabelText("First port"), { target: { value: "22" } });
		fireEvent.change(screen.getByLabelText("Last port"), { target: { value: "30" } });
		fireEvent.click(screen.getByRole("button", { name: "Save port range" }));

		expect(screen.getByText(/Port 22 is reserved for SSH/)).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});
});
