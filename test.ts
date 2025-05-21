import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const publicKey = fs.readFileSync(path.join(__dirname, "./test/test.pem"), "utf8").toString();
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
