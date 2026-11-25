# Issue #98 해를 넘기는 날짜와 잘못된 월 표시 — 2026-11-25

- 기준: `codex/m5-release-flow` `130be32`. 브랜치 `codex/v1.2-issue-98-cross-year-dates`.
- 데이터: 합성 값만 사용. DB·Storage·운영 세션 변경 없음.

## 변경

- `lib/news-schedule.ts`: `formatNewsSchedule(news, publicationMonth)`가 발행 연도와 다른 개별 날짜에만 연도를 붙인다. 발행 월을 주지 않으면 기존 출력과 같다. 기간 일정과 일정 문장 우선 규칙은 그대로다.
- `lib/html-generators.ts`, `components/molecules/PublicNewsDetail.tsx`: 일정과 신청 마감이 발행 월 기준 규칙(`formatNewsDate`, 입력 화면과 같은 함수)을 함께 쓴다.
- `lib/workspace-formatters.ts`: `formatMonth`가 잘못된 월에서 `"년 NaN월"` 대신 빈 문자열을 돌려주고, 통합본 제목은 이때 월 없이 표시된다.

예: 12월호의 일정 `12월 27일, 2027년 1월 3일`, 신청 마감 `2027년 1월 3일`. 같은 해 날짜는 기존처럼 `12월 6일`.

## 검증

| 항목 | 결과 |
|---|---|
| SCHEDULE-YEAR-01~02와 갱신된 공유 규칙 TC, 수정 전 코드 | 3개 FAIL (의도한 RED) |
| news-schedule-range·news-date-selection·publication-month, 수정 후 | 28/28 PASS |
| HTML-LINES-01~05 | 5/5 PASS |
| lint·typecheck·build·전체 `npm test` | GitHub Actions `verify` (PR 기록 참조) |

## 남은 위험

- 운영 HTML과 방문자 상세의 날짜 문구가 바뀌므로 develop 통합 후 스테이징에서 확인한다.
- #97과 `lib/html-generators.ts` import 줄이 겹친다. 먼저 병합되는 쪽 이후 다른 브랜치를 갱신한다.
