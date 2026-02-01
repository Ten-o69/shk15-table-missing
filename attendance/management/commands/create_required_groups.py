from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group


class Command(BaseCommand):
    help = "Создает обязательные группы пользователей для корректной работы системы"

    def handle(self, *args, **options):
        required = ["Учитель", "Завуч"]
        created = 0
        for name in required:
            _, was_created = Group.objects.get_or_create(name=name)
            if was_created:
                created += 1
                self.stdout.write(f"Создана группа: {name}")
            else:
                self.stdout.write(f"Группа уже есть: {name}")

        self.stdout.write(
            self.style.SUCCESS(f"Готово. Создано новых групп: {created}")
        )
