import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { log } from "./logger";
import * as tokenCounters from "./tokenCounters";
import * as profile from "./profile";
import * as terminalCommands from "./terminalCommands";
import * as settings from "./settings";
import * as backupRepo from "./backupRepo";
import * as conversation from "./conversation";
import * as permissions from "./permissions";
import * as skillsAndPlugins from "./skillsAndPlugins";
import * as subprocess from "./subprocess";
import * as sessionLock from "./sessionLock";

type PostMessageFn = (message: any) => void;

interface WebviewDeps {
  extensionUri: vscode.Uri;
  getStoragePath: () => string | undefined;
  getGlobalState: () => vscode.Memento;
  getGlobalStoragePath: () => string;
  getPackageVersion: () => string | undefined;
}

let deps: WebviewDeps | undefined;
let panel: vscode.WebviewPanel | undefined;
let webview: vscode.Webview | undefined;
let webviewView: vscode.WebviewView | undefined;
let disposables: vscode.Disposable[] = [];
let messageHandlerDisposable: vscode.Disposable | undefined;
let draftMessage: string = "";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const diffContentStore = new Map<string, string>();

export function init(d: WebviewDeps): void {
  log.info("Webview", "init", { hasExtensionUri: !!d.extensionUri }, "🔧");
  deps = d;
}

export function getPanel(): vscode.WebviewPanel | undefined {
  return panel;
}

export function setPanel(p: vscode.WebviewPanel | undefined): void {
  panel = p;
}

export function postMessage(message: any): void {
  if (panel && panel.webview) {
    panel.webview.postMessage(message);
  } else if (webview) {
    webview.postMessage(message);
  }
}

export function getDiffContentStore(): Map<string, string> {
  return diffContentStore;
}

export function show(
  column: vscode.ViewColumn | vscode.Uri = vscode.ViewColumn.Two,
): void {
  log.debug(
    "Webview",
    "enter show",
    { column: column instanceof vscode.Uri ? "Uri" : column },
    "➡️",
  );
  if (!deps) {
    return;
  }

  const actualColumn =
    column instanceof vscode.Uri ? vscode.ViewColumn.Two : column;

  closeSidebar();

  if (panel) {
    panel.reveal(actualColumn);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "claudeChat",
    "Claude Code via Cursor",
    actualColumn,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [deps.extensionUri],
    },
  );

  const iconPath = vscode.Uri.joinPath(deps.extensionUri, "icon-bubble.png");
  panel.iconPath = iconPath;

  panel.webview.html = getHtmlForWebview(panel.webview);

  panel.onDidDispose(() => dispose(), null, disposables);

  setupWebviewMessageHandler(panel.webview);
  permissions.initializePermissions();

  const latestConversation = conversation.getLatestConversation();
  conversation.setCurrentSessionId(latestConversation?.sessionId);

  if (latestConversation) {
    loadConversationHistory(latestConversation.filename);
  }

  setTimeout(() => {
    if (!latestConversation) {
      sendReadyMessage();
    }
  }, 100);
}

export function showInWebview(
  wv: vscode.Webview,
  wvView?: vscode.WebviewView,
): void {
  log.debug("Webview", "enter showInWebview", { hasWvView: !!wvView }, "➡️");
  if (panel) {
    panel.dispose();
    panel = undefined;
  }

  webview = wv;
  webviewView = wvView;
  webview.html = getHtmlForWebview(wv);

  setupWebviewMessageHandler(webview);
  permissions.initializePermissions();

  initializeWebview();
}

export function reinitializeWebview(): void {
  if (webview) {
    permissions.initializePermissions();
    initializeWebview();
    setupWebviewMessageHandler(webview);
  }
}

export async function loadConversation(filename: string): Promise<void> {
  // The user is deliberately pausing the current session to switch conversations;
  // the resulting turn-abort should read as a friendly notice, not a red error.
  subprocess.markUserPaused("history");
  await subprocess.killProcess();
  await loadConversationHistory(filename);
}

export async function newSession(): Promise<void> {
  log.info("Webview", "enter newSession", undefined, "➡️");
  // Deliberate pause via the + button — downgrade the abort error to a notice.
  subprocess.markUserPaused("new-session");
  await subprocess.killProcess();

  conversation.setCurrentSessionId(undefined);

  backupRepo.resetCommits();
  conversation.newSession();

  tokenCounters.resetTotals();

  postMessage({
    type: "newSession",
  });

  postMessage({
    type: "setProcessing",
    data: { isProcessing: false },
  });

  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  if (config.get<boolean>("permissions.yoloMode", false)) {
    conversation.sendAndSaveMessage({
      type: "notice",
      data: {
        title: "YOLO Mode Active",
        content: "All permissions are being auto-approved.",
        variant: "warning",
      },
    });
  }
}

export function newSessionOnConfigChange(): void {
  log.info("Webview", "newSessionOnConfigChange", undefined, "⚙️");
  newSession();

  vscode.window.showInformationMessage(
    "WSL configuration changed. Started a new Claude session.",
    "OK",
  );

  conversation.sendAndSaveMessage({
    type: "configChanged",
    data: "⚙️ WSL configuration changed. Started a new session.",
  });
}

export function forceShutdown(): void {
  log.info("Webview", "forceShutdown", undefined, "🛑");
  subprocess.forceShutdown();
}

export class ClaudeChatWebviewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    wvView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    wvView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    showInWebview(wvView.webview, wvView);

    wvView.onDidChangeVisibility(() => {
      if (wvView.visible) {
        if (panel) {
          panel.dispose();
          panel = undefined;
        }
        reinitializeWebview();
      }
    });
  }
}

function closeSidebar(): void {
  if (webviewView) {
    vscode.commands.executeCommand("workbench.view.explorer");
  }
}

function initializeWebview(): void {
  const latestConversation = conversation.getLatestConversation();
  conversation.setCurrentSessionId(latestConversation?.sessionId);

  if (latestConversation) {
    loadConversationHistory(latestConversation.filename);
  } else {
    setTimeout(() => {
      sendReadyMessage();
    }, 100);
  }

  fetchCommandList();
  // checkFirstRun() is no longer called here — it ran before the webview's
  // message listeners were mounted, so firstRunPrompt was dropped. It's now
  // triggered by the `webviewReady` message the webview posts on mount.
}

function checkFirstRun(): void {
  if (!deps) return;
  const globalState = deps.getGlobalState();
  const config = vscode.workspace.getConfiguration("claudeCodeChat");

  const settingShown = config.get<boolean>("firstRun.hasShown", false);
  if (settingShown && globalState.get("hasShownFirstRun")) return;

  if (!settingShown) {
    globalState.update("hasShownFirstRun", false);
  }

  if (globalState.get("hasShownFirstRun")) return;

  const homedir = os.homedir();
  const installedPluginsPath = path.join(homedir, ".claude", "plugins", "installed_plugins.json");
  let modesInstalled = false;
  let plan2cursorInstalled = false;

  try {
    if (fs.existsSync(installedPluginsPath)) {
      const data = JSON.parse(fs.readFileSync(installedPluginsPath, "utf8"));
      const plugins = data?.plugins || {};
      modesInstalled = !!(plugins["modes@skills-anthropic"] && plugins["modes@skills-anthropic"].length > 0);
      plan2cursorInstalled = !!(plugins["plan2cursor@skills-anthropic"] && plugins["plan2cursor@skills-anthropic"].length > 0);
    }
  } catch {
    // ignore parse errors
  }

  // Fire-and-forget: do NOT mark "shown" here. The webview posts `firstRunShown`
  // once the modal actually renders; markFirstRunShown() latches the flags then.
  // Latching here would lie if the prompt is dropped (e.g. posted before the
  // webview's listeners mount) and permanently suppress first-run.
  postMessage({
    type: "firstRunPrompt",
    data: { modesInstalled, plan2cursorInstalled },
  });
}

// Probes the OS for installed terminal emulators. Returned names must match the
// substrings getTerminalLaunchCommand() keys on, so detection and launching stay
// in sync. Never throws — a failed probe just means "not found".
function detectTerminals(): void {
  const platform = process.platform;
  const found: string[] = [];

  const hasCmd = (cmd: string): boolean => {
    try {
      cp.execFileSync(platform === "win32" ? "where" : "which", [cmd], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };

  if (platform === "darwin") {
    const app = (name: string) =>
      fs.existsSync(`/Applications/${name}`) ||
      fs.existsSync(path.join(os.homedir(), "Applications", name));
    if (
      fs.existsSync("/System/Applications/Utilities/Terminal.app") ||
      fs.existsSync("/Applications/Utilities/Terminal.app")
    ) {
      found.push("Terminal.app");
    }
    if (app("iTerm.app")) found.push("iTerm2");
    if (app("Ghostty.app")) found.push("Ghostty");
    if (app("Warp.app")) found.push("Warp");
    if (hasCmd("kitty")) found.push("kitty");
    if (hasCmd("alacritty")) found.push("alacritty");
  } else if (platform === "win32") {
    if (hasCmd("wt")) found.push("Windows Terminal");
    if (hasCmd("pwsh")) found.push("PowerShell");
    else if (hasCmd("powershell")) found.push("PowerShell");
    found.push("cmd");
  } else {
    for (const c of ["kitty", "alacritty", "gnome-terminal", "konsole", "xterm"]) {
      if (hasCmd(c)) found.push(c);
    }
  }

  postMessage({
    type: "detectedTerminals",
    data: { terminals: found, platform },
  });
}

function markFirstRunShown(): void {
  if (!deps) return;
  deps.getGlobalState().update("hasShownFirstRun", true);
  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  config.update("firstRun.hasShown", true, vscode.ConfigurationTarget.Global);
}

function setupWebviewMessageHandler(wv: vscode.Webview): void {
  if (messageHandlerDisposable) {
    messageHandlerDisposable.dispose();
  }

  messageHandlerDisposable = wv.onDidReceiveMessage(
    (message) => handleWebviewMessage(message),
    null,
    disposables,
  );
}

function sendReadyMessage(): void {
  postMessage({
    type: "ready",
    data: subprocess.isActive()
      ? "Claude is working..."
      : "Ready to chat with Claude Code! Type your message below.",
  });

  settings.sendModelConfig();

  sendPlatformInfo();
  settings.sendCurrentSettings();

  if (draftMessage) {
    postMessage({
      type: "restoreInputText",
      data: draftMessage,
    });
  }
}

async function handleWebviewMessage(message: any): Promise<void> {
  if (!deps) {
    return;
  }

  const text = typeof message?.text === "string" ? message.text : undefined;
  const textSnippet =
    text && text.length > 120 ? text.slice(0, 120) + "…" : text;
  log.debug(
    "Webview",
    "handleWebviewMessage",
    {
      type: message?.type,
      textLen: text?.length,
      text: textSnippet,
      imageCount: Array.isArray(message?.images)
        ? message.images.length
        : undefined,
      messageIndex: message?.messageIndex,
    },
    "📨",
  );
  switch (message.type) {
    case "sendMessage":
      subprocess.sendMessage(
        message.text,
        message.planMode,
        message.images,
      );
      return;
    case "newSession":
      newSession();
      return;
    case "restoreCommit":
      await backupRepo.restoreToCommit(message.commitSha);
      return;
    case "getConversationList":
      conversation.sendConversationList();
      // Also surface which sessions are locked by another live window so the
      // History list can badge them and offer Fork instead of resume.
      postMessage({ type: "lockedSessions", data: { sessionIds: sessionLock.lockedSessionIds() } });
      return;
    case "deleteConversation":
      await conversation.deleteConversation(message.filename);
      return;
    case "getWorkspaceFiles":
      await sendWorkspaceFiles(message.searchTerm);
      return;
    case "selectImageFile":
      await selectImageFile();
      return;
    case "selectFile":
      await selectAnyFile();
      return;
    case "handleDroppedUris":
      await handleDroppedUris(message.uris);
      return;
    case "fetchCommandList":
      fetchCommandList();
      return;
    case "launchSlashCommand":
      await launchSlashCommand(message.command, message.forceExternal);
      return;
    case "installRecommendedSkills":
      installRecommendedSkills();
      return;
    case "checkSkillsInstalled":
      checkSkillsInstalled();
      return;
    case "webviewReady":
      // The webview has mounted and its listeners are live — now it's safe to
      // post messages that have no second source (e.g. firstRunPrompt).
      checkFirstRun();
      // Resync the queued-prompt card after a (re)mount — its only other emit
      // sites are queue mutations, which a fresh webview would have missed.
      subprocess.emitQueueState();
      return;
    case "firstRunShown":
      // The first-run modal actually rendered; latch the flags so it shows once.
      markFirstRunShown();
      return;
    case "getDetectedTerminals":
      detectTerminals();
      return;
    case "resetFirstRun": {
      const globalState = deps.getGlobalState();
      globalState.update("hasShownFirstRun", false);
      const config = vscode.workspace.getConfiguration("claudeCodeChat");
      config.update("firstRun.hasShown", false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("First-run experience will show on next launch.");
      return;
    }
    case "handleDroppedFile":
      await handleDroppedFileByName(message.fileName, message.contents);
      return;
    case "loadConversation":
      await loadConversation(message.filename);
      return;
    case "stopRequest":
    case "stop":
      // Graceful stop: interrupt the turn, keep the process warm.
      subprocess.stopProcess();
      return;
    case "skull":
      // Hard kill: terminate the process group and park to history.
      await subprocess.skullProcess();
      return;
    case "sendNow":
      // Explicit interrupt + flush the head queued item now (the card's ⬆).
      await subprocess.sendNow();
      return;
    case "cancelQueued":
      // Remove a queued item by id (the card's ✕).
      subprocess.cancelQueued(message.id);
      return;
    case "demoteQueued":
      // Pull a queued item back into the prompt input (the card's ⬇).
      subprocess.demoteQueued(message.id);
      return;
    case "forkSession":
      // Fork a (possibly locked) session into a new terminal session this
      // window owns — the escape hatch for a session active in another window.
      forkSessionToTerminal(message.sessionId ?? conversation.getCurrentSessionId());
      return;
    case "openFile":
      try {
        const doc = await vscode.workspace.openTextDocument(message.filePath);
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        log.error("Webview", "openFile failed", { filePath: message.filePath, error: err?.message ?? String(err) }, "💥");
      }
      return;
    case "copyToClipboard":
      await vscode.env.clipboard.writeText(message.text || "");
      return;
    case "getSettings":
      settings.sendCurrentSettings();
      return;
    case "getEnvVars": {
      const evConfig = vscode.workspace.getConfiguration("claudeCodeChat");
      const evVars = evConfig.get<Record<string, string>>(
        "environment.variables",
        {},
      );
      postMessage({ type: "envVarsData", data: evVars });
      return;
    }
    case "setEnvsDisabled":
      await settings.setEnvsDisabled(!!message.disabled);
      return;
    case "updateSettings":
      await settings.updateSettings(message.settings);
      return;
    case "getClipboardText":
      await getClipboardText();
      return;
    case "selectModel":
      await settings.setSelectedModel(message.model, message.tierModels);
      return;
    case "setModel":
      await settings.setLocalModel(message.model);
      return;
    case "setModelInband":
      // Runtime model switch via the control protocol (no settings-file dance).
      // Falls back to recording-only if no process is live yet.
      await subprocess.setModel(message.model);
      return;
    case "getModelConfig":
      settings.sendModelConfig();
      return;
    case "getModelList":
      // Replay the dynamic model list captured at the initialize handshake.
      // (Empty until the first spawn completes its handshake.)
      subprocess.postModelList();
      return;
    case "getThoughtControlConfig":
      settings.sendThoughtControlConfig();
      return;
    case "setThoughtsDisplay":
      // Persist the Thoughts visibility pref. The change re-injects via --settings
      // on the next turn's (re)spawn (subprocess compares the thinking signature) —
      // i.e. "applies next turn", no idle-process kill.
      settings.setThoughtsOn(message.on);
      settings.sendThoughtControlConfig();
      return;
    case "setEffort":
      // Persist the Effort pref; same next-turn re-injection as above.
      settings.setEffort(message.level);
      settings.sendThoughtControlConfig();
      return;
    case "openModelTerminal":
      terminalCommands.openModelTerminal(
        conversation.getCurrentSessionId(),
        postMessage,
      );
      return;
    case "viewUsage":
      terminalCommands.openUsageTerminal();
      return;
    case "executeSlashCommand":
      terminalCommands.executeSlashCommand(
        message.command,
        conversation.getCurrentSessionId(),
        postMessage,
        (text) => subprocess.sendMessage(text),
      );
      return;
    case "dismissWSLAlert":
      deps.getGlobalState().update("wslAlertDismissed", true);
      return;
    case "runInstallCommand":
      await terminalCommands.runInstallCommand(
        message.method || "installer",
        deps.getGlobalStoragePath(),
        postMessage,
        deps.getGlobalState(),
      );
      return;
    case "openLoginTerminal":
      terminalCommands.openLoginTerminal();
      return;
    case "saveCustomProvider":
      if (message.envVars) {
        const cpConfig = vscode.workspace.getConfiguration("claudeCodeChat");
        const cpEnvVars = cpConfig.get<Record<string, string>>(
          "environment.variables",
          {},
        );
        Object.assign(cpEnvVars, message.envVars);
        cpConfig
          .update(
            "environment.variables",
            cpEnvVars,
            vscode.ConfigurationTarget.Global,
          )
          .then(
            () => {
              postMessage({ type: "customProviderSaved" });
            },
            (err: Error) => {
              log.error(
                "Webview",
                "failed to save custom provider",
                { error: err?.message ?? String(err) },
                "💥",
              );
            },
          );
      }
      return;
    case "copyToClipboard":
      if (message.text) {
        vscode.env.clipboard.writeText(message.text);
      }
      return;
    case "openExternalUrl": {
      const extUrl = message.url;
      try {
        if (process.platform === "win32") {
          cp.exec(`start "" "${extUrl}"`, { windowsHide: true });
        } else {
          const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
          const proc = cp.spawn(openCmd, [extUrl], {
            detached: true,
            stdio: "ignore",
          });
          proc.on("error", () => {
            vscode.env.openExternal(vscode.Uri.parse(extUrl));
          });
          proc.unref();
        }
      } catch {
        vscode.env.openExternal(vscode.Uri.parse(extUrl));
      }
      return;
    }
    case "openFile":
      await openFileInEditor(message.filePath);
      return;
    case "requestIdentityProfile":
      profile.readAndPushProfile();
      return;
    case "openProfileSwitcher": {
      const term = vscode.window.createTerminal({ name: "Claude Profile" });
      term.show();
      const target =
        typeof message.target === "string" && message.target.length > 0
          ? " " + message.target
          : " ";
      term.sendText("setClaudeTo" + target, false);
      return;
    }
    case "reloadWindow":
      vscode.commands.executeCommand("workbench.action.reloadWindow");
      return;
    case "openImageFile":
      if (message.filePath) {
        try {
          vscode.commands.executeCommand(
            "vscode.open",
            vscode.Uri.file(message.filePath),
          );
        } catch (e: any) {
          log.error(
            "Webview",
            "failed to open image file",
            { filePath: message.filePath, error: e?.message ?? String(e) },
            "💥",
          );
        }
      }
      return;
    case "openDiff":
      await openDiffEditor(
        message.oldContent,
        message.newContent,
        message.filePath,
      );
      return;
    case "openDiffByIndex":
      await openDiffByMessageIndex(message.messageIndex);
      return;
    case "createImageFile":
      await createImageFile(
        message.imageData,
        message.imageType,
        message.thumbnailData,
        message.originalName,
      );
      return;
    case "openImageFile":
      if (message.filePath) {
        vscode.commands.executeCommand(
          "vscode.open",
          vscode.Uri.file(message.filePath),
        );
      }
      return;
    case "permissionResponse":
      permissions.handlePermissionResponse(
        message.id,
        message.approved,
        message.alwaysAllow,
      );
      return;
    case "askUserQuestionResponse":
      permissions.handleAskUserQuestionResponse(message.id, message.answers, message.cancelled);
      return;
    case "showInfoMessage":
      vscode.window.showInformationMessage(message.message);
      return;
    case "marketplaceFetch":
      await skillsAndPlugins.fetchMarketplace(
        message.url,
        message.append,
        message.isSearch,
      );
      return;
    case "getPermissions":
      await permissions.sendPermissions();
      return;
    case "removePermission":
      await permissions.removePermission(message.toolName, message.command);
      return;
    case "addPermission":
      await permissions.addPermission(message.toolName, message.command);
      return;
    case "loadSkills":
      await skillsAndPlugins.loadSkills();
      return;
    case "saveSkill":
      await skillsAndPlugins.saveSkill(
        message.name,
        message.scope,
        message.content,
      );
      return;
    case "deleteSkill":
      await skillsAndPlugins.deleteSkill(message.name, message.scope);
      return;
    case "searchSkills":
      await skillsAndPlugins.searchSkills(message.query);
      return;
    case "runTerminalCommand":
      terminalCommands.runTerminalCommand(message.command);
      return;
    case "loadPlugins":
      await skillsAndPlugins.loadPlugins();
      return;
    case "installPlugin":
      await skillsAndPlugins.installPlugin(message.installId);
      return;
    case "removePlugin":
      await skillsAndPlugins.removePlugin(message.installId);
      return;
    case "loadMCPServers":
      await skillsAndPlugins.loadMCPServers();
      return;
    case "saveMCPServer":
      await skillsAndPlugins.saveMCPServer(
        message.name,
        message.config,
        message.scope || "project",
      );
      return;
    case "deleteMCPServer":
      await skillsAndPlugins.deleteMCPServer(
        message.name,
        message.scope || "project",
      );
      return;
    case "getCustomSnippets":
      await settings.sendCustomSnippets(deps.getGlobalState());
      return;
    case "saveCustomSnippet":
      await settings.saveCustomSnippet(message.snippet, deps.getGlobalState());
      return;
    case "deleteCustomSnippet":
      await settings.deleteCustomSnippet(
        message.snippetId,
        deps.getGlobalState(),
      );
      return;
    case "enableYoloMode":
      await terminalCommands.enableYoloMode(postMessage, () =>
        settings.sendCurrentSettings(),
      );
      return;
    case "saveInputText":
      draftMessage = message.text || "";
      return;
  }
}

function getHtmlForWebview(wv?: vscode.Webview): string {
  if (!deps) {
    return "";
  }
  const target = wv || webview || panel?.webview;
  if (!target) {
    return "";
  }
  const jsUri = target.asWebviewUri(
    vscode.Uri.joinPath(deps.extensionUri, "out", "webview", "main.js"),
  );
  const cssUri = target.asWebviewUri(
    vscode.Uri.joinPath(deps.extensionUri, "out", "webview", "main.css"),
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${target.cspSource} 'unsafe-inline'; script-src ${target.cspSource}; img-src ${target.cspSource} data: https:;">
  <link rel="stylesheet" href="${cssUri}">
  <title>Claude Code via Cursor</title>
</head>
<body>
  <div id="root"></div>
  <script src="${jsUri}"></script>
</body>
</html>`;
}

function sendPlatformInfo(): void {
  if (!deps) {
    return;
  }
  const platform = process.platform;
  const dismissed = deps
    .getGlobalState()
    .get<boolean>("wslAlertDismissed", false);
  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  const wslEnabled = config.get<boolean>("wsl.enabled", false);

  postMessage({
    type: "platformInfo",
    data: {
      platform: platform,
      isWindows: platform === "win32",
      wslAlertDismissed: dismissed,
      wslEnabled: wslEnabled,
    },
  });
}

async function getClipboardText(): Promise<void> {
  try {
    const text = await vscode.env.clipboard.readText();
    postMessage({
      type: "clipboardText",
      data: text,
    });
  } catch (error: any) {
    log.error(
      "Webview",
      "failed to read clipboard",
      { error: error?.message ?? String(error) },
      "💥",
    );
  }
}

async function getImageDataUri(filePath: string): Promise<string | undefined> {
  try {
    const imageData = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath),
    );
    const base64 = Buffer.from(imageData).toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    return `data:${IMAGE_MEDIA_TYPES[ext] || "image/png"};base64,${base64}`;
  } catch {
    return undefined;
  }
}

async function sendWorkspaceFiles(searchTerm?: string): Promise<void> {
  log.debug("Webview", "enter sendWorkspaceFiles", { searchTerm }, "➡️");
  try {
    const files = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/.nuxt/**,**/target/**,**/bin/**,**/obj/**}",
      500,
    );

    let fileList = files.map((file) => {
      const relativePath = vscode.workspace.asRelativePath(file);
      return {
        name: file.path.split("/").pop() || "",
        path: relativePath,
        fsPath: file.fsPath,
      };
    });

    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      fileList = fileList.filter((file) => {
        const fileName = file.name.toLowerCase();
        const filePath = file.path.toLowerCase();
        return (
          fileName.includes(term) ||
          filePath.includes(term) ||
          filePath.split("/").some((segment) => segment.includes(term))
        );
      });
    }

    fileList = fileList
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);

    postMessage({
      type: "workspaceFiles",
      data: fileList,
    });
  } catch (error: any) {
    log.error(
      "Webview",
      "sendWorkspaceFiles failed",
      { error: error?.message ?? String(error) },
      "💥",
    );
    postMessage({
      type: "workspaceFiles",
      data: [],
    });
  }
}

async function selectImageFile(): Promise<void> {
  log.debug("Webview", "enter selectImageFile", undefined, "➡️");
  try {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      title: "Select image files",
      filters: {
        Images: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"],
      },
    });

    if (result && result.length > 0) {
      for (const uri of result) {
        const dataUri = await getImageDataUri(uri.fsPath);
        if (dataUri) {
          postMessage({
            type: "imageAttached",
            filePath: uri.fsPath,
            previewUri: dataUri,
          });
        }
      }
    }
  } catch (error: any) {
    log.error(
      "Webview",
      "selectImageFile failed",
      { error: error?.message ?? String(error) },
      "💥",
    );
  }
}

async function selectAnyFile(): Promise<void> {
  try {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      title: "Select files to attach",
    });

    if (result && result.length > 0) {
      const uris = result.map((uri) => `file://${uri.fsPath}`);
      await handleDroppedUris(uris);
    }
  } catch (error: any) {
    log.error(
      "Webview",
      "selectAnyFile failed",
      { error: error?.message ?? String(error) },
      "💥",
    );
  }
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".css": "css",
  ".less": "less",
  ".scss": "scss",
  ".html": "html",
  ".xml": "xml",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".sql": "sql",
  ".md": "markdown",
  ".txt": "plaintext",
  ".rb": "ruby",
  ".php": "php",
  ".kt": "kotlin",
  ".ipynb": "json",
  ".pdf": "pdf",
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

async function handleDroppedUris(uris: string[]): Promise<void> {
  for (const uri of uris) {
    try {
      const filePath = decodeURIComponent(uri.replace("file://", ""));
      const ext = path.extname(filePath).toLowerCase();

      if (IMAGE_EXTENSIONS.has(ext)) {
        const dataUri = await getImageDataUri(filePath);
        if (dataUri) {
          postMessage({ type: "imageAttached", filePath, previewUri: dataUri });
        }
      } else if (EXT_TO_LANGUAGE[ext]) {
        const fileData = await vscode.workspace.fs.readFile(
          vscode.Uri.file(filePath),
        );
        const contents = Buffer.from(fileData).toString("utf8");
        const language = EXT_TO_LANGUAGE[ext] || "plaintext";
        const relativePath = vscode.workspace.asRelativePath(filePath);
        postMessage({
          type: "fileDropped",
          data: { filePath: relativePath, contents, language },
        });
      } else {
        postMessage({
          type: "dropUnsupported",
          data: { filePath, reason: "Unsupported file type" },
        });
      }
    } catch (error: any) {
      log.error(
        "Webview",
        "handleDroppedUris failed for uri",
        { uri, error: error?.message ?? String(error) },
        "💥",
      );
    }
  }
}

async function handleDroppedFileByName(
  fileName: string,
  contents: string,
): Promise<void> {
  const ext = path.extname(fileName).toLowerCase();
  const language = EXT_TO_LANGUAGE[ext] || "plaintext";
  postMessage({
    type: "fileDropped",
    data: { filePath: fileName, contents, language },
  });
}

function fetchCommandList(): void {
  log.debug("Webview", "fetchCommandList", undefined, "➡️");

  // Serve the authoritative initialize-handshake list. It's free (no model
  // turn), fast, and already filtered to the commands that work in this
  // (headless) session. The list is cached from the most recent handshake; if
  // the panel is cold (no handshake yet) it arrives unprompted via
  // subprocess.postCommandList() once performInitialize() resolves.
  const cmds = subprocess.getCachedCommands();
  if (cmds && cmds.length > 0) {
    postMessage({ type: "commandList", data: cmds });
    return;
  }
  // No handshake yet — post an empty list so the palette renders, then the
  // real list lands when the subprocess finishes initializing.
  postMessage({ type: "commandList", data: [] });
}

// Fork an explicit session id into a new terminal session (the History "Fork"
// affordance for a session locked by another window). Uses --fork-session so the
// original transcript is untouched and the fork gets a brand-new id this window
// owns. No idle gate here: the forked session is a different process entirely,
// and the locked session is owned by another window anyway.
function forkSessionToTerminal(sessionId: string | undefined): void {
  if (!sessionId) {
    vscode.window.showWarningMessage("No session to fork.");
    return;
  }
  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  const yoloMode = config.get<boolean>("permissions.yoloMode", false);
  const yoloFlag = yoloMode ? "--dangerously-skip-permissions" : "";
  const forkModel = settings.getLocalModel() || settings.getFullModelString().configured;

  const args = ["--resume", sessionId, "--fork-session"];
  if (forkModel) args.push("--model", forkModel);
  if (yoloFlag) args.push(yoloFlag);

  const terminal = vscode.window.createTerminal({
    name: `Claude fork`,
    location: { viewColumn: vscode.ViewColumn.One },
    ...terminalCommands.buildClaudeTerminalOptions(args),
  });
  terminal.show();
  log.info("Webview", "forked session to terminal", { sessionId, forkModel }, "🍴");
}

// Breakout to a real terminal. Typed slash commands no longer route here —
// they pass straight through to the warm subprocess via sendMessage. This is
// reached only by the explicit toolbar breakout button (an on-demand fork) and
// always forks: `--resume <id> --fork-session` copies the transcript into a new
// session id, leaving the extension's session as the sole writer of its own.
async function launchSlashCommand(
  command: string,
  forceExternal?: boolean,
): Promise<void> {
  log.debug("Webview", "launchSlashCommand", { command, forceExternal }, "➡️");

  const sessionId = conversation.getCurrentSessionId();

  // Breakout = FORK. `--resume <id> --fork-session` copies the transcript so far
  // into a NEW session id, leaving the extension's session untouched — so the
  // extension stays the sole writer of its own transcript (plain --resume/
  // --continue would attach a second writer and interleave-corrupt the file).
  // Gate on idle: the on-disk transcript the fork copies must be complete, so we
  // refuse to fork while a turn is in flight.
  if (sessionId && subprocess.isActive()) {
    vscode.window.showWarningMessage(
      "Can't open a terminal fork while Claude is working — wait for the current turn to finish.",
    );
    return;
  }

  const fullCommand = command.trim()
    ? command.startsWith("/")
      ? command
      : `/${command}`
    : "";
  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  const useIntegrated = config.get<boolean>("terminal.useIntegrated", true);

  // Carry the extension's current YOLO mode into the breakaway terminal session
  // so the forked session picks up the same permission posture as the in-process
  // subprocess (which adds the same flag in subprocess.ts when yoloMode is set).
  const yoloMode = config.get<boolean>("permissions.yoloMode", false);
  const yoloFlag = yoloMode ? "--dangerously-skip-permissions" : "";

  // --model parity: launch the forked terminal on the same model the extension
  // is using, so the forked world matches. settings.local.json / global default
  // already steer a plain `claude`, but pass it explicitly for the fork.
  const forkModel = settings.getLocalModel() || settings.getFullModelString().configured;

  if (useIntegrated) {
    const args: string[] = [];
    if (fullCommand) args.push(fullCommand);
    if (sessionId) {
      args.push("--resume", sessionId, "--fork-session");
      if (forkModel) args.push("--model", forkModel);
    }
    if (yoloFlag) args.push(yoloFlag);
    const terminal = vscode.window.createTerminal({
      name: `Claude fork ${fullCommand}`.trim(),
      location: { viewColumn: vscode.ViewColumn.One },
      ...terminalCommands.buildClaudeTerminalOptions(args),
    });
    terminal.show();
  } else {
    const externalApp = config.get<string>("terminal.externalApp", "");
    const customTemplate = config.get<string>("terminal.customTemplate", "");
    const workspaceCwd =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const yoloArg = yoloFlag ? ` ${yoloFlag}` : "";
    // Only append the positional prompt when there actually is one. An empty
    // breakout (the "open in external terminal" button) must launch a plain
    // interactive session — passing an empty "" makes the CLI treat it as a
    // one-shot print prompt and exit immediately instead of starting a session.
    const forkArg = sessionId ? ` --resume ${sessionId} --fork-session` : "";
    const modelArg = sessionId && forkModel ? ` --model ${forkModel}` : "";
    const promptArg = fullCommand ? ` "${fullCommand}"` : "";
    const claudeCmd = `claude${yoloArg}${forkArg}${modelArg}${promptArg}`;

    let launchCmd = "";
    if (customTemplate) {
      launchCmd = customTemplate.replace(/\{\{command\}\}/g, claudeCmd);
    } else if (externalApp) {
      launchCmd = getTerminalLaunchCommand(externalApp, claudeCmd, workspaceCwd);
    } else {
      const forkArgs = sessionId
        ? [fullCommand, "--resume", sessionId, "--fork-session", ...(forkModel ? ["--model", forkModel] : [])]
        : [fullCommand];
      const terminal = vscode.window.createTerminal({
        name: `Claude fork ${fullCommand}`.trim(),
        location: { viewColumn: vscode.ViewColumn.One },
        ...terminalCommands.buildClaudeTerminalOptions(forkArgs),
      });
      terminal.show();
      return;
    }

    if (launchCmd) {
      log.debug("Webview", "external launchCmd", { launchCmd }, "🚀");
      cp.exec(launchCmd, (error) => {
        if (error) {
          log.error(
            "Webview",
            "external terminal launch failed",
            { error: error.message, launchCmd },
            "💥",
          );
          vscode.window.showErrorMessage(
            `Failed to launch external terminal: ${error.message}`,
          );
        }
      });
    }
  }
}

function installRecommendedSkills(): void {
  log.debug("Webview", "installRecommendedSkills", undefined, "➡️");
  const config = vscode.workspace.getConfiguration("claudeCodeChat");
  const claudePath =
    (config.get<string>("executable.path", "") || "").trim() || "claude";

  cp.execFile(
    claudePath,
    ["plugin", "marketplace", "add", "rushkeldon/skills-anthropic"],
    { timeout: 30000 },
    (err1) => {
      if (err1) {
        log.error(
          "Webview",
          "marketplace add failed",
          { error: err1.message },
          "💥",
        );
        postMessage({
          type: "skillInstallResult",
          data: { success: false, error: err1.message },
        });
        return;
      }

      cp.execFile(
        claudePath,
        ["plugin", "install", "modes@skills-anthropic", "-s", "user"],
        { timeout: 30000 },
        (err2) => {
          if (err2)
            log.error(
              "Webview",
              "modes install failed",
              { error: err2.message },
              "💥",
            );

          cp.execFile(
            claudePath,
            ["plugin", "install", "plan2cursor@skills-anthropic", "-s", "user"],
            { timeout: 30000 },
            (err3) => {
              if (err3)
                log.error(
                  "Webview",
                  "plan2cursor install failed",
                  { error: err3.message },
                  "💥",
                );

              const success = !err2 && !err3;
              if (success && deps) {
                deps.getGlobalState().update("firstRunComplete", true);
              }
              postMessage({
                type: "skillInstallResult",
                data: { success, error: err2?.message || err3?.message },
              });
              checkSkillsInstalled();
            },
          );
        },
      );
    },
  );
}

function checkSkillsInstalled(): void {
  const homedir = os.homedir();
  const installedPluginsPath = path.join(homedir, ".claude", "plugins", "installed_plugins.json");
  let modesInstalled = false;
  let plan2cursorInstalled = false;

  try {
    if (fs.existsSync(installedPluginsPath)) {
      const data = JSON.parse(fs.readFileSync(installedPluginsPath, "utf8"));
      const plugins = data?.plugins || {};
      modesInstalled = !!(plugins["modes@skills-anthropic"] && plugins["modes@skills-anthropic"].length > 0);
      plan2cursorInstalled = !!(plugins["plan2cursor@skills-anthropic"] && plugins["plan2cursor@skills-anthropic"].length > 0);
    }
  } catch {
    // Fall back to filesystem check
    modesInstalled = fs.existsSync(
      path.join(homedir, ".claude", "skills", "modes", "SKILL.md"),
    );
    plan2cursorInstalled = fs.existsSync(
      path.join(homedir, ".claude", "skills", "plan2cursor", "SKILL.md"),
    );
  }

  postMessage({
    type: "skillsStatus",
    data: { modesInstalled, plan2cursorInstalled },
  });
}

function getTerminalLaunchCommand(
  terminalApp: string,
  command: string,
  cwd?: string,
): string {
  const platform = process.platform;
  // Prepend a cd into the workspace directory so the external terminal starts
  // Claude in the right place (the internal subprocess path passes cwd to spawn,
  // but external terminals inherit VS Code's cwd otherwise). Single-quote the
  // path so it survives the later double-quote escaping for AppleScript/bash -c.
  // The cd command itself is embedded inside an outer `osascript -e '…'` (also
  // single-quoted), so any literal single quote — including the ones we add
  // around the path — must be escaped with the POSIX '\'' idiom or the outer
  // shell parse swallows them, stripping the protective quoting and breaking
  // paths that contain spaces or shell metacharacters.
  // Windows is handled separately below since cmd uses a different cd syntax.
  const quotedCwd = cwd ? `'${cwd.replace(/'/g, `'\\''`)}'` : "";
  const posixWithCd = cwd ? `cd ${quotedCwd} && ${command}` : command;
  const escaped = posixWithCd.replace(/"/g, '\\"');

  if (platform === "darwin") {
    if (terminalApp.includes("iTerm")) {
      // iTerm's scripting application is named "iTerm" (bundle id com.googlecode.iterm2),
      // NOT "iTerm2" — telling "iTerm2" raises -1728. Two further traps, both hit the
      // hard way and verified by reproduction:
      //
      //   1. `create window ... profile` + `write text "<cmd>"` only TYPES the command —
      //      it races the new session's login-shell init (nvm/setNodeVer, etc.) and the
      //      text usually lands at the prompt unsubmitted. `create window ... command`
      //      runs the program directly (no typing, no race).
      //   2. The `command` value otherwise threads FOUR quoting layers: cp.exec's
      //      `/bin/sh -c` → `osascript -e '…'` → AppleScript `"…"` → inner shell. The
      //      workspace path's own single quotes terminate the outer `-e '…'` early and
      //      silently corrupt the command (the bug that left the session at ~).
      //
      // We sidestep ALL of it by writing the cd+claude line to a temp script and pointing
      // iTerm at `/bin/bash <path>`. The AppleScript string then contains only a
      // space-free temp path — nothing for any layer to corrupt — and the command runs
      // for real. `exec $SHELL -l` keeps the session interactive after claude exits.
      const scriptPath = path.join(
        os.tmpdir(),
        `claude-iterm-launch-${process.pid}-${Date.now()}.sh`,
      );
      try {
        fs.writeFileSync(scriptPath, `#!/bin/bash\n${posixWithCd}\nexec $SHELL -l\n`, {
          mode: 0o755,
        });
      } catch (e: any) {
        log.error(
          "Webview",
          "failed to write iTerm launch script",
          { error: e?.message ?? String(e), scriptPath },
          "💥",
        );
      }
      return [
        `osascript`,
        `-e 'tell application "iTerm"'`,
        `-e 'create window with default profile command "/bin/bash ${scriptPath}"'`,
        `-e 'end tell'`,
      ].join(" ");
    }
    if (terminalApp.includes("kitty")) return `kitty -- bash -c "${escaped}"`;
    if (terminalApp.includes("Ghostty"))
      return `ghostty -e bash -c "${escaped}"`;
    if (terminalApp.includes("Warp")) return `open -a Warp --args "${escaped}"`;
    return `osascript -e 'tell app "Terminal" to do script "${escaped}"'`;
  }

  if (platform === "win32") {
    // Windows Terminal sets the directory via -d; others need a `cd /d` prefix.
    const winDir = cwd ? `"${cwd}"` : ".";
    const winEscaped = command.replace(/"/g, '\\"');
    const winCdPrefix = cwd ? `cd /d "${cwd}" && ` : "";
    if (terminalApp.includes("Windows Terminal") || terminalApp.includes("wt"))
      return `wt -d ${winDir} cmd /c "${winEscaped}"`;
    if (terminalApp.includes("PowerShell") || terminalApp.includes("pwsh")) {
      const psPrefix = cwd ? `Set-Location -LiteralPath '${cwd}'; ` : "";
      return `powershell -Command "${psPrefix}${winEscaped}"`;
    }
    return `start cmd /c "${winCdPrefix}${winEscaped}"`;
  }

  if (terminalApp.includes("kitty")) return `kitty -- bash -c "${escaped}"`;
  if (terminalApp.includes("alacritty"))
    return `alacritty -e bash -c "${escaped}"`;
  if (terminalApp.includes("gnome-terminal"))
    return `gnome-terminal -- bash -c "${escaped}"`;
  return `xterm -e bash -c "${escaped}"`;
}

async function openFileInEditor(filePath: string): Promise<void> {
  log.debug("Webview", "enter openFileInEditor", { filePath }, "➡️");
  try {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
    log.error(
      "Webview",
      "openFileInEditor failed",
      { filePath, error: error?.message ?? String(error) },
      "💥",
    );
  }
}

async function openDiffByMessageIndex(messageIndex: number): Promise<void> {
  log.debug("Webview", "enter openDiffByMessageIndex", { messageIndex }, "➡️");
  try {
    const message = conversation.getCurrentConversation()[messageIndex];
    if (!message) {
      log.warn("Webview", "message not found at index", { messageIndex }, "🚫");
      return;
    }

    const data = message.data;
    const toolName = data.toolName;
    const rawInput = data.rawInput;
    let filePath = rawInput?.file_path || "";
    let oldContent = "";
    let newContent = "";

    if (!filePath) {
      log.warn(
        "Webview",
        "no file path found for message",
        { messageIndex },
        "🚫",
      );
      return;
    }

    try {
      const fileUri = vscode.Uri.file(filePath);
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      oldContent = Buffer.from(fileData).toString("utf8");
    } catch {
      oldContent = "";
    }

    if (toolName === "Edit" && rawInput?.old_string && rawInput?.new_string) {
      newContent = oldContent.replace(rawInput.old_string, rawInput.new_string);
    } else if (toolName === "MultiEdit" && rawInput?.edits) {
      newContent = oldContent;
      for (const edit of rawInput.edits) {
        if (edit.old_string && edit.new_string) {
          newContent = newContent.replace(edit.old_string, edit.new_string);
        }
      }
    } else if (toolName === "Write" && rawInput?.content) {
      newContent = rawInput.content;
    }

    if (oldContent !== newContent) {
      await openDiffEditor(oldContent, newContent, filePath);
    } else {
      vscode.window.showInformationMessage(
        "No changes to show - the edit may have already been applied.",
      );
    }
  } catch (error: any) {
    log.error(
      "Webview",
      "openDiffByMessageIndex failed",
      { messageIndex, error: error?.message ?? String(error) },
      "💥",
    );
  }
}

async function openDiffEditor(
  oldContent: string,
  newContent: string,
  filePath: string,
): Promise<void> {
  try {
    const baseName = path.basename(filePath);
    const timestamp = Date.now();

    const oldPath = `/${timestamp}/old/${baseName}`;
    const newPath = `/${timestamp}/new/${baseName}`;

    diffContentStore.set(oldPath, oldContent);
    diffContentStore.set(newPath, newContent);

    const oldUri = vscode.Uri.parse(`claude-diff:${oldPath}`);
    const newUri = vscode.Uri.parse(`claude-diff:${newPath}`);

    const diffConfig = vscode.workspace.getConfiguration("diffEditor");
    const wasInlineMode = diffConfig.get("renderSideBySide") === false;
    if (wasInlineMode) {
      await diffConfig.update(
        "renderSideBySide",
        true,
        vscode.ConfigurationTarget.Global,
      );
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      oldUri,
      newUri,
      `${baseName} (Changes)`,
    );

    const closeListener = vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.toString() === oldUri.toString()) {
        diffContentStore.delete(oldPath);
      }
      if (doc.uri.toString() === newUri.toString()) {
        diffContentStore.delete(newPath);
      }
      if (!diffContentStore.has(oldPath) && !diffContentStore.has(newPath)) {
        closeListener.dispose();
      }
    });

    disposables.push(closeListener);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to open diff editor: ${error}`);
    log.error(
      "Webview",
      "openDiffEditor failed",
      { filePath, error: error?.message ?? String(error) },
      "💥",
    );
  }
}

async function createImageFile(
  imageData: string,
  imageType: string,
  thumbnailData?: string,
  originalName?: string,
): Promise<void> {
  log.debug(
    "Webview",
    "enter createImageFile",
    { imageType, hasThumbnail: !!thumbnailData, originalName },
    "➡️",
  );
  try {
    const base64Data = imageData.split(",")[1];
    if (!base64Data) {
      log.error(
        "Webview",
        "createImageFile: no base64 data found",
        undefined,
        "💥",
      );
      return;
    }
    const buffer = Buffer.from(base64Data, "base64");

    const ext = imageType.split("/")[1] || "png";
    const imagesDir = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "claude-code-via-cursor",
      "img",
    );
    fs.mkdirSync(imagesDir, { recursive: true });

    // Prefix every image with the current session id (<sessionId>_<name>) so it
    // can be cleaned up by filename glob when its conversation is deleted. Before
    // the CLI mints a session id (brand-new chat, first turn not yet run) use a
    // `pending_` prefix; system/init renames those to <sessionId>_ once it arrives.
    const sessionId = conversation.getCurrentSessionId();
    const prefix = sessionId ? `${sessionId}_` : "pending_";

    let imageFileName: string;
    if (originalName) {
      const parsed = path.parse(originalName);
      let candidate = `${prefix}${originalName}`;
      let counter = 0;
      while (fs.existsSync(path.join(imagesDir, candidate))) {
        counter++;
        candidate = `${prefix}${parsed.name}_${counter}${parsed.ext}`;
      }
      imageFileName = candidate;
    } else {
      imageFileName = `${prefix}image_${Date.now()}.${ext}`;
    }

    const imagePath = path.join(imagesDir, imageFileName);
    fs.writeFileSync(imagePath, buffer);
    log.info(
      "Webview",
      "createImageFile saved",
      { imagePath, size: buffer.length },
      "🖼️",
    );

    postMessage({
      type: "imageAttached",
      filePath: imagePath,
      thumbnailUri: thumbnailData || imageData,
    });
  } catch (error: any) {
    log.error(
      "Webview",
      "createImageFile failed",
      { imageType, error: error?.message ?? String(error) },
      "💥",
    );
    vscode.window.showErrorMessage("Failed to create image file");
  }
}

async function loadConversationHistory(filename: string): Promise<void> {
  log.debug("Webview", "enter loadConversationHistory", { filename }, "➡️");
  if (!conversation.getConversationsPath()) {
    return;
  }

  try {
    const conversationData = await conversation.loadConversationData(filename);
    if (!conversationData) {
      // The file is missing, empty, or corrupt (e.g. a truncated 0-byte save).
      // Don't strand the UI at "initializing" — fall back to a clean session and
      // still signal ready so the user can start typing.
      log.warn(
        "Webview",
        "loadConversationHistory: conversation unreadable, falling back to new session",
        { filename },
        "⚠️",
      );
      conversation.newSession();
      sendReadyMessage();
      return;
    }

    conversation.setCurrentSessionId(conversationData.sessionId);
    conversation.setConversationState(
      conversationData.messages || [],
      conversationData.startTime,
      conversationData.title,
      conversationData.titleLocked,
    );
    tokenCounters.setTotals(
      conversationData.totalCost || 0,
      conversationData.totalTokens?.input || 0,
      conversationData.totalTokens?.output || 0,
    );

    setTimeout(() => {
      postMessage({
        type: "newSession",
      });

      let requestStartTime: number;

      setTimeout(() => {
        const messages = conversation.getCurrentConversation();
        const batch: Array<{ type: string; data: any }> = [];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          if (message.messageType === "permissionRequest") {
            const isLast = i === messages.length - 1;
            if (!isLast) {
              continue;
            }
          }

          let messageData =
            message.messageType === "toolUse" ||
            message.messageType === "toolResult"
              ? { ...message.data, messageIndex: i }
              : message.data;

          if (
            message.messageType === "permissionRequest" &&
            message.data?.status === "pending" &&
            !subprocess.getProcess()
          ) {
            messageData = { ...message.data, status: "expired" };
          }

          if (
            message.messageType === "askUserQuestion" &&
            message.data?.status === "pending" &&
            !subprocess.getProcess()
          ) {
            messageData = { ...message.data, status: "expired" };
          }

          batch.push({ type: message.messageType, data: messageData });

          if (message.messageType === "userInput") {
            try {
              requestStartTime = new Date(message.timestamp).getTime();
            } catch (e: any) {
              log.error(
                "Webview",
                "failed to parse message timestamp",
                {
                  timestamp: message.timestamp,
                  error: e?.message ?? String(e),
                },
                "💥",
              );
            }
          }
        }

        postMessage({ type: "loadConversation", data: batch });

        const loadTotals = tokenCounters.getTotals();
        postMessage({
          type: "updateTotals",
          data: {
            totalCost: loadTotals.totalCost,
            totalTokensInput: loadTotals.totalTokensInput,
            totalTokensOutput: loadTotals.totalTokensOutput,
            requestCount: loadTotals.requestCount,
          },
        });

        if (subprocess.isActive()) {
          postMessage({
            type: "setProcessing",
            data: { isProcessing: subprocess.isActive(), requestStartTime },
          });
        }

        if (!subprocess.getProcess()) {
          postMessage({
            type: "expirePendingPermissions",
          });
        }

        sendReadyMessage();
      }, 50);
    }, 100);
  } catch (error: any) {
    log.error(
      "Webview",
      "loadConversationHistory failed",
      { filename, error: error?.message ?? String(error) },
      "💥",
    );
    // Recover rather than wedge: fall back to a clean session and signal ready.
    try {
      conversation.newSession();
      sendReadyMessage();
    } catch {
      /* best-effort */
    }
  }
}

export function dispose(): void {
  log.debug("Webview", "dispose", undefined, "🧹");
  if (panel) {
    panel.dispose();
    panel = undefined;
  }

  if (messageHandlerDisposable) {
    messageHandlerDisposable.dispose();
    messageHandlerDisposable = undefined;
  }

  while (disposables.length) {
    const d = disposables.pop();
    if (d) {
      d.dispose();
    }
  }
}
