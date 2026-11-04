import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useServices } from "./context.tsx";

describe("useServices", () => {
	it("throws a message that names the provider when used outside it", () => {
		expect(() => renderHook(() => useServices())).toThrow(/ServicesProvider/);
	});
});
