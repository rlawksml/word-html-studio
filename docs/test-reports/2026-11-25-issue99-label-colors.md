# Issue #99 표시 라벨 상태별 색 — 2026-11-25

- 기준: `codex/m5-release-flow` `130be32`. 브랜치 `codex/v1.2-issue-99-label-colors`.
- 데이터: 합성 값만 사용. DB·Storage·운영 세션 변경 없음.

## 변경

- `lib/html-generators.ts`: `displayLabelBackground`를 추가해 `신청 마감`·`행사 종료`는 회색 `#6f6f6f`, 그 외(`신청 중`·`신규 모집`·`상시 운영`·알 수 없는 값)는 기존 `#8e735b`로 출력한다. 생성 HTML의 inline CSS만 바뀌고 앱 UI CSS는 바꾸지 않았다.
- 흰 글자 대비: 회색 약 5.0:1. 기존 브라운은 약 4.4:1로 12px 글자 권장치(4.5:1)에 조금 못 미치며 이번 범위에서는 유지했다.

## 검증

| 항목 | 결과 |
|---|---|
| HTML-LABEL-01, 수정 전 코드 | FAIL (의도한 RED) |
| HTML-LABEL-01·HTML-LINES-01~05, 수정 후 | 6/6 PASS |
| lint·typecheck·build·전체 `npm test` | GitHub Actions `verify` (PR 기록 참조) |

## 남은 위험

- 기존 브라운 라벨의 대비 보완은 디자인 결정이 필요해 별도 판단으로 남긴다.
