import * as fs from "fs";
import * as crypto from "crypto";
import fetch from "node-fetch";

const publicKey = fs.readFileSync("test.pem", "utf8").toString();
const isecure_test = "https://ws-api.test.isecure.fi/v2";
const email = "dforsber+testts@gmail.com";
const mode = "admin";
const getChUrl = new URL(isecure_test + `/account/${email}/${mode}`).toString();
const registerUrl = new URL(isecure_test + `/account/${email}/${mode}`).toString();

async function getChallenge(): Promise<string> {
  const chResp = await fetch(getChUrl, { method: "get" });
  const challenge = await chResp.json();
  console.log({ getChUrl, challenge });
  return challenge.Challenge;
}

async function main(): Promise<void> {
  const challenge = await getChallenge();
  const timestamp = parseInt(challenge.split("|")[1]);
  const password = "C0wokr1HTVFy%Z5I17Xc2";
  const pw_pair = password + "||" + timestamp;
  const encryptedData = crypto
    .publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      Buffer.from(pw_pair)
    )
    .toString("base64");

  const body = {
    ApiKey: "0",
    ChResp: challenge,
    Company: "ISECure Oy TestTS",
    Encrypted: encryptedData,
    Name: "Dan Forsberg (test-ts)",
    Phone: "+358404835507",
  };
  const res = await fetch(registerUrl, {
    method: "put",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  console.log({ challenge, timestamp, password, pw_pair, encryptedData, registerUrl, body, res });
}

main();
