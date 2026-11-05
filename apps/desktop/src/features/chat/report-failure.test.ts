import { appError, err, ok } from "@conducted/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("../../ui/Toast.tsx", () => toast);

const { reportFailure } = await import("./report-failure.ts");

beforeEach(() => toast.toastError.mockReset());

describe("CHAT-06 report a failed action", () => {
	it("shows the title and the error's message for a failed result", async () => {
		const error = appError("copy_failed", "The clipboard is busy.");
		await reportFailure(Promise.resolve(err(error)), "Couldn't copy the message");
		expect(toast.toastError).toHaveBeenCalledWith("Couldn't copy the message", error);
	});

	it("shows nothing for a successful result", async () => {
		await reportFailure(Promise.resolve(ok(undefined)), "Couldn't copy the message");
		expect(toast.toastError).not.toHaveBeenCalled();
	});
});
