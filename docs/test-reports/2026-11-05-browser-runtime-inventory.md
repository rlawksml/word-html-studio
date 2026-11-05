# Linux 브라우저 도구 관측 — BLOCKED

## 결과와 범위

**준비 경로 BLOCKED / 브라우저 E2E 미실행.** 도구 관측의 실패를 제품 기능 실패나 브라우저 테스트 PASS로 바꾸지 않는다.

- exact `d022194ba67b30bda1897026495457a5f5f6ff1f`
- [run41992558668](https://github.com/rlawksml/word-html-studio/actions/runs/41992558668), job127128035966
- 실제 fixed code: `PARENT_WRITABLE_BY_OTHERS`, 08:11:36.0846389Z. job failure/exit1.

공개·manual·codex·exactSHA guard와 env-i/총35초·도구별5초 제한 아래, 이미 설치된 고정 OS 파일3개만 조사하는 workflow다. checkout·프로젝트 코드·npm/브라우저 실행·키·네트워크 요청·artifact/cache·배포가 없다. root 소유/canonical/regular/상위 경로 비쓰기·512MiB·해시 전후 정체성·ELF magic을 확인하도록 독립 source review했다.

실제 첫 후보의 상위 경로 비쓰기 검사에서 차단됐으며 뒤의 후보 관측은 실행되지 않았다. 정확히 어느 상위 경로였는지는 공개 고정 코드만으로 식별하지 못했다. Chrome 버전·architecture·의존 라이브러리·전체 runtime closure·실행 가능성·namespace/seccomp를 확인한 결과가 아니다. 권한 검사를 완화하거나 호스트/`--no-sandbox`로 우회하지 않았다.

## 다음 준비

- 신뢰 부모가 안전하게 고정할 수 있는 Linux 브라우저/toolchain 경로와 OS 라이브러리를 별도 검토한다.
- 비루트·renderer sandbox/user namespace·seccomp·제한 shm·RO source/toolchain·network-none/격리 loopback·CPU/메모리/PID/디스크/wall·정확한 자식 종료를 실제 확인해야 한다.
- 현재 Mac의 Playwright1.62.1/Chromium1234 캐시는 mac-arm64이며 Linux 검증 환경의 대체가 아니다. 대상 코드를 Mac 호스트에서 실행하지 않았다.
- HTML copy/digest/lifecycle의 serverless fixture부터 검토하되 실제 로그인·IME·HEIC/대용량·동시 사용자·API/Storage P0와는 별도다.
- 기존 offline276 또는247 결과를 브라우저·실제 Supabase 검증으로 승격하지 않는다.

운영/보관 Staging·기존 자료·사진·환경 변경0, main merge·배포·과금 설정 변경0. 전체 운영 NO-GO 유지.
