# 이슈 #56 입력자 암호 자판 정규화 — Sites Staging 배포 후 검증

## 판정

- 서버 인증·세션 API: **PASS**
- 브라우저 공개 화면과 인증 모달: **PASS**
- 브라우저 실제 암호 제출: **PASS**
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
| 브라우저 영문 자판형 로그인 | PASS | 인증 모달에서 입력 후 책방 소식 입력 화면 진입 |
| 브라우저 새로고침 세션 유지 | PASS | 새로고침 후 책방 소식 입력 화면과 로그아웃 버튼 유지 |
| 브라우저 로그아웃 | PASS | 방문자 화면 복귀 후 작업자 UI 비노출 |
| 브라우저 한글 자판형 로그인 | PASS | 인증 모달에서 입력 후 책방 소식 입력 화면 진입 |
| 기존 공개 데이터 | PASS | 브라우저에서 5개 책방·19개 소식 유지 |
| 브라우저 오류 로그 | PASS | 새 배포 확인 중 error·warn 없음 |
| DB·Storage 쓰기 | PASS | 인증 요청만 실행, 업무 데이터 쓰기 0건 |

실제 작업 암호, 세션 쿠키, Sites 우회 토큰은 보고서와 명령 출력에 기록하지 않았다.

## 수동 확인 완료

사용자 확인 후 영문 자판형 로그인 → 새로고침 세션 유지 → 로그아웃과 한글 자판형 로그인 → 로그아웃을 실제 스테이징 UI에서 확인했다. 소식·책방·사진 편집 화면에는 진입하지 않았고 업무 데이터 요청은 모두 읽기 전용이었다.

## 결론

서버 경계와 실제 브라우저 UI에서 한글·영문 두벌식 정규화와 세션 생명주기가 모두 정상이다. 공개 데이터도 배포 전과 동일하다. 이슈 #56은 Staging 검증을 완료했으며 #42·#43 작업자 화면 검증을 재개할 수 있다. Production은 변경하지 않았다.
