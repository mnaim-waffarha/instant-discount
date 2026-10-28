# Acquirer integration guide

This guide is for payment providers (acquirers) connecting their POS terminals to Waffarha
Instant Discount. The formal contract is the OpenAPI spec in [`api/acquirer-v1.yaml`](api/acquirer-v1.yaml).

## 1. What happens at the till

```
Cashier enters amount → customer taps/inserts card
        │
        ▼
Acquirer host ── POST /v1/discounts/inquire ──► Waffarha   (≤ 800 ms, else treat as "no discount")
        │◄─────── eligible + final_amount ───────┘
        ▼
Charge final_amount (or the full amount if not eligible)
        │
        ├─ approved  → POST /v1/discounts/{id}/confirm
        └─ declined  → POST /v1/discounts/{id}/cancel
Later: merchant refunds → POST /v1/discounts/{id}/refund
```

Show `display_message` / `display_message_ar` on the terminal or receipt when present
(for example "You saved 100 EGP with Demo Bank").

## 2. Onboarding checklist

1. Waffarha creates your acquirer account and sends you, through a secure channel:
   - an **API key id** (`acq_…`) and an **HMAC secret** (64 hex characters, shown once);
   - the **sandbox** and **production** base URLs;
   - the mTLS client-certificate requirements for production.
2. Send us your **egress IP addresses** (we allow-list them) and the **terminal list**
   (TID, merchant, branch) — or we import it from a CSV.
3. Build against the sandbox (section 6), then run the certification checklist (section 7).

## 3. Request signing

Every request carries three headers:

| Header        | Value                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `X-Api-Key`   | your key id                                                                                           |
| `X-Timestamp` | current unix time in seconds (must be within 5 minutes of ours)                                       |
| `X-Signature` | lowercase hex `HMAC-SHA256(secret, timestamp + "\n" + METHOD + "\n" + path + "\n" + sha256hex(body))` |

`path` is the request path including any query string, exactly as sent
(e.g. `/v1/discounts/inquire`). `body` is the exact bytes you send (sign after serialising).
For requests with no body, hash the empty string.

### Node.js

```js
import { createHash, createHmac } from 'node:crypto';

function sign(secret, method, path, body) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', secret)
    .update(`${ts}\n${method}\n${path}\n${bodyHash}`)
    .digest('hex');
  return { 'X-Timestamp': ts, 'X-Signature': signature };
}
```

### Bash (openssl)

```bash
BODY='{"terminal_id":"TID0001","bin":"412345","card_token":"tok_abc12345","scheme":"VISA","amount":50000,"currency":"EGP","acquirer_txn_ref":"T-1"}'
TS=$(date +%s)
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -hex | awk '{print $NF}')
SIG=$(printf '%s\n%s\n%s\n%s' "$TS" POST /v1/discounts/inquire "$BODY_HASH" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
curl -sS "$BASE_URL/v1/discounts/inquire" \
  -H 'Content-Type: application/json' -H "X-Api-Key: $KEY_ID" -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" -H 'Idempotency-Key: T-1' -d "$BODY"
```

## 4. Fields and rules

- **Amounts** are integers in minor units: 125.50 EGP = `12550`.
- **`bin`**: first 6–8 digits of the card. **`card_token`**: your stable token for the card
  (the same card must always get the same token — per-card limits depend on it).
  Never send the full card number; anything that looks like one is rejected.
- **`terminal_id`**: the TID as registered with us. Unknown TIDs get `UNKNOWN_TERMINAL`.
- **`Idempotency-Key`** (inquire): use your transaction reference. A retry with the same key
  returns the original answer; the same key with a different body is rejected (422).
- **Confirm** with `charged_amount` equal to `final_amount`. If you charged anything else,
  cancel instead.
- **Reservations expire** at `expires_at` (10 minutes). After that, confirm returns
  `409 RESERVATION_EXPIRED` and the discount is released — so always confirm promptly.
- **Refunds** are idempotent per `refund_id`; `amount` is what you return to the customer
  (out of `final_amount`). The discount is reversed in the same proportion.

## 5. Failure handling — fail open, always

| Situation                                                              | What the POS does                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Inquire times out (> 800 ms), network error, 5xx                       | Charge the full amount. Do not retry at the till.                               |
| `eligible: false` (any reason, including `UNAVAILABLE`, `KILL_SWITCH`) | Charge the full amount.                                                         |
| 401 (signature/clock)                                                  | Charge the full amount; alert your operations (check clock sync and secret).    |
| Confirm/cancel fails                                                   | Retry in the background with backoff for up to 10 minutes; they are idempotent. |
| You charged full price after a timeout                                 | Do nothing — the reservation expires by itself.                                 |

Errors always have the shape `{ "error": { "code": "…", "message": "…" } }`.

## 6. Sandbox

The sandbox runs the same code with demo data: acquirer key `acq_demo`, terminal `TID0001`
(merchant "Demo Cafe", Cairo) and a campaign giving **20% off up to 150 EGP for BIN `412345`**.
Any other BIN gets `NO_ELIGIBLE_CAMPAIGN`.

## 7. Certification checklist

Run each case and send us the acquirer transaction references:

1. Eligible card → inquire → charge `final_amount` → confirm → `CONFIRMED`.
2. Not-eligible BIN → `eligible: false` → full charge, no confirm.
3. Card declined after an eligible inquire → cancel → `RELEASED`.
4. Inquire retried with the same `Idempotency-Key` → identical `redemption_id`.
5. Inquire with the API unreachable (we disable your key for the test) → full charge within 800 ms.
6. Partial refund, then the remainder → `PARTIALLY_REFUNDED`, then `REFUNDED`.
7. Same `refund_id` sent twice → second call is a no-op.
8. Confirm after `expires_at` → `409 RESERVATION_EXPIRED` handled (no crash, no double charge).
9. Clock 10 minutes off → 401 handled as "no discount".
