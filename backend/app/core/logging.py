import logging
import logging.config

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    settings.log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "json": {
                    "format": '{"level":"%(levelname)s","time":"%(asctime)s","logger":"%(name)s","message":"%(message)s"}'
                }
            },
            "handlers": {
                "console": {"class": "logging.StreamHandler", "formatter": "json"},
                "file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": settings.log_path,
                    "maxBytes": 5_000_000,
                    "backupCount": 3,
                    "formatter": "json",
                },
            },
            "root": {"level": "INFO", "handlers": ["console", "file"]},
        }
    )
