import "./FirstRun.less";
import { signal } from "@preact/signals";
import { on, post } from "../../vscode";
import { Modal } from "../Modal/Modal";

const firstRunVisible = signal(false);
const skillsData = signal<{
  modesInstalled: boolean;
  plan2cursorInstalled: boolean;
} | null>(null);

on("firstRunPrompt" as any, (msg: any) => {
  skillsData.value = msg.data || {
    modesInstalled: false,
    plan2cursorInstalled: false,
  };
  firstRunVisible.value = true;
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

export function FirstRun() {
  const data = skillsData.value;

  return (
    <Modal
      title="Welcome to Claude Code via Cursor"
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
            <span class="first-run-skill-name">plan2cursor</span>
            <span class="first-run-skill-desc">
              Send a .plan.md file to Cursor and have Claude Code update the
              TODO list as it implements against that plan.
            </span>
            {data?.plan2cursorInstalled ? (
              <span class="first-run-skill-check">✓ Installed</span>
            ) : (
              <span class="first-run-skill-pending">Not installed</span>
            )}
          </div>
        </div>

        <div class="first-run-actions">
          {(!data?.modesInstalled || !data?.plan2cursorInstalled) && (
            <button
              class="first-run-btn primary"
              type="button"
              onClick={installSkills}
            >
              Install Skills
            </button>
          )}
          <button class="first-run-btn" type="button" onClick={dismiss}>
            {data?.modesInstalled && data?.plan2cursorInstalled
              ? "Done"
              : "Skip"}
          </button>
        </div>

        <p class="first-run-hint">
          You can always install skills later from Settings.
        </p>
      </div>
    </Modal>
  );
}
