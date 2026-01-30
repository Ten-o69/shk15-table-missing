import calendar
import json  # <--- Вернули импорт
from collections import defaultdict
from django.contrib.auth.decorators import login_required, user_passes_test
from django.db.models import Sum, Count
from django.shortcuts import render
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder  # <--- Вернули импорт

from database.models import ClassRoom, Student, AttendanceSummary, AbsentStudent
from ..utils import class_sort_key, parse_int_param
from ..services import school_calendar
from .auth import deny_substitute_access, is_deputy


@login_required
@deny_substitute_access
@user_passes_test(is_deputy)
def statistics(request):
    today = timezone.localdate()
    month = parse_int_param(request.GET.get('month'), today.month, min_value=1, max_value=12)
    year = parse_int_param(request.GET.get('year'), today.year, min_value=1970, max_value=2100)

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

    # 3. Сводка по классам
    monthly_by_class = list(monthly_qs.values(
        'class_room__id', 'class_room__name'
    ).annotate(
        total_present_auto=Sum('present_count_auto'),
        total_present_reported=Sum('present_count_reported'),
        total_unexcused=Sum('unexcused_absent_count'),
        total_orvi=Sum('orvi_count'),
        total_other_disease=Sum('other_disease_count'),
        total_family=Sum('family_reason_count'),
    ))
    monthly_by_class.sort(key=lambda r: class_sort_key(r['class_room__name']))

    # 4. По ученикам
    absences_qs = AbsentStudent.objects.filter(
        attendance__date__year=year,
        attendance__date__month=month,
        reason=AbsentStudent.Reason.UNEXCUSED,
    ).select_related('student', 'attendance__class_room')

    per_student = list(absences_qs.values(
        'student__id', 'student__full_name', 'student__class_room__name'
    ).annotate(absence_count=Count('id')))
    per_student.sort(key=lambda r: (r['student__full_name'] or '').lower())
    per_student.sort(key=lambda r: class_sort_key(r['student__class_room__name']))

    # 5. Льготники
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
    total_students_count = Student.objects.filter(is_active=True).count()

    # --- ГРАФИКИ ---
    month_days = school_calendar.get_working_days_in_month(year, month)

    summary_map = defaultdict(dict)
    for s in monthly_qs:
        summary_map[s.class_room_id][s.date] = s

    heatmap_series = []
    for c in all_classes:
        data_points = []
        for d in month_days:
            s = summary_map[c.id].get(d)
            val = None  # Процент для цвета
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
                else:
                    val = 0

                # Собираем реальные числа
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
        'total_students_count': total_students_count,
        'monthly_by_class': monthly_by_class,
        'per_student': per_student,
        'month': month,
        'year': year,
        'privileged_types_by_class': privileged_types_by_class,
        'privileged_types_totals': privileged_types_totals,

        # ✅ Передаем ГОТОВУЮ JSON-строку
        'chart_data_json': json.dumps(raw_chart_data, cls=DjangoJSONEncoder),
    }
    return render(request, 'attendance/statistics.html', context)
