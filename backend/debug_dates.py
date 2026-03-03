#!/usr/bin/env python3
"""
Quick debug script to check what dates are actually in your database.
Run this to see the current state before applying fixes.
"""

from db import get_db
from datetime import datetime
import json


def analyze_dates():
    conn = get_db()
    cur = conn.cursor()

    print("\n" + "=" * 80)
    print("CANVAS ORGANIZER - DATE ANALYSIS")
    print("=" * 80 + "\n")

    # Get all courses
    cur.execute("""
        SELECT DISTINCT course_id 
        FROM assignments_normalized
    """)
    courses = [row[0] for row in cur.fetchall()]

    print(f"Found {len(courses)} courses\n")

    for course_id in courses:
        print(f"\n{'─' * 80}")
        print(f"Course: {course_id}")
        print('─' * 80)

        cur.execute("""
            SELECT 
                name,
                original_due_at,
                normalized_due_at,
                source_of_truth,
                status,
                category
            FROM assignments_normalized
            WHERE course_id = ?
            ORDER BY 
                CASE WHEN normalized_due_at IS NULL THEN 1 ELSE 0 END,
                normalized_due_at
            LIMIT 20
        """, (course_id,))

        assignments = cur.fetchall()

        if not assignments:
            print("  No assignments found")
            continue

        issues = {
            'no_date': [],
            'no_timezone': [],
            'parse_error': [],
            'future_far': [],
            'past_far': [],
            'ok': []
        }

        for a in assignments:
            name = a[0]
            original = a[1]
            normalized = a[2]
            source = a[3]
            status = a[4]
            category = a[5]

            # Check what's wrong with this date
            if not normalized:
                issues['no_date'].append((name, original, normalized, source, status))
                continue

            # Check if it has timezone info
            if 'T' not in normalized or ('+' not in normalized and 'Z' not in normalized and normalized.count('-') < 3):
                issues['no_timezone'].append((name, original, normalized, source, status))
                continue

            # Try to parse it
            try:
                if normalized.endswith('Z'):
                    dt = datetime.fromisoformat(normalized.replace('Z', '+00:00'))
                else:
                    dt = datetime.fromisoformat(normalized)

                year = dt.year
                now = datetime.now()

                # Check if unreasonably far in past/future
                if year < 2024:
                    issues['past_far'].append((name, original, normalized, source, status))
                elif year > 2026:
                    issues['future_far'].append((name, original, normalized, source, status))
                else:
                    issues['ok'].append((name, original, normalized, source, status))

            except Exception as e:
                issues['parse_error'].append((name, original, normalized, source, status, str(e)))

        # Print summary
        print(f"\n  Summary:")
        print(f"    ✅ OK: {len(issues['ok'])}")
        print(f"    ⚠️  No date: {len(issues['no_date'])}")
        print(f"    ⚠️  No timezone: {len(issues['no_timezone'])}")
        print(f"    ❌ Parse error: {len(issues['parse_error'])}")
        print(f"    ⚠️  Year < 2024: {len(issues['past_far'])}")
        print(f"    ⚠️  Year > 2026: {len(issues['future_far'])}")

        # Show details for problems
        if issues['no_date']:
            print(f"\n  ⚠️  Assignments with NO DATE:")
            for item in issues['no_date'][:5]:
                print(f"    • {item[0][:50]}")
                print(f"      Original: {item[1]}")
                print(f"      Status: {item[4]}")

        if issues['no_timezone']:
            print(f"\n  ⚠️  Assignments with NO TIMEZONE:")
            for item in issues['no_timezone'][:5]:
                print(f"    • {item[0][:50]}")
                print(f"      Date: {item[2]}")
                print(f"      Source: {item[3]}")

        if issues['parse_error']:
            print(f"\n  ❌ Assignments with PARSE ERRORS:")
            for item in issues['parse_error'][:5]:
                print(f"    • {item[0][:50]}")
                print(f"      Date: {item[2]}")
                print(f"      Error: {item[5]}")

        if issues['past_far']:
            print(f"\n  ⚠️  Assignments with OLD DATES:")
            for item in issues['past_far'][:5]:
                print(f"    • {item[0][:50]}")
                print(f"      Date: {item[2]}")

        if issues['future_far']:
            print(f"\n  ⚠️  Assignments with FUTURE DATES:")
            for item in issues['future_far'][:5]:
                print(f"    • {item[0][:50]}")
                print(f"      Date: {item[2]}")

        # Show a few OK examples
        if issues['ok']:
            print(f"\n  ✅ Sample GOOD dates:")
            for item in issues['ok'][:3]:
                print(f"    • {item[0][:50]}")
                print(f"      Date: {item[2]}")
                print(f"      Source: {item[3]}")

    conn.close()

    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    analyze_dates()