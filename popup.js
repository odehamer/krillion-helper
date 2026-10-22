const promptEl = document.getElementById("prompt");
const sourceEl = document.getElementById("source");
const statusEl = document.getElementById("status");
const answersEl = document.getElementById("answers");
const goBtn = document.getElementById("go");
const againBtn = document.getElementById("again");
const partyEl = document.getElementById("party");

// Puffer Party mode lives in storage; the on-page panel picks up changes live.
chrome.storage.local.get("partyMode").then(({ partyMode }) => (partyEl.checked = Boolean(partyMode)));
partyEl.addEventListener("change", () => chrome.storage.local.set({ partyMode: partyEl.checked }));

// Answers other players already used for this question (Puffer Party mode only).
async function usedFor(prompt) {
  if (!partyEl.checked) return [];
  const { partyUsed = {} } = await chrome.storage.local.get("partyUsed");
  return partyUsed[prompt] ?? [];
}

const PROMPT_START = /^(name|list|give|guess|think of|type)\b/i;

// Runs in every frame of the tab (the game lives in an iframe on krillion.org).
function readFrame() {
  const clean = (s) => (s || "").trim().replace(/\s+/g, " ");
  // Puffer Party's category card ("New category" is a placeholder card).
  const card = document.querySelector(".ds-card:not(.pf-newcat):not(.gone) .prompt");
  const headings = [...document.querySelectorAll("h1,h2,h3,[class*=prompt i],[class*=question i]")]
    .filter((el) => el.getClientRects().length)
    .map((el) => clean(el.innerText))
    .filter((t) => t.length >= 6 && t.length <= 250);
  return { selection: clean(window.getSelection().toString()), card: clean(card?.innerText), headings };
}

async function findPrompt() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const frames = (
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: readFrame })
    ).map((f) => f.result).filter(Boolean);
    const selection = frames.map((f) => f.selection).find(Boolean);
    if (selection) return { prompt: selection, how: "your selection" };
    const card = frames.map((f) => f.card).find(Boolean);
    if (card) return { prompt: card, how: "the category card" };
    const heading = frames.flatMap((f) => f.headings).find((t) => PROMPT_START.test(t));
    if (heading) return { prompt: heading, how: "the page" };
  } catch {}
  return null;
}

let shown = []; // every answer shown for `shownFor`
let shownFor = "";

// `fresh` asks for new answers, skipping everything already shown.
async function getAnswers(fresh = false) {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  if (!fresh || prompt !== shownFor) shown = [];
  shownFor = prompt;
  const exclude = [...shown, ...(await usedFor(prompt))];
  goBtn.disabled = againBtn.disabled = true;
  answersEl.innerHTML = "";
  statusEl.textContent = fresh ? "Getting new answers…" : "Thinking…";
  try {
    for await (const answer of khAnswers(prompt, undefined, exclude)) {
      shown.push(answer);
      const li = document.createElement("li");
      li.textContent = answer;
      li.onclick = async () => {
        await navigator.clipboard.writeText(answer);
        statusEl.textContent = `Copied "${answer}"`;
      };
      answersEl.append(li);
      statusEl.textContent = "";
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    goBtn.disabled = false;
    againBtn.disabled = !shown.length;
  }
}

async function init() {
  if (!(await khReady())) {
    statusEl.textContent = "Add your Anthropic API key in Settings (or the .env file) first.";
    goBtn.disabled = true;
    return;
  }
  const found = await findPrompt();
  if (found) {
    promptEl.value = found.prompt;
    sourceEl.textContent = `Read from ${found.how}. Edit if it's wrong.`;
    getAnswers();
  } else {
    sourceEl.textContent = "Couldn't find a prompt on screen. Type it above.";
  }
}

goBtn.addEventListener("click", () => getAnswers());
againBtn.addEventListener("click", () => getAnswers(true));
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    getAnswers();
  }
});
init();
