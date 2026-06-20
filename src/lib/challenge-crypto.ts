const RSA_OAEP_PARAMS = { name: "RSA-OAEP" } as const;
const RSA_OAEP_IMPORT_PARAMS = { name: "RSA-OAEP", hash: "SHA-1" } as const;

export async function encryptPasswordChallenge(
  publicKeyPem: string,
  challenge: string,
  password: string,
): Promise<string> {
  const timestamp = challenge.split("|")[1];
  if (!timestamp) {
    throw new Error("ISECure challenge did not contain a timestamp");
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto is not available in this runtime");
  }

  const publicKey = await subtle.importKey(
    "spki",
    arrayBufferFromBytes(publicKeyDerFromPem(publicKeyPem)),
    RSA_OAEP_IMPORT_PARAMS,
    false,
    ["encrypt"],
  );
  const encrypted = await subtle.encrypt(
    RSA_OAEP_PARAMS,
    publicKey,
    new TextEncoder().encode(`${password}||${timestamp}`),
  );

  return bytesToBase64(new Uint8Array(encrypted));
}

function publicKeyDerFromPem(publicKeyPem: string): Uint8Array {
  const label = pemLabel(publicKeyPem);
  const keyDer = base64ToBytes(publicKeyPem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, ""));

  if (label === "PUBLIC KEY") {
    return keyDer;
  }

  if (label === "RSA PUBLIC KEY") {
    return wrapPkcs1PublicKeyAsSpki(keyDer);
  }

  throw new Error(`Unsupported public key PEM label: ${label}`);
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function pemLabel(publicKeyPem: string): string {
  const match = /-----BEGIN ([^-]+)-----/.exec(publicKeyPem);
  if (!match?.[1]) {
    throw new Error("Public key must be PEM encoded");
  }
  return match[1];
}

function wrapPkcs1PublicKeyAsSpki(pkcs1Der: Uint8Array): Uint8Array {
  const rsaEncryptionAlgorithm = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const bitString = derSequence(new Uint8Array([0x00, ...pkcs1Der]), 0x03);
  return derSequence(concatBytes(rsaEncryptionAlgorithm, bitString), 0x30);
}

function derSequence(value: Uint8Array, tag: number): Uint8Array {
  return concatBytes(new Uint8Array([tag]), derLength(value.byteLength), value);
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((total, array) => total + array.byteLength, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.byteLength;
  }
  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(base64) : decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return globalThis.btoa ? globalThis.btoa(binary) : encodeBase64(binary);
}

function decodeBase64(base64: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const character of base64.replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) {
      throw new Error("Invalid base64 value in public key");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

function encodeBase64(binary: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < binary.length; index += 3) {
    const byte1 = binary.charCodeAt(index);
    const byte2 = index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
    const byte3 = index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
    const triplet = (byte1 << 16) | (byte2 << 8) | byte3;

    output += alphabet[(triplet >> 18) & 0x3f];
    output += alphabet[(triplet >> 12) & 0x3f];
    output += index + 1 < binary.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < binary.length ? alphabet[triplet & 0x3f] : "=";
  }

  return output;
}
