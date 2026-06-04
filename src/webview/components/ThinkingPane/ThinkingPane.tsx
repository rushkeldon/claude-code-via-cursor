import './ThinkingPane.less';
import { signal } from '@preact/signals';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { on } from '../../vscode';
import { messages } from '../../state/messages';

export const thinkingText = signal('');
const thinkingStartMs = signal(0);
export const thinkingActive = signal(false);
const thinkingCollapsing = signal(false);
let streamedThisTurn = false;
let collapseTimeout: number | undefined;

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
  }
  if (thinkingText.value.trim()) {
    thinkingText.value = thinkingText.value + '\n\n' + msg.data.trim();
  } else {
    thinkingText.value = msg.data.trim();
  }
});

function commitToPill() {
  const content = thinkingText.value;
  if (!content.trim()) {
    // Nothing meaningful to commit — just reset.
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
  const elapsedMs = Date.now() - thinkingStartMs.value;
  const elapsedLabel = elapsedMs < 1000
    ? `${elapsedMs}ms`
    : `${(elapsedMs / 1000).toFixed(1)}s`;
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
  thinkingText.value = '';
  thinkingActive.value = false;
  thinkingCollapsing.value = false;
  streamedThisTurn = false;
});

export function ActiveThinkingPane() {
  // Stay mounted as long as there is text to show — even after
  // `thinkingActive` flips false during the collapse animation, so the CSS
  // transition has an element to animate.
  if (!thinkingText.value) return null;

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

  return (
    <div class="thinking-live" ref={paneRef}>
      <div class="thinking-header">💭 Thinking…</div>
      <div class="thinking-content">{thinkingText.value}</div>
    </div>
  );
}
