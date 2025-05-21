# ISECure JS/TS Client

This is a stateless client side SDK for interacting with ISECure banking file exchange REST API.

## Open API specification

The OpenAPI specification for the REST API service this client interacts with is in the [wsapi_v2.json](wsapi_v2.json) file.

> The master source for wsapi_v2.json is https://isecure.fi/wsapi_v2.json, but we store the copy here for easier reference.

Mandatory features

- User registration with email and phone number verification
- Certificate enrollment
- File listing, downloads, and uploads

Optional features

- Integrator API
- PGP key registration
- Document signing with PGP

## Registering User Example

Example for registering to ISECure SaaS Bank API service test environment.

```mermaid
sequenceDiagram
    participant Client
    participant Service
    Client->>Service: InitRegister
    Note right of Service: Creating nonce and timestamp
    Service->>Client: Challenge
    Client->>Service: Register
    Service->>Client: Registration successful
    Client->>Service: Login
    Service->>Client: Ok, verify email
    Client->>Service: Email code
    Service->>Client: Email verified
    Client->>Service: Login
    Service->>Client: Ok, verify phone
    Client->>Service: SMS code
    Service->>Client: Phone verified
```

## Login Example (Data User)

Example of login flow for a data user when both email and phone are already verified.

```mermaid
sequenceDiagram
    participant Client
    participant Service
    Client->>Service: InitLogin
    Note right of Service: Creating nonce and timestamp
    Service->>Client: Challenge
    Client->>Service: Login
    Note right of Service: User has verified email and phone
    Service->>Client: Login successful
```

## Login Example (Admin User with MFA)

Example of login flow for an admin user requiring MFA with SMS verification.

```mermaid
sequenceDiagram
    participant Client
    participant Service
    Client->>Service: InitLogin
    Note right of Service: Creating nonce and timestamp
    Service->>Client: Challenge
    Client->>Service: Login
    Note right of Service: Admin requires MFA
    Service->>Client: Login requires MFA, SMS code sent automatically
    Note left of Client: User receives SMS code

    Note over Client,Service: Optional path for requesting a new SMS code
    Client-->+Service: Request new SMS code
    Service-->>-Client: SMS code sent

    Client->>Service: Submit SMS code
    Service->>Client: Login successful
```
