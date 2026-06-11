import './ThinkingPane.less';
import { signal } from '@preact/signals';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { on } from '../../vscode';
import { messages } from '../../state/messages';
import { thoughtsOn } from '../../state/settings';

export const thinkingText = signal('');
const thinkingStartMs = signal(0);
export const thinkingActive = signal(false);
const thinkingCollapsing = signal(false);
let streamedThisTurn = false;
let collapseTimeout: number | undefined;

// Drives the live "thought for Ns" timer in the always-on bubble. Ticks only
// while a thinking block is active; referenced in the pane render so the elapsed
// label re-renders. The bubble + timer show on every turn even with zero thought
// text — that's the post-Send activity affordance ("something is happening").
const nowTick = signal(0);
let tickInterval: number | undefined;
function startTick() {
  if (tickInterval) return;
  nowTick.value = Date.now();
  tickInterval = window.setInterval(() => { nowTick.value = Date.now(); }, 200);
}
function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = undefined; }
}

// Keep in sync with ThinkingPane.less: @thinking-collapse-delay + @thinking-collapse-duration.
// Small buffer so the JS unmount lands AFTER the CSS transition completes —
// otherwise the element pops out a frame early and you see a flicker.
const COLLAPSE_TOTAL_MS = 250 + 2000 + 80;

function cancelPendingCollapse() {
  if (collapseTimeout) {
    clearTimeout(collapseTimeout);
    collapseTimeout = undefined;
  }
}

on('thinkingBlockStart', () => {
  if (thinkingActive.value && thinkingText.value.trim()) {
    thinkingText.value = thinkingText.value + '\n\n';
  } else {
    // A new turn is starting — cancel any pending collapse from the previous
    // turn and drop its lingering text so we don't paint stale content.
    cancelPendingCollapse();
    thinkingText.value = '';
    thinkingStartMs.value = Date.now();
    thinkingActive.value = true;
    thinkingCollapsing.value = false;
    startTick();
  }
});

on('thinkingDelta', (msg) => {
  if (!msg.data) return;
  streamedThisTurn = true;
  if (!thinkingActive.value) {
    cancelPendingCollapse();
    // If we're still mid-collapse from a prior block, dump the leftover text
    // so the new stream doesn't append to the just-committed thought.
    if (thinkingCollapsing.value) thinkingText.value = '';
    thinkingStartMs.value = Date.now();
    thinkingActive.value = true;
    thinkingCollapsing.value = false;
    startTick();
  }
  thinkingText.value = thinkingText.value + msg.data;
});

on('thinking', (msg) => {
  if (!msg.data || !msg.data.trim()) return;
  if (streamedThisTurn) return;
  if (!thinkingActive.value) {
    cancelPendingCollapse();
    if (thinkingCollapsing.value) thinkingText.value = '';
    thinkingStartMs.value = Date.now();
    thinkingActive.value = true;
    thinkingCollapsing.value = false;
    startTick();
  }
  if (thinkingText.value.trim()) {
    thinkingText.value = thinkingText.value + '\n\n' + msg.data.trim();
  } else {
    thinkingText.value = msg.data.trim();
  }
});

function commitToPill() {
  stopTick();
  const content = thinkingText.value;
  const elapsedMs = Date.now() - thinkingStartMs.value;
  const elapsedLabel = elapsedMs < 1000
    ? `${elapsedMs}ms`
    : `${(elapsedMs / 1000).toFixed(1)}s`;

  if (!content.trim()) {
    // No thought text this turn. If the user asked to see thoughts (On) but none
    // arrived (e.g. Bedrock-4.8 doesn't honor the display flag), leave a
    // timer-only pill ("Thought for Xs"). It has no expand chevron, so the
    // absence of foldable content is self-evident — no explanatory note needed.
    // If thoughts are Off, just reset — the live bubble already gave feedback
    // during the turn.
    if (thoughtsOn.value) {
      messages.value = [...messages.value, {
        role: 'thinking',
        content: '',
        elapsedLabel,
        timestamp: Date.now(),
      }];
    }
    thinkingText.value = '';
    thinkingActive.value = false;
    thinkingCollapsing.value = false;
    streamedThisTurn = false;
    return;
  }

  // 1) Push the pill into the message log immediately so it lands in the
  //    correct order relative to the assistant output that triggered the
  //    flush. The pill is what the user can later expand/collapse to revisit
  //    the thought.
  messages.value = [...messages.value, {
    role: 'thinking',
    content,
    elapsedLabel,
    timestamp: Date.now(),
  }];

  // 2) Flip out of "active streaming" but KEEP the live pane mounted (driven
  //    by thinkingText). The `thinkingCollapsing` flag adds the CSS class
  //    that animates max-height → 0 with the easing defined in the LESS.
  //    Previously we cleared thinkingText here, which unmounted the element
  //    instantly and gave the CSS transition nothing to animate against —
  //    that was the "slam shut".
  thinkingActive.value = false;
  thinkingCollapsing.value = true;
  streamedThisTurn = false;

  // 3) After the CSS transition fully resolves, drop the text so the pane
  //    unmounts cleanly and is ready for the next turn.
  cancelPendingCollapse();
  collapseTimeout = window.setTimeout(() => {
    thinkingText.value = '';
    thinkingCollapsing.value = false;
    collapseTimeout = undefined;
  }, COLLAPSE_TOTAL_MS);
}

// Called by messages.ts BEFORE adding an output message, guaranteeing order.
export function flushThinkingToPill() {
  if (thinkingActive.value && thinkingText.value.trim()) {
    commitToPill();
  }
}

on('setProcessing', (msg) => {
  if (!msg.data?.isProcessing && thinkingActive.value) {
    // Fallback: processing ended without an output event (e.g., error path).
    // Still commit + animate the close.
    commitToPill();
  }
});

on('userInput', () => {
  streamedThisTurn = false;
});

on('ready', () => {
  cancelPendingCollapse();
  stopTick();
  thinkingText.value = '';
  thinkingActive.value = false;
  thinkingCollapsing.value = false;
  streamedThisTurn = false;
});

export function ActiveThinkingPane() {
  // Always-on affordance: stay mounted while a thinking block is active (even
  // with zero thought text — bubble + live timer) and while text is collapsing.
  if (!thinkingActive.value && !thinkingText.value) return null;

  const paneRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    if (thinkingCollapsing.value) {
      // Pin the current pixel height so the transition has a real starting
      // value (max-height: 220px in CSS isn't necessarily the actual rendered
      // height for short thoughts — without this, short panes would jump from
      // 220px → 0 instead of from their true height → 0).
      pane.style.maxHeight = pane.offsetHeight + 'px';
      // Force a reflow so the browser commits the starting height BEFORE we
      // flip the class on, otherwise the transition has no "from" frame.
      void pane.offsetHeight;
      pane.classList.add('thinking-live--collapsing');
    } else {
      // Mid-collapse a new thought started — restore the open state.
      pane.classList.remove('thinking-live--collapsing');
      pane.style.maxHeight = '';
    }
  }, [thinkingCollapsing.value]);

  const active = thinkingActive.value;
  // While active, reference nowTick so the timer re-renders every tick.
  const elapsedMs = (active ? nowTick.value : Date.now()) - thinkingStartMs.value;
  const secs = (Math.max(0, elapsedMs) / 1000).toFixed(1);

  return (
    <div class="thinking-live" ref={paneRef}>
      <div class="thinking-header">💭 Thinking… <span class="thinking-timer">{secs}s</span></div>
      {thinkingText.value && <div class="thinking-content">{thinkingText.value}</div>}
    </div>
  );
}
