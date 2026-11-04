# 롤백 준비 전용 검사기 검증 기록

## 대상과 결론

- 소스 commit: `2b19ceea6880c2f7a77c3c79d5db07cc2542fa23`, PR #89 (Draft)
- 범위: `prepare-rollback.mjs`, `rollback-readiness-policy.mjs`, 단위 TC, manifest 템플릿/Runbook
- **Production/실제 롤백 NO-GO.** 준비 도구의 선언 검사는 실제 증거 확인·배포 허가·플랫폼 자동 차단을 대신하지 않는다.
- 운영/staging DB·사진·환경·배포 변경 없음. 이전 미커밋 gate/cleanup/HTML-copy 변경과 보관 QA 자료를 유지했다.

## TC와 결과

| TC | 사전조건/실행 | 기대 | 결과 |
|---|---|---|---|
| ROLLBACK-PREP-01 | 합성 v2 완전 선언을 순수 정책 함수에 전달 | declared-only, 실행/승인false | PASS — 초기14개 포함 |
| ROLLBACK-PREP-02 | 누락·옛 v1·잘못된 대상·DB복원/실행 옵션 선언 | blocker/violation, 실행 불가 | PASS — 초기14개 포함 |
| ROLLBACK-PREP-03 | 다른 baseline/candidate/artifact/schema/오래된 증거 | 정확한 식별자 결합·기한 위반 차단 | PASS — 초기14개 포함 |
| ROLLBACK-PREP-04 | 메모리 file adapter로 symlink·oversize·short read·JSON오류 | 읽기 한도·close·입력 비노출 | PASS — 초기14개 포함 |
| ROLLBACK-PREP-05 | 보강한 main DI에 완전 선언·잘못된경로·secret/예외 전달 | 0/1 반환·고정 출력·승인false | BLOCKED — 후속3개 미실행 |
| ROLLBACK-PREP-06 | 최종17개 전체·lint/typecheck/build 재실행 | 동일 후보 검증 | BLOCKED — 미실행 |
| ROLLBACK-PREP-07 | 독립 source review, 초기/후속 main 경계 | 실행·SDK·비밀 출력 경로 없음 | PASS — source-only 승인, 동적 검증 대체 아님 |
| ROLLBACK-REAL-01 | 정확한 운영 fallback으로 후보 JSON/기간/사진 왕복 | 미래 필드·사진 참조·기간 보존 | BLOCKED — 미실행 |
| ROLLBACK-REAL-02 | 최신 독립 백업·artifact hash·현재 환경 보존 증거 | 실제 운영 전 조건 확보 | BLOCKED — 미확인 |

초기 실행은14/14 PASS이며 이후 main DI/3TC를 추가했다. **최종17/17 PASS가 아니다.** 표의 PASS 행은14개 테스트를 묶은 증거이며 행 수를 실제 테스트 수에 더하지 않는다. 전체 릴리스 P0도 이 표만으로 PASS 처리하지 않는다.

## 실행한 초기14개 명령/제약

```sh
node --max-old-space-size=256 --test --test-isolation=none tests/rollback-readiness.test.mjs
```

Node26.11.1. 비밀 파일/배포 산출물/node_modules를 제외한 임시 사본에서 실행했다. 환경은 PATH/TZ만 허용하고 네트워크/fork·일반 파일 쓰기·사용자 자료 읽기를 macOS sandbox로 제한했다. CPU30초·파일8MiB·FD128·wall45초 한도를 설정했다. 콘솔14 PASS/0FAIL을 주 에이전트가 확인했다.

이는 보안 검토 스킬의 모든 실행 격리 요건이 충족됐다는 증거가 아니다. Node heap 제한과 native/RSS 한도는 다르다. 후속 준비 점검에서 macOS `ulimit -v`는 `setrlimit failed: invalid argument`로 실패했고 컨테이너 도구도 확인되지 않아, 추가 대상 실행을 강행하지 않았다. 엄격한 추가 검증은 네트워크 없음·비밀값 없는 소스/읽기전용 도구·scratch전용 쓰기·CPU/메모리/PID/디스크/wall 한도가 적용된 별도 runner에서 수행해야 한다. 취약점 재현·새 의존성 설치·운영 실패 주입은 하지 않았다.

## Source review/변경 확인

독립 release reviewer는 현재 baseline=fallback, candidate schema 분리, 고정 출력, bounded file read, prepare-only/승인false 경계를 확인했다. P2 main 출력/종료값 회귀 공백을 지적해3TC를 추가했고, 후속 리뷰는 source-only 승인/동적 미검증을 분리했다.

파일 줄 수는 policy195, CLI69, tests334로 모두500이하다. staged diff 공백 검사와 알려진 secret value 패턴 검사는 통과했다. 패턴 검사 자체를 모든 비밀값 부재의 수학적 증명으로 표현하지 않는다. 최종 source parsing/lint 전체 실행은 별도로 남긴다.

## 실제 운영 기준선의 미확인 위험

Sites34/source28efad2의 succeeded 배포·archive 존재를 읽기 전용으로 확인했다. source의 package version은0.1.0이며 sanitizeNews/hydrateImage가 알려진 필드로 재구성하므로 미래 JSON 필드 보존은 미확인이다. candidate branch의 호환 테스트로 그 exact fallback artifact를 검증했다고 주장하지 않는다. DB down migration/과거 데이터 복원/Storage 정리 없이 최신 데이터 보존을 검증해야 한다.

## 후속

추가 준비: Mac 제약을 우회 실행하는 대신, 고정 `FROM scratch`/검토된 hash Dockerfile과 표준 GitHub Linux 전용 workflow를 작성했다. host의 기존 Node/env·라이브러리와 정확한3source만 복사하고 외부 image/의존성을 받지 않는다. 비root·read-only·network none·memory256MiB/no swap·CPU1/30초·PID32·file8MiB/FD128·tmpfs16MiB·wall45초·출력64KiB·daemon log none을 적용한다. nonce/name/label/CID 검증으로 자기 컨테이너만 정리하며17TC/fail0/cancelled0/skipped0/todo0을 요구한다. Docker 지원/도구가 없으면 실패한다. 독립 source review는 차단 결함 없음/source-only GO를 반환했으며 실행 결과는 아직 미검증이다.

저장소는 읽기 조회로 PUBLIC을 확인했으며 표준 public runner의 [공식 무료 사용 기준](https://docs.github.com/en/actions/concepts/billing-and-usage)을 확인했다. larger runner·유료 플랫폼 전환·artifact 업로드는 사용하지 않는다. 요금/결제 설정과 운영 서비스는 변경하지 않는다.

09:45 UTC 이후 브랜치 REST SHA는1b5ee6a인데 PR head는2be5af3/check suite0으로 남아 새 이벤트 실행이 확인되지 않았다. PR merge/reopen/base 변경으로 우회하지 않았다. 기존 CI catalog의 공식 `--ref` 실행을 사용하도록 feature의 CI에 rollback_preparation 고정 choice/expected_commit guard와 동일 commit callee를 연결했다. manual에서는 기존 npm/build verify를 제외하고 legacy Supabase job은 입력과 무관하게 고정false로 차단한다. PR/push의 audit 포함 verify는 유지한다. 이 경로도 독립 source-only 검토 후에만 적용했으며 성공해도17TC 범위의 결과다. 실행 시 실제 event/ref/head/job 목록을 대조해야 한다.

첫 수동 실행 [41810693908](https://github.com/rlawksml/word-html-studio/actions/runs/41810693908)은 event=workflow_dispatch/head1e22583, exact SHA guard PASS·verify/Supabase job SKIPPED를 확인했다. 격리 job은 **대상 테스트 실행 전** SANDBOX_LIMIT_SUPPORT_UNCONFIRMED로 실패했다. source의 Go template 필드가 잘못된 CpuCfsQuota였음을 [Moby 공식 타입](https://github.com/moby/moby/blob/master/api/types/system/info.go)의 CPUCfsQuota와 대조해 정정했다. 실패를 숨기거나 cgroup 조건을 제거하지 않았으며 실패 진단도64KiB/명령해석 차단 범위에서만 출력하도록 보완했다. 이 실행을17TC FAIL/PASS로 집계하지 않는다.

1. 최종17TC와 필수 코드 검증을 안전한 격리 runner에서 실행한다.
2. 정확한 fallback의 미래 데이터 호환성/환경 보존과 독립 최신 백업을 확인한다.
3. 통합본 #86, CI 의존성 #87, 사진 조사 #88 및 남은 전체 P0를 이슈별 검증한다.
4. 모든 증거가 확보된 뒤 운영 반영 승인을 요청한다. 현재 merge/배포하지 않는다.
