import type { PersistedState, Session } from './types';

export const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function getSessionLastTouchedAt(session: Session): number {
  return session.lastActivityAt ?? session.completedAt ?? session.startedAt;
}

export function isSessionWithinRetention(session: Session, now: number = Date.now()): boolean {
  const lastTouchedAt = getSessionLastTouchedAt(session);
  return lastTouchedAt > 0 && now - lastTouchedAt <= SESSION_RETENTION_MS;
}

export function prunePersistedState(
  state: PersistedState,
  now: number = Date.now()
): PersistedState {
  const sessions = Object.fromEntries(
    Object.entries(state.sessions).filter(([, session]) => isSessionWithinRetention(session, now))
  );
  const validSessionIds = new Set(Object.keys(sessions));

  const agents = Object.fromEntries(
    Object.entries(state.agents).filter(([, agent]) => validSessionIds.has(agent.sessionId))
  );

  const delegations = Object.fromEntries(
    Object.entries(state.delegations).filter(([, delegation]) => validSessionIds.has(delegation.sessionId))
  );

  const fileEvents = state.fileEvents.filter(event => validSessionIds.has(event.sessionId));

  return {
    sessions,
    agents,
    delegations,
    fileEvents
  };
}
