import type { AuthIdentity } from "./AuthSession.js";

export type CredentialProvider = "openai";
export type CredentialScope = "user" | "project" | "group" | "platform";

export interface ProviderCredential {
  provider: CredentialProvider;
  scope: CredentialScope;
  ownerId: string;
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialDescriptor {
  provider: CredentialProvider;
  scope: CredentialScope;
  ownerId: string;
  maskedApiKey: string;
  organizationId?: string;
  projectId?: string;
  updatedAt: string;
}

export interface CredentialStore {
  save(credential: Omit<ProviderCredential, "createdAt" | "updatedAt">): Promise<CredentialDescriptor>;
  get(provider: CredentialProvider, scope: CredentialScope, ownerId: string): Promise<ProviderCredential | undefined>;
  describe(identity: AuthIdentity): Promise<CredentialDescriptor[]>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, ProviderCredential>();

  async save(credential: Omit<ProviderCredential, "createdAt" | "updatedAt">): Promise<CredentialDescriptor> {
    const now = new Date().toISOString();
    const key = credentialKey(credential.provider, credential.scope, credential.ownerId);
    const existing = this.credentials.get(key);
    const stored: ProviderCredential = {
      ...credential,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.credentials.set(key, stored);
    return describeCredential(stored);
  }

  async get(provider: CredentialProvider, scope: CredentialScope, ownerId: string): Promise<ProviderCredential | undefined> {
    return this.credentials.get(credentialKey(provider, scope, ownerId));
  }

  async describe(identity: AuthIdentity): Promise<CredentialDescriptor[]> {
    const ownerIds = new Set([
      identity.userId,
      identity.projectId ? `project:${identity.projectId}` : "",
      identity.groupId ? `group:${identity.groupId}` : "",
      "platform",
    ]);
    return [...this.credentials.values()]
      .filter((credential) => ownerIds.has(credential.ownerId))
      .map(describeCredential);
  }
}

export function credentialOwnerForScope(scope: CredentialScope, identity: AuthIdentity): string {
  if (scope === "user") return identity.userId;
  if (scope === "project") return `project:${identity.projectId ?? ""}`;
  if (scope === "group") return `group:${identity.groupId ?? ""}`;
  return "platform";
}

function credentialKey(provider: CredentialProvider, scope: CredentialScope, ownerId: string): string {
  return `${provider}:${scope}:${ownerId}`;
}

function describeCredential(credential: ProviderCredential): CredentialDescriptor {
  return {
    provider: credential.provider,
    scope: credential.scope,
    ownerId: credential.ownerId,
    maskedApiKey: maskApiKey(credential.apiKey),
    organizationId: credential.organizationId,
    projectId: credential.projectId,
    updatedAt: credential.updatedAt,
  };
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return "***";
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}
