from django.core.management.base import BaseCommand
from django.contrib.auth.models import User, Group
from database.models import ClassRoom, Student


class Command(BaseCommand):
    help = 'Создаёт группы, тестовых пользователей, классы и учеников'

    def handle(self, *args, **options):
        # группы
        teacher_group, _ = Group.objects.get_or_create(name='Учитель')
        deputy_group, _ = Group.objects.get_or_create(name='Завуч')

        # пользователи
        if not User.objects.filter(username='teacher1').exists():
            t1 = User.objects.create_user(
                username='teacher1',
                password='teacher1',
                first_name='Иван',
                last_name='Петров'
            )
            t1.groups.add(teacher_group)
            self.stdout.write('Создан учитель: teacher1 / teacher1')

        if not User.objects.filter(username='deputy1').exists():
            d1 = User.objects.create_user(
                username='deputy1',
                password='deputy1',
                first_name='Мария',
                last_name='Сидорова'
            )
            d1.groups.add(deputy_group)
            self.stdout.write('Создан завуч: deputy1 / deputy1')

        teacher = User.objects.get(username='teacher1')

        # классы
        class_1v, _ = ClassRoom.objects.get_or_create(name='1В', defaults={'teacher': teacher})
        class_2a, _ = ClassRoom.objects.get_or_create(name='2А', defaults={'teacher': teacher})

        # ученики
        for i in range(1, 6):
            Student.objects.get_or_create(
                full_name=f'Ученик {i} 1В',
                class_room=class_1v
            )

        for i in range(1, 6):
            Student.objects.get_or_create(
                full_name=f'Ученик {i} 2А',
                class_room=class_2a
            )

        self.stdout.write(self.style.SUCCESS('Демо-данные созданы.'))
