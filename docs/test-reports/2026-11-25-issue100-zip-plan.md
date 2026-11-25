# Issue #100 ZIP 구성 분리 — 2026-11-25

- 기준: `codex/v1.2-issue-97-html-escape-filenames` `3c156e7`(#97 공용 파일명 함수 사용). 브랜치 `codex/v1.2-issue-100-zip-builder-split`.
- 데이터: 합성 값만 사용. DB·Storage·운영 세션 변경 없음.

## 변경

- `lib/news-zip-package.ts`: `newsZipPlan(submission, bookstore, withHtml)`이 ZIP 파일 이름, `사진` 폴더 안 사진 이름·원본 URL, HTML·복사용 TXT·사진배치안내의 이름과 내용을 순수 함수로 정한다.
- `hooks/use-studio-controller.ts`: jszip 지연 로드, 사진 내려받기, 압축, 다운로드, 로딩·중복 실행 차단만 남겼다(873 → 860줄). ZIP 파일 구성·이름·순서는 바뀌지 않는다.
- `tests/rendered-html.test.mjs`의 애플리케이션 소스 목록과 `docs/ARCHITECTURE.md`에 새 파일을 반영했다.

## 검증

| 항목 | 결과 |
|---|---|
| ZIP-PLAN-01 (이전 레이아웃·순서·내용과 동일) | PASS |
| HTML-SAFE-01~03 (ZIP 경로를 새 파일 기준으로 갱신) | 3/3 PASS |
| async-loading·image-retention·digest-order-client·submission-url-validation·publication-month·news-schedule-range 소스 검사 | 빌드가 필요한 1건 외 PASS |
| lint·typecheck·build·전체 `npm test` | GitHub Actions `verify` (PR 기록 참조) |

## 남은 위험

- 실제 브라우저에서 ZIP을 받아 여는 `test:browser-html-copy`는 이번에 실행하지 않았다. 스테이징 확인 시 함께 본다.
