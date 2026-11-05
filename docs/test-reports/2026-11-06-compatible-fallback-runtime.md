# 호환 fallback 실행 후보 — 소스 검토 완료, 실행 미완료

## 범위

- 기준: old source28efad2 + JSON 보존 helper/route82f79b6. 운영/기존 자료 불변, 별도 기능 브랜치다.
- 이전82f79b6의 실제 source10TC PASS는 별도 [run42055883249](https://github.com/rlawksml/word-html-studio/actions/runs/42055883249) 증거다. 이번 변경의 실행 PASS가 아니다.
- 이번 source 검토: **실행 진입 GO**. 실제30TC/보존10TC/type/lint/build: **BLOCKED — 아직 미실행**. 운영 전체 NO-GO.

## 최소 보완

1. old version0.1.0·scripts·engines를 유지하고 dependencies/devDependencies만 검토된 a02cb39 도구 체인과 동일하게 이식했다. vinext1.2.0, CFplugin1.63.1, React/DOM/RSC19.2.9 등이다. lock는 승인된 새 graph에서 root version2곳만0.1.0으로 맞췄다.
2. old images DELETE의 세션/목록/경로 검증은 유지하고 Storage.remove만 제거했다. HTTP200 retained=true/deleted=false/IMAGE_CLEANUP_DEFERRED는 기존 client의 response.ok 계약과 호환된다. 사진 존재·업로드 성공을 보증하지 않는다. POST/GET은 바꾸지 않았다.
3. 오래된 July 렌더 fixture 한 개는 기존 기대값을 유지하면서 Date만 July로 고정했다. 제품 시간이나 기대 정규식을 완화하지 않았다.
4. 이미 검토한 Linux offline 프로필을 재사용했다. old npm test2파일25개는 유지하고, actual route/old client의 사진 보존5개를 별도 파일로 더해 고정3파일30개를 실행하도록 했다. JSON 보존10개는 기존 native source 프로필에서 별도 실행한다. SDK·키·DB·실제 사진을 사용하지 않는다.

새 사진5TC는 정상200/입력 불변, 미인증·HTML403와 body 미열람, 원래500개 상한/잘못된 목록400, 원래 경로 검증400, 실제 old client의 response.ok 처리다. 실제 route는 next/server·session·cloud 접근만 고정 native stub으로 바꾸고 cloud 함수 호출 시 실패한다. client는 실제 old 함수를 사용하며 소유 fetch/window mock은 finally 복구한다. route/CAS/source 계약과 실제 SDK/DB는 구분한다.

## 독립·주 담당 대조

- validator/records/submissions(CAS+trusted JSON merge)/old client/helper는82f79b6과 불변이다.
- 새 package/lock graph와 scripts/version/engines 보존은 두 담당이 독립 비교했다.
- reusable closure8개는 a02cb39와 동일하다. baseline은 PACKAGE_TESTS2/TESTS3/기대30·고정pair만, host-source는 공개 old hosting hash와 PACKAGE_TESTS 비교만 바꿨다. 자원/네트워크/로그/정리 제한과 실패 조건은 유지한다.
- workflow의 변경2pin은 실제 hash 대조와 독립 source GO 뒤 고정했다. 고정 codex/m1-fallback-runtime/exactSHA·두 mode만 허용하고 manual 앱verify/실DB suite는 실행하지 않는다.

| 파일 | SHA256 |
|---|---|
| package | aa2a7349fc01bbe07de451f0ed95d9bcf649307c1573a73f7a237eb8a9099fa1 |
| lock | 37040aeb02f94e7cbb23672a18b1b7d87d6e37d935b9ed44b0d0fa7069cfc90c |
| baseline | d11063523c11eebfdff3745ef77ae3df70ceb6e94f043736896de1c4b6e8c9c8 |
| host-source | 223b835765501da761e5be646131305cad24830b86361922bfa4db53da2ed790 |
| actual photos route | 7f7223ed64ea6bae46fb756f6800271478429fbf83d13f02f2848fe467c64a55 |
| photo5TC | c626167ddd49f07ff8d60d4fb77b538eb280d7dd332178abf28decc18fcfc296 |

## 실행과 알려진 제약

root의 GitHub 동기화가 commit_refs_rules 내부 오류, 공식 connector도 create-tree403으로 차단됐다. CI 실행이 가능해지면 기존25+사진5의 전체30과 기존 source10을 같은 exact 후보에서 실행한다. 타입/빌드 실패가 있으면 실제 진단으로 최소 수정한다. 실행하지 않은 결과는 PASS가 아니다.

old 월 입력(#91)·로컬 통합 순서(#86)·HTML white-space 의존(#82)은 알려진 old UI 동작으로 남는다. 최신 기능 전체를 backport하지 않았다. 아직 불변 배포물/실제 롤백 가능성의 증거는 아니며, 실제 기간/사진/API/최신 데이터/환경 보존 확인이 필요하다. 긴급 앱 롤백에 과거 DB 덮어쓰기·down migration·Storage 삭제를 포함하지 않는다.
