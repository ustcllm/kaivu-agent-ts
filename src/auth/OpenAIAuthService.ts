import { createAuthSession, type AuthIdentity, type AuthSession } from "./AuthSession.js";
import { credentialOwnerForScope, type CredentialDescriptor, type CredentialScope, type CredentialStore } from "./CredentialStore.js";

export interface OpenAIApiKeyLoginInput {
  identity: AuthIdentity;
  apiKey: string;
  scope?: CredentialScope;
  organizationId?: string;
  projectId?: string;
  ttlMs?: number;
}

export interface OpenAIApiKeyLoginResult {
  session: AuthSession;
  credential: CredentialDescriptor;
}

export class OpenAIAuthService {
  constructor(private readonly store: CredentialStore) {}

  async loginWithApiKey(input: OpenAIApiKeyLoginInput): Promise<OpenAIApiKeyLoginResult> {
    const session = createAuthSession(input.identity, input.ttlMs);
    const scope = input.scope ?? "user";
    const credential = await this.store.save({
      provider: "openai",
      scope,
      ownerId: credentialOwnerForScope(scope, input.identity),
      apiKey: input.apiKey,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    return { session, credential };
  }
}
