# Python Playwright E2E 기초 구성

기존 `apps/web/tests` Node 테스트를 유지하면서, 브라우저에서 보이는 최소 흐름을 Python으로 검증합니다. 기본 테스트는 로컬 앱의 API를 메모리 fixture로 가로채므로 DB·Storage·실제 로그인 자격증명을 사용하거나 변경하지 않습니다.

## 처음 실행하기

지원 범위는 Python 3.9 이상이며, 새 로컬 환경에서는 Python 3.11 이상을 권장합니다.

터미널 1에서 기존 웹 앱을 실행합니다.

```bash
cd apps/web
npm ci
npm run dev
```

터미널 2에서 Python 환경과 Chromium을 준비하고 테스트합니다.

```bash
cd e2e/python
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
E2E_BASE_URL=http://localhost:3000 pytest
```

`E2E_BASE_URL`은 명시적 포트가 있는 `http` loopback(`localhost`, `127.0.0.0/8`, `::1`)만 허용합니다. 운영·Staging·기타 원격 호스트는 브라우저 이동 전에 실패하며, smoke 경로의 외부 HTTP(S) 요청도 차단합니다. 현재 앱은 이 경로에서 WebSocket과 service worker를 사용하지 않으며, 향후 추가할 때는 별도 차단·관찰 fixture가 필요합니다. 현재 원격 Staging은 배포 성공 상태로 간주하지 않습니다.

## 역할별 실제 자격증명

`.env.example`의 역할별 변수는 향후 격리 환경 확장을 위한 이름과 placeholder일 뿐이며 현재 smoke 테스트는 읽지 않습니다. 실제 비밀번호, 쿠키, API 키, storage state는 파일·로그·GitHub에 남기지 마세요. 승인된 격리 테스트 데이터와 정상 Staging이 입증되기 전까지 실제 역할 로그인 TC는 `BLOCKED`입니다.

pytest 설정은 trace, video, screenshot을 모두 끕니다. HAR와 storage state도 생성하지 않습니다. 실패 기록은 비밀값을 넣지 않은 터미널 출력을 아래처럼 저장합니다.

```bash
mkdir -p ../../docs/test-reports
set -o pipefail
E2E_BASE_URL=http://localhost:3000 pytest -q | tee ../../docs/test-reports/YYYY-MM-DD-python-e2e.txt
```

보고서에는 commit, 명령, PASS/FAIL/SKIPPED/BLOCKED, 로컬 서버 종류와 남은 위험만 기록합니다. 실제 자격증명이나 요청 본문은 기록하지 않습니다.
