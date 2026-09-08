# 이슈 #42·#43 작업자 브라우저 검증 — 입력자 암호 차단

## 판정

- `TC-AUTH-001 입력자 암호와 자판 변환`: **FAIL**
- `TC-SUB-010 행사 날짜 월 탐색과 추가 분리`: **BLOCKED**
- `TC-SUB-011 장기 행사 시작일·종료일 기간 입력`: **BLOCKED**
- Production 배포: **NO-GO**
- Production 및 기존 Staging 데이터 변경: **없음**

## 대상

- 검증 일시: 2026-09-08 KST
- Sites Staging: <https://bookstore-news-studio-staging.rlawksml.chatgpt.site/>
- Sites version: 8
- 배포 누적 소스: `cb2aff1`
- PR 최신 커밋: `aa95e01`
- 관련 이슈: [#42](https://github.com/rlawksml/word-html-studio/issues/42), [#43](https://github.com/rlawksml/word-html-studio/issues/43), [#56](https://github.com/rlawksml/word-html-studio/issues/56)

## 실행 결과

1. 공개 방문자 화면에서 `소식 입력`을 열었다.
2. 합의된 입력자 암호의 영문 자판 형태를 입력했다.
3. 서버가 `POST /api/session`을 HTTP 401로 거부했다.
4. 같은 암호의 한글 자판 형태를 입력했다.
5. 서버가 다시 HTTP 401을 반환했고 화면에 `작업 암호를 확인해 주세요.`가 표시됐다.

Sites Worker 로그에는 두 요청이 각각 `/api/session` 401로 남았고 Worker 실행 자체의 outcome은 정상이다. 즉 화면 클릭이나 Worker 크래시가 아니라 서버의 암호 판정 단계에서 거부된 결과다.

## 코드·환경 확인

- Sites Staging 환경 revision 3에 `INPUT_ACCESS_CODES`가 secret 항목으로 등록돼 있다.
- secret 값은 보안상 조회할 수 없어 실제 저장값을 보고서에 기록하거나 비교하지 않았다.
- 현재 서버 코드는 암호 문자열에 NFC 정규화와 앞뒤 공백 제거만 수행한다.
- 한글 자판 문자열과 영문 자판 문자열을 서로 변환하지 않으므로 UI 안내의 `두 자판 상태 지원`을 코드가 자체적으로 보장하지 않는다.
- 두 합의 형태가 모두 401이므로 Staging secret의 값 또는 배포 바인딩도 함께 확인해야 한다.

## 데이터 안전

- 로그인 단계에서 중단되어 테스트 책방·Submission·기간 행·사진을 생성하지 않았다.
- 정리할 테스트 데이터가 없음을 확인했다.
- 기존 공개 화면의 5개 책방·19개 소식은 그대로 표시됐다.
- Production Sites와 Supabase에는 요청·변경·배포를 수행하지 않았다.

## 다음 조치

1. #56에서 서버 자판 정규화와 비밀값 없는 단위 TC를 구현한다.
2. Staging의 입력자 secret을 합의된 값으로 재설정하고 새 버전을 배포한다.
3. `TC-AUTH-001`을 영문·한글 각각 재검증한다.
4. 로그인 성공 뒤 #42와 #43을 고유 테스트 책방으로 실행하고 정확한 ID로 정리한다.
5. 모든 P0·P1 결과가 PASS가 되기 전에는 Production으로 진행하지 않는다.
