from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('statistics/', views.statistics, name='statistics'),
    path('statistics/export-day/', views.export_daily_statistics, name='daily_statistics_export'),
    path('students/', views.manage_students, name='manage_students'),
    path('substitute-tokens/', views.substitute_tokens, name='substitute_tokens'),
]
