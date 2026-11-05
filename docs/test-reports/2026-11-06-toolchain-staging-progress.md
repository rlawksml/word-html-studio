# 운영 반영 전 통합 진행표

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

## #66 도구 체인 최소 후보

- 공식 npm lock-only 준비 exact `9213f6a21818137afb99faca2c959fd12f7a67dd`.
- 기존 native 정책 [24TC](https://github.com/rlawksml/word-html-studio/actions/runs/42057777914): PASS·실패/skip0·소유 정리.
- 기존 승인 조건으로 무료 저장 여유를 확인한 뒤 [공개 JSON2개 전달](https://github.com/rlawksml/word-html-studio/actions/runs/42058430927)을 실행했다. ignore-scripts/no-audit, 키·DB·앱 source 미전송, 최대1일 보관이다.
- package `01017394e1c2e1604dfb82fca531fda6a4aa96d5cf3e8fee8b3ca25ab3c8f484` / 3930B.
- lock `2e16cace634e4091992673b4cd1dd9a04327a09d73be4774e1c399ac2794f34b` / 375163B.
- manifest는 vinext1.2.0, plugin-rsc0.5.37, Cloudflare plugin1.63.1, Wrangler4.149.0, workers-types5.20261006.1의5개만 변경했다. React/DOM/RSC19.2.9·Next16.4.5·Vite8.2.2는 유지한다.
- 독립 비교: 추가5/삭제33/변경78/불변624, 비대상 직접 lock record 불변, peer/engine/필수 경로와 Miniflare/Workerd 정렬 확인. sharp0.35.5로 호이스팅되어 중복이 줄었다.
- lock의 image-size 제거를 vinext 내부 bundle 수정으로 과장하지 않는다. 새 pair 실제 audit는 미실행이다.

제품 exact `2884fb6a7797a60e9a43ec21affceb5f93ad49a3`의 [첫 전체 실행](https://github.com/rlawksml/word-html-studio/actions/runs/42059329343)은 type/lint/build PASS지만 unit OUTPUT_CAP·SIGKILL로 미완료였다. 65470B는 보관량이며 다음 chunk가64KiB를 넘자 종료했다. 이 로그만으로 assertion 실패나277완료를 판정하지 않는다.

표준 Node spec reporter로 출력만 바꾼 exact `a02cb39ab840d7ca60c3877171cdfda423982034`의 [재실행](https://github.com/rlawksml/word-html-studio/actions/runs/42060465106)은 type/lint/build PASS, unit36200B·제한 이내지만 exit1이었다. TC목록27파일/277개·제목·64KiB·실패 조건은 유지했다. **실제 전체 회귀는 아직 FAIL/조사 중**이며 성공으로 표시하지 않는다. 후속은 원문 로그 대신 허용된 source 위치와 고정 counter만 확인한다.

## 운영 기준 배포물 읽기 조회

Sites에서 운영 프로젝트 `bookstore-news-studio`가 active/public임을 조회했다. 최신 저장 v34는 source `28efad2e9331b5e2951bf1d9b00cb553530130f7`, saved version `appgprj_6a5dbe2598fc8191a1c25c37e759c6ae~appgver_5854d01efba8819191121f70dd2cefd7`이며 해당 publish deployment는 succeeded다.

원래 archive는65파일/7,813,120B, hash `sha256:fab4365334a52e7d1ee6a15f66f423a107b6d3f37d3291a10720f17c3a8198b4`, 환경 revision1이다. 이 조회는 현재 runtime을 다시 배포하거나 DB/환경값을 읽거나 변경하지 않았다. 저장 이력만으로 모든 플랫폼의 현 활성 버전을 단정하지 않으며, 운영 반영 직전 다시 활성 대상을 확정한다.

원래 v34는 미래 JSON4종을 잃는 old parser가 있어 **그대로 안전 fallback으로 선정하지 않는다**. 별도82f79b6의 순수 보존10TC PASS와 실제 배포 artifact는 다르다. old 사진 DELETE의 물리 삭제도 막아야 하며 그 범위만 보완 준비한다. 최신 기능 전체를 구버전에 backport하지 않는다.

## 현재 실행 대기/미완료

- 새 배포 파일의 GitHub→Cloudflare Staging 전달은 기존 JSON2개 승인과 달라 별도 범위 확인 중이다. 아직 앱 artifact 업로드/배포하지 않았다.
- 실제 QA는 최신 후보 배포와 역할 로그인이 선행되어야 한다. 기존 QA를 재사용/수정하지 않는다.
- 실제 운영 자료 백업은 별도 읽기 승인·새 private 목적지·독립 보관·쓰기 없는 시간, 복원은 별도 새 빈 대상이 필요하다. 기존 Staging/운영 DB에 복원하지 않는다.
- 전체 운영 판정은 NO-GO다. 진행 상태·승인과 실제 실행 증거를 구분한다.
