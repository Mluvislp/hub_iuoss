"""Run the production SQL twice against synthetic legacy rows on a disposable MySQL.

Requires pymysql and INSURANCE_TEST_HOST/PORT/USER/PASSWORD. Creates its own uniquely
named test_insurance_* database; never reads DB_* or an application database.
"""
import os
import json
from pathlib import Path
from uuid import uuid4
import pymysql


def execute_script(cursor, path):
    delimiter, pending = ';', ''
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if line.strip().upper().startswith('DELIMITER '):
            delimiter = line.strip().split()[1]
            continue
        if line.strip().startswith('--') or not line.strip():
            continue
        pending += line + '\n'
        if pending.rstrip().endswith(delimiter):
            cursor.execute(pending.rstrip()[:-len(delimiter)])
            while cursor.nextset():
                pass
            pending = ''
    assert not pending.strip(), 'Unterminated SQL statement'


def main():
    name = 'test_insurance_edit_sql_' + uuid4().hex[:12]
    conn = pymysql.connect(host=os.environ['INSURANCE_TEST_HOST'], port=int(os.environ['INSURANCE_TEST_PORT']),
        user=os.environ['INSURANCE_TEST_USER'], password=os.environ['INSURANCE_TEST_PASSWORD'], autocommit=True)
    docs = Path(__file__).resolve().parents[2] / 'docs'
    with conn.cursor() as cur:
        cur.execute(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
        try:
            cur.execute(f'USE `{name}`')
            execute_script(cur, docs / 'external_insurance_upgrade.sql')
            cur.execute('CREATE TABLE hub_insurance_configs (id BIGINT PRIMARY KEY, registration_year INT, registration_period VARCHAR(32), registration_opens_at DATETIME(6), registration_closes_at DATETIME(6))')
            cur.execute('CREATE TABLE hub_insurance_registrations (id BIGINT PRIMARY KEY, status VARCHAR(16), created_at DATETIME(6), updated_at DATETIME(6), payment_receipt_image VARCHAR(500))')
            cur.execute('CREATE TABLE hub_insurance_registration_events (id BIGINT PRIMARY KEY, registration_id BIGINT, event_no INT, event_type VARCHAR(40), source_app VARCHAR(16), created_at DATETIME(6))')
            cur.execute("INSERT INTO hub_insurance_configs VALUES (1,2027,'MAIN','2026-09-01','2026-10-01'),(2,2026,'Q2','2026-03-01','2026-04-01'),(3,2026,'Q3','2026-03-15','2026-04-15')")
            for pk, created in enumerate(['2026-09-10', '2026-03-20', '2024-01-01'], start=1):
                cur.execute('''INSERT INTO student_external_health_insurance_declarations
                    (id,student_id,full_name,student_code,social_insurance_code,medical_insurance_code,
                     hospital_code,valid_from,valid_until,registration_year,snapshot,images,request_key,
                     request_digest,status,review_note,created_at,updated_at)
                    VALUES (%s,1,'Declared name','TEST','0123456789','0123456789','79001',
                     '2001-01-01','2001-12-31',2001,%s,%s,%s,'digest','rejected','Old rejection',%s,%s)''',
                    (pk, json.dumps({'citizen_id':'123456789012'}), json.dumps({'bhyt_image':{'storage_key':'old.png'}}), f'key-{pk}', created, created))
            cur.execute("INSERT INTO hub_insurance_registrations VALUES (1,'iu_processing','2026-09-01','2026-09-10','old.png'),(2,'waiting_bhxh','2026-09-01','2026-09-10','second.png')")
            cur.execute("INSERT INTO hub_insurance_registration_events VALUES (1,1,1,'RESUBMITTED','Hub','2026-09-10'),(2,2,1,'RESUBMITTED','Hub','2026-09-10'),(3,2,2,'SENT_TO_BHXH','Dashboard','2026-09-11')")
            preserved = 'id,created_at,updated_at,status,review_note,snapshot,images,registration_year'
            cur.execute(f'SELECT {preserved} FROM student_external_health_insurance_declarations ORDER BY id')
            before = cur.fetchall()
            execute_script(cur, docs / 'insurance_edit_preflight.sql')
            execute_script(cur, docs / 'insurance_edit_upgrade.sql')
            execute_script(cur, docs / 'insurance_edit_upgrade.sql')
            execute_script(cur, docs / 'insurance_edit_verify.sql')
            cur.execute(f'SELECT {preserved} FROM student_external_health_insurance_declarations ORDER BY id')
            assert cur.fetchall() == before, 'Legacy values changed'
            cur.execute('SELECT id,intake_year,intake_period FROM student_external_health_insurance_declarations ORDER BY id')
            assert cur.fetchall() == ((1,2027,'MAIN'),(2,None,None),(3,None,None))
            cur.execute('SELECT id,supplement_pending FROM hub_insurance_registrations ORDER BY id')
            assert cur.fetchall() == ((1,1),(2,0))
            cur.execute('UPDATE hub_insurance_registrations SET supplement_pending=0 WHERE id=1')
            execute_script(cur, docs / 'insurance_edit_upgrade.sql')
            cur.execute('SELECT supplement_pending FROM hub_insurance_registrations WHERE id=1')
            assert cur.fetchone() == (0,), 'Rerun reset an acknowledged supplement'
            print('PASS: SQL preflight/upgrade/verify; repeated execution; unambiguous mapping; ambiguous/unmapped preservation; original identity/timestamps/status/images; legacy supplement queue and acknowledgment')
        finally:
            cur.execute(f'DROP DATABASE `{name}`')
    conn.close()


if __name__ == '__main__':
    main()
