import os


def get_env_list(key, default=None, separator=","):
    raw = os.getenv(key)
    if raw is None:
        return default if default is not None else []
    return [item.strip() for item in raw.split(separator) if item.strip()]
