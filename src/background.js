// Download only media hosted on explicitly allowed OpenAI domains.
// Third-party media remains a remote link; this extension never requests all-site access.
const api = globalThis.browser ?? globalThis.chrome;
const FETCH_TIMEOUT_MS = 20000;

function isAllowedExternalMediaUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "images.openai.com" ||
      host === "oaiusercontent.com" || host.endsWith(".oaiusercontent.com") ||
      host === "oaistatic.com" || host.endsWith(".oaistatic.com");
  } catch (_) {
    return false;
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "cgx-fetch") return false;
  if (!sender || sender.id !== api.runtime.id) return false;
  if (!isAllowedExternalMediaUrl(msg.url)) {
    sendResponse({ ok: false, error: "External media host is not on the allowlist." });
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  fetch(msg.url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    signal: controller.signal
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      const type = res.headers.get("content-type") || "";
      sendResponse({ ok: true, type, data: toBase64(await res.arrayBuffer()) });
    })
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
    .finally(() => clearTimeout(timer));
  return true;
});
