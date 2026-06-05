import { signal } from "@preact/signals";
import { on } from "../vscode";
import { pushNotice } from "./messages";

export interface FullSettings {
  "thinking.intensity": string;
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
}

export const fullSettings = signal<FullSettings | null>(null);
export const permissionsData = signal<PermissionsData>({ alwaysAllow: {} });
export const detectedTerminals = signal<{ terminals: string[]; platform: string } | null>(null);
export const modelConfig = signal<ModelConfig | null>(null);
// Dynamic model list from the initialize handshake, plus the selected value.
export const modelList = signal<ModelOption[]>([]);
export const selectedModel = signal<string | undefined>(undefined);

on("modelConfig", (msg) => {
  modelConfig.value = msg.data;
});

on("modelList", (msg: any) => {
  modelList.value = Array.isArray(msg.data?.models) ? msg.data.models : [];
  if (msg.data?.selected) selectedModel.value = msg.data.selected;
});

on("modelSet", (msg: any) => {
  if (msg.data?.ok) {
    selectedModel.value = msg.data.model;
  } else {
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
