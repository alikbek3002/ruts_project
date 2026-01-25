// Navigation items for Admin/Manager panel
import type { I18nKey } from "../i18n/i18n";

type NavItem = { to: string; labelKey: I18nKey };

export function getAdminNavItems(base: string): NavItem[] {
    return [
        { to: base, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/meetings`, labelKey: "nav.meetings" },
        { to: `${base}/directions`, labelKey: "nav.directions" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
        { to: `${base}/workload`, labelKey: "nav.workload" },
        { to: `${base}/notifications`, labelKey: "nav.notifications" },
        { to: `${base}/archive`, labelKey: "nav.archive" },
        { to: `${base}/cycles`, labelKey: "nav.cycles" },
    ];
}

export function getTeacherNavItems(): NavItem[] {
    return [
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
    ];
}

export function getStudentNavItems(): NavItem[] {
    return [
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/teachers", labelKey: "nav.teachers" },
    ];
}
