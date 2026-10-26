# API Documentation

The API defaults to `http://localhost:3000`. Browser requests are accepted with credentials only from the configured `FRONTEND_URL` origin.

## Wallet authentication

Authentication follows Sign-In with Ethereum (ERC-4361). It proves control of a wallet address only and does not verify credentials, assign roles, or authorise stakeholder routes.

### `POST /api/auth/nonce`

Accepts a valid Ethereum address:

```json
{ "address": "0x..." }
```

Returns a cryptographically random address-bound nonce and its five-minute expiry:

```json
{ "nonce": "...", "expiresAt": "2026-10-26T08:05:00.000Z" }
```

### `POST /api/auth/verify`

Accepts a complete ERC-4361 message and its wallet signature:

```json
{ "message": "...", "signature": "0x..." }
```

The server validates the signature, domain, URI, address, Sepolia chain ID, nonce, issue time, and expiration before consuming the nonce and creating a session. Success sets an HttpOnly, SameSite=Lax cookie and returns:

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

Restores the session represented by the HttpOnly cookie. It returns the authenticated response above or:

```json
{ "authenticated": false }
```

### `POST /api/auth/logout`

Deletes the server-side session, clears the session cookie, and returns `204 No Content`.

## Storage limitation

Nonce and session repositories are defined through interfaces so durable implementations can replace them later. The current in-memory repositories are strictly development-only. They do not persist across API restarts and do not support multiple API processes.

## Security notes

- Authentication request bodies are limited to 10 KB.
- Nonces are single-use and expire after five minutes.
- Sessions are bound to the address recovered from the verified signature.
- Session cookies use `Secure` in production.
- Private keys, recovery phrases, credentials, and passwords are never requested or stored.
