#!/bin/bash

###############################################################################
# Test Direct Database Changes
# This script modifies the database directly to simulate admin changes
# The frontend should pick up these changes via polling
###############################################################################

echo "Testing direct database modifications..."
echo ""

# Test 1: Update a task status directly
echo "Test 1: Updating task status via SQL..."
psql -U ocr_platform_user -d ocr_platform_dev << EOF
-- Find a completed task and change it to 'pending' (for demo)
UPDATE tasks
SET status = 'pending', updated_at = NOW()
WHERE status = 'completed'
LIMIT 1
RETURNING id, status;
EOF

echo ""
echo "✓ Task status updated directly in database"
echo "  Check your browser - should update within 5 seconds"
echo ""
read -p "Press Enter to continue to next test..."

# Test 2: Delete a task directly
echo ""
echo "Test 2: Deleting a task via SQL..."
psql -U ocr_platform_user -d ocr_platform_dev << EOF
-- Find a task to delete (oldest one)
WITH deleted AS (
  DELETE FROM tasks
  WHERE id = (
    SELECT id FROM tasks
    ORDER BY created_at ASC
    LIMIT 1
  )
  RETURNING id, user_id
)
SELECT * FROM deleted;
EOF

echo ""
echo "✓ Task deleted directly from database"
echo "  Check your browser - should disappear within 5 seconds"
echo ""
read -p "Press Enter to continue to next test..."

# Test 3: Show current task count
echo ""
echo "Test 3: Current task statistics..."
psql -U ocr_platform_user -d ocr_platform_dev << EOF
SELECT
  COUNT(*) as total_tasks,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'processing') as processing,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM tasks;
EOF

echo ""
echo "✓ Browser stats should match these numbers within 5 seconds"
echo ""
echo "All tests complete!"
echo ""
echo "Note: The frontend polls every 5 seconds, so changes may take"
echo "      up to 5 seconds to appear in the UI."
