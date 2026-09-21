# JOB BOT

면담하고 싶은 직업의 사람과 이야기하고, 끝나면 면담 요약을 받는 한국어 AI 웹 앱입니다. GitHub Pages에서 바로 열 수 있고, API 키 없이 무료로 동작합니다.

## 사용 순서

1. 랜덤 인사를 확인합니다.
2. **면담하고 싶은 직업**을 입력합니다. 
3. 준비 중 화면에서 모델을 불러온 뒤, 역할 프롬프트 작성과 테스트 응답을 진행합니다.
4. 그 사람과 채팅을 통해 면담합니다.
5. 위쪽 **종료**를 누르면 면담 요약이 나옵니다.

## 로컬에서 보기

```bash
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173` 을 엽니다.

## GitHub Pages

1. 이 저장소를 GitHub에 올립니다.
2. Settings → Pages → Build and deployment
3. Source를 **Deploy from a branch** 로 두고, branch는 `main` / `/ (root)` 로 저장합니다.
4. 잠시 뒤 https://ejh-bae.github.io/job-bot/ 에서 열립니다.

## 기술

- 정적 HTML / CSS / JavaScript
- 텍스트 생성: 브라우저에서 동작하는 [WebLLM](https://github.com/mlc-ai/web-llm) + Qwen2.5
- API 키와 서버가 필요 없습니다. 첫 방문 때 모델이 기기에 내려받아집니다.
- Chrome 또는 Edge를 권장합니다.
