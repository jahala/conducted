import { expect, test } from "bun:test";
import { NoActiveTurnError, SteerNotSupportedError, SteerRevertedError } from "./errors.ts";

test("each error is distinguishable with instanceof", () => {
	const errors = [
		new NoActiveTurnError(),
		new SteerNotSupportedError("acp"),
		new SteerRevertedError(),
	];
	expect(errors[0]).toBeInstanceOf(NoActiveTurnError);
	expect(errors[1]).toBeInstanceOf(SteerNotSupportedError);
	expect(errors[2]).toBeInstanceOf(SteerRevertedError);
	expect(errors[0]).not.toBeInstanceOf(SteerRevertedError);
	for (const error of errors) expect(error).toBeInstanceOf(Error);
});
