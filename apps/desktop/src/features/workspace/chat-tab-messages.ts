/**
 * @feature CHAT-01 Chat tab messages
 * Owns: Conductor's words when closing or reopening chats fails, shared by the tab strip and the
 * chat history button.
 * Behaviour: renderApp @10110444 ("Failed to close chat. Try again."), @10074815 ("Failed to close
 * other chats. Try again."), main @3636992 ("Couldn't reopen chat. Try again.").
 * Test first: a chat that fails to close says Failed to close chat. Try again.
 */
export const CLOSE_CHAT_FAILED = "Failed to close chat. Try again.";
export const CLOSE_OTHERS_FAILED = "Failed to close other chats. Try again.";
export const REOPEN_CHAT_FAILED = "Couldn't reopen chat. Try again.";
