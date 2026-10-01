#!/usr/bin/env python3
"""초보자용 로컬 E2E 실습 실행기.

주소와 서버 명령은 코드에 고정되어 있습니다. 운영·Staging 주소나 자격증명을
인자로 받을 수 없으며, 실행기가 시작한 로컬 서버만 종료합니다.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

# vinext는 macOS에서 localhost의 IPv6 loopback(::1)에 bind합니다. hostname 자체는
# safety.py가 허용하는 loopback이며 원격 interface(0.0.0.0)에는 노출하지 않습니다.
HOST = "localhost"
PORT = 4173
BASE_URL = f"http://{HOST}:{PORT}"
HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
WEB_APP = REPOSITORY / "apps" / "web"
VENV = HERE / ".venv"
PYTHON = VENV / "bin" / "python"
PYTEST = VENV / "bin" / "pytest"
READY_TIMEOUT_SECONDS = 45


class PracticeError(RuntimeError):
    """사용자가 해결할 수 있는 실습 환경 오류입니다."""


def run(command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    """명령을 화면에 보여 준 뒤 실패를 숨기지 않고 실행합니다."""
    print(f"\n$ {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def port_is_available() -> bool:
    """고정 실습 포트가 비었는지 확인합니다. 다른 서버를 종료하지 않습니다."""
    # bind로 다시 포트를 잡으면 방금 종료된 서버의 소켓 정리 시간을
    # "사용 중"으로 오판할 수 있어, 실제 listener에 연결되는지만 확인합니다.
    for family, socktype, proto, _, address in socket.getaddrinfo(
        HOST, PORT, type=socket.SOCK_STREAM
    ):
        with socket.socket(family, socktype, proto) as probe:
            probe.settimeout(0.2)
            if probe.connect_ex(address) == 0:
                return False
    return True


def require_command(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise PracticeError(f"'{name}' 명령을 찾지 못했습니다. 먼저 설치해 주세요.")
    return path


def parse_node_version(raw_version: str) -> tuple[int, int, int]:
    """Node의 ``v22.13.0`` 형식을 비교 가능한 숫자로 바꿉니다."""
    try:
        major, minor, patch = raw_version.strip().lstrip("v").split(".", 2)
        return int(major), int(minor), int(patch.split("-", 1)[0])
    except (TypeError, ValueError) as error:
        raise PracticeError("Node.js 버전을 읽을 수 없습니다.") from error


def node_version() -> tuple[int, int, int]:
    completed = subprocess.run(
        [require_command("node"), "--version"], capture_output=True, text=True, check=True
    )
    return parse_node_version(completed.stdout)


def check_environment(*, require_installed: bool = True, check_port: bool = True) -> None:
    """실습 전제 조건을 읽기 전용으로 확인합니다."""
    print(f"Python: {sys.version.split()[0]}")
    if sys.version_info < (3, 9):
        raise PracticeError("Python 3.9 이상이 필요합니다.")
    version = node_version()
    print(f"Node.js: {'.'.join(map(str, version))}")
    if version < (22, 13, 0):
        raise PracticeError("이 앱은 Node.js 22.13.0 이상이 필요합니다.")
    require_command("npm")
    if not (WEB_APP / "package-lock.json").is_file():
        raise PracticeError("apps/web/package-lock.json을 찾지 못했습니다.")
    if check_port and not port_is_available():
        raise PracticeError(
            f"{BASE_URL} 포트가 이미 사용 중입니다. 실행 중인 서버를 직접 확인해 종료한 뒤 다시 시도하세요."
        )
    if require_installed:
        if not PYTEST.is_file():
            raise PracticeError("Python 환경이 없습니다. 먼저 'python3 practice_runner.py setup'을 실행하세요.")
        if not (WEB_APP / "node_modules").is_dir():
            raise PracticeError("Node 패키지가 없습니다. 먼저 setup을 실행하세요.")
    print(f"고정 로컬 주소: {BASE_URL}")
    print("안전 확인: 원격 URL과 자격증명을 입력받지 않습니다.")


def setup() -> None:
    """Python/Node 의존성과 실습용 Chromium을 최초 1회 설치합니다."""
    # 설치는 서버를 띄우지 않으므로 실습 포트 점유와 무관합니다.
    check_environment(require_installed=False, check_port=False)
    if not PYTHON.exists():
        run([sys.executable, "-m", "venv", str(VENV)], cwd=HERE)
    run([str(PYTHON), "-m", "pip", "install", "-r", "requirements.txt"], cwd=HERE)
    run([str(PYTHON), "-m", "playwright", "install", "chromium"], cwd=HERE)
    run([require_command("npm"), "ci"], cwd=WEB_APP)
    print("\n준비 완료. 다음 명령: python3 practice_runner.py demo")


def wait_until_ready(process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise PracticeError("로컬 앱이 준비되기 전에 종료됐습니다. 위 서버 로그를 확인하세요.")
        try:
            with urlopen(BASE_URL, timeout=1) as response:
                if response.status < 500:
                    return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.25)
    raise PracticeError(f"{READY_TIMEOUT_SECONDS}초 안에 로컬 앱이 준비되지 않았습니다.")


def stop_own_server(process: subprocess.Popen[str]) -> None:
    """새 process group으로 시작한 현재 실행기의 서버만 종료합니다."""
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=3)


def run_lab(*, headed: bool) -> None:
    check_environment()
    npm = require_command("npm")
    server_env = os.environ.copy()
    # 외부 주소를 받지 않고 loopback으로만 bind합니다.
    command = [npm, "run", "dev", "--", "--host", HOST, "--port", str(PORT)]
    print(f"\n로컬 앱을 시작합니다: {BASE_URL}")
    server = subprocess.Popen(
        command,
        cwd=WEB_APP,
        env=server_env,
        text=True,
        start_new_session=True,
    )
    try:
        wait_until_ready(server)
        test_env = os.environ.copy()
        test_env["E2E_BASE_URL"] = BASE_URL
        pytest_command = [str(PYTEST), "-c", "pytest.ini", "practice/test_practice.py", "-q"]
        if headed:
            pytest_command.extend(["--headed", "--slowmo", "700"])
            print("브라우저를 보면서 연습 TC를 실행합니다. 자동 동작 중에는 마우스를 조작하지 마세요.")
        else:
            print("화면을 띄우지 않고 연습 TC를 빠르게 확인합니다.")
        run(pytest_command, cwd=HERE, env=test_env)
    finally:
        print("\n실행기가 시작한 로컬 앱을 종료합니다.")
        stop_own_server(server)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="로컬 mock 전용 Python Playwright 실습기")
    result.add_argument(
        "command",
        choices=("setup", "check", "test", "demo"),
        help="setup=최초 설치, check=환경 확인, test=화면 없는 실행, demo=브라우저를 보며 실행",
    )
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "setup":
            setup()
        elif args.command == "check":
            check_environment()
        else:
            run_lab(headed=args.command == "demo")
    except (PracticeError, subprocess.CalledProcessError) as error:
        print(f"\n실습을 안전하게 중단했습니다: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
