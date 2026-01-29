import calendar
from datetime import date
from django.conf import settings


def get_holidays_for_year(year: int) -> set[date]:
    """
    Генерирует список праздничных дат для конкретного года,
    основываясь на настройках (Месяц, День).
    """
    raw_days = getattr(settings, 'SCHOOL_HOLIDAYS', [])
    holidays = set()

    for month, day in raw_days:
        try:
            # Создаем дату для запрошенного года
            holidays.add(date(year, month, day))
        except ValueError:
            # Обработка 29 февраля в невисокосные годы или ошибок в конфиге
            continue

    return holidays


def is_school_day(day: date) -> bool:
    """
    Проверка, является ли день учебным.
    1. Это Пн-Пт? (weekday < 5)
    2. Это не праздник в этом году?
    """
    # 0=Mon, 4=Fri, 5=Sat, 6=Sun
    if day.weekday() >= 5:
        return False

    # Получаем праздники для года этой даты
    holidays = get_holidays_for_year(day.year)

    if day in holidays:
        return False

    return True


def get_working_days_in_month(year: int, month: int) -> list[date]:
    """
    Возвращает упорядоченный список только учебных дат за месяц.
    """
    _, last_day = calendar.monthrange(year, month)

    # Генерируем праздники для текущего года
    holidays = get_holidays_for_year(year)

    working_days = []
    for day_num in range(1, last_day + 1):
        d = date(year, month, day_num)

        # 1. Проверка на выходные (Пн-Пт)
        if d.weekday() >= 5:
            continue

        # 2. Проверка на праздники
        if d in holidays:
            continue

        working_days.append(d)

    return working_days


def count_working_days(year: int, month: int) -> int:
    """Возвращает количество учебных дней в месяце."""
    return len(get_working_days_in_month(year, month))
