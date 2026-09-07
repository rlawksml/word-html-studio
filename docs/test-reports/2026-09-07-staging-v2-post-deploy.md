# 2026-09-07 Sites Staging 버전 2 배포 후 테스트 보고서

## 판정

- owner-private Staging 준비: `GO`
- `develop` 병합: `GO`
- Production v1.1 배포: `NO-GO` — 버그 수정과 v1.1 전체 회귀 전에는 운영에 반영하지 않음
- 운영 데이터 변경: 없음

## 검증 대상

- Staging URL: `https://bookstore-news-studio-staging.rlawksml.chatgpt.site`
- 배포 버전: Sites version 2
- 배포 commit: `620cfe1a97089e1943600bb688faba098afd4245`
- 환경변수 revision: 1
- GitHub PR: #50, `develop` 대상
- GitHub 수동 CI: `34096135680`

Secret Key, 세션 cookie, 역할별 접근 코드와 사용자 데이터 원문은 보고서와 Git에 기록하지 않았다.

## 결과 요약

| 검증 | 상태 | 실제 결과 |
|---|---|---|
| Sites 배포 | PASS | version 2, 상태 `succeeded`, commit 일치 |
| 환경 격리 | PASS | Staging Supabase 예상 ref와 Production 차단 ref 검사 |
| TC-DR-006 | PASS | `develop`/Staging 허용, `main`/Staging 교차 연결 차단 |
| 자동 회귀 | PASS | production build 포함 35/35 |
| lint·diff | PASS | 오류·공백 오류 없음 |
| GitHub verify | PASS | 배포 대상 검사·lint·35개 회귀 통과 |
| GitHub Supabase 통합 | PASS | staging Environment에서 3/3 통과 |
| 데이터 정리 | PASS | DB 8/12/0/2행, 원본 49·미리보기 49, 누락 0 |
| Staging 공개 읽기 | PASS | 홈 200, 책방 8·제출 12·소식 46 |
| Staging 역할 세션 | PASS | 입력자 200, HTML 편집자 200 |
| owner-private 접근 | PASS | 미인증 브라우저에 로그인 필요 화면 표시 |

## 실행 상세

1. GitHub `staging` Environment에 Staging 전용 Secret 7개를 등록했다.
2. 수동 통합 job이 필수 Secret 존재를 확인한 뒤 build와 Supabase 통합 테스트 3건을 실행했다.
3. 통합 테스트는 테스트 전용 레코드·사진·편집 임대를 만들고 `finally`에서 정리했다.
4. 테스트 종료 후 복원 도구의 `--resume` dry-run으로 DB 전체와 Storage 98개 객체의 크기·SHA-256을 다시 검증했다.
5. 최종 commit을 Staging Sites source와 build archive에 동일하게 사용하고 비공개 배포했다.
6. Sites 전용 비공개 검증 토큰으로 홈과 읽기 API를 요청하고, Staging 전용 코드로 두 역할의 세션 발급을 확인했다.

브라우저에서는 owner-private 로그인 화면과 저장된 OpenAI 계정 선택 화면까지만 확인했다. 계정 식별정보를 다시 전송하는 선택 단계는 실행하지 않았고, 애플리케이션 응답은 Sites가 발급한 검증 토큰을 숨김 표준입력으로 전달한 HTTP 스모크로 확인했다.

## 배포·데이터 안전 확인

- Production Sites version 34는 수정하거나 재배포하지 않았다.
- `main`과 Production Supabase에는 쓰기 요청을 보내지 않았다.
- GitHub 수동 통합 job은 `environment: staging`을 명시한다.
- Staging Secret이 빠지면 통합 job이 SKIP 성공으로 끝나지 않고 실패한다.
- `main` 대상 PR에 Staging Sites project ID가 남아 있으면 CI가 실패한다.
- 앱 롤백과 DB 보존은 분리하며 이전 앱 버전으로 되돌려도 DB를 초기화하지 않는다.

## 남은 범위

- PR #50 자체 리뷰 후 `develop` 병합
- v1.1 버그별 기능 브랜치와 Staging 검증
- v1.1 전체 TC가 끝나기 전 Production 배포 금지
- 비공개 Staging의 육안 UI 검토는 사용자가 필요할 때 OpenAI 계정을 선택해 진행
