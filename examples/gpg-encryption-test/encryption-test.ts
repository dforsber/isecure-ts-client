import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get source directory path (from dist back to source, or directly from source)
const srcPath = __dirname.includes('/dist/') 
  ? path.join(__dirname.replace('/dist/', '/'), './test.pem')  // When running from dist
  : path.join(__dirname, './test.pem');  // When running from source

const publicKey = fs.readFileSync(srcPath, "utf8").toString();
const password = "helloWorld";
const challenge = "ezwXceQ63fV9oWTSJBAE2Zq1Cw5tBIJe+7+Rl8jrgbk=|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e";

function getEncrypted(challenge: string): string {
  const timestamp = parseInt(challenge?.split("|")[1]);
  const pw_pair = password + "||" + timestamp;
  const padding = crypto.constants.RSA_PKCS1_OAEP_PADDING;
  const key = publicKey;
  const encryptedData = crypto.publicEncrypt({ key, padding }, Buffer.from(pw_pair)).toString("base64");
  return encryptedData;
}

console.log(getEncrypted(challenge));