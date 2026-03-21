from app.database import SessionLocal
from app import models

def seed():
    db = SessionLocal()
    try:
        # Check if countries exist
        if db.query(models.Country).count() == 0:
            print("Seeding countries...")
            countries = [
                models.Country(name="United States", iso_code="US", region="Americas"),
                models.Country(name="United Kingdom", iso_code="GB", region="Europe"),
                models.Country(name="India", iso_code="IN", region="Asia"),
                models.Country(name="France", iso_code="FR", region="Europe"),
                models.Country(name="Germany", iso_code="DE", region="Europe"),
            ]
            db.add_all(countries)
            db.commit()
            print("Seeding completed.")
        else:
            print("Database already has countries.")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
