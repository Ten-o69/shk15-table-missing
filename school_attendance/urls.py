from django.contrib import admin
from django.urls import path, include
from attendance.views import UserLoginView, UserLogoutView, substitute_login

urlpatterns = [
    path('admin/', admin.site.urls),
    path('login/', UserLoginView.as_view(), name='login'),
    path('login/substitute/', substitute_login, name='substitute_login'),
    path('logout/', UserLogoutView.as_view(), name='logout'),
    path('', include('attendance.urls')),
]
