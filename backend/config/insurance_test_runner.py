from django.apps import apps
from django.test.runner import DiscoverRunner
from django.conf import settings


class SharedSchemaRunner(DiscoverRunner):
    def validate_database(self):
        assert settings.DATABASES['default']['ENGINE'] == 'django.db.backends.sqlite3'

    def setup_databases(self, **kwargs):
        self.validate_database()
        self.unmanaged = [m for m in apps.get_models() if not m._meta.managed]
        for model in self.unmanaged:
            model._meta.managed = True
        return super().setup_databases(**kwargs)

    def teardown_databases(self, old_config, **kwargs):
        try:
            super().teardown_databases(old_config, **kwargs)
        finally:
            for model in self.unmanaged:
                model._meta.managed = False


class MySQLSharedSchemaRunner(SharedSchemaRunner):
    def validate_database(self):
        config = settings.DATABASES['default']
        assert config['ENGINE'] == 'django.db.backends.mysql'
        assert config['TEST']['NAME'].startswith('test_insurance_')
