/**
 * Session lifecycle management.
 * Handles starting, completing, and archiving collection sessions.
 */

import * as store from './data-store.js';

/**
 * Ensure a session exists for the given username and list type.
 * Creates one if needed, or returns the existing one if it matches.
 */
export async function ensureSession(username, type) {
  const current = await store.getSession();

  // If there's an active session for the same user and type, keep it
  if (current && current.username === username && current.type === type) {
    return current;
  }

  // If there's a different active session, archive it first
  if (current) {
    await completeSession();
  }

  return store.createSession(username, type);
}

/**
 * Complete and archive the current session.
 */
export async function completeSession() {
  const session = await store.getSession();
  if (!session) return null;

  const meta = {
    id: session.id,
    username: session.username,
    type: session.type,
    count: session.users.length,
    startedAt: session.startedAt,
    completedAt: new Date().toISOString(),
  };

  await store.addToHistory(meta);

  // Save the full list
  const key = `${session.username}_${session.type}_${session.id}`;
  await store.saveList(key, session.users, meta);

  await store.clearSession();
  return meta;
}

/**
 * Get session status summary for UI.
 */
export async function getStatus() {
  const session = await store.getSession();
  if (!session) {
    return { active: false, count: 0 };
  }
  return {
    active: true,
    username: session.username,
    type: session.type,
    count: session.users.length,
    startedAt: session.startedAt,
    lastUpdatedAt: session.lastUpdatedAt,
  };
}
