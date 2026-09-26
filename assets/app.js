const GREETINGS = [
  "오늘은 누구와 면담할까요?",
  "면담하고 싶은 직업을 알려 주세요.",
  "어떤 직업의 사람과 이야기해 볼까요?",
  "지금 면담하고 싶은 직업이 있나요?",
  "오늘 면담할 직업을 적어 주세요.",
  "면담을 진행해 볼까요?",
];

const MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
const HISTORY_KEY = "job-bot-history-v1";

let enginePromise = null;
let createEngine = null;
let progressHandler = () => {};

async function loadCreateEngine() {
  if (!createEngine) {
    const mod = await import("https://esm.run/@mlc-ai/web-llm");
    createEngine = mod.CreateMLCEngine;
  }
  return createEngine;
}

function getEngine() {
  if (!navigator.gpu) {
    return Promise.reject(new Error("이 브라우저는 웹 GPU를 지원하지 않습니다. Chrome 또는 Edge로 열어 주세요."));
  }
  if (!enginePromise) {
    enginePromise = loadCreateEngine().then((CreateMLCEngine) =>
      CreateMLCEngine(MODEL, {
        initProgressCallback: (report) => progressHandler(report),
      }),
    );
  }
  return enginePromise;
}

async function moderateSpeech(text = "") {
  const verdict = await complete({
    messages: [
      {
        role: "system",
        content: "욕설, 비하, 성적 모욕, 줄임 욕이면 BLOCK만 출력하세요. 아니면 OK만 출력하세요.",
      },
      { role: "user", content: String(text).slice(0, 500) },
    ],
    maxTokens: 8,
    temperature: 0,
    stream: false,
  });
  return /^\s*BLOCK\b/i.test(verdict);
}

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전", "홍"];
const GIVEN_NAMES = [
  "민준", "서준", "도윤", "시우", "주원", "현우", "지호", "성민", "재현", "태윤",
  "건우", "민재", "우진", "지훈", "동현", "승민", "준서", "예준",
  "서연", "서윤", "지우", "하은", "수빈", "예은", "수아", "유진", "민서", "채원",
  "소연", "예진", "하린", "다은", "지원", "혜원", "윤서", "가은", "지민", "수현",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickName() {
  return `${pick(SURNAMES)}${pick(GIVEN_NAMES)}`;
}

function personLabel(job = state.job, name = state.name) {
  return name ? `${name} · ${job}` : job;
}

const ui = {
  screens: [...document.querySelectorAll(".screen")],
  homeBtn: document.getElementById("home-btn"),
  historyBtn: document.getElementById("history-btn"),
  greeting: document.getElementById("greeting"),
  jobForm: document.getElementById("job-form"),
  jobInput: document.getElementById("job-input"),
  startBtn: document.getElementById("start-btn"),
  historyPanel: document.getElementById("history-panel"),
  historyList: document.getElementById("history-list"),
  prepKicker: document.getElementById("prep-kicker"),
  prepTitle: document.getElementById("prep-title"),
  loadStatus: document.getElementById("load-status"),
  prepSteps: document.getElementById("prep-steps"),
  prepTerminal: document.getElementById("prep-terminal"),
  summaryTerminal: document.getElementById("summary-terminal"),
  topbarJob: document.getElementById("topbar-job"),
  transcript: document.getElementById("transcript"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  sendBtn: document.getElementById("send-btn"),
  endBtn: document.getElementById("end-btn"),
  summaryKicker: document.getElementById("summary-kicker"),
  summaryJob: document.getElementById("summary-job"),
  summaryCard: document.getElementById("summary-card"),
  restartBtn: document.getElementById("restart-btn"),
};

const state = {
  job: "",
  name: "",
  systemPrompt: "",
  messages: [],
  busy: false,
  locked: false,
  viewingRecord: false,
};

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
  if (ui.historyBtn) ui.historyBtn.hidden = name !== "welcome";
  ui.topbarJob.hidden = !showJob;
  if (showJob) ui.topbarJob.textContent = personLabel();
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

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

function termLine(node, text, className = "term-out") {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  node.appendChild(line);
  node.scrollTop = node.scrollHeight;
  return line;
}

function termBlock(node, className = "term-out") {
  const out = document.createElement("div");
  out.className = className;
  node.appendChild(out);
  return out;
}

function termSet(out, text, scroller) {
  out.textContent = text;
  scroller.scrollTop = scroller.scrollHeight;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printLogs(node, lines) {
  for (const item of lines) {
    if (typeof item === "number") {
      await wait(item);
      continue;
    }
    const [text, className = "term-out"] = Array.isArray(item) ? item : [item];
    termLine(node, text, className);
    await wait(70);
  }
}

function humanSystem(job, name = state.name) {
  return `당신은 ${name}입니다. 한국에서 ${job}로 일하는 실제 사람입니다. 지금 면담 자리에 앉아 있습니다.

답변 형식:
- 한국어 존댓말. 2~3문단, 문단 사이 빈 줄.
- 첫 문단에서 질문에 바로 답하고, 다음 문단에서 실제 하루나 경험을 말합니다.
- ${job}의 일상과 실무만 말합니다. 없는 병원·회사·사건 이름은 만들지 않습니다.
- AI 비서처럼 정리하거나 "도움이 필요하신가요?"라고 묻지 않습니다.
- 목록, 요약하면, 첫째, 다음과 같습니다 금지.
- 욕설, 비하, 줄임 욕, 성적 표현은 쓰지 않습니다.`;
}

function personaMessages(job, name = state.name) {
  return [{ role: "system", content: humanSystem(job, name) }];
}

function parseSetup(_raw, job, name = state.name) {
  return humanSystem(job, name);
}

function openingLine(job, name) {
  return `안녕하세요, ${name}입니다. ${job} 일을 하고 있어요. 오늘은 어떤 이야기가 궁금해서 오셨어요? 편하게 말씀해 주세요.`;
}

async function pickGreeting(job, name, reply) {
  const text = (reply || "").replace(/\s+/g, " ").trim();
  const bad = /[\[\]{}<>]|연락주세요|도와드|챗봇|AI|모델|즐길게요|논문|편집작업|placeholder/i.test(text);
  if (!text || !text.includes(name) || !text.includes(job) || text.length < 24 || text.length > 280 || bad) {
    return openingLine(job, name);
  }
  return text;
}

function section(raw, key) {
  const match = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n(?:OVERVIEW|QA|ADVICE|NEXT|NOTE):|$)`, "i"));
  return (match?.[1] || "").replace(/^(형식|대화 개요|주요 질문과 답변|핵심 조언|다음 단계|해석)\s*:?\s*/gm, "").trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isFillerTalk(text = "") {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  return /^(안녕하세요[요]?|안녕하십니까|안녕|네+|예+|응+|음+|아+|ㅎㅎ+|ㅋㅋ+|감사합니다|고맙습니다|수고하세요|편하게 말씀해 주세요)[.!?~, ]*$/i.test(t);
}

function interviewPairs(messages = state.messages) {
  const pairs = [];
  let question = null;
  for (const item of messages) {
    if (item.role === "assistant" && !question) continue;
    if (item.role === "user") {
      question = isFillerTalk(item.content) ? null : item.content;
      continue;
    }
    if (item.role === "assistant" && question && !isFillerTalk(item.content)) {
      pairs.push({ question, answer: item.content });
    }
    question = null;
  }
  return pairs;
}

function parseNote(raw = "") {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const note = parsed.note || parsed.interpretation || parsed.NOTE;
      if (note) return String(note).trim();
    } catch {
      // fall through
    }
  }
  return section(raw, "NOTE") || raw.replace(/^(NOTE|해석)\s*:?\s*/i, "").trim();
}

function noteParagraphs(note) {
  const raw = String(note || "").trim();
  if (!raw) return [];
  if (/\n{2,}/.test(raw)) {
    return raw.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  }
  const sentences = raw.split(/(?<=다\.|요\.|니다\.|까요\?|까\?)\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length <= 3) return [raw];
  const size = Math.ceil(sentences.length / 3);
  const parts = [];
  for (let i = 0; i < sentences.length; i += size) {
    parts.push(sentences.slice(i, i + size).join(" "));
  }
  return parts;
}

function renderSummary(pairs, note) {
  const items = pairs
    .map(
      (pair) => `<article class="qa-item">
        <p class="qa-q">${escapeHtml(pair.question).replace(/\n/g, "<br>")}</p>
        <p class="qa-a">${escapeHtml(pair.answer).replace(/\n/g, "<br>")}</p>
      </article>`,
    )
    .join("");
  const table = pairs.length
    ? `<h3>질문과 응답</h3><div class="qa-list">${items}</div>`
    : `<p>인사와 잡담을 제외하면 정리할 질문과 응답이 없었습니다.</p>`;
  const paragraphs = noteParagraphs(note)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const interpretation = paragraphs
    ? `<h3>해석</h3><div class="summary-note">${paragraphs}</div>`
    : "";
  return table + interpretation;
}

function formError(message) {
  ui.jobForm.querySelector(".error")?.remove();
  const note = document.createElement("p");
  note.className = "error";
  note.textContent = message;
  ui.jobForm.appendChild(note);
}

function formatWhen(ts) {
  const date = new Date(ts);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}월 ${day}일 ${hour}:${minute}`;
}

function loadHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveRecord({ endedHow, pairs, note }) {
  if (!state.name || !state.job) return;
  const item = {
    id: crypto.randomUUID?.() || String(Date.now()),
    name: state.name,
    job: state.job,
    endedAt: Date.now(),
    endedHow,
    pairs: pairs || [],
    note: note || "",
  };
  localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...loadHistory()].slice(0, 40)));
}

function renderHistory() {
  const items = loadHistory();
  if (!ui.historyPanel || !ui.historyList) return;
  ui.historyPanel.hidden = items.length === 0;
  ui.historyList.replaceChildren();
  items.forEach((item) => {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${escapeHtml(item.name)} · ${escapeHtml(item.job)}</strong><span>${formatWhen(item.endedAt)} · ${item.endedHow === "blocked" ? "차단" : "종료"}</span>`;
    button.addEventListener("click", () => openRecord(item.id));
    row.appendChild(button);
    ui.historyList.appendChild(row);
  });
}

function openRecord(id) {
  const item = loadHistory().find((row) => row.id === id);
  if (!item) return;
  state.viewingRecord = true;
  state.job = item.job;
  state.name = item.name;
  ui.summaryKicker.textContent = item.endedHow === "blocked" ? "차단된 면담" : "지난 면담";
  ui.summaryJob.textContent = `${item.name} · ${item.job}`;
  ui.summaryCard.innerHTML = renderSummary(item.pairs || [], item.note || "");
  ui.restartBtn.textContent = "돌아가기";
  showScreen("summary");
}

function addBubble(role, content, pending = false) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}${pending ? " pending" : ""}`;
  bubble.textContent = content;
  ui.transcript.appendChild(bubble);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return bubble;
}

function setComposerLocked(locked) {
  ui.chatInput.disabled = locked;
  ui.sendBtn.disabled = locked;
  ui.chatInput.required = !locked;
  ui.chatInput.placeholder = locked ? "면담이 차단되었습니다" : "편하게 물어보세요";
}

function lockInterview() {
  state.locked = true;
  ui.chatInput.value = "";
  ui.chatInput.style.height = "auto";
  setComposerLocked(true);
  ui.endBtn.hidden = true;
  addBubble("block", "부적절한 표현이 감지되어 이 메시지를 차단했습니다. 면담을 이어갈 수 없습니다.");
  saveRecord({ endedHow: "blocked", pairs: interviewPairs(), note: "" });
}

async function complete({ messages, stream = false, onChunk, maxTokens = 820, temperature = 0.8 }) {
  const engine = await getEngine();
  const request = {
    messages,
    temperature,
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
    text = text.trim();
    if (!text) throw new Error("응답을 만들지 못했습니다.");
    return text;
  }

  const result = await engine.chat.completions.create(request);
  const text = (result.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("응답을 만들지 못했습니다.");
  return text;
}

function payloadPreview(job, name, kind) {
  if (kind === "prompt") {
    return `{
  "model": "${MODEL}",
  "stream": true,
  "temperature": 0.55,
  "messages": [
    {"role": "system", "content": "Write a brief interview persona."},
    {"role": "user", "content": "name=${name} job=${job}"}
  ]
}`;
  }
  if (kind === "test") {
    return `{
  "model": "${MODEL}",
  "stream": true,
  "temperature": 0.8,
  "messages": [
    {"role": "system", "content": "persona:${name},${job}"},
    {"role": "user", "content": "open the interview in Korean"}
  ]
}`;
  }
  return `{
  "name": "${name}",
  "job": "${job}",
  "route": "/chat",
  "status": "mounting"
}`;
}

async function setupRole(job, name) {
  const term = ui.prepTerminal;
  clearTerminal(term);
  ui.prepSteps.hidden = true;
  term.hidden = true;
  ui.loadStatus.hidden = false;
  ui.loadStatus.classList.remove("is-done");
  ui.loadStatus.textContent = "모델을 불러오는 중 0%";
  progressHandler = (report) => {
    const percent = Math.round((report.progress || 0) * 100);
    const done = percent >= 100;
    ui.loadStatus.textContent = done ? "로딩 완료!" : `모델을 불러오는 중 ${percent}%`;
    ui.loadStatus.classList.toggle("is-done", done);
  };

  await getEngine();
  ui.loadStatus.textContent = "로딩 완료!";
  ui.loadStatus.classList.add("is-done");
  await wait(700);

  ui.loadStatus.hidden = true;
  ui.prepSteps.hidden = false;
  term.hidden = false;
  setPrepStep("prompt");

  await printLogs(term, [
    [`[${stamp()}] engine ready  model=${MODEL}`, "term-ok"],
    [`[${stamp()}] assigned persona: ${name} (${job})`, "term-ok"],
    80,
    [`[${stamp()}] POST /v1/chat/completions HTTP/1.1`, "term-req"],
    ["> Host: webllm.local", "term-meta"],
    ["> Content-Type: application/json", "term-meta"],
    ["> Accept: text/event-stream", "term-meta"],
    ["> Authorization: Bearer local", "term-meta"],
    ["> X-Request-Id: sys-" + Math.random().toString(16).slice(2, 8), "term-meta"],
    60,
    [payloadPreview(job, name, "prompt"), "term-json"],
    90,
    ["-- creating system prompt --", "term-cmd"],
  ]);

  const promptOut = termBlock(term, "term-sse");
  const raw = await complete({
    maxTokens: 280,
    temperature: 0.55,
    stream: true,
    onChunk: (text) => termSet(promptOut, `data: ${text}`, term),
    messages: [
      {
        role: "system",
        content: "면담용 역할 설명을 짧게 씁니다. 설명 없이 본문만 출력하세요.",
      },
      {
        role: "user",
        content: `이름: ${name}
직업: ${job}

평범한 ${job} ${name}이 면담에 응하는 역할 설명을 한국어 5줄 이내로 쓰세요.
다른 이름을 만들지 마세요. 특이한 세부 전공, 사건, 회사명을 만들지 마세요.`,
      },
    ],
  });

  const systemPrompt = parseSetup(raw, job, name);
  termSet(promptOut, systemPrompt, term);
  await printLogs(term, [
    [`< HTTP/1.1 200 OK`, "term-ok"],
    [`< x-tokens: ${raw.length}`, "term-meta"],
    160,
  ]);

  setPrepStep("test");
  await printLogs(term, [
    [`[${stamp()}] POST /v1/chat/completions HTTP/1.1`, "term-req"],
    ["> Host: webllm.local", "term-meta"],
    ["> Content-Type: application/json", "term-meta"],
    ["> Authorization: Bearer local", "term-meta"],
    50,
    [payloadPreview(job, name, "test"), "term-json"],
    70,
    ["-- testing response --", "term-cmd"],
  ]);

  const testOut = termBlock(term, "term-sse");
  const testReply = await complete({
    maxTokens: 360,
    temperature: 0.9,
    stream: true,
    onChunk: (text) => termSet(testOut, `data: ${text}`, term),
    messages: [
      ...personaMessages(job, name),
      {
        role: "user",
        content: `면담이 막 시작됐습니다. "안녕하세요, ${name}입니다."로 시작하고 ${job}라고 짧게 밝히세요. 다른 이름이나 자리표시는 넣지 마세요. 사람처럼 3~5문장으로 인사하세요.`,
      },
    ],
  });
  await printLogs(term, [
    [`< HTTP/1.1 200 OK`, "term-ok"],
    [`< x-latency: ${stamp()}`, "term-meta"],
    140,
  ]);

  setPrepStep("ui");
  await printLogs(term, [
    [`[${stamp()}] POST /chat/open`, "term-req"],
    [payloadPreview(job, name, "ui"), "term-json"],
    ["-- preparing chat ui --", "term-cmd"],
    [`mounted /chat  200`, "term-ok"],
    [`ready for interview: ${name} / ${job}`, "term-ok"],
  ]);
  await wait(1100);

  return {
    systemPrompt,
    greeting: await pickGreeting(job, name, testReply),
  };
}

function resetWelcome() {
  state.job = "";
  state.name = "";
  state.systemPrompt = "";
  state.messages = [];
  state.busy = false;
  state.locked = false;
  state.viewingRecord = false;
  const preset = new URLSearchParams(location.search).get("job")?.trim().slice(0, 60) || "";
  ui.jobInput.value = preset;
  ui.restartBtn.textContent = "다시 시작";
  ui.summaryKicker.textContent = "면담 요약";
  ui.transcript.replaceChildren();
  clearTerminal(ui.prepTerminal);
  clearTerminal(ui.summaryTerminal);
  ui.loadStatus.textContent = "";
  ui.loadStatus.classList.remove("is-done");
  ui.loadStatus.hidden = false;
  ui.prepTerminal.hidden = true;
  ui.prepSteps.hidden = true;
  ui.prepSteps.querySelectorAll("li").forEach((item) => {
    item.classList.remove("is-current", "is-done");
  });
  ui.greeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  setComposerLocked(false);
  renderHistory();
  showScreen("welcome");
  ui.jobInput.focus();
}

ui.jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const job = ui.jobInput.value.trim();
  if (!job || state.busy) return;
  ui.jobForm.querySelector(".error")?.remove();
  state.busy = true;
  if (ui.startBtn) ui.startBtn.disabled = true;

  try {
    state.job = job;
    state.name = pickName();
    ui.prepKicker.textContent = "준비 중...";
    ui.prepTitle.textContent = `${state.name} ${job} 면담을 준비하고 있습니다`;
    showScreen("preparing");
    setPrepStep("prompt");
    const setup = await setupRole(job, state.name);
    state.systemPrompt = setup.systemPrompt;
    state.messages = [{ role: "assistant", content: setup.greeting }];
    ui.transcript.replaceChildren();
    addBubble("bot", setup.greeting);
    showScreen("chat");
    ui.chatInput.focus();
  } catch (error) {
    showScreen("welcome");
    if (error?.name === "BlockedSpeech") ui.jobInput.value = "";
    formError(error.message || "잠시 후 다시 시도해 주세요.");
    renderHistory();
  } finally {
    state.busy = false;
    if (ui.startBtn) ui.startBtn.disabled = false;
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
  if (!text || state.busy || state.locked) return;

  state.busy = true;
  ui.chatInput.value = "";
  ui.chatInput.style.height = "auto";
  ui.sendBtn.disabled = true;

  try {
    if (await moderateSpeech(text)) {
      lockInterview();
      state.busy = false;
      return;
    }
  } catch (error) {
    addBubble("bot", error.message || "표현을 확인하지 못했습니다.");
    state.busy = false;
    ui.sendBtn.disabled = false;
    return;
  }
  state.messages.push({ role: "user", content: text });
  addBubble("user", text);
  const pending = addBubble("bot", "잠깐만요, 생각 좀 해볼게요.", true);

  try {
    const reply = await complete({
      maxTokens: 900,
      temperature: 0.9,
      messages: [
        { role: "system", content: state.systemPrompt || humanSystem(state.job, state.name) },
        ...personaMessages(state.job, state.name).slice(1),
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
    pending.remove();
    if (error?.name === "BlockedSpeech") {
      lockInterview();
    } else {
      addBubble("bot", error.message || "답변을 만들지 못했습니다. 다시 보내 주세요.");
      state.messages.pop();
    }
  } finally {
    state.busy = false;
    if (!state.locked) ui.sendBtn.disabled = false;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    if (!state.locked) ui.chatInput.focus();
  }
});

ui.endBtn.addEventListener("click", async () => {
  if (state.busy) return;
  state.busy = true;
  showScreen("summarizing");
  clearTerminal(ui.summaryTerminal);
  const pairs = interviewPairs();
  await printLogs(ui.summaryTerminal, [
    [`[${stamp()}] POST /v1/chat/completions HTTP/1.1`, "term-req"],
    ["> Host: webllm.local", "term-meta"],
    ["> Authorization: Bearer local", "term-meta"],
    [`> X-Turns: ${state.messages.length}`, "term-meta"],
    80,
    `{
  "name": "${state.name}",
  "job": "${state.job}",
  "pairs": ${pairs.length},
  "stream": true
}`,
    ["-- writing summary --", "term-cmd"],
  ]);
  const out = termBlock(ui.summaryTerminal, "term-sse");

  try {
    const transcript = pairs.length
      ? pairs.map((pair, index) => `${index + 1}. 질문: ${pair.question}\n응답: ${pair.answer}`).join("\n\n")
      : "(실질 질문 없음)";
    const summary = await complete({
      maxTokens: 1600,
      temperature: 0.4,
      stream: true,
      onChunk: (text) => termSet(out, `data: ${text}`, ui.summaryTerminal),
      messages: [
        {
          role: "system",
          content:
            "면담 기록을 해석합니다. JSON만 출력하세요. 인사, 잡담, 없는 내용은 만들지 마세요.",
        },
        {
          role: "user",
          content: `이름: ${state.name}
직업: ${state.job}

면담에서 인사와 잡담을 뺀 질문과 응답:
${transcript}

아래 JSON만 출력하세요.
{
  "note": "2~3문단, 문단 사이는 빈 줄. 이 면담에서 ${state.job} 일이 실제로 어떻게 보이는지, 준비할 점, 적성, 놓치기 쉬운 포인트를 구체적으로 해석. 한 줄 요약 금지. 최소 6문장."
}`,
        },
      ],
    });
    await printLogs(ui.summaryTerminal, [[`< HTTP/1.1 200 OK`, "term-ok"]]);
    const note = parseNote(summary);
    ui.summaryKicker.textContent = "면담 요약";
    ui.summaryJob.textContent = personLabel();
    ui.summaryCard.innerHTML = renderSummary(pairs, note);
    saveRecord({ endedHow: "ended", pairs, note });
    showScreen("summary");
  } catch (error) {
    ui.summaryJob.textContent = personLabel();
    if (error?.name === "BlockedSpeech") {
      ui.summaryCard.innerHTML = `<p>부적절한 표현이 감지되어 요약을 만들지 않았습니다.</p>`;
      saveRecord({ endedHow: "blocked", pairs, note: "" });
    } else {
      ui.summaryCard.innerHTML = renderSummary(pairs, "") + `<p>${escapeHtml(error.message || "요약을 만들지 못했습니다.")}</p>`;
      saveRecord({ endedHow: "ended", pairs, note: "" });
    }
    showScreen("summary");
  } finally {
    state.busy = false;
  }
});

ui.homeBtn?.addEventListener("click", () => {
  if (state.busy) return;
  resetWelcome();
});

ui.historyBtn?.addEventListener("click", () => {
  renderHistory();
  if (ui.historyPanel.hidden) {
    formError("아직 지난 면담이 없습니다.");
    return;
  }
  ui.historyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

ui.restartBtn.addEventListener("click", resetWelcome);

resetWelcome();
