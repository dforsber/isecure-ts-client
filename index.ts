import { WSChannel } from "./src/isecure.class";
import * as fs from "fs";
import * as openpgp from "openpgp";

const BaseUrl = "https://ws-api.test.isecure.fi/v2";
const publicKey = fs.readFileSync("test.pem", "utf8").toString();

const publicKeyArmored = fs.readFileSync("./test-pgp-key.pub", "utf8").toString();
const privateKeyArmored = fs.readFileSync("./test-pgp-key.sec", "utf8").toString();

async function createAndVerifyPgpSignature() {
  // Create signature for a file and upload
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
  const message = await openpgp.createMessage({ text: fs.readFileSync("testfile.xml", "utf8").toString() });
  const detachedSignature = await openpgp.sign({
    message, // Message object
    signingKeys: privateKey,
    detached: true,
  });
  //console.log(detachedSignature);

  // Verify signature
  const signature = await openpgp.readSignature({
    armoredSignature: detachedSignature, // parse detached signature
  });
  const verificationResult = await openpgp.verify({
    message, // Message object
    signature,
    verificationKeys: publicKey,
  });
  try {
    const { verified, keyID } = verificationResult.signatures[0];
    console.log({ verified: await verified, keyID: keyID.toHex() });
  } catch (err) {
    console.error(err);
  }
  return detachedSignature;
}

async function main() {
  const ws = new WSChannel({
    ApiKey: "xgW39RewBGaIog6pvj54c8dRdGz5f4DU3qB9OwfZ", // "0"
    Company: "ISECure Oy TestTS",
    Name: "Dan Forsberg (test-ts)",
    Password: "C0wokr1HTVFy%Z5I17Xc2",
    Phone: "+358404835507",
    PublicKey: publicKey,
    BaseUrl,
    Email: "dforsber+test102@gmail.com",
    Mode: "admin",
    LogLevel: "debug",
    Bank: "nordea",
  });

  // admin role
  //await ws.register();
  //await ws.uploadPgpKey(publicKeyArmored, "authorize");
  //console.log("PGP uploaded..");

  // data role
  ws.updateProps({ Mode: "data" });
  //await ws.register();
  await ws.login(); // need to login again to get AccessToken
  console.log(`Logged in (${ws.props.Mode})`);

  // const detachedSignature = await createAndVerifyPgpSignature();
  // const contents = fs.readFileSync("testfile.xml", "utf8").toString();
  // await ws.uploadFile(Buffer.from(contents).toString("base64"), "testfile.xml", "DUMMY", detachedSignature);

  const resp = await ws.listFiles("VKEUR", "ALL");
  console.log(resp.data);
}

main();
