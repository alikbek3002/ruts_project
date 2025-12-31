"""
Тесты для загрузки файлов в библиотеку
Запуск: pytest tests/test_library_upload.py -v
"""
import os

import pytest
from io import BytesIO
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# Для эндпоинтов с авторизацией нужен валидный JWT.
# Чтобы прогнать auth-required тесты локально, установите RUTS_TEST_TEACHER_TOKEN.
TEACHER_TOKEN = os.getenv("RUTS_TEST_TEACHER_TOKEN")


class TestLibraryUpload:
    """Тесты загрузки файлов"""
    
    def test_upload_file_success(self):
        """Тест успешной загрузки файла"""
        if not TEACHER_TOKEN:
            pytest.skip("Set RUTS_TEST_TEACHER_TOKEN to run auth-required upload tests")
        # Создаем тестовый файл
        file_content = b"Test file content for library"
        file = BytesIO(file_content)
        
        response = client.post(
            "/api/library/upload",
            headers={"Authorization": f"Bearer {TEACHER_TOKEN}"},
            files={"file": ("test.pdf", file, "application/pdf")},
            data={
                "title": "Test Document",
                "description": "Test description",
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "item" in data
        assert "originalFilename" in data
        assert data["item"]["title"] == "Test Document"
    
    def test_upload_without_auth(self):
        """Тест загрузки без авторизации"""
        file = BytesIO(b"test")
        
        response = client.post(
            "/api/library/upload",
            files={"file": ("test.txt", file, "text/plain")},
            data={"title": "Test"}
        )
        
        assert response.status_code == 401
    
    def test_upload_missing_title(self):
        """Тест загрузки без обязательного поля title"""
        if not TEACHER_TOKEN:
            pytest.skip("Set RUTS_TEST_TEACHER_TOKEN to run auth-required upload tests")
        file = BytesIO(b"test")
        
        response = client.post(
            "/api/library/upload",
            headers={"Authorization": f"Bearer {TEACHER_TOKEN}"},
            files={"file": ("test.txt", file, "text/plain")},
            data={}
        )
        
        assert response.status_code == 422  # Validation error


class TestLibraryDownload:
    """Тесты скачивания файлов"""
    
    def test_get_download_url_without_auth(self):
        """Тест получения URL без авторизации"""
        response = client.get("/api/library/fake-id/download-url")
        assert response.status_code == 401
    
    def test_get_download_url_invalid_id(self):
        """Тест получения URL для несуществующего файла"""
        response = client.get(
            "/api/library/00000000-0000-0000-0000-000000000000/download-url",
            headers={"Authorization": f"Bearer {TEACHER_TOKEN}"}
        )
        assert response.status_code in [404, 401]


class TestLibraryDelete:
    """Тесты удаления файлов"""
    
    def test_delete_without_auth(self):
        """Тест удаления без авторизации"""
        response = client.delete("/api/library/fake-id")
        assert response.status_code == 401


print("""
╔════════════════════════════════════════════════════════════╗
║  MANUAL TESTING GUIDE - Library Upload Feature            ║
╚════════════════════════════════════════════════════════════╝

1. Откройте браузер: http://localhost:5173
2. Войдите как teacher (username: teacher, password: из bootstrap)
3. Перейдите в "Библиотека" (/app/teacher/library)

ТЕСТ 1: Drag & Drop загрузка
────────────────────────────────
□ Перетащите файл в зону загрузки
□ Проверьте, что название заполнилось автоматически
□ Введите описание
□ Нажмите "Загрузить файл"
□ Проверьте прогресс-бар (0-100%)
□ Проверьте сообщение об успехе

ТЕСТ 2: Выбор файла кнопкой
────────────────────────────────
□ Нажмите на зону загрузки
□ Выберите файл через диалог
□ Загрузите файл

ТЕСТ 3: Скачивание файла
────────────────────────────────
□ Нажмите кнопку "Скачать" у файла
□ Проверьте, что файл скачался корректно

ТЕСТ 4: Удаление файла
────────────────────────────────
□ Нажмите кнопку "Удалить"
□ Подтвердите удаление
□ Проверьте, что файл исчез из списка

ТЕСТ 5: Фильтр по классам
────────────────────────────────
□ Выберите класс из dropdown
□ Загрузите файл для этого класса
□ Проверьте, что файл виден только для этого класса

ТЕСТ 6: Просмотр студентом
────────────────────────────────
□ Войдите как student
□ Перейдите в /app/student/library
□ Проверьте, что файлы видны
□ Скачайте файл
□ Проверьте, что кнопка "Удалить" недоступна

Ожидаемые результаты:
✓ Файлы загружаются с прогресс-баром
✓ Drag & Drop работает плавно
✓ Скачивание работает через подписанные URL
✓ Студенты не могут удалять файлы
✓ Учителя видят все свои файлы
""")
