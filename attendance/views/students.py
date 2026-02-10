from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Q, Prefetch, Case, When, IntegerField
from django.shortcuts import render, redirect

from database.models import ClassRoom, Student, PrivilegeType
from ..utils import class_sort_key
from .auth import deny_substitute_access


@login_required
@deny_substitute_access
def manage_students(request):
    user = request.user
    user_is_deputy = user.groups.filter(name='Завуч').exists()
    user_is_teacher = user.groups.filter(name='Учитель').exists()

    if user_is_deputy or user.is_superuser:
        allowed_classes = sorted(ClassRoom.objects.all(), key=class_sort_key)
    else:
        allowed_classes = sorted(ClassRoom.objects.filter(staff=user), key=class_sort_key)

    q = (request.GET.get('q') or '').strip()
    class_id = (request.GET.get('class_id') or '').strip()
    show_inactive = (request.GET.get('show_inactive') or '').strip() == '1'
    sort = (request.GET.get('sort') or 'class_asc').strip()

    privilege_type_order = Case(
        When(code=Student.PrivilegeType.SVO, then=0),
        When(code=Student.PrivilegeType.MULTI, then=1),
        When(code=Student.PrivilegeType.LOW_INCOME, then=2),
        When(code=Student.PrivilegeType.DISABLED, then=3),
        default=99, output_field=IntegerField(),
    )
    privilege_types_prefetch = Prefetch('privilege_types',
                                        queryset=PrivilegeType.objects.order_by(privilege_type_order, 'code'))
    students = Student.objects.select_related('class_room').prefetch_related(privilege_types_prefetch).filter(
        class_room__in=allowed_classes)

    if not show_inactive: students = students.filter(is_active=True)
    if class_id.isdigit(): students = students.filter(class_room_id=int(class_id))
    if q: students = students.filter(Q(full_name__icontains=q) | Q(class_room__name__icontains=q))

    valid_sorts = {'class_asc', 'class_desc', 'name_asc', 'name_desc'}
    if sort not in valid_sorts: sort = 'class_asc'
    students = list(students)

    def student_name_key(item):
        return (item.full_name or '').lower()

    if sort == 'class_asc':
        students.sort(key=student_name_key)
        students.sort(key=lambda item: class_sort_key(item.class_room))
    elif sort == 'class_desc':
        students.sort(key=student_name_key)
        students.sort(key=lambda item: class_sort_key(item.class_room), reverse=True)
    elif sort == 'name_asc':
        students.sort(key=lambda item: class_sort_key(item.class_room))
        students.sort(key=student_name_key)
    else:
        students.sort(key=lambda item: class_sort_key(item.class_room))
        students.sort(key=student_name_key, reverse=True)

    if request.method == 'POST':
        allowed_types = set(Student.PrivilegeType.values)
        for code in [c for c in Student.PrivilegeType.values if not PrivilegeType.objects.filter(code=c).exists()]:
            PrivilegeType.objects.create(code=code)

        action = (request.POST.get('action') or '').strip()
        ids = [int(x) for x in request.POST.getlist('student_ids') if str(x).isdigit()]
        one_id = request.POST.get('student_id')
        one_id = int(one_id) if (one_id and str(one_id).isdigit()) else None

        allowed_class_ids = [c.id for c in allowed_classes]

        def qs_allowed_students(qs):
            return qs.filter(class_room__in=allowed_classes)

        def qs_allowed_classes(qs):
            return qs.filter(id__in=allowed_class_ids)

        if action == 'add_student':
            if not user_is_deputy:
                messages.error(request, 'Доступ ограничен: только для завуча.')
                return redirect(request.get_full_path())

            full_name = (request.POST.get('full_name') or '').strip()
            class_id_raw = (request.POST.get('class_id') or '').strip()

            if not full_name:
                messages.error(request, 'Укажите ФИО ученика.')
                return redirect(request.get_full_path())
            if not class_id_raw.isdigit():
                messages.error(request, 'Выберите класс.')
                return redirect(request.get_full_path())

            class_id_val = int(class_id_raw)
            class_room = qs_allowed_classes(ClassRoom.objects).filter(id=class_id_val).first()
            if not class_room:
                messages.error(request, 'Класс не найден или нет доступа.')
                return redirect(request.get_full_path())

            try:
                Student.objects.create(
                    full_name=full_name,
                    class_room=class_room,
                    is_active=True,
                )
                messages.success(request, f'Добавлен ученик: {full_name}')
            except Exception:
                messages.error(request, 'Не удалось добавить. Проверьте, что в классе нет ученика с таким ФИО.')
            return redirect(request.get_full_path())

        if action == 'update_student_class':
            if not user_is_deputy:
                messages.error(request, 'Доступ ограничен: только для завуча.')
                return redirect(request.get_full_path())

            student_id_raw = (request.POST.get('student_id') or '').strip()
            class_id_raw = (request.POST.get('class_id') or '').strip()

            if not (student_id_raw.isdigit() and class_id_raw.isdigit()):
                messages.error(request, 'Некорректные данные для обновления класса.')
                return redirect(request.get_full_path())

            student = qs_allowed_students(Student.objects).filter(id=int(student_id_raw)).first()
            if not student:
                messages.error(request, 'Ученик не найден или нет доступа.')
                return redirect(request.get_full_path())

            class_room = qs_allowed_classes(ClassRoom.objects).filter(id=int(class_id_raw)).first()
            if not class_room:
                messages.error(request, 'Класс не найден или нет доступа.')
                return redirect(request.get_full_path())

            student.class_room = class_room
            student.is_active = True
            try:
                student.save(update_fields=['class_room', 'is_active'])
                messages.success(request, f'Класс обновлен: {student.full_name}')
            except Exception:
                messages.error(request, 'Не удалось обновить класс.')
            return redirect(request.get_full_path())

        if action == 'toggle_privileged' and one_id:
            try:
                s = qs_allowed_students(Student.objects).get(id=one_id)
            except Student.DoesNotExist:
                messages.error(request, 'Ученик не найден или нет доступа.')
                return redirect(request.get_full_path())
            s.is_privileged = bool(request.POST.get('is_privileged'))
            if not s.is_privileged: s.privilege_types.clear()
            s.save(update_fields=['is_privileged'])
            messages.success(request, f'Обновлено: {s.full_name}')
            return redirect(request.get_full_path())

        if action == 'set_privilege_type' and one_id:
            try:
                s = qs_allowed_students(Student.objects).get(id=one_id)
            except Student.DoesNotExist:
                messages.error(request, 'Ученик не найден или нет доступа.')
                return redirect(request.get_full_path())

            raw = (request.POST.get('privilege_types') or request.POST.get('privilege_type') or '').strip()
            ptypes = list(dict.fromkeys([t.strip() for t in raw.split(',') if t.strip()]))

            if not ptypes:
                s.privilege_types.clear()
                s.is_privileged = False
                s.save(update_fields=['is_privileged'])
                messages.success(request, f'Льгота снята: {s.full_name}')
            else:
                selected_types = list(PrivilegeType.objects.filter(code__in=ptypes))
                if len(selected_types) != len(ptypes) or any(t not in allowed_types for t in ptypes):
                    messages.error(request, 'Некорректный тип льготы.')
                else:
                    s.privilege_types.set(selected_types)
                    s.is_privileged = True
                    s.save(update_fields=['is_privileged'])
                    messages.success(request, f'Обновлено: {s.full_name}')
            return redirect(request.get_full_path())

        if action in ('priv_on', 'priv_off', 'priv_svo', 'priv_multi', 'priv_low_income', 'priv_disabled', 'delete',
                      'restore') and ids:
            qs = qs_allowed_students(Student.objects.filter(id__in=ids))
            qs_ids = list(qs.values_list('id', flat=True))

            if action == 'priv_on':
                qs.update(is_privileged=True)
            elif action == 'priv_off':
                Student.privilege_types.through.objects.filter(student_id__in=qs_ids).delete()
                qs.update(is_privileged=False)
            elif action.startswith('priv_'):
                code = {'priv_svo': 'svo', 'priv_multi': 'multi', 'priv_low_income': 'low_income',
                        'priv_disabled': 'disabled'}[action]
                ptype = PrivilegeType.objects.filter(code=code).first()
                if ptype:
                    for s in qs: s.privilege_types.add(ptype)
                    qs.update(is_privileged=True)
            elif action == 'delete':
                qs.update(is_active=False)
            elif action == 'restore':
                qs.update(is_active=True)

            messages.success(request, 'Действие выполнено.')
            return redirect(request.get_full_path())

        messages.error(request, 'Не выбрано действие или ученики.')
        return redirect(request.get_full_path())

    class_options = [{'id': c.id, 'name': c.name} for c in allowed_classes]
    context = {'classes': allowed_classes, 'students': students, 'q': q, 'class_id': class_id,
               'show_inactive': show_inactive, 'sort': sort, 'is_deputy': user_is_deputy,
               'is_teacher': user_is_teacher, 'class_options': class_options}
    return render(request, 'attendance/manage_students.html', context)
