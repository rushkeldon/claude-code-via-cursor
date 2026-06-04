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

export const fullSettings = signal<FullSettings | null>(null);
export const permissionsData = signal<PermissionsData>({ alwaysAllow: {} });
export const detectedTerminals = signal<{ terminals: string[]; platform: string } | null>(null);

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
