import { DEFAULT_CONFIG, loadConfig, saveConfig } from "./lib/config.js";

const form = document.getElementById("options-form");
const status = document.getElementById("status");

async function fillForm() {
  const cfg = await loadConfig();
  for (const [key, value] of Object.entries(cfg)) {
    const el = form.elements.namedItem(key);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const el = form.elements.namedItem(key);
    if (!el) continue;
    if (el.type === "checkbox") data[key] = el.checked;
    else if (el.type === "number") data[key] = Number(el.value);
    else data[key] = el.value;
  }
  await saveConfig(data);
  status.textContent = "Enregistré.";
  setTimeout(() => { status.textContent = ""; }, 2500);
  chrome.runtime.sendMessage({ type: "FORCE_SYNC" });
});

fillForm();
