import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

from django.core.management import execute_from_command_line

if __name__ == '__main__':
    port = os.environ.get('PORT', '3000')
    args = ['manage.py', 'runserver', f'0.0.0.0:{port}', '--noreload']
    execute_from_command_line(args)
