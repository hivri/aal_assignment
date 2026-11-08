import os

from dotenv import load_dotenv
from sqlalchemy.orm import Session

from pathlib import Path

import models
from db import engine, Base, SessionLocal
from auth import hash_password


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

Base.metadata.create_all(bind=engine)


def seed_user(db: Session, name: str, email: str, password: str, role: str):
    existing_user = db.query(models.User).filter(models.User.email == email).first()

    if existing_user:
        print(f"Already exists: {email}")
        return

    user = models.User(
        name=name,
        email=email,
        hashed_password=hash_password(password),
        role=role,
        is_active=True,
    )

    db.add(user)
    db.commit()

    print(f"Created {role}: {email}")


def main():
    db = SessionLocal()

    try:
        demo_users = [
            (
                "SEED_ADMIN_NAME",
                "SEED_ADMIN_EMAIL",
                "SEED_ADMIN_PASSWORD",
                "admin",
            ),
            (
                "SEED_SALES_NAME",
                "SEED_SALES_EMAIL",
                "SEED_SALES_PASSWORD",
                "sales_rep",
            ),
            (
                "SEED_DELIVERY_NAME",
                "SEED_DELIVERY_EMAIL",
                "SEED_DELIVERY_PASSWORD",
                "delivery_member",
            ),
        ]

        for name_key, email_key, password_key, role in demo_users:
            name = os.getenv(name_key)
            email = os.getenv(email_key)
            password = os.getenv(password_key)

            if not all([name, email, password]):
                raise RuntimeError(f"Missing seed configuration for role: {role}")

            seed_user(db, name, email, password, role)

    finally:
        db.close()


if __name__ == "__main__":
    main()
