from functools import wraps
from django.contrib import messages
from django.contrib.auth.views import LoginView, LogoutView
from django.shortcuts import redirect


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
