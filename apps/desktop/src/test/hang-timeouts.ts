/**
 * @feature test support Hang-sized waits for Testing Library
 * Owns: Testing Library's wait timeout for its find and wait helpers, set for every desktop test.
 * Behaviour: docs/engineering.md, "Wait for the event, never a fixed time": a timeout catches a
 * hang, never slowness. Testing Library waits one second by default, so a test that would pass
 * failed on a loaded Mac or runner. Vitest's own limits are in vite.config.ts.
 * Must handle: a test that runs without a DOM (node environment) imports this harmlessly; the
 * setting is read only when a wait runs.
 * Test first: not applicable.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 30_000 });
