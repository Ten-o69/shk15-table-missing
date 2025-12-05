def user_roles(request):
    user = request.user
    if not user.is_authenticated:
        return {}
    is_deputy = user.groups.filter(name='Завуч').exists()
    is_teacher = user.groups.filter(name='Учитель').exists()
    return {
        'is_deputy': is_deputy,
        'is_teacher': is_teacher,
    }
