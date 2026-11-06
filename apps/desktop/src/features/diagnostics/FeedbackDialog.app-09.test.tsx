/**
 * @feature APP-09 Send feedback
 * Owns: the tests that the Feedback dialog opens from Cmd+Alt+F and the palette at the app root,
 * and that sending it opens the project's issue page and thanks the user.
 * Behaviour: ui-map.md 5.1 (palette action "Send feedback"), 5.2 (the Feedback dialog), 5.4
 * (Cmd+Alt+F); inventory:toast row 983 ("Thank you for your feedback!").
 * Test first: Cmd+Alt+F opens the dialog; sending a message opens the issue page and says thanks.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { FEEDBACK_ISSUE_URL } from "../../core/services/system.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { toast } from "../../ui/Toast.tsx";

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	useOverlayStore.getState().close();
	for (const container of containers.splice(0)) container.close();
});

async function mountRoot() {
	const test = createTestContainer();
	containers.push(test);
	await test.container.services.settings.start();
	// seam: APP-09 the browser is outside the app; the test reads the URL it would open.
	const openUrl = vi.spyOn(test.container.platform.opener, "openUrl").mockResolvedValue();
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { test, openUrl };
}

const openWithShortcut = async () => {
	fireEvent.keyDown(document, { key: "f", metaKey: true, altKey: true });
	return screen.findByRole("dialog", { name: "Feedback" });
};

describe("APP-09 the Feedback dialog", () => {
	it("APP-09 Cmd+Alt+F opens the Feedback dialog", async () => {
		await mountRoot();

		await openWithShortcut();

		expect(screen.getByLabelText("Message")).toBeTruthy();
		expect(screen.getByLabelText("Your email")).toBeTruthy();
		expect(screen.getByText("Include recent app logs (may include personal data)")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: /Send feedback/ }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("APP-09 the palette's Send feedback opens the dialog", async () => {
		await mountRoot();
		fireEvent.keyDown(document, { key: "k", metaKey: true });
		const input = await screen.findByPlaceholderText("Type a command or search...");

		fireEvent.change(input, { target: { value: "Send feedback" } });
		fireEvent.click(await screen.findByRole("option", { name: /Send feedback/ }));

		expect(await screen.findByRole("dialog", { name: "Feedback" })).toBeTruthy();
	});

	it("APP-09 sending opens the issue page with the message and says thanks", async () => {
		const { test, openUrl } = await mountRoot();
		test.memory.controls.files.set("/Users/me/shot.png", "png");
		test.memory.controls.queueDialogAnswers({
			files: ["/Users/me/shot.png", "/Users/me/notes.txt"],
		});
		await openWithShortcut();

		fireEvent.change(screen.getByLabelText("Message"), {
			target: { value: "The sidebar flickers" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Attach images" }));
		expect(await screen.findByText("Please select image files only.")).toBeTruthy();
		expect(screen.getByRole("img", { name: "shot.png" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Send feedback/ }));

		expect(await screen.findByText("Thank you for your feedback!")).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Feedback" })).toBeNull());
		const url = new URL(String(openUrl.mock.calls[0]?.[0]));
		expect(`${url.origin}${url.pathname}`).toBe(FEEDBACK_ISSUE_URL);
		expect(url.searchParams.get("body")).toContain("The sidebar flickers");
		expect(url.searchParams.get("body")).toContain("/Users/me/shot.png");
		expect(url.searchParams.get("body")).not.toContain("notes.txt");
	});

	it("APP-09 a failed log export keeps the dialog open and says why", async () => {
		const { openUrl } = await mountRoot();
		await openWithShortcut();

		fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Crash on start" } });
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: /Send feedback/ }));

		expect((await screen.findByRole("alert")).textContent).toBe(
			"The recent app logs could not be read.",
		);
		expect(screen.getByRole("dialog", { name: "Feedback" })).toBeTruthy();
		expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Crash on start");
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("APP-09 a sixth image is refused", async () => {
		const { test } = await mountRoot();
		const paths = ["a", "b", "c", "d", "e", "f"].map((name) => `/Users/me/${name}.png`);
		test.memory.controls.queueDialogAnswers({ files: paths });
		await openWithShortcut();

		fireEvent.click(screen.getByRole("button", { name: "Attach images" }));

		expect(await screen.findByText("Maximum 5 images allowed.")).toBeTruthy();
		expect(screen.getAllByRole("img")).toHaveLength(5);
	});
});
