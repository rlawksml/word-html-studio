# 이슈 #60 Supabase 통합 테스트 정리 안전장치 검증 보고서

## 판정

- 결과: `GO`
- 단계: `PRE-DEPLOY`
- 작성 일시: 2026-09-08 (KST)
- 검증자: Codex

## 검증 대상

- 프로젝트: 동네책방 소식 스튜디오
- 환경: Local, GitHub Actions PR, GitHub `staging` Environment, owner-private Sites Staging 공개 화면
- 기준 브랜치: `develop` (`b1a77a9`)
- 대상 브랜치: `codex/v1.1-integration-cleanup-guard`
- 기능 커밋 SHA: `7cec5ed`
- 최종 코드 커밋 SHA: `454fed1198203dee19586b84fcc39d09cd8f20a1`
- PR: [#61](https://github.com/rlawksml/word-html-studio/pull/61)
- 관련 이슈: [#60](https://github.com/rlawksml/word-html-studio/issues/60)
- Production 배포: 없음

## 변경 기능과 TC

| 변경 기능 | 영향 TC | 자동화 파일 | 배포 전 | 배포 후 |
|---|---|---|---|---|
| 정리 실패를 모아 테스트 실패로 보고 | TC-DR-011 | `tests/supabase-cleanup-guard.test.mjs` | 필수 | GitHub Staging 통합 |
| DB 행·Storage 객체의 정확한 키 잔여 0건 확인 | TC-DR-009·011 | `tests/supabase-integration.test.mjs` | 필수 | GitHub Staging 통합 |
| 기존 기능과 데이터 격리 유지 | 전체 회귀, TC-DR-005~007 | 기존 자동 테스트·공개 화면 | 필수 | Staging 공개 읽기 확인 |

## 결과 요약

| PASS | FAIL | BLOCKED | SKIPPED | 전체 |
|---:|---:|---:|---:|---:|
| 9 | 0 | 0 | 0 | 9 |

## TC 실행 결과

| TC ID | 우선순위 | 종류 | 결과 | 실제 결과·증거 | 비고 |
|---|---|---|---|---|---|
| TC-DR-011 | P1 | 실패 우선 단위 | PASS | helper 미구현 상태에서 0/1 실패, 구현 후 3/3 통과 | 실패·예외 뒤에도 모든 단계 실행 확인 |
| TC-DR-011 | P1 | 첫 Staging 통합 | FAIL→수정 | [실행 34196963885](https://github.com/rlawksml/word-html-studio/actions/runs/34196963885) 2/3 | 기간 테이블에 없는 `id` 조회를 실제 스키마의 복합키로 수정 |
| TC-DR-011 | P1 | 최종 Staging 통합 | PASS | [실행 34197151979](https://github.com/rlawksml/word-html-studio/actions/runs/34197151979) 3/3 | 삭제와 삭제 후 정확한 키 잔여 확인 통과 |
| 전체 회귀 | P0·P1 | Local·CI | PASS | production build 포함 73/73 | 기존 70건 + 신규 3건 |
| lint | 필수 | Local·CI | PASS | ESLint 오류 없음 | |
| migration·배포 대상 | P0 | Local·CI | PASS | additive migration 정책·Staging 대상 통과 | |
| PR 보안 | P0 | GitHub | PASS | GitGuardian 통과 | 비밀값 커밋 없음 |
| 공개 Staging | P0 | 브라우저 읽기 | PASS | 2026년 9월 3개 책방·3개 소식 유지 | QA 제목 노출 없음 |
| 브라우저 로그 | P1 | 브라우저 | PASS | reload 후 warn/error 0건 | |

## 원인과 수정

기존 통합 테스트는 `finally`에서 Supabase Database·Storage 삭제 요청을 보냈지만 반환된 `error`를 검사하지 않았다. 따라서 권한·정책·네트워크 문제로 정리에 실패해도 본 테스트가 통과하면 workflow 전체가 성공할 수 있었다.

정리 단계를 순차 실행하면서 오류를 모으는 `runExactCleanup`을 추가했다. 한 단계가 실패해도 뒤의 정확한 QA 대상은 계속 정리하고, 끝에서 모든 실패를 함께 보고한다. 삭제 뒤에는 테스트가 직접 만든 ID·resource key·Storage 경로만 재조회해 책방, Submission, 기간 일정, 편집 임대, 개선사항, 원본·미리보기의 잔여가 0건인지 확인한다.

첫 실제 Staging 실행에서 기간 테이블에 존재하지 않는 단일 `id` 컬럼을 사후 조회하는 구현 오류가 발견됐다. 실제 기본키인 `submission_id, news_item_id`로 수정한 다음 동일 workflow를 재실행해 3/3을 통과했다.

## 실행 명령과 환경

| 구분 | 명령·환경 | 결과 |
|---|---|---|
| 집중 | `node --test tests/supabase-cleanup-guard.test.mjs` | 3/3 PASS |
| build·unit | `npm test` | build·73/73 PASS |
| lint | `npm run lint` | PASS |
| migration | `npm run migration:check` | PASS |
| integration | GitHub workflow dispatch, `staging` Environment | 최종 3/3 PASS |
| PR | GitHub Actions + GitGuardian | PASS |

## 테스트 데이터 정리

- Database: 각 TC가 생성한 고유 2099년 책방·Submission·기간 일정·편집 임대·개선사항만 정확한 키로 삭제
- Storage: 각 TC가 예약한 원본·미리보기의 정확한 경로만 삭제
- 사후 확인: 같은 키와 경로를 재조회해 잔여 0건 확인을 통합 테스트 성공 조건으로 적용
- 공개 Staging: reload 후 기존 3개 책방·3개 소식 유지, QA 데이터 노출 없음
- Production: Database·Storage·Sites 쓰기 및 배포 없음

## 경고와 잔여 위험

- 이 변경은 테스트 안전장치이며 제품 런타임 동작을 바꾸지 않는다. 따라서 별도 Sites 배포는 필요하지 않다.
- 기존 dependency audit 경고는 별도 보안 이슈에서 운영 영향과 안전한 업데이트 범위를 분석한다.
- Windows Edge UAT와 v1.1 전체 릴리스 게이트는 #48에서 계속 진행한다.

## 최종 결론

- 판정 근거: 정리 실패 회귀 3/3, 전체 73/73, lint·migration, PR 보안, 실제 Supabase Staging 3/3과 정확한 QA 잔여 0건 확인을 통과했다.
- 배포 가능 여부: `develop` 병합 `GO`; Production 배포는 #48 승인 전 `NO-GO`.
- 병합 후 재확인: `develop`의 정확한 병합 SHA에서 수동 workflow를 한 번 더 실행한다.
