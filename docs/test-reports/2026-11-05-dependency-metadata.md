# #87 공개 의존성 metadata 준비·제한 전달 검증

## 판정과 경계

**검토한 두 JSON 생성·전달 범위 GO / 보안 완료·운영 반영 NO-GO.** 사용자가 별도로 승인한 공개 `package.json`·`package-lock.json` 두 파일만 최대 하루 보관 설정으로 전달했다. 앱 소스·환경·비밀값·DB·사진·원시 로그는 결과물에 포함하지 않았다. 무료 범위를 사전 확인했으며 계정·결제 정보는 기록하지 않는다.

- 정책 테스트 코드: `5d77e5650e41ff1f400e8ac45870629530c5b33d`
- 실제 생성·전달 코드: `681ab87fb9aba6a824f645cf3a7b7bcda30cd7d6`
- Next 후보는 별도 `codex/m1-next-security-update` 브랜치다. 이 도구를 앱 후보에 섞지 않았다.
- main merge·배포·공유 SQL·기존 데이터/사진·유료 설정 변경0.

## 실제 실행 증거

| TC / 단계 | run / job | 결과 |
|---|---|---|
| METADATA-POLICY 24개 | [41999115476](https://github.com/rlawksml/word-html-studio/actions/runs/41999115476) /127149639621 | PASS24, fail/cancelled/skipped/todo0, 소유 자원 정리 확인 |
| metadata 생성 | [41999765495](https://github.com/rlawksml/word-html-studio/actions/runs/41999765495) /127151784038 | lock-only npm exit0, signal/error/limited 없음, 관측 warning0 |
| 정리 후 승격·업로드 | 같은 run | 09:08:03.9508334Z COMPLETE →09:08:04.0107037Z 업로드 전 재검사 PASS → 정확히 두 파일 artifact |
| 제한 수신·재검사 | 주 담당의 native 수신기 | archive SHA/크기·정확한 두 이름·CRC·파일별 SHA/크기·UTF-8/JSON·regular/nlink1 확인 PASS |
| 변경 graph 독립 검토 | 새 lock과 공식 registry metadata 대조 | 735레코드 중42변경/693동일/추가0/삭제0. 비root41레코드의40개 고유 package/version metadata 모두 일치 |

24개 TC는 합성 metadata·scratch FD/승격 정책 범위다. 실제 resolver 성공이나 전체 앱 회귀를 대신하지 않는다. 일부 파일 쓰기 실패는 fault injection이며 실제 OS 고장 테스트가 아니다. 출력 스트림 제한·최악 깊이 JSON·프로세스 비정상 종료 등 모든 적대 조건을 실행했다고 해석하지 않는다.

## 전달물 지문

| 파일 | bytes | SHA-256 |
|---|---:|---|
| package.json | 3931 | `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8` |
| package-lock.json | 394737 | `bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe` |

- artifact ID: `13401921686`, 이름 `dependency-manifests-41999765495-1`, archive84386bytes
- archive SHA-256: `564aa8fd4c7c4459ab33c22dd9536f4b0edc935d6ab7c7ca28b4c4119dabfc2e`
- API의 생성 시각 `2026-11-05T09:08:05Z`, 만료 예정 `2026-11-06T09:08:04Z`. retention1일은 물리 삭제 완료 보증이 아니다. 추가 업로드는 실행하지 않았다.
- 공식 upload-artifact pin: `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (v7.0.2).
- 주 담당과 독립 검토자가 실제 run·고정 요약·artifact metadata 및 수신물 바이트를 대조했다. raw base64/JSON/로그를 Issue에 출력하지 않았다.

## 변경 의미와 남은 검사

직접 의존성 선언은 Next와 eslint-config-next16.3.4→16.4.5 두 필드만 변경했다. scripts·React19.2.8·vinext0.0.50 등 다른 직접 선언은 동일하다. Next/env/eslint-plugin/SWC, sharp0.35.5·플랫폼 묶음과 libvips1.3.4는 공식 배포 metadata와 일치했다. **semver7.8.5→7.8.6은 범위 내 resolver 부수 변경**이며 강제되는 변경이라고 표현하지 않는다.

SRI 문자열 대조는 tarball bytes 실행·검증이 아니다. 새 후보의 무스크립트 설치와 오프라인 전체 회귀는 별도 실행이다. 이 metadata run은 **audit NOT_RUN / appValidation NOT_RUN**을 명시했다. production 경로 source-map-js1.2.1과 개발 Miniflare의 sharp0.35.2는 그대로여서 #87/#66을 닫지 않는다.

## 실행 안전성

공개 표준 Linux의 native 검토·pin 고정 controller만 호스트에서 실행했다. FROM scratch/nonroot/RO root·제한 tmpfs·CPU/메모리/PID/시간·로그 상한을 유지했다. prep에는 두 root manifest만 넣고 lifecycle·app 코드를 실행하지 않았다. 공식 registry lock-only 후 자식 종료→prep 망 분리→RO 소비자 인계→prep 부재→제한 packet 검증→최종 OS/컨테이너 확인→정확한 소유 자원 정리 뒤만 파일을 승격했다. 기존 앱 실행의64KiB 출력 제한과16KiB 상태 pipe는 완화하지 않았다.

수신은 archive를 일반 경로로 풀거나 내용을 실행하지 않고, 고정 두 파일만 새0700 디렉터리의 held dirfd/EXCL/NOFOLLOW 파일로 기록·재읽기했다. 기존 원본·후보 파일을 수신 과정에서 덮어쓰지 않았다. 이 결과는 공유 DB/Storage 백업이나 복원 성공을 뜻하지 않는다.
