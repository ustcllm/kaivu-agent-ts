import { makeId } from "../shared/ids.js";

export interface AuthIdentity {
  userId: string;
  projectId?: string;
  groupId?: string;
  roles: string[];
}

export interface AuthSession {
  id: string;
  identity: AuthIdentity;
  createdAt: string;
  expiresAt?: string;
}

export function createAuthSession(identity: AuthIdentity, ttlMs?: number): AuthSession {
  const now = Date.now();
  return {
    id: makeId("auth-session"),
    identity,
    createdAt: new Date(now).toISOString(),
    expiresAt: ttlMs ? new Date(now + ttlMs).toISOString() : undefined,
  };
}

export function isSessionExpired(session: AuthSession, now = new Date()): boolean {
  return Boolean(session.expiresAt && new Date(session.expiresAt).getTime() <= now.getTime());
}
