/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the Mac's pairing state for screens: the saved Worker and token (never the token
 * itself), checking a URL and token with that Worker, and removing the pairing. CLOUD-19: what
 * the paired Worker holds (its readiness), for the new-workspace page's cloud mode.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 and the CLOUD-02 spike's question 4
 * (docs/research/cloud-spike-2026-11-06.md): the token is made at deploy time, kept in the
 * Keychain, and the app only knows whether it is paired and with which Worker.
 * Must handle: a startup read of the Keychain, which needs no network; input the Worker could
 * never accept, refused with the pairing module's own message and no call; a Worker that refuses
 * the token, whose message is shown and whose old pairing is kept; a failed removal, whose
 * message is shown and whose state does not claim the pairing is gone.
 * Our design choice: the service keeps the pairing in its store so the Connections page and any
 * later cloud setting read one answer. D106 records the pairing. The token goes only to Rust.
 * CLOUD-19 must handle: a readiness check for a Worker that is no longer the paired one, or one
 * that an older check answers after a newer one began, changes nothing (only the newest answer
 * is kept).
 * Test first: a plain-http URL leaves the saved pairing alone.
 */
import { type AppError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, CloudPairing } from "../../platform/platform.ts";
import type { Loadable } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { checkPairingInput, type PairingInput } from "../cloud/pairing.ts";
import { readCloudReadiness } from "../cloud/readiness.ts";
import type { CloudReadiness } from "../organization.ts";

/** The last readiness answer, for the Worker it came from. */
export interface CloudReadinessState {
	url: string | null;
	readiness: Loadable<CloudReadiness>;
}

export type CloudPairingState =
	| { state: "unknown" }
	| { state: "ready"; pairing: CloudPairing }
	| { state: "error"; error: AppError };

export interface CloudPairingService {
	readonly store: StoreApi<CloudPairingState>;
	/** Reads the saved pairing from the Keychain. */
	start(): Promise<Result<void>>;
	/** Checks the token with the Worker, then keeps both. */
	pair(input: PairingInput): Promise<Result<CloudPairing>>;
	/** Removes the saved pairing. */
	unpair(): Promise<Result<void>>;
	/** What the paired Worker holds; `refreshReadiness` fills it (CLOUD-19). */
	readonly readinessStore: StoreApi<CloudReadinessState>;
	/** Asks the Worker at `url` which secrets it holds, and keeps the newest answer. */
	refreshReadiness(url: string): Promise<void>;
}

/** The pairing service over the shell's cloud door. */
export function createCloudPairing(cloud: Cloud): CloudPairingService {
	const store = createStore<CloudPairingState>(() => ({ state: "unknown" }));
	const keep = (result: Result<CloudPairing>): Result<CloudPairing> => {
		store.setState(
			result.ok
				? { state: "ready", pairing: result.value }
				: { state: "error", error: result.error },
		);
		return result;
	};

	const readinessStore = createStore<CloudReadinessState>(() => ({
		url: null,
		readiness: { state: "loading" },
	}));
	const readinessRequests = createLatestWins<"readiness">();

	return {
		store,
		readinessStore,
		refreshReadiness: async (url) => {
			const ticket = readinessRequests.begin("readiness");
			readinessStore.setState({ url, readiness: { state: "loading" } });
			const answer = await readCloudReadiness(cloud, url);
			if (!readinessRequests.isLatest(ticket)) return;
			readinessRequests.settle(ticket);
			readinessStore.setState({
				url,
				readiness: answer.ok
					? { state: "ready", data: answer.value }
					: { state: "error", error: answer.error },
			});
		},
		start: async () => {
			const result = await cloud.status();
			if (!result.ok) {
				store.setState({ state: "error", error: result.error });
				return err(result.error);
			}
			store.setState({ state: "ready", pairing: result.value });
			return ok(undefined);
		},
		pair: async (input) => {
			const checked = checkPairingInput(input);
			if (!checked.ok) return checked;
			return keep(await cloud.pair(checked.value));
		},
		unpair: async () => {
			const result = await cloud.unpair();
			if (!result.ok) {
				store.setState({ state: "error", error: result.error });
				return result;
			}
			store.setState({ state: "ready", pairing: { paired: false, url: null } });
			return ok(undefined);
		},
	};
}
