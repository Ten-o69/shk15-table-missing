from django.contrib import messages
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.urls import reverse

from database.models import SubstituteAccessToken


class SubstituteTokenMiddleware:
    """
    Если пользователь вошёл по токену:
    - проверяем, что токен ещё активен (не истёк и не отозван)
    - если не активен -> разлогиниваем и кидаем на вход по токену
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token_id = request.session.get('substitute_token_id')

        # не мешаем обычному логину/странице ввода токена
        token_login_path = None
        try:
            token_login_path = reverse('substitute_login')
        except Exception:
            token_login_path = None

        if (
            token_id
            and request.user.is_authenticated
            and (not token_login_path or request.path != token_login_path)
        ):
            tok = SubstituteAccessToken.objects.select_related('class_room').filter(id=token_id).first()
            if not tok or not tok.is_active:
                logout(request)
                request.session.flush()
                messages.error(request, 'Срок действия токена замены истёк или токен отозван. Войдите снова.')
                if token_login_path:
                    return redirect('substitute_login')

        return self.get_response(request)
