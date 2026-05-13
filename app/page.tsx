"use client";
/**
 * ATLAS MOBILE — Chat Page
 * ========================
 *
 * REACT 101 (read this if you're new):
 *
 * Everything between `function ChatPage() {` and the closing `}` is one
 * REACT COMPONENT. A component is just a JavaScript function that returns
 * JSX (the HTML-looking stuff). React calls it to render the screen.
 *
 * "use client" at the top — Next.js by default renders components on the
 * SERVER. This file needs browser stuff (useState, fetch, event handlers),
 * so we mark it as a Client Component. The "use client" directive tells
 * Next.js: "run this in the user's browser, not on the server."
 *
 * HOOKS:
 * - useState(initial) — stores a value that triggers re-render when updated.
 *   Returns [value, setterFunction]. e.g. const [msg, setMsg] = useState("")
 * - useRef(initial) — like useState but DOESN'T trigger re-render. Used
 *   for keeping references to DOM elements or values that survive renders.
 * - useEffect(fn, [deps]) — runs a side effect (e.g. scroll-to-bottom)
 *   after the component renders. The `deps` array controls when it re-runs.
 *
 * STATE FLOW:
 * 1. User types -> onChange handler calls setInput(newValue)
 * 2. React re-runs ChatPage() because state changed
 * 3. The textarea's `value={input}` reflects the new state -> screen updates
 *
 * The whole React mental model is: state changes -> UI re-renders.
 */

import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Wrench, CheckCircle2, XCircle } from "lucide-react";

// ============================================================================
// TYPES — TypeScript definitions. They don't affect runtime, just help the
// editor catch typos and give better autocomplete.
// ============================================================================

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

// Each rendered "thing" in the chat is one of these. We mix bubbles + tool
// events into one array so they render in chronological order.
type ChatItem =
  | { type: "msg"; role: Role; text: string; streaming?: boolean }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_result"; is_error: boolean; summary: string }
  | { type: "error"; text: string };

// The models that appear in the slicer at the bottom of the screen.
// "Gemini" is free up to 1500 requests/day; the Claude models are pay-per-token.
const MODELS = [
  { id: "gemini-2.5-flash", label: "GEMINI", cost: "FREE" },
  { id: "claude-haiku-4-5", label: "HAIKU", cost: "$1/$5" },
  { id: "claude-sonnet-4-6", label: "SONNET", cost: "$3/$15" },
  { id: "claude-opus-4-7", label: "OPUS", cost: "$5/$25" },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ChatPage() {
  // --- STATE ---
  // `items` is the rendered chat (messages + tool events, in order).
  const [items, setItems] = useState<ChatItem[]>([]);
  // `history` is what we send to the AI as the conversation context.
  // We keep this separate from `items` so tool events don't pollute the prompt.
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [repo, setRepo] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [busy, setBusy] = useState(false);

  // --- REFS ---
  // useRef gives us a stable reference to a DOM element. Used here to
  // auto-scroll the chat area when new messages arrive.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // --- EFFECTS ---
  // Load saved settings from localStorage on first render.
  // The `[]` empty dependency array means: run ONCE when component mounts.
  useEffect(() => {
    const savedRepo = localStorage.getItem("atlas.repo") || "";
    const savedModel = localStorage.getItem("atlas.model") || "gemini-2.5-flash";
    setRepo(savedRepo);
    setModel(savedModel);
  }, []);

  // Persist settings whenever they change.
  // The `[repo]` dependency array means: re-run when `repo` changes.
  useEffect(() => { localStorage.setItem("atlas.repo", repo); }, [repo]);
  useEffect(() => { localStorage.setItem("atlas.model", model); }, [model]);

  // Auto-scroll to the bottom of the chat whenever items change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  // --- HELPERS ---
  // Append an item to the chat. We use the "functional setState" pattern
  // (passing a function instead of a value) — safer when multiple updates
  // happen in quick succession (e.g. streaming chunks).
  function pushItem(item: ChatItem) {
    setItems((prev) => [...prev, item]);
  }

  // Update the last assistant message in `items` — used when streaming
  // text deltas arrive from the server.
  function appendToLastAssistant(text: string) {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === "msg" && last.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + text, streaming: true },
        ];
      }
      return [...prev, { type: "msg", role: "assistant", text, streaming: true }];
    });
  }

  // Mark the most recent assistant message as done streaming (removes cursor).
  function finalizeLastAssistant() {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === "msg" && last.role === "assistant") {
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      }
      return prev;
    });
  }

  // --- SEND HANDLER ---
  // This is where the magic happens: we POST to /api/chat, then read
  // Server-Sent Events (SSE) from the streaming response.
  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    // Add the user's message to both the rendered chat and the AI history.
    pushItem({ type: "msg", role: "user", text });
    const nextHistory = [...history, { role: "user" as Role, content: text }];
    setHistory(nextHistory);
    setInput("");
    setBusy(true);

    // Track the streaming response so we can save it to history at the end.
    let assistantBuffer = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory, model, repo }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      // Stream reader — reads bytes off the response one chunk at a time.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        // SSE format: events separated by blank lines, each line starts with "data: ".
        const events = pending.split("\n\n");
        pending = events.pop() || "";

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          let evt: { type: string; [key: string]: unknown };
          try { evt = JSON.parse(payload); } catch { continue; }

          if (evt.type === "text") {
            const chunk = evt.text as string;
            assistantBuffer += chunk;
            appendToLastAssistant(chunk);
          } else if (evt.type === "tool_use") {
            finalizeLastAssistant();
            assistantBuffer = "";
            pushItem({
              type: "tool",
              name: evt.name as string,
              input: evt.input,
            });
          } else if (evt.type === "tool_result") {
            pushItem({
              type: "tool_result",
              is_error: !!evt.is_error,
              summary: (evt.summary as string) || "",
            });
          } else if (evt.type === "done") {
            finalizeLastAssistant();
            break;
          } else if (evt.type === "error") {
            throw new Error((evt.message as string) || "Server error");
          }
        }
      }

      // Save the assistant's final reply to history for context next turn.
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: assistantBuffer },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushItem({ type: "error", text: "ERROR: " + msg });
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setItems([]);
    setHistory([]);
  }

  // Time-aware greeting for the empty state.
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Working late";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  // --- RENDER ---
  // Everything below is JSX. JSX looks like HTML but it's actually JavaScript.
  // - `className` instead of `class`
  // - `{expression}` to interpolate variables
  // - Events use camelCase (onClick, onChange) and take FUNCTIONS, not strings
  // - className uses Tailwind utility classes (`flex`, `text-cyan`, etc.)
  return (
    <div className="flex flex-col h-[100dvh] relative z-10">
      {/* HEADER */}
      <header className="flex justify-between items-center px-4 pt-[calc(var(--safe-top)+12px)] pb-3 border-b border-cyan/20">
        <div className="text-base tracking-[0.35em] text-cyan [text-shadow:0_0_12px_rgba(0,229,255,0.5)]">
          A · T · L · A · S
        </div>
        <div className="flex items-center gap-3 text-[0.65rem] tracking-widest text-cyan-dim">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 bg-cyan rounded-full atlas-pulse [box-shadow:0_0_8px_var(--color-cyan)]" />
            ONLINE
          </span>
          {items.length > 0 && (
            <button
              onClick={clear}
              className="flex items-center gap-1 px-2 py-1 border border-cyan/30 hover:border-cyan hover:text-cyan transition"
              aria-label="Clear chat"
            >
              <Trash2 size={11} />
              CLEAR
            </button>
          )}
        </div>
      </header>

      {/* CHAT AREA */}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3.5 py-3.5 flex flex-col gap-3"
      >
        {items.length === 0 ? <EmptyState greeting={greeting} /> : null}
        {/* React way to render a list: .map() each item to JSX, give each a `key` */}
        {items.map((item, idx) => (
          <Bubble key={idx} item={item} />
        ))}
      </main>

      {/* COMPOSER — repo bar + input + model picker */}
      <footer className="relative z-10 border-t border-cyan/20 bg-bg/95 backdrop-blur px-3 pt-2.5 pb-[calc(var(--safe-bottom)+10px)]">
        <div className="flex items-center gap-2 mb-2 text-[0.7rem] tracking-widest text-cyan-dim">
          <label className="shrink-0">repo</label>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo (e.g. oksoimcodingnow/roshop)"
            className="flex-1 bg-bg-2/40 border border-cyan/25 text-text px-2.5 py-1.5 text-xs outline-none focus:border-cyan"
            autoComplete="off"
          />
        </div>

        <div className="flex gap-2 items-stretch mb-2">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Talk to ATLAS..."
            className="flex-1 bg-bg-2/40 border border-cyan/30 text-text px-3 py-2.5 text-sm outline-none focus:border-cyan focus:[box-shadow:0_0_10px_rgba(0,229,255,0.2)] resize-none min-h-[42px] max-h-[120px] placeholder:text-cyan-dim"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="bg-cyan/15 border border-cyan text-cyan px-4 hover:bg-cyan/30 active:bg-cyan/40 disabled:opacity-40 disabled:cursor-not-allowed transition min-w-[50px] flex items-center justify-center"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>

        <div className="flex border border-cyan/25">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`flex-1 px-1.5 py-1.5 text-[0.6rem] tracking-[0.18em] border-r border-cyan/20 last:border-r-0 transition ${
                model === m.id
                  ? "bg-cyan/15 text-cyan [text-shadow:0_0_4px_rgba(0,229,255,0.5)]"
                  : "text-cyan-dim hover:bg-cyan/10 hover:text-text"
              }`}
            >
              <div>{m.label}</div>
              <div className="text-[0.5rem] opacity-55 mt-0.5">{m.cost}</div>
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS — small pieces broken out for readability.
// ============================================================================

function EmptyState({ greeting }: { greeting: string }) {
  return (
    <div className="m-auto text-center px-5 py-5">
      <div className="relative w-40 h-40 rounded-full border-2 border-cyan/40 flex items-center justify-center mx-auto mb-4 [box-shadow:0_0_30px_rgba(0,229,255,0.15),inset_0_0_30px_rgba(0,229,255,0.15)]">
        <div className="absolute -inset-2 border border-dashed border-cyan/30 rounded-full atlas-spin-slow" />
        <div className="absolute inset-2.5 rounded-full border-2 border-transparent border-t-cyan atlas-spin-fast" />
        <span className="text-lg text-cyan [text-shadow:0_0_10px_rgba(0,229,255,0.6)] relative z-10">
          {greeting}
        </span>
      </div>
      <div className="text-base text-text mb-2">
        What are we building today<span className="atlas-blink text-cyan">_</span>
      </div>
      <div className="text-xs text-cyan-dim leading-relaxed px-3">
        Ask me to read, edit, or commit code in your GitHub repos.
      </div>
    </div>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.type === "msg") {
    const isUser = item.role === "user";
    return (
      <div
        className={`relative px-3.5 py-2.5 max-w-[88%] text-sm leading-relaxed border whitespace-pre-wrap break-words ${
          isUser
            ? "self-end bg-cyan/10 border-cyan/40"
            : "self-start bg-bg-2/50 border-cyan/25"
        }`}
      >
        {!isUser && (
          <span className="absolute -top-2 left-2 bg-bg-2 text-cyan text-[0.55rem] tracking-[0.2em] px-1.5">
            ATLAS
          </span>
        )}
        {item.text}
        {item.streaming && (
          <span className="inline-block w-1.5 h-3 bg-cyan ml-0.5 align-text-bottom atlas-blink" />
        )}
      </div>
    );
  }

  if (item.type === "tool") {
    return (
      <div className="self-stretch relative px-3.5 py-2 bg-ok/[0.06] border border-ok/30 text-ok text-xs font-mono break-all">
        <span className="absolute -top-2 left-2 bg-bg-2 text-ok text-[0.55rem] tracking-[0.2em] px-1.5 flex items-center gap-1">
          <Wrench size={9} /> TOOL
        </span>
        ▶ {item.name}({JSON.stringify(item.input)})
      </div>
    );
  }

  if (item.type === "tool_result") {
    const Icon = item.is_error ? XCircle : CheckCircle2;
    const color = item.is_error ? "text-err border-err/30" : "text-ok border-ok/30";
    return (
      <div className={`self-stretch px-3.5 py-1.5 border ${color} text-xs flex items-center gap-2`}>
        <Icon size={12} />
        {item.summary}
      </div>
    );
  }

  // type === "error"
  return (
    <div className="self-start px-3.5 py-2.5 bg-err/10 border border-err/50 text-err/90 text-xs">
      {item.text}
    </div>
  );
}
