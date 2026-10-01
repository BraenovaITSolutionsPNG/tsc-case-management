"""
Convert a MySQL `INSERT INTO ... VALUES` dump into PostgreSQL INSERTs.

The MySQL dumps in database/ are the only copy of this platform's data — 781+
accounts, the case register, its timeline and its referrals — and PostgreSQL
cannot read them. This rewrites the row data into SQL the target database accepts.

Three things differ between the two that a search-and-replace would get wrong,
and each is handled explicitly below:

1. **String escaping.** MySQL escapes a quote inside a string as `\\'` and a
   backslash as `\\\\`. PostgreSQL, with `standard_conforming_strings` on (the
   default since 9.1), reads neither as an escape: `'Director\\'s'` is a syntax
   error there, and `\\\\` means two backslashes rather than one. So the literal
   is decoded on the way in and re-encoded as `''` on the way out.

2. **Booleans.** MySQL's `tinyint(1)` holds 0 and 1. PostgreSQL's `boolean`
   rejects both, and the columns this touches are the ones the application reads
   to decide whether an account may sign in and whether a matter needs a
   decision.

3. **Sequences.** Every table here has a `serial` primary key, and PostgreSQL
   drives that from a sequence which starts at 1 regardless of the rows already
   present. Loading `id` 2340 and then inserting normally produces a duplicate
   key on the next write, so each sequence is advanced past the highest id
   loaded. This is the failure that appears *after* a successful import, which
   is why it is done here rather than left to be discovered.

Deliberately NOT carried over: the `__drizzle_migrations` table. Those rows are
MySQL migration hashes, and PostgreSQL's Drizzle keeps its journal in a `drizzle`
schema of its own. Loading them would tell Drizzle that migrations had been
applied that this database has never seen, and it would then skip every one.
"""

import re
import sys
from pathlib import Path

# Columns whose MySQL type was tinyint(1) and whose PostgreSQL type is boolean.
# Taken from the schema, not guessed: the value is meaningless without knowing
# which column it belongs to.
BOOLEAN_COLUMNS = {
    "users": {"isActive"},
    "cases": {"decisionRequired"},
    "referrals": {"isLegal"},
}


def split_values(body: str) -> list[str]:
    """
    Split a VALUES body into one string per row.

    Splitting on commas or newlines does not work: rows contain commas inside
    quoted strings, and a quoted string may contain a newline. This walks the
    text tracking quote state instead.
    """
    rows = []
    current = []
    in_string = False
    collecting = False
    i = 0
    while i < len(body):
        char = body[i]
        if in_string:
            if char == "\\" and i + 1 < len(body):
                # Keep the escape pair intact; decode_sql_string handles it.
                current.append(char)
                current.append(body[i + 1])
                i += 2
                continue
            if char == "'":
                in_string = False
            current.append(char)
        else:
            if char == "'":
                in_string = True
                current.append(char)
            elif char == ",":
                # Only meaningful between values, i.e. inside a row. A comma
                # between rows belongs to neither and would otherwise prefix the
                # next one.
                if collecting:
                    current.append(char)
            elif char == "(":
                # Start of a row.
                collecting = True
                current = []
            elif char == ")":
                rows.append("".join(current))
                collecting = False
                current = []
            elif char == ";":
                break
            elif not char.isspace():
                current.append(char)
        i += 1
    return [row for row in rows if row.strip()]


def split_row(row: str) -> list[str]:
    """Split one row's value list, respecting quoted strings and NULL."""
    values = []
    current = []
    in_string = False
    i = 0
    while i < len(row):
        char = row[i]
        if in_string:
            if char == "\\" and i + 1 < len(row):
                current.append(char)
                current.append(row[i + 1])
                i += 2
                continue
            if char == "'":
                in_string = False
            current.append(char)
        else:
            if char == "'":
                in_string = True
                current.append(char)
            elif char == ",":
                values.append("".join(current).strip())
                current = []
            else:
                current.append(char)
        i += 1
    tail = "".join(current).strip()
    if tail:
        values.append(tail)
    return values


def decode_sql_string(literal: str) -> str:
    """
    Turn a MySQL string literal into a PostgreSQL one.

    Both quote doubling and backslash escaping are decoded, because MySQL accepts
    either and this data contains both (`Director\\'s` and, elsewhere, doubled
    quotes). Everything is then re-encoded as quote doubling, which is the one
    form PostgreSQL reads correctly under default settings.
    """
    body = literal[1:-1]  # strip the surrounding quotes

    out = []
    i = 0
    while i < len(body):
        char = body[i]
        if char == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            mapping = {
                "n": "\n",
                "t": "\t",
                "r": "\r",
                "0": "\0",
                "Z": "\x1a",
                "\\": "\\",
                "'": "'",
                '"': '"',
                "%": "\\%",  # keep wildcards literal for LIKE patterns
                "_": "\\_",
            }
            out.append(mapping.get(nxt, nxt))
            i += 2
            continue
        if char == "'" and i + 1 < len(body) and body[i + 1] == "'":
            out.append("'")
            i += 2
            continue
        out.append(char)
        i += 1

    return "'" + "".join(out).replace("'", "''") + "'"


def convert_value(raw: str, is_boolean: bool) -> str:
    if raw.upper() == "NULL":
        return "NULL"
    if raw.startswith("'"):
        decoded = decode_sql_string(raw)
        # A boolean column may hold 0/1 bare, or '0'/'1' as a quoted string if it
        # was written by something that quoted every value.
        if is_boolean:
            inner = decoded[1:-1]
            if inner in ("0", "1"):
                return "true" if inner == "1" else "false"
        return decoded
    if is_boolean:
        if raw == "0":
            return "false"
        if raw == "1":
            return "true"
    return raw


def table_columns(sql_text: str, table: str) -> list[str]:
    """Column names in declaration order, from the dump's CREATE TABLE."""
    match = re.search(
        r"CREATE TABLE `%s` \((.*?)\n\) ENGINE=" % re.escape(table), sql_text, re.S
    )
    if not match:
        raise SystemExit(f"no CREATE TABLE for `{table}` in the dump")
    columns = []
    for line in match.group(1).split("\n"):
        line = line.strip().rstrip(",")
        column = re.match(r"`(\w+)`\s", line + " ")
        if column:
            columns.append(column.group(1))
    return columns


def convert(dump_path: Path) -> str:
    sql_text = dump_path.read_text(encoding="utf8")

    out = [
        "-- PostgreSQL load script, converted from the MySQL dump",
        f"-- source: {dump_path.name}",
        "--",
        "-- Generated by scripts/mysql-to-postgres.py. Run against an empty",
        "-- database that already has the schema applied (pnpm db:push).",
        "--",
        "-- The __drizzle_migrations rows from the source are intentionally not",
        "-- carried over: they are MySQL migration hashes, and loading them would",
        "-- make Drizzle believe PostgreSQL migrations had already been applied.",
        "",
        "BEGIN;",
        "",
    ]

    statements = re.findall(
        r"INSERT INTO `(\w+)` VALUES\n(.*?);\n", sql_text, re.S
    )

    highest_id: dict[str, int] = {}

    for table, body in statements:
        if table == "__drizzle_migrations":
            continue

        columns = table_columns(sql_text, table)
        booleans = BOOLEAN_COLUMNS.get(table, set())

        rows = split_values(body)
        rendered = []
        for row in rows:
            values = split_row(row)
            if len(values) != len(columns):
                raise SystemExit(
                    f"{table}: row has {len(values)} values but the table has "
                    f"{len(columns)} columns — the dump and the schema disagree, "
                    f"so this row cannot be converted safely. Row: {row[:120]}"
                )
            converted = [
                convert_value(value, column in booleans)
                for column, value in zip(columns, values)
            ]
            rendered.append("  (" + ", ".join(converted) + ")")

            if "id" in columns:
                id_index = columns.index("id")
                raw_id = values[id_index]
                if raw_id.isdigit():
                    highest_id[table] = max(highest_id.get(table, 0), int(raw_id))

        column_list = ", ".join(f'"{column}"' for column in columns)
        out.append(f'INSERT INTO "{table}" ({column_list}) VALUES')
        out.append(",\n".join(rendered) + ";")
        out.append("")

    # Advance every sequence past the ids just loaded. Without this the next
    # insert the application makes collides with an existing primary key.
    out.append("-- Sequences. PostgreSQL drives serial columns from a sequence that")
    out.append("-- starts at 1 no matter what rows are already in the table, so a")
    out.append("-- successful import is followed by a duplicate-key failure on the very")
    out.append("-- next write unless each sequence is moved past the highest id loaded.")
    for table, highest in sorted(highest_id.items()):
        out.append(
            f"SELECT setval(pg_get_serial_sequence('\"{table}\"', 'id'), "
            f"{highest}, true);"
        )
    out.append("")
    out.append("COMMIT;")
    out.append("")

    return "\n".join(out)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: mysql-to-postgres.py <dump.sql> <out.sql>\n"
            "  Converts a MySQL INSERT dump into PostgreSQL INSERTs."
        )
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    target.write_text(convert(source), encoding="utf8")
    print(f"wrote {target}")
