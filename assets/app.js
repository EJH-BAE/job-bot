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
