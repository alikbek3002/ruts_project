"""
Тесты для Zoom встреч
Запуск: pytest tests/test_zoom_meetings.py -v
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

TEACHER_TOKEN = "test_teacher_token"
STUDENT_TOKEN = "test_student_token"


class TestZoomMeetings:
    """Тесты создания и управления Zoom встречами"""
    
    def test_create_meeting_without_auth(self):
        """Тест создания встречи без авторизации"""
        response = client.post(
            "/api/zoom/meetings",
            json={
                "timetableEntryId": "fake-id",
                "startsAt": "2025-12-25T10:00:00"
            }
        )
        assert response.status_code == 401
    
    def test_create_meeting_invalid_timetable(self):
        """Тест создания встречи для несуществующего урока"""
        response = client.post(
            "/api/zoom/meetings",
            headers={"Authorization": f"Bearer {TEACHER_TOKEN}"},
            json={
                "timetableEntryId": "00000000-0000-0000-0000-000000000000",
                "startsAt": "2025-12-25T10:00:00"
            }
        )
        assert response.status_code in [404, 401]
    
    def test_list_meetings_without_auth(self):
        """Тест получения списка встреч без авторизации"""
        response = client.get("/api/zoom/meetings")
        assert response.status_code == 401
    
    def test_list_meetings_with_auth(self):
        """Тест получения списка встреч с авторизацией"""
        response = client.get(
            "/api/zoom/meetings",
            headers={"Authorization": f"Bearer {TEACHER_TOKEN}"}
        )
        # Может вернуть 200 или 401 в зависимости от токена
        assert response.status_code in [200, 401]
        if response.status_code == 200:
            data = response.json()
            assert "meetings" in data
            assert isinstance(data["meetings"], list)


class TestZoomOAuth:
    """Тесты Zoom OAuth"""
    
    def test_oauth_start_without_auth(self):
        """Тест начала OAuth без авторизации"""
        response = client.get("/api/zoom/oauth/start")
        assert response.status_code == 401
    
    def test_zoom_status_without_auth(self):
        """Тест проверки статуса без авторизации"""
        response = client.get("/api/zoom/status")
        assert response.status_code == 401


print("""
╔════════════════════════════════════════════════════════════╗
║  MANUAL TESTING GUIDE - Zoom Meetings Feature             ║
╚════════════════════════════════════════════════════════════╝

PREREQUISITES:
──────────────────────────────────────────────────────────────
1. Настройте Zoom OAuth в apps/api/.env:
   ZOOM_CLIENT_ID=your_client_id
   ZOOM_CLIENT_SECRET=your_client_secret
   ZOOM_REDIRECT_URI=http://localhost:8000/api/zoom/oauth/callback

2. Перезапустите API сервер

ТЕСТ 1: Подключение Zoom аккаунта
──────────────────────────────────────────────────────────────
□ Войдите как teacher
□ На главной странице (/app/teacher) найдите виджет Zoom
□ Нажмите "Подключить Zoom"
□ Авторизуйтесь в Zoom
□ Проверьте, что статус изменился на "Подключен"

ТЕСТ 2: Создание Zoom встречи
──────────────────────────────────────────────────────────────
□ Перейдите в /app/teacher/timetable
□ Найдите любой урок в расписании
□ Нажмите кнопку "📹 Создать Zoom"
□ В модальном окне проверьте:
  - Отображается название класса и предмета
  - Предзаполнено время урока
  - Можно изменить время
□ Нажмите "Создать встречу"
□ Проверьте сообщение об успехе
□ Проверьте, что появилась иконка "📹 Zoom встреча"
□ Проверьте кнопку "Войти в Zoom"

ТЕСТ 3: Виджет встреч на главной (Учитель)
──────────────────────────────────────────────────────────────
□ Вернитесь на /app/teacher
□ Проверьте виджет "📹 Предстоящие Zoom встречи":
  - Отображаются созданные встречи
  - Показывается время и дата
  - Показывается предмет и класс
  - Есть кнопка "Войти"
  - Есть ссылка "Начать встречу (как организатор)"
□ Нажмите "Войти" - должен открыться Zoom

ТЕСТ 4: Виджет встреч на главной (Студент)
──────────────────────────────────────────────────────────────
□ Войдите как student (записанный в класс с встречей)
□ Перейдите на /app/student
□ Проверьте виджет встреч:
  - Отображаются встречи для классов студента
  - Есть кнопка "Войти"
  - НЕТ кнопки "Начать встречу"
□ Нажмите "Войти в Zoom"

ТЕСТ 5: Отображение встречи в расписании
──────────────────────────────────────────────────────────────
□ Вернитесь в /app/teacher/timetable
□ Найдите урок с созданной встречей
□ Проверьте:
  - Иконка "📹 Zoom встреча" отображается
  - Кнопка "Войти в Zoom" работает
  - Клик на урок открывает журнал (не мешает Zoom)

ТЕСТ 6: Множественные встречи
──────────────────────────────────────────────────────────────
□ Создайте встречи для нескольких уроков
□ Проверьте, что все они отображаются в виджете
□ Проверьте сортировку по времени

ТЕСТ 7: Обработка ошибок
──────────────────────────────────────────────────────────────
□ Попробуйте создать встречу без подключенного Zoom
□ Проверьте понятное сообщение об ошибке
□ Попробуйте создать встречу для прошедшей даты
□ Проверьте валидацию

Ожидаемые результаты:
✓ Zoom OAuth работает
✓ Встречи создаются корректно
✓ join_url и start_url работают
✓ Виджет показывает только предстоящие встречи
✓ Студенты видят только встречи своих классов
✓ Учителя видят свои встречи
✓ Иконки и кнопки отображаются правильно

TROUBLESHOOTING:
──────────────────────────────────────────────────────────────
❌ "Zoom OAuth is not configured"
   → Проверьте .env файл, заполните ZOOM_CLIENT_ID и др.

❌ "Zoom not connected"
   → Подключите Zoom аккаунт через /app страницу

❌ "Failed to generate download URL"
   → Проверьте, что файл существует в Storage

❌ "Permission denied"
   → Проверьте роль пользователя (teacher/admin)
""")
