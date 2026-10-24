"""Bootstrap the PostgreSQL database and app role in one command.

    python scripts/create_db.py --admin-url postgresql://postgres:ADMIN_PASS@localhost:5433/postgres \
        --password APP_PASS [--user recipe_user] [--db recipe_manager] [--with-test-db]

Creates (if missing) the login role, the database owned by it, and with --with-test-db a
second database "<db>_test" for `TEST_DATABASE_URL` pytest runs. Re-running is safe; an
existing role gets its password updated. Prints the DATABASE_URL to put in backend/.env.
"""

import argparse
import sys

import psycopg
from psycopg import sql


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the recipe_manager database and app role")
    parser.add_argument("--admin-url", required=True, help="superuser connection, e.g. postgresql://postgres:PASS@localhost:5433/postgres")
    parser.add_argument("--user", default="recipe_user")
    parser.add_argument("--password", required=True, help="password for the app role")
    parser.add_argument("--db", default="recipe_manager")
    parser.add_argument("--with-test-db", action="store_true", help="also create <db>_test for the pytest suite")
    args = parser.parse_args(argv)

    admin_url = args.admin_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (args.user,)).fetchone()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(sql.SQL(verb + " ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(args.user), sql.Literal(args.password)))
        print(f"{'Updated' if exists else 'Created'} role {args.user}")
        databases = [args.db] + ([f"{args.db}_test"] if args.with_test_db else [])
        for name in databases:
            if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
                print(f"Database {name} already exists")
                continue
            conn.execute(sql.SQL("CREATE DATABASE {} OWNER {} ENCODING 'UTF8' TEMPLATE template0").format(
                sql.Identifier(name), sql.Identifier(args.user)))
            print(f"Created database {name} (owner {args.user})")

    host_part = admin_url.split("@", 1)[1].rsplit("/", 1)[0] if "@" in admin_url else "localhost:5433"
    print("\nPut this in backend/.env:")
    print(f"DATABASE_URL=postgresql+psycopg://{args.user}:<password>@{host_part}/{args.db}")
    if args.with_test_db:
        print(f"Tests: TEST_DATABASE_URL=postgresql+psycopg://{args.user}:<password>@{host_part}/{args.db}_test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
