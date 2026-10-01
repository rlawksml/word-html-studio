# Python Playwright E2E 실습 시작하기

이 저장소는 동네책방 소식 스튜디오 앱과 Python Playwright 실습 환경을 함께 포함합니다. 실습은 `localhost` 전용 API mock을 사용하므로 운영·Staging·실제 DB·Storage를 변경하지 않습니다.

## 1. 다른 컴퓨터에서 받기

먼저 Git, Python 3.11 이상, Node.js 22.13.0 이상을 설치합니다. 비공개 저장소이므로 GitHub 접속 권한도 필요합니다.

```bash
git clone https://github.com/rlawksml/word-html-studio-e2e-lab.git
cd word-html-studio-e2e-lab/e2e/python
```

## 2. 최초 한 번 준비하기

```bash
python3 practice_runner.py setup
```

이 명령은 저장소 안의 `.venv`, 고정된 Python 패키지, Playwright Chromium과 Node 패키지를 설치합니다. 설치에는 네트워크가 필요하며 실제 암호나 API 키는 필요하지 않습니다.

## 3. 직접 보며 실습하기

```bash
python3 practice_runner.py check
python3 practice_runner.py demo
```

`demo`는 로컬 앱을 `http://localhost:4173`에서 시작하고 Chromium을 보여 줍니다. 검색·버튼 클릭·상세 확인·닫기가 자동으로 진행되며, 테스트가 끝나면 실습기가 시작한 서버만 종료합니다.

## 4. 코드를 한 줄씩 바꾸기

`practice/test_practice.py`를 열고 주석 1~5를 순서대로 읽습니다. 파일 끝의 TODO를 하나씩 수정한 뒤 다시 실행합니다.

```bash
python3 practice_runner.py demo
```

처음에는 검색어를 바꾸고, 다음에는 기대 문장을 바꾸고, 마지막에는 일부러 실패를 만들어 오류 메시지를 읽어 봅니다. 실패를 확인한 뒤에는 코드를 원래로 돌려놓습니다.

## 5. 자료 읽기

- `e2e/python/README.md`: 설치·실행·결과 해석
- `docs/guides/python-playwright-e2e-guide.html`: 개념, 시연, 오류 해결, 3분 발표 대본
- `e2e/python/conftest.py`: fixture, API mock, 네트워크 안전장치
- `e2e/python/safety.py`: 운영·원격 URL 차단

## 안전 규칙

- 실습 명령에 운영·Staging URL을 넣지 않습니다.
- 실제 암호, API 키, 쿠키, 세션을 코드나 스크린샷에 남기지 않습니다.
- `practice_runner.py`의 로컬 주소 제한을 우회하지 않습니다.
- 실제 원격 로그인은 격리 환경과 승인된 테스트 데이터가 준비될 때까지 `BLOCKED`입니다.
