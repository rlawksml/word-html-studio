# Staging 운영 가이드

Staging은 새 기능과 데이터 호환성을 운영 서비스와 분리해 검증하는 환경입니다. 운영 사용자가 접속하는 Production 사이트와 Supabase에는 Staging 테스트 요청을 보내지 않습니다.

## 환경 분리

| 구분 | Production | Staging |
|---|---|---|
| Git 기준 | `main` 및 릴리스 tag | `develop` 및 기능 PR |
| Sites 프로젝트 | 운영 사이트 | 별도 owner-private 사이트 |
| Supabase | 운영 원본 데이터 | 운영 백업을 검증 복원한 별도 프로젝트 |
| 쓰기 테스트 | 금지 | 테스트 전용 레코드만 생성 후 정리 |

Sites의 `.openai/hosting.json`에는 프로젝트 ID만 저장합니다. Supabase Secret Key, 역할별 접근 코드와 세션 서명키는 Sites Runtime Environment Variables에만 저장하고 Git에 올리지 않습니다.

## 연결 안전장치

Staging 런타임은 다음 세 값을 함께 검사한 뒤에만 Supabase client를 만듭니다.

- `APP_ENV=staging`
- `EXPECTED_SUPABASE_PROJECT_REF`: 현재 연결해야 할 Staging ref
- `BLOCKED_SUPABASE_PROJECT_REFS`: 연결을 금지할 Production ref 목록

예상 ref가 실제 URL과 다르거나 Production 차단 목록이 비어 있으면 요청 전에 실패합니다. 이 검사는 실수로 Staging 앱이 운영 DB에 연결되는 것을 막는 보조 장치이며, 배포 전 환경변수와 대상 사이트를 사람이 다시 확인하는 절차를 대신하지 않습니다.

## 배포 순서

1. 기능 브랜치를 `develop` 대상으로 PR 생성
2. lint, build, 자동 회귀 TC와 민감정보 검사를 통과
3. Staging 전용 Runtime Environment Variables 확인
4. `migration:check` 통과 후 새 additive migration을 Staging Supabase에 먼저 적용
5. `/api/version`으로 DB 스키마와 앱 예상 버전을 대조
6. 검증한 정확한 commit을 Staging Sites 저장소에 push
7. 같은 commit의 build archive를 Site version으로 저장
8. owner-private Staging으로 배포
9. 공개 읽기, 로그인, 저장·충돌·사진 업로드·롤백 왕복·정리 TC 실행
10. 테스트 데이터가 모두 정리됐는지 확인하고 보고서 작성

Production 반영은 별도 승인과 릴리스 PR이 있을 때만 진행합니다. 앱 롤백은 이전 Sites version이나 Git tag로 수행하며, Supabase 데이터를 앱 버전과 함께 되돌리거나 초기화하지 않습니다.

`develop`에는 Staging Sites project ID, `main`에는 Production Sites project ID를 둡니다. `develop`을 `main`으로 반영하는 release PR은 `.openai/hosting.json`을 Production 값으로 되돌린 뒤 `validate:deployment-target`을 통과해야 합니다. GitHub의 실제 Supabase 통합 테스트도 `staging` Environment를 명시하며, 필수 Secret이 없으면 성공으로 건너뛰지 않고 실패합니다.

## 데이터 보호 원칙

- 기존 복원 데이터는 Staging에서도 수정하지 않습니다.
- 자동 테스트는 먼 미래 월과 충돌하지 않는 고유 ID를 사용합니다.
- 테스트가 실패해도 `finally` 정리를 시도하고, 종료 후 잔여 test 레코드와 객체를 다시 확인합니다.
- Production 검증은 GET과 화면 조회 같은 읽기 전용 스모크 테스트만 허용합니다.
- Secret Key, 작업 암호와 사용자 원문은 테스트 보고서와 로그에 남기지 않습니다.
- v1.1 전용 데이터 왕복 TC는 테스트 전용 Submission과 `news_schedule_ranges` 행만 사용하며, 기존 복원 데이터는 fingerprint 비교만 수행합니다.
