import calendar
from datetime import date
from functools import lru_cache

import holidays
from django.conf import settings


def _get_extra_school_holidays() -> tuple[tuple[int, int], ...]:
    return tuple(tuple(item) for item in getattr(settings, 'SCHOOL_HOLIDAYS', []))


@lru_cache(maxsize=None)
def _get_holidays_for_year_cached(year: int, extra_school_holidays: tuple[tuple[int, int], ...]) -> set[date]:
    holiday_dates = set(holidays.country_holidays('RU', years=year, observed=True, language='ru').keys())

    for month, day in extra_school_holidays:
        try:
            holiday_dates.add(date(year, month, day))
        except ValueError:
            continue

    return holiday_dates


def get_holidays_for_year(year: int) -> set[date]:
    """
    Возвращает неучебные праздничные даты для конкретного года.
    Основа - официальный календарь РФ с учетом переносов выходных;
    SCHOOL_HOLIDAYS остается как локальное расширение.
    """
    return _get_holidays_for_year_cached(year, _get_extra_school_holidays())


def is_school_day(day: date) -> bool:
    """
    Проверка, является ли день учебным.
    1. Это Пн-Пт? (weekday < 5)
    2. Это не праздник в этом году?
    """
    # 0=Mon, 4=Fri, 5=Sat, 6=Sun
    if day.weekday() >= 5:
        return False

    if day in get_holidays_for_year(day.year):
        return False

    return True


def get_working_days_in_month(year: int, month: int) -> list[date]:
    """
    Возвращает упорядоченный список только учебных дат за месяц.
    """
    _, last_day = calendar.monthrange(year, month)

    working_days = []
    for day_num in range(1, last_day + 1):
        d = date(year, month, day_num)
        if is_school_day(d):
            working_days.append(d)

    return working_days


def get_working_day_numbers_in_month(year: int, month: int) -> list[int]:
    """Возвращает номера учебных дней месяца по календарным датам."""
    return [day.day for day in get_working_days_in_month(year, month)]


def resolve_working_day_number(year: int, month: int, requested_day: int | None, fallback_day: int | None) -> int | None:
    """
    Возвращает ближайший допустимый учебный день месяца.
    Сначала использует явный запрос, затем ближайший прошедший учебный день
    относительно fallback_day, иначе первый доступный день месяца.
    """
    available_days = get_working_day_numbers_in_month(year, month)
    if not available_days:
        return None

    if requested_day in available_days:
        return requested_day

    if fallback_day is not None:
        eligible_days = [day for day in available_days if day <= fallback_day]
        if eligible_days:
            return eligible_days[-1]

    return available_days[0]


def count_working_days_up_to(year: int, month: int, day: int | None) -> int:
    """Считает, сколько учебных дней месяца прошло к указанному номеру дня."""
    if day is None:
        return 0

    return sum(1 for current_day in get_working_day_numbers_in_month(year, month) if current_day <= day)


def count_working_days(year: int, month: int) -> int:
    """Возвращает количество учебных дней в месяце."""
    return len(get_working_days_in_month(year, month))
