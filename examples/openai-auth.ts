import "dotenv/config";
import {
  CredentialResolver,
  InMemoryCredentialStore,
  OpenAIAuthService,
} from "../src/index.js";

declare const process: { env: Record<string, string | undefined> };

const store = new InMemoryCredentialStore();
const auth = new OpenAIAuthService(store);
const login = await auth.loginWithApiKey({
  identity: {
    userId: "local_user",
    projectId: "demo_project",
    groupId: "demo_group",
    roles: ["researcher"],
  },
  apiKey: process.env.OPENAI_API_KEY ?? "sk-demo-placeholder",
  scope: "user",
});

const resolver = new CredentialResolver(store);
const provider = await resolver.createOpenAIProvider(login.session, {
  model: process.env.KAIVU_MODEL ?? "gpt-5-mini",
});

console.log(
  JSON.stringify(
    {
      sessionId: login.session.id,
      credential: login.credential,
      providerReady: Boolean(provider),
    },
    null,
    2,
  ),
);
