from __future__ import annotations

import time
import logging
from functools import wraps
from typing import Callable

logger = logging.getLogger("app.monitor")


def timed(name: str | None = None):
    def deco(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.time()
            try:
                return func(*args, **kwargs)
            finally:
                elapsed = (time.time() - start) * 1000.0
                logger.info(f"[timing] {name or func.__name__} took {elapsed:.2f}ms")
        return wrapper
    return deco
