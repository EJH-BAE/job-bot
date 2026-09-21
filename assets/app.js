import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const GREETINGS = [
  "오늘은 누구와 면담할까요?",
  "면담하고 싶은 직업을 알려 주세요.",
  "어떤 직업의 사람과 이야기해 볼까요?",
  "지금 면담하고 싶은 사람이 있나요?",
  "오늘 면담할 직업을 적어 주세요.",
];

const MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

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
  greeting: document.getElementById("greeting"),
  jobForm: document.getElementById("job-form"),
  jobInput: document.getElementById("job-input"),
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
  return `당신은 ${name}입니다. ${job}으로 일하는 실제 사람입니다. 지금 면담 테이블에 앉아 있습니다. AI, 챗봇, 모델이 아닙니다.
한국어 존댓말로 본인 하루와 일을 이야기하세요. 매번 5~8문장.
필요할 때만 자신을 ${name}이라고 하세요. 다른 이름, 자리표시, 목록, 요약하면, 첫째, 다음과 같습니다 는 쓰지 마세요.`;
}

function personaMessages(job, name = state.name) {
  return [
    { role: "system", content: humanSystem(job, name) },
    { role: "user", content: "안녕하세요. 하루가 어떤가요?" },
    {
      role: "assistant",
      content: `솔직히 말하면 밖에서 보는 거랑은 꽤 달라요. 아침부터 준비하고, 사람 만나고, 중간에 예상 못 한 일이 끼면 하루가 훅 가거든요. 그래도 일이 손에 잡히는 날이 있어서 버팁니다. 오늘은 어떤 부분이 제일 궁금하세요?`,
    },
  ];
}

function parseSetup(raw, job, name = state.name) {
  const generated = (raw || "")
    .replace(/^SYSTEM:\s*/i, "")
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .trim();
  if (generated.length > 40 && generated.includes(job) && !/(불법|도매|회수|전담 사건)/.test(generated)) {
    return `${humanSystem(job, name)}\n\n참고:\n${generated.slice(0, 360)}`;
  }
  return humanSystem(job, name);
}

function pickGreeting(job, name, reply) {
  const text = (reply || "").replace(/\s+/g, " ").trim();
  const bad = /[\[\]{}<>]|연락주세요|도와드|챗봇|AI|모델|placeholder/i.test(text);
  if (!text || !text.includes(name) || text.length < 40 || text.length > 280 || bad) {
    return `안녕하세요, ${name}입니다. ${job}로 일하고 있어요. 오늘은 어떤 이야기가 궁금해서 오셨어요? 편하게 말씀해 주세요.`;
  }
  return text;
}

function section(raw, key) {
  const match = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n(?:OVERVIEW|QA|ADVICE|NEXT):|$)`, "i"));
  return (match?.[1] || "").replace(/^(형식|대화 개요|주요 질문과 답변|핵심 조언|다음 단계)\s*:?\s*/gm, "").trim();
}

function renderSummary(raw) {
  const overview = section(raw, "OVERVIEW");
  const qa = section(raw, "QA");
  const advice = section(raw, "ADVICE");
  const next = section(raw, "NEXT");
  const blocks = [
    ["대화 개요", overview],
    ["주요 질문과 답변", qa],
    ["핵심 조언", advice],
    ["다음 단계", next],
  ].filter(([, text]) => text);

  if (!blocks.length) {
    const cleaned = raw
      .replace(/형식\s*:?/g, "")
      .replace(/^(OVERVIEW|QA|ADVICE|NEXT):/gm, "")
      .trim();
    return `<p>${cleaned.replace(/</g, "&lt;").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  }

  return blocks
    .map(([title, text]) => `<h3>${title}</h3><p>${text.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function addBubble(role, content, pending = false) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}${pending ? " pending" : ""}`;
  bubble.textContent = content;
  ui.transcript.appendChild(bubble);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return bubble;
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

async function complete({ messages, stream = false, onChunk, maxTokens = 820, temperature = 0.88 }) {
  const engine = await getEngine();
  const request = {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
    stop: ["요약하면", "다음과 같습니다", "첫째,"],
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

function payloadPreview(job, name, kind) {
  if (kind === "prompt") {
    return `{\n  "model": "${MODEL}",\n  "stream": true,\n  "temperature": 0.6,\n  "messages": [\n    {"role": "system", "content": "Write a brief interview persona."},\n    {"role": "user", "content": "name=${name} job=${job}"}\n  ]\n}`;
  }
  if (kind === "test") {
    return `{\n  "model": "${MODEL}",\n  "stream": true,\n  "temperature": 0.88,\n  "messages": [\n    {"role": "system", "content": "persona:${name},${job}"},\n    {"role": "user", "content": "open the interview in Korean"}\n  ]\n}`;
  }
  return `{\n  "name": "${name}",\n  "job": "${job}",\n  "route": "/chat",\n  "status": "mounting"\n}`;
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
    const done = percent >= 100 || /finish/i.test(report.text || "");
    ui.loadStatus.textContent = done ? "로딩 완료!" : `모델을 불러오는 중 ${percent}%`;
    ui.loadStatus.classList.toggle("is-done", done);
  };

  await getEngine();
  ui.loadStatus.textContent = "로딩 완료!";
  ui.loadStatus.classList.add("is-done");
  await wait(900);

  ui.loadStatus.hidden = true;
  ui.prepSteps.hidden = false;
  term.hidden = false;
  setPrepStep("prompt");

  await printLogs(term, [
    [`[${stamp()}] engine ready`, "term-ok"],
    [`[${stamp()}] assigned persona: ${name} (${job})`, "term-ok"],
    80,
    [`[${stamp()}] POST /v1/chat/completions HTTP/1.1`, "term-req"],
    ["> Host: webllm.local", "term-meta"],
    ["> Content-Type: application/json", "term-meta"],
    ["> Accept: text/event-stream", "term-meta"],
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
        content: `이름: ${name}\n직업: ${job}\n\n평범한 ${job} ${name}이 면담에 응하는 역할 설명을 한국어 5줄 이내로 쓰세요.\n다른 이름을 만들지 마세요. 특이한 세부 전공, 사건, 회사명을 만들지 마세요.`,
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
    greeting: pickGreeting(job, name, testReply),
  };
}

function resetWelcome() {
  state.job = "";
  state.name = "";
  state.systemPrompt = "";
  state.messages = [];
  state.busy = false;
  ui.jobInput.value = "";
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
  state.name = pickName();
  ui.prepKicker.textContent = "준비 중...";
  ui.prepTitle.textContent = `${state.name} ${job} 면담을 준비하고 있습니다`;
  showScreen("preparing");
  setPrepStep("prompt");

  try {
    const setup = await setupRole(job, state.name);
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
  await printLogs(ui.summaryTerminal, [
    [`[${stamp()}] POST /v1/summarize HTTP/1.1`, "term-req"],
    ["> Host: webllm.local", "term-meta"],
    [`> X-Turns: ${state.messages.length}`, "term-meta"],
    80,
    `{\n  "name": "${state.name}",\n  "job": "${state.job}",\n  "messages": ${state.messages.length},\n  "stream": true\n}`,
    ["-- writing summary --", "term-cmd"],
  ]);
  const out = termBlock(ui.summaryTerminal, "term-sse");

  try {
    const summary = await complete({
      maxTokens: 620,
      temperature: 0.35,
      stream: true,
      onChunk: (text) => termSet(out, `data: ${text}`, ui.summaryTerminal),
      messages: [
        {
          role: "system",
          content: "면담 기록을 정리합니다. 키 이름만 쓰고, 형식 안내나 제목을 반복하지 마세요. 없는 내용은 만들지 마세요.",
        },
        {
          role: "user",
          content: `이름: ${state.name}\n직업: ${state.job}\n\n대화:\n${state.messages.map((item) => `${item.role === "user" ? "질문" : "답변"}: ${item.content}`).join("\n") || "(대화 없음)"}\n\n아래 네 칸만 채우세요. 각 칸은 문장으로 쓰세요. 제목을 다시 쓰지 마세요.\nOVERVIEW:\nQA:\nADVICE:\nNEXT:`,
        },
      ],
    });
    await printLogs(ui.summaryTerminal, [[`< HTTP/1.1 200 OK`, "term-ok"]]);
    ui.summaryJob.textContent = personLabel();
    ui.summaryCard.innerHTML = renderSummary(summary);
    showScreen("summary");
  } catch (error) {
    ui.summaryJob.textContent = personLabel();
    ui.summaryCard.innerHTML = `<p>${error.message || "요약을 만들지 못했습니다."}</p>`;
    showScreen("summary");
  } finally {
    state.busy = false;
  }
});

ui.restartBtn.addEventListener("click", resetWelcome);

resetWelcome();
getEngine().catch(() => {});
