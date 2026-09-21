import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const GREETINGS = [
  "오늘은 어떤 직업으로 이야기해볼까요?",
  "되고 싶은 직업을 알려주세요.",
  "어떤 전문가의 시선으로 대화할까요?",
  "만나서 반갑습니다. 어떤 직업이 궁금하신가요?",
  "직업을 고르면, 그 사람이 되어 답할게요.",
  "오늘의 역할을 정해 주세요.",
];

const MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

const ui = {
  screens: [...document.querySelectorAll(".screen")],
  greeting: document.getElementById("greeting"),
  jobForm: document.getElementById("job-form"),
  jobInput: document.getElementById("job-input"),
  prepKicker: document.getElementById("prep-kicker"),
  prepTitle: document.getElementById("prep-title"),
  prepSteps: document.getElementById("prep-steps"),
  prepTerminal: document.getElementById("prep-terminal"),
  summaryTerminal: document.getElementById("summary-terminal"),
  topbarJob: document.getElementById("topbar-job"),
  transcript: document.getElementById("transcript"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  sendBtn: document.getElementById("send-btn"),
  endBtn: document.getElementById("end-btn"),
  summaryJob: document.getElementById("summary-job"),
  summaryCard: document.getElementById("summary-card"),
  restartBtn: document.getElementById("restart-btn"),
};

const state = {
  job: "",
  systemPrompt: "",
  messages: [],
  busy: false,
};

let enginePromise = null;
let progressHandler = () => {};

function showScreen(name) {
  ui.screens.forEach((screen) => {
    const active = screen.dataset.screen === name;
    screen.classList.toggle("is-active", active);
    screen.hidden = !active;
    screen.toggleAttribute("inert", !active);
    screen.setAttribute("aria-hidden", active ? "false" : "true");
  });

  const inChat = name === "chat";
  const showJob = name === "chat" || name === "summarizing" || name === "summary";
  ui.endBtn.hidden = !inChat;
  ui.topbarJob.hidden = !showJob;
  if (showJob) ui.topbarJob.textContent = state.job;
}

function setPrepStep(current) {
  const order = ["prompt", "test", "ui"];
  const index = order.indexOf(current);
  ui.prepSteps.querySelectorAll("li").forEach((item) => {
    const step = item.dataset.step;
    item.classList.toggle("is-current", step === current);
    item.classList.toggle("is-done", order.indexOf(step) < index);
  });
}

function clearTerminal(node) {
  node.replaceChildren();
}

function termCommand(node, name) {
  const line = document.createElement("div");
  line.className = "term-cmd";
  line.textContent = `--${name}--`;
  node.appendChild(line);
  node.scrollTop = node.scrollHeight;
}

function termBlock(node) {
  const out = document.createElement("div");
  out.className = "term-out";
  node.appendChild(out);
  return out;
}

function termSet(out, text, scroller) {
  out.textContent = text;
  scroller.scrollTop = scroller.scrollHeight;
}

function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/^(?!<(h\d|ul|li))(.+)$/gm, "<p>$2</p>")
    .replace(/<p><\/p>/g, "");
}

function addBubble(role, content, pending = false) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}${pending ? " pending" : ""}`;
  bubble.textContent = content;
  ui.transcript.appendChild(bubble);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return bubble;
}

function fallbackSystem(job) {
  return `당신은 '${job}'입니다. 그 직업의 일반적인 실무 전문가처럼 대화하세요.

규칙:
- 한국어 존댓말만 사용합니다.
- 특이한 세부 전공, 사건명, 상품명을 지어내지 않습니다.
- 맡은 직업의 실제 업무만 말하고 다른 직업과 섞지 않습니다.
- 2~5문장으로, 구체적이되 과장하지 않습니다.
- 모르는 내용은 지어내지 않습니다.
- 위험하거나 불법적인 요청은 정중히 거절합니다.`;
}

function parseSetup(raw, job) {
  const generated = raw
    .replace(/^SYSTEM:\s*/i, "")
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .trim();
  if (generated.length > 40 && generated.includes(job)) {
    return `${fallbackSystem(job)}\n\n역할 메모:\n${generated.slice(0, 500)}`;
  }
  return fallbackSystem(job);
}

function pickGreeting(job, reply) {
  const text = (reply || "").trim();
  const invented = /(불법|도매|회수|사건|전담|전용 상품)/.test(text);
  if (text && text.includes(job) && text.length <= 220 && !invented) {
    return text;
  }
  return `안녕하세요. ${job}입니다. 궁금한 점을 편하게 물어보세요.`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEngine() {
  if (!navigator.gpu) {
    return Promise.reject(new Error("이 브라우저는 웹 GPU를 지원하지 않습니다. Chrome 또는 Edge로 열어 주세요."));
  }
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL, {
      initProgressCallback: (report) => progressHandler(report),
    });
  }
  return enginePromise;
}

async function complete({ messages, stream = false, onChunk, maxTokens = 400 }) {
  const engine = await getEngine();
  const request = {
    messages,
    temperature: 0.5,
    max_tokens: maxTokens,
    stream,
  };

  if (stream) {
    const chunks = await engine.chat.completions.create(request);
    let text = "";
    for await (const chunk of chunks) {
      text += chunk.choices?.[0]?.delta?.content || "";
      onChunk?.(text.trim());
    }
    if (!text.trim()) throw new Error("응답을 만들지 못했습니다.");
    return text.trim();
  }

  const result = await engine.chat.completions.create(request);
  const text = (result.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("응답을 만들지 못했습니다.");
  return text;
}

async function setupRole(job) {
  const term = ui.prepTerminal;
  clearTerminal(term);

  termCommand(term, "loading model");
  const loadOut = termBlock(term);
  progressHandler = (report) => {
    const percent = Math.round((report.progress || 0) * 100);
    const done = percent >= 100 || /finish/i.test(report.text || "");
    termSet(loadOut, done ? "done" : `${percent}%`, term);
  };

  await getEngine();
  termSet(loadOut, "done", term);

  setPrepStep("prompt");
  termCommand(term, "creating system prompt");
  const promptOut = termBlock(term);
  const raw = await complete({
    maxTokens: 280,
    stream: true,
    onChunk: (text) => termSet(promptOut, text, term),
    messages: [
      {
        role: "system",
        content: "역할극용 시스템 프롬프트만 짧게 작성합니다. 설명 없이 본문만 출력합니다.",
      },
      {
        role: "user",
        content: `직업: ${job}

일반적이고 평범한 ${job} 역할의 시스템 프롬프트를 한국어 6줄 이내로 작성하세요.
- 특이한 세부 전공, 사건, 상품, 회사명을 만들지 마세요.
- '${job}'라는 직업 자체로만 설정하세요.`,
      },
    ],
  });

  const systemPrompt = parseSetup(raw, job);
  termSet(promptOut, systemPrompt, term);

  setPrepStep("test");
  termCommand(term, "testing response");
  const testOut = termBlock(term);
  const testReply = await complete({
    maxTokens: 120,
    stream: true,
    onChunk: (text) => termSet(testOut, text, term),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `첫 인사만 하세요. 반드시 "안녕하세요. ${job}입니다."로 시작하세요. 이어서 무엇을 도와줄 수 있는지 한 문장만 덧붙이세요. 세부 전공을 만들지 마세요.`,
      },
    ],
  });

  setPrepStep("ui");
  termCommand(term, "preparing chat ui");
  const uiOut = termBlock(term);
  termSet(uiOut, "ready", term);
  await wait(350);

  return {
    systemPrompt,
    greeting: pickGreeting(job, testReply),
  };
}

function resetWelcome() {
  state.job = "";
  state.systemPrompt = "";
  state.messages = [];
  state.busy = false;
  ui.jobInput.value = "";
  ui.transcript.replaceChildren();
  clearTerminal(ui.prepTerminal);
  clearTerminal(ui.summaryTerminal);
  ui.prepSteps.querySelectorAll("li").forEach((item) => {
    item.classList.remove("is-current", "is-done");
  });
  ui.greeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  showScreen("welcome");
  ui.jobInput.focus();
}

ui.jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const job = ui.jobInput.value.trim();
  if (!job || state.busy) return;

  ui.jobForm.querySelector(".error")?.remove();
  state.busy = true;
  state.job = job;
  ui.prepKicker.textContent = "준비 중...";
  ui.prepTitle.textContent = `${job} 역할을 만들고 있습니다`;
  showScreen("preparing");
  setPrepStep("prompt");

  try {
    const setup = await setupRole(job);
    state.systemPrompt = setup.systemPrompt;
    state.messages = [{ role: "assistant", content: setup.greeting }];
    ui.transcript.replaceChildren();
    addBubble("bot", setup.greeting);
    showScreen("chat");
    ui.chatInput.focus();
  } catch (error) {
    showScreen("welcome");
    ui.jobForm.querySelector(".error")?.remove();
    const note = document.createElement("p");
    note.className = "error";
    note.textContent = error.message || "잠시 후 다시 시도해 주세요.";
    ui.jobForm.appendChild(note);
  } finally {
    state.busy = false;
  }
});

ui.chatInput.addEventListener("input", () => {
  ui.chatInput.style.height = "auto";
  ui.chatInput.style.height = `${Math.min(ui.chatInput.scrollHeight, 128)}px`;
});

ui.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    ui.chatForm.requestSubmit();
  }
});

ui.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = ui.chatInput.value.trim();
  if (!text || state.busy) return;

  state.busy = true;
  ui.chatInput.value = "";
  ui.chatInput.style.height = "auto";
  ui.sendBtn.disabled = true;
  state.messages.push({ role: "user", content: text });
  addBubble("user", text);
  const pending = addBubble("bot", "답변을 준비하는 중...", true);

  try {
    const reply = await complete({
      messages: [
        { role: "system", content: state.systemPrompt },
        ...state.messages,
      ],
      stream: true,
      onChunk: (chunk) => {
        pending.classList.remove("pending");
        pending.textContent = chunk;
        ui.transcript.scrollTop = ui.transcript.scrollHeight;
      },
    });
    pending.classList.remove("pending");
    pending.textContent = reply;
    state.messages.push({ role: "assistant", content: reply });
  } catch (error) {
    pending.classList.remove("pending");
    pending.textContent = error.message || "답변을 만들지 못했습니다. 다시 보내 주세요.";
    state.messages.pop();
  } finally {
    state.busy = false;
    ui.sendBtn.disabled = false;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    ui.chatInput.focus();
  }
});

ui.endBtn.addEventListener("click", async () => {
  if (state.busy) return;
  state.busy = true;
  showScreen("summarizing");
  clearTerminal(ui.summaryTerminal);
  termCommand(ui.summaryTerminal, "writing summary");
  const out = termBlock(ui.summaryTerminal);

  try {
    const summary = await complete({
      maxTokens: 500,
      stream: true,
      onChunk: (text) => termSet(out, text, ui.summaryTerminal),
      messages: [
        {
          role: "system",
          content: "면담 기록을 한국어 마크다운으로만 짧게 정리하세요. 없는 내용은 만들지 마세요.",
        },
        {
          role: "user",
          content: `직업: ${state.job}

대화:
${state.messages.map((item) => `${item.role === "user" ? "사용자" : "전문가"}: ${item.content}`).join("\n") || "(대화 없음)"}

형식:
## 대화 개요
## 주요 질문과 답변
## 핵심 조언
## 다음 단계`,
        },
      ],
    });
    ui.summaryJob.textContent = state.job;
    ui.summaryCard.innerHTML = renderMarkdown(summary.replace(/^#\s*면담 요약\s*/i, "").trim());
    showScreen("summary");
  } catch (error) {
    ui.summaryJob.textContent = state.job;
    ui.summaryCard.innerHTML = `<p>${error.message || "요약을 만들지 못했습니다."}</p>`;
    showScreen("summary");
  } finally {
    state.busy = false;
  }
});

ui.restartBtn.addEventListener("click", resetWelcome);

resetWelcome();
getEngine().catch(() => {});
