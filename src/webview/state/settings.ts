import { signal } from "@preact/signals";
import { on } from "../vscode";
import { pushNotice } from "./messages";

export interface FullSettings {
  "wsl.enabled": boolean;
  "wsl.distro": string;
  "wsl.nodePath": string;
  "wsl.claudePath": string;
  "permissions.yoloMode": boolean;
  "executable.path": string;
  "environment.variables": Record<string, string>;
  "environment.disabled": boolean;
  "terminal.useIntegrated": boolean;
  "terminal.externalApp": string;
  "terminal.customTemplate": string;
}

export interface PermissionsData {
  alwaysAllow: Record<string, boolean | string[]>;
}

export interface ModelConfig {
  model?: string;
  globalDefault?: string;
  needsFirstRun: boolean;
}

export interface ModelOption {
  value: string;
  displayName?: string;
  description?: string;
  // Capability flags from the initialize catalog (gate #2 confirmed exact).
  // Absent on alias/legacy entries (default, haiku, opus-4-1) → treat as falsy.
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
  supportsEffort?: boolean;
}

export const fullSettings = signal<FullSettings | null>(null);
export const permissionsData = signal<PermissionsData>({ alwaysAllow: {} });
export const detectedTerminals = signal<{ terminals: string[]; platform: string } | null>(null);
export const modelConfig = signal<ModelConfig | null>(null);
// Dynamic model list from the initialize handshake, plus the selected value.
export const modelList = signal<ModelOption[]>([]);
export const selectedModel = signal<string | undefined>(undefined);
// A model chosen while a turn was in flight: the extension deferred the switch
// to the next turn-end. Held here so the picker can show a "next turn" marker;
// cleared once the switch actually applies (a non-deferred modelSet).
export const pendingModel = signal<string | undefined>(undefined);

// Thinking controls (host-owned current values; capabilities derived from the
// selected model entry in modelList). thoughtsOn: show summarized thoughts;
// effort: the chosen depth level, or undefined to inherit the model default.
export const thoughtsOn = signal<boolean>(true);
export const effort = signal<string | undefined>(undefined);

on("modelConfig", (msg) => {
  modelConfig.value = msg.data;
});

on("thoughtControlConfig", (msg: any) => {
  if (typeof msg.data?.thoughtsOn === "boolean") thoughtsOn.value = msg.data.thoughtsOn;
  effort.value = msg.data?.effort;
});

on("modelList", (msg: any) => {
  modelList.value = Array.isArray(msg.data?.models) ? msg.data.models : [];
  if (msg.data?.selected) selectedModel.value = msg.data.selected;
});

on("modelSet", (msg: any) => {
  if (msg.data?.ok) {
    if (msg.data.deferred) {
      // Turn in flight — the switch is queued for the next turn-end. Mark it
      // pending; don't update selectedModel yet (it isn't live).
      pendingModel.value = msg.data.model;
    } else {
      // The switch applied for real — promote it and clear any pending marker.
      selectedModel.value = msg.data.model;
      pendingModel.value = undefined;
    }
  } else {
    pendingModel.value = undefined;
    pushNotice(
      "Model switch failed",
      msg.data?.error ? `Kept the previous model. ${msg.data.error}` : "Kept the previous model.",
    );
  }
});

on("detectedTerminals", (msg) => {
  detectedTerminals.value = msg.data;
});

on("settingsData", (msg: any) => {
  const prev = fullSettings.value;
  fullSettings.value = msg.data;

  const yoloNow = msg.data?.["permissions.yoloMode"];
  const yoloBefore = prev?.["permissions.yoloMode"];
  if (yoloNow && !yoloBefore) {
    pushNotice(
      "YOLO Mode Active",
      "All tool requests will be auto-approved. Danger!",
    );
  }
});

on("permissionsData", (msg: any) => {
  permissionsData.value = msg.data;
});
