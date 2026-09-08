# 이슈 #43 장기 행사 기간 입력 — Sites Staging 배포 후 검증

## 판정

- Sites Staging 배포 상태: **PASS**
- 공개 방문자 화면 회귀: **PASS**
- 실제 작업자 기간 입력 브라우저 시나리오: **BLOCKED** — TC-AUTH-001 실패로 작업자 화면 진입 불가
- Production 배포: **NO-GO** — v1.1 최종 사용자 시나리오와 별도 승인 전에는 진행하지 않음
- Production 데이터 변경: **없음**

## 배포 대상

- 이슈: [#43 장기 행사의 시작일·종료일 기간 입력 지원](https://github.com/rlawksml/word-html-studio/issues/43)
- PR: [#55](https://github.com/rlawksml/word-html-studio/pull/55)
- Sites Staging 누적 소스: `cb2aff13b126036f48f9c8ea99e34502224465a9`
- Sites 배포 버전: `v8`
- 배포 ID: `appgdep_6a9ecfcd86f48191807e53439b156070`
- URL: <https://bookstore-news-studio-staging.rlawksml.chatgpt.site/>
- 앱 후보 버전: `1.1.0-rc.1`
- Staging DB schema: `202609070002`

## 배포 후 읽기 전용 브라우저 검증

| 시나리오 | 결과 | 확인 내용 |
|---|---|---|
| 공개 첫 화면 진입 | PASS | 제목·달력·검색·책방별 소식 카드 렌더링 |
| 기존 Staging 데이터 로딩 | PASS | 2026년 9월 기준 5개 책방·19개 소식 표시 |
| 달력 다음 달 이동 | PASS | 2026년 10월로 정상 전환 |
| 달력 이전 달 복귀 | PASS | 기존 월로 정상 복귀 |
| 브라우저 오류 로그 | PASS | 공개 화면 진입·월 이동 후 error 0건 |

검증은 공개 화면의 읽기 동작만 수행했습니다. 소식·책방·사진·개선사항을 생성·수정·삭제하지 않았습니다.

## API·DB 기능 검증 근거

배포 전 동일 누적 소스로 실행한 실제 Supabase Staging 통합 테스트는 3/3 통과했습니다.

- 기간 본문과 `news_schedule_ranges` 원자 저장
- 역전 기간 400 응답과 DB 무변경
- 구버전 요청 후 활성 기간 보존
- 공개 Workspace 기간 결합
- JSONB 외부 필드 제거
- 충돌·권한·편집 임대·개선 접수·사진 업로드 회귀

배포 후 공개 브라우저에서 Workspace를 통해 기존 데이터가 정상 표시되는 것을 확인했습니다. `/api/version` 응답 본문 직접 확인은 브라우저 환경 제한으로 이번 보고서의 별도 PASS 항목에 포함하지 않았습니다.

## 데이터 무손실 확인

Staging migration·통합 테스트 전후 비교 결과 기존 데이터와 사진은 모두 동일했습니다.

- 책방 8/8, 소식 묶음 12/12, 개선사항 2/2
- 원본 사진 49/49, 미리보기 사진 49/49
- 기존 데이터 SHA 및 사진 경로·총 bytes 동일
- 테스트 데이터는 고유 ID만 사용하고 `finally`에서 정확히 정리
- Production Supabase 및 Production Sites는 접근·변경하지 않음

## 남은 수동 검증

1. [#56](https://github.com/rlawksml/word-html-studio/issues/56)에서 Staging 입력자 암호와 자판 정규화를 정상화한다.
2. 정상화 후 `기간 입력 → 적용 → 임시 저장 → 재진입 → 미리보기 → HTML` 시나리오를 검증한다.
3. 같은 최종 v1.1 시나리오에서 이슈 #42의 `달력 월 이동만으로 날짜가 추가되지 않음`도 다시 확인한다.
4. 두 수동 검증이 끝나기 전에는 PR을 최종 승인하거나 Production에 배포하지 않는다.

## 결론

이슈 #43 코드는 자동 테스트·실제 Staging DB 통합·Sites Staging 공개 화면까지 정상입니다. 다만 실제 작업자 입력 화면 검증은 남아 있으므로 PR #55는 Draft를 유지하고 Production 판정은 **NO-GO**로 둡니다.

## GitHub Actions 후속 확인

보고서 커밋 직후 첫 `verify`는 스택형 PR의 기준 브랜치 `codex/v1.1-calendar-date-confirm`을 배포 대상 정책이 인식하지 못해 실패했습니다. 앱 기능·DB 테스트 실패는 아니었습니다.

- 원인: 정책이 `main`, `develop`만 알고 있어 `codex/*` 기준 브랜치를 거부
- 수정: `codex/*`를 Staging으로만 정규화
- 안전장치: `codex/*`와 Production Sites project ID의 교차 연결은 계속 실패하도록 TC 추가
- 로컬 재검증: `npm test` 65/65, ESLint, migration 정책, 기능 브랜치 배포 대상 단위 TC 모두 PASS
- GitHub Actions: 보완 커밋 푸시 후 재실행 결과를 이슈와 PR에 추가 기록
