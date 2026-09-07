# 2026-09-07 Sites Staging 배포 전 테스트 보고서

## 판정

- owner-private Staging 배포: `GO`
- Production v1.1 배포: `NO-GO` — 이번 작업 범위가 아니며 사용자 승인과 v1.1 기능 수정·전체 회귀가 남음
- Production 데이터 변경: 없음

## 검증 대상

- Git 브랜치: `codex/staging-sites-environment`
- 병합 대상: `develop`
- Sites: Production과 분리된 owner-private Staging 프로젝트
- Supabase: Production과 분리된 Staging 프로젝트
- 데이터 기준: 2026-09-07 검증 백업을 복원한 DB 22행과 Storage 98개 객체

Secret Key, 역할별 접근 코드와 사용자 데이터 원문은 보고서와 Git에 기록하지 않았다.

## 변경 내용

1. Staging Sites 프로젝트 ID를 별도 hosting 설정에 연결했다.
2. Sites Runtime Environment Variables에 Staging 전용 Supabase와 세션 값을 등록했다.
3. `APP_ENV=staging`일 때 예상 Supabase ref와 실제 URL을 비교한다.
4. Staging의 Production Supabase 차단 목록이 비어 있거나 실제 연결 대상이 차단 목록에 있으면 client 생성 전에 실패한다.
5. SEO canonical 기준 주소는 환경별 `SITE_URL`을 사용한다.

## 자동 검증

| 검증 | 결과 | 비고 |
|---|---|---|
| `npm test` | PASS | production build 포함 33/33 |
| `npm run lint` | PASS | ESLint 오류 없음 |
| `git diff --check` | PASS | 공백 오류 없음 |
| TC-DR-005 환경 차단 | PASS | 올바른 Staging만 허용, 오설정 3종 차단 |
| 실제 Supabase 통합 | PASS | 3/3, DB·Storage·세션·충돌·권한 검증 |
| 복원 기준 재검증 | PASS | DB 8/12/0/2행, 원본 49, 미리보기 49, 누락 0 |

첫 통합 테스트 시도는 실행 샌드박스의 DNS 차단으로 Supabase hostname을 해석하지 못해 3건 모두 실패했다. 외부 네트워크가 허용된 동일 코드·동일 Staging 대상에서 다시 실행하자 3건 모두 통과했다. 첫 시도는 원격 연결 전에 실패했으므로 생성되거나 정리할 데이터가 없었다.

## 실제 왕복 TC 범위

- 테스트 전용 책방과 소식을 생성하고 갱신
- 오래된 `updated_at` 저장을 `409 Conflict`로 거부
- 두 세션의 편집 임대 획득·차단·인계
- JPEG 원본·미리보기 signed upload와 삭제
- 공개 개선사항 접수와 HTML 편집자 전용 상태 변경
- 잘못된 권한, MIME, 사진 용량 요청 거부
- `finally`에서 test 레코드·사진·편집 임대 정리

왕복 TC 종료 후 백업 복원 도구를 `--resume` dry-run으로 실행해 모든 기존 DB행과 Storage 객체의 해시가 원본 백업과 같고 test 잔여 데이터가 없음을 확인했다.

## 데이터 안전 확인

- Production Sites 프로젝트를 수정하거나 재배포하지 않았다.
- Production Supabase에 생성·수정·삭제 요청을 보내지 않았다.
- Staging 테스트는 실행 전 URL과 project ref를 이중 확인했다.
- Staging에 복원된 기존 데이터도 통합 테스트 전후 동일했다.
- 앱 버전 롤백과 DB 보존을 분리하며 배포 실패 시 DB를 초기화하지 않는다.

## 배포 후 필수 확인

1. 배포된 commit과 저장된 Site version commit 일치
2. Staging 홈과 `/api/workspace` HTTP 정상 응답
3. 입력자·HTML 편집자 Staging 전용 코드 로그인
4. Production 공개 홈과 `/api/workspace` 읽기 전용 정상 응답
5. 배포 후 보고서와 GitHub PR 검증 결과 기록
