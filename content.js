// Runs on the game page (including the game's iframe). Watches for each new
// prompt and shows streamed answers in a small panel, so there's no popup to open.
// In Puffer Party mode it also records every answer other players get accepted,
// per question, and never suggests those again.

const KH_PROMPT_START = /^(name|list|give|guess|think of|type)\b/i;

function khFindPrompt() {
  // Puffer Party's category card ("New category" is a placeholder card).
  const card = document.querySelector(".ds-card:not(.pf-newcat):not(.gone) .prompt");
  const cardText = (card?.innerText || "").trim().replace(/\s+/g, " ");
  if (cardText.length >= 3 && card.getClientRects().length) return cardText;

  for (const el of document.querySelectorAll("h1,h2,h3,[class*=prompt i],[class*=question i]")) {
    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (text.length >= 6 && text.length <= 250 && KH_PROMPT_START.test(text) && el.getClientRects().length) {
      return text;
    }
  }
  return "";
}

// ---- Panel (in a shadow root so the game's styles don't leak in) -----------

const khHost = document.createElement("div");
const khRoot = khHost.attachShadow({ mode: "closed" });
khRoot.innerHTML = `
  <style>
    .panel { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 240px;
      font: 13px/1.4 system-ui, sans-serif; color: #e8eaed; background: rgba(32,33,36,.94);
      border: 1px solid #555; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    .head { display: flex; align-items: center; gap: 4px; padding: 6px 8px;
      font-weight: 600; user-select: none; }
    .title { flex: 1; cursor: pointer; }
    .head button { all: unset; cursor: pointer; padding: 0 5px; border-radius: 4px; color: #9aa0a6; }
    .head button:hover { color: #e8eaed; background: #3c4043; }
    .body { padding: 0 8px 8px; }
    .panel.min .body { display: none; }
    .prompt { color: #9aa0a6; font-size: 12px; margin-bottom: 4px; }
    ol { margin: 0; padding-left: 20px; }
    li { padding: 2px 0; cursor: pointer; font-weight: 600; }
    li:hover { color: #8ab4f8; }
    .status { color: #9aa0a6; font-size: 12px; min-height: 1em; margin-top: 4px; }
    .used { display: none; color: #9aa0a6; font-size: 11px; margin-top: 6px; border-top: 1px solid #444; padding-top: 4px; }
    .party .used { display: block; }
    .used s { color: #777; }
  </style>
  <div class="panel">
    <div class="head">
      <span class="title">Krillion Helper</span>
      <button class="refresh" title="New answers">↻</button>
      <button class="toggle" title="Collapse">–</button>
    </div>
    <div class="body">
      <div class="prompt"></div><ol></ol><div class="status"></div><div class="used"></div>
    </div>
  </div>`;
const khPanel = khRoot.querySelector(".panel");
const khPromptEl = khRoot.querySelector(".prompt");
const khList = khRoot.querySelector("ol");
const khStatus = khRoot.querySelector(".status");
const khUsedEl = khRoot.querySelector(".used");
const khToggle = khRoot.querySelector(".toggle");
khRoot.querySelector(".title").onclick = khToggle.onclick = () => {
  khPanel.classList.toggle("min");
  khToggle.textContent = khPanel.classList.contains("min") ? "+" : "–";
};
khRoot.querySelector(".refresh").onclick = () => {
  if (khLast) khAnswer(khLast, true);
};

function khShowPanel() {
  if (!khHost.isConnected) document.documentElement.append(khHost);
}

// Puts an answer in the game's answer box, ready to submit. The game is a React
// app, so the value goes through the native setter plus an input event; setting
// .value directly would be ignored. Falls back to copying if there's no box.
async function khFill(answer) {
  const input =
    document.querySelector("#answer-input") ||
    document.querySelector('input[aria-label*="your answer" i], input[placeholder*="answer" i]');
  if (!input || input.disabled || input.getAttribute("aria-disabled") === "true") {
    await navigator.clipboard.writeText(answer);
    khStatus.textContent = `No answer box right now. Copied "${answer}"`;
    return;
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setValue.call(input, answer);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  khStatus.textContent = `Filled "${answer}". Press Enter to send.`;
}

// ---- Puffer Party: answers other players have used ---------------------------

let khParty = false;
let khUsed = new Map(); // normalized answer -> answer as said, for the current prompt
let khStale = new Set(); // bubbles left over from the previous question
let khStaleUntil = 0;

// "The Rolling Stones" and "rolling stones!" count as the same answer.
const khNorm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");

async function khLoadUsed(prompt) {
  const { partyUsed = {} } = await chrome.storage.local.get("partyUsed");
  khUsed = new Map((partyUsed[prompt] ?? []).map((a) => [khNorm(a), a]));
}

// Saved per question, so a category that comes back later starts with its used list.
let khSaving = Promise.resolve();
function khSaveUsed(prompt, answer) {
  khSaving = khSaving.then(async () => {
    const { partyUsed = {} } = await chrome.storage.local.get("partyUsed");
    const list = partyUsed[prompt] ?? [];
    if (!list.some((a) => khNorm(a) === khNorm(answer))) list.push(answer);
    delete partyUsed[prompt]; // re-insert so the newest questions are kept below
    partyUsed[prompt] = list;
    const keys = Object.keys(partyUsed);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete partyUsed[k];
    await chrome.storage.local.set({ partyUsed });
  });
}

function khRecordUsed(answer) {
  const n = khNorm(answer);
  if (!n || !khLast || khUsed.has(n)) return;
  if (Date.now() < khStaleUntil && khStale.has(n)) return;
  khUsed.set(n, answer);
  khSaveUsed(khLast, answer);
  khRenderUsed();
  // Drop suggestions someone just took.
  for (const li of [...khList.children]) if (khNorm(li.dataset.answer) === n) li.remove();
}

function khRenderUsed() {
  const used = [...khUsed.values()];
  khUsedEl.textContent = "";
  khUsedEl.append(`Used (${used.length}): `);
  used.forEach((a, i) => {
    const s = document.createElement("s");
    s.textContent = a;
    khUsedEl.append(s, i < used.length - 1 ? ", " : "");
  });
}

// Accepted answers show as speech bubbles (.pf-say with "ok", then "rest");
// repeats are rejected with a "“x”: already said" banner.
function khScanUsed() {
  for (const say of document.querySelectorAll(".pf-say.ok, .pf-say.rest")) {
    const text = say.textContent.trim();
    if (text) khRecordUsed(text);
  }
  for (const reject of document.querySelectorAll(".ds-reject")) {
    const m = reject.textContent.match(/^[“"](.+)[”"]:\s*already said/i);
    if (m) khRecordUsed(m[1]);
  }
}

function khSetParty(on) {
  khParty = on;
  khPanel.classList.toggle("party", on);
  khRoot.querySelector(".title").textContent = on ? "Krillion Helper · Party" : "Krillion Helper";
}

// ---- Answering --------------------------------------------------------------

let khLast = "";
let khAbort = null;
let khShown = []; // every answer shown for the current prompt

// `fresh` asks for new answers, skipping everything already shown.
async function khAnswer(prompt, fresh = false) {
  khAbort?.abort();
  const abort = (khAbort = new AbortController());
  if (!fresh) khShown = [];
  const exclude = [...khShown, ...(khParty ? khUsed.values() : [])];
  khShowPanel();
  khPromptEl.textContent = prompt;
  khList.innerHTML = "";
  khStatus.textContent = fresh ? "Getting new answers…" : "Thinking…";
  try {
    for await (const answer of khAnswers(prompt, abort.signal, exclude)) {
      if (abort.signal.aborted) return;
      khShown.push(answer);
      if (khParty && khUsed.has(khNorm(answer))) continue;
      const li = document.createElement("li");
      li.textContent = answer;
      li.dataset.answer = answer;
      li.onclick = () => khFill(answer);
      khList.append(li);
      khStatus.textContent = "";
    }
    if (!khList.children.length) khStatus.textContent = "All suggestions were taken. Click ↻ for more.";
  } catch (err) {
    if (!abort.signal.aborted) khStatus.textContent = `Error: ${err.message}`;
  }
}

async function khNewPrompt(prompt) {
  khLast = prompt;
  if (khParty) {
    // Bubbles from the last question can linger for a moment; don't count them here.
    khStale = new Set([...document.querySelectorAll(".pf-say")].map((s) => khNorm(s.textContent)));
    khStaleUntil = Date.now() + 3000;
    await khLoadUsed(prompt);
    if (khLast !== prompt) return;
    khRenderUsed();
  }
  khAnswer(prompt);
}

function khCheck() {
  const prompt = khFindPrompt();
  if (prompt && prompt !== khLast) khNewPrompt(prompt);
  if (khParty && khLast) khScanUsed();
}

async function khStart() {
  const { partyMode } = await chrome.storage.local.get("partyMode");
  khSetParty(Boolean(partyMode));
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.partyMode) return;
    khSetParty(Boolean(changes.partyMode.newValue));
    if (khLast) khNewPrompt(khLast);
  });

  if (!(await khReady())) {
    if (khFindPrompt()) {
      khShowPanel();
      khStatus.textContent = "Add your Anthropic API key in Krillion Helper's Settings or .env, then reload.";
    }
    return;
  }
  let pending = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(khCheck);
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  khCheck();
}

khStart();
