import type { DelegationEvent, FileEvent, Session } from './types';
import { isSessionWithinRetention, getSessionLastTouchedAt } from './sessionRetention';

export { SESSION_RETENTION_MS as RECENT_SESSION_WINDOW_MS } from './sessionRetention';

interface FleetVisibilityInput {
  sessions: Record<string, Session>;
  fileEvents: FileEvent[];
  delegations: Record<string, DelegationEvent>;
  selectedSessionId?: string | null;
  now?: number;
}

export function getVisibleSessionsForFleet(input: FleetVisibilityInput): Session[] {
  return Object.values(input.sessions)
    .filter(session => isSessionVisibleInFleet(session, input))
    .sort((left, right) => getSessionSortTime(right) - getSessionSortTime(left));
}

export function isSessionVisibleInFleet(
  session: Session,
  input: Omit<FleetVisibilityInput, 'sessions'>
): boolean {
  if (input.selectedSessionId === session.id) {
    return true;
  }

  if (session.status === 'active') {
    return true;
  }

  const now = input.now ?? Date.now();
  if (!isSessionWithinRetention(session, now)) {
    return false;
  }

  return hasRecordedWork(session.id, input.fileEvents, input.delegations);
}

function hasRecordedWork(
  sessionId: string,
  fileEvents: FileEvent[],
  delegations: Record<string, DelegationEvent>
): boolean {
  if (fileEvents.some(event => event.sessionId === sessionId)) {
    return true;
  }

  return Object.values(delegations).some(delegation => delegation.sessionId === sessionId);
}

function getSessionSortTime(session: Session): number {
  return getSessionLastTouchedAt(session);
}
