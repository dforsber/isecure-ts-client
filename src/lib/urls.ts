import type { Mode } from "./api-types.js";

/** The mutable channel fields the WS API endpoints are derived from. */
export interface UrlParts {
  BaseUrl: string;
  Email: string;
  Mode: Mode;
  Bank: string;
  Phone: string;
}

/**
 * Pure builder for WS API endpoint URLs. All path segments are
 * percent-encoded. Construct it with a provider so it always reflects the
 * channel's current (mutable) props.
 */
export class UrlBuilder {
  constructor(private readonly parts: () => UrlParts) {}

  account(): string {
    return this.url("account", this.parts().Email, this.parts().Mode);
  }

  accountPhone(): string {
    return `${this.account()}/${encodeURIComponent(this.parts().Phone)}`;
  }

  session(): string {
    return this.url("session", this.parts().Email, this.parts().Mode);
  }

  mfacode(): string {
    return `${this.session()}/mfacode`;
  }

  verifytotp(): string {
    return `${this.session()}/verifytotp`;
  }

  password(): string {
    return this.url("account", this.parts().Email, this.parts().Mode, "password");
  }

  files(): string {
    return this.url("files", this.parts().Bank);
  }

  file(fileType: string, fileReference: string): string {
    return this.url("files", this.parts().Bank, fileType, fileReference);
  }

  certs(): string {
    return `${this.base()}/certs/`;
  }

  cert(): string {
    return this.url("certs", this.parts().Bank);
  }

  sharedCerts(extEmail: string): string {
    return this.url("certs", "shared", extEmail);
  }

  integratorAccounts(): string {
    return this.url("integrator", "accounts");
  }

  pgp(): string {
    return this.url("pgp");
  }

  private base(): string {
    return this.parts().BaseUrl.replace(/\/+$/, "");
  }

  private url(...segments: string[]): string {
    return `${this.base()}/${segments.map(encodeURIComponent).join("/")}`;
  }
}
