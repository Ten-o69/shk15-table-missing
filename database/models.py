import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


class ClassRoom(models.Model):
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
        related_name='classes_as_homeroom',
        verbose_name='Классный руководитель',
        help_text='Необязательное поле. Для информации.'
    )
    student_count = models.PositiveIntegerField(
        default=0,
        verbose_name='Количество учеников в классе'
    )

    staff = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='assigned_classes',
        verbose_name='Закреплённые сотрудники (учителя / завучи)',
        help_text='Пользователи, которые видят этот класс на главной странице.'
    )

    class Meta:
        verbose_name = 'Класс'
        verbose_name_plural = 'Классы'
        ordering = ['name']

    def __str__(self):
        return self.name


class Student(models.Model):
    class PrivilegeType(models.TextChoices):
        SVO = 'svo', 'СВО'
        MULTI = 'multi', 'Многодетные'
        LOW_INCOME = 'low_income', 'Малоимущие'
        DISABLED = 'disabled', 'Инвалиды'

    full_name = models.CharField(max_length=255, verbose_name='ФИО ученика')
    class_room = models.ForeignKey(
        ClassRoom,
        on_delete=models.CASCADE,
        related_name='students',
        verbose_name='Класс'
    )
    is_active = models.BooleanField(default=True, verbose_name='Активен')

    # старое поле оставляем, чтобы не ломать текущую логику/шаблоны
    is_privileged = models.BooleanField(
        default=False,
        verbose_name='Льготник'
    )

    # ✅ НОВОЕ: тип льготы
    privilege_type = models.CharField(
        max_length=20,
        choices=PrivilegeType.choices,
        null=True,
        blank=True,
        verbose_name='Тип льготы',
        help_text='Если указан тип льготы — ученик считается льготником.'
    )

    class Meta:
        verbose_name = 'Ученик'
        verbose_name_plural = 'Ученики'
        ordering = ['class_room__name', 'full_name']
        unique_together = ('full_name', 'class_room')

    def __str__(self):
        return f'{self.full_name} ({self.class_room})'


class AttendanceSummary(models.Model):
    class_room = models.ForeignKey(
        ClassRoom,
        on_delete=models.CASCADE,
        related_name='attendance_summaries',
        verbose_name='Класс'
    )
    date = models.DateField(verbose_name='Дата')

    present_count_auto = models.PositiveIntegerField(verbose_name='По списку')
    present_count_reported = models.PositiveIntegerField(default=0, verbose_name='Пришло по факту')
    unexcused_absent_count = models.PositiveIntegerField(default=0, verbose_name='Неуважительные отсутствия')

    orvi_count = models.PositiveIntegerField(default=0, verbose_name='ОРВИ')
    other_disease_count = models.PositiveIntegerField(default=0, verbose_name='Другие заболевания')
    family_reason_count = models.PositiveIntegerField(default=0, verbose_name='По семейным обстоятельствам')

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_attendance_summaries',
        verbose_name='Кто внёс данные'
    )

    created_at = models.DateTimeField(default=timezone.now, editable=False, verbose_name='Создано')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Обновлено')

    class Meta:
        verbose_name = 'Сводка посещаемости'
        verbose_name_plural = 'Сводки посещаемости'
        unique_together = ('class_room', 'date')
        ordering = ['-date', 'class_room__name']

    def __str__(self):
        return f'{self.class_room} — {self.date}'


class AbsentStudent(models.Model):
    class Reason(models.TextChoices):
        UNEXCUSED = 'unexcused', 'Неуважительная причина'
        ORVI = 'orvi', 'ОРВИ'
        OTHER_DISEASE = 'other_disease', 'Другое заболевание'
        FAMILY = 'family', 'По семейным обстоятельствам'

    attendance = models.ForeignKey(
        'AttendanceSummary',
        on_delete=models.CASCADE,
        related_name='absent_students',
        verbose_name='Запись посещаемости'
    )
    student = models.ForeignKey(
        'Student',
        on_delete=models.CASCADE,
        related_name='absences',
        verbose_name='Ученик'
    )
    reason = models.CharField(
        max_length=20,
        choices=Reason.choices,
        default=Reason.UNEXCUSED,
        verbose_name='Причина отсутствия'
    )

    class Meta:
        verbose_name = 'Отсутствие ученика'
        verbose_name_plural = 'Отсутствия учеников'
        unique_together = ('attendance', 'student')

    def __str__(self):
        return f'{self.student} ({self.get_reason_display()}) {self.attendance.date}'


class SubstituteAccessToken(models.Model):
    """
    Временный токен замены:
    - выдаёт завуч
    - привязан к КЛАССУ (а значит и к классному руководителю: class_room.teacher)
    - действует до expires_at
    - хранится только HASH токена (сырой токен показываем только при создании)
    """
    class_room = models.ForeignKey(
        'ClassRoom',
        on_delete=models.CASCADE,
        related_name='substitute_tokens',
        verbose_name='Класс'
    )

    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='issued_substitute_tokens',
        verbose_name='Кто выдал'
    )

    token_hash = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        verbose_name='SHA256 токена'
    )

    created_at = models.DateTimeField(default=timezone.now, editable=False, verbose_name='Создано')
    expires_at = models.DateTimeField(verbose_name='Истекает')
    revoked_at = models.DateTimeField(null=True, blank=True, verbose_name='Отозван')

    last_used_at = models.DateTimeField(null=True, blank=True, verbose_name='Последнее использование')

    ttl_seconds = models.PositiveIntegerField(
        default=3600,
        verbose_name='Длительность (сек)'
    )

    class Meta:
        verbose_name = 'Токен замены'
        verbose_name_plural = 'Токены замены'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.class_room} до {self.expires_at:%d.%m.%Y %H:%M}'

    @staticmethod
    def hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()

    @staticmethod
    def generate_raw_token() -> str:
        # достаточно длинный, удобный для копирования
        return secrets.token_urlsafe(24)

    @property
    def is_active(self) -> bool:
        now = timezone.now()
        return self.revoked_at is None and now <= self.expires_at

    @property
    def target_user(self):
        # классный руководитель
        return self.class_room.teacher
