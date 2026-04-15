import { OpenAIResponsesModelProvider } from "../runtime/ModelProvider.js";
import type { AuthSession } from "./AuthSession.js";
import { credentialOwnerForScope, type CredentialProvider, type CredentialScope, type CredentialStore, type ProviderCredential } from "./CredentialStore.js";

export interface CredentialResolution {
  provider: CredentialProvider;
  credential: ProviderCredential;
  resolutionScope: CredentialScope;
}

export class CredentialResolver {
  constructor(private readonly store: CredentialStore) {}

  async resolveOpenAI(session: AuthSession): Promise<CredentialResolution | undefined> {
    const order: CredentialScope[] = ["user", "project", "group", "platform"];
    for (const scope of order) {
      const ownerId = credentialOwnerForScope(scope, session.identity);
      if (!ownerId || ownerId.endsWith(":")) continue;
      const credential = await this.store.get("openai", scope, ownerId);
      if (credential) {
        return { provider: "openai", credential, resolutionScope: scope };
      }
    }
    return undefined;
  }

  async createOpenAIProvider(session: AuthSession, options: { model?: string } = {}): Promise<OpenAIResponsesModelProvider> {
    const resolution = await this.resolveOpenAI(session);
    if (!resolution) {
      throw new Error("No OpenAI credential is available for this user/project/group/platform session.");
    }
    return new OpenAIResponsesModelProvider({
      apiKey: resolution.credential.apiKey,
      organizationId: resolution.credential.organizationId,
      projectId: resolution.credential.projectId,
      model: options.model,
    });
  }
}
