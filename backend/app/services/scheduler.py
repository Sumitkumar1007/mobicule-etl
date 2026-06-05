import logging
import threading
from datetime import datetime

from app.core.config import get_settings
from app.db.database import db
from app.services.runner import enqueue_run

logger = logging.getLogger(__name__)

_stop_event = threading.Event()
_thread: threading.Thread | None = None
_last_run_keys: set[tuple[int, str]] = set()
_SCHEDULER_LOCK_KEY = 741903211


def start_scheduler() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_loop, name="pipeline-scheduler", daemon=True)
    _thread.start()
    logger.info("Pipeline scheduler started")


def stop_scheduler() -> None:
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=2)


def _loop() -> None:
    while not _stop_event.wait(15):
        try:
            run_due_pipelines()
        except Exception:
            logger.exception("Pipeline scheduler tick failed")


def run_due_pipelines(now: datetime | None = None) -> list[int]:
    current = now or datetime.now()
    due_ids: list[int] = []
    with db() as conn:
        if not _try_scheduler_lock(conn):
            logger.info("Scheduler tick skipped because another instance holds the lock")
            return []
        rows = conn.execute(
            """
            SELECT id, schedule
            FROM pipelines
            WHERE enabled=1 AND schedule IS NOT NULL AND schedule <> ''
            """
        ).fetchall()
        for row in rows:
            pipeline_id = int(dict(row)["id"])
            schedule = str(dict(row)["schedule"] or "").strip()
            run_key = (pipeline_id, current.strftime("%Y-%m-%d %H:%M"))
            if run_key in _last_run_keys:
                continue
            if _cron_matches(schedule, current):
                enqueue_run(pipeline_id, job_type="scheduled", triggered_by="scheduler")
                _last_run_keys.add(run_key)
                due_ids.append(pipeline_id)
                logger.info("Scheduled pipeline %s from cron %s", pipeline_id, schedule)
    _trim_run_keys(current)
    return due_ids


def _try_scheduler_lock(conn) -> bool:
    settings = get_settings()
    if not settings.scheduler_lock_enabled:
        return True
    try:
        row = conn.execute("SELECT pg_try_advisory_lock(?) AS locked", (_SCHEDULER_LOCK_KEY,)).fetchone()
        return bool(dict(row).get("locked")) if row else False
    except Exception:
        logger.exception("Failed to acquire scheduler advisory lock")
        return not settings.is_production


def _cron_matches(schedule: str, current: datetime) -> bool:
    parts = schedule.split()
    if len(parts) != 5:
        return False
    minute, hour, day, month, weekday = parts
    return (
        _field_matches(minute, current.minute, 0, 59)
        and _field_matches(hour, current.hour, 0, 23)
        and _field_matches(day, current.day, 1, 31)
        and _field_matches(month, current.month, 1, 12)
        and _field_matches(weekday, (current.weekday() + 1) % 7, 0, 6)
    )


def _field_matches(field: str, value: int, minimum: int, maximum: int) -> bool:
    if field == "*":
        return True
    for part in field.split(","):
        part = part.strip()
        if part.startswith("*/"):
            if not part[2:].isdigit():
                return False
            step = int(part[2:])
            return step > 0 and (value - minimum) % step == 0
        if "-" in part:
            bounds = part.split("-", 1)
            if not all(item.isdigit() for item in bounds):
                return False
            start, end = [int(item) for item in bounds]
            if start <= value <= end:
                return True
        elif part.isdigit() and int(part) == value:
            return True
    return False


def _trim_run_keys(current: datetime) -> None:
    current_prefix = current.strftime("%Y-%m-%d %H")
    stale = {key for key in _last_run_keys if not key[1].startswith(current_prefix)}
    _last_run_keys.difference_update(stale)
