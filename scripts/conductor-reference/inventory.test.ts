import { describe, expect, test } from "bun:test";
import { buildInventory, type Chunk, countParams, resultColumns } from "./inventory.ts";

// A made-up two-chunk bundle in the shape a minifier writes: the core chunk defines the invoke and
// listen wrappers and the JSON-RPC tunnel, and exports them under short names; the screen chunk
// imports them under other names.
const core: Chunk = {
	file: "core-AAAA1111.js",
	text: [
		"async function k(a,b={},c){return window.__TAURI_INTERNALS__.invoke(a,b,c)}",
		'async function L(a,b,c){const d={kind:"Any"};return k("plugin:event|listen",{event:a,target:d,handler:f(b)}).then(e=>async()=>u(a,e))}',
		'function f(a){return a}const Q={PING:"ping",GET_LIST:"getList"},N={HELLO:"hello"};',
		'class R{constructor(){this.peer=new X.JSONRPCServerAndClient(1,2)}}const T=new R,EV="thing-changed";',
		'async function boot(){const s=await k("get_home",{verbose:!0});console.log(s.path,s.user);',
		'await k("plugin:fs|read_file",{path:"x"});T.notify(Q.PING,{});const r=await T.requestWithTimeout(Q.GET_LIST,{id:1});',
		'T.addMethod(N.HELLO,()=>1);await L(EV,()=>{});await L("menu_open",()=>{});k(cmd,{});',
		'const rows=await db.select("SELECT id, name AS title FROM items WHERE kind = ? AND owner = ?",[1,2]);}',
		"export{k as i,L as l,T as t,Q as q};",
	].join(""),
};
const screen: Chunk = {
	file: "screen-BBBB2222.js",
	text: [
		'import{i as call,l as on,t as rpc,q as M}from"./core-AAAA1111.js";',
		'async function view(){const{code,stdout}=await call("run_thing",{program:"git",args:[]});',
		'on("tick",()=>{});rpc.request(M.GET_LIST,{});',
		'await call("plugin:window|set_title",{title:"x"});',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the sample bundle holds a template literal.
		"db.execute(`UPDATE items SET name = ? WHERE id IN (${ids})`,[]);}",
	].join(""),
};

describe("buildInventory", () => {
	const inventory = buildInventory([core, screen]);

	test("finds custom commands through wrappers and imports, with argument keys and reads", () => {
		const names = inventory.commands.map((entry) => entry.name);
		expect(names).toEqual(["get_home", "run_thing"]);
		const home = inventory.commands[0]?.sites[0];
		expect(home).toMatchObject({ file: core.file, args: ["verbose"], reads: ["path", "user"] });
		expect(inventory.commands[1]?.sites[0]).toMatchObject({
			file: screen.file,
			args: ["program", "args"],
			reads: ["code", "stdout"],
		});
	});

	test("groups plugin commands by plugin, including names that are only written as literals", () => {
		expect(Object.keys(inventory.plugins)).toEqual(["event", "fs", "window"]);
		expect(inventory.plugins.fs?.[0]?.sites[0]?.args).toEqual(["path"]);
		expect(inventory.plugins.event?.[0]?.name).toBe("listen");
	});

	test("resolves listened events from literals and string constants", () => {
		expect(inventory.events.map((entry) => entry.name)).toEqual([
			"menu_open",
			"thing-changed",
			"tick",
		]);
	});

	test("lists sidecar methods by direction, including enum members no site uses", () => {
		const methods = inventory.sidecar.map(
			(entry) => `${entry.direction} ${entry.method} ${entry.uses.join("+")}`,
		);
		expect(methods).toEqual([
			"from-sidecar hello handle",
			"to-sidecar getList request",
			"to-sidecar ping notify",
		]);
		expect(inventory.sidecar[1]?.sites).toHaveLength(2);
	});

	test("records a call whose name is decided at run time", () => {
		expect(inventory.dynamic).toEqual([
			{ file: core.file, offset: core.text.indexOf("k(cmd"), wrapper: "k" },
		]);
	});

	test("collects SQL with its placeholders, tables and result columns", () => {
		const statements = inventory.sql.map((entry) => entry.statement);
		expect(statements).toEqual([
			"SELECT id, name AS title FROM items WHERE kind = ? AND owner = ?",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the statement keeps its template part.
			"UPDATE items SET name = ? WHERE id IN (${ids})",
		]);
		expect(inventory.sql[0]).toMatchObject({
			params: 2,
			tables: ["items"],
			reads: ["id", "title"],
		});
		expect(inventory.sql[1]).toMatchObject({ params: 1, dynamic: true });
	});
});

describe("SQL helpers", () => {
	test("countParams ignores question marks inside quoted strings", () => {
		expect(countParams("SELECT * FROM t WHERE a = ? AND b = 'why?' AND c = $2")).toBe(2);
	});

	test("resultColumns reads a RETURNING clause and a SELECT without FROM", () => {
		expect(resultColumns("INSERT INTO t (a) VALUES (?) RETURNING id, a")).toEqual(["id", "a"]);
		expect(resultColumns("SELECT last_insert_rowid() AS id")).toEqual(["id"]);
	});
});
