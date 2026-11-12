# Resend DNS change plan

Domain: `auth.filmforus.space` · DNS host: Vercel · Sending region: Tokyo (`ap-northeast-1`).

Resend domain ID: `4d373e0c-2997-42ff-8e41-4ed61c086386`. Sending enabled, receiving disabled. Sender: `Film For Us <no-reply@auth.filmforus.space>`. No paid services activated.

Add these records under the existing `filmforus.space` zone. All are new records; existing website ALIAS/CAA records stay untouched. TTL: 300 seconds.

| Type | Name in Vercel | Value | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.auth` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCiU5UlIah8iRNWGaL2w7VCq10HtErnWPD2dBgqnkUF10mM5Ey5MmcLeLzAI0LzCTvD3n3PrJeHZr980D/GacQGv/1BcIrEaxRctY3ZVn25oaVp5eNihE+IOx/IGv/Df/5GnOstQsuG/F229qRZA8wKdExQWE7s41msrhqD1UAStwIDAQAB` | — |
| MX | `send.auth` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
| TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.auth` | `send.forge.rmta.net` | — |
| TXT | `_dmarc.auth` | `v=DMARC1; p=none;` | — |

The DKIM value is a public verification key, not an API secret. DMARC starts at `p=none` until real delivery is verified. No aggregate-report address is invented. Open/click tracking is disabled for authentication messages.

DNS changes require one user approval under the [requested Resend setup guide](https://resend.com/setup.md). Domain registration in Resend and this plan do not themselves change DNS.

## Applied result — 12 November 2026

The user approved all five records and they were added through Vercel DNS. Public DNS readback matched the plan, and Resend reports the domain and all four provider records verified. Existing website records were preserved.

A sending-only key named `Film For Us Supabase SMTP` is restricted to this domain and stored in macOS Keychain under Resend CLI profile `film-for-us-smtp`; no secret appears in this document. A real TLS SMTP test on port 465 was delivered to the user-approved mailbox. Two submissions with one idempotency key returned the same email ID and produced one email. Open/click tracking remains disabled.

The user entered and saved Supabase SMTP settings. Both signup/login templates now send numeric codes, the existing eight-digit default was preserved, and expiry was set to 600 seconds. A real Supabase OTP email was confirmed delivered to the user-approved Gmail mailbox; the body contains eight numeric digits, no login link and no unresolved template variables. The test code was not consumed and no login session or album ownership was assigned. No production application deployment or album migration was performed. Official Resend MCP access and the Resend, Resend CLI and email-best-practices skills are installed.
