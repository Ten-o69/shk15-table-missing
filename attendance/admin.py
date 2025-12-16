from django.contrib import admin
from database.models import ClassRoom, Student, AttendanceSummary, AbsentStudent


@admin.register(ClassRoom)
class ClassRoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'teacher', 'student_count')
    list_filter = ('teacher',)
    search_fields = ('name',)


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'class_room', 'is_active')
    list_filter = ('class_room', 'is_active')
    search_fields = ('full_name',)


@admin.register(AttendanceSummary)
class AttendanceSummaryAdmin(admin.ModelAdmin):
    list_display = (
        'class_room',
        'date',
        'present_count_auto',
        'present_count_reported',
        'unexcused_absent_count',
        'created_by',
    )
    list_filter = ('date', 'class_room')
    search_fields = ('class_room__name',)


@admin.register(AbsentStudent)
class AbsentStudentAdmin(admin.ModelAdmin):
    list_display = ('attendance', 'student')
    list_filter = ('attendance__date', 'student__class_room')
    search_fields = ('student__full_name',)
