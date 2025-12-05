from django.conf import settings
from django.db import models


class ClassRoom(models.Model):
    """
    Школьный класс, например '1В'.
    """
    name = models.CharField(
        max_length=10,
        unique=True,
        verbose_name='Класс (например 1В)'
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='classes',
        verbose_name='Классный руководитель'
    )

    class Meta:
        verbose_name = 'Класс'
        verbose_name_plural = 'Классы'
        ordering = ['name']

    def __str__(self):
        return self.name


class Student(models.Model):
    """
    Ученик, привязанный к классу.
    """
    full_name = models.CharField(
        max_length=255,
        verbose_name='ФИО ученика'
    )
    class_room = models.ForeignKey(
        ClassRoom,
        on_delete=models.CASCADE,
        related_name='students',
        verbose_name='Класс'
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name='Активен'
    )

    class Meta:
        verbose_name = 'Ученик'
        verbose_name_plural = 'Ученики'
        ordering = ['class_room__name', 'full_name']
        unique_together = ('full_name', 'class_room')

    def __str__(self):
        return f'{self.full_name} ({self.class_room})'


class AttendanceSummary(models.Model):
    """
    Сводка по посещаемости для одного класса за один день.
    """
    class_room = models.ForeignKey(
        ClassRoom,
        on_delete=models.CASCADE,
        related_name='attendance_summaries',
        verbose_name='Класс'
    )
    date = models.DateField(verbose_name='Дата')

    # Столбец 2: количество присутствующих (расчётное, из БД)
    present_count_auto = models.PositiveIntegerField(
        default=0,
        verbose_name='Присутствуют (по списку)'
    )

    # Столбец 3: количество пришедших (ручной ввод)
    present_count_reported = models.PositiveIntegerField(
        verbose_name='Пришло по факту'
    )

    # Столбец 4: отсутствуют по неуважительной причине (ручной ввод)
    unexcused_absent_count = models.PositiveIntegerField(
        verbose_name='Неуважительные причины'
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name='Кто ввёл данные'
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Создано'
    )

    class Meta:
        verbose_name = 'Сводка посещаемости'
        verbose_name_plural = 'Сводки посещаемости'
        unique_together = ('class_room', 'date')
        ordering = ['-date', 'class_room__name']

    def __str__(self):
        return f'{self.class_room} / {self.date}'


class AbsentStudent(models.Model):
    """
    Конкретные отсутствующие ученики по сводке.
    """
    attendance = models.ForeignKey(
        AttendanceSummary,
        on_delete=models.CASCADE,
        related_name='absent_students',
        verbose_name='Сводка'
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='absence_records',
        verbose_name='Ученик'
    )

    class Meta:
        verbose_name = 'Отсутствующий ученик'
        verbose_name_plural = 'Отсутствующие ученики'
        unique_together = ('attendance', 'student')

    def __str__(self):
        return f'{self.student} отсутствует {self.attendance.date}'
