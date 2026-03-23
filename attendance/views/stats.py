import calendar
import json  # <--- Вернули импорт
from datetime import datetime
from collections import defaultdict
from django.contrib.auth.decorators import login_required, user_passes_test
from django.db.models import Count
from django.shortcuts import render
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder  # <--- Вернули импорт

from database.models import ClassRoom, Student, AttendanceSummary, AbsentStudent
from school_attendance.settings import DEBUG
from ..utils import class_sort_key, parse_int_param
from ..services import school_calendar
from .auth import deny_substitute_access, is_deputy


RUSSIAN_MONTH_NAMES = [
    '',
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
]

RUSSIAN_WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']


def build_student_search_text(full_name: str, class_name: str) -> str:
    parts = [part.strip().lower() for part in (full_name or '').split() if part.strip()]
    variants = [full_name.lower(), class_name.lower()]

    if parts:
        initials = [part[0] for part in parts[1:3] if part]
        if initials:
            variants.append(f"{parts[0]} {' '.join(initials)}")
            variants.append(f"{parts[0]} {''.join(initials)}")
            variants.append(f"{parts[0]} {' '.join(f'{ch}.' for ch in initials)}")

    return ' '.join(variants)


@login_required
@deny_substitute_access
@user_passes_test(is_deputy)
def statistics(request):
    real_today = timezone.localdate()
    month = parse_int_param(request.GET.get('month'), real_today.month, min_value=1, max_value=12)
    year = parse_int_param(request.GET.get('year'), real_today.year, min_value=1970, max_value=2100)
    _, last_day_of_month = calendar.monthrange(year, month)
    current_day_of_month = min(real_today.day, last_day_of_month)
    available_test_days = school_calendar.get_working_day_numbers_in_month(year, month)

    requested_test_day = None
    if DEBUG:
        if request.GET.get('test_day'):
            requested_test_day = parse_int_param(
                request.GET.get('test_day'),
                0,
                min_value=1,
                max_value=last_day_of_month,
            )
        elif request.GET.get('test_date'):
            try:
                requested_test_day = datetime.strptime(
                    request.GET['test_date'],
                    '%Y-%m-%d',
                ).date().day
            except ValueError:
                requested_test_day = None

    selected_test_day = None
    if DEBUG:
        selected_test_day = school_calendar.resolve_working_day_number(
            year,
            month,
            requested_day=requested_test_day,
            fallback_day=current_day_of_month,
        )

    # 1. Базовые данные
    monthly_qs = AttendanceSummary.objects.filter(
        date__year=year, date__month=month
    ).select_related('class_room')

    days_map = defaultdict(list)
    for s in monthly_qs.order_by('-date'):
        days_map[s.date].append(s)

    for records in days_map.values():
        records.sort(key=lambda r: class_sort_key(r.class_room.name))

    ordered_days = sorted(days_map.items(), key=lambda x: x[0], reverse=True)

    # 2. Подсчет итогов по дням
    day_totals = {}
    day_reported_counts = {}
    for day, records in days_map.items():
        day_reported_counts[day] = len(records)
        total_present_auto = sum(r.present_count_auto for r in records)
        total_present_reported = sum(r.present_count_reported for r in records)
        total_unexcused = sum(r.unexcused_absent_count for r in records)
        total_orvi = sum(r.orvi_count for r in records)
        total_other_disease = sum(r.other_disease_count for r in records)
        total_family = sum(r.family_reason_count for r in records)
        day_totals[day] = {
            'total_present_auto': total_present_auto,
            'total_present_reported': total_present_reported,
            'total_unexcused': total_unexcused,
            'total_orvi': total_orvi,
            'total_other_disease': total_other_disease,
            'total_family': total_family,
            'total_listed': (
                total_present_reported
                + total_unexcused
                + total_orvi
                + total_other_disease
                + total_family
            ),
        }

    # 3. Льготники
    all_classes = sorted(ClassRoom.objects.all(), key=class_sort_key)
    priv_qs = Student.objects.filter(
        is_active=True, class_room__in=all_classes, privilege_types__isnull=False
    ).values('class_room_id', 'class_room__name', 'privilege_types__code').annotate(cnt=Count('id', distinct=True))

    by_class = {
        c.id: {'class_id': c.id, 'class_name': c.name, 'svo': 0, 'multi': 0, 'low_income': 0, 'disabled': 0, 'total': 0}
        for c in all_classes}
    for row in priv_qs:
        cid = row['class_room_id']
        ptype = row['privilege_types__code']
        if cid in by_class and ptype in ('svo', 'multi', 'low_income', 'disabled'):
            by_class[cid][ptype] = row['cnt'] or 0

    for r in by_class.values():
        r['total'] = r['svo'] + r['multi'] + r['low_income'] + r['disabled']

    privileged_types_by_class = list(by_class.values())
    privileged_types_totals = {
        'svo': sum(r['svo'] for r in privileged_types_by_class),
        'multi': sum(r['multi'] for r in privileged_types_by_class),
        'low_income': sum(r['low_income'] for r in privileged_types_by_class),
        'disabled': sum(r['disabled'] for r in privileged_types_by_class),
        'total': sum(r['total'] for r in privileged_types_by_class)
    }

    total_classes_count = ClassRoom.objects.all().count()
    active_students = list(
        Student.objects.filter(is_active=True).select_related('class_room')
    )
    active_students.sort(key=lambda student: (class_sort_key(student.class_room.name), (student.full_name or '').lower()))
    students_by_id = {student.id: student for student in active_students}

    selected_student_id = parse_int_param(request.GET.get('student_id'), 0, min_value=1)
    selected_student = students_by_id.get(selected_student_id)

    student_lookup = [
        {
            'id': student.id,
            'full_name': student.full_name,
            'class_name': student.class_room.name,
            'search_text': build_student_search_text(student.full_name, student.class_room.name),
        }
        for student in active_students
    ]

    # --- ГРАФИКИ ---
    month_days = school_calendar.get_working_days_in_month(year, month)
    reports_day_limit = school_calendar.count_working_days_up_to(
        year,
        month,
        selected_test_day if DEBUG else current_day_of_month,
    )

    working_qs = monthly_qs.filter(date__in=month_days) if month_days else monthly_qs.none()
    month_counts_by_class = {
        row['class_room_id']: row['cnt']
        for row in working_qs.values('class_room_id').annotate(cnt=Count('id'))
    }

    heatmap_rows = [
        {
            'class_name': c.name,
            'report_count': month_counts_by_class.get(c.id, 0),
        }
        for c in all_classes
    ]

    summary_map = defaultdict(dict)
    for s in monthly_qs:
        summary_map[s.class_room_id][s.date] = s

    selected_student_summary = None
    if selected_student:
        reason_labels = dict(AbsentStudent.Reason.choices)
        student_absence_map = {
            absence.attendance.date: absence
            for absence in AbsentStudent.objects.filter(
                student_id=selected_student.id,
                attendance__date__in=month_days,
            ).select_related('attendance')
        }

        summary_days = []
        absent_total = 0
        no_report_count = 0
        reason_totals = {
            AbsentStudent.Reason.UNEXCUSED: 0,
            AbsentStudent.Reason.ORVI: 0,
            AbsentStudent.Reason.OTHER_DISEASE: 0,
            AbsentStudent.Reason.FAMILY: 0,
        }

        class_summary_map = summary_map.get(selected_student.class_room_id, {})

        for day in month_days:
            summary = class_summary_map.get(day)
            absence = student_absence_map.get(day)

            if not summary:
                no_report_count += 1
                summary_days.append({
                    'date': day,
                    'weekday_short': RUSSIAN_WEEKDAY_SHORT[day.weekday()],
                    'status_code': 'no_report',
                    'status_label': 'Нет отчета класса',
                    'status_tone': 'muted',
                    'status_note': 'За этот день класс не сдал дневную статистику.',
                })
                continue

            if absence:
                absent_total += 1
                reason_totals[absence.reason] += 1
                summary_days.append({
                    'date': day,
                    'weekday_short': RUSSIAN_WEEKDAY_SHORT[day.weekday()],
                    'status_code': absence.reason,
                    'status_label': reason_labels.get(absence.reason, 'Отсутствовал'),
                    'status_tone': absence.reason,
                    'status_note': f'Причина: {reason_labels.get(absence.reason, "не указана")}.',
                })
                continue

            summary_days.append({
                'date': day,
                'weekday_short': RUSSIAN_WEEKDAY_SHORT[day.weekday()],
                'status_code': 'present',
                'status_label': 'Присутствовал',
                'status_tone': 'success',
                'status_note': 'В отчете класса ученик отмечен присутствующим.',
            })

        selected_student_summary = {
            'student': selected_student,
            'month_label': f'{RUSSIAN_MONTH_NAMES[month].capitalize()} {year}',
            'absent_total': absent_total,
            'unexcused_total': reason_totals[AbsentStudent.Reason.UNEXCUSED],
            'orvi_total': reason_totals[AbsentStudent.Reason.ORVI],
            'other_family_total': (
                reason_totals[AbsentStudent.Reason.OTHER_DISEASE]
                + reason_totals[AbsentStudent.Reason.FAMILY]
            ),
            'no_report_count': no_report_count,
            'days': summary_days,
        }

    heatmap_series = []
    for c in all_classes:
        data_points = []
        for d in month_days:
            s = summary_map[c.id].get(d)
            val = -1  # -1 = отчет не сдан (серый в heatmap)
            counts = None  # Детализация для тултипа

            if s:
                present = s.present_count_reported
                unex = s.unexcused_absent_count
                orvi = s.orvi_count
                other = s.other_disease_count
                fam = s.family_reason_count

                total_absent = unex + orvi + other + fam
                total = present + total_absent

                if total > 0:
                    val = round((present / total) * 100, 1)
                    # Собираем реальные числа только для сданного отчета
                    counts = {
                        'p': present,  # Пришло
                        'u': unex,  # Неуважительные
                        'o': orvi,  # ОРВИ
                        'd': other,  # Другие болезни
                        'f': fam  # Семейные
                    }

            # Добавляем объект counts внутрь точки данных
            data_points.append({
                'x': d.strftime('%d.%m'),
                'y': val,
                'counts': counts
            })

        heatmap_series.append({'name': c.name, 'data': data_points})

    # Timeline (здесь тоже можно добавить детализацию, если нужно)
    timeline_series = []
    for d in month_days:
        t = day_totals.get(d)
        val = None
        counts = None
        if t:
            present = t['total_present_reported']
            unex = t['total_unexcused']
            orvi = t['total_orvi']
            other = t['total_other_disease']
            fam = t['total_family']

            total_absent = unex + orvi + other + fam
            total = present + total_absent

            if total > 0: val = round((present / total) * 100, 1)

            counts = {
                'p': present, 'u': unex, 'o': orvi, 'd': other, 'f': fam
            }

        timeline_series.append({
            'x': d.strftime('%d.%m'),
            'y': val,
            'counts': counts
        })

    raw_chart_data = {
        'heatmap': heatmap_series,
        'timeline': [{'name': 'Среднее по школе', 'data': timeline_series}]
    }

    context = {
        'ordered_days': ordered_days,
        'day_totals': day_totals,
        'day_reported_counts': day_reported_counts,
        'total_classes_count': total_classes_count,
        'month': month,
        'year': year,
        'debug_mode': DEBUG,
        'available_test_days': available_test_days,
        'selected_test_day': selected_test_day,
        'student_lookup_json': json.dumps(student_lookup, cls=DjangoJSONEncoder),
        'selected_student': selected_student,
        'selected_student_summary': selected_student_summary,
        'privileged_types_by_class': privileged_types_by_class,
        'privileged_types_totals': privileged_types_totals,
        'heatmap_rows': heatmap_rows,
        'reports_day_limit': reports_day_limit,

        # ✅ Передаем ГОТОВУЮ JSON-строку
        'chart_data_json': json.dumps(raw_chart_data, cls=DjangoJSONEncoder),
    }
    return render(request, 'attendance/statistics.html', context)
