# 운영 반영 전 앱 롤백 준비

## 현재 판정

2026-11-04: **Production NO-GO**. 이 문서와 도구는 준비 전용이며 배포·롤백·DB 복원을 실행하지 않는다. 사용자는 운영 반영 직전까지의 작업만 승인했다. 운영 merge, 배포, 스키마 적용은 별도 승인 대상이다.

TC별 실제 검증/차단 결과는 [롤백 준비 검증 기록](test-reports/2026-11-04-rollback-preparation.md)을 따른다. 초기14개 통과와 후속 main3개 포함 최종17개 미검증을 구분한다.

앱 롤백은 **최신 DB와 사진을 그대로 두고 검증한 앱 배포물만 되돌리는 작업**이다. 과거 백업으로 운영 DB/Storage를 덮어쓰는 명령은 롤백 절차에 포함하지 않는다. 파괴적 SQL, 원본 사진 자동 정리, 유료 서비스 전환도 하지 않는다.

## 1. 되돌릴 대상을 이름이 아닌 실제 배포물로 고정

읽기 전용 Sites 메타데이터에서 확인한 기준선:

| 항목 | 관찰값 |
|---|---|
| 운영 주소 | `https://bookstore-news-studio.rlawksml.chatgpt.site` |
| 운영 프로젝트 | `appgprj_6a5dbe2598fc8191a1c25c37e759c6ae` |
| 저장 버전 | `34` |
| immutable version ID | `appgprj_6a5dbe2598fc8191a1c25c37e759c6ae~appgver_5854d01efba8819191121f70dd2cefd7` |
| 소스 commit | `28efad2e9331b5e2951bf1d9b00cb553530130f7` |
| 배포 ID | `appgdep_6a69d035f9208191be0449f379791a1e` |
| 관찰 상태 | 해당 배포 `succeeded`, 소스 archive 존재 |

이는 현재 시점의 조회 기록이지 향후에도 활성 버전이 같다는 보장이 아니다. 운영 직전에 다시 조회한다. 저장 버전34, 제품의 v1.0/v1.1 명칭, Git tag, `package.json` 버전은 서로 다르다. 위 소스의 package 버전은 `0.1.0`이므로 이름만 보고 `v1.0.1` 안전장치가 반영됐다고 판단하지 않는다.

운영 플랫폼은 Sites이며 독립 검증 플랫폼은 Cloudflare Worker다. Cloudflare staging의 이전 배포 ID를 운영 fallback으로 사용하지 않는다. 기존 운영 플랫폼을 옮기는 작업도 이번 준비에 포함하지 않는다.

## 2. 실제 롤백 전에 필요한 증거

- [ ] 운영 활성 배포 ID·소스 commit·불변 배포물과 SHA-256을 재확인한다.
- [ ] 독립 보관한 최신 DB·원본/미리보기 백업을 해시·사진 참조까지 검증한다.
- [ ] 백업은 순차 SELECT/다운로드이므로 동시 쓰기 중 원자적 snapshot이라고 부르지 않는다. 일관성 확인 또는 승인된 짧은 쓰기 중지 방식을 확정한다.
- [ ] 구버전 **정확한 배포물/소스**로 후보 버전 데이터의 미래 JSON 필드·기간 일정·사진 참조 보존을 격리 환경에서 검증한다.
- [ ] 배포물 전환 시 현재 서버 환경변수·DB 연결·비밀값을 보존하는 공식 절차를 확인한다. 비밀값은 manifest/보고서/Git에 기록하지 않는다.
- [ ] 같은 후보 commit에 대해 저장·사진·동시 편집·HTML/통합본 P0/P1 TC와 전체 회귀 검증을 완료한다.
- [ ] 변경 후 최초 정상/장애 판정 기준과 담당자, 앱 롤백 승인 절차를 기록한다.

**현재 운영 소스의 알려진 위험:** `workspace-records.ts`의 sanitizer는 알려진 필드로 객체를 재구성한다. v1.1의 미래 JSON 필드를 보존하는지는 확인하지 못했다. 새 브랜치의 호환성 테스트 통과만으로 위 운영 배포물34의 안전성을 대신 입증할 수 없다. 검증에서 보존 실패가 나오면 호환 가능한 안정 기준선을 별도로 준비하고 승인받아야 하며, 수정한 소스를 기존 배포물과 동일하다고 기록하지 않는다.

## 3. 준비 전용 manifest 검사

```sh
cd apps/web
node scripts/prepare-rollback.mjs /사용자가/지정한/rollback-prepare.json
```

`docs/examples/rollback-prepare.template.json`을 저장소 밖에 복사하고 실제 증거가 있는 값만 채운다. 템플릿의 `null`/`false`는 의도적인 차단 상태다. 날짜·해시·검증 성공을 임의로 채우지 않는다. 비밀번호·키·토큰·쿠키·서명 URL·백업 본문은 넣지 않는다.

도구는 다음을 검사한다.

- v2 `prepare-only` manifest와 정확한 운영 프로젝트만 허용
- 현재 운영 기준선과 fallback의 불변 ID·commit·제품 버전 일치
- 신규 후보 commit·스키마를 구분하고 현재 스키마 smoke/후보 스키마 호환성 증거를 각각 연결
- 최신 24시간 이내 백업·검증 선언, 해시·날짜·필수 증거와 프로젝트 일치
- DB/Storage `preserve-current`, migration `none`; 실행 옵션·환경파일·URL 입력 거부
- 명시적 JSON 파일32KiB 이하, 최종 symlink 차단·bounded read·출력에서 입력값 비노출

출력은 `BLOCKED`, `PREPARED_WITH_BLOCKERS`, `PREPARED_DECLARED_ONLY` 중 하나다. 마지막 상태도 **사용자 선언의 형식 검사 통과일 뿐**이며 항상 `DECLARED_NOT_VERIFIED`, `executionAvailable:false`, `deploymentAuthorized:false`다. 네트워크·배포 SDK·DB/Storage 호출은 없다. 이 도구는 CI/플랫폼의 자동 운영 배포를 강제 차단하는 실행 게이트가 아니다. 현재 CI에도 배포 job은 없으며 운영 전환은 별도 승인 절차로 유지한다.

최종17개 정책 TC용 `.github/workflows/rollback-preparation.yml`은 표준 Linux runner에서 기존 Node/env 라이브러리만 고정 `FROM scratch` 이미지로 복사한다. 신규 의존성/외부 이미지를 설치·pull하지 않으며 저장소 JS는 호스트가 아닌 네트워크 없음·읽기전용·비root·메모리256MiB/CPU1/PID32/tmp16MiB/wall45초 컨테이너에서만 실행한다. 비밀값·DB 연결·호스트 mount는 없다. 결과17/0/skipped0과 출력/자원/정리 조건이 모두 맞아야 통과하며 도구/한도 불지원은 우회하지 않는다. 이는 정책 TC만의 검증이며 전체 브라우저/DB/릴리스 승인이 아니다.

## 4. 긴급 상황에서의 순서 — 아직 실행하지 않음

1. 새 배포/추가 변경을 멈추고 장애 시각·증상·후보 commit을 기록한다.
2. 데이터 위험이 있으면 승인된 방식으로 쓰기만 잠시 멈춘다. 현재는 쓰기 중지 기능이 준비됐다고 가정하지 않는다.
3. 장애 시점 데이터는 보존한다. 과거 백업 복원·DB down migration·Storage 정리를 실행하지 않는다.
4. 사전에 호환성을 검증한 정확한 fallback을 사람이 확인하고 앱 전환을 승인한다.
5. 공식 플랫폼 절차로 **앱만** 전환한다. 환경변수·현재 DB/Storage 연결은 유지한다.
6. 비인증 GET/HEAD와 로그에서 공개 화면/오류율을 확인한다. 운영에서 테스트 로그인·저장·사진 삭제로 검증하지 않는다.
7. 복구 시간·실제 배포 ID·데이터 보존 확인·잔여 위험을 이슈/보고서에 남긴다.

백업 손상이 아닌 앱 장애에서 DB를 복원하지 않는다. 데이터 손상이 의심되면 운영에 바로 복원하지 말고 [별도 Staging 복구 Runbook](BACKUP_RESTORE.md)에 따라 검증한 뒤 필요한 범위만 별도 승인받는다.
