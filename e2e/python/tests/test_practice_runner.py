"""실습기의 원격 실행 방지와 고정 명령을 브라우저 없이 검증합니다."""

import signal
import subprocess

import pytest

import practice_runner


def test_practice_target_is_fixed_loopback() -> None:
    assert practice_runner.HOST == "localhost"
    assert practice_runner.BASE_URL == "http://localhost:4173"


def test_practice_cli_has_no_url_or_secret_arguments() -> None:
    actions = practice_runner.parser()._actions
    option_names = {name for action in actions for name in action.option_strings}
    assert "--url" not in option_names
    assert "--password" not in option_names
    assert "--token" not in option_names


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("v22.13.0", (22, 13, 0)), ("24.16.0", (24, 16, 0)), ("v22.13.1-rc.0", (22, 13, 1))],
)
def test_node_version_is_parsed_for_exact_minimum_check(raw: str, expected: tuple[int, int, int]) -> None:
    assert practice_runner.parse_node_version(raw) == expected


def test_setup_check_can_skip_the_practice_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(practice_runner.sys, "version_info", (3, 11))
    monkeypatch.setattr(practice_runner.sys, "version", "3.11.0")
    monkeypatch.setattr(practice_runner, "node_version", lambda: (22, 13, 0))
    monkeypatch.setattr(practice_runner, "require_command", lambda name: f"/mock/{name}")
    monkeypatch.setattr(practice_runner, "port_is_available", lambda: pytest.fail("포트를 확인하면 안 됩니다"))
    practice_runner.check_environment(require_installed=False, check_port=False)


def test_server_cleanup_falls_back_to_kill_only_for_own_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signals: list[tuple[int, signal.Signals]] = []

    class StuckProcess:
        pid = 4321

        @staticmethod
        def poll() -> None:
            return None

        @staticmethod
        def wait(timeout: int) -> int:
            if timeout == 8:
                raise subprocess.TimeoutExpired("mock-server", timeout)
            return 0

    monkeypatch.setattr(practice_runner.os, "killpg", lambda pid, sig: signals.append((pid, sig)))
    practice_runner.stop_own_server(StuckProcess())  # type: ignore[arg-type]
    assert signals == [(4321, signal.SIGTERM), (4321, signal.SIGKILL)]
