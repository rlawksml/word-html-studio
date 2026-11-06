# 운영 반영 전 통합 진행표

## 최신 결과 — 아래 초기 실패·차단 이력보다 우선

- **롤백 후보의 비공개 Mac 재검증 PASS / 실제 운영 fallback 미확정:** 운영 Sites 조회에서 공개 v34의 저장 ID, 소스 `28efad2`, archive SHA, 성공 publish와 환경 revision 1을 재확인했다. 과거 exact parser의 미래 필드 보존 실패 때문에 v34를 v1.1 이후 안전 fallback으로 쓰지 않는다. 호환 후보 `873a4dd`의 정확한 소스를 꺼내 스테이징 빌드와 같은 잠금 패키지 706개를 재사용했다. 외부 연결 차단 아래 type/lint/build, 앱 30개, 데이터 보존 10개 PASS(별도 suite) 및 로컬 산출물 144개 해시 봉인. 준비 정책 17개 PASS, 증거가 없는 템플릿은 차단. 로컬 산출물은 Sites의 불변 버전이 아니며 운영에 저장·활성화하지 않았다.
- **복원 준비: 합성·모의 PASS / 실제 Supabase 복원 BLOCKED:** 합성 백업 17개 파일과 SQL 8개 순서·해시, 안전 정책 34개가 통과했다. 별도 로컬 시험 사본에서 행 수 헤더가 없을 때 기존 1행을 0행으로 오인하는 사례를 재현하고, 정확한 행 수를 얻기 전에는 dry-run과 쓰기 모두 차단하도록 보완했다. 이후 모의 HTTP 시나리오 8개 PASS, 정상 모의 복원 업무 행 5·사진 2와 marker 무변경 확인. 별도 빈 무료 대상의 관리자 확인·정확한 행 수 및 버킷 확인·실제 복원은 미실행이다. 운영과 기존 스테이징에 복원하지 않았다.
- **스테이징 직접 배포 PASS:** GitHub 파일 전송 없이 기존 Cloudflare Free 스테이징의 exact `2bf2166`이 활성 버전 `383bd034-6b6d-4047-8af6-5a86c3350e7e`로 100% 반영됐다. 이전 활성 버전 `2b42464f-8ed5-4073-b93e-27f0e7da0aa5`를 교체 전에 확인했다. 원격 익명 GET 5개에서 gate 200, 페이지 303, 비로그인 API/robots 401 및 no-store/noindex가 통과했다. 인증된 브라우저에서 앱 SHA와 실제 workspace marker를 대조하고 입력자 로그인을 통과했다. 대상 Supabase의 workspace/digest_order marker 직접 읽기도 통과했다. 새 QA 데이터 쓰기·사진·통합본 충돌·실복원은 별도 TC이며 운영 반영은 하지 않았다.
- **실제 스테이징 #86 두 세션 PASS:** 앱 SHA·DB marker와 미사용 QA 월을 확인하고, 실제 입력자 두 세션으로 신규 QA 책방 2개와 기간을 포함한 소식 2개만 작성·완료했다. 같은 책방 임대 차단·다른 책방 진입 권한·임대 인계를 API에서 확인했다. 별도의 HTML 역할 두 세션으로 정상 통합 순서 revision 1 저장, 임대 없는 저장 423, 오래된 revision 충돌 409, 읽기 복귀 시 revision/순서 유지가 통과했다. 기존 10개 책방·14개 제출의 역할별 지문은 보존됐고 페이지 예외/대상 API 5xx 0이었다. UI의 실제 편집 차단 팝업·사진과 HTML ZIP은 별도 TC다. 신규 QA 자료는 승인대로 보존했다.
- **최신 후보 사진·HTML 브라우저 TC 미실행:** 별도 격리 브라우저에서 테스트 공간 입장은 통과했지만 입력자 접속을 기다리다가 제한 시간에 종료됐다. 사진 예약·업로드·차단된 쓰기·서버 5xx 각 0이다. 기능 실패 또는 통과로 기록하지 않는다. 다음은 기존 승인 QA 책방 1곳만 대상으로 사진 2장·원본/미리보기, HTML 복사 및 HTML/TXT/ZIP 비교를 잇는다.
- **파일명 해결·공개 전송 차단:** exact `2bf2166cfbfc4f10f430b5d1b8b3d243e2a5cd59`의 [42161061577](https://github.com/rlawksml/word-html-studio/actions/runs/42161061577)은 서버 정적 JS 파일명에만 `~`를 허용한 뒤 경로 검사 clear, type/lint/build·앱 277/277·Worker 36/36, 정리 완료, 아티팩트 0이었다. native 정책 16/16도 별도 통과했다. 같은 SHA의 [공개 전송 42161310989](https://github.com/rlawksml/word-html-studio/actions/runs/42161310989)는 `ARTIFACT_BUILD_SECRET` 차단, 업로드 0개였다. [#66 기록](https://github.com/rlawksml/word-html-studio/issues/66#issuecomment-6676804627).
- **비공개 Mac 빌드 PASS:** 사용자 승인 이후 공식 npm의 고정 의존성만 스크립트·감사 전송 없이 격리 설치했다. 외부 연결 차단으로 type/lint/build·앱 277/277·Worker 36/36 통과(Worker 에뮬레이터는 루프백만 허용). 첫 app 재현의 두 실패는 미복사 CI YAML로 exact 파일 추가 후 통과했고, Worker 첫 시도는 내부 소켓까지 차단해 실패했다. Vinext 생성 키는 서버 모듈 1개에서 확인되고 공개 정적 파일 29개에는 없었다. 비공개 직접 배포 전 고정 Wrangler dry-run은 2770.64 KiB, 소유 서비스 정리 PASS였다. 공개 파일 전달 정책은 완화하지 않았다.
- **운영 읽기 전용 기준 백업 완료:** Mac에만 보관 및 무결성 확인했다. 실제 원격 복원 및 운영 반영 직전 호환 fallback 기준 백업과 구분한다. 운영 원문과 저장 경로는 공개 문서에 남기지 않는다.

- **최신 앱·Worker 전체 PASS:** `855cedf20babd64a229a8c3ecf732d39d23c1f80`의 [42148671738](https://github.com/rlawksml/word-html-studio/actions/runs/42148671738), type/lint/build 통과, 앱 277/277·Worker 36/36, 실패·취소·skip·todo 0 및 엄격 정리 후 COMPLETE. source `9cfdb79f8b7a18db3907122afcd6946377f56fe85fb352c3b8d0f9f4126ee74d`, 아래 보안 재검사와 같은 package/lock이다. 산출물 업로드를 끈 독립 실행이며, 아래 같은 SHA의 실제 전송 차단을 대체하지 않는다.
- **보안 패치 적용·재검사 PASS:** 고정 [42143032769](https://github.com/rlawksml/word-html-studio/actions/runs/42143032769)에서 공개 JSON 2개만 전달, 소유 정리 후 완료했다. package `8ac1094010fc4add604508dbf88acd4b5c28f72a5dbed655bb621fe7e7b0c916` / lock `622d7d230167de6c8abb929441b5104c9a1a9910ab7ccaa2621963c798149e7a`. 주·독립 검토에서 루트+대상 5개 lock record만 변경·701개 불변·추가/삭제 0을 확인했다. [동일 pair의 실제 npm 재검사 42143497355](https://github.com/rlawksml/word-html-studio/actions/runs/42143497355)에서 high/critical 0, moderate 17, 엄격 정리 뒤 COMPLETE다. 전체 취약점 0이나 운영 배포 판정은 아니다.
- **호환 롤백 코드 회귀 PASS:** 보안 패치 이식 exact `873a4dda3e87775d5b5c24623342023f7dc4e32a`에서 [type/lint/build·앱30·엄격 정리 42143543021](https://github.com/rlawksml/word-html-studio/actions/runs/42143543021)와 [별도 JSON 보존 검증 42143546067](https://github.com/rlawksml/word-html-studio/actions/runs/42143546067)을 통과했다. 실제 Sites 불변 롤백 배포물이 아니다. v34는 미래 JSON 보존 실패로 안전한 쓰기 롤백 대상에서 제외한다.
- **스테이징 DB 읽기 PASS:** `kriyjyyudngtibrtkylf`의 실제 marker 쿼리에서 workspace `202609070002`와 digest_order `202611040001` 일치를 확인했다. 단순 HTTP 성공과 구분하며 사용자 QA는 아직 실행 전이다.
- **백업 변경 감지/기존 writer 28 PASS:** [42144705753](https://github.com/rlawksml/word-html-studio/actions/runs/42144705753), exact `806a72b945aab85e0d7829d108fbfd8a644ec67f`, fail/skip 0 및 소유 컨테이너 정리 확인. [앞선 42143911662](https://github.com/rlawksml/word-html-studio/actions/runs/42143911662)은 새 두 파일 조합이 런처의 고정 허용 목록에 없어 실행 전 차단됐고 정리는 확인했다. 기존 운영 자료는 사용하지 않았다.
- **첫 컴파일 전달 FAIL / 전송 없음:** [42144254942](https://github.com/rlawksml/word-html-studio/actions/runs/42144254942) exact `f06b649`의 빌드 이후 artifact 검사에서 `ARTIFACT / ERR_ASSERTION`, upload 단계 SKIPPED. 합성 정책 13 PASS와 실제 전달을 구분한다. 후속은 허용 목록을 유지하며 어떤 고정 조건이 실패하는지만 보고한다.
- **생성 경로 및 키 제외 보강:** 실제 실패에서 `dist/client/vinext-client-entry-manifest.json`, `dist/server/BUILD_ID`, `dist/server/RSC_BUILD_ID`를 순서대로 확인했다. 생성 파일의 정확한 경로를 추가했으며 파일 내용·소스맵·로컬 환경 설정은 진단 출력하지 않는다. 공식 vinext 1.2.0 배포물의 프리렌더 임시 키 생성 경로를 확인해 두 서버 manifest를 전달 대상에서 제외했고, 같은 키 바이트가 번들에 존재해도 차단한다. 이전 [42146791157](https://github.com/rlawksml/word-html-studio/actions/runs/42146791157)은 취소 완료, 산출물 0개를 확인했다. 합성 13/13 검증은 실제 전달 완료를 대신하지 않는다.
- **Mac writer 합성 확인:** 외부 네트워크나 운영 키 없이 이 Mac에서 전용 새 경로에 합성 파일 6개, 디렉터리 0700·파일 0600, 종료 후 완료 표식을 실제 확인했다. 샌드박스 내 macOS Python 시작 경고는 운영 장애가 아니었다. [#47 기록](https://github.com/rlawksml/word-html-studio/issues/47#issuecomment-6674540315). 실제 백업은 무편집 시간 확인이 필요하다.
- **스테이징 전달 BLOCKED:** 최신 `855cedf20babd64a229a8c3ecf732d39d23c1f80`의 [42148528636](https://github.com/rlawksml/word-html-studio/actions/runs/42148528636)은 서버 JavaScript 생성 경로의 문자 형태가 현재 허용 규칙과 맞지 않아 `ARTIFACT_PATH_LAYOUT` / `dist/server/[masked-shape].js`로 중단됐다. 실제 이름·본문은 공개하지 않았고 결과물 0개를 확인했다. 미확인 경로 전체를 풀거나 파일 전송 단계를 우회하지 않는다. 다음은 업로드가 없는 격리 빌드에서 허용 범위를 벗어난 문자 유형과 참조 여부를 확인하고, 정확한 규칙만 조정하는 것이다. 기존 Worker 활성 `2b42464f`는 교체하지 않았다.
- **독립 앱 회귀의 원인과 수정:** 파일 전달을 끈 [42148220732](https://github.com/rlawksml/word-html-studio/actions/runs/42148220732)은 앱 276PASS/1FAIL이었다. 정책 테스트가 옛 Vite `8.2.2`를 기대한 줄을 확인해 새 `8.2.4` 및 승인된 네 override·lock 버전의 고정 검증으로 바꿨다. 해당 테스트 파일 5/5 통과 후 위 최신 전체도 통과했다.
- **운영 NO-GO 유지:** 아래는 격리 회귀와 공개 의존성 metadata audit의 결과다. 실제 운영 공격 도달성은 미확정이며, 최신 Staging 사용자 QA·독립 백업/복원·불변 fallback 배포물 검증 완료를 뜻하지 않는다. 이번 후속으로 기존 운영 DB/사진/환경·원본 제출파일을 변경하지 않았다.
- **실제 dev 포함 audit는 FINDINGS:** exact `3cc96076a6e26d8c189d4c10cd85356ee45de5a3`의 [42079906669](https://github.com/rlawksml/word-html-studio/actions/runs/42079906669)은 npm11.19.1, SEAL/FINAL/엄격 정리 뒤 **18:00:44.5871584Z COMPLETE**, high4·moderate20·critical0·total24다. 검사 대상은 아래 기록의 동일 package `01017394…` / lock `2e16cace…` pair다. COMPLETE는 실행·정리 완료이며 보안 PASS나 취약점0을 뜻하지 않는다. 원문 audit와 비밀값은 보관하지 않았다.
- 수정한 기존 정책19+runtime8의 [27TC / 42079903075](https://github.com/rlawksml/word-html-studio/actions/runs/42079903075)는 PASS다. 이 합성 정책 검증과 위 실제 registry audit는 별도 증거이며 합산하지 않는다.

### high4개 package family의 최소 패치 선정 및 적용

| 대상 family | 현재 설치 버전 | 선정 패치 |
|---|---|---|
| Vite | 8.2.2 | 8.2.4 |
| undici | 7.29.1 | 7.30.1 |
| zod | 4.4.3 | 4.6.6 |
| brace-expansion | 1.1.18 / nested 5.0.9 | 1.1.21 / 5.0.12 |

선정안은 Vite 직접 버전1개와 설치 버전에 한정한 exact override4개다. 새 pair의 실제 audit 결과는 위에 기록했다. 최종 앱·Worker 회귀와 컴파일 배포 파일 전달 검증은 별도다. high4는 package family/record 집계이며 관련 high advisory8건과 다른 단위다. moderate20도 독립된 고유 취약점20개를 뜻하지 않는다. 이 최소 패치 밖의 나머지 moderate는 해결했다고 표시하지 않는다.

### npm 집계 계약과 검사 정책 수정

공식 [npm11.19.1 Vuln 직렬화](https://github.com/npm/cli/blob/v11.19.1/workspaces/arborist/lib/vuln.js)는 metavuln의 via를 dependency 이름 문자열로 내보낸다. [audit-report의 advisory별 metavuln 계산](https://github.com/npm/cli/blob/v11.19.1/workspaces/arborist/lib/audit-report.js)과 [metavuln-calculator의 버전/spec별 판정](https://github.com/npm/cli/blob/v11.19.1/node_modules/@npmcli/metavuln-calculator/lib/advisory.js)을 보면, 그 문자열이 가리키는 다른 record의 전체 최고 severity가 부모 record 이하라는 보장은 없다. 이를 일률 비교했던 **우리 parser 정책의 가정 오류**를 수정했으며 provider가 잘못된 보고를 했다고 단정하지 않는다.

string via의 knownName·참조 존재·대상 severity enum은 유지하고, 직접 advisory 객체는 `부모 record severity >= advisory severity` 검사를 유지했다. 모든 필드·ID/URL·record별 카운터/metadata 일치·global high 판정·상한·실패 폐쇄도 유지했다. 수정 뒤 실제 audit가 구조 검사를 통과해 FINDINGS까지 도달했다. 과거 원문은 읽지 않았으므로 아래 실패 당시 개별 record를 재구성하거나 특정 string 사례였다고 추가 단정하지 않는다.

### 앱/Worker 격리 회귀

- **앱/Worker 격리 회귀 최종 PASS:** exact `ed6bf0db80e4cb8cf10fecee12c552c0bec0385c`의 [42076842796](https://github.com/rlawksml/word-html-studio/actions/runs/42076842796)은 type/lint/build0·앱277PASS·Worker36PASS/실패·취소·skip·todo0, 엄격 정리 뒤17:41:16.2922191Z COMPLETE다. sourceSHA=`dc8b62e8c64976a4dac02d4934565d8e942d02b1388208d89253f8e41a6bb356`, package/lock은 같은01017394/2e16cace다. 단독 upload1 수정 exact3d4f3e44100e99f70fb801aa19da295449c54b9b/[42076842047](https://github.com/rlawksml/word-html-studio/actions/runs/42076842047)도 엄격 정리 뒤17:41:03.6746406Z COMPLETE였다. 아래 zombie 실패는 이제 수정 전 이력이다.
- 종료 수정은 테스트2파일뿐이다. published Wrangler CLI를 직접 실행하고, CLI 내부 같은 esbuild0.28.2 모듈의 정확한 binary/argv 자식을 포착해 ref→stop→실제 close를5초 안에 기다린다. explicit exit와 자연 종료를1개 promise로 합치고 원 exit code를 보존하며 정리 실패는1이다. 기존 실제 dry-run·산출물 import 기대/36TC·상한/strict 검사를 유지했다. 테스트 파일51줄·새 helper102줄이며 제품 실행 코드는 바꾸지 않았다.

## 아직 실행하지 않은 승인 경계

사용자가 승인한 Staging 배포/SQL/새 QA 범위를 운영 권한으로 확대하지 않는다. 새 컴파일 배포 파일의 GitHub 최대 1일 전달, 쓰기 없는 시간의 운영 읽기 전용 Mac 백업, QA 뒤 기존 Staging 일시정지→새 빈 무료 복원 대상→기존 Staging 재가동은 각각 사용자 승인을 받았다. 아직 앱 artifact 전달·새 후보 원격 배포·새 QA 생성·운영 자료 조회/백업·프로젝트 pause/create/restore를 하지 않았다. 무료 활성 프로젝트2개 한도는 임의 삭제나 유료 전환으로 우회하지 않는다. Mac 보관용 운영 원문은 복원 프로젝트로 전송하지 않는다.

아래 나열은 이전 실행 이력이다. 현재 source/app 검증 완료와 실제 원격·데이터 검증 미완료를 구분한다.
- 최신 exact `1d5a07f7c130d5bd8c39b4bb5439bbe9fddef842`의 [42073321530](https://github.com/rlawksml/word-html-studio/actions/runs/42073321530)은 type/lint/build0·앱277PASS·Worker36PASS/실패·skip 등0이었다. static 경로와 config 정합화 뒤 실제 Worker TC가 통과했다. 다만 `POST_STAGE / UNEXPECTED_PROCESS_REMAINS`: live0/zombie1/parent1/esbuild1이 남아 엄격 정리·전체 COMPLETE는 실패다. 종료 소유권만 조사하며 실패 조건을 완화하지 않는다.
- 기존 profile의 두 진단 branch는 제품 코드를 바꾸지 않고 고정 Worker 파일만 분리했다. runtime9 exact5bcb9d512328358f140c883845cd2acb32bc0ed4/[42074865221](https://github.com/rlawksml/word-html-studio/actions/runs/42074865221)은 앱277·runtime9·엄격 정리 뒤17:29:20.9704276Z COMPLETE다. upload1 exact5547fc494ed0df5455d1fe8884c82c662388d260/[42074865318](https://github.com/rlawksml/word-html-studio/actions/runs/42074865318)은 앱277·upload1 기능 PASS 뒤 같은 zombie1로 FAIL이다. 실제 owner를 외부 Wrangler dry-run CLI로 좁혔으며 이 진단을 전체36의 최종 통과로 확대하지 않는다. primary의36목록·상한·실패 조건은 그대로다.
- Git 전송은 회복됐다. 공식 connector 권한을 넓히지 않고 정상 Git 경로로 후속 커밋을 보존/동기화했다.
- main exact `51193e16f04bb8960f0e845278b50dd6836c98f9`의 [42070054608](https://github.com/rlawksml/word-html-studio/actions/runs/42070054608)은 type/lint/build·unit **277PASS/나머지0**였다. 같은 실행의 기존 실제 Worker suite는 **36완료/32PASS/4FAIL**이었다(최상위28+하위8이며 parent 실패 포함). 전체 실행 GO/COMPLETE는 아니다.
- Worker 실패는 CF config3필드 비교1건과 구형 `dist/client/assets` 탐색 ENOENT2건·파생 parent1건이다. 공식 vinext1.2 기본 assetsDir는 `_next/static`, 현재 outer gate는 Worker-first이므로 새 static prefix에 맞는 제한된 인증 후 전달 경계가 필요하다. 실패 시점에는 새 prefix HTTP 성공/실패를 아직 실행하지 않았다. date/flags/no_bundle 중 실제 값은 원문 미조회이므로 특정하지 않는다.
- fallback exact `1f3fb0be1a7938c54692a42c9b5227e305cc948b`의 [실제 full30](https://github.com/rlawksml/word-html-studio/actions/runs/42070130353)과 [실제 JSON10](https://github.com/rlawksml/word-html-studio/actions/runs/42070135624)은 각각 PASS/실패·skip0·소유 정리였다. full은 type/lint/build도0·정리 뒤 COMPLETE다. [fallback 보고서](https://github.com/rlawksml/word-html-studio/blob/1f3fb0be1a7938c54692a42c9b5227e305cc948b/docs/test-reports/2026-11-06-compatible-fallback-runtime.md)의 당시 미완료 표기는 후속 기록으로 구분한다. 실제 배포물·DB·복원 증거는 아니다.
- Supabase 새 프로젝트 생성 화면에서 **활성 무료 프로젝트2개 한도로 생성 불가**를 확인했다. 유료 전환·기존 프로젝트 pause/delete는 하지 않았다. QA 뒤 Staging만 잠시 정지→별도 빈 복원 대상 검증→원래 Staging 재가동의 무료 방안과 운영 자료 읽기 백업은 사용자 승인 대기다. 배포 파일 전달 질문도 별도로 대기한다.

## 실패 원인과 최소 정합화

277 중8개는 Node에서 compiled Worker를 직접 import할 때의 `ERR_UNSUPPORTED_ESM_URL_SCHEME`와 연결됐다. 공식 vinext1.2는 Cloudflare tracing side-effect 모듈을 주입한다. 생성된 dist/server 부모의 정확한 `cloudflare:workers`만 tracing 미제공 모듈로 바꾸는 Node 테스트 fixture를 적용했다. 세션·SDK·fetch·권한·제품 코드는 mock하지 않았고 after에서 hook을 해제했다. 그 후7개가 통과하고 scheme 토큰이 사라졌다.

남은 SEO1건은 실제 assertion215줄의 canonical 절대 URL 문자열 비교였다. 공식 renderer의 URL 정규화 계약을 검토하고 canonical 정확1개·절대 URL·정규화된 scheme/host/path/query/fragment 전체 일치를 요구하도록 했다. 상대 URL이나 다른 주소를 허용하는 기대 완화가 아니며, home/help 기대 주소는 동일하다. manifest는 renderer가 직접 출력하므로 제품 설정을 명시적 절대 URL로 유지했다. 그 후 같은277이 모두 PASS였다. 실제 원래 tag 문자열을 출력하지 않았으므로 문자열 차이를 오직 한 종류라고 단정하지 않는다.

변경 후 `apps/web/tests/rendered-html.test.mjs`는516줄이다. 기존 대형 테스트의 고정 TC/본문을 이번 호환성 작업에서 대량 분리하지 않고 플랫폼/URL 책임을22줄·17줄 fixture로 분리했다. 변경된 제품 layout은62줄이며 UI/상태/접근성 코드는 바꾸지 않았다.

## 권한과 경계

사용자가 무료 Staging 후보 배포·#86 additive SQL1건·새 QA2책방/미사용 월/사진·두 세션 검증을 승인했다. 기존 업무/QA/사진은 보존하고 성공한 새 QA도 남긴다. main merge·운영 배포/SQL/DB/Storage·유료 전환은 승인되지 않았다.

중간 작업 하나 완료만으로 종료하지 않는다. 실제 로그인/권한/비용/데이터 위험의 선택이 필요한 작업만 대기하고 나머지는 병렬로 진행한다. 고정 작업 묶음은 보안 후보, Staging 배포/SQL, 실제 QA, 독립 백업/복원, 호환 fallback/최종 판정의5개다.

## #86 실제 Staging SQL 적용

- 정확한 대상: `bookstore-news-studio-staging` / `kriyjyyudngtibrtkylf`.
- 파일: `apps/web/supabase/migrations/202611040001_monthly_digest_order.sql`.
- source SHA256: `7df2e4514ee83539866cb43ddb3485f3c11d194b6d512e9ea98e30bc0442b7b2`.
- 적용 전 실제 읽기: workspace=`202609070002`, digest_order marker·table·함수2개 모두 NULL.
- 검토한 SQL 전체6892문자를 편집기에 입력하고 전체 복사 비교 후 실행했다. 결과 `Success. No rows returned`.
- 적용 후 실제 읽기: workspace 불변=`202609070002`, digest_order=`202611040001`, `monthly_digest_orders`, `valid_monthly_digest_ids(bigint[])`, `save_monthly_digest_order(text,bigint[],bigint,text)` 모두 존재.
- 권한 후속 조회: RLS=true, anon 테이블 접근=false, anon RPC 실행=false.
- UI 결과 표는 가로 가상화여서 권한 열은 오른쪽으로 이동 후 확인했다. 숨겨진 열을 누락/쿼리 실패로 판정하지 않는다.

SQL은 전용 새 테이블·함수·component marker만 추가한다. 기존 submissions/기간/사진/workspace marker의 수정·삭제는 포함하지 않으며 거래 전체 BEGIN/COMMIT과 precondition/lock_timeout을 유지했다. 운영 프로젝트에는 접속하거나 SQL을 실행하지 않았다.

**PASS는 설치·권한 확인 범위뿐이다.** 실제 RPC CAS/임대·통합본 순서 저장/새로고침/두 사용자 QA는 아직 실행 전이다. API version의 workspace marker만으로 #86 설치를 증명하지 않았다.

## #66 도구 체인 최소 후보 — 초기 준비·회귀 이력

- 공식 npm lock-only 준비 exact `9213f6a21818137afb99faca2c959fd12f7a67dd`.
- 기존 native 정책 [24TC](https://github.com/rlawksml/word-html-studio/actions/runs/42057777914): PASS·실패/skip0·소유 정리.
- 기존 승인 조건으로 무료 저장 여유를 확인한 뒤 [공개 JSON2개 전달](https://github.com/rlawksml/word-html-studio/actions/runs/42058430927)을 실행했다. ignore-scripts/no-audit, 키·DB·앱 source 미전송, 최대1일 보관이다.
- package `01017394e1c2e1604dfb82fca531fda6a4aa96d5cf3e8fee8b3ca25ab3c8f484` / 3930B.
- lock `2e16cace634e4091992673b4cd1dd9a04327a09d73be4774e1c399ac2794f34b` / 375163B.
- manifest는 vinext1.2.0, plugin-rsc0.5.37, Cloudflare plugin1.63.1, Wrangler4.149.0, workers-types5.20261006.1의5개만 변경했다. React/DOM/RSC19.2.9·Next16.4.5·Vite8.2.2는 유지한다.
- 독립 비교: 추가5/삭제33/변경78/불변624, 비대상 직접 lock record 불변, peer/engine/필수 경로와 Miniflare/Workerd 정렬 확인. sharp0.35.5로 호이스팅되어 중복이 줄었다.
- lock의 image-size 제거를 vinext 내부 bundle 수정으로 과장하지 않는다. 이 최초 준비 시점에는 새 pair 실제 audit가 미실행이었으며, 후속 실제 결과는 맨 위의 FINDINGS 기록을 따른다.

제품 exact `2884fb6a7797a60e9a43ec21affceb5f93ad49a3`의 [첫 전체 실행](https://github.com/rlawksml/word-html-studio/actions/runs/42059329343)은 type/lint/build PASS지만 unit OUTPUT_CAP·SIGKILL로 미완료였다. 65470B는 보관량이며 다음 chunk가64KiB를 넘자 종료했다. 이 로그만으로 assertion 실패나277완료를 판정하지 않는다.

표준 Node spec reporter로 출력만 바꾼 exact `a02cb39ab840d7ca60c3877171cdfda423982034`의 [재실행](https://github.com/rlawksml/word-html-studio/actions/runs/42060465106)은 type/lint/build PASS, unit36200B·제한 이내지만 exit1이었다. TC목록27파일/277개·제목·64KiB·실패 조건은 유지했다. **당시 실제 전체 회귀는 FAIL/조사 중**이었으며 이 실행을 성공으로 표시하지 않는다. 이후 원문 로그 대신 허용된 source 위치와 고정 counter만 확인했고, 후속 통과는 맨 위의 별도 exact 증거를 따른다.

## metadata audit 이전 schema 차단 이력

- dev 포함 metadata audit exactcc9797853e0c04ec0f46df4ca558bcaa791d0eb6/[42076053307](https://github.com/rlawksml/word-html-studio/actions/runs/42076053307)은 SEAL/FINAL/소유 정리 후 `BLOCKED/SCHEMA`, npm11.19.1이었다. 카운터null·공식ID빈배열이므로 취약점0이나 발견으로 해석하지 않는다. 동일 승인 전송 범위의 공개 pair만 검사했고 원문/키/DB/사진·artifact 전달은 없었다. 당시 기존 schema의 고정 단계만 좁혀 진단했다.
- 후속 고정 진단 exacta81195312c8482f61facbe4b71d479fe98fc90b6의 [기존 정책27](https://github.com/rlawksml/word-html-studio/actions/runs/42078648397)은 PASS/실패·skip0·소유 정리였다. [실제 audit](https://github.com/rlawksml/word-html-studio/actions/runs/42078649063)은 SEAL/FINAL/정리 뒤17:52:22.1272665Z `BLOCKED/SCHEMA_RECORD_AGGREGATE`였다. 당시에는 record/via 등급 관계 검사 위치만 확인됐고 provider와 정책 중 어느 쪽 문제인지 미확정이었다. 카운터null·ID빈배열을 유지해0/PASS로 바꾸지 않았으며, 추가 진단 enum을 늘리는 대신 위 공식 npm 계약을 읽어 정책 가정을 바로잡았다. 당시 BLOCKED 이력과 수정 뒤 실제 FINDINGS를 구분한다.

## 운영 기준 배포물 읽기 조회

Sites에서 운영 프로젝트 `bookstore-news-studio`가 active/public임을 조회했다. 최신 저장 v34는 source `28efad2e9331b5e2951bf1d9b00cb553530130f7`, saved version `appgprj_6a5dbe2598fc8191a1c25c37e759c6ae~appgver_5854d01efba8819191121f70dd2cefd7`이며 해당 publish deployment는 succeeded다.

원래 archive는65파일/7,813,120B, hash `sha256:fab4365334a52e7d1ee6a15f66f423a107b6d3f37d3291a10720f17c3a8198b4`, 환경 revision1이다. 이 조회는 현재 runtime을 다시 배포하거나 DB/환경값을 읽거나 변경하지 않았다. 저장 이력만으로 모든 플랫폼의 현 활성 버전을 단정하지 않으며, 운영 반영 직전 다시 활성 대상을 확정한다.

원래 v34는 미래 JSON4종을 잃는 old parser가 있어 **그대로 안전 fallback으로 선정하지 않는다**. 별도82f79b6의 순수 보존10TC PASS와 실제 배포 artifact는 다르다. old 사진 DELETE의 물리 삭제도 막아야 하며 그 범위만 보완 준비한다. 최신 기능 전체를 구버전에 backport하지 않는다.

## 초기 실행 차단 이력 (위 최신 결과와 구분)

- 실패 source 위치/고정 counter만 남기는 진단 local `01ef66a6845c727a9e3ff06f98127e73a8801ccd`를 보존했다. Git push가 같은 ref 두 번·새 codex ref 한 번 모두 `fatal error in commit_refs_rules`로 거부됐다. 실제 원격은 a02cb39 그대로이며 조회된 branch rules/rulesets는 비어 있었다.
- 공식 GitHub connector의 정상 create-tree 대안도 `403 Resource not accessible by integration`으로 거부됐다. 설정·권한을 바꾸거나 강제 ref/API 갱신으로 우회하지 않았으며 현재 진단 CI를 실행하지 못했다. 일반 GitHub 전체 장애로 단정하지 않는다.
- 새 배포 파일의 GitHub→Cloudflare Staging 전달은 기존 JSON2개 승인과 달라 별도 범위 확인 중이다. 아직 앱 artifact 업로드/배포하지 않았다.
- 실제 QA는 최신 후보 배포와 역할 로그인이 선행되어야 한다. 기존 QA를 재사용/수정하지 않는다.
- 실제 운영 자료 백업은 별도 읽기 승인·새 private 목적지·독립 보관·쓰기 없는 시간, 복원은 별도 새 빈 대상이 필요하다. 기존 Staging/운영 DB에 복원하지 않는다.
- 전체 운영 판정은 NO-GO다. 진행 상태·승인과 실제 실행 증거를 구분한다.
