import { describe, expect, test } from "bun:test";
import {
	bundleLiterals,
	checkRowOrder,
	decode,
	parseTsv,
	readsLikeWording,
	receiverOf,
	researchSettingsKeys,
	schemaTables,
	sourceStrings,
	toastReceivers,
} from "./spec.ts";

describe("the inventory reader", () => {
	test("reads every row, decodes escapes and keeps the code column out of the text", () => {
		const tsv = [
			"kind\ttext\tfile\toffset\tcontext",
			'text\tOpen project\trenderApp-DeUrsznk.js\t1719080\tclassName:"x",children:',
			"text\tLoading\\u2026\tmain-BE1h_1MP.js\t42\t",
			"",
		].join("\n");
		const rows = parseTsv(tsv);
		expect(rows.map((row) => row.text)).toEqual(["Open project", "Loading…"]);
		expect(rows[0]?.offset).toBe(1719080);
		expect(rows[0]?.file).toBe("renderApp-DeUrsznk.js");
	});

	test("a malformed line stops the build", () => {
		expect(() => parseTsv("kind\ttext\nlabel")).toThrow("Malformed inventory line");
	});

	test("rows out of file and offset order stop the build, since owners.ts counts rows in that order", () => {
		const row = (file: string, offset: number) => ({ text: "x", file, offset, before: "" });
		const sorted = [
			row("main-BE1h_1MP.js", 9),
			row("renderApp-DeUrsznk.js", 1),
			row("renderApp-DeUrsznk.js", 2),
		];
		expect(() => checkRowOrder("label", sorted)).not.toThrow();
		expect(() =>
			checkRowOrder(
				"label",
				[sorted[0], sorted[2], sorted[1]].flatMap((r) => (r ? [r] : [])),
			),
		).toThrow("label.tsv row 3 is not after row 2 in file and offset order");
		expect(() =>
			checkRowOrder("label", [row("main-BE1h_1MP.js", 9), row("main-BE1h_1MP.js", 9)]),
		).toThrow("label.tsv row 2 is not after row 1");
	});

	test("decode keeps a string it cannot read as it was", () => {
		expect(decode("Don\\'t")).toBe("Don't");
		expect(decode("bad \\x")).toBe("bad \\x");
	});
});

describe("telling toasts from log lines", () => {
	const code = [
		'kt.error("Could not save");kt.success("Saved");',
		'gp.error("Failed to flush");gp.warn("retrying");',
		't.dependencies.feedback.error("Couldn\'t update Git");t.dependencies.feedback.dismiss(id);',
	].join("");

	test("a receiver the bundle calls with toast methods and never logger methods is a toast", () => {
		const toasts = toastReceivers(code);
		expect([...toasts].sort()).toEqual(["feedback", "kt"]);
	});

	test("the receiver is the call's last name, or null when it is a call result", () => {
		expect(receiverOf("if(x){kt")).toBe("kt");
		expect(receiverOf("t.dependencies.feedback")).toBe("feedback");
		expect(receiverOf("catch(h){Mz(t)")).toBeNull();
	});
});

describe("the literal supplement", () => {
	test("wording starts like a label or sentence and is not markup, a class list or a constant", () => {
		expect(readsLikeWording("Ask to make changes, @mention files, run /commands")).toBe(true);
		expect(readsLikeWording("⌘L to focus")).toBe(true);
		expect(readsLikeWording("flex items-center gap-2")).toBe(false);
		expect(readsLikeWording("API_KEY")).toBe(false);
		expect(readsLikeWording("<div>")).toBe(false);
		expect(readsLikeWording("A")).toBe(false);
	});

	test("our source strings include quoted literals and JSX text, without comments", () => {
		const source = [
			'// "Not this"',
			'const a = "Open project";',
			"const b = `Plain template`;",
			"return <span>\n\t\tAdd to backlog\n\t</span>;",
		].join("\n");
		const found = sourceStrings(source);
		expect(found).toContain("Open project");
		expect(found).toContain("Plain template");
		expect(found).toContain("Add to backlog");
		expect(found).not.toContain("Not this");
	});

	test("bundle literals give each text its first offset", () => {
		const code = 'x="Hello there";y="Hello there";z=`Back tick`';
		const literals = bundleLiterals(code);
		expect(literals.get("Hello there")).toBe(2);
		expect(literals.get("Back tick")).toBe(code.indexOf("`Back"));
	});
});

describe("backend names from the research and the schemas", () => {
	test("settings keys come only from the 4.2.3.2 tables", () => {
		const doc = [
			"| `outside_key` | str |",
			"##### 4.2.3.2 Tables",
			"| key | type |",
			"| `default_model` | str | - |",
			"| `review_model` | str | - |",
			"#### 4.2.4 `settings.toml` schema",
			"| `after_key` | str |",
		].join("\n");
		expect(researchSettingsKeys(doc)).toEqual(["default_model", "review_model"]);
		expect(() => researchSettingsKeys("no tables")).toThrow("4.2.3.2");
	});

	test("table names come from CREATE TABLE, quoted or not", () => {
		const schema = 'CREATE TABLE repos (id);\nCREATE TABLE "sessions" (id);';
		expect(schemaTables(schema)).toEqual(["repos", "sessions"]);
	});
});
