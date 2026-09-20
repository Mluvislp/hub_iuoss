SELECT status, workflow_version, COUNT(*) FROM hub_insurance_registrations GROUP BY status,workflow_version;
SELECT registration_id, COUNT(*) FROM hub_insurance_registration_events WHERE event_type='LEGACY_IMPORTED'
GROUP BY registration_id HAVING COUNT(*)>1;
SELECT r.id FROM hub_insurance_registrations r LEFT JOIN hub_insurance_registration_events e ON e.registration_id=r.id
WHERE r.workflow_version=2 GROUP BY r.id HAVING COUNT(e.id)=0;
SELECT a.id FROM hub_insurance_payment_assessments a JOIN hub_insurance_registration_events e ON e.id=a.event_id
WHERE a.registration_id<>e.registration_id OR e.event_type NOT IN ('REJECTED','PAYMENT_ASSESSED')
OR a.missing_amount_vnd<>GREATEST(a.required_amount_vnd-a.confirmed_paid_total_vnd,0);
SELECT p.id FROM hub_insurance_payment_evidences p JOIN hub_insurance_registration_events e ON e.id=p.event_id
WHERE p.registration_id<>e.registration_id;
SELECT r.id FROM hub_insurance_registrations r LEFT JOIN student_health_insurance_cards c ON c.source_registration_id=r.id
WHERE r.status='issued' AND c.id IS NULL;
SELECT c.id FROM student_health_insurance_cards c JOIN hub_insurance_registrations r ON r.id=c.source_registration_id
WHERE c.registration_year<>r.registration_year;
SELECT student_id, COUNT(*) FROM student_health_insurance_cards WHERE is_current=1 GROUP BY student_id HAVING COUNT(*)>1;
SELECT source_registration_id, COUNT(*) FROM student_health_insurance_cards WHERE source_registration_id IS NOT NULL
GROUP BY source_registration_id HAVING COUNT(*)>1;
