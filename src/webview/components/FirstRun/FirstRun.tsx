import "./FirstRun.less";
import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { on, post } from "../../vscode";
import { Modal } from "../Modal/Modal";
import { modelConfig } from "../../state/settings";

const firstRunVisible = signal(false);
const skillsData = signal<{
  modesInstalled: boolean;
  plansInstalled: boolean;
} | null>(null);

on("firstRunPrompt" as any, (msg: any) => {
  skillsData.value = msg.data || {
    modesInstalled: false,
    plansInstalled: false,
  };
  firstRunVisible.value = true;
  // Fetch the model config so the first-run model prompt knows whether a model
  // is already configured and what global default to pre-fill.
  post({ type: "getModelConfig" });
  // Acknowledge that the modal actually rendered. The host latches the
  // "shown" flags on this ack — never on the fire-and-forget prompt — so a
  // dropped or never-rendered prompt can't permanently suppress first-run.
  post({ type: "firstRunShown" } as any);
});

function installSkills() {
  post({ type: "installRecommendedSkills" } as any);
  firstRunVisible.value = false;
}

function dismiss() {
  firstRunVisible.value = false;
}

function ModelSetup() {
  const cfg = modelConfig.value;
  // Only prompt for a model when none is configured for this workspace yet.
  // Pre-fill from the user's global ~/.claude default so existing users just confirm.
  const [value, setValue] = useState<string | null>(null);
  if (!cfg || !cfg.needsFirstRun) return null;

  const current = value ?? cfg.globalDefault ?? "";

  function save() {
    const trimmed = current.trim();
    if (trimmed) post({ type: "setModel", model: trimmed });
  }

  return (
    <div class="first-run-model">
      <span class="first-run-skill-name">Model</span>
      <span class="first-run-skill-desc">
        Pick the model this workspace should use. It's written to{" "}
        <code>.claude/settings.local.json</code>; leave the pre-filled global
        default to keep what you use elsewhere.
      </span>
      <input
        type="text"
        class="first-run-model-input"
        value={current}
        placeholder={cfg.globalDefault || "claude-opus-4-8"}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onBlur={save}
      />
    </div>
  );
}

export function FirstRun() {
  const data = skillsData.value;

  return (
    <Modal
      title="Welcome to Claude Code via IDE"
      visible={firstRunVisible.value}
      onClose={dismiss}
    >
      <div class="first-run-content">
        <p class="first-run-intro">
          This extension wraps the Claude Code CLI in a mutli-modal interface
          similar to Claude Desktop.
          <br />
          You can configure the terminal app to launch breakout Claude Code
          sessions in via Settings.
          <br />
          There are two recommended skills that work well with this extension.
          You can{" "}
          <a
            href="https://github.com/rushkeldon/skills-anthropic"
            target="_blank"
          >
            review them here
          </a>
          .
        </p>

        <div class="first-run-skills">
          <div class="first-run-skill">
            <span class="first-run-skill-name">modes</span>
            <span class="first-run-skill-desc">
              Persistent modes ('plan' is the most key mode - limiting Claude
              Code to writing a .plan.md file compatible with Cursor).
            </span>
            {data?.modesInstalled ? (
              <span class="first-run-skill-check">✓ Installed</span>
            ) : (
              <span class="first-run-skill-pending">Not installed</span>
            )}
          </div>
          <div class="first-run-skill">
            <span class="first-run-skill-name">plans</span>
            <span class="first-run-skill-desc">
              Plan lifecycle: review, verify, send to Cursor, build, and update
              a .plan.md — Claude Code flips the TODO list live as it implements.
            </span>
            {data?.plansInstalled ? (
              <span class="first-run-skill-check">✓ Installed</span>
            ) : (
              <span class="first-run-skill-pending">Not installed</span>
            )}
          </div>
        </div>

        <ModelSetup />

        <div class="first-run-actions">
          {(!data?.modesInstalled || !data?.plansInstalled) && (
            <button
              class="first-run-btn primary"
              type="button"
              onClick={installSkills}
            >
              Install Skills
            </button>
          )}
          <button class="first-run-btn" type="button" onClick={dismiss}>
            {data?.modesInstalled && data?.plansInstalled
              ? "Done"
              : "Skip"}
          </button>
        </div>

        <p class="first-run-disclaimer">
          Heads up: the token count, context percentage, and session cost shown
          in the UI are approximate by nature — they're estimates from Claude
          Code, useful as at-a-glance signals, not exact accounting. For
          authoritative billing, check the Claude Console.
        </p>

        <p class="first-run-hint">
          You can always install skills later from Settings.
        </p>
      </div>
    </Modal>
  );
}
