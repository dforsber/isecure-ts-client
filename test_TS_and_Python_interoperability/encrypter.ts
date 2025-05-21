// encrypter.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Generate key pair
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

// Save keys to files
fs.writeFileSync("public_key.pem", publicKey);
fs.writeFileSync("private_key.pem", privateKey);

const password = "helloWorld";

function getEncrypted(challenge: string): string {
  const timestamp = challenge?.split("|")[1];
  const pw_pair = password + "||" + timestamp;
  const padding = crypto.constants.RSA_PKCS1_OAEP_PADDING;
  const encryptedData = crypto.publicEncrypt({ key: publicKey, padding }, Buffer.from(pw_pair)).toString("base64");
  return encryptedData;
}

const challenge = "ezwXceQ63fV9oWTSJBAE2Zq1Cw5tBIJe+7+Rl8jrgbk=|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";
const encrypted = getEncrypted(challenge);
console.log("Encrypted data:", encrypted);

// Save encrypted data to file for Python to read
fs.writeFileSync("encrypted.txt", encrypted);
