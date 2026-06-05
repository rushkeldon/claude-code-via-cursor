---
name: Image cleanup by session ID — prefix-naming, delete-on-delete, age-gated orphan sweep
overview: >
  Conversation images leak: they're never deleted when a conversation is deleted.
  Root cause — the per-conversation cleanup (cleanupConversationImages) reads
  msg.data.images, but the image array is dropped before save, so cleanup never
  matches anything. Fix the association by naming each image file with its
  session ID prefix (<sessionId>_<timestamp>.ext), so deletion is a filename glob
  (img/<sessionId>_*) requiring no conversation-JSON parsing. Handle the two
  session-ID timing holes (pre-ID attach → pending_ + rename on init; in-window
  ID rotation → rename old prefix → new). Add an age-gated orphan sweep as a
  safety net for crash/rotation leftovers. Forward-only: existing 42 orphaned
  files are deleted by the user manually (no automated backfill of the unmatchable).
todos:
  - id: session-id-getter
    content: "Confirm/expose conversation.getCurrentSessionId() (already exists, conversation.ts ~66) for use in webview.ts createImageFile. No new API needed if the getter is already exported."
    status: pending
  - id: name-images-by-session
    content: "In webview.ts createImageFile (~1621): prefix the written filename with the current session ID. Read sessionId via conversation.getCurrentSessionId(); when present use `<sessionId>_<existingName>`, when absent use `pending_<existingName>`. Apply to BOTH the originalName branch and the timestamp branch so every written file carries a prefix."
    status: pending
  - id: rename-pending-on-init
    content: "When the CLI mints the session ID at system/init (subprocess.ts ~1084), rename any img/pending_* files to img/<sessionId>_* so a pre-ID attach ends up correctly prefixed. New helper (e.g. in a small src/sessionImages.ts) called right after setCurrentSessionId in the init branch."
    status: pending
  - id: rename-on-rotation
    content: "On a genuine IN-WINDOW session-ID rotation (the result-event adopt at subprocess.ts ~1313 changing a non-empty old id to a different new id), rename img/<oldId>_* → img/<newId>_*. Capture the old id before setCurrentSessionId, compare, rename only when old is truthy && old !== new. Forks are OUT of process (webview.ts forkSessionToTerminal spawns a separate terminal and never touches this window's currentSessionId), so this path never fires for a fork — confirm and document."
    status: pending
  - id: delete-by-prefix
    content: "Rewrite cleanupConversationImages (conversation.ts ~312) to delete by session-ID glob instead of walking msg.data.images: given the conversation's sessionId, fs.readdir the img dir and unlink files whose name starts with `<sessionId>_`. deleteConversation already has the loaded data (has sessionId) — use data.sessionId; the index entry also carries sessionId as a fallback."
    status: pending
  - id: orphan-sweep
    content: "Add an age-gated orphan sweep (new helper in src/sessionImages.ts, called once on activation after the conversation index loads). Delete an img file only if BOTH: (a) its `<sessionId>_` prefix matches no sessionId in the conversation index, AND (b) its mtime is older than the oldest startTime among indexed conversations (so anything newer than the oldest live session is never swept — protects pending_/just-rotated/in-flight files). pending_* files: sweep only if older than that same threshold."
    status: pending
  - id: version-bump
    content: "Bump appcloud9.X in package.json before packaging."
    status: pending
  - id: verify
    content: "Verify: (1) new image attach writes <sessionId>_*.png (or pending_* before first turn, renamed to <sessionId>_* after init); (2) deleting a conversation removes exactly that session's img files and no others; (3) ID rotation renames old-prefixed files; (4) a fork does NOT rename the source window's files; (5) sweep on startup removes only unmatched-AND-old files, leaves fresh/live ones; (6) build green (compile + vsce package + install --force)."
    status: pending
isProject: false
---

# Image cleanup by session ID — prefix-naming, delete-on-delete, age-gated orphan sweep

## Background

Conversation images leak permanently. The user deleted all history and found 42
image files (~28 MB) still sitting in
`~/Library/Application Support/claude-code-via-cursor/img` with **zero**
conversations left on disk.

**Root cause (verified by tracing the save path):** the per-conversation cleanup
`cleanupConversationImages` ([conversation.ts](../src/conversation.ts) ~312)
walks `msg.data.images` and unlinks any `filePath` under the img dir — but **that
array is never present in the saved JSON**, so cleanup matches nothing, every time:

1. [subprocess.ts](../src/subprocess.ts) ~316 passes images as a **sibling** of
   `data`, not inside it:
   ```ts
   conversation.sendAndSaveMessage({ type: 'userInput', data: message, images: echoImages });
   ```
2. `sendAndSaveMessage` ([conversation.ts](../src/conversation.ts) ~120) pushes
   only `{ timestamp, messageType, data }` into `currentConversation` — **the
   `images` sibling is read for the live `postMessage` to the webview but is
   silently dropped before it's ever persisted.**
3. `saveCurrentConversation` (~160) serializes `messages: currentConversation`,
   so the on-disk `data` for a userInput is a bare string with **no images
   field anywhere**.
4. `cleanupConversationImages` then checks `Array.isArray(msg.data.images)` and
   `typeof msg.data === 'object'` — both false for a string `data` — so it finds
   zero images and deletes nothing.

(Side effect of the same drop: attached images also **vanish from old
conversations on reload**, since the reload path re-sends `data: message.data`
with no images — webview.ts ~1763. That is a separate display bug; see
*What we are NOT doing*.)

**The 42 existing files are unrecoverable orphans.** Because `images` was never
written to any conversation JSON, nothing on disk ever linked an image to a
conversation — and now the conversations are deleted too. There is no data to
reconstruct the association. The user will delete these 42 files manually.

## Approach

Rather than fix the broken `data.images` persistence and keep parsing JSON to
find images, **encode the association in the filename**: every image is written
as `<sessionId>_<name>`. Deletion then needs no JSON at all — it's a filename
glob `img/<sessionId>_*`. This is robust even when the conversation JSON is
missing or malformed, and it sidesteps the persistence bug entirely for cleanup
purposes.

Two session-ID timing holes must be handled, because the **session ID is owned by
the Claude CLI, not us** (verified):

- **Pre-ID attach.** A brand-new chat has `currentSessionId === undefined`
  ([conversation.ts](../src/conversation.ts) ~245 `newSession`) until the first
  turn runs and the CLI emits `system/init`, which mints the id (subprocess.ts
  ~1084). An image attached before that has no id to prefix. → name it
  `pending_<name>`, then **rename `pending_*` → `<sessionId>_*` on init**.
- **In-window ID rotation.** Every `result` event re-adopts the CLI's reported
  `session_id` (subprocess.ts ~1313, comment: *"authoritative for any later
  --resume / --fork-session… keeps the stored id current if it ever rotates"*).
  If the id rotates mid-session, live images carry a stale prefix. → **rename
  `<oldId>_*` → `<newId>_*` on a genuine rotation**.

  > **Fork is NOT a rotation and must NOT trigger a rename.** `forkSessionToTerminal`
  > ([webview.ts](../src/webview.ts) ~1157) spawns a **separate terminal** with
  > `--resume <id> --fork-session`; it never mutates *this* window's
  > `currentSessionId`. So the rotation rename only ever fires for a real in-window
  > id change, and the source session keeps its own images. This matches the user's
  > requirement: "don't rename a session that is still valid when it gets forked."

Finally, an **age-gated orphan sweep** on startup reclaims anything the above
miss (crash mid-attach, an id change we didn't catch, pre-fix leftovers): delete
an img file only if its prefix matches no indexed conversation **AND** it's older
than the oldest session still in history. The age gate is what makes the sweep
safe — a freshly-attached `pending_*` or just-rotated file in a not-yet-indexed
live chat is always newer than the oldest live session, so it's never swept.

Forward-only: no automated backfill (the 42 existing orphans are unmatchable by
construction; user deletes them manually).

## Files to modify

- [src/webview.ts](../src/webview.ts) — `createImageFile` (~1621): prefix the
  written filename with `conversation.getCurrentSessionId()` (or `pending_` when
  undefined), in **both** the `originalName` and timestamp branches.
- [src/subprocess.ts](../src/subprocess.ts) —
  (1) `system/init` branch (~1084): after `setCurrentSessionId`, call
  `renamePendingImages(sessionId)`.
  (2) `result` branch (~1313): capture old id, and if `old && old !== new`, call
  `renameSessionImages(old, new)` (in-window rotation only).
- [src/conversation.ts](../src/conversation.ts) — rewrite
  `cleanupConversationImages` (~312) to delete by `<sessionId>_` prefix glob using
  the conversation's `sessionId` (from the loaded `data` in `deleteConversation`,
  ~287; index entry carries `sessionId` as fallback).
- [src/sessionImages.ts](../src/sessionImages.ts) — **new** small module: the img
  dir path constant, `renamePendingImages(newId)`, `renameSessionImages(old,new)`,
  `deleteSessionImages(sessionId)`, and `sweepOrphanImages(index)`. Keeps fs/glob
  logic out of subprocess.ts/conversation.ts.
- [src/webview.ts](../src/webview.ts) or extension activation — call
  `sweepOrphanImages(conversationIndex)` once after the index is loaded on startup.
- [package.json](../package.json) — bump `appcloud9.X`.

## Implementation details

### Naming (webview.ts createImageFile ~1656)

```ts
const sessionId = conversation.getCurrentSessionId();
const prefix = sessionId ? `${sessionId}_` : `pending_`;

let baseName: string;
if (originalName) {
  // keep collision-avoidance, but on the prefixed candidate
  baseName = originalName;
} else {
  baseName = `image_${Date.now()}.${ext}`;
}
let candidate = `${prefix}${baseName}`;
// existing while(fs.existsSync(...)) collision loop operates on `candidate`
imageFileName = candidate;
```

Note: the filePath posted back in `imageAttached` (~1681) is still the absolute
path — the live message and webview keep working unchanged; only the on-disk
basename gains the prefix.

### Rename helpers (src/sessionImages.ts)

```ts
const IMG_DIR = path.join(os.homedir(), 'Library', 'Application Support',
  'claude-code-via-cursor', 'img');

// pre-ID attach → real id minted
export function renamePendingImages(newId: string): void {
  for (const f of safeReaddir()) {
    if (f.startsWith('pending_')) {
      const renamed = `${newId}_` + f.slice('pending_'.length);
      tryRename(f, renamed);
    }
  }
}

// in-window id rotation (NOT fork)
export function renameSessionImages(oldId: string, newId: string): void {
  if (!oldId || oldId === newId) return;
  const old = `${oldId}_`;
  for (const f of safeReaddir()) {
    if (f.startsWith(old)) tryRename(f, `${newId}_` + f.slice(old.length));
  }
}
```

`safeReaddir`/`tryRename` swallow ENOENT (dir or file already gone). A rename
collision (target exists) is unlikely given timestamped names; on collision,
leave the source in place — the sweep will reclaim it later.

### Rotation hook (subprocess.ts ~1309)

```ts
if (jsonData.session_id) {
  const oldId = conversation.getCurrentSessionId();
  conversation.setCurrentSessionId(jsonData.session_id);
  if (oldId && oldId !== jsonData.session_id) {
    renameSessionImages(oldId, jsonData.session_id);
  }
  // ...existing sessionInfo post...
}
```

Init hook (subprocess.ts ~1084): `renamePendingImages(jsonData.session_id)` right
after `setCurrentSessionId`.

### Delete by prefix (conversation.ts cleanupConversationImages ~312)

```ts
function cleanupConversationImages(sessionId: string | undefined): void {
  if (!sessionId) return;
  deleteSessionImages(sessionId);   // fs.readdir(IMG_DIR), unlink f starting with `${sessionId}_`
}
```

Call site `deleteConversation` (~290) becomes
`cleanupConversationImages(data.sessionId)` (the loaded data has `sessionId`;
fall back to the index entry's `sessionId` if the JSON was unreadable — the index
filter at ~303 already has the entry).

### Age-gated orphan sweep (src/sessionImages.ts)

```ts
export function sweepOrphanImages(index: Array<{ sessionId: string; startTime: string }>): void {
  const liveIds = new Set(index.map(e => e.sessionId));
  const oldestLive = index.reduce<number>((min, e) => {
    const t = Date.parse(e.startTime); return isNaN(t) ? min : Math.min(min, t);
  }, Infinity);  // Infinity when index empty → sweep everything unmatched

  for (const f of safeReaddir()) {
    const id = f.includes('_') ? f.slice(0, f.indexOf('_')) : '';  // prefix before first _
    if (liveIds.has(id)) continue;                 // belongs to a live conversation
    const mtime = statMtime(f);                    // ms
    if (mtime >= oldestLive) continue;             // newer than oldest live session — leave it
    tryUnlink(f);
  }
}
```

- **Empty index** → `oldestLive = Infinity`, so `mtime >= Infinity` is always
  false → every unmatched file is swept. (Correct: no live sessions, nothing to
  protect. NOTE: the user is deleting the current 42 manually, so this is mostly
  moot for them, but the logic must be right for the empty-index case.)
- `pending_*` files have prefix `pending` which won't be in `liveIds`, so they're
  governed purely by the age gate — a brand-new pending file is newer than the
  oldest live session and survives until it either gets renamed (init) or ages out.
- Sweep runs **once on activation, after the index loads** — not per-turn.

## Edge cases

- **Pre-ID attach then user never sends a turn** → file stays `pending_*`; sweep
  reclaims it once it's older than the oldest live session. No leak.
- **ID rotation rename collision** (target name already exists) → leave source;
  sweep reclaims. Logged at debug, not surfaced.
- **Fork** → no rename (out-of-process; this window's id unchanged). The forked
  terminal is a separate session with its own (new) id; any images *it* attaches
  get *its* prefix. Source images stay with the source. ✔ matches user requirement.
- **Two windows, two sessions** → each names by its own `currentSessionId`; delete
  globs only that id's files; sweep keys off the shared index so a live id in
  either window is protected.
- **Unprefixed legacy files** (the existing 42, named `image_*` / `ai_collab_*`)
  → prefix-before-first-`_` yields `image` / `ai` etc., never in `liveIds`; they'd
  be swept once older than the oldest live session. The user is deleting them
  manually, so this is belt-and-suspenders only.
- **Index `startTime` unparseable** → skipped in the `oldestLive` reduction (treated
  as not lowering the bound); conservative (keeps the bound higher → sweeps less).
- **Empty img dir / dir missing** → `safeReaddir` returns `[]`; all helpers no-op.

## What we are NOT doing

- **Not fixing the `data.images` persistence drop** — we sidestep it by naming.
  Images still won't be re-serialized into the conversation JSON, which means
  attached images still **disappear from old conversations on reload** (a real
  but separate display bug). If we want reloaded conversations to *show* their
  images, that's a follow-up plan (persist `images` into the saved message + the
  reload batch). Out of scope here; this plan is about *cleanup*, per the user.
- **Not auto-backfilling the 42 existing orphans** — they're unmatchable by
  construction; the user deletes them manually.
- **Not a periodic/interval sweep** — once on activation is enough; avoids churn.
- **Not changing image storage location** — stays in
  `~/Library/Application Support/claude-code-via-cursor/img`.
- **Not adding concurrency locks to the sweep** — single startup pass; rename
  helpers tolerate races via ENOENT swallowing.

## Open questions

- **Reload display bug (images vanish on reload):** fix in a follow-up, or fold
  into this plan? Leaning follow-up — it requires re-plumbing `images` through
  save + reload batch, which is the original (different) bug and widens scope.
- **Helper home:** `src/sessionImages.ts` (proposed) vs. extending
  conversation.ts. Leaning new module so fs/glob logic is isolated and testable,
  and so both subprocess.ts (rename) and conversation.ts (delete) import from one
  place without a circular dep.
- **Sweep trigger location:** cleanest call site for the one-shot startup sweep —
  extension `activate` after `initializeConversations` + index load, vs. inside
  the index-load path. Confirm where the index is guaranteed populated.
