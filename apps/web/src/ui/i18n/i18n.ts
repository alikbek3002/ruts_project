export type Lang = "ru" | "ky";

export type I18nKey =
  | "lang.ru"
  | "lang.ky"
  | "common.select"
  | "common.delete"
  | "common.deleteConfirm"
  | "common.save"
  | "common.cancel"
  | "common.loading"
  | "common.refresh"
  | "common.download"
  | "common.export"
  | "common.search"
  | "common.add"
  | "common.edit"
  | "common.yes"
  | "common.no"
  | "common.error"
  | "common.success"
  | "nav.home"
  | "nav.journal"
  | "nav.timetable"
  | "nav.library"
  | "nav.grades"
  | "nav.users"
  | "nav.classes"
  | "nav.logout"
  | "admin.timetable.title"
  | "admin.nav.home"
  | "admin.nav.users"
  | "admin.nav.classes"
  | "admin.nav.timetable"
  | "timetable.group"
  | "timetable.groupShort"
  | "timetable.selectGroup"
  | "timetable.prevWeek"
  | "timetable.nextWeek"
  | "timetable.addLesson"
  | "timetable.editLesson"
  | "timetable.teacher"
  | "timetable.subject"
  | "timetable.room"
  | "timetable.cancel"
  | "timetable.save"
  | "timetable.subjectPlaceholder"
  | "timetable.roomPlaceholder"
  | "timetable.lunch"
  | "journal.title"
  | "journal.selectClass"
  | "journal.student"
  | "journal.average"
  | "journal.addGrade"
  | "journal.downloadExcel"
  | "teacher.title"
  | "teacher.journal"
  | "student.title"
  | "student.myGrades"
  | "role.student"
  | "role.teacher"
  | "role.admin"
  | "login.title"
  | "login.username"
  | "login.password"
  | "login.submit"
  | "login.error";

const ru: Record<I18nKey, string> = {
  "lang.ru": "Русский",
  "lang.ky": "Кыргызча",
  "common.select": "(выберите)",
  "common.delete": "Удалить",
  "common.deleteConfirm": "Удалить?",
  "common.save": "Сохранить",
  "common.cancel": "Отмена",
  "common.loading": "Загрузка...",
  "common.refresh": "Обновить",
  "common.download": "Скачать",
  "common.export": "Экспорт",
  "common.search": "Поиск",
  "common.add": "Добавить",
  "common.edit": "Редактировать",
  "common.yes": "Да",
  "common.no": "Нет",
  "common.error": "Ошибка",
  "common.success": "Успешно",
  "nav.home": "Главная",
  "nav.journal": "Журнал",
  "nav.timetable": "Расписание",
  "nav.library": "Библиотека",
  "nav.grades": "Оценки",
  "nav.users": "Пользователи",
  "nav.classes": "Классы",
  "nav.logout": "Выйти",

  "admin.timetable.title": "Админ → Расписание",
  "admin.nav.home": "Админ",
  "admin.nav.users": "Пользователи",
  "admin.nav.classes": "Группы",
  "admin.nav.timetable": "Расписание",

  "timetable.group": "Группа",
  "timetable.groupShort": "Группа:",
  "timetable.selectGroup": "Выберите группу",
  "timetable.prevWeek": "← Пред. неделя",
  "timetable.nextWeek": "След. неделя →",
  "timetable.addLesson": "Добавить занятие",
  "timetable.editLesson": "Редактировать занятие",
  "timetable.teacher": "Преподаватель",
  "timetable.subject": "Предмет",
  "timetable.room": "Аудитория",
  "timetable.cancel": "Отмена",
  "timetable.save": "Сохранить",
  "timetable.subjectPlaceholder": "Название предмета",
  "timetable.roomPlaceholder": "Например, C403",
  "timetable.lunch": "Обед",

  "journal.title": "Журнал оценок",
  "journal.selectClass": "Выберите класс",
  "journal.student": "Ученик",
  "journal.average": "Средний",
  "journal.addGrade": "Добавить оценку",
  "journal.downloadExcel": "Скачать Excel",

  "teacher.title": "Учитель",
  "teacher.journal": "Журнал",

  "student.title": "Ученик",
  "student.myGrades": "Мои оценки",
  "role.student": "Ученик",
  "role.teacher": "Преподаватель",
  "role.admin": "Администратор",

  "login.title": "Вход в систему",
  "login.username": "Логин",
  "login.password": "Пароль",
  "login.submit": "Войти",
  "login.error": "Неверный логин или пароль",
};

const ky: Record<I18nKey, string> = {
  "lang.ru": "Русский",
  "lang.ky": "Кыргызча",
  "common.select": "(тандаңыз)",
  "common.delete": "Өчүрүү",
  "common.deleteConfirm": "Өчүрөсүзбү?",
  "common.save": "Сактоо",
  "common.cancel": "Жокко чыгаруу",
  "common.loading": "Жүктөлүүдө...",
  "common.refresh": "Жаңылоо",
  "common.download": "Жүктөп алуу",
  "common.export": "Экспорт",
  "common.search": "Издөө",
  "common.add": "Кошуу",
  "common.edit": "Өзгөртүү",
  "common.yes": "Ооба",
  "common.no": "Жок",
  "common.error": "Ката",
  "common.success": "Ийгиликтүү",
  "nav.home": "Башкы бет",
  "nav.journal": "Журнал",
  "nav.timetable": "Сабак жадвалы",
  "nav.library": "Китепкана",
  "nav.grades": "Баалар",
  "nav.users": "Колдонуучулар",
  "nav.classes": "Класстар",
  "nav.logout": "Чыгуу",

  "admin.timetable.title": "Админ → Сабактардын жадвали",
  "admin.nav.home": "Админ",
  "admin.nav.users": "Колдонуучулар",
  "admin.nav.classes": "Топтор",
  "admin.nav.timetable": "Жадвал",

  "timetable.group": "Топ",
  "timetable.groupShort": "Топ:",
  "timetable.selectGroup": "Топту тандаңыз",
  "timetable.prevWeek": "← Мурунку жума",
  "timetable.nextWeek": "Кийинки жума →",
  "timetable.addLesson": "Сабак кошуу",
  "timetable.editLesson": "Сабакты оңдоо",
  "timetable.teacher": "Мугалим",
  "timetable.subject": "Предмет",
  "timetable.room": "Аудитория",
  "timetable.cancel": "Жокко чыгаруу",
  "timetable.save": "Сактоо",
  "timetable.subjectPlaceholder": "Предметтин аталышы",
  "timetable.roomPlaceholder": "Мисалы, C403",
  "timetable.lunch": "Түшкү тыныгуу",

  "journal.title": "Баалар журналы",
  "journal.selectClass": "Классты тандаңыз",
  "journal.student": "Окуучу",
  "journal.average": "Орточо",
  "journal.addGrade": "Баа кошуу",
  "journal.downloadExcel": "Excel жүктөө",

  "teacher.title": "Мугалим",
  "teacher.journal": "Журнал",

  "student.title": "Талапкер",
  "student.myGrades": "Менин бааларым",
  "role.student": "Талапкер",
  "role.teacher": "Мугалим",
  "role.admin": "Админ",

  "login.title": "Системага кирүү",
  "login.username": "Логин",
  "login.password": "Сыр сөз",
  "login.submit": "Кирүү",
  "login.error": "Туура эмес логин же сыр сөз",
};

export const dict: Record<Lang, Record<I18nKey, string>> = { ru, ky };
