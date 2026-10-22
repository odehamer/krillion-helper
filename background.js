// Calls the Claude API for the popup and the on-page panel. The API key stays
// here in the extension, never in the game page. Answers stream back over a
// port one at a time.

const SYSTEM =
  "You help with Krillion, a trivia game. Each round shows one category prompt, such as " +
  '"Name a fruit." Players score more for correct answers few people give, and a wrong ' +
  "answer scores nothing. Only give answers you are certain fit every condition in the prompt " +
  "(letters, numbers, dates, places). Each answer is just the name or word to type, with no " +
  "notes or explanations. List the most obscure first.";

const COUNT = 8;

// Structured output: the reply can only be {"answers": [...]}, so none of the
// model's reasoning can end up in the list.
const FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: { answers: { type: "array", items: { type: "string" } } },
    required: ["answers"],
    additionalProperties: false,
  },
};

// ANTHROPIC_API_KEY from the extension's own .env file. It's bundled with the
// extension but not web-accessible, so pages can't read it.
async function envKey() {
  try {
    const text = await fetch(chrome.runtime.getURL(".env")).then((r) => (r.ok ? r.text() : ""));
    const m = text.match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

// The key from Settings wins; .env is the fallback.
async function getKey() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  return apiKey || envKey();
}

// Pulls every complete string out of the partial JSON's answers array, so each
// answer can be shown as soon as its closing quote arrives.
function completedAnswers(json) {
  const start = json.indexOf("[");
  if (start < 0) return [];
  const out = [];
  for (const m of json.slice(start).matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`).trim());
    } catch {}
  }
  return out;
}

async function streamAnswers(prompt, exclude, port, signal) {
  const { model } = await chrome.storage.local.get("model");
  const apiKey = await getKey();
  if (!apiKey) {
    port.postMessage({ error: "Add your Anthropic API key in Krillion Helper's Settings or .env." });
    return;
  }

  let ask = `Prompt: ${prompt}\n\nGive ${COUNT} answers.`;
  if (exclude?.length) ask += ` Don't repeat any of these: ${exclude.join("; ")}.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-opus-5-5",
      max_tokens: 4000,
      stream: true,
      fallbacks: "default",
      output_config: { effort: "low", format: FORMAT },
      system: SYSTEM,
      messages: [{ role: "user", content: ask }],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    port.postMessage({ error: body.error?.message || `Claude API error ${res.status}` });
    return;
  }

  // Server-sent events: only text deltas carry the JSON; thinking blocks and
  // everything else are ignored.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let sse = "";
  let json = "";
  let sent = 0;
  const seen = new Set((exclude ?? []).map((a) => a.toLowerCase()));
  const flush = () => {
    const answers = completedAnswers(json);
    for (; sent < answers.length; sent++) {
      const a = answers[sent];
      if (a && a.length <= 80 && !seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        port.postMessage({ answer: a });
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    sse += value;
    const events = sse.split("\n\n");
    sse = events.pop();
    for (const ev of events) {
      const data = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const msg = JSON.parse(data.slice(6));
      if (msg.type === "content_block_delta" && msg.delta.type === "text_delta") {
        json += msg.delta.text;
        flush();
      } else if (msg.type === "message_delta" && msg.delta.stop_reason === "refusal") {
        port.postMessage({ error: "Claude declined this prompt." });
      } else if (msg.type === "error") {
        port.postMessage({ error: msg.error?.message || "Claude API error" });
      }
    }
  }
  flush();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "hasKey") return;
  getKey().then((key) => reply(Boolean(key)));
  return true; // reply asynchronously
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "kh") return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  port.onMessage.addListener(async ({ prompt, exclude }) => {
    try {
      await streamAnswers(prompt, exclude, port, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) port.postMessage({ error: err.message });
    }
    if (!abort.signal.aborted) port.postMessage({ done: true });
  });
});
