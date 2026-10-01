import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";
import editSession from "../extensions/edit-session-in-place.ts";

class MemoryTerminal implements Terminal {
  columns = 100;
  rows = 30;
  kittyProtocolActive = false;
  onInput?: (data: string) => void;
  onResize?: () => void;
  starts = 0;
  stops = 0;
  start(input: (data: string) => void, resize: () => void) { this.starts++; this.onInput = input; this.onResize = resize; }
  stop() { this.stops++; this.onInput = undefined; this.onResize = undefined; }
  async drainInput() {}
  write(_data: string) {}
  moveBy(_lines: number) {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
  send(data: string) { assert.ok(this.onInput); this.onInput(data); }
  resize(columns: number, rows: number) { this.columns = columns; this.rows = rows; this.onResize?.(); }
}
const rendered = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), "The native operation settled within the fixture bound");
};

test("actual native edit shortcut, editor controls and replacement lifecycle preserve drafts/history", { timeout: 20_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-edit-native-"));
  const agentDir = join(home, "agent"); mkdirSync(agentDir);
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  process.env.HOME = home; process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.VISUAL; delete process.env.EDITOR;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network in native edit test"); });
  let cleanup: (() => Promise<void>) | undefined;
  let ownedEditorPid: number | undefined;
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    let context: ExtensionCommandContext | undefined;
    let command: Promise<void> | undefined;
    const settingsManager = pi.SettingsManager.inMemory({ theme: "dark", quietStartup: true });
    const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
    const runtime = await pi.createAgentSessionRuntime(async ({ cwd, sessionManager }) => {
      const services = await pi.createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager,
        resourceLoaderOptions: {
          noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
          extensionFactories: [(api: ExtensionAPI) => {
            editSession({ ...api, registerCommand(name, options) {
              api.registerCommand(name, { ...options, handler: async (args, ctx) => { command = options.handler(args, ctx); await command; } });
            } });
            api.registerCommand("qa-context", { handler: async (_args, ctx) => { context = ctx; } });
          }],
        },
      });
      assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
      return { ...await pi.createAgentSessionFromServices({ services, sessionManager, tools: [] }), services, diagnostics: services.diagnostics };
    }, { cwd: home, agentDir, sessionManager: pi.SessionManager.inMemory(home) });
    const terminal = new MemoryTerminal();
    const mode = new pi.InteractiveMode(runtime, { terminal, initialThemeSetting: "dark" });
    cleanup = async () => { try { mode.stop(); } finally { await runtime.dispose(); } };
    await mode.init(); await runtime.session.prompt("/qa-context");
    // ponytail: no public viewport observer exists; this fixture uses the native renderer until one does.
    const renderer = () => (mode as unknown as { renderer: { mode: string; previousScreen?: string[]; previousLines?: string[] } }).renderer;
    const screen = () => (renderer().mode === "fullscreen" ? renderer().previousScreen : renderer().previousLines) ?? [];
    assert.equal(renderer().mode, "fullscreen");
    const append = (text: string, image = false) => runtime.session.sessionManager.appendMessage({ role: "user", content: image ? [{ type: "text", text }, { type: "image", mimeType: "image/png", data: "fixture" }] : text, timestamp: Date.now() });
    const respond = (text: string) => runtime.session.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    const shortcut = async () => { command = undefined; terminal.send("\x1b[101;6u"); await rendered(); assert.ok(command); };
    const draft = "Original draft 界🙂\n".repeat(25);

    for (const tuiMode of ["fullscreen", "regular"] as const) {
      (mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode(tuiMode);
      await t.test(`${tuiMode} cancel at picker/editor returns the expanded draft and keyboard focus`, async () => {
        append("Earlier prompt 界🙂"); respond("Historical answer"); append("Latest prompt 界🙂"); respond("Later answer");
        const entries = runtime.session.sessionManager.getEntries();
        context!.ui.setEditorText(draft);
        await shortcut(); terminal.resize(44, 24); await rendered();
        assert.ok(screen().some(line => line.includes("Pick a previous")));
        terminal.send("\x1b"); await command;
        assert.equal(context!.ui.getEditorText(), draft);
        await shortcut(); terminal.send("\r"); await rendered();
        assert.ok(screen().some(line => line.includes("Edit previous message")));
        terminal.send("\x18"); terminal.send("changed but cancelled 界🙂"); terminal.send("\x1b"); await command;
        assert.equal(context!.ui.getEditorText(), draft);
        assert.deepEqual(runtime.session.sessionManager.getEntries(), entries);
        terminal.send("!"); assert.equal(context!.ui.getEditorText(), draft + "!");
        terminal.resize(100, 30);
      });
      await t.test(`${tuiMode} native clear/newline submits an edit without resending and retains later tree history`, async () => {
        const oldUser = append("Rewrite this prompt 界🙂"); const later = respond("Keep abandoned response");
        context!.ui.setEditorText(draft);
        await shortcut(); terminal.send("\r"); await rendered();
        terminal.send("\x18"); terminal.send("Edited user 界🙂"); terminal.send("\x1b[13;2u"); terminal.send("second line");
        terminal.resize(160, 38); await rendered();
        assert.ok(screen().some(line => line.includes("second line")));
        terminal.send("\r"); await command;
        assert.equal(context!.ui.getEditorText(), "Edited user 界🙂\nsecond line");
        const manager = runtime.session.sessionManager;
        assert.equal(manager.getBranch().some(entry => entry.id === oldUser || entry.id === later), false);
        assert.ok(manager.getEntry(later));
        assert.equal(manager.getEntries().some(entry => entry.type === "message" && entry.message.role === "user" && entry.message.content === "Edited user 界🙂\nsecond line"), false, "Editing loads a draft; only a later explicit Enter may send it");
        terminal.resize(100, 30);
      });
    }

    await t.test("native pointer picks the highlighted history row; assistant edits preserve the draft and later branch", async () => {
      (mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode("fullscreen");
      const user = append("Mouse target user"); const answer = respond("Mouse target assistant");
      append("Later mouse user"); const abandoned = respond("Later mouse answer");
      context!.ui.setEditorText(draft); await shortcut(); terminal.send("\x01"); await rendered();
      const row = screen().findIndex(line => line.includes("Mouse target assistant")); assert.ok(row >= 0);
      terminal.send(`\x1b[<0;5;${row + 1}M`); terminal.send(`\x1b[<0;5;${row + 1}m`); terminal.send("\r"); await rendered();
      terminal.send("\x18"); terminal.send("Rewritten assistant 界🙂"); terminal.send("\r"); await command;
      const manager = runtime.session.sessionManager;
      assert.equal(context!.ui.getEditorText(), draft);
      assert.equal(manager.getBranch().some(entry => entry.id === answer || entry.id === abandoned), false);
      assert.ok(manager.getEntry(abandoned)); assert.ok(manager.getEntry(user));
      assert.equal((manager.getLeafEntry() as { message: { content: Array<{ text: string }> } }).message.content[0]!.text, "Rewritten assistant 界🙂");
      assert.deepEqual(runtime.session.state.messages, manager.buildSessionProjection().messages);
    });

    await t.test("external editor uses expanded private text, quoted arguments and native terminal handoff", async () => {
      const script = join(home, "external editor.mjs"); const receipt = join(home, "external-receipt.json");
      writeFileSync(script, `import { readFileSync, writeFileSync, statSync } from 'node:fs'; const file=process.argv.at(-1); writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({mode:statSync(file).mode & 0o777,text:readFileSync(file,'utf8'),args:process.argv.slice(2,-1)})); writeFileSync(file,'External edit 界🙂\\nsecond line\\n');`);
      process.env.VISUAL = `"${process.execPath}" "${script}" "quoted argument"`;
      append("Expanded external prompt 界🙂\n".repeat(25)); respond("External later answer");
      context!.ui.setEditorText(draft); await shortcut(); terminal.send("\r"); await rendered();
      terminal.send("\x18");
      terminal.send("\x1b[200~" + "Expanded external prompt 界🙂\n".repeat(25) + "\x1b[201~");
      const starts = terminal.starts;
      terminal.send("\x07"); await until(() => terminal.starts > starts); await rendered();
      const result = JSON.parse(readFileSync(receipt, "utf8"));
      assert.equal(result.mode, 0o600); assert.deepEqual(result.args, ["quoted argument"]);
      assert.equal(result.text, "Expanded external prompt 界🙂\n".repeat(25));
      terminal.send("\r"); await command;
      assert.equal(context!.ui.getEditorText(), "External edit 界🙂\nsecond line");
      process.env.VISUAL = "\"unterminated";
      append("Failure leaves edit intact"); respond("Later");
      context!.ui.setEditorText(draft); await shortcut(); terminal.send("\r"); await rendered(); terminal.send("\x07"); await rendered();
      assert.ok(screen().some(line => line.includes("Unterminated quote")));
      terminal.send("\x1b"); await command; assert.equal(context!.ui.getEditorText(), draft);
      process.env.VISUAL = `"${process.execPath}" -e "process.exit(9)"`;
      await shortcut(); terminal.send("\r"); await rendered();
      const restart = terminal.starts; terminal.send("\x07"); await until(() => terminal.starts > restart); await rendered();
      assert.ok(screen().some(line => line.includes("External editor exited with status 9")));
      terminal.send("\x1b"); await command; assert.equal(context!.ui.getEditorText(), draft);
      delete process.env.VISUAL;
    });

    for (const boundary of ["newSession", "fork", "switchSession", "reload"] as const) {
      await t.test(`${boundary} cancels a pending edit without restoring an outgoing draft or applying the edit`, async () => {
        const marker = append(`Lifecycle ${boundary} prompt`, boundary === "switchSession"); respond("Lifecycle response");
        const outgoing = context!; const oldManager = runtime.session.sessionManager;
        const journal = join(home, "resume.jsonl");
        writeFileSync(journal, [oldManager.getHeader(), ...oldManager.getBranch()].map(entry => JSON.stringify(entry)).join("\n") + "\n");
        const childReceipt = join(home, "slow-editor-pid");
        if (boundary === "reload") {
          const slowEditor = join(home, "slow editor.mjs");
          writeFileSync(slowEditor, `import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(childReceipt)}, String(process.pid)); setTimeout(() => process.exit(0), 10000);`);
          process.env.VISUAL = `"${process.execPath}" "${slowEditor}"`;
        }
        context!.ui.setEditorText(draft); await shortcut();
        if (boundary !== "newSession") { terminal.send("\r"); await rendered(); }
        if (boundary === "reload") {
          terminal.send("\x07"); await until(() => existsSync(childReceipt));
          ownedEditorPid = Number(readFileSync(childReceipt, "utf8"));
        }
        const entries = boundary === "fork" ? oldManager.getBranch(marker) : oldManager.getEntries();
        if (boundary === "newSession") await outgoing.newSession({ withSession: async ctx => { ctx.ui.setEditorText("Incoming draft"); } });
        else if (boundary === "fork") await outgoing.fork(marker, { position: "at", withSession: async ctx => { ctx.ui.setEditorText("Incoming draft"); } });
        else if (boundary === "switchSession") await outgoing.switchSession(journal, { withSession: async ctx => { ctx.ui.setEditorText("Incoming draft"); } });
        else await outgoing.reload();
        await command;
        await runtime.session.prompt("/qa-context");
        assert.equal(context!.ui.getEditorText(), boundary === "reload" || boundary === "fork" ? "" : "Incoming draft");
        assert.throws(() => outgoing.ui.getEditorText(), /stale|invalid|disposed|active/i);
        assert.deepEqual(oldManager.getEntries(), entries);
        if (boundary === "reload") {
          const pid = Number(readFileSync(childReceipt, "utf8"));
          await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
          ownedEditorPid = undefined;
          assert.ok(terminal.onInput, "Disposing external editing resumes terminal input before replacement");
          delete process.env.VISUAL;
        }
        await shortcut(); terminal.send("\x1b"); await command;
      });
    }
  } finally {
    try { await cleanup?.(); } finally {
      if (ownedEditorPid) { try { process.kill(ownedEditorPid, "SIGKILL"); } catch {} }
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(home, { recursive: true, force: true });
    }
  }
});
