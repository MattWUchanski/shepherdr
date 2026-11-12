import { expect, test } from "bun:test";
import { argvFor, current, claudeRuntime, RuntimeSettings, line, menuFor, modelSections, parseDefaults, parsePicks, pickKey, selectedEffort, withPin, withRecent } from "./agents.js";

const codex = { models: Array.from({ length: 250 }, (_, i) => ({ id: `gpt-${i}`, label: `GPT ${i}`, efforts: ["low", "high"] })) };
const menus = { claude: menuFor("claude", {}), codex: menuFor("codex", codex) };

test("Codex lists every model it has, not its first five", () => {
  expect(menus.codex.models.length).toBe(250);
});

test("nothing typed: pinned, then recent, then the rest of the agent shown", () => {
  const picks = withRecent(withPin(parsePicks(""), pickKey("claude", "haiku")), pickKey("claude", "sonnet"));
  const s = modelSections(menus, "claude", picks, "");
  expect(s.map((x) => x.title)).toEqual(["Pinned", "Recent", "All models"]);
  expect(s[0].rows.map((r) => r.id)).toEqual(["haiku"]);
  expect(s[1].rows.map((r) => r.id)).toEqual(["sonnet"]);
  expect(s[2].rows.some((r) => r.id === "haiku" || r.id === "sonnet")).toBe(false);
});

test("a long list is capped and counts the rest", () => {
  const [all] = modelSections(menus, "codex", null, "");
  expect(all.rows.length).toBe(200);
  expect(all.more).toBe(50);
});

test("typed: every agent's matches, and a row to use the id typed", () => {
  const s = modelSections(menus, "codex", null, "opus 1m");
  expect(s.map((x) => x.key)).toEqual(["claude"]);
  expect(s[0].rows.map((r) => r.id)).toEqual(["opus[1m]"]);
  const t = modelSections(menus, "codex", null, "gpt-7-preview").find((x) => x.key === "typed");
  expect(t.rows.map((r) => [r.agent, r.id, r.typed])).toEqual([["codex", "gpt-7-preview", true], ["claude", "gpt-7-preview", true]]);
  expect(modelSections(menus, "codex", null, "gpt-999").map((x) => x.key)).toEqual(["typed"]);
  expect(modelSections(menus, "codex", null, "gpt-12").find((x) => x.key === "typed").rows.map((r) => r.agent)).toEqual(["claude"]);
});

test("an exact id typed needs no extra row; picks survive bad files", () => {
  expect(parsePicks("not json")).toEqual({ pinned: [], recent: [] });
  expect(withPin(withPin(parsePicks(""), "a:b"), "a:b").pinned).toEqual([]);
});

test("a running model typed by id stays in its agent's list", () => {
  expect(menuFor("claude", {}, "claude-opus-4-8").models[0]).toMatchObject({ id: "claude-opus-4-8", name: "Opus 4.8" });
});

test("a pinned or recent model typed by id stays on offer", () => {
  const picks = withRecent(withPin(parsePicks(""), "claude:claude-opus-4-8"), "codex:gpt-x");
  expect(modelSections(menus, "claude", picks, "")[0].rows[0]).toMatchObject({ id: "claude-opus-4-8", name: "Opus 4.8", pinned: true });
  expect(modelSections(menus, "codex", picks, "")[0]).toMatchObject({ title: "Recent", rows: [{ id: "gpt-x" }] });
  expect(modelSections(menus, "claude", picks, "gpt-x").map((x) => x.key)).toEqual(["codex", "typed"]);
});

// SHEP-41: Fast was hidden (and stuck on) for a Codex whose config.toml set service_tier.
test("every agent with a fast mode shows the Fast switch, and turning it off sticks", () => {
  const cache = JSON.stringify({ models: [{ slug: "gpt-x", display_name: "GPT-X", supported_reasoning_levels: [{ effort: "high" }], service_tiers: [{ id: "priority" }] },
    { slug: "gpt-slow", display_name: "GPT-Slow", service_tiers: [] }] });
  const dflt = parseDefaults("codex", `model\tgpt-x\nservice_tier\tfast\nmodels\t${cache}\n`);
  const codexMenu = menuFor("codex", dflt);
  expect(codexMenu.models.find((m) => m.id === "gpt-x").fast).toBe(true);
  expect(codexMenu.models.find((m) => m.id === "gpt-slow").fast).toBe(false);
  expect(codexMenu.fastLocked).toBeUndefined();
  expect(menuFor("claude", {}).models.find((m) => m.id === "opus").fast).toBe(true);
  // off: said on the command line, so config.toml's fast loses, and the label reads it back
  const off = argvFor({ agent: "codex", model: "gpt-x", effort: "high", fast: false }, { agent: "codex", argv: ["codex", "-c", 'service_tier="fast"'] }).argv;
  expect(off.filter((a) => a.startsWith("service_tier"))).toEqual(['service_tier="default"']);
  expect(current("codex", off, {}, dflt).fast).toBe(false);
  expect(line(current("codex", off, {}, dflt))).toBe("Codex · GPT-X · High");
  const on = argvFor({ agent: "codex", model: "gpt-x", fast: true }, { agent: "codex", argv: off }).argv;
  expect(current("codex", on, {}, dflt).fast).toBe(true);
  const claudeOff = argvFor({ agent: "claude", model: "opus", fast: false }, { agent: "claude", argv: ["claude"] }).argv;
  expect(current("claude", claudeOff, {}, { fast: true }).fast).toBe(false);
});


// A fresh Claude tab has no transcript yet and no model/permission flags. Its visible CLI
// state is already authoritative; a legacy global effort is not that session's effort.
const claudeDefaults = { effort: "xhigh", per: { "claude-opus-5": "xhigh", "claude-opus-5-5": "high" } };
const promptBox = (footer = "⏵⏵ auto mode on (shift+tab to cycle)", chip = "") => `${chip}
─────────────────────────────
❯ Try "how does this work?"
─────────────────────────────
  ${footer}
`;
const startup = (effort = "high", footer, chip) => `
 ▐▛███▛█   Claude Code v2.1.322
▝▜██████▀  Opus 5.5 with ${effort} effort · Claude Max
 ▝▝   ▝▝   ~/project

${promptBox(footer, chip)}`;
const terminal = (pid = 123) => ({ address: "t7", state: "live", created_ms: 10, status: { app: "claude-code" }, foreground: { pid, argv: ["claude"] } });

test("a fresh unflagged Claude tab shows its actual High/Auto before the first prompt", () => {
  const runtime = claudeRuntime(startup());
  expect(runtime).toEqual({ model: "claude-opus-5-5", bannerEffort: "high", perm: "auto" });
  expect(current("claude", ["claude"], {}, claudeDefaults, runtime)).toMatchObject({ model: "claude-opus-5-5", effort: "high", perm: "auto" });
});

test("Max is read from this session, not its saved default; live badges beat old launch modes", () => {
  const runtime = claudeRuntime(startup("max", "⏵⏵ auto mode on (shift+tab to cycle)", "◈ max · /effort"));
  expect(current("claude", ["claude", "--permission-mode", "plan"], {}, claudeDefaults, runtime)).toMatchObject({ effort: "max", perm: "auto" });
  expect(claudeRuntime(startup("max", "⏸ manual mode on · ? for shortcuts · ← 1 agent")).perm).toBe("manual");
  expect(claudeRuntime(promptBox("⏵⏵ accept edits on (shift+tab to cycle)")).perm).toBe("acceptEdits");
  expect(claudeRuntime(promptBox("⏸ plan mode on (shift+tab to cycle)")).perm).toBe("plan");
  expect(claudeRuntime(promptBox("⏵⏵ bypass permissions on (shift+tab to cycle)")).perm).toBe("bypassPermissions");
});

test("newer transcript choices beat the startup banner, and a live effort chip beats old transcript effort", () => {
  expect(current("claude", ["claude"], { model: "claude-sonnet-5-5", effort: "max" }, claudeDefaults, claudeRuntime(startup())))
    .toMatchObject({ model: "claude-sonnet-5-5", effort: "max", perm: "auto" });
  expect(current("claude", ["claude"], { model: "claude-opus-5-5", effort: "low" }, claudeDefaults, claudeRuntime(promptBox(undefined, "● high · /effort"))).effort).toBe("high");
});

test("known aliases resolve per-model effort, but unknown models and modes are not guessed", () => {
  expect(current("claude", ["claude", "--model", "opus"], {}, claudeDefaults)).toMatchObject({ effort: "high", perm: null });
  expect(current("claude", ["claude"], {}, claudeDefaults)).toMatchObject({ model: null, effort: null, perm: null });
  expect(current("claude", ["claude", "--model", "claude-opus-5-5"], {}, { effort: "xhigh", per: { "claude-opus-5": "xhigh" } }).effort).toBeNull();
  expect(current("claude", ["claude", "--effort", "max", "--permission-mode", "default"], {}, claudeDefaults)).toMatchObject({ effort: "max", perm: "manual" });
});

test("an unrecognized live footer clears stale launch Auto instead of assuming Ask", () => {
  const runtime = claudeRuntime(promptBox("? for shortcuts"));
  expect(runtime).toEqual({ perm: null });
  expect(current("claude", ["claude", "--permission-mode", "auto"], {}, {}, runtime).perm).toBeNull();
  const built = argvFor({ agent: "claude", model: "opus", perm: null }, { agent: "claude", argv: ["claude"] });
  expect(built.argv).not.toContain("--permission-mode");
  expect(built.argv).not.toContain("--dangerously-skip-permissions");
});

test("conversation lookalikes and missing prompt boundaries are not runtime settings", () => {
  expect(claudeRuntime("Opus 5.5 with max effort · Claude Max\n⏵⏵ auto mode on")).toEqual({});
  expect(claudeRuntime(`Here is an example:\nOpus 5.5 with max effort · Claude Max\n⏵⏵ auto mode on\n${promptBox("? for shortcuts")}`)).toEqual({ perm: null });
  expect(claudeRuntime(`The output says Claude Code v2.1.322\nOpus 5.5 with max effort · Claude Max\n${promptBox("? for shortcuts")}`)).toEqual({ perm: null });
  expect(claudeRuntime(`${startup()}\n\nSome unrelated later output\nLine two\nLine three\nLine four\nLine five`)).toEqual({});
});

test("ANSI colours and a wrapped footer do not hide the current mode", () => {
  const screen = startup("high", "\x1b[33m⏵⏵ auto mode on\x1b[0m\n   (shift+tab to cycle) · ← 1 agent");
  expect(claudeRuntime(screen)).toMatchObject({ model: "claude-opus-5-5", bannerEffort: "high", perm: "auto" });
});

test("runtime snapshots are scoped to their PID, clear on failed reads, and discard late old replies", async () => {
  const settings = new RuntimeSettings(), first = terminal(), second = terminal(456);
  await settings.read(first, async () => startup());
  expect(settings.get(first).perm).toBe("auto");
  expect(settings.get(second)).toEqual({});
  await settings.read(first, async () => { throw new Error("offline"); });
  expect(settings.get(first)).toEqual({});
  let finish;
  const pending = settings.read(first, () => new Promise((resolve) => { finish = resolve; }));
  await settings.read(second, async () => startup("max", "⏸ manual mode on"));
  finish(startup());
  await pending;
  expect(settings.get(first)).toEqual({});
  expect(settings.get(second)).toMatchObject({ bannerEffort: "max", perm: "manual" });
  expect(settings.get({ ...second, state: "finished" })).toEqual({});
});


test("a different transcript model cannot inherit the startup banner's effort or 1M alias", () => {
  const runtime = claudeRuntime(startup().replace("Opus 5.5 with", "Opus 5.5 (1M context) with"));
  expect(current("claude", ["claude"], { model: "claude-sonnet-5-5" }, claudeDefaults, runtime))
    .toMatchObject({ model: "claude-sonnet-5-5", alias: null, effort: null, window: 200000 });
});

test("legacy effort defaults apply only to known older models, not new models or unknown ids", () => {
  const dflt = { effort: "xhigh" };
  expect(current("claude", ["claude", "--model", "claude-opus-4-6"], {}, dflt).effort).toBe("xhigh");
  expect(current("claude", ["claude", "--model", "claude-opus-5"], {}, dflt).effort).toBe("xhigh");
  expect(current("claude", ["claude", "--model", "claude-fable-5-1"], {}, dflt).effort).toBe("xhigh");
  expect(menuFor("claude", dflt).models.find((m) => m.id === "opus").defaultEffort).toBeNull();
  expect(menuFor("claude", dflt, "custom-model").models[0].defaultEffort).toBeNull();
});

test("desktop and web menu selections preserve unknown effort on Fast-only and permission-only changes", () => {
  const running = { agent: "claude", model: "opus", effort: null, fast: false, perm: null };
  const row = { defaultEffort: "xhigh" };
  for (const changed of [{ fast: true }, { perm: "auto" }]) {
    const selected = { ...running, ...changed };
    const effort = selectedEffort(selected, running, row);
    expect(effort).toBeNull();
    expect(argvFor({ ...selected, effort }, { agent: "claude", argv: ["claude"] }).argv).not.toContain("--effort");
  }
  expect(selectedEffort({ ...running, effort: "max" }, running, row)).toBe("max");
  expect(selectedEffort({ ...running, model: "sonnet" }, running, row)).toBe("xhigh");
  expect(selectedEffort(running, null, row)).toBe("xhigh"); // Settings configures future sessions.
});
