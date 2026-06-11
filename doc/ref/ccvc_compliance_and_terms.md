# CCVC: Terms-of-Service Compliance Notes

Source material for the `README` and `CLAUDE.md`. Purpose: keep "Claude Code via Cursor" (CCVC) on the correct side of Anthropic's and Anysphere's terms, and make that posture explicit to users. This is a working compliance note, not legal advice.

---

## TL;DR

CCVC is a **thin launcher**. It spawns and surfaces a `claude` process that the user has already installed and authenticated **outside** the extension. CCVC never handles credentials and never acts as an authentication or request intermediary. That is what keeps it compliant. The rules below exist so we do not drift out of that posture as features get added.

---

## The rule that governs this

Anthropic's Claude Code legal page draws the deciding line. Paraphrased:

- OAuth (subscription) authentication is intended for individual purchasers of Free, Pro, Max, Team, and Enterprise plans, to support **ordinary, individual use** of Claude Code and other native Anthropic applications.
- Developers building products or services that interact with Claude's capabilities (including the Agent SDK) are expected to use **API-key** authentication.
- Anthropic does not permit third-party developers to offer Claude.ai login, or to route requests through Free/Pro/Max plan credentials on behalf of their users. Anthropic states it may enforce this without prior notice.

Two related points from the same docs:
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage." Automated, batchy, or always-on patterns are not ordinary individual use.
- As of June 15, 2026, Agent SDK and `claude -p` (headless) usage on subscription plans draws from a separate metered credit pool, distinct from interactive usage.

Source: https://code.claude.com/docs/en/legal-and-compliance

The Cursor side is not a concern: Anysphere's terms explicitly contemplate user-installed third-party extensions, and the base editor is free. A user choosing CCVC instead of Cursor's own AI features is not bypassing anything they owed Anysphere.

Source: https://cursor.com/terms-of-service

---

## Why CCVC is compliant

CCVC stays clear of the prohibited zone because of a single design decision: **authentication is entirely the user's responsibility and happens outside the extension.**

- The user is assumed to have an Anthropic account, `claude` installed, and to have authenticated by their own means (their own subscription OAuth login or their own API key).
- CCVC spawns the local `claude` process the same way the user would in their own terminal.
- CCVC does not present a login, does not capture or store tokens, and does not forward credentials anywhere.
- The interaction model is interactive and human-in-the-loop: the user drives each turn through a chat surface.

That makes each session a person using a native Anthropic application on their own machine, which is exactly the use that subscription OAuth is meant for.

---

## Hard invariants (do not cross)

These are non-negotiable constraints on the codebase. Any change that would violate one of these must be stopped and surfaced to a human before proceeding.

1. **Never implement authentication inside the extension.** No login UI, no OAuth flow, no API-key entry that the extension owns or persists on the user's behalf.
2. **Never capture, store, log, cache, or forward credentials.** This includes OAuth tokens, refresh tokens, API keys, and anything emitted by an auth flow. Credentials live only in the user's own `claude` installation.
3. **Never route Claude requests through the extension acting as an intermediary** using the user's subscription credentials. CCVC launches `claude`; it does not proxy or relay model requests on the user's behalf.
4. **The respawn / restart control only restarts the child process.** It must not invoke `claude login`, must not render or embed a login surface, and must not handle any credential material. On an auth error, the correct behavior is to tell the user their session needs attention and let them re-authenticate through their own `claude`, outside CCVC.
5. **Keep the model interactive and human-in-the-loop.** Do not add headless `claude -p` automation, background agent loops, scheduled or batch fan-out, or any flow that issues Claude work without a per-turn user action. Those patterns push out of "ordinary individual usage" and toward the API-key / Agent SDK path that subscription auth is not meant to power.
6. **Do not market or describe CCVC as a way to "skip the API bill" or get "Claude for free."** The underlying use is legitimate; the framing is what invites scrutiny. Describe CCVC as a UI that runs the user's own local Claude Code inside Cursor.

If a feature request touches authentication, credential handling, request routing, or automation, treat it as a stop-and-ask item rather than implementing it directly.

---

## Drop-in: README section

> Suggested copy. Adjust wording to taste, but keep the explicit "does not" statements intact.

```markdown
## Authentication and compliance

CCVC is a launcher. It runs your own locally installed Claude Code (`claude`)
inside Cursor and gives it a chat surface. It does not replace, proxy, or
intermediate Claude Code in any way.

Specifically, CCVC **does not**:

- handle, store, capture, log, or transmit your Anthropic credentials
- present or embed any login or authentication flow
- route Claude requests through the extension on your behalf
- automate Claude in headless or background modes

**You** are responsible for authentication. CCVC assumes you already have an
Anthropic account, have `claude` installed, and have authenticated it yourself
(via your own Claude subscription login or your own API key), entirely outside
this extension. When a session needs re-authentication, CCVC will tell you, and
you re-authenticate through your own `claude` setup. The "respawn" control only
restarts the local process; it never logs you in.

This keeps CCVC within ordinary, individual use of Claude Code as described in
Anthropic's terms: https://code.claude.com/docs/en/legal-and-compliance

CCVC is an independent project. It is not affiliated with, sponsored by, or
endorsed by Anthropic or Anysphere (Cursor). "Claude," "Claude Code," and
"Cursor" are used only to describe interoperability with those products.
```

---

## Drop-in: CLAUDE.md section

> Guardrails for the coding agent working on this repo. Keep these as standing constraints.

```markdown
## Compliance guardrails (do not violate)

CCVC is a thin launcher around the user's own locally authenticated `claude`
process. Authentication is the user's responsibility and happens entirely
outside this extension. Preserve this posture in every change.

Never do any of the following without an explicit human decision:

- Add a login UI, OAuth flow, or any authentication surface inside the extension.
- Capture, store, log, cache, or forward credentials of any kind (OAuth tokens,
  refresh tokens, API keys, or anything an auth flow emits).
- Make the extension proxy or relay Claude requests using the user's
  subscription credentials on their behalf.
- Let the respawn/restart control do anything other than restart the child
  process. It must never call `claude login` or render a login surface.
- Introduce headless `claude -p`, background agent loops, scheduling, or batch
  fan-out that runs Claude without a per-turn user action. Keep the interaction
  interactive and human-in-the-loop.

Why: Anthropic permits ordinary individual use of Claude Code via the user's own
auth, but does not permit third parties to offer login or route requests through
Free/Pro/Max credentials on users' behalf, and expects product/automation use to
run on API keys. See https://code.claude.com/docs/en/legal-and-compliance

If a task would touch authentication, credential handling, request routing, or
automation, STOP and flag it for a human before implementing.
```

---

## References

- Anthropic, Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Anthropic, Using Claude Code with Pro or Max: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- Anthropic Usage Policy: https://www.anthropic.com/legal/aup
- Anthropic Consumer Terms: https://www.anthropic.com/legal/consumer-terms
- Cursor (Anysphere) Terms of Service: https://cursor.com/terms-of-service
