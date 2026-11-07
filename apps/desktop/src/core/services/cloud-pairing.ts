/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Owns: the Mac's pairing state for screens: the saved Worker and token (never the token
 * itself), checking a URL and token with that Worker, and removing the pairing.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 and the CLOUD-02 spike's question 4
 * (docs/research/cloud-spike-2026-11-06.md): the token is made at deploy time, kept in the
 * Keychain, and the app only knows whether it is paired and with which Worker.
 * Must handle: a startup read of the Keychain, which needs no network; input the Worker could
 * never accept, refused with the pairing module's own message and no call; a Worker that refuses
 * the token, whose message is shown and whose old pairing is kept; a failed removal, whose
 * message is shown and whose state does not claim the pairing is gone.
 * Our design choice: the service keeps the pairing in its store so the Connections page and any
 * later cloud setting read one answer. D104 records the pairing. The token goes only to Rust.
 * Test first: a plain-http URL leaves the saved pairing alone.
 */
import { type AppError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, CloudPairing } from "../../platform/platform.ts";
import { checkPairingInput, type PairingInput } from "../cloud/pairing.ts";

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

	return {
		store,
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
