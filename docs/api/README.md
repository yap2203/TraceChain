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
| `AUTH_COOKIE_NAME`               | `tracechain_session`     | Session-cookie name                  |
| `AUTH_SESSION_TTL_SECONDS`       | `28800`                  | Session lifetime in seconds          |
| `SEPOLIA_RPC_URL`                | Placeholder URL          | did:ethr Sepolia resolver/provider   |
| `VERAMO_KMS_SECRET_KEY`          | Placeholder only         | 32-byte hex SecretBox encryption key |
| `TRACECHAIN_AUTHORITY_DID_ALIAS` | `tracechain-authority`   | Authority DID lookup alias           |
| `BOOTSTRAP_ADMIN_WALLET`         | Zero-address placeholder | Public Admin wallet address          |

`FRONTEND_URL`, `SIWE_DOMAIN`, and `SIWE_URI` must match the frontend origin used in the browser.

The SSI variables are optional for normal API startup and SIWE tests. They are validated only by `npm run ssi:bootstrap-admin`; the example KMS value and zero address intentionally fail that validation. Never provide or store the Admin wallet private key.

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

## Authentication boundary

SIWE proves control of a wallet address only. The SSI package now contains a server-side Company Role Credential verification service, but it is not exposed as an API endpoint and cannot authorize users until future on-chain status checks are implemented. The API does not return a stakeholder role or authorize business workflows. The frontend must not derive a role from its URL, wallet address, fixture data, or local storage.

## Storage and production limitations

Nonce and session storage is accessed through repository interfaces, but the current implementations are in memory. Data does not survive a process restart and cannot be shared by multiple API instances. Production deployment requires durable shared storage, appropriate rate limiting and operational monitoring, HTTPS, and the planned credential-verification service.
