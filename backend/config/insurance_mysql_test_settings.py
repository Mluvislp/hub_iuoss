"""Explicit opt-in integration tests. Never inherit DB_* production credentials."""
import os
from .insurance_test_settings import *  # noqa: F401,F403

test_name = os.environ['INSURANCE_TEST_DB']
if not test_name.startswith('test_insurance_'):
    raise RuntimeError('INSURANCE_TEST_DB must start with test_insurance_. Use a disposable server.')
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.mysql', 'NAME': test_name,
    'USER': os.environ['INSURANCE_TEST_USER'], 'PASSWORD': os.environ['INSURANCE_TEST_PASSWORD'],
    'HOST': os.environ['INSURANCE_TEST_HOST'], 'PORT': os.environ['INSURANCE_TEST_PORT'],
    'TEST': {'NAME': test_name}, 'OPTIONS': {'charset': 'utf8mb4'},
}}
TEST_RUNNER = 'config.insurance_test_runner.MySQLSharedSchemaRunner'
