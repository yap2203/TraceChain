# TraceChain API

The Express API defaults to `http://localhost:3000`. It accepts credentialed browser requests only from the configured `FRONTEND_URL` origin. All authentication responses set `Cache-Control: no-store`, and authentication request bodies are limited to 10 KB.

## Environment

Copy `apps/api/.env.example` to `apps/api/.env`. Available values are:

| Variable                         | Default example          | Purpose                              |
| -------------------------------- | ------------------------ | ------------------------------------ |
| `PORT`                           | `3000`                   | HTTP port                            |
| `FRONTEND_URL`                   | `http://localhost:5173`  | Exact CORS origin                    |
| `NODE_ENV`                       | `development`            | Controls production cookie security  |
| `SIWE_DOMAIN`                    | `localhost:5173`         | Expected ERC-4361 domain             |
| `SIWE_URI`                       | `http://localhost:5173`  | Expected ERC-4361 URI                |
| `SIWE_CHAIN_ID`                  | `11155111`               | Expected Ethereum Sepolia chain ID   |
| `CHAIN_RPC_URL`                  | Placeholder URL          | Ledger used for authorization reads  |
| `STAKEHOLDER_REGISTRY_ADDRESS`   | Zero-address placeholder | Deployed stakeholder registry        |
| `AUTH_COOKIE_NAME`               | `tracechain_session`     | Session-cookie name                  |
| `AUTH_SESSION_TTL_SECONDS`       | `28800`                  | Session lifetime in seconds          |
| `SEPOLIA_RPC_URL`                | Placeholder URL          | did:ethr Sepolia resolver/provider   |
| `VERAMO_KMS_SECRET_KEY`          | Placeholder only         | 32-byte hex SecretBox encryption key |
| `TRACECHAIN_AUTHORITY_DID_ALIAS` | `tracechain-authority`   | Authority DID lookup alias           |
| `BOOTSTRAP_ADMIN_WALLET`         | Zero-address placeholder | Public Admin wallet address          |

`FRONTEND_URL`, `SIWE_DOMAIN`, and `SIWE_URI` must match the frontend origin used in the browser.

The SSI and blockchain variables are loaded lazily when credential verification needs them. They are not required by SIWE-only tests. Replace the example RPC and registry placeholders with values for the same chain as `SIWE_CHAIN_ID`. The example KMS value and zero addresses intentionally fail credential-verification or command validation. Never provide or store the Admin wallet private key.

## Endpoints

### `GET /api/health`

Returns API availability:

```json
{ "status": "ok", "service": "tracechain-api" }
```

### `POST /api/auth/nonce`

Accepts a valid Ethereum address:

```json
{ "address": "0x..." }
```

Returns a cryptographically random, address-bound nonce with a five-minute expiry:

```json
{ "nonce": "...", "expiresAt": "2026-10-29T08:05:00.000Z" }
```

### `POST /api/auth/verify`

Accepts a complete ERC-4361 message and wallet signature:

```json
{ "message": "...", "signature": "0x..." }
```

The API verifies the signature, recovered address, domain, URI, Sepolia chain ID, nonce, issue time, and expiration. A successful request consumes the nonce, creates a server-side session, sets an HttpOnly SameSite=Lax cookie, and returns:

```json
{
  "authenticated": true,
  "address": "0x...",
  "credentialVerified": false,
  "expiresAt": "...",
  "message": "Wallet verified. Company Role Credential verification is required."
}
```

### `GET /api/auth/session`

Returns the authenticated response above for a valid cookie, or:

```json
{ "authenticated": false }
```

### `POST /api/auth/logout`

Deletes the server-side session, clears the cookie, and returns `204 No Content`.

### `POST /api/ssi/company-role/verify`

Requires the HttpOnly SIWE session cookie and accepts a JSON credential only:

```json
{ "credential": { "...": "W3C Company Role Credential" } }
```

The request is limited to 256 KB and rejects extra fields such as a submitted wallet address. The wallet comes exclusively from the verified SIWE session. The service resolves the configured authority DID by alias and checks the JWT signature, trusted issuer, subject DID, wallet binding, shared role, issuance and expiration dates, and local status. It then checks the wallet, role, credential hash, stakeholder lifecycle, and effective credential status through the configured `StakeholderRegistry`.

A successful response contains safe metadata only: `verified`, `credentialId`, `role`, `expirationStatus`, `locallyVerified`, `onChainStatusChecked`, `authorizationReady`, `reasons`, and a safe session summary. It never returns the credential, JWT, credential hash, issuer DID, or subject DID. `authorizationReady` becomes true only when both cryptographic and blockchain checks succeed. An unavailable RPC or missing contract returns `BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE` with HTTP 503.

## Authentication boundary

SIWE proves control of a wallet address only. Workspace authorization requires both a cryptographically verified Company Role Credential and a matching active blockchain record. The frontend must not derive a role from its URL, wallet address, fixture data, or local storage.

### Blockchain gateway

- `GET /api/blockchain/applications` returns authoritative application records and requires an authorized System Admin session.
- `POST /api/blockchain/transactions/company-application` validates public company-application arguments and returns an unsigned transaction.
- `POST /api/blockchain/transactions/application-rejection` requires an authorized System Admin session and returns an unsigned rejection transaction.

Prepared transactions contain `chainId`, `to`, `data`, and `value`. The frontend verifies the chain ID and sends the transaction through MetaMask. The API never signs on behalf of a stakeholder, so Solidity still receives the user's wallet as `msg.sender`.

## Storage and production limitations

Nonce and session storage is accessed through repository interfaces, but the current implementations are in memory. Data does not survive a process restart and cannot be shared by multiple API instances. Production deployment requires durable shared storage, appropriate rate limiting and operational monitoring, HTTPS, and the planned credential-verification service.
