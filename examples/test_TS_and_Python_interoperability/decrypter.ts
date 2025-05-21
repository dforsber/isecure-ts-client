// decrypter.ts
import crypto from "crypto";
import fs from "fs";

// Read the private key and encrypted data
const privateKey = fs.readFileSync("py_private_key.pem", "utf8").toString();
const encryptedData = fs.readFileSync("py_encrypted.txt", "utf8").toString();

function decryptData(encryptedBase64: string): string {
  // Decode from base64 and decrypt
  const encryptedBuffer = Buffer.from(encryptedBase64, "base64")
  const padding = crypto.constants.RSA_PKCS1_OAEP_PADDING;

  const decryptedData = crypto.privateDecrypt({ key: privateKey, padding }, encryptedBuffer);

  return decryptedData.toString("utf8");
}

try {
  const decrypted = decryptData(encryptedData);
  console.log("Successfully decrypted!");
  console.log("Decrypted data:", decrypted);

  // Verify the expected format
  const parts = decrypted.split("||");
  if (parts.length === 2 && parts[0] === "helloWorld") {
    console.log("Verification successful!");
    console.log(`Password: ${parts[0]}`);
    console.log(`Timestamp: ${parts[1]}`);
  } else {
    console.log("Verification failed - unexpected format");
  }
} catch (error) {
  console.error("Decryption failed:", error);
}
