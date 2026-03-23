from datetime import date

from django.test import SimpleTestCase, override_settings

from attendance.services import school_calendar
from attendance.utils import class_sort_key, parse_int_param
from attendance.views.stats import build_student_search_text


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
    def test_is_school_day_respects_weekends_and_russian_holidays(self):
        self.assertFalse(school_calendar.is_school_day(date(2026, 1, 3)))
        self.assertFalse(school_calendar.is_school_day(date(2026, 1, 1)))
        self.assertFalse(school_calendar.is_school_day(date(2026, 1, 6)))
        self.assertTrue(school_calendar.is_school_day(date(2026, 1, 9)))

    def test_get_holidays_for_year_includes_transferred_russian_days_off(self):
        holidays_2025 = school_calendar.get_holidays_for_year(2025)
        self.assertIn(date(2025, 5, 2), holidays_2025)
        self.assertIn(date(2025, 6, 13), holidays_2025)

    @override_settings(SCHOOL_HOLIDAYS=[(1, 13)])
    def test_working_day_helpers_use_filtered_school_days(self):
        self.assertEqual(
            school_calendar.get_working_day_numbers_in_month(2026, 1),
            [9, 12, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30],
        )
        self.assertEqual(school_calendar.resolve_working_day_number(2026, 1, 13, 13), 12)
        self.assertEqual(school_calendar.count_working_days_up_to(2026, 1, 13), 2)


class StudentLookupTests(SimpleTestCase):
    def test_build_student_search_text_includes_initial_variants(self):
        search_text = build_student_search_text('Иванов Иван Иванович', '5А')
        self.assertIn('иванов и и', search_text)
        self.assertIn('иванов ии', search_text)
        self.assertIn('иванов и. и.', search_text)
        self.assertIn('5а', search_text)
