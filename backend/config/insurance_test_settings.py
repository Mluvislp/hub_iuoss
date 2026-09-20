"""Isolated SQLite contract tests: never use the environment's live database."""
from .settings import *  # noqa: F403,F401

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
INSURANCE_WORKFLOW_V2 = True
INSURANCE_PRIORITY_TYPE_CODE = 'DHQT_UT_SV'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
LOGGING = {}
DEBUG = False
ALLOWED_HOSTS = ['testserver', 'localhost']
TEST_RUNNER = 'config.insurance_test_runner.SharedSchemaRunner'
MIGRATION_MODULES = {name.split('.')[-1]: None for name in INSTALLED_APPS}
