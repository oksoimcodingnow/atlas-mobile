// ATLAS Mobile — chat client
// Streams from /api/chat using Server-Sent Events. Handles text, tool calls, and errors.

const chatArea = document.getElementById("chatArea");
const emptyState = document.getElementById("emptyState");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const repoInput = document.getElementById("repoInput");
const modelBar = document.getElementById("modelBar");
const greetEl = document.getElementById("greet");

const STATE = {
  history: [],
  selectedModel: localStorage.getItem("atlas.model") || "claude-opus-4-7",
  defaultRepo: localStorage.getItem("atlas.repo") || "",
  busy: false,
};

// === init ===
repoInput.value = STATE.defaultRepo;
repoInput.addEventListener("input", () => {
  localStorage.setItem("atlas.repo", repoInput.value.trim());
});

document.querySelectorAll(".pill").forEach((p) => {
  p.classList.toggle("active", p.dataset.model === STATE.selectedModel);
  p.addEventListener("click", () => {
    STATE.selectedModel = p.dataset.model;
    localStorage.setItem("atlas.model", STATE.selectedModel);
    document.querySelectorAll(".pill").forEach((x) =>
      x.classList.toggle("active", x.dataset.model === STATE.selectedModel)
    );
  });
});

// greeting
const h = new Date().getHours();
greetEl.textContent =
  h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

// auto-resize textarea
msgInput.addEventListener("input", () => {
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + "px";
});
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
sendBtn.addEventListener("click", send);

// === UI helpers ===
function clearEmpty() {
  if (emptyState && emptyState.parentNode) emptyState.remove();
}
function addBubble(role, text = "") {
  clearEmpty();
  const el = document.createElement("div");
  el.className = "bubble " + role;
  el.textContent = text;
  chatArea.appendChild(el);
  chatArea.scrollTop = chatArea.scrollHeight;
  return el;
}
function setCursor(bubble) {
  const c = document.createElement("span");
  c.className = "cursor";
  bubble.appendChild(c);
}

// === send ===
async function send() {
  const text = msgInput.value.trim();
  if (!text || STATE.busy) return;

  const repo = repoInput.value.trim();
  addBubble("user", text);
  STATE.history.push({ role: "user", content: text });

  msgInput.value = "";
  msgInput.style.height = "auto";
  STATE.busy = true;
  sendBtn.disabled = true;

  let bubble = addBubble("atlas thinking", "");
  setCursor(bubble);
  let buffer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: STATE.history,
        model: STATE.selectedModel,
        repo,
      }),
    });

    if (!res.ok || !res.body) {
      const errTxt = await res.text();
      throw new Error(errTxt || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      // SSE: split on double-newline
      const events = pending.split("\n\n");
      pending = events.pop() || "";

      for (const raw of events) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        let evt;
        try { evt = JSON.parse(payload); }
        catch { continue; }

        if (evt.type === "text") {
          if (bubble.classList.contains("thinking")) {
            bubble.classList.remove("thinking");
            bubble.textContent = "";
          }
          buffer += evt.text;
          bubble.textContent = buffer;
          setCursor(bubble);
          chatArea.scrollTop = chatArea.scrollHeight;
        } else if (evt.type === "tool_use") {
          // Show a tool-call indicator and start a new assistant bubble for the next text
          bubble.querySelectorAll(".cursor").forEach((n) => n.remove());
          if (!buffer) bubble.remove();
          const toolBubble = addBubble("tool", `▶ ${evt.name}(${JSON.stringify(evt.input)})`);
          bubble = addBubble("atlas thinking", "");
          setCursor(bubble);
          buffer = "";
        } else if (evt.type === "tool_result") {
          const status = evt.is_error ? "✗" : "✓";
          addBubble("tool", `${status} ${evt.summary || ""}`);
        } else if (evt.type === "done") {
          bubble.querySelectorAll(".cursor").forEach((n) => n.remove());
          if (!buffer && bubble.parentNode) bubble.remove();
          STATE.history.push({ role: "assistant", content: buffer });
          break;
        } else if (evt.type === "error") {
          throw new Error(evt.message || "Server error");
        }
      }
    }
  } catch (err) {
    if (bubble && bubble.parentNode) bubble.remove();
    addBubble("error", "⚠ " + (err.message || String(err)));
  } finally {
    STATE.busy = false;
    sendBtn.disabled = false;
    msgInput.focus();
  }
}
