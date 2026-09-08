# 이슈 #56 입력자 암호 자판 정규화 — Staging 배포 전 검증

## 판정

- 기능 구현·단위 회귀: **PASS**
- Sites Staging 배포: **GO**
- Production 배포: **NO-GO** — 실제 Staging 로그인과 #42·#43 작업자 시나리오 전에는 진행하지 않음
- Production 데이터 변경: **없음**

## 범위

- 이슈: [#56 Staging 입력자 암호와 한글·영문 자판 검증 실패](https://github.com/rlawksml/word-html-studio/issues/56)
- 기준 브랜치: `codex/v1.1-schedule-range`
- 기능 브랜치: `codex/v1.1-access-code-keyboard`
- 기능 커밋: `1ec24fb`
- 영향 경계: `/api/session`이 사용하는 서버 암호 비교
- DB migration: 없음

## 원인과 수정

기존 코드는 암호 문자열에 NFC 정규화와 앞뒤 공백 제거만 적용했다. 한글 완성형과 영문 두벌식 키 조합을 서로 변환하지 않아 UI가 안내하는 `한글·영문 자판 모두 지원`을 코드 자체가 보장하지 못했다.

`lib/access-code-normalization.mjs`를 추가해 한글 완성형·호환 자모·정규 자모를 실제 두벌식 영문 키 조합으로 변환한다. 환경변수 값과 사용자가 제출한 값을 같은 방식으로 변환한 뒤 서버에서만 비교한다.

- 일반 영문·숫자·기호는 그대로 유지
- 영문 대소문자 구분 유지
- 쌍자음의 Shift 키 대소문자 유지
- 복합 모음과 겹받침 키 순서 보존
- 빈 문자열과 유사 문자열 거부
- 기존 로그인 실패 제한과 HttpOnly 세션 유지

## 검증 결과

| 검증 | 결과 | 증거 |
|---|---|---|
| 실패 회귀 | PASS | 구현 전 전용 모듈 부재로 테스트 실패 확인 |
| TC-AUTH-001 집중 | PASS | `access-code-normalization.test.mjs` 4/4 |
| 전체 자동 회귀 | PASS | `npm test`, 빌드 포함 69/69 |
| ESLint | PASS | `npm run lint` |
| migration 정책 | PASS | `npm run migration:check` |
| 민감정보 점검 | PASS | 변경 diff에 실제 작업 암호·Secret 없음 |
| DB·Storage 영향 | PASS | migration·DB·사진 코드 변경 없음 |

테스트 문자열은 실제 작업 암호가 아닌 합성 문자열을 사용했다. 실제 암호 값은 소스, 테스트, 문서, 로그에 기록하지 않았다.

## Staging 배포 후 필수 검증

1. Staging의 입력자 secret을 합의된 한 형태로 재설정한다.
2. 같은 암호의 영문 자판 형태와 한글 자판 형태가 모두 로그인되는지 확인한다.
3. 새로고침 후 세션 유지, 로그아웃 후 재접속 차단을 확인한다.
4. 고유 테스트 책방으로 #42·#43 작업자 시나리오를 수행하고 정확한 ID로 정리한다.
5. 기존 Staging 행·사진 수와 해시를 다시 비교한다.

## 결론

코드 수준의 TC-AUTH-001 결함은 수정됐고 Staging 배포 조건을 충족한다. 실제 Sites 환경변수와 브라우저 확인이 끝날 때까지 이슈와 PR은 열어 두며 Production은 **NO-GO**다.
