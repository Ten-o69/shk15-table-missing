from datetime import timedelta
import random

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User, Group
from django.utils import timezone

from attendance.services import school_calendar
from database.models import (
    AbsentStudent,
    AttendanceSummary,
    ClassRoom,
    PrivilegeType,
    Student,
)


class Command(BaseCommand):
    help = (
        "Создает группы, тестовых пользователей, классы, учеников и тестовые данные посещаемости"
    )

    def add_arguments(self, parser):
        parser.add_argument("--classes", type=int, default=18, help="Количество классов")
        parser.add_argument(
            "--students-per-class", type=int, default=24, help="Учеников на класс"
        )
        parser.add_argument(
            "--days",
            type=int,
            default=15,
            help="Сколько последних учебных дней заполнять",
        )
        parser.add_argument(
            "--seed", type=int, default=42, help="Seed для стабильности данных"
        )

    def handle(self, *args, **options):
        classes_count = max(1, int(options["classes"]))
        students_per_class = max(1, int(options["students_per_class"]))
        days = max(1, int(options["days"]))
        seed = int(options["seed"])

        random.seed(seed)

        # Группы
        teacher_group, _ = Group.objects.get_or_create(name="Учитель")
        deputy_group, _ = Group.objects.get_or_create(name="Завуч")

        # Пользователи
        teachers = []
        for i in range(1, 7):
            username = f"teacher{i}"
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"first_name": f"Учитель{i}", "last_name": "Демо"},
            )
            if created:
                user.set_password(username)
                user.save(update_fields=["password"])
                self.stdout.write(f"Создан учитель: {username} / {username}")
            user.groups.add(teacher_group)
            teachers.append(user)

        deputies = []
        for i in range(1, 3):
            username = f"deputy{i}"
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"first_name": f"Завуч{i}", "last_name": "Демо"},
            )
            if created:
                user.set_password(username)
                user.save(update_fields=["password"])
                self.stdout.write(f"Создан завуч: {username} / {username}")
            user.groups.add(deputy_group)
            deputies.append(user)

        # Типы льгот
        for code in Student.PrivilegeType.values:
            PrivilegeType.objects.get_or_create(code=code)

        # Классы
        letters = ["А", "Б", "В", "Г"]
        class_names = [f"{grade}{letter}" for grade in range(1, 12) for letter in letters]
        class_names = class_names[:classes_count]

        classes = []
        for idx, name in enumerate(class_names):
            teacher = teachers[idx % len(teachers)]
            class_room, _ = ClassRoom.objects.get_or_create(
                name=name, defaults={"teacher": teacher}
            )
            if not class_room.teacher:
                class_room.teacher = teacher
                class_room.save(update_fields=["teacher"])
            class_room.staff.add(teacher)
            classes.append(class_room)

        # Ученики
        for class_room in classes:
            for i in range(1, students_per_class + 1):
                full_name = f"Ученик {i} {class_room.name}"
                Student.objects.get_or_create(
                    full_name=full_name,
                    class_room=class_room,
                    defaults={"is_active": True},
                )

        # Льготы (часть учеников)
        all_students = list(
            Student.objects.filter(class_room__in=classes, is_active=True)
        )
        for student in all_students:
            if random.random() < 0.25:
                ptypes = list(PrivilegeType.objects.all())
                random.shuffle(ptypes)
                selected = ptypes[: random.randint(1, min(2, len(ptypes)))]
                student.privilege_types.set(selected)
                student.is_privileged = True
                student.save(update_fields=["is_privileged"])

        # Посещаемость за последние N учебных дней
        today = timezone.localdate()
        work_days = []
        cursor = today
        while len(work_days) < days:
            if school_calendar.is_school_day(cursor):
                work_days.append(cursor)
            cursor -= timedelta(days=1)

        for day in work_days:
            for class_room in classes:
                if AttendanceSummary.objects.filter(
                    class_room=class_room, date=day
                ).exists():
                    continue

                students = list(class_room.students.filter(is_active=True))
                total = len(students)
                if total == 0:
                    continue

                absent_count = max(0, int(total * random.uniform(0.04, 0.18)))
                absent_students = random.sample(students, k=min(absent_count, total))

                reasons = []
                for student in absent_students:
                    reason = random.choices(
                        population=[
                            AbsentStudent.Reason.UNEXCUSED,
                            AbsentStudent.Reason.ORVI,
                            AbsentStudent.Reason.OTHER_DISEASE,
                            AbsentStudent.Reason.FAMILY,
                        ],
                        weights=[40, 30, 15, 15],
                        k=1,
                    )[0]
                    reasons.append((student, reason))

                unexcused = sum(
                    1 for _, reason in reasons if reason == AbsentStudent.Reason.UNEXCUSED
                )
                orvi = sum(
                    1 for _, reason in reasons if reason == AbsentStudent.Reason.ORVI
                )
                other = sum(
                    1 for _, reason in reasons if reason == AbsentStudent.Reason.OTHER_DISEASE
                )
                family = sum(
                    1 for _, reason in reasons if reason == AbsentStudent.Reason.FAMILY
                )
                present_reported = max(0, total - absent_count)

                summary = AttendanceSummary.objects.create(
                    class_room=class_room,
                    date=day,
                    present_count_auto=total,
                    present_count_reported=present_reported,
                    unexcused_absent_count=unexcused,
                    orvi_count=orvi,
                    other_disease_count=other,
                    family_reason_count=family,
                    created_by=class_room.teacher or random.choice(teachers),
                )

                AbsentStudent.objects.bulk_create(
                    [
                        AbsentStudent(attendance=summary, student=student, reason=reason)
                        for student, reason in reasons
                    ]
                )

        self.stdout.write(self.style.SUCCESS("Демо-данные созданы."))
