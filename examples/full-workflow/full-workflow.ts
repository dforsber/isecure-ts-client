import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseMode, WSChannel, type AuthPromptAdapter, type AuthState, type IWSChannel } from "../../src/index.js";

class TerminalPromptAdapter implements AuthPromptAdapter {
  async requestMfaCode(): Promise<string> {
    return ask("SMS MFA code: ");
  }

  async requestEmailCode(): Promise<string> {
    return ask("Email verification code: ");
  }

  async requestPhoneCode(): Promise<string> {
    return ask("Phone verification code: ");
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}

function configFromEnv(): IWSChannel {
  return {
    ApiKey: process.env.ISECURE_API_KEY ?? "0",
    Company: requiredEnv("ISECURE_COMPANY"),
    Name: requiredEnv("ISECURE_NAME"),
    Password: requiredEnv("ISECURE_PASSWORD"),
    Phone: requiredEnv("ISECURE_PHONE"),
    PublicKey: requiredEnv("ISECURE_PUBLIC_KEY_PEM"),
    BaseUrl: process.env.ISECURE_BASE_URL ?? "https://ws-api.test.isecure.fi/v2",
    Email: requiredEnv("ISECURE_EMAIL"),
    Mode: parseMode(process.env.ISECURE_MODE ?? "data"),
    Bank: process.env.ISECURE_BANK ?? "nordea",
  };
}

async function main(): Promise<void> {
  const client = new WSChannel(configFromEnv());
  const state: AuthState = await client.loginWithPrompt(new TerminalPromptAdapter());

  if (state.status === "stalled") {
    throw new Error(
      `Login stalled on ${state.step} after ${state.transitions} transitions; an accepted verification did not advance login.`,
    );
  }

  if (state.status === "failed") {
    throw new Error(`Login failed (${state.reason}): ${state.responseText}`);
  }

  if (state.status !== "authenticated") {
    throw new Error(`Login did not authenticate: ${state.status}`);
  }

  const files = await client.listFiles({ Status: "ALL" });
  console.log(JSON.stringify(files, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
