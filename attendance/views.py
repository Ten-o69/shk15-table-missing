from collections import defaultdict
from functools import wraps

from django.contrib import messages
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.views import LoginView, LogoutView
from django.contrib.auth import login as auth_login
from django.db.models import Sum, Count, Q, Prefetch, Case, When, IntegerField
from django.shortcuts import render, redirect
from django.utils import timezone

from database.models import (
    ClassRoom,
    Student,
    PrivilegeType,
    AttendanceSummary,
    AbsentStudent,
    SubstituteAccessToken,
)
from school_attendance.settings import DEBUG
from datetime import datetime, timedelta


def deny_substitute_access(view_func):
    """
    Запрещает доступ к view, если пользователь вошёл по токену замены.
    """
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if request.session.get('substitute_as'):
            messages.error(request, 'Доступ ограничен: вы вошли как заменяющий по токену.')
            return redirect('index')
        return view_func(request, *args, **kwargs)
    return _wrapped


def is_deputy(user):
    return user.is_authenticated and user.groups.filter(name='Завуч').exists()


class UserLoginView(LoginView):
    template_name = 'attendance/login.html'

    def form_valid(self, form):
        resp = super().form_valid(form)
        self.request.session.pop('substitute_as', None)
        self.request.session.pop('substitute_class_id', None)
        self.request.session.pop('substitute_token_id', None)
        return resp


class UserLogoutView(LogoutView):
    pass


@login_required
def index(request):
    """
    Главная страница:
    - показывает таблицу только по тем классам, которые закреплены за пользователем (ClassRoom.staff)
    - Завуч/Учитель определяются по группам
    - данные всегда за текущий день (с учётом test_date в DEBUG)
    - ✅ после сохранения можно нажать "Изменить" 30 минут от момента СОЗДАНИЯ записи
    - ✅ в причинах отсутствия один ученик может быть только в ОДНОМ столбце (unexcused/orvi/other/family)
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

    is_substitute = bool(request.session.get('substitute_as'))
    substitute_class_id = request.session.get('substitute_class_id')

    if is_substitute and substitute_class_id:
        # ✅ заменяющий видит только класс, на который выдан токен
        classes = ClassRoom.objects.filter(id=substitute_class_id).order_by('name')

        # ✅ режем права: никакого "завуча" даже если аккаунт в группе
        user_is_deputy = False
        # teacher можно оставить True для бейджа/меню, но лучше явно показывать режим замены в base.html
        user_is_teacher = True
    else:
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

    # ✅ режим редактирования по одному классу
    edit_class_id = request.GET.get('edit_class')
    if edit_class_id and str(edit_class_id).isdigit():
        edit_class_id = int(edit_class_id)
    else:
        edit_class_id = None

    # ✅ дедлайны редактирования от created_at
    now_dt = timezone.now()
    edit_deadline_by_class = {}
    can_edit_by_class = {}

    for s in summaries:
        deadline = s.created_at + timedelta(hours=5)
        edit_deadline_by_class[s.class_room_id] = deadline
        can_edit_by_class[s.class_room_id] = now_dt <= deadline

    # если пользователь открыл edit_class, но окно уже закрыто — сбрасываем
    if edit_class_id:
        if edit_class_id not in summary_by_class:
            edit_class_id = None
        else:
            if not can_edit_by_class.get(edit_class_id, False):
                messages.error(request, 'Окно редактирования (30 минут) уже закрыто.')
                edit_class_id = None

    # ===== helpers =====
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

    def validate_no_duplicates_between_reasons(class_room, unexcused_ids, orvi_ids, other_ids, family_ids):
        # ✅ один ученик = только одна причина
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
            # покажем 1-2 айди, чтобы понимать что случилось (без спама)
            example_ids = sorted(list(bad[0][1]))[:3]
            messages.error(
                request,
                f'Класс {class_room.name}: один и тот же ученик не может быть в двух причинах. '
                f'Найдены повторы ({bad[0][0]}), пример ID: {example_ids}'
            )
            return False
        return True

    # ===== POST =====
    if request.method == 'POST':
        row_count = int(request.POST.get('row_count', 0))

        edit_class_post = request.POST.get('edit_class')  # hidden input
        if edit_class_post and str(edit_class_post).isdigit():
            edit_class_post = int(edit_class_post)
        else:
            edit_class_post = None

        for i in range(row_count):
            class_id = request.POST.get(f'class_{i}')
            if not class_id or not str(class_id).isdigit():
                continue
            class_id = int(class_id)

            # если редактируем — обрабатываем только один класс
            if edit_class_post and class_id != edit_class_post:
                continue

            try:
                class_room = ClassRoom.objects.get(id=class_id)
            except ClassRoom.DoesNotExist:
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

            # ✅ серверная валидация: запрет повторов между столбцами причин
            if not validate_no_duplicates_between_reasons(class_room, unexcused_ids, orvi_ids,
                                                          other_ids, family_ids):
                return redirect('index')

            # реальное число неуважительных = длина списка
            unexcused_absent = len(unexcused_ids)

            # 1) числа по каждому виду должны совпадать с кол-вом фамилий
            if unexcused_absent_raw:
                try:
                    typed_unexcused = int(unexcused_absent_raw)
                except ValueError:
                    typed_unexcused = None
                if typed_unexcused is None or typed_unexcused != unexcused_absent:
                    messages.error(request, f'Класс {class_room.name}: число '
                                            f'неуважительных не совпадает со списком учеников.')
                    return redirect('index')

            if orvi_raw:
                try:
                    typed_orvi = int(orvi_raw)
                except ValueError:
                    typed_orvi = None
                if typed_orvi is None or typed_orvi != len(orvi_ids):
                    messages.error(request, f'Класс {class_room.name}: число '
                                            f'ОРВИ не совпадает со списком учеников.')
                    return redirect('index')

            if other_disease_raw:
                try:
                    typed_other = int(other_disease_raw)
                except ValueError:
                    typed_other = None
                if typed_other is None or typed_other != len(other_ids):
                    messages.error(request, f'Класс {class_room.name}: число по '
                                            f'другим заболеваниям не совпадает со списком учеников.')
                    return redirect('index')

            if family_raw:
                try:
                    typed_family = int(family_raw)
                except ValueError:
                    typed_family = None
                if typed_family is None or typed_family != len(family_ids):
                    messages.error(request, f'Класс {class_room.name}: число '
                                            f'по семейным обстоятельствам не совпадает со списком учеников.')
                    return redirect('index')

            # 2) all должен включать union причин
            reason_ids_union = unexcused_ids | orvi_ids | other_ids | family_ids

            if reason_ids_union:
                if not all_absent_ids:
                    all_absent_ids = set(reason_ids_union)
                elif not reason_ids_union.issubset(all_absent_ids):
                    messages.error(
                        request,
                        f'Класс {class_room.name}: список всех отсутствующих '
                        f'должен включать всех учеников из частных списков причин.'
                    )
                    return redirect('index')

            # если reason_ids_union пуст, но all_absent_ids есть — считаем их неуважительными (старое поведение)
            if not reason_ids_union and all_absent_ids:
                unexcused_ids = set(all_absent_ids)
                unexcused_absent = len(unexcused_ids)

            present_auto = class_room.student_count
            total_absent_count = unexcused_absent + orvi_count + other_disease_count + family_reason_count

            if present_auto and total_absent_count > present_auto:
                messages.error(request, f'Класс {class_room.name}: суммарное число '
                                        f'отсутствующих больше, чем учеников по списку.')
                return redirect('index')

            if present_auto:
                present_reported = max(0, present_auto - total_absent_count)
            else:
                present_reported = reported_present

            # ===== CREATE or UPDATE =====
            existing = AttendanceSummary.objects.filter(class_room=class_room, date=today).first()

            if existing:
                # ✅ редактирование только в окне 30 минут от created_at
                deadline = existing.created_at + timedelta(minutes=30)
                if timezone.now() > deadline:
                    messages.error(request, f'Класс {class_room.name}: окно редактирования закрыто.')
                    return redirect('index')

                # ✅ обновляем summary (created_at НЕ трогаем)
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

                # ✅ полностью пересобираем отсутствующих
                AbsentStudent.objects.filter(attendance=existing).delete()

                summary_obj = existing
            else:
                summary_obj = AttendanceSummary.objects.create(
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

            # если по какой-то причине all_absent_ids пуст, но есть причины — берём union
            if not all_absent_ids:
                all_absent_ids = reason_ids_union

            # создаём записи AbsentStudent
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
                    # в all, но без причины — игнорируем (как и раньше)
                    continue

                AbsentStudent.objects.create(
                    attendance=summary_obj,
                    student=student,
                    reason=reason,
                )

        if edit_class_post:
            messages.success(request, 'Изменения сохранены.')
        else:
            messages.success(request, 'Данные за сегодня сохранены (там, где их ещё не было).')

        return redirect('index')

    # ===== CONTEXT DATA =====
    students_by_class = {
        c.id: list(c.students.filter(is_active=True).order_by('full_name'))
        for c in classes
    }

    # === ЛЬГОТНИКИ: по классам + "сейчас в школе" (по отсутствующим за сегодня) ===
    privileged_qs = Student.objects.filter(
        class_room__in=classes,
        is_active=True
    ).filter(
        Q(privilege_types__isnull=False) | Q(is_privileged=True)
    ).distinct().select_related('class_room').order_by('class_room__name', 'full_name')

    priv_students_by_class = defaultdict(list)
    privileged_total_by_class = defaultdict(int)

    for s in privileged_qs:
        priv_students_by_class[s.class_room_id].append(s)
        privileged_total_by_class[s.class_room_id] += 1

    absent_priv_qs = AbsentStudent.objects.filter(
        attendance__date=today,
        attendance__class_room__in=classes,
        student__is_active=True
    ).filter(
        Q(student__privilege_types__isnull=False) | Q(student__is_privileged=True)
    ).distinct().values_list('attendance__class_room_id', 'student_id')

    absent_priv_ids_by_class = defaultdict(set)
    for class_id, student_id in absent_priv_qs:
        absent_priv_ids_by_class[class_id].add(student_id)

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

    # ✅ ids по причинам (для заполнения hidden при edit)
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
        all_absent_ids_by_class[s.class_room_id] = ','.join(
            str(a.student_id) for a in absents)

    context = {
        'today': today,
        'classes': classes,
        'summary_by_class': summary_by_class,
        'totals_saved': totals_saved,
        'total_students_all_classes': total_students_all_classes,
        'students_by_class': students_by_class,

        # ✅ edit режим
        'edit_class_id': edit_class_id,
        'edit_deadline_by_class': edit_deadline_by_class,
        'can_edit_by_class': can_edit_by_class,

        # ✅ ids по причинам для edit
        'unexcused_ids_by_class': unexcused_ids_by_class,
        'orvi_ids_by_class': orvi_ids_by_class,
        'other_ids_by_class': other_ids_by_class,
        'family_ids_by_class': family_ids_by_class,
        'all_absent_ids_by_class': all_absent_ids_by_class,

        # ✅ льготники
        'privileged_total_by_class': dict(privileged_total_by_class),
        'privileged_present_by_class': privileged_present_by_class,
        'privileged_present_count_by_class': dict(privileged_present_count_by_class),
        'total_privileged_all': total_privileged_all,
        'total_privileged_present_all': total_privileged_present_all,

        # ✅ чтобы base.html корректно показывал бейджи/меню
        'is_deputy': user_is_deputy,
        'is_teacher': user_is_teacher,

        'is_substitute': is_substitute,
    }
    return render(request, 'attendance/index.html', context)


@login_required
@deny_substitute_access
@user_passes_test(is_deputy)
def statistics(request):
    today = timezone.localdate()

    month = int(request.GET.get('month', today.month))
    year = int(request.GET.get('year', today.year))

    monthly_qs = AttendanceSummary.objects.filter(
        date__year=year,
        date__month=month
    ).select_related('class_room')

    days_map = defaultdict(list)
    for s in monthly_qs.order_by('-date', 'class_room__name'):
        days_map[s.date].append(s)

    ordered_days = sorted(days_map.items(), key=lambda x: x[0], reverse=True)

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

    # ===== ЛЬГОТНИКИ ПО ТИПАМ (по классам) =====
    all_classes = ClassRoom.objects.all().order_by('name')

    # считаем только активных
    priv_qs = Student.objects.filter(
        is_active=True,
        class_room__in=all_classes,
        privilege_types__isnull=False,
    ).values(
        'class_room_id',
        'class_room__name',
        'privilege_types__code',
    ).annotate(cnt=Count('id', distinct=True))

    by_class = {}
    for c in all_classes:
        by_class[c.id] = {
            'class_id': c.id,
            'class_name': c.name,
            'svo': 0,
            'multi': 0,
            'low_income': 0,
            'disabled': 0,
            'total': 0,
        }

    for row in priv_qs:
        cid = row['class_room_id']
        ptype = row['privilege_types__code']
        cnt = row['cnt'] or 0
        if cid not in by_class:
            continue
        if ptype in ('svo', 'multi', 'low_income', 'disabled'):
            by_class[cid][ptype] = cnt

    # totals per class
    for cid, r in by_class.items():
        r['total'] = r['svo'] + r['multi'] + r['low_income'] + r['disabled']

    privileged_types_by_class = list(by_class.values())
    privileged_types_totals = {
        'svo': sum(r['svo'] for r in privileged_types_by_class),
        'multi': sum(r['multi'] for r in privileged_types_by_class),
        'low_income': sum(r['low_income'] for r in privileged_types_by_class),
        'disabled': sum(r['disabled'] for r in privileged_types_by_class),
    }
    privileged_types_totals['total'] = sum(r['total'] for r in privileged_types_by_class)

    context = {
        'ordered_days': ordered_days,
        'day_totals': day_totals,
        'monthly_by_class': monthly_by_class,
        'per_student': per_student,
        'month': month,
        'year': year,
        'privileged_types_by_class': privileged_types_by_class,
        'privileged_types_totals': privileged_types_totals,
    }
    return render(request, 'attendance/statistics.html', context)


@login_required
@deny_substitute_access
def manage_students(request):
    user = request.user
    user_is_deputy = user.groups.filter(name='Завуч').exists()
    user_is_teacher = user.groups.filter(name='Учитель').exists()

    if user_is_deputy or user.is_superuser:
        allowed_classes = ClassRoom.objects.all().order_by('name')
    else:
        allowed_classes = ClassRoom.objects.filter(staff=user).order_by('name')

    q = (request.GET.get('q') or '').strip()
    class_id = (request.GET.get('class_id') or '').strip()
    show_inactive = (request.GET.get('show_inactive') or '').strip() == '1'
    sort = (request.GET.get('sort') or 'class_asc').strip()

    privilege_type_order = Case(
        When(code=Student.PrivilegeType.SVO, then=0),
        When(code=Student.PrivilegeType.MULTI, then=1),
        When(code=Student.PrivilegeType.LOW_INCOME, then=2),
        When(code=Student.PrivilegeType.DISABLED, then=3),
        default=99,
        output_field=IntegerField(),
    )
    privilege_types_prefetch = Prefetch(
        'privilege_types',
        queryset=PrivilegeType.objects.order_by(privilege_type_order, 'code'),
    )
    students = Student.objects.select_related('class_room').prefetch_related(
        privilege_types_prefetch
    ).filter(class_room__in=allowed_classes)

    if not show_inactive:
        students = students.filter(is_active=True)

    if class_id.isdigit():
        students = students.filter(class_room_id=int(class_id))

    if q:
        students = students.filter(
            Q(full_name__icontains=q) |
            Q(class_room__name__icontains=q)
        )

    sort_map = {
        'class_asc':  ('class_room__name', 'full_name'),
        'class_desc': ('-class_room__name', 'full_name'),
        'name_asc':   ('full_name', 'class_room__name'),
        'name_desc':  ('-full_name', 'class_room__name'),
    }
    order_fields = sort_map.get(sort, sort_map['class_asc'])
    students = students.order_by(*order_fields)

    if request.method == 'POST':
        allowed_types = set(Student.PrivilegeType.values)

        action = (request.POST.get('action') or '').strip()

        ids = request.POST.getlist('student_ids')
        ids = [int(x) for x in ids if str(x).isdigit()]

        one_id = request.POST.get('student_id')
        one_id = int(one_id) if (one_id and str(one_id).isdigit()) else None

        def qs_allowed(qs):
            return qs.filter(class_room__in=allowed_classes)

        if action == 'toggle_privileged' and one_id:
            try:
                s = qs_allowed(Student.objects).get(id=one_id)
            except Student.DoesNotExist:
                messages.error(request, 'Ученик не найден или нет доступа.')
                return redirect(request.get_full_path())

            s.is_privileged = bool(request.POST.get('is_privileged'))
            if not s.is_privileged:
                s.privilege_types.clear()
            s.save(update_fields=['is_privileged'])
            messages.success(request, f'Обновлено: {s.full_name}')
            return redirect(request.get_full_path())

        if action == 'set_privilege_type' and one_id:
            try:
                s = qs_allowed(Student.objects).get(id=one_id)
            except Student.DoesNotExist:
                messages.error(request, 'Ученик не найден или нет доступа.')
                return redirect(request.get_full_path())

            raw_types = (
                request.POST.get('privilege_types')
                or request.POST.get('privilege_type')
                or ''
            ).strip()
            ptypes = [t.strip() for t in raw_types.split(',') if t.strip()]
            ptypes = list(dict.fromkeys(ptypes))

            # снять льготу
            if not ptypes:
                s.privilege_types.clear()
                s.is_privileged = False
                s.save(update_fields=['is_privileged'])
                messages.success(request, f'Льгота снята: {s.full_name}')
                return redirect(request.get_full_path())

            # назначить типы
            invalid = [t for t in ptypes if t not in allowed_types]
            if invalid:
                messages.error(request, 'Некорректный тип льготы.')
                return redirect(request.get_full_path())

            selected_types = list(PrivilegeType.objects.filter(code__in=ptypes))
            if len(selected_types) != len(set(ptypes)):
                messages.error(request, 'Некорректный тип льготы.')
                return redirect(request.get_full_path())

            s.privilege_types.set(selected_types)
            s.is_privileged = True
            s.save(update_fields=['is_privileged'])
            ordered_codes = [c for c in Student.PrivilegeType.values if c in set(ptypes)]
            labels = ', '.join(Student.PrivilegeType(code).label for code in ordered_codes)
            messages.success(request, f'Обновлено: {s.full_name} — {labels}')
            return redirect(request.get_full_path())

        if action in (
                'priv_on', 'priv_off',
                'priv_svo', 'priv_multi', 'priv_low_income', 'priv_disabled',
                'delete', 'restore'
        ) and ids:
            qs = qs_allowed(Student.objects.filter(id__in=ids))
            qs_ids = list(qs.values_list('id', flat=True))

            if action == 'priv_on':
                # старое поведение: просто льготник без типа
                qs.update(is_privileged=True)
                messages.success(request, f'Отмечено льготниками: {qs.count()}')

            elif action == 'priv_off':
                Student.privilege_types.through.objects.filter(student_id__in=qs_ids).delete()
                qs.update(is_privileged=False)
                messages.success(request, f'Льгота снята: {qs.count()}')

            elif action == 'priv_svo':
                ptype = PrivilegeType.objects.filter(code=Student.PrivilegeType.SVO).first()
                if not ptype:
                    messages.error(request, 'Некорректный тип льготы.')
                    return redirect(request.get_full_path())
                for s in qs:
                    s.privilege_types.add(ptype)
                qs.update(is_privileged=True)
                messages.success(request, f'Добавлено (СВО): {qs.count()}')

            elif action == 'priv_multi':
                ptype = PrivilegeType.objects.filter(code=Student.PrivilegeType.MULTI).first()
                if not ptype:
                    messages.error(request, 'Некорректный тип льготы.')
                    return redirect(request.get_full_path())
                for s in qs:
                    s.privilege_types.add(ptype)
                qs.update(is_privileged=True)
                messages.success(request, f'Добавлено (Многодетные): {qs.count()}')

            elif action == 'priv_low_income':
                ptype = PrivilegeType.objects.filter(code=Student.PrivilegeType.LOW_INCOME).first()
                if not ptype:
                    messages.error(request, 'Некорректный тип льготы.')
                    return redirect(request.get_full_path())
                for s in qs:
                    s.privilege_types.add(ptype)
                qs.update(is_privileged=True)
                messages.success(request, f'Добавлено (Малоимущие): {qs.count()}')

            elif action == 'priv_disabled':
                ptype = PrivilegeType.objects.filter(code=Student.PrivilegeType.DISABLED).first()
                if not ptype:
                    messages.error(request, 'Некорректный тип льготы.')
                    return redirect(request.get_full_path())
                for s in qs:
                    s.privilege_types.add(ptype)
                qs.update(is_privileged=True)
                messages.success(request, f'Добавлено (ОВЗ): {qs.count()}')

            elif action == 'delete':
                qs.update(is_active=False)
                messages.success(request, f'Удалено (деактивировано): {qs.count()}')

            elif action == 'restore':
                qs.update(is_active=True)
                messages.success(request, f'Восстановлено: {qs.count()}')

            return redirect(request.get_full_path())

        messages.error(request, 'Не выбрано действие или ученики.')
        return redirect(request.get_full_path())

    context = {
        'classes': allowed_classes,
        'students': students,
        'q': q,
        'class_id': class_id,
        'show_inactive': show_inactive,
        'sort': sort,
        'is_deputy': user_is_deputy,
        'is_teacher': user_is_teacher,
    }
    return render(request, 'attendance/manage_students.html', context)


def substitute_login(request):
    """
    Вход по токену замены:
    - вводится только токен
    - логиним как классного руководителя (class_room.teacher)
    - ограничиваем доступ одним классом (session substitute_class_id)
    """
    if request.method == 'POST':
        raw = (request.POST.get('token') or '').strip()

        if not raw:
            return render(request, 'attendance/substitute_login.html',
                          {'error': 'Введите токен.'})

        token_hash = SubstituteAccessToken.hash_token(raw)
        tok = SubstituteAccessToken.objects.select_related('class_room', 'class_room__teacher').filter(
            token_hash=token_hash
        ).first()

        if not tok or not tok.is_active:
            return render(request, 'attendance/substitute_login.html',
                          {'error': 'Токен не найден, истёк или отозван.'})

        teacher = tok.target_user
        if not teacher or not teacher.is_active:
            return render(request, 'attendance/substitute_login.html',
                          {'error': 'У класса не задан активный классный руководитель.'})

        # логиним как классного руководителя
        auth_login(request, teacher)

        # запоминаем, что это вход по токену (и ограничиваем одним классом)
        request.session['substitute_as'] = True
        request.session['substitute_class_id'] = tok.class_room_id
        request.session['substitute_token_id'] = tok.id

        # жёстко ограничим сессию оставшимся временем токена
        remaining = int((tok.expires_at - timezone.now()).total_seconds())
        if remaining > 0:
            request.session.set_expiry(remaining)

        tok.last_used_at = timezone.now()
        tok.save(update_fields=['last_used_at'])

        messages.success(request, f'Вход выполнен. Режим замены: {tok.class_room.name}.')
        return redirect('index')

    return render(request, 'attendance/substitute_login.html')


@login_required
@deny_substitute_access
@user_passes_test(is_deputy)
def substitute_tokens(request):
    classes = ClassRoom.objects.select_related('teacher').order_by('name')

    def ttl_from_post(post):
        # значения из модалки
        sec = int(post.get('ttl_sec') or 0)
        minute = int(post.get('ttl_min') or 0)
        hour = int(post.get('ttl_hour') or 0)
        day = int(post.get('ttl_day') or 0)
        week = int(post.get('ttl_week') or 0)

        total = sec + minute * 60 + hour * 3600 + day * 86400 + week * 604800
        return total

    if request.method == 'POST':
        action = (request.POST.get('action') or '').strip()

        # --- delete (полное удаление) ---
        if action == "delete":
            tid = request.POST.get("token_id") or request.POST.get("id")
            if not (tid and str(tid).isdigit()):
                messages.error(request, "Некорректный token_id.")
                return redirect(request.path)

            tok = SubstituteAccessToken.objects.filter(id=int(tid)).first()
            if not tok:
                messages.error(request, "Токен не найден.")
                return redirect(request.path)

            tok.delete()
            messages.success(request, "Токен удалён.")
            return redirect(request.path)

        # --- revoke ---
        if action == 'revoke':
            tid = request.POST.get('token_id')
            if tid and str(tid).isdigit():
                tok = SubstituteAccessToken.objects.filter(id=int(tid)).first()
                if tok and tok.revoked_at is None:
                    tok.revoked_at = timezone.now()
                    tok.save(update_fields=['revoked_at'])
                    messages.success(request, 'Токен отозван.')
                else:
                    messages.error(request, 'Токен не найден или уже отозван.')
            else:
                messages.error(request, 'Некорректный токен.')
            return redirect(request.path)

        # --- recreate (ROTATE token in the SAME row) ---
        if action == 'recreate':
            tid = request.POST.get('token_id')
            if not (tid and str(tid).isdigit()):
                messages.error(request, 'Некорректный токен.')
                return redirect(request.path)

            tok = SubstituteAccessToken.objects.select_related(
                'class_room', 'class_room__teacher'
            ).filter(id=int(tid)).first()

            if not tok:
                messages.error(request, 'Токен не найден.')
                return redirect(request.path)

            if not tok.class_room.teacher or not tok.class_room.teacher.is_active:
                messages.error(request, 'У класса не задан активный классный руководитель.')
                return redirect(request.path)

            # генерим новый токен
            raw = SubstituteAccessToken.generate_raw_token()
            h = SubstituteAccessToken.hash_token(raw)

            now = timezone.now()

            tok.token_hash = h
            tok.revoked_at = None
            tok.issued_by = request.user
            tok.expires_at = now + timedelta(seconds=tok.ttl_seconds)

            # чтобы было видно обновление "сейчас"
            tok.created_at = now

            tok.save(update_fields=[
                'token_hash',
                'revoked_at',
                'issued_by',
                'expires_at',
                'created_at',
            ])

            # ✅ показываем токен после редиректа (один раз)
            request.session["created_token"] = raw

            messages.success(
                request,
                f'Токен пересоздан для {tok.class_room.name}. '
                f'Скопируйте код ниже — он показывается один раз!'
            )
            return redirect(request.path)

        # --- create ---
        if action == 'create':
            class_id = request.POST.get('class_id')
            if not (class_id and str(class_id).isdigit()):
                messages.error(request, 'Выберите класс.')
                return redirect(request.path)

            ttl_seconds = ttl_from_post(request.POST)

            if ttl_seconds < 30:
                messages.error(request, 'Минимальная длительность — 30 секунд.')
                return redirect(request.path)

            if ttl_seconds > 14 * 24 * 3600:
                messages.error(request, 'Максимальная длительность — 2 недели.')
                return redirect(request.path)

            class_room = ClassRoom.objects.select_related('teacher').filter(id=int(class_id)).first()
            if not class_room:
                messages.error(request, 'Класс не найден.')
                return redirect(request.path)

            if not class_room.teacher or not class_room.teacher.is_active:
                messages.error(request, 'У класса не задан активный классный руководитель.')
                return redirect(request.path)

            raw = SubstituteAccessToken.generate_raw_token()
            h = SubstituteAccessToken.hash_token(raw)

            now = timezone.now()
            SubstituteAccessToken.objects.create(
                class_room=class_room,
                issued_by=request.user,
                token_hash=h,
                ttl_seconds=ttl_seconds,
                expires_at=now + timedelta(seconds=ttl_seconds),
            )

            # ✅ показываем токен после редиректа (один раз)
            request.session["created_token"] = raw

            messages.success(
                request,
                f'Токен создан для {class_room.name}. Скопируйте код ниже — он показывается один раз!'
            )
            return redirect(request.path)

        # неизвестное действие
        messages.error(request, 'Неизвестное действие.')
        return redirect(request.path)

    # ===== GET =====
    # ✅ достаем токен один раз после редиректа
    created_token = request.session.pop("created_token", None)

    tokens = SubstituteAccessToken.objects.select_related(
        'class_room', 'issued_by', 'class_room__teacher'
    ).order_by('-created_at')[:200]

    context = {
        'classes': classes,
        'tokens': tokens,
        'created_token': created_token,
        'is_deputy': True,
        'is_teacher': request.user.groups.filter(name='Учитель').exists(),
    }
    return render(request, 'attendance/substitute_tokens.html', context)
