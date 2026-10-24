import json
import logging
import time
from typing import Any

import redis

from .config import settings

logger = logging.getLogger(__name__)

PREFIX = "recipes:"
TTL_SECONDS = 300
# Process-local L1 so a deployment without Redis still avoids rebuilding the full catalog
# on every request. Render runs a single worker; with several workers a write only clears
# the cache of the worker that handled it, hence the short TTL.
LOCAL_TTL_SECONDS = 120

class _NoCache:
    """Stand-in when REDIS_URL is empty (tests): every call behaves like a cache miss."""

    def get(self, *_a, **_k):
        return None

    def set(self, *_a, **_k):
        return None

    def scan_iter(self, *_a, **_k):
        return iter(())

    def delete(self, *_a, **_k):
        return 0


_client = (
    redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
    if settings.redis_url
    else _NoCache()
)

_local: dict[str, tuple[float, Any]] = {}


def _local_get(full_key: str) -> Any | None:
    hit = _local.get(full_key)
    if hit is None:
        return None
    expires_at, value = hit
    if expires_at <= time.monotonic():
        _local.pop(full_key, None)
        return None
    return value


def _local_set(full_key: str, value: Any) -> None:
    _local[full_key] = (time.monotonic() + LOCAL_TTL_SECONDS, value)


def cache_get(key: str) -> Any | None:
    """Fail open: if Redis is down, use the process-local copy or behave as a cache miss."""
    full_key = PREFIX + key
    value = _local_get(full_key)
    if value is not None:
        return value
    try:
        raw = _client.get(full_key)
    except redis.RedisError:
        logger.warning("redis unavailable on get", exc_info=True)
        return None
    if raw is None:
        return None
    value = json.loads(raw)
    _local_set(full_key, value)
    return value


def cache_set(key: str, value: Any) -> None:
    full_key = PREFIX + key
    _local_set(full_key, value)
    try:
        _client.set(full_key, json.dumps(value), ex=TTL_SECONDS)
    except redis.RedisError:
        logger.warning("redis unavailable on set", exc_info=True)


def invalidate_recipes() -> None:
    """Drop every cached recipe payload - called after any recipe write."""
    for full_key in [key for key in _local if key.startswith(PREFIX)]:
        _local.pop(full_key, None)
    try:
        keys = list(_client.scan_iter(PREFIX + "*"))
        if keys:
            _client.delete(*keys)
    except redis.RedisError:
        logger.warning("redis unavailable on invalidate", exc_info=True)


def cache_get_bytes(key: str) -> bytes | None:
    try:
        return _client.get(PREFIX + key)
    except redis.RedisError:
        logger.warning("redis unavailable on get", exc_info=True)
        return None


def cache_set_bytes(key: str, value: bytes) -> None:
    try:
        _client.set(PREFIX + key, value, ex=24 * 3600)
    except redis.RedisError:
        logger.warning("redis unavailable on set", exc_info=True)
