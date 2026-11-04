/**
 * @feature DATA-01 React context that carries the container
 * Owns: one provider that makes the container available to hooks, and one hook that reads it.
 * Behaviour: services-map.md 1.1 (the container is built once at startup and handed to the
 * screens), api.ts (hooks read services through this context).
 * Must handle: a hook used outside the provider is a programming error and throws a clear
 * message at once, instead of returning empty data; the provider never rebuilds the container
 * (it is created once by the app shell and passed in).
 * Our design choice: a plain React context. Tests of screens can wrap them in a provider with a
 * container built from the in-memory Platform.
 * Test first: useServices outside a provider throws an error that names ServicesProvider.
 */
import { createContext, type ReactNode, useContext } from "react";
import type { Container } from "./container.ts";

const ServicesContext = createContext<Container | null>(null);

export function ServicesProvider(props: { container: Container; children: ReactNode }) {
	return (
		<ServicesContext.Provider value={props.container}>{props.children}</ServicesContext.Provider>
	);
}

export function useServices(): Container {
	const container = useContext(ServicesContext);
	if (container === null) {
		throw new Error("useServices was called outside ServicesProvider. Wrap the app in it.");
	}
	return container;
}
