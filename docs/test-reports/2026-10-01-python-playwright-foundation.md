# Python Playwright E2E 기초 구성 검증 — 2026-10-01

## 범위와 안전 경계

- 대상: 별도 `e2e/python` pytest + pytest-playwright 구성
- 데이터: 로컬 메모리 route mock만 사용, DB·Storage 쓰기 없음
- 원격: Production 및 기존/신규 Staging 접속·로그인 미실행
- 산출물: trace, video, screenshot, HAR, storage state 생성 금지

## TC 결과

| TC | 결과 | 근거 |
|---|---|---|
| PY-SAFE-001 loopback URL 허용 | PASS | 127.0.0.1, localhost, ::1 |
| PY-SAFE-002 Production/Staging/원격 URL 차단 | PASS | 알려진 운영·기존 Staging, 유사 호스트, userinfo, HTTPS 포함 |
| PY-VISITOR-001 공개 소식 dialog 열기/닫기 | PASS | localhost route mock |
| PY-VISITOR-002 검색 입력과 결과 확인 | PASS | 상태 변경 API·외부 호스트 차단 assertion |
| PY-AUTH-001 입력 역할 mock 로그인 | PASS | 실제 자격증명 없이 mock session, 다음 달 화면 클릭 |
| PY-AUTH-002 HTML 역할 mock 로그인 | PASS | 실제 자격증명 없이 mock session, 통합본 탭 클릭 |
| PY-REMOTE-001 실제 Staging 역할 로그인 | BLOCKED | 정상 배포 URL·환경 분리·승인된 테스트 데이터 없음 |

## 실행 기록

- 기준 commit: `b8e450835dd72efc225ca1b5f59a166508e1402e`
- 환경: Python 3.9.6, Playwright 1.51.0 Chromium 134, `http://localhost:3000`
- 앱 정체 확인: HTML title `지관서가 동네책방 소식`
- `E2E_BASE_URL=http://localhost:3000 .venv/bin/pytest -q`: 17 PASS
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm test`: 87 PASS, 0 FAIL (빌밀값·DB·Storage 미사용)
- `git diff --check`: PASS
- 남은 위험: mock은 서버 인증·실제 배포·DB 연결을 보증하지 않음
