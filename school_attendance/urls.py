from django.contrib import admin
from django.urls import path, include
from attendance.views import UserLoginView, UserLogoutView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('login/', UserLoginView.as_view(), name='login'),
    path('logout/', UserLogoutView.as_view(), name='logout'),
    path('', include('attendance.urls')),
]
