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
  prepProgress: document.getElementById("prep-progress"),
  prepBar: document.getElementById("prep-bar"),
  prepSteps: document.getElementById("prep-steps"),
  chatJob: document.getElementById("chat-job"),
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

function fallbackSystem(job, extras = {}) {
  const years = extras.years || "여러 해";
  const focus = extras.focus || "현장 실무";
  const tone = extras.tone || "차분하고 친절한 존댓말";
  return `당신은 '${job}'입니다. 경력 ${years}년차 실무 전문가처럼 대화하세요.
전문 분야: ${focus}
말투: ${tone}

규칙:
- 한국어로만 답합니다.
- 맡은 직업의 실제 업무만 말하고, 다른 직업과 섞지 않습니다.
- 2~6문장으로, 구체적인 예시나 실무 팁을 넣습니다.
- 모르는 내용은 지어내지 않습니다.
- 위험하거나 불법적인 요청은 정중히 거절합니다.
- 필요하면 상황을 한 가지만 되묻습니다.`;
}

function parseSetup(raw, job) {
  const years = raw.match(/YEARS:\s*([^\n]+)/i)?.[1]?.trim();
  const focus = raw.match(/FOCUS:\s*([^\n]+)/i)?.[1]?.trim();
  const tone = raw.match(/TONE:\s*([^\n]+)/i)?.[1]?.trim();
  const greeting = raw.match(/GREETING:\s*([\s\S]*)$/i)?.[1]?.trim();
  const systemMatch = raw.match(/SYSTEM:\s*([\s\S]*?)(?:\nGREETING:|$)/i);
  const extras = {
    years: years && years.length < 20 ? years : "",
    focus: focus && focus.length < 80 ? focus : "",
    tone: tone && tone.length < 80 ? tone : "",
  };
  const generated = (systemMatch?.[1] || "").trim();
  const systemPrompt = generated.length > 50 && generated.includes(job)
    ? `${fallbackSystem(job, extras)}\n\n역할 메모:\n${generated.slice(0, 600)}`
    : fallbackSystem(job, extras);
  return { systemPrompt, greeting };
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

async function complete({ messages, stream = false, onChunk, maxTokens = 512 }) {
  const engine = await getEngine();
  const request = {
    messages,
    temperature: 0.7,
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
  progressHandler = (report) => {
    const percent = Math.round((report.progress || 0) * 100);
    const done = percent >= 100 || /finish/i.test(report.text || "");
    ui.prepProgress.textContent = done
      ? "모델 준비 완료"
      : `모델을 불러오는 중${Number.isFinite(percent) ? ` (${percent}%)` : ""}`;
    if (ui.prepBar) {
      ui.prepBar.hidden = done || percent <= 0;
      ui.prepBar.querySelector("span").style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
    }
  };

  await getEngine();
  ui.prepProgress.textContent = "";
  if (ui.prepBar) ui.prepBar.hidden = true;

  setPrepStep("prompt");
  const raw = await complete({
    maxTokens: 700,
    messages: [
      {
        role: "system",
        content:
          "당신은 역할극 봇을 설정하는 도우미입니다. 요청한 출력 형식만 지키고, 다른 설명은 쓰지 마세요.",
      },
      {
        role: "user",
        content: `직업: ${job}

아래 네 줄 형식으로만, 한국어로 짧게 채우세요.
YEARS: (숫자)
FOCUS: (전문 분야 한 줄)
TONE: (말투 한 줄)
GREETING: (그 직업의 전문가로서 2~4문장 첫 인사)`,
      },
    ],
  });

  setPrepStep("test");
  const parsed = parseSetup(raw, job);
  const testReply = await complete({
    maxTokens: 180,
    messages: [
      { role: "system", content: parsed.systemPrompt },
      { role: "user", content: "맡은 직업으로 자기소개와 오늘 도와줄 수 있는 것을 2~4문장으로 인사하세요." },
    ],
  });

  if (!testReply) {
    throw new Error("역할 응답을 확인하지 못했습니다.");
  }

  setPrepStep("ui");
  await wait(400);
  return {
    systemPrompt: parsed.systemPrompt,
    greeting: testReply || parsed.greeting || `안녕하세요. ${job}입니다. 무엇을 도와드릴까요?`,
  };
}

function resetWelcome() {
  state.job = "";
  state.systemPrompt = "";
  state.messages = [];
  state.busy = false;
  ui.jobInput.value = "";
  ui.transcript.replaceChildren();
  ui.greeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  showScreen("welcome");
  ui.jobInput.focus();
}

ui.jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const job = ui.jobInput.value.trim();
  if (!job || state.busy) return;

  state.busy = true;
  state.job = job;
  ui.prepKicker.textContent = "준비 중...";
  ui.prepTitle.textContent = `${job} 역할을 만들고 있습니다`;
  ui.prepProgress.textContent = "모델을 준비하고 있습니다.";
  showScreen("preparing");
  setPrepStep("prompt");

  try {
    const setup = await setupRole(job);
    state.systemPrompt = setup.systemPrompt;
    state.messages = [{ role: "assistant", content: setup.greeting }];
    ui.chatJob.textContent = job;
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
  ui.chatInput.style.height = `${Math.min(ui.chatInput.scrollHeight, 140)}px`;
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

  try {
    const summary = await complete({
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content: "당신은 면담 기록을 깔끔하게 정리하는 한국어 요약가입니다. 마크다운으로만 답하세요.",
        },
        {
          role: "user",
          content: `직업: ${state.job}

대화:
${state.messages.map((item) => `${item.role === "user" ? "사용자" : "전문가"}: ${item.content}`).join("\n") || "(대화 없음)"}

아래 형식으로 면담 요약을 작성하세요.
# 면담 요약
## 직업
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
