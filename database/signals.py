from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from django.db.models import Count

from .models import Student, ClassRoom


def recalc_student_count(class_room_id: int) -> None:
    if not class_room_id:
        return

    count = Student.objects.filter(
        class_room_id=class_room_id,
        is_active=True
    ).count()

    ClassRoom.objects.filter(id=class_room_id).update(student_count=count)


@receiver(post_save, sender=Student)
def student_saved(sender, instance: Student, created, **kwargs):
    # пересчёт для нового класса
    recalc_student_count(instance.class_room_id)


@receiver(post_delete, sender=Student)
def student_deleted(sender, instance: Student, **kwargs):
    recalc_student_count(instance.class_room_id)


@receiver(pre_save, sender=Student)
def student_presave(sender, instance: Student, **kwargs):
    if not instance.pk:
        instance._old_class_room_id = None
        return
    try:
        old = Student.objects.only("class_room_id", "is_active").get(pk=instance.pk)
        instance._old_class_room_id = old.class_room_id
        instance._old_is_active = old.is_active
    except Student.DoesNotExist:
        instance._old_class_room_id = None
        instance._old_is_active = None


@receiver(post_save, sender=Student)
def student_saved(sender, instance: Student, created, **kwargs):
    # пересчитываем текущий класс
    recalc_student_count(instance.class_room_id)

    # если сменился класс — пересчитать старый тоже
    old_id = getattr(instance, "_old_class_room_id", None)
    if old_id and old_id != instance.class_room_id:
        recalc_student_count(old_id)
