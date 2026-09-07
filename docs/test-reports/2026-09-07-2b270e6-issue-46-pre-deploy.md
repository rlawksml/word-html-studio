# 이슈 #46 롤백 호환 DB 기반 배포 전 검증

## 판정

- Staging 배포: **GO**
- Production 배포: **NO-GO 유지** — 기능 PR CI, 누적 Staging 배포 후 검증과 v1.1 릴리스 승인 전에는 반영하지 않음
- 운영 데이터 변경: **없음**
- Staging 기존 데이터 변경: **없음** — additive 스키마 버전 행 1개만 추가

## 검증 대상

| 항목 | 값 |
|---|---|
| GitHub 이슈 | `#46` |
| 브랜치 | `codex/v1.0.1-rollback-compat` |
| 기능 커밋 | `2b270e6` |
| 기준 브랜치 | `develop` (`500e176`) |
| 앱 버전 | `1.0.1` |
| DB 스키마 | `202609070001` |
| 데이터 환경 | Production과 분리된 Supabase Staging |

## 변경 기능과 TC

| 변경 | TC | 결과 | 증거 |
|---|---|---|---|
| 기존 DB JSON의 미래 필드 보존 병합 | TC-DR-008 | PASS | `tests/schema-compatibility.test.mjs`, Staging 통합 테스트 |
| 기간 일정 별도 additive 테이블 | TC-DR-009 | PASS | migration 적용, 기간 행 왕복·정리 확인 |
| 스키마 버전 식별 | TC-DR-009 | PASS | `app_schema_versions.workspace=202609070001`, `/api/version` 통합 응답 |
| 파괴적 migration과 기존 SQL 변경 차단 | TC-DR-007 | PASS | `npm run migration:check`, 금지 SQL fixture |
| 구버전·신규 백업 형식 호환 | TC-DR-001~004 | PASS | 선택 테이블 단위 테스트, migration 전·후 백업 해시 비교 |
| 기존 P0 회귀 | 전체 자동 세트 | PASS | production build 포함 53/53 |

## 실행 결과

| 검증 | 결과 |
|---|---|
| 호환성 집중 단위 테스트 | 6/6 PASS |
| production build 포함 전체 자동 회귀 | 53/53 PASS |
| ESLint | PASS |
| `git diff --check` | PASS |
| migration manifest·파괴적 SQL·Git 변경 검사 | PASS |
| Supabase Staging API·DB·Storage 통합 | 3/3 PASS |
| 민감정보 검사 | 실제 암호·API 키·토큰 0건 |

빌드는 `/api/version`을 포함한 모든 Route Handler를 생성했습니다. 기존 HEIC 지연 로드 청크의 500KB 경고는 이전과 동일하며 이번 DB 변경과 무관합니다.

## Staging migration과 데이터 무결성

### 적용 전 백업

- 백업 위치: 저장소 밖의 임시 검증 디렉터리
- manifest SHA-256: `b5038a2d34446b9f92f59d83a84226713cd53d86de97d4cfac9666f9711d58c8`
- 검증: 108개 파일 / 35,027,567 bytes / PASS
- DB: 책방 8, 월별 소식 12, 편집 임대 0, 개선사항 2
- Storage: 레거시 0, 원본 49, 미리보기 49, 누락·고립 0

### 적용 내용

- 기존 컬럼·테이블·JSON 변경 없음
- `app_schema_versions` 생성 및 `workspace=202609070001` 1행 추가
- `news_schedule_ranges` 생성, 테스트 종료 후 0행
- 두 테이블 모두 RLS 활성화, 작업자 브라우저 직접 접근 권한 없음

### 적용 후 비교

- 백업 검증: 110개 파일 / 35,027,694 bytes / PASS
- 기존 네 테이블: 적용 전과 행 수·JSON SHA-256 모두 동일
- Storage 세 버킷: 객체 수·경로·파일 SHA-256 모두 동일
- 새 테이블: 스키마 버전 1행, 기간 일정 0행

## 실제 왕복 시나리오

1. 먼 미래 월의 고유 ID로 테스트 책방·Submission을 생성했습니다.
2. v1.1 전용 최상위 JSON 필드와 2099-12-01~2100-01-31 기간 행을 추가했습니다.
3. 미래 필드를 보내지 않는 v1.0.1 요청으로 월 운영 안내를 수정했습니다.
4. DB에서 기존 필드 수정값, 미래 JSON 필드와 기간 행이 모두 남았음을 확인했습니다.
5. 기존 권한·충돌·URL 완료 검증과 원본·미리보기 업로드·삭제도 함께 실행했습니다.
6. `finally`에서 테스트 기간 행, Submission, 책방, 편집 임대와 사진만 고유 ID로 삭제했습니다.
7. 최종 기존 데이터와 사진 해시가 사전 백업과 같음을 확인했습니다.

## 테스트 중 발견·수정한 항목

1. 공유 `node_modules`의 Vite 임시 캐시 쓰기 권한으로 첫 build가 `EPERM` 중단됐습니다. 코드 실패가 아니며 캐시 쓰기 권한으로 동일 테스트를 재실행해 통과했습니다.
2. 구버전 DB에서 `head` 조회가 없는 스키마 테이블을 정상처럼 보이는 Supabase 응답을 반환했습니다. 실제 행 조회와 `PGRST205/42P01` 판별로 수정하고 회귀 테스트를 추가했습니다.
3. 첫 SQL Editor 입력에서 기존 점검 SQL의 꼬리가 남아 문법 오류가 났습니다. 두 신규 테이블이 생성되지 않았음을 읽기 전용으로 확인하고, 빈 쿼리에서 동일 migration을 재실행해 성공했습니다.
4. 첫 왕복 fixture가 같은 UTC 시각을 `Z`와 `+00:00` 문자열로 다르게 사용해 의도된 낙관적 잠금 409가 발생했습니다. 실패 데이터가 모두 정리됐음을 확인한 뒤 DB가 반환한 표기를 사용하도록 수정해 통과했습니다.
5. Staging에서 만든 백업을 같은 Staging에 복원하려는 dry-run은 source fingerprint 안전장치가 차단했습니다. 복원하지 않고 migration 전·후 읽기 전용 백업을 별도로 만들어 해시를 비교했습니다.

## 남은 검증과 범위

- 이 보고서는 #46의 코드·DB 호환성과 분리된 Staging 통합 검증까지 다룹니다.
- 누적 Staging Sites에는 같은 커밋의 앱을 배포한 뒤 `/api/version`과 공개 읽기 스모크를 다시 확인합니다.
- #42 달력 UI의 실제 작업자 브라우저 검증은 Staging 입력 암호 문제 해결 후 v1.1 최종 전체 시나리오에서 다시 수행합니다.
- Production 앱·Sites·Supabase에는 배포나 쓰기를 수행하지 않았습니다.
