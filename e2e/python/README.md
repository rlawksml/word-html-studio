# Python Playwright E2E 기초 구성

기존 `apps/web/tests` Node 테스트를 유지하면서, 브라우저에서 보이는 최소 흐름을 Python으로 검증합니다. 기본 테스트는 로컬 앱의 API를 메모리 fixture로 가로채므로 DB·Storage·실제 로그인 자격증명을 사용하거나 변경하지 않습니다.

발표를 처음 준비한다면 [Python Playwright E2E 발표·학습 가이드](../../docs/guides/python-playwright-e2e-guide.html)를 먼저 읽으세요. 용어, 코드 구조, 시연 순서, 결과 해석, 3분 발표 대본을 한 파일에 정리했습니다.

## 가장 쉬운 실습 방법

저장소 루트에서 아래 네 명령만 사용합니다. 실행기가 Python 환경, Chromium,
Node 패키지, 로컬 앱 시작과 종료를 담당하므로 터미널 두 개를 관리할 필요가 없습니다.

```bash
cd e2e/python
python3 practice_runner.py setup  # 최초 1회 설치
python3 practice_runner.py check  # 준비 상태와 포트 확인
python3 practice_runner.py test   # 브라우저 창 없이 빠른 확인
python3 practice_runner.py demo   # 브라우저를 보며 0.7초 간격으로 실습
```

`demo`는 `practice/test_practice.py`만 실행합니다. 파일의 1~5단계를 읽고 맨 아래
`TODO 1`부터 한 줄씩 바꿔 재실행해 보세요. 연습 TC는 기본 `pytest` 회귀 suite에는
포함되지 않으므로 실수로 수정해도 제품 테스트 결과와 섞이지 않습니다.

실습기는 주소를 입력받지 않고 `http://localhost:4173`만 사용합니다. 포트가 이미
사용 중이면 그 프로세스를 종료하지 않고 안전하게 멈춥니다. 운영·Staging URL, 실제
암호, API 키, 쿠키를 입력하는 옵션은 없습니다. 앱 서버도 실행기가 직접 시작한
process group만 종료합니다.

## 세 도구를 한 문장씩 이해하기

- **Python**: 테스트 절차를 사람이 읽기 쉬운 코드로 적는 언어입니다.
- **pytest**: `test_`로 시작하는 함수를 찾아 실행하고 PASS/FAIL 결과를 모아 줍니다.
- **Playwright**: 실제 Chromium 브라우저를 열어 클릭·입력·화면 확인을 수행합니다.

이 프로젝트에서 흐름은 `pytest → fixture 준비 → Playwright 브라우저 실행 → 로컬 앱 조작 → expect로 결과 확인` 순서입니다. `conftest.py`는 공통 준비와 네트워크 안전장치, `tests/test_smoke.py`는 사용자 행동, `tests/test_safety.py`는 잘못된 실행 주소 차단을 담당합니다.

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

처음에는 전체 결과를 짧게 보는 `pytest -q`도 유용합니다. 한 테스트의 동작을 화면으로 천천히 보고 싶다면 아래처럼 실행합니다.

```bash
E2E_BASE_URL=http://localhost:3000 pytest tests/test_smoke.py \
  -k visitor_can_open_and_close --headed --slowmo 700
```

`--headed`는 브라우저 창을 보이게 하고 `--slowmo 700`은 각 동작을 0.7초 늦춥니다. 발표 전에는 먼저 일반 명령으로 전체 테스트가 통과하는지 확인하고, 발표에서는 위의 짧은 TC 하나만 보여 주는 편이 안정적입니다.

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

## 결과 읽기

- `PASSED`: 준비부터 검증까지 기대대로 끝났습니다.
- `FAILED`: 기대 결과가 다르거나 실행 중 오류가 났습니다. 실패 위치와 첫 오류부터 읽습니다.
- `SKIPPED`: 코드가 조건에 따라 의도적으로 실행하지 않은 테스트입니다.
- `BLOCKED`: pytest의 자동 상태가 아니라 검증 보고서에 쓰는 프로젝트 판단입니다. 예를 들어 승인된 격리 Staging이나 테스트 계정이 없어 안전하게 실행할 수 없는 경우입니다.

`FAILED`는 제품 버그뿐 아니라 개발 서버 미실행, Chromium 미설치, 잘못된 포트 때문에도 생길 수 있습니다. HTML 가이드의 문제 해결 표에서 메시지별 확인 순서를 볼 수 있습니다.
