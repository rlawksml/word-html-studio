# 이슈 #46 롤백 호환 DB 기반 Staging 배포 후 검증

## 판정

- Staging: **PASS**
- develop 병합: **GO**
- Production 배포: **NO-GO 유지** — v1.1 전체 시나리오와 별도 승인 전에는 반영하지 않음
- Production 앱·Sites·Supabase 변경: **없음**
- Staging 기존 데이터·사진 변경: **없음**

## 배포 대상

| 항목 | 값 |
|---|---|
| GitHub 이슈 | `#46` |
| 기능 커밋 | `2b270e6` |
| 누적 Sites 커밋 | `b6476c353d4f60dade4c2cc65776bdbad3e21797` |
| Sites Staging 버전 | `7` |
| 앱 버전 | `1.0.1` |
| DB 스키마 | `202609070001` |
| Staging URL | `https://bookstore-news-studio-staging.rlawksml.chatgpt.site/` |

누적 Sites 커밋은 앞서 배포한 #42 날짜 선택 수정 위에 #46 변경을 추가했다. 따라서 이번 배포가 #42를 되돌리지 않는다.

## 배포 전 누적 회귀

| 검증 | 결과 |
|---|---|
| migration 정책·manifest 검사 | PASS |
| production build 포함 자동 회귀 | 57/57 PASS |
| ESLint | PASS |
| `git diff --check` | PASS |
| GitHub Actions `verify` | PASS |
| GitGuardian | PASS |

기존 HEIC 지연 로드 청크의 500KB 초과 경고는 이전과 동일하며 이번 DB 호환 변경과 무관하다.

## 배포 후 읽기 전용 스모크

| 경로 | HTTP | 결과 |
|---|---:|---|
| `/` | 200 | 초기 연결 안내 후 방문자 달력 화면 표시 |
| `/help` | 200 | 도움말 화면 응답 |
| `/api/workspace` | 200 | Staging 공용 데이터 응답 |
| `/api/version` | 200 | 앱·커밋·DB 호환 상태 응답 |

`/api/version` 확인값:

- `productVersion=1.0.1`
- `commitSha=b6476c353d4f60dade4c2cc65776bdbad3e21797`
- `databaseSchemaVersion=202609070001`
- `expectedSchemaVersion=202609070001`
- `compatible=true`

배포 직후 최근 15분의 Staging Worker 오류 로그는 **0건**이었다.

## 배포 전후 데이터·사진 무결성

배포 전 migration 적용 후 백업과 배포 후 읽기 전용 백업을 비교했다.

| 항목 | 배포 전 | 배포 후 | 결과 |
|---|---:|---:|---|
| 책방 | 8 | 8 | 동일 |
| 월별 소식 | 12 | 12 | 동일 |
| 편집 임대 | 0 | 0 | 동일 |
| 개선사항 | 2 | 2 | 동일 |
| 스키마 버전 | 1 | 1 | 동일 |
| 기간 일정 | 0 | 0 | 동일 |
| 원본 사진 | 49 | 49 | 동일 |
| 모바일 미리보기 | 49 | 49 | 동일 |

- 모든 DB 테이블: 행 수와 canonical JSON SHA-256 동일
- 모든 Storage 버킷: 객체 수·경로·바이트·파일 SHA-256 동일
- DB가 참조하지만 없는 원본/미리보기: 0
- DB가 참조하지 않는 고립 사진: 0
- 배포 후 백업 manifest SHA-256: `9457de4383adc10045bcebc0d182e3ace607208395784370ad29a9341c35eadc`

## 남은 검증

- #42의 실제 작업자 달력 UI 검증은 Staging 소식 입력 암호가 정상화된 뒤 v1.1 최종 전체 시나리오에서 다시 수행한다.
- #46 GitHub 이슈는 develop 병합 뒤에도 Production 릴리스 전까지 열어 둔다.
- 다음 기능 이슈는 #43 기간 일정 입력 UX이며, #46에서 만든 additive 기간 테이블을 사용한다.

