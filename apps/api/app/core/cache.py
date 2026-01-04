from __future__ import annotations

import time
import threading
from typing import Any, Optional


class SimpleTTLCache:
    """A very small thread-safe TTL cache used for read-heavy endpoints.

    Not a replacement for Redis, but low-risk and easy to use for short-lived caching.
    """

    def __init__(self, default_ttl: int = 30):
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self.default_ttl = default_ttl

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        expire = time.time() + (ttl if ttl is not None else self.default_ttl)
        with self._lock:
            self._data[key] = (expire, value)

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expire, value = item
            if expire < time.time():
                # expired
                del self._data[key]
                return None
            return value

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)
    
    def delete_pattern(self, pattern: str) -> None:
        """Delete all keys matching pattern (supports * wildcard)"""
        with self._lock:
            if '*' in pattern:
                prefix = pattern.split('*')[0]
                keys_to_delete = [k for k in self._data.keys() if k.startswith(prefix)]
                for k in keys_to_delete:
                    del self._data[k]
            else:
                self._data.pop(pattern, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


# Shared global cache instance for the app
cache = SimpleTTLCache()
