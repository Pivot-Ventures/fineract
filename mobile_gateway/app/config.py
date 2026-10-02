"""Gateway settings, read once from the environment."""

import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


@dataclass(frozen=True)
class Settings:
    # Fineract, reached over the private network. The service user should hold only the
    # read + account-transfer permissions listed in README.md, never a superuser role.
    fineract_url: str = field(default_factory=lambda: _env("FINERACT_URL").rstrip("/"))
    fineract_tenant: str = field(default_factory=lambda: _env("FINERACT_TENANT", "default"))
    fineract_user: str = field(default_factory=lambda: _env("FINERACT_USER"))
    fineract_password: str = field(default_factory=lambda: _env("FINERACT_PASSWORD"))
    # Only for a local dev Fineract with a self-signed certificate.
    fineract_verify_tls: bool = field(
        default_factory=lambda: _env("FINERACT_VERIFY_TLS", "true").lower() != "false")
    tenant_tz: str = field(default_factory=lambda: _env("TENANT_TZ", "Africa/Kampala"))

    db_path: str = field(default_factory=lambda: _env("GATEWAY_DB", "/data/gateway.sqlite3"))

    # Sessions: short idle timeout, hard cap on lifetime.
    session_idle_seconds: int = field(default_factory=lambda: int(_env("SESSION_IDLE_SECONDS", "300")))
    session_max_seconds: int = field(default_factory=lambda: int(_env("SESSION_MAX_SECONDS", "3600")))

    # PIN lockout: a temporary lock after N failures, a permanent block (staff reset) after M.
    pin_lock_after: int = field(default_factory=lambda: int(_env("PIN_LOCK_AFTER", "3")))
    pin_lock_minutes: int = field(default_factory=lambda: int(_env("PIN_LOCK_MINUTES", "30")))
    pin_block_after: int = field(default_factory=lambda: int(_env("PIN_BLOCK_AFTER", "6")))

    activation_code_hours: int = field(default_factory=lambda: int(_env("ACTIVATION_CODE_HOURS", "24")))

    # Money limits in the tenant currency (UGX). Pending Board sign-off — see README.md.
    limit_per_txn: int = field(default_factory=lambda: int(_env("LIMIT_PER_TXN", "2000000")))
    limit_per_day: int = field(default_factory=lambda: int(_env("LIMIT_PER_DAY", "5000000")))

    # Mobile-money deposits: "" (off) or "sandbox" (simulated approvals — demo only, never production).
    momo_provider: str = field(default_factory=lambda: _env("MOMO_PROVIDER", "").lower())
    # Fineract payment type ids used when crediting a mobile-money deposit.
    momo_payment_type_mtn: int = field(default_factory=lambda: int(_env("MOMO_PAYMENT_TYPE_MTN", "1")))
    momo_payment_type_airtel: int = field(default_factory=lambda: int(_env("MOMO_PAYMENT_TYPE_AIRTEL", "1")))
    momo_min_deposit: int = field(default_factory=lambda: int(_env("MOMO_MIN_DEPOSIT", "1000")))
    momo_max_deposit: int = field(default_factory=lambda: int(_env("MOMO_MAX_DEPOSIT", "5000000")))

    # Transactional alerts service (SMS), server to server. Off unless both are set.
    alerts_url: str = field(default_factory=lambda: _env("ALERTS_URL", "").rstrip("/"))
    alerts_service_key: str = field(default_factory=lambda: _env("ALERTS_SERVICE_KEY", ""))

    # Staff permission required to enrol, reset or block members (checked against Fineract).
    staff_permission: str = field(default_factory=lambda: _env("STAFF_PERMISSION", "UPDATE_CLIENT"))


settings: Settings | None = None


def get_settings() -> Settings:
    global settings
    if settings is None:
        settings = Settings()
    return settings
