# 이슈 #44 Staging 배포 후 테스트 보고서

## 판정

- 결과: `PASS — develop 병합 가능, Production은 미반영`
- 단계: `POST-DEPLOY / owner-private Staging`
- 작성 일시: 2026-09-07 KST
- 검증자: Codex

## 배포 대상

- 브랜치: `codex/v1.1-final-korean-save`
- 배포 커밋: `b730355439705c3df70b9e278027955b7acea4f3`
- Sites 프로젝트: `책방소식 Staging`
- Sites 버전: `4`
- 환경 변수 revision: `1`
- 주소: `https://bookstore-news-studio-staging.rlawksml.chatgpt.site`
- 공개 범위: owner-private
- Production 코드·Sites·Supabase 변경: 없음

## TC 결과

| 검증 항목 | 결과 | 증거 |
|---|---|---|
| 집중 단위 테스트 | PASS | `submission-completion.test.mjs` 5/5 |
| 전체 자동 회귀 | PASS | production build 포함 40/40 |
| lint | PASS | ESLint 오류 0 |
| Supabase Staging 통합 | PASS | API·DB·Storage 3/3, 테스트 데이터 자동 정리 |
| 한글 연속 입력 직후 완료 | PASS | `신규모` 다음 `집완료`를 입력하고 즉시 완료, 목록으로 정상 복귀 |
| DB 저장값 직접 확인 | PASS | 상태 `completed`, 제목 `신규모집완료`, 상세 마지막 글자 보존 |
| JSONB 응답 정규화 | PASS | 객체 키 순서와 UTC 표기 차이는 허용하고 실제 본문 손실은 계속 차단 |
| 배포 provenance | PASS | Sites 원격·저장 버전·배포 버전 모두 `b730355...` 일치 |
| 배포 상태 | PASS | Sites version 4 `succeeded`, 최근 Worker 오류 0건 |
| 데이터 원상복구 | PASS | `RESUME_DRY_RUN_PASS`, DB 8/12/0/2행, 원본·미리보기 49/49개, 누락 0 |

## 브라우저 검증 중 발견·수정한 사항

첫 시도에서는 제목과 상세가 DB에 정확히 저장됐는데도 완료 후 편집 화면에 남았다. Supabase의 정상 응답이 완료 시각을 다른 ISO 표기로 반환하고 PostgreSQL JSONB가 객체 키 순서를 바꾸면서, 문자열 기반 본문 비교가 이를 변경으로 오인했다.

실패하는 회귀 테스트를 먼저 추가한 뒤 다음 기준으로 수정했다.

- 제목·상세·날짜·사진 순서·선택 입력 등 사용자 내용은 계속 엄격히 비교한다.
- 저장·완료·게시 시각의 표현 차이와 서버가 생성하는 이미지 URL은 비교에서 제외한다.
- JSON 객체 키 순서는 정렬해 비교하고, 배열의 사용자 순서는 보존한다.

보완 후 같은 한글 즉시 완료 시나리오와 DB 직접 조회가 통과했다.

## 테스트 데이터 보호

- 브라우저 검증은 ID가 고정된 전용 QA 책방·소식만 생성했다.
- 정리 시 책방 ID·소식 ID·책방 이름을 함께 조건으로 사용했고 정확히 QA 행 2개만 삭제됐다.
- 편집 임대와 Storage 테스트 객체도 정리했다.
- 마지막 읽기 전용 백업 비교에서 기존 Staging DB 및 사진 98개가 모두 기준과 일치했다.

## 잔여 확인

- Staging은 owner-private 로그인 화면으로 보호되어 자동화 세션에서 배포 URL 내부 UI를 다시 열지는 않았다.
- 동일한 `b730355` production build를 로컬 브라우저에서 Supabase Staging에 연결해 전체 사용자 흐름을 검증했고, 배포 archive·Sites source·version의 SHA 일치를 확인했다.
- 실제 사용자의 물리 한글 IME 후보 조합은 Staging에서 한 번 더 확인하면 좋지만, Production 승격을 막는 자동·통합 테스트 실패는 없다.

## 결론

- GitHub PR을 `develop`에 병합할 수 있다.
- 이슈 #44는 Production에 아직 반영되지 않았으므로 닫지 않는다.
- Production 배포는 나머지 v1.1 변경과 함께 별도 승인·배포 전 TC를 거쳐 진행한다.
