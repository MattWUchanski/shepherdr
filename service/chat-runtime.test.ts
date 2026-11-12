// Exercise the window chat's real methods with read-only IO stand-ins, without loading a window.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as agent from "../core/agents.js";

const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const method = (name: string) => {
  const match = source.match(new RegExp(`\\n  (?:async )?${name}\\([^]*?\\n  \}\\n`));
  if (!match) throw new Error(`Missing Chat.${name}`);
  return match[0];
};
const screen = (effort: string) => `
 ▐▛███▛█   Claude Code v2.1.322
▝▜██████▀  Opus 5.5 with ${effort} effort · Claude Max
 ▝▝   ▝▝   ~/project

──────────────────────────
❯
──────────────────────────
⏵⏵ auto mode on (shift+tab to cycle)
`;

test("desktop Chat reads the same remote process and preserves High/Auto and session Max", async () => {
  let effort = "high";
  const calls: string[][] = [];
  const t = { address: "t7", state: "live", keep: true, status: { app: "claude-code" }, foreground: { pid: 123, name: "claude", argv: ["claude"] } };
  const hc = async (argv: string[]) => {
    calls.push(argv);
    return { code: 0, stdout: argv[0] === "get" ? JSON.stringify(t) : screen(effort), stderr: "" };
  };
  const methods = new Function("hc", "agent", "KINDS", "exec", "FIND", "starting", "Conversation",
    `return {${["locate", "readRuntime", "current"].map(method).join(",")}}`)(hc, agent, { "claude-code": "claude" },
    async () => ({ stdout: "pending" }), "", () => true, class { meta = {}; });
  const c: any = Object.assign({ addr: "remote/t7", machine: "remote", phase: "finding", inner: true,
    dflt: { effort: "xhigh", per: { "claude-opus-5-5": "high" } }, runtime: new agent.RuntimeSettings(),
    loadFirst: () => {}, assistant: () => false, set(phase: string) { this.phase = phase; } }, methods);
  const cx = { spawn: () => {}, notify: () => {} };
  await c.locate(cx);
  await c.readRuntime(cx);
  expect(c.current()).toMatchObject({ model: "claude-opus-5-5", effort: "high", perm: "auto" });
  effort = "max";
  await c.readRuntime(cx);
  expect(c.current()).toMatchObject({ effort: "max", perm: "auto" });
  expect(calls).toEqual([["get", "remote/t7", "--json"], ["read", "remote/t7", "--lines", "0"], ["read", "remote/t7", "--lines", "0"]]);
});
