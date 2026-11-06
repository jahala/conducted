/**
 * @feature SIDE-01 Entry point and modes (reading a file that may be missing)
 * Owns: reading a text file where a missing file is a normal answer.
 * Must handle: a missing file (`null`), any other failure (an error value that names the file and
 * keeps the cause).
 * Test first: load-sdk.test.ts reads an agent binaries folder with no SDK through it and gets
 * "not installed".
 */
import { readFile } from "node:fs/promises";
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";

/** Reads a text file; a missing file is `null`, any other failure an error value. */
export async function readTextIfPresent(target: string): Promise<Result<string | null, AppError>> {
	try {
		return ok(await readFile(target, "utf8"));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ok(null);
		return err(
			appError("file_read_failed", `Could not read ${target}: ${messageOf(cause)}`, cause),
		);
	}
}
