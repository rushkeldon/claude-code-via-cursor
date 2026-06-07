---
name: Fix Terminal.app double-window on launch
overview: Launching a fork/cold terminal in Terminal.app produces exactly two stacked windows — an empty one behind and our script's window in front. Diagnose the generator, then make openTerminalApp always run in a single fresh window and dispose of any stray window Terminal auto-opens on launch.
todos:
  - id: instrument-window-count
    content: "Add temporary diagnostic logging of Terminal window count before/after launch to confirm the generator"
    status: pending
  - id: capture-baseline
    content: "Run the diagnostic in Cursor (fork + cold, Terminal not running and already running) and record which case doubles"
    status: pending
  - id: rework-applescript
    content: "Rewrite openTerminalApp AppleScript: launch-guard + capture pre-existing windows + make our own window + close any stray launch window"
    status: pending
  - id: remove-diagnostic
    content: "Strip the temporary diagnostic logging once the fix is confirmed"
    status: pending
  - id: verify-matrix
    content: "Verify the full launch matrix: single window every time, lands in workspace, busy-wait still gates command"
    status: pending
  - id: bump-and-package
    content: "Bump appcloud9.X to the next version, compile, package, install with --force"
    status: pending
isProject: false
---

# Fix Terminal.app double-window on launch

## Background

After the terminal-launch refactor (see [archive/](archive/)), launching a fork or
cold terminal into **Terminal.app** opens **exactly two windows every time**: an
**empty window behind** and the **window in front that runs our script
successfully**. No other way of launching Terminal.app produces two windows, so the
extra window originates in our launch path, not the user's environment.

The current implementation is `openTerminalApp` in
[../src/webview.ts](../src/webview.ts) (around line 1311). It spawns `osascript` with
an argv-array AppleScript that does `set newTab to do script ""`, busy-waits on the
new tab, then `do script theCmd in newTab`.

### Root-cause hypothesis (to be confirmed in the diagnostic step)

Terminal.app's `do script "cmd"` with **no `in` target** always opens a **new
window**. When `osascript` poke-launches a Terminal that isn't already running (or
has no window), Terminal **auto-opens its own default window** as part of launching —
and then our target-less `do script ""` opens a **second** window for our script.
That stack is the symptom: the empty background window is Terminal's launch window;
the foreground one is ours.

The current code has **no launch guard** (unlike the iTerm path right below it at
[../src/webview.ts](../src/webview.ts) ~line 1367, which guards with
`if application "iTerm" is not running then launch …`), so nothing absorbs or
disposes of Terminal's auto-opened window.

## Approach

Confirmed decisions:

- **Reuse policy: always open a fresh window for us.** Never hijack a Terminal window
  the user already had open for other work. We create our own window, and if Terminal
  auto-opened an empty launch window, we **close that stray window** — we do not run
  our command in a pre-existing window.
- **Diagnose first.** Add temporary instrumentation to confirm the generator (the
  launch window vs. something else) before committing the AppleScript rewrite, so we
  fix the real cause rather than a guessed one.

The durable AppleScript shape (final step — exact form pinned after diagnosis):

```applescript
on run argv
  set theCmd to item 1 of argv
  -- Launch guard: ensure Terminal is running WITHOUT activate (activate can
  -- restore previously-closed windows). Note which windows existed BEFORE us.
  if application "Terminal" is not running then
    launch application "Terminal"
    repeat until application "Terminal" is running
      delay 0.1
    end repeat
    delay 0.3
  end if
  tell application "Terminal"
    set preexisting to id of every window  -- windows we must NOT touch
    set newTab to do script ""             -- OUR fresh window
    set ourWin to window 1
    delay 0.1
    repeat while busy of newTab
      delay 0.05
    end repeat
    -- Close any window that appeared during launch but isn't ours (the stray
    -- empty launch window). Compare against `preexisting` so the user's own
    -- windows are left alone.
    repeat with w in windows
      if (id of w is not (id of ourWin)) and (id of w is not in preexisting) then
        try
          if (count of tabs of w) is 1 and (busy of tab 1 of w is false) then close w
        end try
      end if
    end repeat
    if theCmd is not "" then do script theCmd in newTab
    activate
  end tell
end run
```

Notes / wrinkles to resolve during implementation:

- Closing-the-stray-window can race the launch window appearing. If the stray window
  shows up *after* our `do script ""`, the diff-against-`preexisting` set still
  catches it; if it can appear later, a small settle `delay` before the close sweep
  may be needed. The diagnostic step tells us the timing.
- `launch` (not `activate`/`open`) is deliberate: `activate` can reopen old windows
  and reintroduce the very problem we're fixing.
- Keep the existing **no-single-quotes / backslash-escaped cwd** handling
  ([../src/webview.ts](../src/webview.ts) ~line 1315) exactly as-is — that fixes a
  *different* (lands-at-`~`) bug and must not regress.
- The busy-wait gate on our own `newTab` stays — it's the profile-sourcing race fix,
  unrelated to the window count.

## Files to modify

- [../src/webview.ts](../src/webview.ts) — `openTerminalApp` (~line 1311): add the
  launch guard, capture pre-existing window ids, create our window, close the stray
  launch window. Temporary diagnostic logging added then removed.
- [../package.json](../package.json) — bump `appcloud9.X` to the **next** version
  before packaging.

No change needed to `getTerminalType`, the entry functions, `openITerm`,
`spawnOsascript`, or the message routing.

## Implementation details

### Step: diagnostic (temporary)

In `openTerminalApp`, before/after the spawn, log Terminal's window count so we can
see the delta. Either:

- prepend a probe to the AppleScript that returns `count of windows` and log it via
  `spawnOsascript`'s result, **or**
- run a standalone probe `osascript -e 'tell app "Terminal" to count windows'` via
  `cp.exec` and `log.debug` it immediately before and ~500ms after launch.

Run the matrix in Cursor and record results:

- Terminal **not running**, fork → expect 0 → 2 (confirms launch window)
- Terminal **not running**, cold → expect 0 → 2
- Terminal **already running w/ a window**, fork → expect N → N+1 (no stray)
- Terminal **already running, 0 windows** → expect 0 → ? (edge)

This tells us whether the stray window is purely a not-running artifact (then the
launch guard + close sweep is sufficient) or appears even when running (then the
close sweep must run unconditionally).

### Step: rework AppleScript

Implement the shape above. Use `id of window` for identity (stable), diff against the
`preexisting` set so the user's windows are never closed, and only close a candidate
stray if it's a single-tab, non-busy (empty) window — a conservative guard so we
never close something doing work.

### Step: remove diagnostic

Strip the temporary logging/probe once the fix is confirmed in the matrix.

## Edge cases

- **Terminal already running with the user's windows open**: `preexisting` captures
  their ids; the close sweep skips them. Our fresh window is the only new one.
- **Terminal running with zero windows**: launch guard is skipped; `do script ""`
  makes exactly one window; close sweep finds no stray (nothing matches "new and not
  ours"). Single window — correct.
- **Stray window appears late** (after the close sweep): mitigate with a short settle
  delay before the sweep if the diagnostic shows late timing.
- **cwd with spaces / shell metacharacters**: unchanged — the backslash-escaped,
  no-single-quote path still applies.
- **Busy stray window** (shouldn't happen, but): the `busy of tab 1 is false` guard
  means we never close a window that's running something.

## What we are NOT doing

- **Not** adopting/reusing a pre-existing window to run our command (rejected:
  hijacks the user's other Terminal work).
- **Not** touching the iTerm, integrated, or stubbed-terminal paths — this is
  Terminal.app-specific.
- **Not** changing the cwd-escaping or busy-wait logic — those fix unrelated bugs.

## Open questions

- Does the stray launch window ever appear when Terminal is **already running**? The
  diagnostic step answers this and decides whether the close sweep runs always or
  only after a cold launch.
