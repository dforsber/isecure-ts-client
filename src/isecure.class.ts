import * as crypto from "crypto";
import * as openpgp from "openpgp";
import axios from "axios";
import * as readline from "readline";
import * as bunyan from "bunyan";

export interface IWSChannel {
  Company: string;
  Name: string;
  Password: string;
  Email: string;
  Mode: "admin" | "data";
  Phone: string;
  PublicKey: string;
  BaseUrl: string;
  Bank: string;
  ApiKey?: string;
  LogLevel?: "error" | "warn" | "info" | "debug";
}

export class WSChannel {
  private pgpUrl = () => encodeURI(this.props.BaseUrl + "/pgp");
  private getChUrl = () => encodeURI(this.props.BaseUrl + `/account/${this.props.Email}/${this.props.Mode}`);
  private registerUrl = () => encodeURI(this.props.BaseUrl + `/account/${this.props.Email}/${this.props.Mode}`);
  private getloginChUrl = () => encodeURI(this.props.BaseUrl + `/session/${this.props.Email}/${this.props.Mode}`);
  private uploadFileUrl = () => encodeURI(this.props.BaseUrl + `/files/${this.props.Bank}`);
  private verifyPhoneUrl = () => encodeURI(this.registerUrl() + "/" + this.props.Phone);
  private loginUrl = () => this.getloginChUrl();
  private loginMFAUrl = () => this.loginUrl() + "/mfacode";
  private verifyEmailUrl = () => this.registerUrl();
  private AccessToken: string;
  private IdToken: string;
  private Session: string;
  private ApiKey: string;
  private headers = { "Content-Type": "application/json" };
  private logger = bunyan.createLogger({
    name: "WSChannel",
    level: this.getLogLevel(this.props?.LogLevel),
  });

  constructor(public props: IWSChannel) {}

  private getLogLevel(level: string): bunyan.LogLevel {
    if (!level) return bunyan.INFO;
    if (level.toLowerCase() == "info") return bunyan.INFO;
    if (level.toLowerCase() == "debug") return bunyan.DEBUG;
    if (level.toLowerCase() == "error") return bunyan.ERROR;
    if (level.toLowerCase() == "warn") return bunyan.WARN;
    return bunyan.INFO;
  }

  private async getRegChallenge(): Promise<string> {
    const resp = await axios.get(this.getChUrl(), { method: "get" });
    const challenge = resp.data.Challenge;
    this.logger.debug({ getChUrl: this.getChUrl(), challenge });
    return challenge;
  }

  private async getSessChallenge(): Promise<string> {
    const resp = await axios.get<any>(this.getloginChUrl(), { method: "get" });
    const challenge = resp.data.Challenge;
    this.logger.debug({ getSessChUrl: this.getloginChUrl(), challenge });
    return challenge;
  }

  private getHeaders(): any {
    let headers = {};
    if (this.IdToken) headers = { ...headers, Authorization: this.IdToken };
    if (this.ApiKey) headers = { ...headers, "x-api-key": this.ApiKey };
    headers = { headers: { ...this.headers, ...headers } };
    this.logger.debug(headers);
    return headers;
  }

  private getEncrypted(challenge: string): string {
    const timestamp = parseInt(challenge?.split("|")[1]);
    const password = this.props.Password;
    const pw_pair = password + "||" + timestamp;
    const padding = crypto.constants.RSA_PKCS1_OAEP_PADDING;
    const key = this.props.PublicKey;
    const encryptedData = crypto.publicEncrypt({ key, padding }, Buffer.from(pw_pair)).toString("base64");
    return encryptedData;
  }

  public updateProps(overrideProps: Partial<IWSChannel>): void {
    this.props = { ...this.props, ...overrideProps };
  }

  async register(): Promise<void> {
    const ChResp = await this.getRegChallenge();
    const Encrypted = this.getEncrypted(ChResp);
    const data = {
      ApiKey: this.props.ApiKey,
      ChResp,
      Company: this.props.Company,
      Encrypted,
      Name: this.props.Name,
      Phone: this.props.Phone,
    };
    const url = this.registerUrl();
    this.logger.debug({ url, body: data });
    const registerResp = await axios.put(url, JSON.stringify(data), this.getHeaders());
    this.logger.debug({ registerResp: registerResp.data });
  }

  private async getUserInput(question: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(question, (data: string) => {
        resolve(data);
        rl.close();
      });
    });
  }

  private async handleLoginResponse(loginResp: any): Promise<void> {
    this.logger.debug({ loginResp: loginResp.data });
    this.AccessToken = loginResp.data?.AccessToken ?? this.AccessToken;
    this.Session = loginResp.data?.Session ?? this.Session;
    this.IdToken = loginResp.data?.IdToken ?? this.IdToken;
    this.ApiKey = loginResp.data?.ApiKey ?? this.ApiKey;
    const respText = loginResp.data?.ResponseText;
    const respCode = loginResp.data?.ResponseCode;
    this.logger.debug({ respCode, respText });
    if (respCode == "00" && respText == "Give SMS code") {
      return this.loginMFA();
    }
    if (respCode == "00" && respText == "User authentication failed. Verify phone number with received SMS.") {
      return this.verifyPhone();
    }
    if (respCode == "00" && respText == "Login OK. Verify email address.") {
      return this.verifyEmail();
    }
    if (respCode == "00" && respText == "Phone confirmation successful.") {
      return this.login();
    }
    if (respCode == "00" && respText == "Email verification successful.") {
      return this.login();
    }
    if (
      respCode == "01" &&
      respText == "Login failed; LimitExceededException: Attempt limit exceeded, please try after some time."
    ) {
      throw new Error(respText);
    }
  }

  async login(): Promise<void> {
    const ChResp = await this.getSessChallenge();
    const Encrypted = this.getEncrypted(ChResp);
    const data = { ChResp, Encrypted };
    const loginResp = await axios.post<any>(this.loginUrl(), JSON.stringify(data), this.getHeaders());
    return this.handleLoginResponse(loginResp);
  }

  async loginMFA(): Promise<void> {
    const loginSmsCode = await this.getUserInput("Give the SMS login code please: ");
    const data = { Code: loginSmsCode, Session: this.Session };
    let loginResp;
    try {
      loginResp = await axios.put<any>(this.loginMFAUrl(), JSON.stringify(data), this.getHeaders());
    } catch (err) {
      this.logger.error({ err });
      loginResp = err?.data;
    } finally {
      return this.handleLoginResponse(loginResp);
    }
  }

  async verifyPhone(): Promise<void> {
    const smsVerificationCode = await this.getUserInput("Give the SMS verification code please: ");
    const data = { Code: smsVerificationCode };
    const verifyPhoneResp = await axios.post(this.verifyPhoneUrl(), JSON.stringify(data), this.getHeaders());
    this.logger.debug({ body: data, verifyPhoneResp: verifyPhoneResp.data });
    return this.handleLoginResponse(verifyPhoneResp);
  }

  async verifyEmail(): Promise<void> {
    if (!this.AccessToken) throw new Error("No AccessToken, pls call login to get AccessToken");
    const emailVerificationCode = await this.getUserInput("Give the email verification code please: ");
    const data = { AccessToken: this.AccessToken, Code: emailVerificationCode };
    const verifyEmailResp = await axios.post(this.verifyEmailUrl(), JSON.stringify(data), this.getHeaders());
    this.logger.debug({ body: data, res: verifyEmailResp.data });
    return this.handleLoginResponse(verifyEmailResp);
  }

  async uploadPgpKey(armoredKey: string, purpose: "authorize" | "export"): Promise<void> {
    const data = { PgpKey: armoredKey, PgpKeyPurpose: purpose };
    this.logger.debug(data);
    const uploadPgpKeyResp = await axios.put(this.pgpUrl(), JSON.stringify(data), this.getHeaders());
    this.logger.debug({ uploadPgpKeyResp: uploadPgpKeyResp.data });
    this.logger.debug(uploadPgpKeyResp);
  }

  async uploadFile(FileContents: string, FileName: string, FileType: string, Signature: string): Promise<void> {
    const data = { FileContents, FileName, FileType, Signature };
    this.logger.debug(data);
    const uploadFileResp = await axios.put(this.uploadFileUrl(), JSON.stringify(data), this.getHeaders());
    this.logger.debug({ uploadFileResp: uploadFileResp.data });
    this.logger.debug(uploadFileResp);
  }
}
