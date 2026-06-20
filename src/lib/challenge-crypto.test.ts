import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptPasswordChallenge } from "./challenge-crypto.js";

const challenge = "challenge-bytes|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";
const password = "Example-password-123!";

describe("challenge encryption", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encrypts password challenges with SPKI public keys using browser-compatible WebCrypto", async () => {
    const keyPair = generateRsaKeyPair();
    const encrypted = await encryptPasswordChallenge(keyPair.spkiPublicKey, challenge, password);

    expect(decrypt(keyPair.privateKey, encrypted)).toBe("Example-password-123!||1475429754114");
  });

  it("wraps PKCS#1 public keys so they can be imported by WebCrypto", async () => {
    const keyPair = generateRsaKeyPair();
    const encrypted = await encryptPasswordChallenge(keyPair.pkcs1PublicKey, challenge, password);

    expect(decrypt(keyPair.privateKey, encrypted)).toBe("Example-password-123!||1475429754114");
  });

  it("encrypts when atob and btoa are unavailable", async () => {
    vi.stubGlobal("atob", undefined);
    vi.stubGlobal("btoa", undefined);
    const keyPair = generateRsaKeyPair();
    const encrypted = await encryptPasswordChallenge(keyPair.spkiPublicKey, challenge, password);

    expect(decrypt(keyPair.privateKey, encrypted)).toBe("Example-password-123!||1475429754114");
  });

  it("rejects malformed challenge and key inputs", async () => {
    const keyPair = generateRsaKeyPair();

    await expect(encryptPasswordChallenge(keyPair.spkiPublicKey, "missing-timestamp", password)).rejects.toThrow(
      "ISECure challenge did not contain a timestamp",
    );
    await expect(encryptPasswordChallenge("not pem", challenge, password)).rejects.toThrow(
      "Public key must be PEM encoded",
    );
    await expect(
      encryptPasswordChallenge("-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----", challenge, password),
    ).rejects.toThrow("Unsupported public key PEM label: CERTIFICATE");

    vi.stubGlobal("atob", undefined);
    await expect(
      encryptPasswordChallenge("-----BEGIN PUBLIC KEY-----\n@@@\n-----END PUBLIC KEY-----", challenge, password),
    ).rejects.toThrow("Invalid base64 value in public key");
  });

  it("rejects runtimes without WebCrypto", async () => {
    const keyPair = generateRsaKeyPair();

    vi.stubGlobal("crypto", {});

    await expect(encryptPasswordChallenge(keyPair.spkiPublicKey, challenge, password)).rejects.toThrow(
      "WebCrypto is not available in this runtime",
    );
  });
});

function generateRsaKeyPair(): { privateKey: string; pkcs1PublicKey: string; spkiPublicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    pkcs1PublicKey: publicKey.export({ format: "pem", type: "pkcs1" }).toString(),
    spkiPublicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function decrypt(privateKey: string, encrypted: string): string {
  return privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha1",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(encrypted, "base64"),
  ).toString("utf8");
}
