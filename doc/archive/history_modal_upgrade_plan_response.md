I've read the full document including the new `onTurnEnd` contract. Here's my honest read — and I want to lead with the thing that matters most, because I think the centerpiece of this revision has a subtle flaw that the polish of the response could lull us past.

## **Bottom line**

The document is substantially better, the agent's response is collaboratively excellent, and **the one new thing that's load-bearing — the `onTurnEnd` contract — has the right core but a questionable ordering that I think reintroduces the very concurrency the plan elsewhere forbids.** Let me walk it.

## **The contract's core is right; its step-3 placement is suspect**

Step 1 — the guard ("a silent-query result does NONE of the drain/deferral steps") — is the actual correctness fix, and it's correct. That's the thing that prevents a title query from flushing a queued prompt. Good.

But look at the ordering it commits to: **step 3 issues a title query, then steps 4–6 immediately apply deferred switches and drain a queued turn.** Trace what that does mechanically:

* `sendSilentQuery` does **not** set `isProcessing` (I checked — subprocess.ts \~122). So after step 3 writes the title query to stdin, `isProcessing` is still false.
* Step 6 then drains a queued turn and writes *that* to stdin too.
* **Now a silent query and a real user turn are in flight simultaneously**, sharing one `silentQueryCallback` slot and one result-routing path (the parser treats text as "silent" iff `silentQueryCallback` is set).

That works *only if* the CLI is strictly FIFO (title result fully arrives before the queued turn's), **and** the `awaitingSilentResult` flag is cleared at exactly the right moment. And here's the crux the plan doesn't pin down:

> The agent described the flag as "set when `sendSilentQuery` writes, cleared **when the callback fires**." The callback fires on the **assistant text** (\~1071). But the `result` event that drives `onTurnEnd` arrives *after* the text, as a separate event. So if the flag is cleared on the text callback, then when the title query's `result` hits `onTurnEnd`, `awaitingSilentResult` is already false → **the guard misses it → the title result gets treated as a real turn → it runs the title trigger again and drains again.** A cascade.

The fix is straightforward — clear `awaitingSilentResult` **in the guard, on the result event**, not on the text callback — but the plan currently specifies it the fragile way, and that's exactly the kind of imprecision that ships as a bug.

**The deeper point:** all of this fragility comes from issuing the title query *in the middle* of `onTurnEnd` (step 3), concurrent with the drain and the deferred switches. There's a strictly cleaner design the existing code already supports: **drain first, and let the title defer through `pendingSilentQuery`/`flushPendingSilentQuery`** — the mechanism built for exactly "issue a silent query after the in-flight turn settles." Drain the queued turn → it sets `isProcessing=true` → `sendSilentQuery(title)` sees that and defers → the next `onTurnEnd` flushes it when truly idle. Nothing is ever in flight twice. No FIFO dependency, no flag-timing subtlety.

The agent's stated rationale — *"Title (3) before drain (6) so the title query doesn't race the next user turn for the single slot"* — is, I think, backwards. A real queued turn doesn't compete for the *silent* slot (it uses the normal output path); the only thing that competes for the silent slot is another silent query, which forward-only already rules out. So draining first doesn't create a race — and issuing-title-first is what actually creates the overlap.

## **A smaller related issue: `userTurns === 3` is fragile under queueing**

The provisional trigger is an exact `=== 3`. If turns are queued and several drain before the title query gets to fire, `userTurns` can jump 3→5 and the provisional check is **silently skipped**. The `>= 6` final check is robust (good), but the provisional should be `>= 3 && !hasTitle`, or explicitly accepted as best-effort. Under the queue feature both specs reference, this *will* happen.

## **Minor: a line-number inconsistency**

The todo and the files-to-modify say `onTurnEnd` is at \~864; the contract says \~896. One of them is stale. Tiny, but worth reconciling so the implementer doesn't chase the wrong line.

## **On the agent's response itself**

Collaboratively, it's genuinely strong — and I want to be specific rather than just nice about it:

* It **acted** rather than merely agreeing (fixed B3 — I verified; the "spawn 100 processes" language is gone and now correctly describes the single-slot constraint).
* It **answered my direct questions** (the queue spec exists, it wrote it this session) instead of deflecting.
* It made a **judgment call** — promoting the open `onTurnEnd` question to a decided contract — which was the right instinct. The fact that I can *find* an ordering flaw in that contract is itself evidence the contract was needed: without it, the implementer would've rediscovered the seam and probably gotten the ordering wrong with no documentation to check against.
* It left exactly one thing open (helper location) with a correct justification (no correctness weight).

The one caution I'd flag — and it's about a property of the *response*, not the person: it's confident and well-structured ("promoted to a decided contract," "sequencing is answerable, and it resolves the question"). That polish is exactly what can make a reviewer nod past a subtle mechanical flaw. The contract *reads* as authoritative and final — six numbered steps with rationale — but I don't think it's been traced against the actual `isProcessing`/`silentQueryCallback`/`awaitingSilentResult` mechanics at the event level. Confidence and correctness are different axes, and here they've diverged a little.

## **What I'd do next**

Two things, both small:

1. **Re-decide the title-trigger placement** in the contract: I'd move it to *after* the drain and route it through the existing `pendingSilentQuery` defer mechanism, which eliminates the concurrency entirely. If you keep it at step 3, then the plan must explicitly state that `awaitingSilentResult` is cleared by the guard on the *result* event and document the FIFO dependency.
2. **Loosen the provisional check** to `>= 3 && !hasTitle`.

Neither is a teardown — the plan is in good shape and the visual track (A) is ready to build as-is. This is one refinement to the riskiest 15% of it. Want me to trace the exact event sequence against `subprocess.ts` to confirm the flag-timing concern is real before anyone changes the contract? That's the highest-value next step, and it's read-only.
