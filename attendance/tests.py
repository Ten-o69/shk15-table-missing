from datetime import date

from django.test import SimpleTestCase, override_settings

from attendance.services import school_calendar
from attendance.utils import class_sort_key, parse_int_param


class ClassSortKeyTests(SimpleTestCase):
    def test_class_sort_key_orders_numeric_then_suffix(self):
        classes = ["10B", "2B", "1V", "2A", "A1"]
        ordered = sorted(classes, key=class_sort_key)
        self.assertEqual(ordered, ["1V", "2A", "2B", "10B", "A1"])


class ParseIntParamTests(SimpleTestCase):
    def test_parse_int_param_with_bounds(self):
        self.assertEqual(parse_int_param("5", 1, min_value=1, max_value=12), 5)
        self.assertEqual(parse_int_param("0", 1, min_value=1, max_value=12), 1)
        self.assertEqual(parse_int_param("13", 1, min_value=1, max_value=12), 1)
        self.assertEqual(parse_int_param("nope", 7, min_value=1, max_value=12), 7)


class SchoolCalendarTests(SimpleTestCase):
    @override_settings(SCHOOL_HOLIDAYS=[(1, 1)])
    def test_is_school_day_respects_weekends_and_holidays(self):
        self.assertFalse(school_calendar.is_school_day(date(2026, 1, 3)))
        self.assertFalse(school_calendar.is_school_day(date(2026, 1, 1)))
        self.assertTrue(school_calendar.is_school_day(date(2026, 1, 6)))
