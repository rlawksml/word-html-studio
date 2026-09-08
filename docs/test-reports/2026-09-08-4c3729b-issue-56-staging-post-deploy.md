# 이슈 #56 입력자 암호 자판 정규화 — Sites Staging 배포 후 검증

## 판정

- 서버 인증·세션 API: **PASS**
- 브라우저 공개 화면과 인증 모달: **PASS**
- 브라우저 실제 암호 제출: **사용자 확인 대기**
- Production 배포: **NO-GO**
- Production·Staging 업무 데이터 변경: **없음**

## 배포 식별자

- 이슈: [#56 Staging 입력자 암호와 한글·영문 자판 검증 실패](https://github.com/rlawksml/word-html-studio/issues/56)
- PR: [#57 한글·영문 작업 암호 자판 정규화](https://github.com/rlawksml/word-html-studio/pull/57)
- 브랜치: `codex/v1.1-access-code-keyboard`
- 배포 커밋: `4c3729b8a772026bbba2b4bdfdc28ba779e55b01`
- Sites Staging 버전: 9
- 환경변수 개정: 4
- 배포 ID: `appgdep_6a9f66cdc3988191aa532929d2010287`
- 배포 주소: `https://bookstore-news-studio-staging.rlawksml.chatgpt.site`

## 검증 결과

| 검증 | 결과 | 증거 |
|---|---|---|
| GitHub Actions `verify` | PASS | PR #57 CI 성공 |
| GitGuardian | PASS | PR #57 보안 검사 성공 |
| 배포 소스 일치 | PASS | Sites 원격 `main`과 저장 버전이 배포 커밋과 동일 |
| 영문 자판형 로그인 | PASS | `POST /api/session` 200, 역할 `input` |
| 영문 세션 복원 | PASS | 동일 쿠키·탭 ID로 `GET /api/session` 200 |
| 로그아웃 | PASS | `DELETE /api/session` 204, 이후 GET 401 |
| 한글 자판형 로그인 | PASS | `POST /api/session` 200, 역할 `input` |
| 한글 세션 복원 | PASS | 동일 쿠키·탭 ID로 `GET /api/session` 200 |
| 기존 공개 데이터 | PASS | 브라우저에서 5개 책방·19개 소식 유지 |
| 브라우저 오류 로그 | PASS | 새 배포 확인 중 error·warn 없음 |
| DB·Storage 쓰기 | PASS | 인증 요청만 실행, 업무 데이터 쓰기 0건 |

실제 작업 암호, 세션 쿠키, Sites 우회 토큰은 보고서와 명령 출력에 기록하지 않았다.

## 남은 수동 확인

브라우저에 실제 작업 암호를 입력하는 행위는 민감정보 전송이므로 사용자 확인 직후 다음 두 경로만 수행한다.

1. 영문 자판형으로 소식 입력 화면 진입 → 새로고침 후 역할 유지 → 로그아웃
2. 한글 자판형으로 소식 입력 화면 진입 → 로그아웃

이 확인이 끝나면 이슈 #56을 완료 처리하고, #42·#43의 작업자 화면 검증을 재개한다. 실제 소식·책방·사진은 생성하거나 수정하지 않는다.

## 결론

서버 경계에서 한글·영문 두벌식 정규화와 세션 생명주기가 모두 정상이다. 공개 데이터도 배포 전과 동일하다. 브라우저 실제 제출 확인 전까지 PR은 Draft로 유지하며 Production은 변경하지 않는다.
