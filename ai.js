// Shared by the popup and the on-page panel: asks the background worker for
// Claude's answers and yields them one at a time as they stream in.

// True when there's a key in Settings or in the extension's .env file.
async function khReady() {
  try {
    return Boolean(await chrome.runtime.sendMessage({ type: "hasKey" }));
  } catch {
    return false;
  }
}

// `exclude` lists answers already shown, so a refresh gets new ones.
async function* khAnswers(prompt, signal, exclude = []) {
  const port = chrome.runtime.connect({ name: "kh" });
  const queue = [];
  let wake = null;
  const push = (item) => {
    queue.push(item);
    wake?.();
  };
  port.onMessage.addListener(push);
  port.onDisconnect.addListener(() => push({ done: true }));
  signal?.addEventListener("abort", () => {
    port.disconnect();
    push({ done: true });
  });
  port.postMessage({ prompt, exclude });

  try {
    for (;;) {
      if (!queue.length) await new Promise((r) => (wake = r));
      const msg = queue.shift();
      if (msg.error) throw new Error(msg.error);
      if (msg.done) return;
      yield msg.answer;
    }
  } finally {
    try {
      port.disconnect();
    } catch {}
  }
}
