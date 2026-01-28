from datetime import timedelta
from django.contrib import messages
from django.contrib.auth import login as auth_login
from django.contrib.auth.decorators import login_required, user_passes_test
from django.shortcuts import render, redirect
from django.utils import timezone

from database.models import ClassRoom, SubstituteAccessToken
from ..utils import class_sort_key
from .auth import deny_substitute_access, is_deputy


def substitute_login(request):
    if request.method == 'POST':
        raw = (request.POST.get('token') or '').strip()
        if not raw: return render(request, 'attendance/substitute_login.html', {'error': 'Введите токен.'})

        token_hash = SubstituteAccessToken.hash_token(raw)
        tok = SubstituteAccessToken.objects.select_related('class_room', 'class_room__teacher').filter(
            token_hash=token_hash).first()

        if not tok or not tok.is_active:
            return render(request, 'attendance/substitute_login.html', {'error': 'Токен не найден, истёк или отозван.'})

        teacher = tok.target_user
        if not teacher or not teacher.is_active:
            return render(request, 'attendance/substitute_login.html',
                          {'error': 'У класса не задан активный классный руководитель.'})

        auth_login(request, teacher)
        request.session['substitute_as'] = True
        request.session['substitute_class_id'] = tok.class_room_id
        request.session['substitute_token_id'] = tok.id

        remaining = int((tok.expires_at - timezone.now()).total_seconds())
        if remaining > 0: request.session.set_expiry(remaining)

        tok.last_used_at = timezone.now()
        tok.save(update_fields=['last_used_at'])
        messages.success(request, f'Вход выполнен. Режим замены: {tok.class_room.name}.')
        return redirect('index')

    return render(request, 'attendance/substitute_login.html')


@login_required
@deny_substitute_access
@user_passes_test(is_deputy)
def substitute_tokens(request):
    classes = sorted(ClassRoom.objects.select_related('teacher'), key=class_sort_key)

    if request.method == 'POST':
        action = (request.POST.get('action') or '').strip()

        if action == "delete":
            tid = request.POST.get("token_id") or request.POST.get("id")
            if tid and str(tid).isdigit():
                SubstituteAccessToken.objects.filter(id=int(tid)).delete()
                messages.success(request, "Токен удалён.")
            return redirect(request.path)

        if action == 'revoke':
            tid = request.POST.get('token_id')
            if tid and str(tid).isdigit():
                tok = SubstituteAccessToken.objects.filter(id=int(tid)).first()
                if tok and not tok.revoked_at:
                    tok.revoked_at = timezone.now()
                    tok.save(update_fields=['revoked_at'])
                    messages.success(request, 'Токен отозван.')
            return redirect(request.path)

        if action == 'recreate':
            tid = request.POST.get('token_id')
            if tid and str(tid).isdigit():
                tok = SubstituteAccessToken.objects.select_related('class_room__teacher').filter(id=int(tid)).first()
                if tok and tok.class_room.teacher and tok.class_room.teacher.is_active:
                    raw = SubstituteAccessToken.generate_raw_token()
                    tok.token_hash = SubstituteAccessToken.hash_token(raw)
                    tok.revoked_at = None
                    tok.issued_by = request.user
                    tok.expires_at = timezone.now() + timedelta(seconds=tok.ttl_seconds)
                    tok.created_at = timezone.now()
                    tok.save()
                    request.session["created_token"] = raw
                    messages.success(request, f'Токен пересоздан для {tok.class_room.name}.')
            return redirect(request.path)

        if action == 'create':
            class_id = request.POST.get('class_id')
            sec, mn, hr, dy, wk = [int(request.POST.get(k) or 0) for k in
                                   ('ttl_sec', 'ttl_min', 'ttl_hour', 'ttl_day', 'ttl_week')]
            ttl = sec + mn * 60 + hr * 3600 + dy * 86400 + wk * 604800

            if class_id and str(class_id).isdigit() and 30 <= ttl <= 1209600:
                class_room = ClassRoom.objects.filter(id=int(class_id)).select_related('teacher').first()
                if class_room and class_room.teacher and class_room.teacher.is_active:
                    raw = SubstituteAccessToken.generate_raw_token()
                    SubstituteAccessToken.objects.create(
                        class_room=class_room, issued_by=request.user, token_hash=SubstituteAccessToken.hash_token(raw),
                        ttl_seconds=ttl, expires_at=timezone.now() + timedelta(seconds=ttl)
                    )
                    request.session["created_token"] = raw
                    messages.success(request, f'Токен создан для {class_room.name}.')
            return redirect(request.path)

        return redirect(request.path)

    created_token = request.session.pop("created_token", None)
    tokens = list(
        SubstituteAccessToken.objects.select_related('class_room', 'issued_by', 'class_room__teacher').order_by(
            '-created_at')[:200])
    tokens.sort(key=lambda t: t.created_at, reverse=True)
    tokens.sort(key=lambda t: class_sort_key(t.class_room))

    context = {'classes': classes, 'tokens': tokens, 'created_token': created_token, 'is_deputy': True,
               'is_teacher': request.user.groups.filter(name='Учитель').exists()}
    return render(request, 'attendance/substitute_tokens.html', context)
