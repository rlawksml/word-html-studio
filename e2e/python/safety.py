"""E2E 실행 대상을 navigation 전에 제한하는 fail-closed 안전장치."""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit


class UnsafeBaseUrl(ValueError):
    """원격 또는 모호한 E2E 대상이 지정됐을 때 발생합니다."""


def require_loopback_base_url(raw_url: str) -> str:
    """URL이 이 컴퓨터(loopback)의 명시적 HTTP 포트인지 확인해 정규화합니다.

    안전하다고 증명할 수 없는 값은 허용하지 않는 fail-closed 방식입니다. 즉, 새롭거나
    모호한 URL을 추측해서 실행하지 않고 ``UnsafeBaseUrl``로 중단합니다.
    """
    value = raw_url.strip()
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise UnsafeBaseUrl("E2E_BASE_URL 형식이 올바르지 않습니다.") from error

    if parsed.scheme != "http":
        raise UnsafeBaseUrl("로컬 E2E_BASE_URL은 http만 허용됩니다.")
    if not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeBaseUrl("E2E_BASE_URL에는 호스트만 지정하고 인증정보를 넣지 마세요.")
    if parsed.query or parsed.fragment:
        raise UnsafeBaseUrl("E2E_BASE_URL에는 query 또는 fragment를 넣지 마세요.")
    if port is None:
        raise UnsafeBaseUrl("로컬 개발 서버의 포트를 명시하세요.")

    # localhost뿐 아니라 127.0.0.1과 IPv6 ::1 같은 표준 loopback 주소를 허용합니다.
    hostname = parsed.hostname.rstrip(".").lower()
    is_loopback = hostname == "localhost"
    if not is_loopback:
        try:
            is_loopback = ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            is_loopback = False
    if not is_loopback:
        raise UnsafeBaseUrl("원격, Staging, Production 대상 E2E는 차단됩니다.")

    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}"
