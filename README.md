# ISECure JS/TS Client

Example for registering to ISECure SaaS Bank API service test environment.

```mermaid
sequenceDiagram
    participant Client
    participant Service
    Client->>Service: InitRegister
    Note right of Service: Creating nonce and timestamp
    Service->>Client: Challenge
    Client->>Service: Register
    Service->>Client: Ok, verify email
    Client->>Service: Email code
    Service->>Client: Ok, verify phone
    Client->>Service: SMS code
```
