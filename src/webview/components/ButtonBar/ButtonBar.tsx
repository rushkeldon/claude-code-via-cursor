import "./ButtonBar.less";
import { post, on } from "../../vscode";
import { signal } from "@preact/signals";
import { historyVisible } from "../ConversationHistory/ConversationHistory";
import { settingsModalVisible } from "../SettingsModal/SettingsModal";
import { fullSettings } from "../../state/settings";
import { pushNotice } from "../../state/messages";

function blurAfter(fn: () => void) {
  return (e: MouseEvent) => { fn(); (e.currentTarget as HTMLElement).blur(); };
}

export function ButtonBar() {
  function toggleHistory() {
    historyVisible.value = !historyVisible.value;
    if (historyVisible.value) {
      post({ type: "getConversationList" } as any);
    }
  }

  function toggleSettings() {
    settingsModalVisible.value = !settingsModalVisible.value;
    if (settingsModalVisible.value) {
      post({ type: "getSettings" });
      post({ type: "getPermissions" });
    }
  }

  const yoloActive = fullSettings.value?.['permissions.yoloMode'] || false;

  function toggleYolo() {
    const newValue = !yoloActive;
    post({ type: 'updateSettings', settings: { 'permissions.yoloMode': newValue } });
    if (!newValue) {
      pushNotice('YOLO Mode Off', 'Permission checks are now active.', 'success');
    }
  }

  return (
    <div class="button-bar">
      <button
        class={`btn-header btn-yolo${yoloActive ? ' btn-yolo--active' : ''}`}
        type="button"
        title={yoloActive ? 'YOLO Mode ON — click to disable' : 'Enable YOLO Mode'}
        onClick={blurAfter(toggleYolo)}
      />
      <button
        class="btn-header btn-settings"
        type="button"
        title="Settings"
        onClick={blurAfter(toggleSettings)}
      />
      <button
        class="btn-header btn-history"
        type="button"
        title="History"
        onClick={blurAfter(toggleHistory)}
      />
      <button
        class="btn-header btn-new"
        type="button"
        title="New Chat"
        onClick={blurAfter(() => post({ type: "newSession" }))}
      />
    </div>
  );
}
