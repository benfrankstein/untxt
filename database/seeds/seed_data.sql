-- Seed Data for OCR Platform Testing
-- This script populates the database with sample data for development and testing

BEGIN;

-- =============================================
-- Seed Users
-- =============================================
-- Password for all users: "Password123!"
-- Hash generated using bcrypt with 10 rounds

INSERT INTO users (id, email, username, password_hash, role, is_active, email_verified, created_at, last_login) VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@ocrplatform.com', 'admin', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'admin', true, true, NOW() - INTERVAL '90 days', NOW() - INTERVAL '1 hour'),
    ('22222222-2222-2222-2222-222222222222', 'john.doe@example.com', 'johndoe', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'user', true, true, NOW() - INTERVAL '60 days', NOW() - INTERVAL '2 hours'),
    ('33333333-3333-3333-3333-333333333333', 'jane.smith@example.com', 'janesmith', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'user', true, true, NOW() - INTERVAL '45 days', NOW() - INTERVAL '3 days'),
    ('44444444-4444-4444-4444-444444444444', 'bob.wilson@example.com', 'bobwilson', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'user', true, false, NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 days'),
    ('55555555-5555-5555-5555-555555555555', 'alice.johnson@example.com', 'alicejohnson', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'user', true, true, NOW() - INTERVAL '15 days', NOW() - INTERVAL '1 day'),
    ('66666666-6666-6666-6666-666666666666', 'guest@example.com', 'guestuser', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'guest', true, false, NOW() - INTERVAL '7 days', NOW() - INTERVAL '12 hours'),
    ('77777777-7777-7777-7777-777777777777', 'inactive@example.com', 'inactiveuser', '$2a$10$rZvZXn.Jf5XOvfNsVlGgJeGzE0Lg5W/7hSH2lw5xPjjZj4ZLJGvKO', 'user', false, true, NOW() - INTERVAL '120 days', NOW() - INTERVAL '60 days');

-- =============================================
-- Seed Files
-- =============================================

INSERT INTO files (id, user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size, file_hash, uploaded_at) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'invoice_2024_001.pdf', 'f_2024_10_14_001.pdf', '/var/ocr-platform/files/f_2024_10_14_001.pdf', 'pdf', 'application/pdf', 245678, 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6', NOW() - INTERVAL '5 days'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'receipt_scan.jpg', 'f_2024_10_14_002.jpg', '/var/ocr-platform/files/f_2024_10_14_002.jpg', 'image', 'image/jpeg', 1024567, 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1', NOW() - INTERVAL '4 days'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'contract_draft.pdf', 'f_2024_10_14_003.pdf', '/var/ocr-platform/files/f_2024_10_14_003.pdf', 'pdf', 'application/pdf', 3456789, 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2', NOW() - INTERVAL '3 days'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 'handwritten_notes.png', 'f_2024_10_14_004.png', '/var/ocr-platform/files/f_2024_10_14_004.png', 'image', 'image/png', 567890, 'd4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3', NOW() - INTERVAL '3 days'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444', 'business_card.jpg', 'f_2024_10_14_005.jpg', '/var/ocr-platform/files/f_2024_10_14_005.jpg', 'image', 'image/jpeg', 234567, 'e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4', NOW() - INTERVAL '2 days'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'report_q3_2024.pdf', 'f_2024_10_14_006.pdf', '/var/ocr-platform/files/f_2024_10_14_006.pdf', 'pdf', 'application/pdf', 5678901, 'f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4e5', NOW() - INTERVAL '1 day'),
    ('10101010-1010-1010-1010-101010101010', '55555555-5555-5555-5555-555555555555', 'whiteboard_photo.jpg', 'f_2024_10_14_007.jpg', '/var/ocr-platform/files/f_2024_10_14_007.jpg', 'image', 'image/jpeg', 987654, 'g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4e5f6', NOW() - INTERVAL '12 hours'),
    ('20202020-2020-2020-2020-202020202020', '66666666-6666-6666-6666-666666666666', 'test_document.pdf', 'f_2024_10_14_008.pdf', '/var/ocr-platform/files/f_2024_10_14_008.pdf', 'document', 'application/pdf', 123456, 'h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4e5f6g7', NOW() - INTERVAL '6 hours');

-- =============================================
-- Seed Tasks
-- =============================================

INSERT INTO tasks (id, user_id, file_id, status, priority, created_at, started_at, completed_at, worker_id, attempts, error_message, options) VALUES
    -- Completed tasks
    ('aaaaaaaa-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed', 5, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '2 minutes', NOW() - INTERVAL '5 days' + INTERVAL '5 minutes', 'worker-001', 1, NULL, '{"language": "en", "enhance": true}'),
    ('bbbbbbbb-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'completed', 3, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days' + INTERVAL '1 minute', NOW() - INTERVAL '4 days' + INTERVAL '3 minutes', 'worker-002', 1, NULL, '{"language": "en"}'),
    ('cccccccc-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'completed', 7, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '30 seconds', NOW() - INTERVAL '3 days' + INTERVAL '8 minutes', 'worker-001', 1, NULL, '{"language": "en", "enhance": true, "deskew": true}'),
    ('dddddddd-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'completed', 5, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '5 minutes', NOW() - INTERVAL '3 days' + INTERVAL '12 minutes', 'worker-003', 1, NULL, '{"language": "en", "handwriting": true}'),
    ('eeeeeeee-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'completed', 2, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '1 minute', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes', 'worker-002', 1, NULL, '{"language": "en"}'),

    -- Processing task
    ('ffffffff-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'processing', 8, NOW() - INTERVAL '1 day', NOW() - INTERVAL '30 minutes', NULL, 'worker-001', 1, NULL, '{"language": "en", "enhance": true}'),

    -- Pending tasks
    ('10101010-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', '10101010-1010-1010-1010-101010101010', 'pending', 5, NOW() - INTERVAL '12 hours', NULL, NULL, NULL, 0, NULL, '{"language": "en"}'),
    ('20202020-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', '20202020-2020-2020-2020-202020202020', 'pending', 3, NOW() - INTERVAL '6 hours', NULL, NULL, NULL, 0, NULL, '{"language": "en"}'),

    -- Failed task
    ('30303030-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'failed', 5, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes', NOW() - INTERVAL '2 days' + INTERVAL '3 minutes', 'worker-003', 3, 'Failed to process image: corrupted file data', '{"language": "en"}');

-- =============================================
-- Seed Results (for completed tasks)
-- =============================================

INSERT INTO results (id, task_id, extracted_text, confidence_score, structured_data, page_count, word_count, processing_time_ms, model_version, created_at) VALUES
    ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111',
     E'INVOICE\n\nInvoice Number: INV-2024-001\nDate: October 1, 2024\nDue Date: October 31, 2024\n\nBill To:\nJohn Doe\n123 Main Street\nAnytown, ST 12345\n\nItem Description                Qty    Unit Price    Amount\n---------------------------------------------------------------\nConsulting Services            10.0    $150.00      $1,500.00\nSoftware License                1.0    $500.00        $500.00\n\nSubtotal:                                           $2,000.00\nTax (10%):                                            $200.00\nTotal:                                              $2,200.00\n\nPayment Terms: Net 30 days\nThank you for your business!',
     0.9543,
     '{"invoice_number": "INV-2024-001", "date": "2024-10-01", "due_date": "2024-10-31", "total": 2200.00, "currency": "USD"}',
     1, 87, 3124, 'qwen3-v1.0', NOW() - INTERVAL '5 days' + INTERVAL '5 minutes'),

    ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111',
     E'RECEIPT\n\nStore: TechMart Electronics\nLocation: 456 Commerce Ave\nDate: October 10, 2024\nTime: 14:32\n\nItems:\n1x USB-C Cable                 $19.99\n2x AA Batteries                $12.98\n1x Phone Case                  $24.99\n\nSubtotal:                      $57.96\nTax:                            $5.22\nTotal:                         $63.18\n\nPayment Method: Credit Card\nCard ending in: 4532\n\nThank you for shopping!',
     0.9231,
     '{"store": "TechMart Electronics", "date": "2024-10-10", "total": 63.18, "items": 3}',
     1, 62, 2087, 'qwen3-v1.0', NOW() - INTERVAL '4 days' + INTERVAL '3 minutes'),

    ('cccccccc-2222-2222-2222-222222222222', 'cccccccc-1111-1111-1111-111111111111',
     E'SOFTWARE DEVELOPMENT AGREEMENT\n\nThis Agreement is entered into as of September 1, 2024, by and between:\n\nClient: ABC Corporation\nDeveloper: XYZ Software Solutions\n\n1. SCOPE OF WORK\nThe Developer agrees to design, develop, and deliver a custom web application as specified in Exhibit A.\n\n2. TIMELINE\nProject Duration: 6 months\nStart Date: September 15, 2024\nCompletion Date: March 15, 2025\n\n3. COMPENSATION\nTotal Project Fee: $50,000\nPayment Schedule:\n- 30% upon signing ($15,000)\n- 40% at midpoint review ($20,000)\n- 30% upon completion ($15,000)\n\n4. INTELLECTUAL PROPERTY\nAll work product shall be owned by the Client upon final payment.\n\n5. CONFIDENTIALITY\nBoth parties agree to maintain confidentiality of all proprietary information.\n\n[Additional standard terms and conditions...]',
     0.8976,
     '{"type": "contract", "parties": ["ABC Corporation", "XYZ Software Solutions"], "amount": 50000, "duration_months": 6}',
     1, 215, 7234, 'qwen3-v1.1', NOW() - INTERVAL '3 days' + INTERVAL '8 minutes'),

    ('dddddddd-2222-2222-2222-222222222222', 'dddddddd-1111-1111-1111-111111111111',
     E'Project Ideas:\n\n1. Mobile app for task management\n   - Priority system\n   - Reminders\n   - Cloud sync\n\n2. Portfolio website redesign\n   - Modern design\n   - Responsive layout\n   - Blog section\n\n3. Study schedule for exams\n   - Math: Mon, Wed, Fri\n   - History: Tue, Thu\n   - Science: Weekend\n\nRemember to:\n- Review code by Friday\n- Email client proposal\n- Buy groceries',
     0.7812,
     '{"type": "notes", "items_count": 3, "contains_tasks": true}',
     1, 68, 6543, 'qwen3-v1.1', NOW() - INTERVAL '3 days' + INTERVAL '12 minutes'),

    ('eeeeeeee-2222-2222-2222-222222222222', 'eeeeeeee-1111-1111-1111-111111111111',
     E'Sarah Mitchell\nSenior Marketing Manager\n\nGrowth Marketing Inc.\n789 Business Park Drive\nSuite 200\nMetropolis, ST 54321\n\nPhone: (555) 123-4567\nEmail: s.mitchell@growthmarketing.com\nWeb: www.growthmarketing.com\n\nLinkedIn: /in/sarahmitchell\nTwitter: @sarahm_marketing',
     0.9134,
     '{"name": "Sarah Mitchell", "title": "Senior Marketing Manager", "company": "Growth Marketing Inc.", "phone": "(555) 123-4567", "email": "s.mitchell@growthmarketing.com"}',
     1, 38, 1876, 'qwen3-v1.0', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes');

-- =============================================
-- Seed Task History
-- =============================================
-- History is automatically created by triggers, but we can add additional entries

INSERT INTO task_history (task_id, status, message, created_at) VALUES
    ('aaaaaaaa-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '5 days'),
    ('bbbbbbbb-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '4 days'),
    ('cccccccc-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '3 days'),
    ('dddddddd-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '3 days'),
    ('eeeeeeee-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '2 days'),
    ('ffffffff-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '1 day'),
    ('ffffffff-1111-1111-1111-111111111111', 'processing', 'Worker started processing', NOW() - INTERVAL '30 minutes'),
    ('30303030-1111-1111-1111-111111111111', 'pending', 'Task created', NOW() - INTERVAL '2 days'),
    ('30303030-1111-1111-1111-111111111111', 'processing', 'Retry attempt 1', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes'),
    ('30303030-1111-1111-1111-111111111111', 'processing', 'Retry attempt 2', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes' + INTERVAL '30 seconds'),
    ('30303030-1111-1111-1111-111111111111', 'processing', 'Retry attempt 3', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes' + INTERVAL '60 seconds'),
    ('30303030-1111-1111-1111-111111111111', 'failed', 'Max attempts reached', NOW() - INTERVAL '2 days' + INTERVAL '3 minutes');

-- =============================================
-- Seed System Statistics
-- =============================================

INSERT INTO system_stats (metric_name, metric_value, recorded_at, metadata) VALUES
    ('total_tasks', 9, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('completed_tasks', 5, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('failed_tasks', 1, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('avg_processing_time_ms', 4172.8, NOW() - INTERVAL '1 hour', '{"period": "last_24h"}'),
    ('total_users', 7, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('active_users', 6, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('total_storage_bytes', 12319542, NOW() - INTERVAL '1 hour', '{"period": "lifetime"}'),
    ('avg_confidence_score', 0.8939, NOW() - INTERVAL '1 hour', '{"period": "last_24h"}');

COMMIT;

-- Display summary
SELECT 'Seed data inserted successfully!' as message;
SELECT 'Users:' as summary, COUNT(*) as count FROM users
UNION ALL
SELECT 'Files:', COUNT(*) FROM files
UNION ALL
SELECT 'Tasks:', COUNT(*) FROM tasks
UNION ALL
SELECT 'Results:', COUNT(*) FROM results
UNION ALL
SELECT 'Task History:', COUNT(*) FROM task_history
UNION ALL
SELECT 'System Stats:', COUNT(*) FROM system_stats;
