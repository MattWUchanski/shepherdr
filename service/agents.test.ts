import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agents } from "./agents.ts";
import { ChatReader } from "../core/chat-reader.js";

// Only the RPC boundary is faked: defaults, terminal state, and screen all come from
// this fixture. No user's settings, real terminal, or agent process is involved.
const scratch = mkdtempSync(join(tmpdir(), "agents-runtime-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const prompt = (footer = "⏵⏵ auto mode on (shift+tab to cycle)", chip = "") => `${chip}
─────────────────────────────
❯ Try "how does this work?"
─────────────────────────────
  ${footer}
`;
const screen = (effort = "high", footer?: string, chip = "") => `
 ▐▛███▛█   Claude Code v2.1.322
▝▜██████▀  Opus 5.5 with ${effort} effort · Claude Max
 ▝▝   ▝▝   ~/project

${prompt(footer, chip)}`;
const terminal = (address = "t7", pid = 4242) => ({ address, state: "live", created_ms: 10,
  argv: ["claude"], labels: {}, status: { app: "claude-code", state: "idle" },
  foreground: { name: "claude", pid, argv: ["claude"], cwd: "/work/demo" } });

function fixture(address = "t7") {
  const t = terminal(address);
  const state = { screen: screen(), unreadable: false, detail: t };
  const calls: { method: string; params: any }[] = [];
  const hub: any = {
    terminals: new Map([[address, t]]),
    call: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === "terminal.get") return { ...state.detail, address: address.split("/").at(-1) };
      if (method === "terminal.read") {
        if (state.unreadable) throw new Error("screen unavailable");
        return { text: state.screen };
      }
      if (method === "machine.exec") {
        const [, , , action, kind] = params.argv;
        const stdout = action === "agents" ? "claude\ncodex\n"
          : action === "defaults" && kind === "claude"
            ? 'model\t\neffort\txhigh\nper\t{"claude-opus-5-5":"high"}\nmode\t\n'
          : action === "defaults" && kind === "codex" ? "model\tgpt-example\n" : null;
        if (stdout === null) throw new Error(`Unexpected shell action: ${action}`);
        return { code: 0, stdout: Buffer.from(stdout).toString("base64"), stderr: "" };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    },
    send: async () => { throw new Error("No prompt may be sent by this test"); },
  };
  const agents = new Agents(hub);
  (agents as any).picksPath = join(scratch, `${address.replaceAll("/", "-")}-picks.json`);
  (agents as any).reachable = async () => true;
  const reader = new ChatReader({ screen: async (addr: string) =>
    (await hub.call("terminal.read", { terminal: addr, lines: 0 })).text }, address);
  return { t, state, calls, hub, agents, reader };
}

test("web model menu reads a new unflagged Claude's High/Auto before any transcript", async () => {
  const { agents, calls } = fixture();
  const menu = await agents.menu("t7", null);
  expect(menu.current).toMatchObject({ agent: "claude", model: "opus", effort: "high", perm: "auto" });
  expect(calls.filter((c) => c.method === "terminal.read")).toEqual([
    { method: "terminal.read", params: { terminal: "t7", lines: 0 } },
  ]);
  expect(calls.every((c) => ["machine.exec", "terminal.read"].includes(c.method))).toBe(true);
});

test("each menu refresh sees session-only Max and permission changes, then clears an absent badge", async () => {
  const { agents, reader, state, t } = fixture();
  expect((await agents.menu("t7", reader)).current).toMatchObject({ effort: "high", perm: "auto" });
  state.screen = screen("high", "⏸ plan mode on (shift+tab to cycle)", "◈ max · /effort");
  expect((await agents.menu("t7", reader)).current).toMatchObject({ effort: "max", perm: "plan" });
  state.screen = screen("high", "? for shortcuts");
  t.foreground.argv = ["claude", "--permission-mode", "auto"];
  expect((await agents.menu("t7", reader)).current.perm).toBeNull();
});

test("an unidentified model does not inherit global xhigh, and explicit manual flags still work", async () => {
  const { agents, state, t } = fixture();
  state.screen = prompt("? for shortcuts");
  expect((await agents.menu("t7", null)).current).toMatchObject({ model: null, effort: null, perm: null });
  state.unreadable = true;
  t.foreground.argv = ["claude", "--model", "opus", "--effort", "max", "--permission-mode", "default"];
  expect((await agents.menu("t7", null)).current).toMatchObject({ model: "opus", effort: "max", perm: "manual" });
});

test("a restarted process cannot reuse the old reader's model or permission observation", async () => {
  const { agents, reader, state, hub } = fixture();
  expect((await agents.menu("t7", reader)).current).toMatchObject({ effort: "high", perm: "auto" });
  const replacement = { ...terminal("t7", 5252), created_ms: 20 };
  (reader as any).conv = { meta: { model: "claude-opus-5-5", effort: "high", at: 10 } };
  hub.terminals.set("t7", replacement);
  state.detail = replacement;
  state.unreadable = true;
  expect(reader.runtimeFor(replacement)).toEqual({});
  expect((await agents.menu("t7", reader)).current).toMatchObject({ model: null, effort: null, perm: null });
});

test("runtime screen reads retain the remote address after resolving a missing foreground", async () => {
  const { agents, state, hub, calls } = fixture("remote/t7");
  hub.terminals.set("remote/t7", { ...state.detail, foreground: null });
  expect((await agents.menu("remote/t7", null)).current).toMatchObject({ effort: "high", perm: "auto" });
  expect(calls.filter((c) => c.method === "terminal.get").map((c) => c.params.terminal)).toEqual(["remote/t7"]);
  expect(calls.filter((c) => c.method === "terminal.read").map((c) => c.params)).toEqual([{ terminal: "remote/t7", lines: 0 }]);
  expect(calls.filter((c) => c.method === "machine.exec").every((c) => c.params.on === "remote")).toBe(true);
});

test("choosing explicit Auto from unknown permission restarts instead of silently skipping the choice", async () => {
  const { agents, state } = fixture();
  state.screen = screen("high", "? for shortcuts");
  const requested: any[] = [];
  agents.restart = async (...args: any[]) => { requested.push(args); return "t8"; };
  const pick = { kind: "claude", model: "opus", effort: "high", perm: "auto" };
  expect(await agents.change("t7", null, pick)).toEqual({ terminal: "t8" });
  expect(requested).toEqual([["t7", null, pick]]);
});

test("restart info uses this process's live settings instead of an old transcript", async () => {
  const { agents, state, reader } = fixture();
  state.screen = screen("max");
  (reader as any).conv = { meta: { model: "claude-sonnet-5-5", effort: "medium", at: 1 } };
  const info = await agents.info("t7", reader);
  expect(info.on).toMatchObject({ kind: "claude", model: "opus", effort: "max" });
  expect(info.onWords).toContain("Max");
});
