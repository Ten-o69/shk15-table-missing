from collections import defaultdict
from datetime import datetime, timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum, Q
from django.shortcuts import render, redirect
from django.utils import timezone

from database.models import ClassRoom, Student, AttendanceSummary, AbsentStudent
from school_attendance.settings import DEBUG
from ..utils import class_sort_key
from ..services import school_calendar  # ✅ Import calendar service


@login_required
def index(request):
    """
    Главная страница:
    - показывает таблицу только по тем классам, которые закреплены за пользователем
    - обработка POST запроса на сохранение посещаемости
    - ⛔️ Блокирует сохранение в выходные/праздники
    """
    if request.GET.get('test_date') and DEBUG:
        try:
            today = datetime.strptime(request.GET['test_date'], '%Y-%m-%d').date()
        except ValueError:
            today = timezone.localdate()
    else:
        today = timezone.localdate()

    # ✅ Проверка: рабочий ли сегодня день?
    is_work_day = school_calendar.is_school_day(today)

    user = request.user
    user_is_deputy = user.groups.filter(name='Завуч').exists()
    user_is_teacher = user.groups.filter(name='Учитель').exists()

    is_substitute = bool(request.session.get('substitute_as'))
    substitute_class_id = request.session.get('substitute_class_id')

    if is_substitute and substitute_class_id:
        classes = ClassRoom.objects.filter(id=substitute_class_id)
        user_is_deputy = False
        user_is_teacher = True
    else:
        if user_is_deputy or user_is_teacher:
            classes = ClassRoom.objects.filter(staff=user)
        else:
            classes = ClassRoom.objects.none()

    classes = sorted(classes, key=class_sort_key)

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

    # Режим редактирования
    edit_class_id = request.GET.get('edit_class')
    if edit_class_id and str(edit_class_id).isdigit():
        edit_class_id = int(edit_class_id)
    else:
        edit_class_id = None

    now_dt = timezone.now()
    edit_deadline_by_class = {}
    can_edit_by_class = {}

    for s in summaries:
        deadline = s.created_at + timedelta(minutes=30)
        edit_deadline_by_class[s.class_room_id] = deadline
        can_edit_by_class[s.class_room_id] = now_dt <= deadline

    if edit_class_id:
        if edit_class_id not in summary_by_class:
            edit_class_id = None
        else:
            if not can_edit_by_class.get(edit_class_id, False):
                messages.error(request, 'Окно редактирования (30 минут) уже закрыто.')
                edit_class_id = None

    # ===== helpers (внутренние функции оставлены здесь для локальности) =====
    def parse_int(value):
        try:
            return int((value or '').strip() or 0)
        except (TypeError, ValueError):
            return 0

    def parse_ids(raw):
        ids = set()
        if not raw: return ids
        for part in raw.split(','):
            part = part.strip()
            if not part: continue
            try:
                ids.add(int(part))
            except ValueError:
                continue
        return ids

    def validate_no_duplicates_between_reasons(class_room, unexcused_ids, orvi_ids, other_ids, family_ids):
        intersections = [
            ('Неуважительные + ОРВИ', unexcused_ids & orvi_ids),
            ('Неуважительные + Другие заболевания', unexcused_ids & other_ids),
            ('Неуважительные + Семейные', unexcused_ids & family_ids),
            ('ОРВИ + Другие заболевания', orvi_ids & other_ids),
            ('ОРВИ + Семейные', orvi_ids & family_ids),
            ('Другие заболевания + Семейные', other_ids & family_ids),
        ]
        bad = [(name, ids) for name, ids in intersections if ids]
        if bad:
            example_ids = sorted(list(bad[0][1]))[:3]
            messages.error(
                request,
                f'Класс {class_room.name}: один и тот же ученик не может быть в двух причинах. '
                f'Найдены повторы ({bad[0][0]}), пример ID: {example_ids}'
            )
            return False
        return True

    # ===== POST Handling =====
    if request.method == 'POST':
        # ✅ Блокировка сохранения в выходной/праздничный день
        if not is_work_day:
            messages.error(request, 'Сегодня выходной или праздничный день. Заполнение посещаемости закрыто.')
            return redirect('index')

        row_count = int(request.POST.get('row_count', 0))
        edit_class_post = request.POST.get('edit_class')
        edit_class_post = int(edit_class_post) if (edit_class_post and str(edit_class_post).isdigit()) else None

        for i in range(row_count):
            class_id = request.POST.get(f'class_{i}')
            if not class_id or not str(class_id).isdigit(): continue
            class_id = int(class_id)

            if edit_class_post and class_id != edit_class_post: continue

            try:
                class_room = ClassRoom.objects.get(id=class_id)
            except ClassRoom.DoesNotExist:
                continue

            reported_present_raw = request.POST.get(f'reported_present_{i}', '').strip()
            unexcused_absent_raw = request.POST.get(f'unexcused_absent_{i}', '').strip()
            orvi_raw = request.POST.get(f'orvi_{i}', '').strip()
            other_disease_raw = request.POST.get(f'other_disease_{i}', '').strip()
            family_raw = request.POST.get(f'family_{i}', '').strip()

            unexcused_students_raw = request.POST.get(f'absent_students_{class_id}', '').strip()
            all_absent_students_raw = request.POST.get(f'all_absent_students_{class_id}', '').strip()
            orvi_students_raw = request.POST.get(f'orvi_students_{class_id}', '').strip()
            other_students_raw = request.POST.get(f'other_students_{class_id}', '').strip()
            family_students_raw = request.POST.get(f'family_students_{class_id}', '').strip()

            if not any([reported_present_raw, unexcused_absent_raw, orvi_raw, other_disease_raw, family_raw,
                        unexcused_students_raw, all_absent_students_raw, orvi_students_raw, other_students_raw,
                        family_students_raw]):
                continue

            reported_present = parse_int(reported_present_raw)
            orvi_count = parse_int(orvi_raw)
            other_disease_count = parse_int(other_disease_raw)
            family_reason_count = parse_int(family_raw)

            unexcused_ids = parse_ids(unexcused_students_raw)
            orvi_ids = parse_ids(orvi_students_raw)
            other_ids = parse_ids(other_students_raw)
            family_ids = parse_ids(family_students_raw)
            all_absent_ids = parse_ids(all_absent_students_raw)

            if not validate_no_duplicates_between_reasons(class_room, unexcused_ids, orvi_ids, other_ids, family_ids):
                return redirect('index')

            unexcused_absent = len(unexcused_ids)

            # Валидация чисел
            if unexcused_absent_raw and parse_int(unexcused_absent_raw) != unexcused_absent:
                messages.error(request, f'Класс {class_room.name}: число неуважительных не совпадает со списком.')
                return redirect('index')
            if orvi_raw and parse_int(orvi_raw) != len(orvi_ids):
                messages.error(request, f'Класс {class_room.name}: число ОРВИ не совпадает со списком.')
                return redirect('index')
            if other_disease_raw and parse_int(other_disease_raw) != len(other_ids):
                messages.error(request, f'Класс {class_room.name}: число "Другие" не совпадает со списком.')
                return redirect('index')
            if family_raw and parse_int(family_raw) != len(family_ids):
                messages.error(request, f'Класс {class_room.name}: число "Семейные" не совпадает со списком.')
                return redirect('index')

            reason_ids_union = unexcused_ids | orvi_ids | other_ids | family_ids
            if reason_ids_union:
                if not all_absent_ids:
                    all_absent_ids = set(reason_ids_union)
                elif not reason_ids_union.issubset(all_absent_ids):
                    messages.error(request, f'Класс {class_room.name}: общий список должен включать все причины.')
                    return redirect('index')

            if not reason_ids_union and all_absent_ids:
                unexcused_ids = set(all_absent_ids)
                unexcused_absent = len(unexcused_ids)

            present_auto = class_room.student_count
            total_absent_count = unexcused_absent + orvi_count + other_disease_count + family_reason_count

            if present_auto and total_absent_count > present_auto:
                messages.error(request, f'Класс {class_room.name}: отсутствующих больше, чем учеников.')
                return redirect('index')

            present_reported = max(0, present_auto - total_absent_count) if present_auto else reported_present

            # Сохранение
            existing = AttendanceSummary.objects.filter(class_room=class_room, date=today).first()
            if existing:
                if timezone.now() > (existing.created_at + timedelta(minutes=30)):
                    messages.error(request, f'Класс {class_room.name}: окно редактирования закрыто.')
                    return redirect('index')

                existing.present_count_auto = present_auto
                existing.present_count_reported = present_reported
                existing.unexcused_absent_count = unexcused_absent
                existing.orvi_count = orvi_count
                existing.other_disease_count = other_disease_count
                existing.family_reason_count = family_reason_count
                existing.created_by = user
                existing.save(update_fields=[
                    'present_count_auto',
                    'present_count_reported',
                    'unexcused_absent_count',
                    'orvi_count',
                    'other_disease_count',
                    'family_reason_count',
                    'created_by',
                ])

                AbsentStudent.objects.filter(attendance=existing).delete()
                summary_obj = existing
            else:
                summary_obj = AttendanceSummary.objects.create(
                    class_room=class_room, date=today, present_count_auto=present_auto,
                    present_count_reported=present_reported, unexcused_absent_count=unexcused_absent,
                    orvi_count=orvi_count, other_disease_count=other_disease_count,
                    family_reason_count=family_reason_count, created_by=user
                )

            if not all_absent_ids:
                all_absent_ids = reason_ids_union

            for sid in all_absent_ids:
                try:
                    student = Student.objects.get(id=sid, class_room=class_room)
                except Student.DoesNotExist:
                    continue

                reason = AbsentStudent.Reason.UNEXCUSED
                if sid in orvi_ids:
                    reason = AbsentStudent.Reason.ORVI
                elif sid in other_ids:
                    reason = AbsentStudent.Reason.OTHER_DISEASE
                elif sid in family_ids:
                    reason = AbsentStudent.Reason.FAMILY

                AbsentStudent.objects.create(attendance=summary_obj, student=student, reason=reason)

        messages.success(request, 'Изменения сохранены.' if edit_class_post else 'Данные за сегодня сохранены.')
        return redirect('index')

    # ===== GET Context Prep =====
    students_by_class = {c.id: list(c.students.filter(is_active=True).order_by('full_name')) for c in classes}

    privileged_qs = Student.objects.filter(class_room__in=classes, is_active=True).filter(
        Q(privilege_types__isnull=False) | Q(is_privileged=True)
    ).distinct().select_related('class_room').order_by('class_room__name', 'full_name')

    priv_students_by_class = defaultdict(list)
    privileged_total_by_class = defaultdict(int)
    for s in privileged_qs:
        priv_students_by_class[s.class_room_id].append(s)
        privileged_total_by_class[s.class_room_id] += 1

    absent_priv_qs = AbsentStudent.objects.filter(
        attendance__date=today, attendance__class_room__in=classes, student__is_active=True
    ).filter(
        Q(student__privilege_types__isnull=False) | Q(student__is_privileged=True)
    ).distinct().values_list('attendance__class_room_id', 'student_id')

    absent_priv_ids_by_class = defaultdict(set)
    for cid, sid in absent_priv_qs:
        absent_priv_ids_by_class[cid].add(sid)

    privileged_present_by_class = {}
    privileged_present_count_by_class = {}
    for c in classes:
        all_priv = priv_students_by_class.get(c.id, [])
        absent_ids = absent_priv_ids_by_class.get(c.id, set())
        present_names = [s.full_name for s in all_priv if s.id not in absent_ids]
        present_names.sort(key=lambda x: x.lower())
        privileged_present_by_class[c.id] = present_names
        privileged_present_count_by_class[c.id] = len(present_names)

    total_privileged_all = sum(privileged_total_by_class.get(c.id, 0) for c in classes)
    total_privileged_present_all = sum(privileged_present_count_by_class.get(c.id, 0) for c in classes)

    # Ids for hidden inputs
    unexcused_ids_by_class = {}
    orvi_ids_by_class = {}
    other_ids_by_class = {}
    family_ids_by_class = {}
    all_absent_ids_by_class = {}

    for s in summaries:
        absents = list(s.absent_students.select_related('student').all())
        unexcused_ids_by_class[s.class_room_id] = ','.join(
            str(a.student_id) for a in absents if a.reason == AbsentStudent.Reason.UNEXCUSED)
        orvi_ids_by_class[s.class_room_id] = ','.join(
            str(a.student_id) for a in absents if a.reason == AbsentStudent.Reason.ORVI)
        other_ids_by_class[s.class_room_id] = ','.join(
            str(a.student_id) for a in absents if a.reason == AbsentStudent.Reason.OTHER_DISEASE)
        family_ids_by_class[s.class_room_id] = ','.join(
            str(a.student_id) for a in absents if a.reason == AbsentStudent.Reason.FAMILY)
        all_absent_ids_by_class[s.class_room_id] = ','.join(str(a.student_id) for a in absents)

    context = {
        'today': today,
        # ✅ Передаем флаг в шаблон
        'is_work_day': is_work_day,

        'classes': classes,
        'summary_by_class': summary_by_class,
        'totals_saved': totals_saved,
        'total_students_all_classes': total_students_all_classes,
        'students_by_class': students_by_class,
        'edit_class_id': edit_class_id,
        'edit_deadline_by_class': edit_deadline_by_class,
        'can_edit_by_class': can_edit_by_class,
        'unexcused_ids_by_class': unexcused_ids_by_class,
        'orvi_ids_by_class': orvi_ids_by_class,
        'other_ids_by_class': other_ids_by_class,
        'family_ids_by_class': family_ids_by_class,
        'all_absent_ids_by_class': all_absent_ids_by_class,
        'privileged_total_by_class': dict(privileged_total_by_class),
        'privileged_present_by_class': privileged_present_by_class,
        'privileged_present_count_by_class': dict(privileged_present_count_by_class),
        'total_privileged_all': total_privileged_all,
        'total_privileged_present_all': total_privileged_present_all,
        'is_deputy': user_is_deputy,
        'is_teacher': user_is_teacher,
        'is_substitute': is_substitute,
    }
    return render(request, 'attendance/index.html', context)
