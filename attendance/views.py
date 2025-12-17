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
    - Завуч имеет доступ к странице статистики, учитель — нет (это контролируется группами)
    - данные всегда за текущий день (по Москве)
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
    )

    total_students_all_classes = sum(c.student_count for c in classes)

    if request.method == 'POST':
        row_count = int(request.POST.get('row_count', 0))

        for i in range(row_count):
            class_id = request.POST.get(f'class_{i}')
            if not class_id:
                continue

            try:
                class_room = ClassRoom.objects.get(id=class_id)
            except ClassRoom.DoesNotExist:
                continue

            # ввод только один раз в день
            if AttendanceSummary.objects.filter(
                class_room=class_room,
                date=today
            ).exists():
                continue

            reported_present_raw = request.POST.get(f'reported_present_{i}', '').strip()
            unexcused_absent_raw = request.POST.get(f'unexcused_absent_{i}', '').strip()

            # списки учеников (идут по id класса, а не индексу)
            unexcused_students_raw = request.POST.get(f'absent_students_{class_id}', '').strip()
            all_absent_students_raw = request.POST.get(f'all_absent_students_{class_id}', '').strip()

            # если вообще ничего не ввели по классу — пропускаем
            if (not reported_present_raw
                    and not unexcused_absent_raw
                    and not unexcused_students_raw
                    and not all_absent_students_raw):
                continue

            # парсим количество и списки
            reported_present = int(reported_present_raw or 0)

            # список неуважительных (id учеников)
            unexcused_ids = set()
            if unexcused_students_raw:
                for part in unexcused_students_raw.split(','):
                    part = part.strip()
                    if part:
                        try:
                            unexcused_ids.add(int(part))
                        except ValueError:
                            pass

            # список всех отсутствующих (id учеников)
            all_absent_ids = set()
            if all_absent_students_raw:
                for part in all_absent_students_raw.split(','):
                    part = part.strip()
                    if part:
                        try:
                            all_absent_ids.add(int(part))
                        except ValueError:
                            pass

            # число неуважительных по факту считаем по списку, а не по числу из инпута
            unexcused_absent = len(unexcused_ids)

            # СЕРВЕРНАЯ валидация (на случай, если фронт не сработал)
            # 1) если есть неуважительные, то их количество должно совпадать с числом из поля
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

            # 2) если есть неуважительные, то все они должны входить в список "все отсутствующие"
            if unexcused_ids:
                if not all_absent_ids or not unexcused_ids.issubset(all_absent_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: список всех отсутствующих должен включать всех с неуважительной причиной.'
                    )
                    return redirect('index')

            present_auto = class_room.student_count

            summary = AttendanceSummary.objects.create(
                class_room=class_room,
                date=today,
                present_count_auto=present_auto,
                present_count_reported=reported_present,
                unexcused_absent_count=unexcused_absent,
                created_by=user,
            )

            # создаём записи об отсутствующих учениках
            # если all_absent_ids пустой, но есть неуважительные — считаем,
            # что отсутствуют только они
            if not all_absent_ids and unexcused_ids:
                all_absent_ids = set(unexcused_ids)

            for sid in all_absent_ids:
                try:
                    student = Student.objects.get(id=sid, class_room=class_room)
                except Student.DoesNotExist:
                    continue

                reason = (
                    AbsentStudent.Reason.UNEXCUSED
                    if sid in unexcused_ids
                    else AbsentStudent.Reason.EXCUSED
                )

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
    - статистика по ученикам за месяц
    """
    today = timezone.localdate()

    # можно передавать month/year через GET, но по умолчанию текущий месяц
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

    # итоги по каждому дню (как на главной, только по дню)
    day_totals = {}
    for day, records in days_map.items():
        total_present_auto = sum(r.present_count_auto for r in records)
        total_present_reported = sum(r.present_count_reported for r in records)
        total_unexcused = sum(r.unexcused_absent_count for r in records)
        day_totals[day] = {
            'total_present_auto': total_present_auto,
            'total_present_reported': total_present_reported,
            'total_unexcused': total_unexcused,
        }

    # сводка по классам за месяц
    monthly_by_class = monthly_qs.values(
        'class_room__id',
        'class_room__name'
    ).annotate(
        total_present_auto=Sum('present_count_auto'),
        total_present_reported=Sum('present_count_reported'),
        total_unexcused=Sum('unexcused_absent_count'),
    ).order_by('class_room__name')

    # статистика по ученикам: сколько раз не пришёл в этом месяце
    absences_qs = AbsentStudent.objects.filter(
        attendance__date__year=year,
        attendance__date__month=month,
        reason=AbsentStudent.Reason.UNEXCUSED,  # считаем только неуважительные
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
