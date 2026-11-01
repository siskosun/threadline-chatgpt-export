import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const content = read("src/content.js");
const picker = read("src/picker.js");
const popup = read("popup/popup.js");
const popupHtml = read("popup/popup.html");
const background = read("src/background.js");

test("manifest uses a narrow OpenAI media-host allowlist", () => {
  assert.deepEqual(manifest.host_permissions, [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://oaiusercontent.com/*",
    "https://*.oaiusercontent.com/*",
    "https://oaistatic.com/*",
    "https://*.oaistatic.com/*",
    "https://images.openai.com/*"
  ]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(manifest.name, "ThreadLine Archive");
  assert.equal(manifest.version, "0.7.0");
});

test("content script has no destructive conversation or project API path", () => {
  for (const forbidden of [
    "deleteConversationPermanently",
    "autoDeleteExported",
    "autoDeleteProjectsAfterExport",
    "projectDeletionCandidates",
    "managerDeletedDuringScan",
    "pendingDeletion",
    "autoDeleteAfterExport",
    "autoDeleteProjectsAfterExport",
    "method:'DELETE'",
    'method:"DELETE"',
    "/backend-api/gizmos/"
  ]) assert.equal(content.includes(forbidden), false, "unexpected content.js token: " + forbidden);
  assert.match(content, /x\.action==='export'/);
  assert.equal(/x\.action\s*===?\s*['"]delete['"]/.test(content), false);
});

test("picker exposes export and review only, never destructive controls", () => {
  for (const forbidden of [
    "Delete conversations",
    "Delete these",
    "runDelete",
    "openConfirm",
    "deleteConversation",
    "pendingDeletion",
    "autoDelete",
    'action: "delete"',
    'action: "export-delete"'
  ]) assert.equal(picker.includes(forbidden), false, "unexpected picker token: " + forbidden);
  assert.match(picker, /History export finished/);
  assert.match(picker, /This exported list is for review only/);
});

test("popup has no deletion UI or all-site permission request", () => {
  for (const forbidden of [
    "autoDelete",
    "ALL_SITES",
    "<all_urls>",
    "review-delete",
    "delete from ChatGPT",
    "auto-delete-after-export"
  ]) assert.equal(popup.includes(forbidden), false, "unexpected popup.js token: " + forbidden);
  for (const forbidden of [
    "auto-delete",
    "delete-projects",
    "confirm-auto-delete",
    "review-delete",
    "delete from ChatGPT"
  ]) assert.equal(popupHtml.includes(forbidden), false, "unexpected popup.html token: " + forbidden);
  assert.match(popup, /EXTERNAL_MEDIA_HOSTS/);
});

test("background validates sender, HTTPS scheme, and exact host suffixes before fetch", async () => {
  const listeners = [];
  const calls = [];
  const api = { runtime: { id: "threadline-test-id", onMessage: { addListener(fn) { listeners.push(fn); } } } };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const bytes = new TextEncoder().encode("asset").buffer;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/octet-stream" },
      arrayBuffer: async () => bytes
    };
  };
  vm.runInNewContext(background, {
    browser: api,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    Uint8Array,
    btoa,
    String,
    Error,
    Promise
  });
  const listener = listeners[0];
  assert.equal(typeof listener, "function");

  let response = null;
  const rejected = listener(
    { type: "cgx-fetch", url: "https://attacker.example/asset" },
    { id: api.runtime.id },
    (value) => { response = value; }
  );
  assert.equal(rejected, false);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: false,
    error: "External media host is not on the allowlist."
  });
  assert.equal(calls.length, 0);

  response = null;
  assert.equal(listener(
    { type: "cgx-fetch", url: "http://files.oaiusercontent.com/asset" },
    { id: api.runtime.id },
    (value) => { response = value; }
  ), false);
  assert.equal(response.ok, false);
  assert.equal(calls.length, 0);

  assert.equal(listener(
    { type: "cgx-fetch", url: "https://files.oaiusercontent.com/asset" },
    { id: "another-extension-id" },
    () => { throw new Error("untrusted sender must not receive a response"); }
  ), false);
  assert.equal(calls.length, 0);

  response = null;
  assert.equal(listener(
    { type: "cgx-fetch", url: "https://files.oaiusercontent.com/asset" },
    { id: api.runtime.id },
    (value) => { response = value; }
  ), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(calls[0].options.redirect, "error");
});

test("built Edge package carries the restricted manifest and non-destructive scripts", () => {
  const edge = path.join(ROOT, "dist", "edge");
  assert.equal(fs.existsSync(edge), true, "run python build.py before this test");
  const builtManifest = JSON.parse(fs.readFileSync(path.join(edge, "manifest.json"), "utf8"));
  assert.deepEqual(builtManifest.optional_host_permissions, manifest.optional_host_permissions);
  const builtContent = fs.readFileSync(path.join(edge, "src", "content.js"), "utf8");
  const builtPicker = fs.readFileSync(path.join(edge, "src", "picker.js"), "utf8");
  assert.equal(builtContent.includes("deleteConversationPermanently"), false);
  assert.equal(builtContent.includes("autoDeleteProjectsAfterExport"), false);
  assert.equal(builtPicker.includes("runDelete"), false);
});
