/**
 * @feature DATA-05 Settings store and settings files
 * Owns: the production TOML reader and writer the settings service calls, built on smol-toml.
 * Behaviour: services-map.md 4.2.1 (settings files are TOML), 4.2.4 (schema, named actions and env
 * var tables are TOML tables).
 * Must handle: invalid text returns an error Result and never throws; a document with `$schema`,
 * nested tables and string arrays survives a parse and a write.
 * Test first: a written document parses back to the same object.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { parse, stringify } from "smol-toml";
import type { TomlCodec } from "./settings.ts";

/** Reads and writes the TOML of settings files. Values are plain objects, never class instances. */
export const tomlCodec: TomlCodec = {
	parse(text): Result<Record<string, unknown>> {
		try {
			const value: unknown = parse(text);
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				return err(appError("toml_invalid", "A settings file must be a TOML table."));
			}
			return ok(value as Record<string, unknown>);
		} catch (cause) {
			return err(
				appError(
					"toml_invalid",
					cause instanceof Error ? cause.message : "The settings file is not valid TOML.",
					cause,
				),
			);
		}
	},
	stringify: (value) => stringify(value),
};
