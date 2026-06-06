#!/usr/bin/env node
// probe_thinking.mjs — confirm how the thinking/effort levers behave against the
// LOCAL, AUTHENTICATED `claude` binary (the part the sandbox can't reach).
//
// What it does, all over the stream-json control channel (no prompt-prefix hack):
//   1. initialize        → prints models + account + applied effort/model
//   2. get_settings      → prints effective/applied effort before changes
//   3. for each effort level (and a raw max-thinking-tokens budget) it runs ONE
//      tiny reasoning turn and reports the thinking-token usage, so you can see
//      whether the lever actually moves the model's thinking budget.
//
// NOTE: this runs real model turns → it bills a small amount against your
// subscription's interactive bucket. The prompt is pure reasoning (no tools), so
// no permission prompts should fire. Delete this file when done.
//
//   node probe_thinking.mjs              # uses `claude` on PATH
//   CLAUDE_BIN=/path/to/claude node probe_thinking.mjs

import { spawn } from 'child_process';

const BIN = process.env.CLAUDE_BIN || 'claude';
const PROMPT = 'Reason carefully step by step, then give only the final number. '
  + 'How many distinct ways can 8 non-attacking rooks be placed on a chessboard '
  + 'such that none lie on the two main diagonals? Think it through before answering.';

const proc = spawn(BIN, [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--permission-prompt-tool', 'stdio',
], { env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', NO_COLOR: '1' } });

let id = 0;
const pending = new Map();
function control(req) {
  const request_id = `probe-${++id}`;
  return new Promise((resolve, reject) => {
    pending.set(request_id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id, request: req }) + '\n');
    setTimeout(() => { if (pending.has(request_id)) { pending.delete(request_id); reject(new Error('timeout ' + req.subtype)); } }, 20000);
  });
}

// Resolve when the next `result` (turn end) arrives; collect thinking usage.
let turnResolve = null, thinkingChars = 0, lastUsage = null;
function runTurn(text) {
  thinkingChars = 0; lastUsage = null;
  return new Promise((resolve) => {
    turnResolve = resolve;
    proc.stdin.write(JSON.stringify({
      type: 'user', session_id: '', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n');
  });
}

let buf = '';
proc.stdout.on('data', (d) => {
  buf += d; const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'control_response') {
      const r = j.response, p = pending.get(r.request_id);
      if (p) { pending.delete(r.request_id); r.subtype === 'error' ? p.reject(new Error(r.error)) : p.resolve(r.response || {}); }
    } else if (j.type === 'assistant' && j.message) {
      if (j.message.usage) lastUsage = j.message.usage;
      for (const c of j.message.content || []) if (c.type === 'thinking' && c.thinking) thinkingChars += c.thinking.length;
    } else if (j.type === 'result') {
      const r = turnResolve; turnResolve = null;
      if (r) r({ thinkingChars, usage: lastUsage, cost: j.total_cost_usd });
    }
  }
});
proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d));

const log = (...a) => console.log(...a);

(async () => {
  const init = await control({ subtype: 'initialize', hooks: {}, sdkMcpServers: [] });
  log('models   :', (init.models || []).map(m => m.id || m.model || m.value).join(' | '));
  log('account  :', JSON.stringify(init.account || {}));

  const s0 = await control({ subtype: 'get_settings' });
  log('applied  :', JSON.stringify(s0.applied || {}));
  log('effective:', JSON.stringify(s0.effective || {}));
  log('—'.repeat(60));

  // A) effort levels via apply_flag_settings
  for (const effort of ['low', 'high', 'xhigh']) {
    await control({ subtype: 'apply_flag_settings', settings: { effort } });
    const s = await control({ subtype: 'get_settings' });
    const res = await runTurn(PROMPT);
    log(`effort=${effort.padEnd(5)} -> applied.effort=${JSON.stringify(s.applied?.effort)}  `
      + `thinkingChars=${res.thinkingChars}  out_tokens=${res.usage?.output_tokens}  cost=$${res.cost ?? '?'}`);
  }
  log('—'.repeat(60));

  // B) explicit numeric budget via set_max_thinking_tokens (reset effort first)
  await control({ subtype: 'apply_flag_settings', settings: { effort: 'high' } });
  for (const budget of [1024, 31999]) {
    await control({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: budget });
    const res = await runTurn(PROMPT);
    log(`maxThinkingTokens=${String(budget).padEnd(6)} -> thinkingChars=${res.thinkingChars}  `
      + `out_tokens=${res.usage?.output_tokens}  cost=$${res.cost ?? '?'}`);
  }

  log('—'.repeat(60));
  log('Read: if thinkingChars rises with effort/budget, the lever works on your');
  log('account and we can replace the prompt-prefix hack with it. If it is flat,');
  log('the dial is gated and we fall back to the other lever.');
  proc.kill('SIGTERM');
  process.exit(0);
})().catch((e) => { console.error('PROBE FAILED:', e.message); proc.kill('SIGTERM'); process.exit(1); });
