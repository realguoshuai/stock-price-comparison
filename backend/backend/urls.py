from django.urls import path, re_path
from api import views

urlpatterns = [
    path('api/stock', views.get_stock, name='get_stock'),
    path('api/history', views.get_history, name='get_history'),
    path('api/history/daily', views.get_daily_history, name='get_daily_history'),
    re_path(r'^assets/(?P<path>.*)$', views.serve_assets, name='serve_assets'),
    path('', views.index, name='index'),
]
