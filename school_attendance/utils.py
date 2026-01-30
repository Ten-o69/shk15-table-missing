import os


def get_env_list(key, default=None, separator=","):
    raw = os.getenv(key)
    if raw is None:
        return default if default is not None else []
    return [item.strip() for item in raw.split(separator) if item.strip()]


def get_env_bool(key, default=False):
    raw = os.getenv(key)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}
