# 이슈 #42 날짜 선택 분리 — Staging 배포 후 검증

## 판정

- 결과: `PASS` — `develop` 병합 가능
- 단계: `STAGING POST-DEPLOY`
- 검증 일시: 2026-09-08 KST
- Production 배포: `NO-GO` 유지

## 검증 대상

- 이슈: [#42 행사 날짜 달력에서 월 이동 시 의도하지 않은 날짜가 추가됨](https://github.com/rlawksml/word-html-studio/issues/42)
- PR: [#53 날짜 선택과 월 탐색 분리](https://github.com/rlawksml/word-html-studio/pull/53)
- 기능 브랜치: `codex/v1.1-calendar-date-confirm`
- 기능 브랜치 HEAD: `b3fdb7d4af926251e984225bdbbb6fec0c3a7fd7`
- 검증 환경: owner-private Sites Staging + 분리된 Supabase Staging
- Supabase Staging project ref: `kriyjyyudngtibrtkylf`
- 검증 브라우저: Codex In-app Browser, 데스크톱 및 390×844 모바일 viewport

## 테스트 데이터

- QA 책방: `QA-ISSUE42-20260908` (`1788841514394`)
- QA Submission: `1788843322102`, 발행 월 `2026-09`
- QA 소식: 5개
- 사진: 0장
- 기존 책방과 기존 Submission은 수정하지 않았다.

## 자동 검증

| 항목 | 결과 | 증거 |
|---|---|---|
| TC-SUB-010 집중 테스트 | PASS | `node --test tests/news-date-selection.test.mjs`, 4/4 |
| ESLint | PASS | `npm run lint`, 오류 0건 |
| production build·전체 회귀 | PASS | `npm test`, 57/57 |
| diff 검사 | PASS | `git diff --check` |

첫 `npm test`는 공유 `node_modules/.vite-temp` 캐시 쓰기가 샌드박스에서 거부돼 `EPERM`으로 중단됐다. 코드나 기능 실패가 아니며 같은 명령을 캐시 쓰기 권한으로 다시 실행해 build와 57/57 PASS를 확인했다.

## TC-SUB-010 실제 브라우저 결과

| 시나리오 | 결과 | 실제 결과 |
|---|---|---|
| 날짜 확정 전 미반영 | PASS | 날짜 입력값만 존재할 때 추가 날짜 목록은 0건 |
| 명시적 날짜 추가 | PASS | `날짜 추가` 뒤 선택 날짜가 정확히 1건 생성되고 입력값 초기화 |
| 중복 차단 | PASS | 같은 날짜 재선택 시 버튼 비활성화 및 `이미 추가된 날짜입니다.` 안내 |
| 개별 삭제 | PASS | 9월 21일·22일 중 21일 삭제 후 22일 유지 |
| 다른 연도 표시 | PASS | `2027년 1월 5일`로 연도 포함 표시 |
| 월 경계 날짜 | PASS | 10월 1일은 명시적 추가 전 0건, 추가 후 1건 |
| 임시 저장·재진입 | PASS | 소식 5개와 각 날짜가 동일하게 복원 |
| 작성 미리보기 | PASS | 5개 제목·본문·일정이 inline CSS HTML 미리보기에 표시 |
| 방문자 달력 | PASS | 9월 20일·22일 일정과 QA 책방 카드가 정확히 표시 |
| 모바일 | PASS | 390×844에서 날짜 5건 표시, 가로 overflow 없음 |
| 브라우저 오류 | PASS | console error·warning 0건 |

10월 방문자 달력은 9월 발행 Submission을 다시 조회하지 않는 기존 월별 공개 정책을 유지한다. 이는 #42의 `dates[]` 입력 결함과 별개이며 이번 변경에서 동작을 바꾸지 않았다.

## Windows Edge 확인

- 현재 검증 호스트에 Microsoft Edge 앱과 Edge 브라우저 연결이 없어 실제 Edge UI는 직접 실행하지 못했다.
- 다만 결함 원인이었던 브라우저 `change` 이벤트는 이제 임시 `pendingDate`만 갱신하며, 실제 `dates[]` 변경은 별도 `날짜 추가` 버튼에서만 실행된다.
- 이 경계는 집중 자동 테스트 4건과 실제 Chromium 입력·저장 시나리오에서 확인했다.
- Windows Edge 실기기 확인은 v1.1 Production 승인 전 최종 사용자 UAT 항목으로 유지한다.

## 테스트 데이터 정리

- 정리 전 대상 이름·ID·소식 5개를 재확인했다.
- 삭제 대상은 QA 기간 행, QA 편집 임대, QA Submission, QA 책방 순으로 ID를 한정했다.
- 삭제 확인: QA 책방 0건, QA Submission 0건
- 정리 후 Staging: 책방 8 / Submission 12 / 기간 0 / 편집 임대 0
- Storage 변경: 없음
- Production 데이터·배포 변경: 없음

## 결론

#42의 결함 경로와 기존 저장 형식 호환이 자동·Staging 브라우저·재진입·미리보기·모바일에서 확인됐고 QA 데이터도 정확히 정리됐다. PR #53은 `develop` 병합 가능하다. Production 배포는 전체 v1.1 회귀, 롤백 호환 검증, 재백업과 사용자 승인 전까지 `NO-GO`다.
