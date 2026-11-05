# 호환 fallback 앱 검증 — 운영 준비 미완료

## 후속 실제 PASS — 아래 초기 이력보다 우선

Exact `1f3fb0be1a7938c54692a42c9b5227e305cc948b`에서 [full30](https://github.com/rlawksml/word-html-studio/actions/runs/42070130353/job/127395552718)은 typecheck/lint/build/unit 모두 exit0·제한 초과 없음·30PASS/실패·취소·skip·todo0였다. 엄격 소유 정리 후17:00:30.3255768Z COMPLETE, sourceSHA51345f8cb5e20371ec04b4ae4dc937e1b90b048156e4b761a1e6b54b256dc86f를 확인했다. package/lock은 아래 승인 pair와 일치한다.

같은 exact의 [native JSON10](https://github.com/rlawksml/word-html-studio/actions/runs/42070135624/job/127395552239)은10PASS/실패·skip0·**16:59:57.7522793Z** OWNED_CLEANUP_CONFIRMED였다. 주 담당과 독립 검증 담당이 실제 fixed marker를 대조했다. 두 suite는 합산하지 않는다.

이전 type15·후속 D1 type2·Node Cloudflare tracing·SEO 직렬화 실패를 최소 보완했다. Client 반환 타입/경로 type predicate/선택 D1 타입 선언은 런타임 분기를 바꾸지 않았으며 DB를 설치하지 않는다. Node fixture는 정확한 선택 tracing 미제공 분기만 모사하고 실제 Cloudflare 검증을 대체하지 않는다. canonical은 절대 URL의 의미 일치·정확1개를 요구하고 manifest만 명시적 절대 주소로 설정했다. 기존 기대 주소/TC수는 유지했다.

판정: **격리 fallback 앱/순수 데이터 보존 GO / 운영 전체 NO-GO**. 실제 DB/사진/독립 복원·불변 배포물·환경 보존은 아직 미완료다.

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

280c291의 [실제 native10](https://github.com/rlawksml/word-html-studio/actions/runs/42063266741)은10PASS/실패·skip0·소유 정리였다. [실제 full 실행](https://github.com/rlawksml/word-html-studio/actions/runs/42063260362)은 typecheck exit2/15진단으로 중단됐으며 lint/build/30TC는 실행하지 않았다. 이후 기존 후보와 같은 header 반환 타입·경로 type predicate·설치된 Cloudflare 타입 연결만 보완했다. 런타임 본문/분기·경로 검증·client 동작은 유지하며 이 후속의 재검증은 별도다.

앞서 GitHub 동기화가 commit_refs_rules 내부 오류, 공식 connector는 create-tree403으로 차단됐다. 이후 정상 Git 전송이 회복되어280c291을 push하고 위 실제 CI를 실행했다. 세 타입 선언 보완 후 기존25+사진5의 전체30과 기존 source10을 같은 exact 후보로 재실행한다. 실행하지 않은 결과는 PASS가 아니다.

old 월 입력(#91)·로컬 통합 순서(#86)·HTML white-space 의존(#82)은 알려진 old UI 동작으로 남는다. 최신 기능 전체를 backport하지 않았다. 아직 불변 배포물/실제 롤백 가능성의 증거는 아니며, 실제 기간/사진/API/최신 데이터/환경 보존 확인이 필요하다. 긴급 앱 롤백에 과거 DB 덮어쓰기·down migration·Storage 삭제를 포함하지 않는다.
