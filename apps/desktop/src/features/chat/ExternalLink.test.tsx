import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

const toast = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("../../ui/Toast.tsx", () => toast);

const { ExternalLink } = await import("./ExternalLink.tsx");

const openUrl = vi.fn();
let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
	vi.spyOn(test.container.actions.app, "openUrl").mockImplementation(openUrl);
	openUrl.mockReset().mockResolvedValue(ok(undefined));
	toast.toastError.mockReset();
});

afterEach(() => {
	cleanup();
	test.close();
});

function show(url: string) {
	return render(
		<ServicesProvider container={test.container}>
			<ExternalLink url={url}>the link</ExternalLink>
		</ServicesProvider>,
	);
}

describe("CHAT-06 external link", () => {
	it("opens a web address through the opener and does not navigate the window", () => {
		show("https://example.com/docs");
		const link = screen.getByRole("link", { name: "the link" });
		expect(fireEvent.click(link)).toBe(false);
		expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true }))).toBe(
			false,
		);
		expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("gives a file or script address no link at all", () => {
		show("javascript:alert(1)");
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("the link").getAttribute("href")).toBeNull();
		fireEvent.click(screen.getByText("the link"));
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("tells the user when the address could not be opened", async () => {
		openUrl.mockResolvedValue(err(appError("open_failed", "No app can open this.")));
		show("mailto:someone@example.com");
		fireEvent.click(screen.getByRole("link", { name: "the link" }));
		await waitFor(() =>
			expect(toast.toastError).toHaveBeenCalledWith("Couldn't open the link", {
				code: "open_failed",
				message: "No app can open this.",
			}),
		);
	});

	it("stays quiet when the address opened", async () => {
		show("https://example.com");
		fireEvent.click(screen.getByRole("link", { name: "the link" }));
		await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
		expect(toast.toastError).not.toHaveBeenCalled();
	});
});
