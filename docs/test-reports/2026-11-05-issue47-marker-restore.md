# #47 복원 marker 보존 정책 검증

## 판정과 범위

2026-11-05: **소스 독립 리뷰 완료 / 격리 정책 테스트 실행 대기 / 실제 복원·운영 NO-GO**.

`app_schema_versions.applied_at`이 다른 새 복구 대상에서 기존 exact-hash 정책이 복원을 거부하는 문제를 분리했다. 업무 테이블의 empty/resume exact-hash 규칙을 완화하지 않고 marker만 component/version을 비교해 대상 행을 보존한다. 원본 백업을 수정하거나 marker를 insert/update/delete하지 않는다.

이 문서는 실제 DB 복원 성공 보고서가 아니다. 운영 `kdigttaghqubfjsmbngl`과 보관 Staging `kriyjyyudngtibrtkylf`는 복원 대상에서 하드 거부한다. 새 프로젝트 생성, SQL, DB/Storage 접근·쓰기·삭제·seed, merge, 배포, 유료 전환은 하지 않았다.

## 변경과 독립 리뷰

- 새 marker 정책: component/version 의미 비교, 원래 대상 전체 행·순서의 hash 고정, 불변·위조 불가 계획. 추가/누락 component와 버전 차이는 거부한다.
- 최초 업무 insert 직전 marker 재확인, marker insert 명시적 건너뛰기, 마지막 대상 marker hash 재검증.
- source fingerprint 필수, 공식 HTTPS root URL과 명시적 두 확인 ref 요구. 현재 운영·보관 Staging은 확인 변수로 우회 불가.
- 백업에 marker가 없는 기존 형식은 계속 지원하되 `schemaCompatibility: NOT_VERIFIED`로 구분한다. marker 비교 자체도 실제 DDL/권한 동등성의 증거가 아니다.
- 독립 리뷰 보강: prewrite 호출·조건·위치 assertion 추가. 롤백은 검증된 불변 배포 ID+artifact hash이며 Git tag만으로 대체/재빌드하지 않는다고 문서 정정.

## TC 목록과 실행 전 상태

| TC | 확인 사항 | 상태 |
|---|---|---|
| RESTORE-MARKER-01~03 | 다른 적용 시각 허용·대상 보존, 입력 불변, 의미 비교와 원래 순서 hash 분리 | 실행 대기 |
| RESTORE-MARKER-04~09 | 빈/잘못된 행, component/version 차이, 중복·추가필드, 날짜, 32개 상한, getter 거부 | 실행 대기 |
| RESTORE-MARKER-10~11 | 계획 위조/변경 거부, 대상 timestamp/key/row 순서 drift 거부 | 실행 대기 |
| RESTORE-MARKER-12 | 업무 테이블 empty/resume exact-hash와 legacy 목록 유지 | 실행 대기 |
| RESTORE-MARKER-13~14 | 실제 insert loop의 marker 쓰기 0회, 업무 실패 시 이후 쓰기 0회 | 실행 대기 |
| RESTORE-MARKER-15 | CLI 정책 연결·prewrite 위치·최종 hash·백업 쓰기 경로 부재의 소스 계약 | 실행 대기 |
| RESTORE-TARGET-01~04 | 보호 ref·필수 source 지문·오인 확인·비공식 URL 차단 | 실행 대기 |
| 기존 backup-safety 6개 | 출력 경계, 대상 guard, 업무/사진 resume, 오류 요약, 변조 탐지 | 실행 대기 |

등록 수: 신규 19 + 기존 6 = **25개**. insert loop 2TC는 검토된 문자열 조각을 메모리 port로 실행하고, CLI 계약은 소스 assertion이다. 전체 CLI·Supabase SDK·Postgres/Storage 통합 테스트가 아니다.

## 실행 경계

Mac 로컬에서는 필요한 OS 메모리·PID·디스크 한도를 증명할 수 없어 대상 코드를 실행하지 않았다. 별도 수동 source-policy CI는 다음 6개 허용 파일만 복사한다. 외부 의존성 설치/이미지 pull/환경파일/비밀키/DB 연결은 없다.

```text
scripts/backup-utils.mjs
scripts/schema-marker-restore-policy.mjs
scripts/supabase-schema.mjs
scripts/supabase-restore-staging.mjs (문자열 읽기 전용)
tests/schema-marker-restore-policy.test.mjs
tests/backup-safety.test.mjs
```

고정 `FROM scratch` runtime은 network none, read-only root, non-root, memory 256MiB/swap 0/CPU 1/PID 32, scratch tmpfs 16MiB, CPU 30초/벽시계 45초/출력 64KiB 한도를 요구한다. 검토된 launcher가 실효 cgroup·rlimit·환경·네트워크·쓰기 경계를 확인한 뒤 정확한 두 테스트만 시작한다. 한도/검사 실패를 테스트 PASS로 대체하지 않는다.

호스트·공개 로그에 대상 TAP 본문을 게시하지 않고 exact commit·검증된 등록/성공/실패/skip 수만 기록한다. 정상 PR의 audit/verify gate와 기존 DB 통합 job 비활성화는 유지한다. 실행 결과는 다음 절에 후속 기록한다.

## 남은 검증

- [ ] exact commit 격리 CI 25개 결과와 실행 URL 기록
- [ ] 별도 승인된 **새 격리 복구 대상** 및 일관성 있는 백업 준비
- [ ] 실제 schema/권한 준비와 DB·Storage 복원, count/hash/사진 참조 비교
- [ ] 정확한 운영 fallback 배포물에서 최신 데이터 호환성·사진 보존 확인
- [ ] 최신 백업 보관·불변 artifact·운영 전환 절차의 최종 승인

현재 보관 Staging 초기화나 운영 DB 덮어쓰기로 위 미검증을 우회하지 않는다. #47은 실제 복구 훈련이 끝나기 전 닫지 않는다.
