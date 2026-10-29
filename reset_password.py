#!/usr/bin/env python3
"""
CDNJ School Management System - Script de Recuperación y Gestión de Credenciales
Permite listar usuarios, cambiar contraseñas y crear cuentas de emergencia desde la consola.
"""

import sys
import os
import sqlite3
import hashlib
import time
from datetime import datetime, timezone

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev.db")
SALT = b"cdnj_salt_2026"

def hash_pw(password):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), SALT, 100000).hex()

def get_db():
    if not os.path.exists(DB_FILE):
        print(f"❌ Error: No se encontró la base de datos en {DB_FILE}")
        sys.exit(1)
    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def list_users():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
    SELECT u.id, u.username, u.full_name, u.email, u.is_active,
           COALESCE(GROUP_CONCAT(r.name, ', '), 'SIN_ROL') as roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    GROUP BY u.id
    ORDER BY u.created_at ASC;
    """)
    rows = c.fetchall()
    conn.close()

    print("\n" + "=" * 75)
    print(f"{'ID':<15} {'USUARIO':<15} {'ROL':<18} {'ESTADO':<10} {'NOMBRE COMPLETO'}")
    print("=" * 75)
    for r in rows:
        status = "ACTIVO" if r[4] == 1 else "INACTIVO"
        print(f"{r[0]:<15} {r[1]:<15} {r[5]:<18} {status:<10} {r[2]}")
    print("=" * 75 + "\n")

def reset_password(username, new_password):
    if len(new_password) < 4:
        print("❌ Error: La contraseña debe tener al menos 4 caracteres.")
        return False

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, username, full_name FROM users WHERE LOWER(username) = LOWER(?);", (username,))
    row = c.fetchone()
    if not row:
        print(f"❌ Error: No se encontró ningún usuario con el nombre '{username}'.")
        conn.close()
        return False

    user_id = row[0]
    actual_username = row[1]
    pw_hash = hash_pw(new_password)

    c.execute("UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?;", (pw_hash, user_id))
    conn.commit()
    conn.close()

    print(f"✅ ¡Éxito! Contraseña actualizada para el usuario '{actual_username}'.")
    print(f"   Nueva contraseña asignada: {new_password}")
    return True

def create_user(username, password, full_name, role_name="SUPERADMIN", email=None):
    if len(username) < 3:
        print("❌ Error: El usuario debe tener al menos 3 caracteres.")
        return False
    if len(password) < 4:
        print("❌ Error: La contraseña debe tener al menos 4 caracteres.")
        return False

    if not email:
        email = f"{username.lower()}@cdnj.edu"

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?);", (username,))
    if c.fetchone():
        print(f"⚠️ El usuario '{username}' ya existe. Usa la opción de cambiar contraseña.")
        conn.close()
        return False

    c.execute("SELECT id FROM roles WHERE UPPER(name) = UPPER(?) OR id = ?;", (role_name, role_name))
    r_found = c.fetchone()
    if not r_found:
        print(f"❌ Error: Rol '{role_name}' no encontrado. Roles disponibles: SUPERADMIN, ADMINISTRADOR, CAJERA")
        conn.close()
        return False
    role_id = r_found[0]

    user_id = f"u_{int(time.time() * 1000)}"
    pw_hash = hash_pw(password)
    now_str = datetime.now(timezone.utc).isoformat()

    c.execute("""
    INSERT INTO users (id, username, email, password_hash, full_name, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?);
    """, (user_id, username, email, pw_hash, full_name, now_str))

    c.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?);", (user_id, role_id))
    conn.commit()
    conn.close()

    print(f"✅ ¡Éxito! Usuario '{username}' ({full_name}) creado con rol [{role_name}].")
    return True

def interactive_menu():
    print("""
╔════════════════════════════════════════════════════════════════╗
║         CDNJ - GESTIÓN Y RECUPERACIÓN DE CONTRASEÑAS           ║
╚════════════════════════════════════════════════════════════════╝
    """)
    while True:
        print("\nSeleccione una opción:")
        print("  1. Ver todos los usuarios del sistema")
        print("  2. Cambiar contraseña de un usuario")
        print("  3. Crear un nuevo usuario o Superadministrador")
        print("  4. Salir")

        try:
            choice = input("\nIngrese opción [1-4]: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nOperación cancelada.")
            break

        if choice == "1":
            list_users()
        elif choice == "2":
            uname = input("Ingrese el nombre de usuario a modificar: ").strip()
            if not uname:
                continue
            npw = input(f"Ingrese la nueva contraseña para '{uname}': ").strip()
            if not npw:
                continue
            reset_password(uname, npw)
        elif choice == "3":
            uname = input("Nuevo nombre de usuario: ").strip()
            npw = input("Contraseña inicial: ").strip()
            fname = input("Nombre completo del usuario: ").strip()
            print("Roles disponibles: 1. CAJERA | 2. ADMINISTRADOR | 3. SUPERADMIN")
            r_opt = input("Seleccione rol [1, 2 o 3] (por defecto 3): ").strip()
            role_map = {"1": "CAJERA", "2": "ADMINISTRADOR", "3": "SUPERADMIN"}
            selected_role = role_map.get(r_opt, "SUPERADMIN")
            create_user(uname, npw, fname, selected_role)
        elif choice == "4":
            print("Saliendo del asistente de contraseñas.")
            break
        else:
            print("Opción no válida. Intente nuevamente.")

def main():
    if len(sys.argv) == 1:
        interactive_menu()
    elif len(sys.argv) == 2 and sys.argv[1] in ("--list", "-l", "list"):
        list_users()
    elif len(sys.argv) == 3:
        username = sys.argv[1]
        new_password = sys.argv[2]
        reset_password(username, new_password)
    elif len(sys.argv) >= 4 and sys.argv[1] in ("--create", "-c"):
        uname = sys.argv[2]
        npw = sys.argv[3]
        fname = sys.argv[4] if len(sys.argv) > 4 else uname
        role = sys.argv[5] if len(sys.argv) > 5 else "SUPERADMIN"
        create_user(uname, npw, fname, role)
    else:
        print("Uso:")
        print("  python3 reset_password.py                    (Modo Interactivo)")
        print("  python3 reset_password.py --list             (Listar usuarios)")
        print("  python3 reset_password.py <usuario> <clave>  (Resetear contraseña directa)")
        print("  python3 reset_password.py --create <usuario> <clave> <nombre> [rol]")

if __name__ == "__main__":
    main()
