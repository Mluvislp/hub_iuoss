"""Manual, resumable migration; default is read-only and does not connect to other databases."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from core.models import HealthInsuranceRegistration
from core.insurance_contract import LEGACY, STATUS_LABELS
from core.insurance_history import ensure_legacy


class Command(BaseCommand):
    help = 'Inspect/backfill legacy BHYT in batches; --apply --database-name NAME explicitly enables writes.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--database-name')
        parser.add_argument('--after-id', type=int, default=0)
        parser.add_argument('--batch-size', type=int, default=200)
        parser.add_argument('--map-statuses', action='store_true')

    def handle(self, *args, **options):
        if options['apply'] and options['database_name'] != connection.settings_dict['NAME']:
            raise CommandError('Pass --database-name matching the reviewed target database.')
        if not 1 <= options['batch_size'] <= 1000:
            raise CommandError('batch-size must be between 1 and 1000')
        ids = list(HealthInsuranceRegistration.objects.filter(pk__gt=options['after_id'])
            .order_by('pk').values_list('pk', flat=True)[:options['batch_size']])
        for pk in ids:
            with transaction.atomic():
                query = HealthInsuranceRegistration.objects
                if options['apply']:
                    query = query.select_for_update()
                reg = query.get(pk=pk)
                self.stdout.write(f'id={pk} status={reg.status}')
                if not options['apply']:
                    continue
                ensure_legacy(reg)
                if options['map_statuses'] and reg.workflow_version < 2:
                    if reg.status not in {*LEGACY, *STATUS_LABELS}:
                        self.stderr.write(f'id={pk}: unknown status; mapping left unchanged')
                        continue
                    reg.status = LEGACY.get(reg.status, reg.status)
                    reg.workflow_version = 2
                    reg.row_version += 1
                    reg.save(update_fields=['status', 'workflow_version', 'row_version'])
        self.stdout.write(f'checkpoint={ids[-1] if ids else options["after_id"]}; processed={len(ids)}')
