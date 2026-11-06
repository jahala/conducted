/**
 * @feature NAV-15 Surface registry in screen tests
 * Owns: the surface registry and surface layer the app shell gives every route, for a test that renders
 * a screen without the shell, so a terminal slot in it registers and is drawn as in the app.
 * Behaviour: not applicable, test support only (app/AppShell.tsx mounts the same pair).
 * Must handle: one registry per render, so tests never share surfaces; the caller wraps it in a
 * ServicesProvider, because the layer reads the workspace and terminal stores.
 * Test first: covered by the scripts panel and Run tab tests, which render through it.
 */
import { type ReactNode, useState } from "react";
import {
	createSurfaceRegistry,
	SurfaceHost,
	SurfaceRegistryProvider,
} from "../app/surface-registry.tsx";

export function WithSurfaces({ children }: { children: ReactNode }) {
	const [registry] = useState(createSurfaceRegistry);
	return (
		<SurfaceRegistryProvider registry={registry}>
			{children}
			<SurfaceHost registry={registry} />
		</SurfaceRegistryProvider>
	);
}
