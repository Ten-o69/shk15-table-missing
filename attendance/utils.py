import re


CLASS_NAME_RE = re.compile(r'^\s*(\d+)\s*(.*)$')


def class_sort_key(value):
    if hasattr(value, 'name'):
        raw = value.name
    else:
        raw = value or ''

    name = str(raw).strip()
    if not name:
        return (float('inf'), '')

    match = CLASS_NAME_RE.match(name)
    if not match:
        return (float('inf'), name.lower())

    number = int(match.group(1))
    suffix = (match.group(2) or '').strip().lower()
    return (number, suffix)


def parse_int_param(value, default, min_value=None, max_value=None):
    try:
        if value is None or value == "":
            num = default
        else:
            num = int(value)
    except (TypeError, ValueError):
        return default

    if min_value is not None and num < min_value:
        return default
    if max_value is not None and num > max_value:
        return default
    return num
