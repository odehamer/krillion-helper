const keyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["apiKey", "model"]).then(({ apiKey, model }) => {
  if (apiKey) keyEl.value = apiKey;
  if (model) modelEl.value = model;
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiKey: keyEl.value.trim(), model: modelEl.value });
  statusEl.textContent = "Saved. Reload the game page to use it.";
});
