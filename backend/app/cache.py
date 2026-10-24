import json
import logging
from typing import Any

import redis

from .config import settings

logger = logging.getLogger(__name__)

PREFIX = "recipes:"
TTL_SECONDS = 300

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


def cache_get(key: str) -> Any | None:
    """Fail open: if Redis is down, behave as a cache miss so the API still works."""
    try:
        raw = _client.get(PREFIX + key)
    except redis.RedisError:
        logger.warning("redis unavailable on get", exc_info=True)
        return None
    return json.loads(raw) if raw is not None else None


def cache_set(key: str, value: Any) -> None:
    try:
        _client.set(PREFIX + key, json.dumps(value), ex=TTL_SECONDS)
    except redis.RedisError:
        logger.warning("redis unavailable on set", exc_info=True)


def invalidate_recipes() -> None:
    """Drop every cached recipe payload - called after any recipe write."""
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
