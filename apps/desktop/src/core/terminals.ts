/**
 * @feature RUN-07 Terminals: tabs, script runs and output
 * @feature CHAT-23 Terminal tabs
 * Owns: the open-terminal limit, which the terminal service and the scripts panel share.
 * Behaviour: services-map.md 5A.1.3 (the tab limit, doubled in tab-freak mode).
 */
export const terminalLimit = (tabFreakMode: boolean): number => (tabFreakMode ? 10 : 5);
