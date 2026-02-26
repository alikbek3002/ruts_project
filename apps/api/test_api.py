import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'apps', 'api'))

from app.modules.gradebook.router import class_journal_by_subject, class_journal_by_dates, export_grades_excel

class_id = "65e243cc-8093-43e7-aa87-29965ce27046"
user = {"id": "test_teacher_id", "role": "teacher"}

try:
    print("Testing class_journal_by_dates")
    res1 = class_journal_by_dates(class_id, user)
    print("OK class_journal_by_dates keys:", list(res1.keys()))
except Exception as e:
    import traceback
    traceback.print_exc()

try:
    print("\nTesting class_journal_by_subject")
    res2 = class_journal_by_subject(class_id, user)
    print("OK class_journal_by_subject keys:", list(res2.keys()))
except Exception as e:
    import traceback
    traceback.print_exc()

try:
    print("\nTesting export_grades_excel")
    res3 = export_grades_excel(class_id, user)
    print("OK export_grades_excel")
except Exception as e:
    import traceback
    traceback.print_exc()
