from collections import defaultdict
from datetime import datetime

from django.contrib import messages
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.views import LoginView, LogoutView
from django.db.models import Sum, Count
from django.shortcuts import render, redirect
from django.utils import timezone

from database.models import ClassRoom, Student, AttendanceSummary, AbsentStudent
from school_attendance.settings import DEBUG


def is_deputy(user):
    return user.is_authenticated and user.groups.filter(name='Завуч').exists()


class UserLoginView(LoginView):
    template_name = 'attendance/login.html'


class UserLogoutView(LogoutView):
    pass


@login_required
def index(request):
    """
    Главная страница:
    - показывает таблицу только по тем классам, которые закреплены за пользователем (ClassRoom.staff)
    - Завуч/Учитель определяются по группам
    - данные всегда за текущий день (с учётом test_date в DEBUG)
    """
    if request.GET.get('test_date') and DEBUG:
        try:
            today = datetime.strptime(request.GET['test_date'], '%Y-%m-%d').date()
        except ValueError:
            today = timezone.localdate()
    else:
        today = timezone.localdate()

    user = request.user
    user_is_deputy = user.groups.filter(name='Завуч').exists()
    user_is_teacher = user.groups.filter(name='Учитель').exists()

    if user_is_deputy or user_is_teacher:
        classes = ClassRoom.objects.filter(staff=user).order_by('name')
    else:
        classes = ClassRoom.objects.none()

    summaries = AttendanceSummary.objects.filter(
        date=today,
        class_room__in=classes
    ).select_related('class_room')

    summary_by_class = {s.class_room_id: s for s in summaries}

    totals_saved = summaries.aggregate(
        total_present_reported=Sum('present_count_reported'),
        total_unexcused=Sum('unexcused_absent_count'),
        total_orvi=Sum('orvi_count'),
        total_other_disease=Sum('other_disease_count'),
        total_family=Sum('family_reason_count'),
    )

    total_students_all_classes = sum(c.student_count for c in classes)

    if request.method == 'POST':
        row_count = int(request.POST.get('row_count', 0))

        def parse_int(value):
            try:
                return int((value or '').strip() or 0)
            except (TypeError, ValueError):
                return 0

        def parse_ids(raw):
            ids = set()
            if not raw:
                return ids
            for part in raw.split(','):
                part = part.strip()
                if not part:
                    continue
                try:
                    ids.add(int(part))
                except ValueError:
                    continue
            return ids

        for i in range(row_count):
            class_id = request.POST.get(f'class_{i}')
            if not class_id:
                continue

            try:
                class_room = ClassRoom.objects.get(id=class_id)
            except ClassRoom.DoesNotExist:
                continue

            # уже есть запись за сегодня — не даём перезаписать
            if AttendanceSummary.objects.filter(
                class_room=class_room,
                date=today
            ).exists():
                continue

            # числовые поля
            reported_present_raw = request.POST.get(f'reported_present_{i}', '').strip()
            unexcused_absent_raw = request.POST.get(f'unexcused_absent_{i}', '').strip()
            orvi_raw = request.POST.get(f'orvi_{i}', '').strip()
            other_disease_raw = request.POST.get(f'other_disease_{i}', '').strip()
            family_raw = request.POST.get(f'family_{i}', '').strip()

            # скрытые поля со списками учеников (по id класса)
            unexcused_students_raw = request.POST.get(f'absent_students_{class_id}', '').strip()
            all_absent_students_raw = request.POST.get(f'all_absent_students_{class_id}', '').strip()
            orvi_students_raw = request.POST.get(f'orvi_students_{class_id}', '').strip()
            other_students_raw = request.POST.get(f'other_students_{class_id}', '').strip()
            family_students_raw = request.POST.get(f'family_students_{class_id}', '').strip()

            # если по классу вообще ничего не введено — пропускаем
            if (
                not reported_present_raw
                and not unexcused_absent_raw
                and not orvi_raw
                and not other_disease_raw
                and not family_raw
                and not unexcused_students_raw
                and not all_absent_students_raw
                and not orvi_students_raw
                and not other_students_raw
                and not family_students_raw
            ):
                continue

            # числа
            reported_present = parse_int(reported_present_raw)
            orvi_count = parse_int(orvi_raw)
            other_disease_count = parse_int(other_disease_raw)
            family_reason_count = parse_int(family_raw)

            # списки id по видам причин
            unexcused_ids = parse_ids(unexcused_students_raw)
            orvi_ids = parse_ids(orvi_students_raw)
            other_ids = parse_ids(other_students_raw)
            family_ids = parse_ids(family_students_raw)

            all_absent_ids = parse_ids(all_absent_students_raw)

            # реальное число неуважительных = длина списка
            unexcused_absent = len(unexcused_ids)

            # --- СЕРВЕРНАЯ ВАЛИДАЦИЯ ---

            # 1) числа по каждому виду должны совпадать с кол-вом фамилий

            if unexcused_absent_raw:
                try:
                    typed_unexcused = int(unexcused_absent_raw)
                except ValueError:
                    typed_unexcused = None
                if typed_unexcused is None or typed_unexcused != unexcused_absent:
                    messages.error(
                        request,
                        f'Класс {class_room.name}: число неуважительных не совпадает со списком учеников.'
                    )
                    return redirect('index')

            if orvi_raw:
                try:
                    typed_orvi = int(orvi_raw)
                except ValueError:
                    typed_orvi = None
                if typed_orvi is None or typed_orvi != len(orvi_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: число ОРВИ не совпадает со списком учеников.'
                    )
                    return redirect('index')

            if other_disease_raw:
                try:
                    typed_other = int(other_disease_raw)
                except ValueError:
                    typed_other = None
                if typed_other is None or typed_other != len(other_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: число по другим заболеваниям не совпадает со списком учеников.'
                    )
                    return redirect('index')

            if family_raw:
                try:
                    typed_family = int(family_raw)
                except ValueError:
                    typed_family = None
                if typed_family is None or typed_family != len(family_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: число по семейным обстоятельствам не совпадает со списком учеников.'
                    )
                    return redirect('index')

            # 2) "все отсутствующие" должны содержать всех из конкретных списков
            reason_ids_union = unexcused_ids | orvi_ids | other_ids | family_ids

            if reason_ids_union:
                if not all_absent_ids:
                    # если пользователь вообще не трогал "все отсутствующие" —
                    # просто проставим туда union
                    all_absent_ids = set(reason_ids_union)
                elif not reason_ids_union.issubset(all_absent_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: список всех отсутствующих должен включать всех учеников из частных списков причин.'
                    )
                    return redirect('index')
            # если reason_ids_union пуст, но all_absent_ids есть — считаем их неуважительными
            if not reason_ids_union and all_absent_ids:
                unexcused_ids = set(all_absent_ids)
                unexcused_absent = len(unexcused_ids)

            present_auto = class_room.student_count

            total_absent_count = (
                unexcused_absent +
                orvi_count +
                other_disease_count +
                family_reason_count
            )

            if present_auto and total_absent_count > present_auto:
                messages.error(
                    request,
                    f'Класс {class_room.name}: суммарное число отсутствующих больше, чем учеников по списку.'
                )
                return redirect('index')

            if present_auto:
                present_reported = max(0, present_auto - total_absent_count)
            else:
                # fallback, если не задано число по списку
                present_reported = reported_present

            # создаём сводку
            summary = AttendanceSummary.objects.create(
                class_room=class_room,
                date=today,
                present_count_auto=present_auto,
                present_count_reported=present_reported,
                unexcused_absent_count=unexcused_absent,
                orvi_count=orvi_count,
                other_disease_count=other_disease_count,
                family_reason_count=family_reason_count,
                created_by=user,
            )

            # если по какой-то причине all_absent_ids всё ещё пуст, но есть конкретные причины —
            # берём union
            if not all_absent_ids:
                all_absent_ids = reason_ids_union

            # создаём записи AbsentStudent с нормальными причинами
            for sid in all_absent_ids:
                try:
                    student = Student.objects.get(id=sid, class_room=class_room)
                except Student.DoesNotExist:
                    continue

                if sid in unexcused_ids:
                    reason = AbsentStudent.Reason.UNEXCUSED
                elif sid in orvi_ids:
                    reason = AbsentStudent.Reason.ORVI
                elif sid in other_ids:
                    reason = AbsentStudent.Reason.OTHER_DISEASE
                elif sid in family_ids:
                    reason = AbsentStudent.Reason.FAMILY
                else:
                    # кто-то в "все отсутствующие", но без конкретной причины — игнорируем
                    continue

                AbsentStudent.objects.create(
                    attendance=summary,
                    student=student,
                    reason=reason,
                )

        messages.success(request, 'Данные за сегодня сохранены (там, где их ещё не было).')
        return redirect('index')

    students_by_class = {
        c.id: list(c.students.filter(is_active=True).order_by('full_name'))
        for c in classes
    }

    context = {
        'today': today,
        'classes': classes,
        'summary_by_class': summary_by_class,
        'totals_saved': totals_saved,
        'total_students_all_classes': total_students_all_classes,
        'students_by_class': students_by_class,
    }
    return render(request, 'attendance/index.html', context)


@login_required
@user_passes_test(is_deputy)
def statistics(request):
    """
    Страница статистики (доступна только завучу):
    - таблицы по дням
    - сводная статистика за месяц по классам
    - статистика по ученикам за месяц (по неуважительным)
    """
    today = timezone.localdate()

    month = int(request.GET.get('month', today.month))
    year = int(request.GET.get('year', today.year))

    monthly_qs = AttendanceSummary.objects.filter(
        date__year=year,
        date__month=month
    ).select_related('class_room')

    # группировка по дням
    days_map = defaultdict(list)
    for s in monthly_qs.order_by('-date', 'class_room__name'):
        days_map[s.date].append(s)

    ordered_days = sorted(days_map.items(), key=lambda x: x[0], reverse=True)

    # итоги по каждому дню
    day_totals = {}
    for day, records in days_map.items():
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
        }

    # сводка по классам за месяц
    monthly_by_class = monthly_qs.values(
        'class_room__id',
        'class_room__name'
    ).annotate(
        total_present_auto=Sum('present_count_auto'),
        total_present_reported=Sum('present_count_reported'),
        total_unexcused=Sum('unexcused_absent_count'),
        total_orvi=Sum('orvi_count'),
        total_other_disease=Sum('other_disease_count'),
        total_family=Sum('family_reason_count'),
    ).order_by('class_room__name')

    # статистика по ученикам: сколько раз не пришёл (НЕУВАЖИТЕЛЬНЫЕ) в этом месяце
    absences_qs = AbsentStudent.objects.filter(
        attendance__date__year=year,
        attendance__date__month=month,
        reason=AbsentStudent.Reason.UNEXCUSED,
    ).select_related('student', 'attendance__class_room')

    per_student = absences_qs.values(
        'student__id',
        'student__full_name',
        'student__class_room__name'
    ).annotate(
        absence_count=Count('id')
    ).order_by('student__class_room__name', 'student__full_name')

    context = {
        'ordered_days': ordered_days,
        'day_totals': day_totals,
        'monthly_by_class': monthly_by_class,
        'per_student': per_student,
        'month': month,
        'year': year,
    }
    return render(request, 'attendance/statistics.html', context)
