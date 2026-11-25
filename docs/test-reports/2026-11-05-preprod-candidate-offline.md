# v1.1 후보 — 오프라인 앱 247TC 검증

## 결과

**검증한 오프라인 범위 GO / 운영 반영 NO-GO.** 운영·Staging 배포나 실제 DB 검증 결과가 아니다.

- 제품 `1.1.0-rc.1`, branch `codex/m1-preprod-candidate`.
- exact SHA: `fb75c6264a597082e29cecbd23fb63144d78d5ac`.
- [최종 run41987069058](https://github.com/rlawksml/word-html-studio/actions/runs/41987069058), job `127110245660`.
- 주 에이전트가 원격 metadata와 실제 고정 요약/완료 marker를 확인했다. 독립 검토자의 같은 증거 대조는 최종 검토란에 기록한다.

| 실행 경계 | 실제 결과 |
|---|---|
| 무료 공개 Linux·수동 feature·exact SHA guard | success |
| 무스크립트 의존성 준비 | exit0, signal/제한/error 없음, 관측 warning2 |
| 외부망 분리·RO 소비자 인계·prep 부재·OS preflight | 필수 검사 통과 후 앱 실행 |
| typecheck | exit0, stdout/stderr0 |
| lint | exit0, stdout/stderr0, 관측 warning0 |
| build | exit0, stdout1590/stderr722bytes, 관측 warning2 |
| 기본 단위26파일 | **등록247 / PASS247 / 실패0 / 취소0 / skip0 / todo0**, stdout57986/stderr0bytes |
| 자식 종료·최종 OS/컨테이너 점검·실행 소유 자원 정리 | 엄격 조건을 유지한 채 통과, 정리 후 COMPLETE |

07:25:51.685Z 실제 TAP 카운터 뒤 07:25:52.211Z `OFFLINE_APP_COMPLETE`를 확인했다. 이 marker는 4개 stage·TAP·최종 검사와 정확한 실행 소유 컨테이너/볼륨 정리 성공 뒤에만 출력한다. 원시 앱/npm/TAP 본문·환경값·프로젝트 식별자·세션·PID는 공개하지 않았다. 관측 warning은 분류된 안전성 증거가 아니며 별도 확인이 남는다.

자원 검증은 Node heap만의 제한이 아니라 실제 cgroup/mount/rlimit 확인이다. CPU2코어 quota와 **프로세스별** CPU rlimit180초·단계 wall120초를 구분하며, 전체 앱의 누적 CPU가180초 이하였거나 실제 peak memory를 측정했다는 뜻은 아니다.

## 고정 지문

| 대상 | SHA-256 |
|---|---|
| COMPLETE source | `fb02e099edd8855db3934d6c7bc5a2094ed0e9d5b92fc16e265183b294d728bc` |
| package | `cdc5fde96aa6665a7642b256a2b4329e2a9dee147bbd12981df3c35e38199fa9` |
| lock | `18ff641e6f54f79d3c6158ba8717309e7e0e237eb65d7fdff6012b39d1433f34` |
| 후보 검증 baseline | `a4fb77a0a88315a2813fe72b20958c86e14ea1fb079815232b567a54a4079efc` |

## 검증 중 발견·보완한 내용

- 설치 스크립트·운영 키·DB 연결 없는 prep와 실제 앱의 network-none 실행을 분리했다. prep bridge는 등록소 전용 방화벽이 아니다.
- 기존 lock의 정확한 bundled 하위6개, runner env 바이너리 크기, Docker 기본 PATH, npm 설정 중복 경로, Git/DFS 소스 해시 순서, 필수 공개 Git metadata 제외, 기존 OS `librt` 미포함을 좁은 검증 경계로 보완했다. 실제 버그 관측과 source finding은 [기준선/실패 이력](2026-11-05-offline-app-baseline.md)에 구분한다.
- unit 종료 후 **살아 있는 프로세스0 / esbuild 좀비1개**를 관측했다. 운영 메모리누수로 일반화하지 않았다. 좀비를 무시하거나 강제 PID 종료로 통과시키지 않고 테스트가 만든 정확한 ChildProcess handle만 ref→SDK stop→실제 close 대기로 회수했다.
- 기존 HTML01~05 검증을 유지하고 자식 종료 자동 TC **HTML-LINES-07 한 개**를 추가했다. 기존 수동 외부편집기 TC HTML-LINES-06은 그대로 남긴다. 초기에 자동 case도06으로 명명됐던 이력은 현재 수동06 PASS가 아니며, 최종 exactfb75에서는07로 재검증했다.
- #91의 유효 발행 월 보존·invalid calendar 방어도 후보에 포함했다. 실제 DOM의 부분 월 입력/IME 검증은 아직 별도다.

실제 SDK stop의 throw/장기 지연·close timeout 고장 주입은 이 정상 종료 실행과 별도 미검증이다. 해당 실패 경계는 source 리뷰만 수행했으며 실제 close 및 최종 잔여 프로세스 부재가 확인된 범위만 PASS로 기록한다.

## 이전 결과와 합산 금지

- [후보 native99](2026-11-05-candidate99-native-regression.md)는 exact24279e7에서 별도5회 병렬 실행한 source-policy 결과다.
- 기준선 exact9485c79/run41985670521의232와 이전 후보 exactfbeec726/run41985974193의247도 별도 증거다. 최종247·기준232·native99는 중복되므로 더하지 않는다.
- Stage2 SDK adapter12는 이번247의 mock 검증에 포함되지만 실Supabase/Storage 검증이 아니다. Playwright·실제 clipboard·외부 편집기·원격 로그인/편집 임대·대용량/HEIC·불안정망·10명 동시 사용·heap/DOM/listener 검증은 포함되지 않는다.
- 일반 PR/main verify와 Supabase integration·다른 source/rollback job은 이 run에서 SKIPPED다. 원래 audit gate를 삭제·완화한 것이 아니며 #87을 해결한 결과도 아니다.

## 남은 릴리스 게이트

1. #87 Next 보안 업데이트 후보/새 lock·audit·동일 격리 회귀. #66 vinext/React 전환은 별도 변경으로 검증한다.
2. 준비된 브라우저 도구 환경에서 UI/IME·로그인·사진·통합본·Network/자원 전체 P0. npm/build 각 관측 warning2도 분류한다.
3. 별도 승인 후에만 #86 추가형 SQL·새 QA 자료·Staging 후보 배포 및 실제 CAS/편집 임대/사진 검증. 기존 성공 QA와 업무 자료는 보존한다.
4. #47 새 빈 복구 대상의 실제 복원·최신 독립 DB/Storage 백업. 운영·보관 Staging을 초기화하지 않는다.
5. #46/#48 exact fallback 앱의 최신 JSON/기간/사진 호환·환경 보존 증거. 앱 롤백은 최신 DB/사진을 과거 백업으로 덮지 않는다. 준비 검사기를 실제 긴급 복귀 성공으로 표현하지 않는다.
6. 사용자 운영 승인 전 main merge·운영 배포·운영 SQL/DB/Storage 변경·유료 전환 금지.

이 테스트에서 기존 업무·QA 행/사진을 수정·삭제·reset·seed하지 않았다. 성공한 fixture 자료는 컨테이너 메모리/제한 scratch뿐이며 실제 DB·Storage를 제공하지 않았다.

## 최종 검토

- 주 에이전트: exact SHA·실제 stage·247 카운터·정리 뒤 COMPLETE 확인 완료.
- 독립 안전/문서 검토자: 최종 exactfb75/run41987069058의 metadata·실제4stage/247/정리 뒤 COMPLETE와 immutable 소스 조건 대조 완료. 이전 exactfbee247/기준232/native99와 분리해 확인했다.
- 이 보고서 이후 문서-only commit은 검증 코드 commit을 대체하지 않는다. 이슈는 열어 두고 운영 NO-GO를 유지한다.

## 다음 #87의 최소 진행 순서 — 아직 구현/실행 전

1. 2026-11-05 검토 후보는 Next와 eslint-config-next `16.4.5`다. `16.3.4→16.4.5`는 semver **minor**이며 단순 patch라고 부르지 않는다. 작업 직전 공식 권고/버전을 다시 확인한다. [공식 manifest](https://raw.githubusercontent.com/vercel/next.js/v16.4.5/packages/next/package.json)
2. 새 격리 prep에서 원본 manifest의 해당 두 필드만 바꾸고 무스크립트 lock-only resolution을 수행한다. 다른 직접 의존성·React/vinext·앱 소스를 함께 바꾸지 않는다. `--force`, peer 우회, audit fix, 설치스크립트 재활성화, 수동 integrity 편집은 하지 않는다.
3. 생성한 두 JSON만 크기·regular/no-follow·정확 구조·공식 registry URL/SRI·root diff·transitive graph를 검증하고 안전하게 회수해 부모가 review/pin한다. 현재 기존 lock만 허용하는 baseline 검사를 일반적으로 완화하지 않는다. 공개 manifest 인계 방식도 별도 source 검토 전에는 실행하지 않는다.
4. 후보 lock의 production audit를 별도 metadata 작업으로 실행해 high/critical·실제 경로·정상 통신 여부를 확인한다. Next 쪽 sharp/source-map-js 수정 반영과 개발 Miniflare의 exact sharp 경로를 구분한다. graph에서 사라짐과 결함 수정도 구분한다. 기존 audit gate를 삭제하거나 성공으로 치환하지 않는다.
5. 검토·고정한 새 package/lock으로 깨끗하게 무스크립트 설치→오프라인 type/lint/build/기본247·엄격 종료→준비된 브라우저 회귀를 수행한다. 부족한 도구·native 출력은 새로운 준비 범위를 검토하기 전까지 BLOCKED다. #66 vinext/React major 전환을 이번 최소 변경에 섞지 않는다.

이는 후속 설계안이며 버전 변경·새 lock·audit·보안 취약점 해결 완료가 아니다. 실제 DB/Storage·환경/배포·유료 플랜은 이 순서에서도 별도 승인 범위다.
