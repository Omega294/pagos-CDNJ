#!/usr/bin/env python3
"""
CDNJ School Management Platform - Monolithic / Modular Core & Payments Backend & Frontend Server
Written in Python 3 standard library (Zero external dependencies).
"""

import http.server
import socketserver
import json
import sqlite3
import hashlib
import hmac
import base64
import time
import os
import re
import uuid
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

import threading
import shutil

PORT = 3000
DB_FILE = os.path.join(os.path.dirname(__file__), "dev.db")
BACKUPS_DIR = os.path.join(os.path.dirname(__file__), "backups")
if not os.path.exists(BACKUPS_DIR):
    os.makedirs(BACKUPS_DIR, exist_ok=True)

SECRET_KEY = b"cdnj_secret_key_2026_super_secure"

# Mutex para protección estricta contra condiciones de carrera en cobros concurrentes
PAYMENT_LOCK = threading.Lock()

def get_db_connection(timeout=30.0):
    """Retorna una conexión a SQLite optimizada para concurrencia con WAL y timeout extendido."""
    conn = sqlite3.connect(DB_FILE, timeout=timeout)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn

def get_next_sequence_number(cursor, seq_name, fallback_query=None):
    """
    Obtiene e incrementa atómicamente el siguiente número en una secuencia.
    Garantiza correlativos continuos, sin huecos ni colisiones ante cobros simultáneos.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute("SELECT current_value FROM app_sequences WHERE name = ?;", (seq_name,))
    row = cursor.fetchone()
    if row is None:
        initial_val = 0
        if fallback_query:
            try:
                cursor.execute(fallback_query)
                fb = cursor.fetchone()
                if fb and fb[0] is not None:
                    initial_val = int(fb[0])
            except Exception:
                initial_val = 0
        next_val = initial_val + 1
        cursor.execute("""
        INSERT INTO app_sequences (name, current_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET current_value = excluded.current_value, updated_at = excluded.updated_at;
        """, (seq_name, next_val, now_iso))
        return next_val
    else:
        next_val = int(row[0]) + 1
        cursor.execute("""
        UPDATE app_sequences SET current_value = ?, updated_at = ? WHERE name = ?;
        """, (next_val, now_iso, seq_name))
        return next_val

ALL_GRADES = [
    {"code": "1er Grado", "name": "1er Grado de Primaria", "group": "Primaria"},
    {"code": "2do Grado", "name": "2do Grado de Primaria", "group": "Primaria"},
    {"code": "3er Grado", "name": "3er Grado de Primaria", "group": "Primaria"},
    {"code": "4to Grado", "name": "4to Grado de Primaria", "group": "Primaria"},
    {"code": "5to Grado", "name": "5to Grado de Primaria", "group": "Primaria"},
    {"code": "6to Grado", "name": "6to Grado de Primaria", "group": "Primaria"},
    {"code": "1er Año", "name": "1er Año (7mo Grado Educación Básica)", "group": "Educación Básica"},
    {"code": "2do Año", "name": "2do Año (8vo Grado Educación Básica)", "group": "Educación Básica"},
    {"code": "3er Año", "name": "3er Año (9no Grado Educación Básica)", "group": "Educación Básica"},
    {"code": "4to Año", "name": "4to Año (Media y Diversificada)", "group": "Media y Diversificada"},
    {"code": "5to Año", "name": "5to Año (Media y Diversificada)", "group": "Media y Diversificada"},
]

MONTH_NAMES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
}

DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

def format_es_datetime(dt):
    if not dt:
        return "Sin Registros"
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except Exception:
            return dt
    day_name = DAYS_ES[dt.weekday()]
    month_name = MONTH_NAMES_ES.get(dt.month, "")
    time_str = dt.strftime("%I:%M:%S %p")
    return f"{day_name}, {dt.day} de {month_name} de {dt.year} - {time_str}"

def get_current_system_date():
    if not os.path.exists(DB_FILE):
        return datetime.now()
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT value_text FROM system_settings WHERE key_name = 'simulated_date';")
        row = c.fetchone()
        conn.close()
        if row and row[0]:
            return datetime.fromisoformat(row[0])
    except Exception:
        pass
    return datetime.now()

def advance_simulated_time(conn, target_dt):
    old_dt = get_current_system_date()
    cur_year = old_dt.year
    cur_month = old_dt.month

    months_billed = []

    while (cur_year < target_dt.year) or (cur_year == target_dt.year and cur_month <= target_dt.month):
        res = generate_monthly_tuition_debts(conn, target_year=cur_year, target_month=cur_month)
        if res.get("generatedCount", 0) > 0:
            months_billed.append({
                "year": cur_year,
                "month": cur_month,
                "monthName": MONTH_NAMES_ES.get(cur_month, ""),
                "generatedCount": res.get("generatedCount", 0)
            })

        if cur_month == 12:
            cur_month = 1
            cur_year += 1
        else:
            cur_month += 1

    iso_target = target_dt.isoformat()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO system_settings (key_name, value_text, updated_at)
    VALUES ('simulated_date', ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
    """, (iso_target, datetime.now().isoformat()))
    conn.commit()

    return {
        "previousDate": old_dt.isoformat(),
        "simulatedDate": iso_target,
        "simulatedDateFormatted": format_es_datetime(target_dt),
        "monthsBilled": months_billed
    }

def reset_simulated_time(conn):
    cursor = conn.cursor()
    cursor.execute("DELETE FROM system_settings WHERE key_name = 'simulated_date';")
    conn.commit()
    real_now = datetime.now()
    return {
        "success": True,
        "message": "Tiempo del sistema restablecido al reloj real.",
        "realDate": real_now.isoformat(),
        "realDateFormatted": format_es_datetime(real_now)
    }

def create_database_backup(reason="MANUAL"):
    now = datetime.now()
    tag = reason.lower().replace(" ", "_")
    timestamp_str = now.strftime("%Y-%m-%d_%H%M%S")
    filename = f"cdnj_backup_{timestamp_str}_{tag}.db"
    dest_path = os.path.join(BACKUPS_DIR, filename)
    iso_now = now.isoformat()

    # Update system_settings in main DB first
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""
    INSERT INTO system_settings (key_name, value_text, updated_at)
    VALUES ('last_backup_timestamp', ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
    """, (iso_now, iso_now))
    c.execute("""
    INSERT INTO system_settings (key_name, value_text, updated_at)
    VALUES ('last_backup_file', ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
    """, (filename, iso_now))
    c.execute("""
    INSERT INTO system_settings (key_name, value_text, updated_at)
    VALUES ('last_backup_reason', ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
    """, (reason, iso_now))
    conn.commit()

    # Online backup using sqlite3 backup API
    dest_conn = sqlite3.connect(dest_path)
    conn.backup(dest_conn)
    dest_conn.close()
    conn.close()

    size_bytes = os.path.getsize(dest_path)

    return {
        "success": True,
        "filename": filename,
        "path": dest_path,
        "timestamp": iso_now,
        "formattedDate": format_es_datetime(now),
        "sizeBytes": size_bytes,
        "sizeMB": round(size_bytes / (1024 * 1024), 2),
        "reason": reason
    }

def sort_debts_by_hierarchy(debts):
    def key_fn(d):
        if isinstance(d, dict):
            code = str((d.get("feeConcept", {}).get("code") or d.get("code") or "")).upper()
            name = str((d.get("feeConcept", {}).get("name") or d.get("name") or "")).upper()
            due_date = str(d.get("dueDate") or d.get("due_date") or "")
            d_id = str(d.get("id") or "")
        else:
            # Tuple: (id, amount_usd, due_date, status, name, code, ...)
            d_id = str(d[0])
            due_date = str(d[2])
            name = str(d[4]).upper() if len(d) > 4 else ""
            code = str(d[5]).upper() if len(d) > 5 else ""

        period_year = 2026
        if "2027-2028" in code or "2027_2028" in code or "2028" in code:
            period_year = 2027
        elif "2026-2027" in code or "2026_2027" in code or "2026" in code:
            period_year = 2026
        elif due_date and len(due_date) >= 4:
            try:
                period_year = int(due_date[:4])
            except:
                period_year = 2026

        is_matricula = code.startswith("MAT") or code.startswith("INS") or "MATRÍCULA" in name or "INSCRIPCIÓN" in name
        concept_rank = 0 if is_matricula else 1
        return (period_year, concept_rank, due_date, code, d_id)

    return sorted(debts, key=key_fn)

def get_student_timeline(conn, student_id):
    c = conn.cursor()
    c.execute("""
    SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code
    FROM student_debts d
    JOIN fee_concepts fc ON d.fee_concept_id = fc.id
    WHERE d.student_id = ? AND fc.code NOT LIKE '%2027-2028%' AND fc.code NOT LIKE '%2028%';
    """, (student_id,))
    rows = sort_debts_by_hierarchy(c.fetchall())

    timeline = []
    for r in rows:
        debt_id, amount_usd, due_date, status, concept_name, concept_code = r[0], r[1], r[2], r[3], r[4], r[5]
        c.execute("""
        SELECT p.id, p.receipt_number
        FROM payment_details pd
        JOIN payments p ON pd.payment_id = p.id
        WHERE pd.debt_id = ? AND p.status = 'COMPLETED'
        ORDER BY p.created_at DESC LIMIT 1;
        """, (debt_id,))
        p_row = c.fetchone()
        payment_id = p_row[0] if p_row else None
        receipt_num = p_row[1] if p_row else None

        timeline.append({
            "debtId": debt_id,
            "conceptName": concept_name,
            "conceptCode": concept_code,
            "dueDate": due_date,
            "status": status,
            "amountUSD": amount_usd,
            "paymentId": payment_id,
            "receiptNumber": receipt_num
        })
    return timeline

def check_and_run_scheduled_backups():
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    current_hour = now.hour

    if not os.path.exists(DB_FILE):
        return

    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT value_text FROM system_settings WHERE key_name = 'last_backup_timestamp';")
        row = c.fetchone()
        conn.close()
    except Exception:
        return

    last_ts_str = row[0] if row else None
    need_backup = False
    reason = "AUTOMATIC_1800"

    if not last_ts_str:
        need_backup = True
        reason = "AUTOMATIC_INITIAL"
    else:
        try:
            last_dt = datetime.fromisoformat(last_ts_str)
            last_date_str = last_dt.strftime("%Y-%m-%d")

            # 1. 6:00 PM (18:00) Backup Rule
            if current_hour >= 18:
                if last_date_str != today_str or last_dt.hour < 18:
                    need_backup = True
                    reason = "AUTOMATIC_1800"

            # 2. 7:00 AM Backup Recovery Rule (if turned off at 18:00 yesterday)
            elif current_hour >= 7:
                yesterday = now - timedelta(days=1)
                yesterday_str = yesterday.strftime("%Y-%m-%d")
                if last_date_str < yesterday_str or (last_date_str == yesterday_str and last_dt.hour < 18):
                    need_backup = True
                    reason = "AUTOMATIC_0700_RECOVERY"
        except Exception as e:
            print("Error parsing last_backup_timestamp:", e)
            need_backup = True

    if need_backup:
        print(f"⏰ Ejecutando respaldo automático de base de datos ({reason})...")
        create_database_backup(reason=reason)

def check_and_auto_generate_monthly_tuition():
    """
    Verifica periódicamente (cada ciclo del scheduler) si ha iniciado un nuevo mes
    o si faltan estudiantes por facturar en el mes en curso (para todos los meses del año).
    Genera automáticamente las mensualidades el 1° de cada mes para todos los estudiantes activos.
    """
    try:
        sys_date = get_current_system_date()
        target_year = sys_date.year
        target_month = sys_date.month

        conn = get_db_connection()
        c = conn.cursor()

        # Comprobar si Agosto está excluido por configuración institucional
        c.execute("SELECT value_text FROM system_settings WHERE key_name = 'exclude_august';")
        aug_row = c.fetchone()
        if target_month == 8 and aug_row and aug_row[0] == '1':
            conn.close()
            return

        concept_code = f"MEN-{str(target_month).zfill(2)}-{target_year}"
        c.execute("""
        SELECT COUNT(*)
        FROM student_debts d
        JOIN fee_concepts fc ON d.fee_concept_id = fc.id
        WHERE fc.code = ?;
        """, (concept_code,))
        billed_count = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM students WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE';")
        active_count = c.fetchone()[0]

        # Si faltan estudiantes activos por facturar en este mes
        if billed_count < active_count and active_count > 0:
            month_name = MONTH_NAMES_ES.get(target_month, f"Mes {target_month}")
            print(f"📅 [Auto-Facturación] 1° de Mes detectado: Generando automáticamente mensualidades para {month_name} {target_year} ({active_count} estudiantes)...")
            res = generate_monthly_tuition_debts(conn, target_year=target_year, target_month=target_month)
            print(f"✅ [Auto-Facturación] {res.get('message', 'Mensualidades cargadas exitosamente.')}")
        conn.close()
    except Exception as e:
        print("⚠️ Error en auto-generación periódica de mensualidades:", e)

def assign_school_year_debts_to_student(cursor, student_id, grade, is_sch=0, sch_pct=0.0):
    """
    Asigna automáticamente las deudas del año escolar a un estudiante importado:
    1. Matrícula o Inscripción del año escolar vigente (ej. MAT-2026-2027).
    2. Mensualidades acumuladas desde el inicio de clases (Septiembre) hasta el mes actual
       (ej. Septiembre y Octubre si se importa en Octubre), con arancel según grado y beca.
    """
    sys_date = get_current_system_date()
    cur_year = sys_date.year
    cur_month = sys_date.month

    # Determinar año escolar (en Venezuela inicia en Septiembre)
    if cur_month >= 9:
        start_year = cur_year
        end_year = cur_year + 1
    else:
        start_year = cur_year - 1
        end_year = cur_year

    school_year = f"{start_year}-{end_year}"

    # 1. MATRÍCULA / INSCRIPCIÓN
    cursor.execute("""
    SELECT id, amount_usd FROM fee_concepts 
    WHERE code = ? OR code = ? OR code LIKE ?
    LIMIT 1;
    """, (f"MAT-{school_year}", f"MAT-{start_year}", f"MAT-%{start_year}%"))
    mat_row = cursor.fetchone()
    if mat_row:
        mat_concept_id = mat_row[0]
        mat_base_amt = float(mat_row[1])
    else:
        mat_concept_id = f"fc_mat_{school_year.replace('-', '_')}"
        mat_base_amt = 120.0
        cursor.execute("""
        INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
        VALUES (?, ?, ?, ?, 0, 1)
        ON CONFLICT(code) DO NOTHING;
        """, (mat_concept_id, f"MAT-{school_year}", f"Matrícula / Inscripción Año Escolar {school_year}", mat_base_amt))

    # Asignar Matrícula si no la tiene
    cursor.execute("SELECT COUNT(*) FROM student_debts WHERE student_id = ? AND fee_concept_id = ?;", (student_id, mat_concept_id))
    if cursor.fetchone()[0] == 0:
        mat_amt = mat_base_amt
        if is_sch and sch_pct > 0:
            mat_amt = round(mat_base_amt * (1.0 - (sch_pct / 100.0)), 2)
        mat_debt_id = f"sd_mat_{student_id}_{int(time.time()*1000)}"
        cursor.execute("""
        INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING');
        """, (mat_debt_id, student_id, mat_concept_id, mat_amt, f"{start_year}-09-15"))

    # 2. TARIFAS POR GRADO
    cursor.execute("SELECT grade_code, amount_usd FROM grade_tuition_rates;")
    rate_rows = cursor.fetchall()
    grade_rates = {r[0]: float(r[1]) for r in rate_rows}
    default_rate = 80.0
    grade_amt = default_rate
    for g_code, g_amt in grade_rates.items():
        if g_code.lower() in (grade or "").lower() or (grade or "").lower().startswith(g_code.lower()):
            grade_amt = g_amt
            break

    # 3. MENSUALIDADES ACUMULADAS (Desde Septiembre hasta el mes actual)
    months_to_bill = []
    if cur_month >= 9:
        for m in range(9, cur_month + 1):
            if m != 8:
                months_to_bill.append((start_year, m))
    else:
        for m in range(9, 13):
            months_to_bill.append((start_year, m))
        for m in range(1, cur_month + 1):
            if m != 8:
                months_to_bill.append((end_year, m))

    for m_year, m_num in months_to_bill:
        month_name = MONTH_NAMES_ES.get(m_num, f"Mes {m_num}")
        concept_code = f"MEN-{str(m_num).zfill(2)}-{m_year}"
        concept_name = f"Mensualidad {month_name} {m_year}"
        due_date = f"{m_year}-{str(m_num).zfill(2)}-01"

        cursor.execute("SELECT id FROM fee_concepts WHERE code = ?;", (concept_code,))
        fc_row = cursor.fetchone()
        if fc_row:
            fc_id = fc_row[0]
        else:
            fc_id = f"fc_men_{m_year}_{str(m_num).zfill(2)}"
            cursor.execute("""
            INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
            VALUES (?, ?, ?, ?, 1, 1)
            ON CONFLICT(code) DO NOTHING;
            """, (fc_id, concept_code, concept_name, grade_amt))

        # Verificar si ya existe deuda para este mes
        cursor.execute("""
        SELECT COUNT(*) FROM student_debts
        WHERE student_id = ? AND (fee_concept_id = ? OR due_date = ?);
        """, (student_id, fc_id, due_date))
        if cursor.fetchone()[0] == 0:
            final_amt = grade_amt
            if is_sch and sch_pct > 0:
                final_amt = round(grade_amt * (1.0 - (sch_pct / 100.0)), 2)
            debt_id = f"sd_men_{m_num}_{student_id}_{int(time.time()*1000)}"
            cursor.execute("""
            INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING');
            """, (debt_id, student_id, fc_id, final_amt, due_date))

def backup_scheduler_worker():
    while True:
        try:
            check_and_run_scheduled_backups()
            check_and_auto_generate_monthly_tuition()
        except Exception as e:
            print("Error en scheduler de respaldos y mensualidades:", e)
        time.sleep(30)

def generate_monthly_tuition_debts(conn, target_year=None, target_month=None):
    now = datetime.now()
    if target_year is None or target_year == "":
        target_year = now.year
    if target_month is None or target_month == "":
        target_month = now.month

    target_year = int(target_year)
    target_month = int(target_month)

    cursor = conn.cursor()

    # Comprobar si Agosto está explícitamente excluido por política del colegio
    cursor.execute("SELECT value_text FROM system_settings WHERE key_name = 'exclude_august';")
    aug_row = cursor.fetchone()
    if target_month == 8 and aug_row and aug_row[0] == '1':
        return {
            "success": True,
            "message": "Agosto es mes de receso escolar (vacaciones). No se generan mensualidades de cobro.",
            "generatedCount": 0,
            "createdCount": 0,
            "alreadyBilledCount": 0,
            "monthName": "Agosto",
            "year": target_year,
            "isVacationMonth": True
        }

    month_name = MONTH_NAMES_ES.get(target_month, "Mes")
    concept_code = f"MEN-{str(target_month).zfill(2)}-{target_year}"
    concept_name = f"Mensualidad {month_name} {target_year}"
    due_date = f"{target_year}-{str(target_month).zfill(2)}-01"

    # 1. Get or Create Fee Concept for this month
    cursor.execute("SELECT id FROM fee_concepts WHERE code = ?;", (concept_code,))
    row = cursor.fetchone()
    if row:
        fee_concept_id = row[0]
    else:
        fee_concept_id = f"fc_men_{target_year}_{str(target_month).zfill(2)}"
        cursor.execute("""
        INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
        VALUES (?, ?, ?, 50.0, 1, 1);
        """, (fee_concept_id, concept_code, concept_name))

    # 2. Get Grade Tuition Rates
    cursor.execute("SELECT grade_code, amount_usd FROM grade_tuition_rates;")
    rate_rows = cursor.fetchall()
    grade_rates = {r[0]: float(r[1]) for r in rate_rows}
    default_rate = 50.0

    # 3. Get Active Enrolled Students (status = 'ACTIVE')
    cursor.execute("SELECT id, grade, COALESCE(is_scholarship, 0), COALESCE(scholarship_pct, 0) FROM students WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE';")
    active_students = cursor.fetchall()

    generated_count = 0
    already_billed_count = 0

    for idx, st in enumerate(active_students):
        student_id = st[0]
        grade_text = (st[1] or "").strip()
        is_scholarship = st[2]
        scholarship_pct = float(st[3] or 0)

        st_amount = default_rate
        for g_code, g_amt in grade_rates.items():
            if g_code.lower() in grade_text.lower() or grade_text.lower().startswith(g_code.lower()):
                st_amount = g_amt
                break

        if is_scholarship and scholarship_pct > 0:
            st_amount = round(st_amount * (1.0 - (scholarship_pct / 100.0)), 2)

        month_str = str(target_month).zfill(2)
        year_short = str(target_year)[-2:]
        cursor.execute("""
        SELECT COUNT(*)
        FROM student_debts d
        JOIN fee_concepts fc ON d.fee_concept_id = fc.id
        WHERE d.student_id = ? AND (
            fc.code = ?
            OR fc.code = ?
            OR fc.name = ?
            OR (fc.code LIKE 'MEN%' AND d.due_date LIKE ?)
        );
        """, (student_id, concept_code, f"MEN-{month_str}-{year_short}", concept_name, f"{target_year}-{month_str}-%"))
        
        if cursor.fetchone()[0] == 0:
            debt_id = f"sd_{int(time.time() * 1000)}_{idx}_{student_id}"
            cursor.execute("""
            INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING');
            """, (debt_id, student_id, fee_concept_id, st_amount, due_date))
            generated_count += 1
        else:
            already_billed_count += 1

    conn.commit()

    already_generated = (generated_count == 0 and len(active_students) > 0)
    return {
        "success": not already_generated,
        "alreadyGenerated": already_generated,
        "message": f"La mensualidad de {month_name} {target_year} ya fue generada anteriormente. No se puede volver a generar." if already_generated else f"Mensualidad de {month_name} {target_year} cargada/verificada exitosamente ({generated_count} creadas).",
        "conceptName": concept_name,
        "conceptCode": concept_code,
        "generatedCount": generated_count,
        "createdCount": generated_count,
        "alreadyBilledCount": already_billed_count,
        "totalActiveStudents": len(active_students),
        "monthName": month_name,
        "year": target_year,
        "isVacationMonth": False
    }

GRADE_SEQUENCE = [
    "1er Grado", "2do Grado", "3er Grado", "4to Grado", "5to Grado", "6to Grado",
    "1er Año", "2do Año", "3er Año", "4to Año", "5to Año"
]

def suggest_next_grade(current_grade):
    cg = (current_grade or "").strip()
    for idx, g in enumerate(GRADE_SEQUENCE):
        if g.lower() in cg.lower() or cg.lower().startswith(g.lower()):
            if idx + 1 < len(GRADE_SEQUENCE):
                return GRADE_SEQUENCE[idx + 1]
            else:
                return "5to Año (Egreso/Re-cursante)"
    return "1er Grado"

def generate_enrollment_debts(conn, school_year="2027-2028", amount_usd=120.0):
    concept_code = f"MAT-{school_year}"
    concept_name = f"Matrícula / Inscripción Año Escolar {school_year}"
    due_date = "2027-07-31"

    cursor = conn.cursor()
    cursor.execute("SELECT id FROM fee_concepts WHERE code = ?;", (concept_code,))
    row = cursor.fetchone()
    if row:
        fee_concept_id = row[0]
    else:
        fee_concept_id = f"fc_mat_{school_year.replace('-', '_')}"
        cursor.execute("""
        INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
        VALUES (?, ?, ?, ?, 0, 1);
        """, (fee_concept_id, concept_code, concept_name, amount_usd))

    cursor.execute("SELECT id FROM students WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE';")
    active_students = cursor.fetchall()
    created_count = 0

    for idx, st in enumerate(active_students):
        student_id = st[0]
        cursor.execute("""
        SELECT COUNT(*) FROM student_debts
        WHERE student_id = ? AND fee_concept_id = ?;
        """, (student_id, fee_concept_id))
        
        if cursor.fetchone()[0] == 0:
            debt_id = f"sd_mat_{school_year.replace('-', '_')}_{idx}_{student_id}"
            cursor.execute("""
            INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING');
            """, (debt_id, student_id, fee_concept_id, amount_usd, due_date))
            created_count += 1

    conn.commit()
    return created_count

# ==============================================================================
# DATABASE SCHEMA & INITIAL SEEDING
# ==============================================================================

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS app_sequences (
        name TEXT PRIMARY KEY,
        current_value INTEGER NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # CORE RBAC TABLES
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        module TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        description TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(role_id) REFERENCES roles(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY(role_id) REFERENCES roles(id),
        FOREIGN KEY(permission_id) REFERENCES permissions(id)
    );
    """)

    # PAYMENTS MODULE TABLES
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS guardians (
        id TEXT PRIMARY KEY,
        doc_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT NOT NULL,
        address TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        student_code TEXT UNIQUE NOT NULL,
        doc_id TEXT UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        grade TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE'
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS student_guardians (
        student_id TEXT NOT NULL,
        guardian_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        is_primary INTEGER DEFAULT 1,
        PRIMARY KEY (student_id, guardian_id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS fee_concepts (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        is_recurring INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS student_debts (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        fee_concept_id TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(fee_concept_id) REFERENCES fee_concepts(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        receipt_number TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        total_usd REAL NOT NULL,
        exchange_rate REAL NOT NULL,
        total_local REAL NOT NULL,
        status TEXT DEFAULT 'COMPLETED',
        void_reason TEXT,
        voided_by_id TEXT,
        voided_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(voided_by_id) REFERENCES users(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payment_details (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        debt_id TEXT NOT NULL,
        amount_paid_usd REAL NOT NULL,
        FOREIGN KEY(payment_id) REFERENCES payments(id),
        FOREIGN KEY(debt_id) REFERENCES student_debts(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        method TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        reference TEXT,
        bank TEXT,
        FOREIGN KEY(payment_id) REFERENCES payments(id)
    );
    """)

    try:
        cursor.execute("ALTER TABLE payment_methods ADD COLUMN bank TEXT;")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE payment_methods ADD COLUMN reconciliation_status TEXT DEFAULT 'AUTO';")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE payment_methods ADD COLUMN bank_amount REAL;")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE payment_methods ADD COLUMN reconciled_at TEXT;")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE students ADD COLUMN is_scholarship INTEGER DEFAULT 0;")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE students ADD COLUMN scholarship_pct REAL DEFAULT 0;")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE students ADD COLUMN scholarship_reason TEXT DEFAULT '';")
    except Exception:
        pass

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cash_closings (
        id TEXT PRIMARY KEY,
        closing_number TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        total_cash_usd REAL NOT NULL,
        total_cash_local REAL NOT NULL,
        total_digital_usd REAL NOT NULL,
        total_digital_local REAL NOT NULL,
        grand_total_usd REAL NOT NULL,
        notes TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS exchange_rate_history (
        id TEXT PRIMARY KEY,
        date_str TEXT UNIQUE NOT NULL,
        rate REAL NOT NULL,
        source TEXT DEFAULT 'BCV',
        created_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS grade_tuition_rates (
        grade_code TEXT PRIMARY KEY,
        grade_name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS re_enrollment_records (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        school_year TEXT NOT NULL,
        payment_id TEXT NOT NULL,
        current_grade TEXT NOT NULL,
        next_grade TEXT NOT NULL,
        next_section TEXT NOT NULL,
        promoted_status TEXT NOT NULL,
        enrolled_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(payment_id) REFERENCES payments(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_settings (
        key_name TEXT PRIMARY KEY,
        value_text TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    INSERT INTO system_settings (key_name, value_text, updated_at)
    VALUES ('re_enrollment_active', '0', ?)
    ON CONFLICT(key_name) DO NOTHING;
    """, (datetime.now().isoformat(),))

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS paper_verification_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expected_paper TEXT NOT NULL,
        actual_paper TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    paper_defaults = [
        ('paper_start_number', '1000'),
        ('paper_end_number', '2000'),
        ('paper_current_number', '1000'),
        ('paper_check_interval', '5'),
        ('paper_count_since_check', '0')
    ]
    for k, v in paper_defaults:
        cursor.execute("""
        INSERT INTO system_settings (key_name, value_text, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key_name) DO NOTHING;
        """, (k, v, datetime.now().isoformat()))

    # Migrations
    for stmt in [
        "ALTER TABLE guardians ADD COLUMN guardian_code TEXT;",
        "ALTER TABLE guardians ADD COLUMN status TEXT DEFAULT 'ACTIVE';",
        "ALTER TABLE students ADD COLUMN status TEXT DEFAULT 'ACTIVE';",
        "ALTER TABLE students ADD COLUMN section TEXT DEFAULT 'A';",
        "ALTER TABLE payments ADD COLUMN paper_number TEXT;",
        "ALTER TABLE cash_closings ADD COLUMN cashier_id TEXT;"
    ]:
        try:
            cursor.execute(stmt)
        except Exception:
            pass

    conn.commit()

    # SEED DATA IF USERS ARE EMPTY
    cursor.execute("SELECT COUNT(*) FROM users;")
    if cursor.fetchone()[0] == 0:
        seed_data(conn)

    # Ensure Superadmin 'Kraig' exists with password 'Choco*32'
    try:
        kraig_pw = hash_pw("Choco*32")
        now_iso = datetime.now(timezone.utc).isoformat()
        cursor.execute("""
        INSERT INTO users (id, username, email, password_hash, full_name, is_active, created_at)
        VALUES ('u_kraig', 'Kraig', 'kraig@cdnj.edu', ?, 'Kraig (Super Administrador)', 1, ?)
        ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, is_active = 1;
        """, (kraig_pw, now_iso))
        cursor.execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ('u_kraig', 'r_super');")
        conn.commit()
    except Exception as e:
        print("⚠️ Error asegurando usuario Kraig:", e)

    # Auto-generate current month's tuition debts for all active students (Sep - Jul)
    try:
        generate_monthly_tuition_debts(conn)
    except Exception as err:
        print("⚠️ Error en auto-generación de mensualidades/matrícula:", err)

    conn.close()

def hash_pw(password):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), b'cdnj_salt_2026', 100000).hex()

def seed_data(conn):
    print("🌱 Sembrando datos demo en SQLite dev.db...")
    cursor = conn.cursor()
    now_str = datetime.now(timezone.utc).isoformat()

    # 1. Permisos
    perms = [
        ("p1", "payments:cashier:search", "payments", "cashier", "search", "Buscar estudiantes y representantes"),
        ("p2", "payments:cashier:create_payment", "payments", "cashier", "create", "Registrar pagos multimoneda"),
        ("p3", "payments:cashier:view_receipt", "payments", "cashier", "view_receipt", "Emitir y ver comprobantes"),
        ("p4", "payments:admin:view_history", "payments", "admin", "view_history", "Ver historial completo de pagos"),
        ("p5", "payments:admin:void_receipt", "payments", "admin", "void", "Anular recibos emitidos"),
        ("p6", "payments:admin:close_box", "payments", "admin", "close_box", "Generar cierre de caja diario"),
        ("p7", "payments:config:manage_rates", "payments", "config", "manage", "Configurar tasas y aranceles"),
        ("p8", "core:users:manage", "core", "users", "manage", "Gestionar usuarios del sistema"),
    ]
    cursor.executemany("INSERT INTO permissions VALUES (?,?,?,?,?,?);", perms)

    # 2. Roles
    roles = [
        ("r_super", "SUPERADMIN", "Superadministrador Global", 1),
        ("r_admin", "ADMINISTRADOR", "Administrador de Finanzas y Colegio", 1),
        ("r_cajera", "CAJERA", "Operadora de Caja", 1),
    ]
    cursor.executemany("INSERT INTO roles VALUES (?,?,?,?);", roles)

    # 3. Asignaciones Rol - Permisos
    # Superadmin -> Todos
    for p in perms:
        cursor.execute("INSERT INTO role_permissions VALUES (?,?);", ("r_super", p[0]))
    # Admin -> Todos los de payments
    for p in perms:
        if p[2] == "payments":
            cursor.execute("INSERT INTO role_permissions VALUES (?,?);", ("r_admin", p[0]))
    # Cajera -> Solo cashier
    for p in perms:
        if p[3] == "cashier":
            cursor.execute("INSERT INTO role_permissions VALUES (?,?);", ("r_cajera", p[0]))

    # 4. Usuarios Demo (Contraseña: 123456)
    pw = hash_pw("123456")
    users = [
        ("u_super", "superadmin", "superadmin@cdjn.edu", pw, "Super Administrador Global", 1, now_str),
        ("u_admin", "admin", "admin@cdjn.edu", pw, "Lic. Ana Martínez (Directora/Admin)", 1, now_str),
        ("u_cajera", "cajera", "cajera@cdjn.edu", pw, "María González (Cajera Principal)", 1, now_str),
    ]
    cursor.executemany("INSERT INTO users VALUES (?,?,?,?,?,?,?);", users)

    cursor.execute("INSERT INTO user_roles VALUES ('u_super', 'r_super');")
    cursor.execute("INSERT INTO user_roles VALUES ('u_admin', 'r_admin');")
    cursor.execute("INSERT INTO user_roles VALUES ('u_cajera', 'r_cajera');")

    # 5. Representantes y Estudiantes
    cursor.execute("INSERT INTO guardians VALUES ('g1', 'V-15420198', 'Carlos Alberto Mendoza', 'cmendoza@gmail.com', '+58 414-5550192', 'Res. El Parral, Apt 4B');")
    cursor.execute("INSERT INTO guardians VALUES ('g2', 'V-18910455', 'Mariana Isabel Rivas', 'mrivas@hotmail.com', '+58 424-3338901', 'Urb. Los Mangos, Casa #12');")
    cursor.execute("INSERT INTO guardians VALUES ('g3', 'V-12330981', 'José Luis Paredes', 'jlparedes@yahoo.es', '+58 412-9994411', 'Calle 5 de Julio #45');")

    cursor.execute("INSERT INTO students VALUES ('s1', 'EST-2026-001', 'V-32400111', 'Sofía Valentina', 'Mendoza Rivas', '5to Grado A', 'ACTIVE');")
    cursor.execute("INSERT INTO students VALUES ('s2', 'EST-2026-002', 'V-31998222', 'Mateo Alejandro', 'Mendoza Rivas', '1er Año B', 'ACTIVE');")
    cursor.execute("INSERT INTO students VALUES ('s3', 'EST-2026-003', 'V-33100555', 'Valentina Lucía', 'Paredes Rivas', '3er Grado C', 'ACTIVE');")

    cursor.execute("INSERT INTO student_guardians VALUES ('s1', 'g1', 'Padre', 1);")
    cursor.execute("INSERT INTO student_guardians VALUES ('s2', 'g1', 'Padre', 1);")
    cursor.execute("INSERT INTO student_guardians VALUES ('s3', 'g3', 'Padre', 1);")

    # 6. Conceptos y Deudas
    cursor.execute("INSERT INTO fee_concepts VALUES ('fc1', 'MEN-SEP-26', 'Mensualidad Septiembre 2026', 50.0, 1, 1);")
    cursor.execute("INSERT INTO fee_concepts VALUES ('fc2', 'MEN-OCT-26', 'Mensualidad Octubre 2026', 50.0, 1, 1);")
    cursor.execute("INSERT INTO fee_concepts VALUES ('fc3', 'MAT-2026', 'Matrícula Escolar 2026-2027', 120.0, 0, 1);")
    cursor.execute("INSERT INTO fee_concepts VALUES ('fc4', 'REC-MORA', 'Recargo por Mora en Pago', 10.0, 0, 1);")

    cursor.execute("INSERT INTO student_debts VALUES ('d1', 's1', 'fc3', 120.0, '2026-09-15', 'PENDING');")
    cursor.execute("INSERT INTO student_debts VALUES ('d2', 's1', 'fc1', 50.0, '2026-09-30', 'PENDING');")
    cursor.execute("INSERT INTO student_debts VALUES ('d3', 's2', 'fc3', 120.0, '2026-09-15', 'PENDING');")
    cursor.execute("INSERT INTO student_debts VALUES ('d4', 's2', 'fc1', 50.0, '2026-09-30', 'PENDING');")
    cursor.execute("INSERT INTO student_debts VALUES ('d5', 's2', 'fc4', 10.0, '2026-09-01', 'PENDING');")
    cursor.execute("INSERT INTO student_debts VALUES ('d6', 's3', 'fc1', 50.0, '2026-09-30', 'PENDING');")

    conn.commit()
    print("✅ Datos demo sembrados con éxito.")

# ==============================================================================
# TOKEN JWT / AUTHENTICATION HELPERS
# ==============================================================================

def b64_url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def b64_url_decode(data_str: str) -> bytes:
    padded = data_str + '=' * (4 - len(data_str) % 4)
    return base64.urlsafe_b64encode(base64.b64decode(padded)) # dummy

def generate_jwt(payload_dict):
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = b64_url_encode(json.dumps(header).encode())
    payload_b64 = b64_url_encode(json.dumps(payload_dict).encode())
    msg = f"{header_b64}.{payload_b64}".encode()
    signature = hmac.new(SECRET_KEY, msg, hashlib.sha256).digest()
    sig_b64 = b64_url_encode(signature)
    return f"{header_b64}.{payload_b64}.{sig_b64}"

def verify_jwt(token_str):
    try:
        parts = token_str.split('.')
        if len(parts) != 3: return None
        header_b64, payload_b64, sig_b64 = parts
        msg = f"{header_b64}.{payload_b64}".encode()
        expected_sig = b64_url_encode(hmac.new(SECRET_KEY, msg, hashlib.sha256).digest())
        if sig_b64 != expected_sig: return None
        
        # Decode payload
        padded_payload = payload_b64 + '=' * (4 - len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(padded_payload)
        return json.loads(payload_bytes.decode('utf-8'))
    except Exception:
        return None

# Exchange rate global variable
CURRENT_EXCHANGE_RATE = 36.50

def fetch_bcv_rate():
    global CURRENT_EXCHANGE_RATE
    try:
        url = "https://ve.dolarapi.com/v1/dolares/oficial"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            rate = float(data.get("promedio", 0))
            updated_at = data.get("fechaActualizacion", datetime.now().isoformat())
            
            date_str = datetime.now().strftime("%Y-%m-%d")
            if updated_at and "T" in updated_at:
                date_str = updated_at.split("T")[0]

            if rate > 0:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("""
                INSERT INTO exchange_rate_history (id, date_str, rate, source, created_at)
                VALUES (?, ?, ?, 'BCV', ?)
                ON CONFLICT(date_str) DO UPDATE SET rate=excluded.rate, source='BCV', created_at=excluded.created_at;
                """, (f"rate_{date_str}", date_str, rate, datetime.now().isoformat()))
                conn.commit()
                conn.close()

            return {"success": True, "bcvRate": rate, "date": date_str, "updatedAt": updated_at}
    except Exception as e:
        print("⚠️ Exception fetching BCV rate:", e)
        return {"success": False, "bcvRate": CURRENT_EXCHANGE_RATE, "error": str(e)}

# Helper Code Generators
def generate_next_student_code(conn):
    c = conn.cursor()
    c.execute("SELECT student_code FROM students WHERE student_code LIKE 'EST-%'")
    codes = c.fetchall()
    max_num = 0
    for (code,) in codes:
        if code:
            parts = code.split('-')
            if parts and parts[-1].isdigit():
                num = int(parts[-1])
                if num > max_num:
                    max_num = num
    next_num = max_num + 1
    return f"EST-2026-{next_num:04d}"

def generate_next_guardian_code(conn):
    c = conn.cursor()
    c.execute("SELECT guardian_code FROM guardians WHERE guardian_code LIKE 'REP-%'")
    codes = c.fetchall()
    max_num = 0
    for (code,) in codes:
        if code:
            parts = code.split('-')
            if parts and parts[-1].isdigit():
                num = int(parts[-1])
                if num > max_num:
                    max_num = num
    next_num = max_num + 1
    return f"REP-2026-{next_num:04d}"

class CDNJHandler(http.server.BaseHTTPRequestHandler):

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html_content):
        body = html_content.encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def get_auth_user(self):
        auth_header = self.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ")[1]
        return verify_jwt(token)

    def check_perm(self, user_payload, perm_code):
        if not user_payload: return False
        roles = user_payload.get("roles", [])
        perms = user_payload.get("permissions", [])
        if "SUPERADMIN" in roles or "*" in perms or perm_code in perms:
            return True
        return False

    def read_body_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0: return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    # ==========================================================================
    # HTTP GET ROUTES
    # ==========================================================================
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Health Check
        if path == "/api/health":
            return self.send_json({"status": "ok", "system": "CDNJ Modular Platform (Python Backend)"})

        # Auth Current User Profile
        if path == "/api/auth/me":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
            return self.send_json({"user": user})

        # Student Search (Cajera)
        if path == "/api/payments/students/search":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:cashier:search]"}, 403)

            q = query.get("q", [""])[0].strip().lower()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            SELECT DISTINCT s.id, s.student_code, s.doc_id, s.first_name, s.last_name, s.grade, COALESCE(s.section, ''),
                   g.full_name, g.doc_id, g.phone, COALESCE(g.guardian_code, 'N/A'), COALESCE(g.first_name, ''), COALESCE(g.last_name, '')
            FROM students s
            LEFT JOIN student_guardians sg ON s.id = sg.student_id
            LEFT JOIN guardians g ON sg.guardian_id = g.id
            WHERE LOWER(COALESCE(s.first_name, '')) LIKE ? OR LOWER(COALESCE(s.last_name, '')) LIKE ?
               OR LOWER(COALESCE(s.student_code, '')) LIKE ? OR LOWER(COALESCE(s.doc_id, '')) LIKE ? OR LOWER(COALESCE(s.grade, '')) LIKE ?
               OR LOWER(COALESCE(g.full_name, '')) LIKE ? OR LOWER(COALESCE(g.doc_id, '')) LIKE ? OR LOWER(COALESCE(g.guardian_code, '')) LIKE ?
               OR LOWER(COALESCE(g.first_name, '')) LIKE ? OR LOWER(COALESCE(g.last_name, '')) LIKE ?
            LIMIT 25;
            """, (f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"))

            rows = c.fetchall()
            results = []
            for r in rows:
                c.execute("SELECT COUNT(*) FROM student_debts WHERE student_id = ? AND status = 'PENDING'", (r[0],))
                pending_count = c.fetchone()[0]
                results.append({
                    "id": r[0],
                    "studentCode": r[1],
                    "docId": r[2],
                    "firstName": r[3],
                    "lastName": r[4],
                    "grade": r[5],
                    "section": r[6],
                    "guardians": [{"guardian": {"fullName": r[7], "docId": r[8], "phone": r[9], "guardianCode": r[10], "firstName": r[11], "lastName": r[12]}}],
                    "debts": [1] * pending_count
                })
            conn.close()
            return self.send_json(results)

        # Student Pending Debts
        if path.startswith("/api/payments/students/") and path.endswith("/debts"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            student_id = path.split("/")[4]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code
            FROM student_debts d
            JOIN fee_concepts fc ON d.fee_concept_id = fc.id
            WHERE d.student_id = ? AND d.status IN ('PENDING', 'PARTIAL')
              AND fc.code NOT LIKE '%2027-2028%' AND fc.code NOT LIKE '%2028%';
            """, (student_id,))
            rows = sort_debts_by_hierarchy(c.fetchall())
            debts = [{
                "id": r[0],
                "amountUSD": r[1],
                "dueDate": r[2],
                "status": r[3],
                "feeConcept": {"name": r[4], "code": r[5]}
            } for r in rows]
            timeline = get_student_timeline(conn, student_id)
            conn.close()
            return self.send_json({"debts": debts, "timeline": timeline, "exchangeRate": CURRENT_EXCHANGE_RATE})

        # Student & Guardian Family Pending Debts (Consolidated for multi-represented)
        if path.startswith("/api/payments/students/") and path.endswith("/family-debts"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            student_id = path.split("/")[4]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # Find primary guardian for this student
            c.execute("""
            SELECT g.id, g.full_name, g.doc_id, COALESCE(g.guardian_code, 'N/A'), COALESCE(g.phone, ''), COALESCE(g.email, '')
            FROM student_guardians sg
            JOIN guardians g ON sg.guardian_id = g.id
            WHERE sg.student_id = ?
            LIMIT 1;
            """, (student_id,))
            g_row = c.fetchone()

            if g_row:
                guardian_data = {
                    "id": g_row[0],
                    "fullName": g_row[1],
                    "docId": g_row[2],
                    "guardianCode": g_row[3],
                    "phone": g_row[4],
                    "email": g_row[5] or "representante@gmail.com"
                }
                # Find all represented students under this guardian
                c.execute("""
                SELECT s.id, s.student_code, s.doc_id, s.first_name, s.last_name, s.grade, COALESCE(s.section, ''),
                       COALESCE(s.is_scholarship, 0), COALESCE(s.scholarship_pct, 0), COALESCE(s.scholarship_reason, '')
                FROM student_guardians sg
                JOIN students s ON sg.student_id = s.id
                WHERE sg.guardian_id = ?;
                """, (g_row[0],))
                s_rows = c.fetchall()
            else:
                guardian_data = None
                c.execute("""
                SELECT id, student_code, doc_id, first_name, last_name, grade, COALESCE(section, ''),
                       COALESCE(is_scholarship, 0), COALESCE(scholarship_pct, 0), COALESCE(scholarship_reason, '')
                FROM students WHERE id = ?;
                """, (student_id,))
                s_rows = c.fetchall()

            students_list = []
            total_family_usd = 0.0

            for sr in s_rows:
                sid = sr[0]
                c.execute("""
                SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code
                FROM student_debts d
                JOIN fee_concepts fc ON d.fee_concept_id = fc.id
                WHERE d.student_id = ? AND d.status IN ('PENDING', 'PARTIAL')
                  AND fc.code NOT LIKE '%2027-2028%' AND fc.code NOT LIKE '%2028%';
                """, (sid,))
                debt_rows = sort_debts_by_hierarchy(c.fetchall())
                debts = [{
                    "id": dr[0],
                    "amountUSD": dr[1],
                    "dueDate": dr[2],
                    "status": dr[3],
                    "feeConcept": {"name": dr[4], "code": dr[5]}
                } for dr in debt_rows]

                student_total = sum(d["amountUSD"] for d in debts)
                total_family_usd += student_total

                students_list.append({
                    "id": sr[0],
                    "studentCode": sr[1],
                    "docId": sr[2],
                    "firstName": sr[3],
                    "lastName": sr[4],
                    "grade": sr[5],
                    "section": sr[6],
                    "isScholarship": bool(sr[7]),
                    "scholarshipPct": float(sr[8]),
                    "scholarshipReason": sr[9],
                    "debts": debts,
                    "timeline": get_student_timeline(conn, sid),
                    "studentTotalUSD": student_total
                })

            conn.close()
            return self.send_json({
                "guardian": guardian_data,
                "representedCount": len(students_list),
                "students": students_list,
                "totalFamilyDebtUSD": round(total_family_usd, 2),
                "exchangeRate": CURRENT_EXCHANGE_RATE
            })

        # Student Advance Tuition Options (Unbilled future months)
        if path.startswith("/api/payments/students/") and path.endswith("/advance-options"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            student_id = path.split("/")[4]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # 1. Fetch student info
            c.execute("""
            SELECT id, student_code, first_name, last_name, grade,
                   COALESCE(is_scholarship, 0), COALESCE(scholarship_pct, 0), COALESCE(scholarship_reason, '')
            FROM students WHERE id = ?;
            """, (student_id,))
            st_row = c.fetchone()
            if not st_row:
                conn.close()
                return self.send_json({"error": "Estudiante no encontrado"}, 404)

            s_id, s_code, s_fname, s_lname, s_grade, s_isch, s_sch_pct, s_sch_reason = st_row
            s_grade = s_grade or ""
            s_sch_pct = float(s_sch_pct or 0.0)

            # 2. Get tuition rates by grade
            c.execute("SELECT grade_code, amount_usd FROM grade_tuition_rates;")
            rate_rows = c.fetchall()
            grade_rates = {r[0]: float(r[1]) for r in rate_rows}
            base_rate = 80.0
            for g_code, g_amt in grade_rates.items():
                if g_code.lower() in s_grade.lower() or s_grade.lower().startswith(g_code.lower()):
                    base_rate = g_amt
                    break

            monthly_fee = base_rate
            if s_isch and s_sch_pct > 0:
                monthly_fee = round(base_rate * (1.0 - (s_sch_pct / 100.0)), 2)

            # 3. Determine school year
            sys_date = get_current_system_date()
            cur_year = sys_date.year
            cur_month = sys_date.month
            if cur_month >= 9:
                start_year = cur_year
                end_year = cur_year + 1
            else:
                start_year = cur_year - 1
                end_year = cur_year

            school_year = f"{start_year}-{end_year}"

            # Check exclude august
            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'exclude_august';")
            aug_row = c.fetchone()
            exclude_august = (aug_row and aug_row[0] == '1')

            # Build full school year sequence (Septiembre a Julio - El último mes es Julio)
            school_year_sequence = []
            for m in range(9, 13):
                school_year_sequence.append((start_year, m))
            for m in range(1, 8):
                school_year_sequence.append((end_year, m))

            # 4. Fetch existing debts for this student
            c.execute("""
            SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code
            FROM student_debts d
            JOIN fee_concepts fc ON d.fee_concept_id = fc.id
            WHERE d.student_id = ?;
            """, (student_id,))
            existing_debts = c.fetchall()

            conn.close()

            # Map existing debts by (year, month)
            existing_by_period = {}
            for ed in existing_debts:
                d_id, amt, due, st, fc_name, fc_code = ed
                p_year = None
                p_month = None
                if due and len(due) >= 7:
                    try:
                        p_year = int(due[:4])
                        p_month = int(due[5:7])
                    except:
                        pass
                if not p_year and fc_code and fc_code.startswith("MEN-"):
                    parts = fc_code.split("-")
                    if len(parts) >= 3:
                        try:
                            p_month = int(parts[1])
                            p_year = int(parts[2]) if len(parts[2]) == 4 else int("20" + parts[2])
                        except:
                            pass
                if p_year and p_month:
                    existing_by_period[(p_year, p_month)] = {
                        "debtId": d_id,
                        "amountUSD": amt,
                        "status": st,
                        "dueDate": due,
                        "conceptName": fc_name,
                        "conceptCode": fc_code
                    }

            all_months = []
            unbilled_months = []

            for y, m in school_year_sequence:
                m_name = MONTH_NAMES_ES.get(m, f"Mes {m}")
                concept_code = f"MEN-{str(m).zfill(2)}-{y}"
                concept_name = f"Mensualidad {m_name} {y}"
                due_date = f"{y}-{str(m).zfill(2)}-01"

                item = {
                    "year": y,
                    "month": m,
                    "monthName": m_name,
                    "conceptCode": concept_code,
                    "conceptName": concept_name,
                    "dueDate": due_date,
                    "amountUSD": monthly_fee,
                    "baseRateUSD": base_rate,
                    "isScholarship": bool(s_isch),
                    "scholarshipPct": s_sch_pct
                }

                if (y, m) in existing_by_period:
                    ed = existing_by_period[(y, m)]
                    item["isBilled"] = True
                    item["debtId"] = ed["debtId"]
                    item["status"] = ed["status"]
                    item["billedAmountUSD"] = ed["amountUSD"]
                else:
                    item["isBilled"] = False
                    item["debtId"] = None
                    item["status"] = "UNBILLED"
                    unbilled_months.append(item)

                all_months.append(item)

            return self.send_json({
                "student": {
                    "id": s_id,
                    "studentCode": s_code,
                    "fullName": f"{s_fname} {s_lname}".strip(),
                    "firstName": s_fname,
                    "lastName": s_lname,
                    "grade": s_grade,
                    "baseMonthlyUSD": base_rate,
                    "finalMonthlyUSD": monthly_fee,
                    "isScholarship": bool(s_isch),
                    "scholarshipPct": s_sch_pct
                },
                "schoolYear": school_year,
                "unbilledMonths": unbilled_months,
                "allMonths": all_months,
                "exchangeRate": CURRENT_EXCHANGE_RATE
            })

        # Receipt Detail
        if path.startswith("/api/payments/receipts/"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:view_receipt"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            receipt_id = path.split("/")[4]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            SELECT p.id, p.receipt_number, p.total_usd, p.exchange_rate, p.total_local, p.status,
                   p.void_reason, p.created_at, u.full_name, u_v.full_name, p.voided_at, p.paper_number
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN users u_v ON p.voided_by_id = u_v.id
            WHERE p.id = ?;
            """, (receipt_id,))
            r = c.fetchone()
            if not r:
                conn.close()
                return self.send_json({"error": "No encontrado"}, 404)

            # Items
            c.execute("""
            SELECT pd.id, pd.amount_paid_usd, fc.name, s.first_name, s.last_name, s.grade, s.student_code, g.full_name, g.doc_id, g.phone, g.email
            FROM payment_details pd
            JOIN student_debts d ON pd.debt_id = d.id
            JOIN fee_concepts fc ON d.fee_concept_id = fc.id
            JOIN students s ON d.student_id = s.id
            LEFT JOIN student_guardians sg ON s.id = sg.student_id
            LEFT JOIN guardians g ON sg.guardian_id = g.id
            WHERE pd.payment_id = ?;
            """, (receipt_id,))
            item_rows = c.fetchall()
            items = []
            for ir in item_rows:
                items.append({
                    "id": ir[0],
                    "amountPaidUSD": ir[1],
                    "debt": {
                        "feeConcept": {"name": ir[2]},
                        "student": {
                            "firstName": ir[3], "lastName": ir[4], "grade": ir[5], "studentCode": ir[6],
                            "guardians": [{"guardian": {"fullName": ir[7], "docId": ir[8], "phone": ir[9], "email": ir[10] or "representante@gmail.com"}}]
                        }
                    }
                })

            # Methods
            c.execute("SELECT id, method, amount, currency, reference, COALESCE(bank, ''), COALESCE(reconciliation_status, 'AUTO'), COALESCE(bank_amount, 0), COALESCE(reconciled_at, '') FROM payment_methods WHERE payment_id = ?;", (receipt_id,))
            method_rows = c.fetchall()
            methods = []
            can_print_invoice = True
            for mr in method_rows:
                r_status = mr[6]
                if mr[1] in ['PAGO_MOVIL', 'TRANSFER_VES'] and r_status not in ['CONCILIADO', 'CONCILIADO_MAYOR']:
                    can_print_invoice = False
                methods.append({
                    "id": mr[0], "method": mr[1], "amount": mr[2], "currency": mr[3],
                    "reference": mr[4], "bank": mr[5], "reconciliationStatus": r_status,
                    "bankAmount": mr[7], "reconciledAt": mr[8]
                })

            conn.close()
            return self.send_json({
                "id": r[0],
                "receiptNumber": r[1],
                "totalUSD": r[2],
                "exchangeRate": r[3],
                "totalLocal": r[4],
                "status": r[5],
                "voidReason": r[6],
                "createdAt": r[7],
                "processedBy": {"fullName": r[8]},
                "voidedBy": {"fullName": r[9]} if r[9] else None,
                "voidedAt": r[10],
                "paperNumber": r[11],
                "paymentItems": items,
                "methods": methods,
                "canPrintInvoice": can_print_invoice
            })

        # Dashboard Summary (Admin) - Financial Incomes (Bs & $) & Delinquency Analytics
        if path.startswith("/api/payments/dashboard-summary"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:admin:view_history"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:admin:view_history]"}, 403)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            period = params.get("period", ["daily"])[0]  # 'daily', 'weekly', 'monthly'

            now = datetime.now()
            today_str = now.strftime("%Y-%m-%d")

            if period == "weekly":
                monday = now.date() - timedelta(days=now.weekday())
                start_date_str = monday.strftime("%Y-%m-%d 00:00:00")
                period_label = "Esta Semana"
            elif period == "monthly":
                start_date_str = now.strftime("%Y-%m-01 00:00:00")
                period_label = "Este Mes"
            else:
                start_date_str = f"{today_str} 00:00:00"
                period_label = "Hoy"

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # 1. Incomes by currency and method in period
            c.execute("""
            SELECT pm.method, pm.currency, SUM(pm.amount), SUM(pm.amount / p.exchange_rate)
            FROM payment_methods pm
            JOIN payments p ON pm.payment_id = p.id
            WHERE p.status = 'COMPLETED' AND p.created_at >= ?
            GROUP BY pm.method, pm.currency;
            """, (start_date_str,))
            method_rows = c.fetchall()

            income_usd = 0.0
            income_ves = 0.0
            income_ves_in_usd = 0.0
            methods_breakdown = {"CASH_USD": 0.0, "CASH_VES": 0.0, "PAGO_MOVIL": 0.0, "TRANSFER_VES": 0.0, "PUNTO_VENTA": 0.0}

            for mr in method_rows:
                m_type, m_curr, m_amt, m_amt_usd = mr[0], mr[1], mr[2] or 0.0, mr[3] or 0.0
                methods_breakdown[m_type] = methods_breakdown.get(m_type, 0.0) + m_amt
                if m_curr == 'USD':
                    income_usd += m_amt
                else:
                    income_ves += m_amt
                    income_ves_in_usd += m_amt_usd

            c.execute("""
            SELECT COUNT(DISTINCT id), SUM(total_usd)
            FROM payments
            WHERE status = 'COMPLETED' AND created_at >= ?;
            """, (start_date_str,))
            total_row = c.fetchone()
            receipts_count = total_row[0] or 0
            total_collected_usd = total_row[1] or 0.0

            # 2. Delinquency Statistics (Morosidad Institucional)
            c.execute("SELECT COUNT(*) FROM students WHERE status = 'ACTIVE';")
            total_students = c.fetchone()[0] or 0

            c.execute("""
            SELECT COUNT(DISTINCT d.student_id), SUM(d.amount_usd), COUNT(d.id)
            FROM student_debts d
            JOIN students s ON d.student_id = s.id
            WHERE d.status != 'PAID' AND s.status = 'ACTIVE';
            """)
            del_row = c.fetchone()
            delinquent_students = del_row[0] or 0
            total_delinquent_usd = del_row[1] or 0.0
            total_delinquent_debts = del_row[2] or 0

            on_time_students = max(0, total_students - delinquent_students)
            delinquency_pct = round((delinquent_students / total_students * 100), 1) if total_students > 0 else 0.0

            # 3. Delinquency by Educational Level
            c.execute("""
            SELECT gtr.group_name, COUNT(DISTINCT d.student_id), SUM(d.amount_usd)
            FROM student_debts d
            JOIN students s ON d.student_id = s.id
            JOIN grade_tuition_rates gtr ON s.grade LIKE (gtr.grade_code || '%')
            WHERE d.status != 'PAID' AND s.status = 'ACTIVE'
            GROUP BY gtr.group_name;
            """)
            level_rows = c.fetchall()
            delinquency_by_level = [{"level": lr[0], "studentsCount": lr[1], "amountUSD": round(lr[2], 2)} for lr in level_rows]

            # 4. Top Delinquent Representatives
            c.execute("""
            SELECT g.full_name, g.doc_id, g.phone, COUNT(DISTINCT s.id), SUM(d.amount_usd)
            FROM guardians g
            JOIN student_guardians sg ON g.id = sg.guardian_id
            JOIN students s ON sg.student_id = s.id
            JOIN student_debts d ON s.id = d.student_id
            WHERE d.status != 'PAID' AND s.status = 'ACTIVE'
            GROUP BY g.id
            ORDER BY SUM(d.amount_usd) DESC
            LIMIT 10;
            """)
            top_rows = c.fetchall()
            top_delinquents = [{
                "fullName": tr[0],
                "docId": tr[1],
                "phone": tr[2],
                "representedCount": tr[3],
                "totalDebtUSD": round(tr[4], 2)
            } for tr in top_rows]

            conn.close()

            return self.send_json({
                "period": period,
                "periodLabel": period_label,
                "exchangeRate": CURRENT_EXCHANGE_RATE,
                "financials": {
                    "incomeUSD": round(income_usd, 2),
                    "incomeVES": round(income_ves, 2),
                    "incomeVESinUSD": round(income_ves_in_usd, 2),
                    "totalCollectedUSD": round(total_collected_usd, 2),
                    "receiptsCount": receipts_count,
                    "methodsBreakdown": methods_breakdown
                },
                "delinquency": {
                    "totalStudents": total_students,
                    "delinquentStudents": delinquent_students,
                    "onTimeStudents": on_time_students,
                    "delinquencyPct": delinquency_pct,
                    "totalDelinquentUSD": round(total_delinquent_usd, 2),
                    "totalDelinquentVES": round(total_delinquent_usd * CURRENT_EXCHANGE_RATE, 2),
                    "totalDelinquentDebts": total_delinquent_debts,
                    "byLevel": delinquency_by_level,
                    "topDelinquents": top_delinquents
                }
            })

        # History Transactions (Admin)
        if path == "/api/payments/transactions":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:admin:view_history"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:admin:view_history]"}, 403)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            SELECT p.id, p.receipt_number, p.total_usd, p.exchange_rate, p.total_local, p.status,
                   p.created_at, u.full_name, s.first_name, s.last_name, s.grade, p.paper_number
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN payment_details pd ON p.id = pd.payment_id
            LEFT JOIN student_debts d ON pd.debt_id = d.id
            LEFT JOIN students s ON d.student_id = s.id
            GROUP BY p.id
            ORDER BY p.created_at DESC;
            """)
            rows = c.fetchall()
            transactions = [{
                "id": r[0],
                "receiptNumber": r[1],
                "totalUSD": r[2],
                "exchangeRate": r[3],
                "totalLocal": r[4],
                "status": r[5],
                "createdAt": r[6],
                "processedBy": {"fullName": r[7]},
                "paperNumber": r[11],
                "paymentItems": [{"debt": {"student": {"firstName": r[8], "lastName": r[9], "grade": r[10]}}}]
            } for r in rows]
            conn.close()
            return self.send_json({"transactions": transactions, "exchangeRate": CURRENT_EXCHANGE_RATE})

        # Re-Enrollment Settings
        if path == "/api/payments/re-enrollment/settings":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT value_text FROM system_settings WHERE key_name = 're_enrollment_active';")
            row = c.fetchone()
            enabled = (row[0] == '1') if row else False

            c.execute("SELECT amount_usd FROM fee_concepts WHERE code = 'MAT-2027-2028';")
            amt_row = c.fetchone()
            amount_usd = amt_row[0] if amt_row else 120.0
            conn.close()

            return self.send_json({
                "enabled": enabled,
                "schoolYear": "2027-2028",
                "amountUSD": amount_usd
            })

        # Paper Control Settings & Status
        if path == "/api/payments/paper-control":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT key_name, value_text FROM system_settings WHERE key_name LIKE 'paper_%';")
            settings = dict(c.fetchall())
            conn.close()

            start_num = int(settings.get("paper_start_number", "1000"))
            end_num = int(settings.get("paper_end_number", "2000"))
            current_num = int(settings.get("paper_current_number", "1000"))
            check_interval = int(settings.get("paper_check_interval", "5"))
            count_since = int(settings.get("paper_count_since_check", "0"))

            total_available = max(0, end_num - start_num + 1)
            used_sheets = max(0, current_num - start_num)
            remaining_sheets = max(0, end_num - current_num + 1)

            return self.send_json({
                "startNumber": start_num,
                "endNumber": end_num,
                "currentNumber": current_num,
                "checkInterval": check_interval,
                "countSinceCheck": count_since,
                "totalAvailable": total_available,
                "usedSheets": used_sheets,
                "remainingSheets": remaining_sheets,
                "checkRequiredNext": (count_since >= check_interval)
            })

        # Paper Control Audit Logs
        if path == "/api/payments/paper-control/logs":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            SELECT l.id, l.status, l.expected_paper, l.actual_paper, l.reason, l.created_at, u.full_name
            FROM paper_verification_logs l
            JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC;
            """)
            rows = c.fetchall()
            logs = [{
                "id": r[0],
                "status": r[1],
                "expectedPaper": r[2],
                "actualPaper": r[3],
                "reason": r[4],
                "createdAt": r[5],
                "user": {"fullName": r[6]}
            } for r in rows]
            conn.close()
            return self.send_json({"logs": logs})

        # Paper Control Batch Inspection (Invoices created since last confirmed "MATCH")
        if path == "/api/payments/paper-control/batch-since-last-yes":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            search_q = params.get("q", [""])[0].strip().lower()

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # Find timestamp of last MATCH
            c.execute("SELECT created_at FROM paper_verification_logs WHERE status = 'MATCH' ORDER BY created_at DESC LIMIT 1;")
            last_match_row = c.fetchone()
            last_yes_ts = last_match_row[0] if last_match_row else "1970-01-01T00:00:00Z"

            c.execute("""
            SELECT p.id, p.receipt_number, p.paper_number, p.total_usd, p.total_local, p.status,
                   p.created_at, u.full_name as cashier_name,
                   COALESCE(g.full_name, 'N/A') as rep_name,
                   COALESCE(g.doc_id, 'N/A') as rep_doc_id,
                   GROUP_CONCAT(DISTINCT s.first_name || ' ' || s.last_name) as student_names,
                   p.void_reason, u_v.full_name as voided_by_name, p.voided_at
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN users u_v ON p.voided_by_id = u_v.id
            LEFT JOIN payment_details pd ON p.id = pd.payment_id
            LEFT JOIN student_debts d ON pd.debt_id = d.id
            LEFT JOIN students s ON d.student_id = s.id
            LEFT JOIN student_guardians sg ON s.id = sg.student_id
            LEFT JOIN guardians g ON sg.guardian_id = g.id
            WHERE p.created_at >= ?
            GROUP BY p.id
            ORDER BY p.created_at DESC;
            """, (last_yes_ts,))
            pay_rows = c.fetchall()
            conn.close()

            batch = []
            for r in pay_rows:
                rep_name = r[8]
                rep_doc = r[9]
                student_names = r[10] or "N/A"
                rec_num = r[1] or ""
                paper_num = r[2] or ""

                if search_q:
                    combined = f"{rep_doc} {rep_name} {student_names} {rec_num} {paper_num}".lower()
                    if search_q not in combined:
                        continue

                batch.append({
                    "id": r[0],
                    "receiptNumber": r[1],
                    "paperNumber": r[2],
                    "totalUSD": r[3],
                    "totalLocal": r[4],
                    "status": r[5],
                    "createdAt": r[6],
                    "cashierName": r[7],
                    "representativeName": rep_name,
                    "representativeDocId": rep_doc,
                    "studentNames": student_names,
                    "voidReason": r[11],
                    "voidedByName": r[12],
                    "voidedAt": r[13]
                })

            return self.send_json({
                "lastYesTimestamp": last_yes_ts,
                "totalInBatch": len(batch),
                "invoices": batch
            })

        # Re-Enrollment Summary & Student Status Report
        if path == "/api/payments/re-enrollment/summary":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            school_year = params.get("schoolYear", ["2027-2028"])[0].strip()
            concept_code = f"MAT-{school_year}"

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            c.execute("SELECT value_text FROM system_settings WHERE key_name = 're_enrollment_active';")
            s_row = c.fetchone()
            enabled = (s_row[0] == '1') if s_row else True

            # All active students
            c.execute("""
            SELECT s.id, s.student_code, (s.first_name || ' ' || s.last_name) AS full_name, s.grade, COALESCE(s.section, 'A')
            FROM students s
            WHERE COALESCE(s.status, 'ACTIVE') = 'ACTIVE'
            ORDER BY s.grade ASC, s.last_name ASC;
            """)
            students = c.fetchall()
            total_active_students = len(students)

            # Re-enrollment records for school year
            c.execute("""
            SELECT r.student_id, r.next_grade, r.next_section, r.promoted_status, r.enrolled_at, p.receipt_number
            FROM re_enrollment_records r
            JOIN payments p ON r.payment_id = p.id
            WHERE r.school_year = ?;
            """, (school_year,))
            re_records = {r[0]: {"nextGrade": r[1], "nextSection": r[2], "promotedStatus": r[3], "enrolledAt": r[4], "receiptNumber": r[5]} for r in c.fetchall()}

            # Paid debts for enrollment concept
            c.execute("""
            SELECT sd.student_id, p.receipt_number, p.created_at
            FROM student_debts sd
            JOIN fee_concepts fc ON sd.fee_concept_id = fc.id
            JOIN payment_details pd ON sd.id = pd.debt_id
            JOIN payments p ON pd.payment_id = p.id
            WHERE fc.code = ? AND sd.status = 'PAID';
            """, (concept_code,))
            paid_debts = {r[0]: {"receiptNumber": r[1], "createdAt": r[2]} for r in c.fetchall()}

            students_list = []
            grade_summary_map = {}

            total_enrolled = 0
            total_promoted = 0
            total_repeating = 0

            for st in students:
                st_id, st_code, st_name, st_grade, st_sec = st[0], st[1], st[2], st[3], st[4]
                
                is_enrolled = (st_id in re_records) or (st_id in paid_debts)
                rec = re_records.get(st_id, {})
                paid_info = paid_debts.get(st_id, {})

                next_grade = rec.get("nextGrade") or suggest_next_grade(st_grade)
                next_sec = rec.get("nextSection") or st_sec
                promoted_status = rec.get("promotedStatus") or ("PROMOTED" if is_enrolled else "N/A")
                receipt_num = rec.get("receiptNumber") or paid_info.get("receiptNumber") or "-"
                enrolled_at = rec.get("enrolledAt") or paid_info.get("createdAt") or "-"

                if is_enrolled:
                    total_enrolled += 1
                    if promoted_status == "PROMOTED":
                        total_promoted += 1
                    elif promoted_status == "REPEATING":
                        total_repeating += 1

                # Group by grade
                if st_grade not in grade_summary_map:
                    grade_summary_map[st_grade] = {
                        "grade": st_grade,
                        "totalStudents": 0,
                        "enrolledCount": 0,
                        "pendingCount": 0,
                        "promotedCount": 0,
                        "repeatingCount": 0
                    }

                g_entry = grade_summary_map[st_grade]
                g_entry["totalStudents"] += 1
                if is_enrolled:
                    g_entry["enrolledCount"] += 1
                    if promoted_status == "PROMOTED":
                        g_entry["promotedCount"] += 1
                    elif promoted_status == "REPEATING":
                        g_entry["repeatingCount"] += 1
                else:
                    g_entry["pendingCount"] += 1

                students_list.append({
                    "studentId": st_id,
                    "studentCode": st_code,
                    "fullName": st_name,
                    "currentGrade": st_grade,
                    "currentSection": st_sec,
                    "status": "ENROLLED" if is_enrolled else "PENDING",
                    "nextGrade": next_grade,
                    "nextSection": next_sec,
                    "promotedStatus": promoted_status,
                    "receiptNumber": receipt_num,
                    "enrolledAt": enrolled_at
                })

            conn.close()

            total_pending = total_active_students - total_enrolled
            enrolled_pct = round((total_enrolled / total_active_students * 100), 1) if total_active_students > 0 else 0.0

            return self.send_json({
                "enabled": enabled,
                "schoolYear": school_year,
                "totalActiveStudents": total_active_students,
                "totalEnrolled": total_enrolled,
                "totalPending": total_pending,
                "enrolledPercentage": enrolled_pct,
                "totalPromoted": total_promoted,
                "totalRepeating": total_repeating,
                "gradeBreakdown": list(grade_summary_map.values()),
                "studentsList": students_list
            })

        # List System Users (Superadmin Only)
        if path == "/api/admin/users":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and not self.check_perm(user, "core:users:manage")):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("""
            SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.created_at,
                   COALESCE(GROUP_CONCAT(r.name, ', '), 'SIN_ROL') as role_names,
                   COALESCE(GROUP_CONCAT(r.id, ','), '') as role_ids
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            GROUP BY u.id
            ORDER BY u.created_at ASC;
            """)
            rows = c.fetchall()

            c.execute("SELECT id, name, description FROM roles ORDER BY name ASC;")
            r_rows = c.fetchall()
            conn.close()

            users_list = []
            for r in rows:
                users_list.append({
                    "id": r[0],
                    "username": r[1],
                    "email": r[2],
                    "fullName": r[3],
                    "isActive": bool(r[4]),
                    "createdAt": r[5],
                    "roles": [x.strip() for x in r[6].split(',') if x.strip()],
                    "roleIds": [x.strip() for x in r[7].split(',') if x.strip()]
                })

            roles_list = [{"id": r[0], "name": r[1], "description": r[2]} for r in r_rows]
            return self.send_json({"users": users_list, "roles": roles_list})

        # List Database Backups (Superadmin Only)
        if path == "/api/admin/backups":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'last_backup_timestamp';")
            r1 = c.fetchone()
            last_ts = r1[0] if r1 else None

            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'last_backup_file';")
            r2 = c.fetchone()
            last_file = r2[0] if r2 else None

            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'last_backup_reason';")
            r3 = c.fetchone()
            last_reason = r3[0] if r3 else None

            conn.close()

            backups_list = []
            if os.path.exists(BACKUPS_DIR):
                for f in sorted(os.listdir(BACKUPS_DIR), reverse=True):
                    if f.endswith(".db"):
                        f_path = os.path.join(BACKUPS_DIR, f)
                        stat = os.stat(f_path)
                        mtime = datetime.fromtimestamp(stat.st_mtime)
                        size_mb = round(stat.st_size / (1024 * 1024), 2)
                        backups_list.append({
                            "filename": f,
                            "timestamp": mtime.isoformat(),
                            "formattedDate": format_es_datetime(mtime),
                            "sizeBytes": stat.st_size,
                            "sizeMB": size_mb
                        })

            last_backup_obj = None
            if last_ts:
                try:
                    dt = datetime.fromisoformat(last_ts)
                    day_name = DAYS_ES[dt.weekday()]
                    month_name = MONTH_NAMES_ES.get(dt.month, "")
                    date_formatted = f"{dt.day} de {month_name} de {dt.year}"
                    time_str = dt.strftime("%I:%M:%S %p")
                    size_mb = 0
                    if last_file and os.path.exists(os.path.join(BACKUPS_DIR, last_file)):
                        size_mb = round(os.path.getsize(os.path.join(BACKUPS_DIR, last_file)) / (1024 * 1024), 2)
                    last_backup_obj = {
                        "filename": last_file,
                        "dayName": day_name,
                        "dateFormatted": date_formatted,
                        "timeStr": time_str,
                        "sizeMb": size_mb,
                        "reason": last_reason
                    }
                except Exception as e:
                    print("Error parsing last_backup_obj:", e)

            return self.send_json({
                "lastBackupTimestamp": last_ts,
                "lastBackupFormatted": format_es_datetime(last_ts) if last_ts else "Sin Registros",
                "lastBackupFile": last_file,
                "lastBackupReason": last_reason,
                "lastBackup": last_backup_obj,
                "backups": backups_list
            })

        # Time Simulation State (Superadmin & Demo)
        if path == "/api/admin/time-simulation":
            sys_date = get_current_system_date()
            real_date = datetime.now()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'simulated_date';")
            row = c.fetchone()
            conn.close()
            is_simulated = bool(row and row[0])
            return self.send_json({
                "isSimulated": is_simulated,
                "realDate": real_date.isoformat(),
                "realDateFormatted": format_es_datetime(real_date),
                "simulatedDate": sys_date.isoformat(),
                "simulatedDateFormatted": format_es_datetime(sys_date),
                "dateOnly": sys_date.strftime("%Y-%m-%d")
            })

        # Download Database Backup File (Superadmin Only)
        if path == "/api/admin/backups/download":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            filename = params.get("file", [""])[0].strip()
            if not filename or ".." in filename or "/" in filename:
                return self.send_json({"error": "Nombre de archivo inválido"}, 400)

            file_path = os.path.join(BACKUPS_DIR, filename)
            if not os.path.exists(file_path):
                return self.send_json({"error": "Archivo de respaldo no encontrado"}, 404)

            with open(file_path, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", "application/x-sqlite3")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
            return

        # Daily Reconciliation List (Admin & Cashier)
        if path == "/api/payments/daily-reconciliation":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:view_receipt"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            date_str = params.get("date", [""])[0].strip()
            if not date_str:
                date_str = datetime.now().strftime("%Y-%m-%d")

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            c.execute("""
            SELECT p.id, p.receipt_number, p.created_at, p.total_usd, p.total_local, p.exchange_rate,
                   u.full_name as cashier_name,
                   COALESCE(g.full_name, 'N/A') as rep_name,
                   GROUP_CONCAT(DISTINCT s.first_name || ' ' || s.last_name) as student_names,
                   p.paper_number
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN payment_details pd ON p.id = pd.payment_id
            LEFT JOIN student_debts d ON pd.debt_id = d.id
            LEFT JOIN students s ON d.student_id = s.id
            LEFT JOIN student_guardians sg ON s.id = sg.student_id
            LEFT JOIN guardians g ON sg.guardian_id = g.id
            WHERE p.created_at LIKE ? AND p.status = 'COMPLETED'
            GROUP BY p.id
            ORDER BY p.created_at DESC;
            """, (f"{date_str}%",))
            pay_rows = c.fetchall()

            payments = []
            stat_counts = {"CONCILIADO": 0, "CONCILIADO_MAYOR": 0, "NO_CONCILIADO": 0, "PENDIENTE": 0, "AUTO": 0}

            for pr in pay_rows:
                pid = pr[0]
                c.execute("""
                SELECT id, method, amount, currency, reference, COALESCE(bank, ''),
                       COALESCE(reconciliation_status, 'AUTO'), COALESCE(bank_amount, 0), COALESCE(reconciled_at, '')
                FROM payment_methods
                WHERE payment_id = ?;
                """, (pid,))
                m_rows = c.fetchall()

                methods = []
                can_print = True
                for mr in m_rows:
                    st = mr[6]
                    if mr[1] in ['PAGO_MOVIL', 'TRANSFER_VES'] and st not in ['CONCILIADO', 'CONCILIADO_MAYOR']:
                        can_print = False

                    stat_counts[st] = stat_counts.get(st, 0) + 1

                    methods.append({
                        "id": mr[0],
                        "method": mr[1],
                        "amount": mr[2],
                        "currency": mr[3],
                        "reference": mr[4],
                        "bank": mr[5],
                        "reconciliationStatus": st,
                        "bankAmount": mr[7],
                        "reconciledAt": mr[8]
                    })

                payments.append({
                    "id": pr[0],
                    "receiptNumber": pr[1],
                    "createdAt": pr[2],
                    "totalUSD": pr[3],
                    "totalLocal": pr[4],
                    "exchangeRate": pr[5],
                    "cashierName": pr[6],
                    "representativeName": pr[7],
                    "studentNames": pr[8] or "N/A",
                    "paperNumber": pr[9],
                    "methods": methods,
                    "canPrintInvoice": can_print
                })

            conn.close()

            return self.send_json({
                "date": date_str,
                "payments": payments,
                "summary": {
                    "totalPayments": len(payments),
                    "conciliatedCount": stat_counts.get("CONCILIADO", 0),
                    "greaterCount": stat_counts.get("CONCILIADO_MAYOR", 0),
                    "unreconciledCount": stat_counts.get("NO_CONCILIADO", 0),
                    "pendingCount": stat_counts.get("PENDIENTE", 0)
                }
            })

        # BCV Rate Query
        if path == "/api/payments/rates/bcv":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)
            bcv_info = fetch_bcv_rate()
            return self.send_json(bcv_info)

        # Rate History Query (Week + Single Date)
        if path.startswith("/api/payments/rates/history"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            target_date = params.get("date", [None])[0]

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            single_result = None
            if target_date:
                c.execute("SELECT date_str, rate, source, created_at FROM exchange_rate_history WHERE date_str = ?;", (target_date,))
                row = c.fetchone()
                if row:
                    single_result = {"date": row[0], "rate": row[1], "source": row[2], "createdAt": row[3]}
                else:
                    single_result = {"date": target_date, "rate": None, "source": "SIN REGISTRO", "createdAt": ""}

            # Monday to Friday of current week
            today = datetime.now().date()
            monday = today - timedelta(days=today.weekday())
            day_names = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
            week_history = []
            
            bcv_info = fetch_bcv_rate()
            bcv_rate = bcv_info.get("bcvRate") or CURRENT_EXCHANGE_RATE

            for i in range(5):
                d_str = (monday + timedelta(days=i)).strftime("%Y-%m-%d")
                c.execute("SELECT rate, source FROM exchange_rate_history WHERE date_str = ?;", (d_str,))
                row = c.fetchone()
                if row:
                    week_history.append({"dayName": day_names[i], "date": d_str, "rate": row[0], "source": row[1]})
                else:
                    week_history.append({"dayName": day_names[i], "date": d_str, "rate": bcv_rate, "source": "BCV"})

            conn.close()
            return self.send_json({
                "single": single_result,
                "weekHistory": week_history,
                "currentRate": CURRENT_EXCHANGE_RATE,
                "bcvRate": bcv_rate
            })

        # Tuition Rates Config by Grade / Group
        if path == "/api/payments/tuition-rates":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT grade_code, grade_name, group_name, amount_usd, updated_at FROM grade_tuition_rates ORDER BY rowid ASC;")
            rows = c.fetchall()

            rates = [{"gradeCode": r[0], "gradeName": r[1], "groupName": r[2], "amountUSD": r[3], "updatedAt": r[4]} for r in rows]

            amounts = [r["amountUSD"] for r in rates]
            is_global = len(set(amounts)) == 1
            global_amount = amounts[0] if is_global and len(amounts) > 0 else 50.0

            groups = {}
            for r in rates:
                grp = r["groupName"]
                if grp not in groups:
                    groups[grp] = []
                groups[grp].append(r["amountUSD"])
            
            group_summary = {grp: (sum(val)/len(val) if len(val)>0 else 50.0) for grp, val in groups.items()}

            c.execute("SELECT amount_usd FROM fee_concepts WHERE code = 'MAT-2026-2027';")
            m26 = c.fetchone()
            c.execute("SELECT amount_usd FROM fee_concepts WHERE code = 'MAT-2027-2028';")
            m27 = c.fetchone()
            conn.close()

            return self.send_json({
                "rates": rates,
                "isGlobal": is_global,
                "globalAmountUSD": global_amount,
                "groupSummary": group_summary,
                "enrollmentAmount2026": m26[0] if m26 else 100.0,
                "enrollmentAmount2027": m27[0] if m27 else 120.0
            })

        # Rates & Concepts Config
        if path == "/api/payments/rates":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id, code, name, amount_usd, is_recurring FROM fee_concepts ORDER BY name ASC;")
            rows = c.fetchall()
            concepts = [{"id": r[0], "code": r[1], "name": r[2], "amountUSD": r[3], "isRecurring": bool(r[4])} for r in rows]
            conn.close()
            return self.send_json({"exchangeRate": CURRENT_EXCHANGE_RATE, "concepts": concepts})

        # Cash Closing Summary
        if path == "/api/payments/cash-closing/summary":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:admin:close_box"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            cashier_filter = query.get("cashierId", ["ALL"])[0].strip()

            conn = get_db_connection()
            c = conn.cursor()

            # Obtener listado de cajeras/usuarios que han procesado pagos completados
            c.execute("""
            SELECT DISTINCT u.id, u.full_name, u.username
            FROM payments p
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'COMPLETED'
            ORDER BY u.full_name ASC;
            """)
            cashier_rows = c.fetchall()
            available_cashiers = [{"id": r[0], "fullName": r[1], "username": r[2]} for r in cashier_rows]

            # Consulta filtrada por cajera o consolidada
            sql = """
            SELECT pm.method, pm.amount, pm.currency
            FROM payment_methods pm
            JOIN payments p ON pm.payment_id = p.id
            WHERE p.status = 'COMPLETED'
            """
            params = []
            if cashier_filter and cashier_filter != "ALL":
                sql += " AND p.user_id = ?"
                params.append(cashier_filter)

            c.execute(sql, params)
            rows = c.fetchall()
            conn.close()

            cash_usd = sum(r[1] for r in rows if r[0] == 'CASH_USD')
            cash_ves = sum(r[1] for r in rows if r[0] == 'CASH_VES')
            dig_usd = sum(r[1] for r in rows if r[0] not in ('CASH_USD', 'CASH_VES') and r[2] == 'USD')
            dig_ves = sum(r[1] for r in rows if r[0] not in ('CASH_USD', 'CASH_VES') and r[2] == 'VES')
            grand_total_usd = cash_usd + (cash_ves / CURRENT_EXCHANGE_RATE) + dig_usd + (dig_ves / CURRENT_EXCHANGE_RATE)

            return self.send_json({
                "totalCashUSD": round(cash_usd, 2),
                "totalCashVES": round(cash_ves, 2),
                "totalDigitalUSD": round(dig_usd, 2),
                "totalDigitalVES": round(dig_ves, 2),
                "grandTotalUSD": round(grand_total_usd, 2),
                "exchangeRate": CURRENT_EXCHANGE_RATE,
                "selectedCashierId": cashier_filter,
                "availableCashiers": available_cashiers
            })

        # Get All Students for Management
        if path == "/api/students/manage":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
            
            status_filter = query.get("status", ["ALL"])[0]
            q = query.get("q", [""])[0].strip().lower()
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            sql = """
            SELECT s.id, s.student_code, COALESCE(s.doc_id, ''), s.first_name, s.last_name, s.grade, COALESCE(s.section, 'A'), COALESCE(s.status, 'ACTIVE'),
                   g.id, COALESCE(g.guardian_code, 'N/A'), COALESCE(g.doc_id, ''), COALESCE(g.full_name, ''), COALESCE(g.phone, ''), COALESCE(g.email, ''), COALESCE(g.status, 'ACTIVE'),
                   COALESCE(s.is_scholarship, 0), COALESCE(s.scholarship_pct, 0), COALESCE(s.scholarship_reason, '')
            FROM students s
            LEFT JOIN student_guardians sg ON s.id = sg.student_id
            LEFT JOIN guardians g ON sg.guardian_id = g.id
            WHERE 1=1
            """
            params = []
            if status_filter != "ALL":
                sql += " AND s.status = ?"
                params.append(status_filter)
            
            if q:
                sql += """ AND (LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ? OR LOWER(s.student_code) LIKE ? OR LOWER(COALESCE(s.doc_id, '')) LIKE ? OR LOWER(COALESCE(g.full_name, '')) LIKE ? OR LOWER(COALESCE(g.doc_id, '')) LIKE ?)"""
                params.extend([f"%{q}%"] * 6)
                
            sql += " ORDER BY s.student_code DESC LIMIT 300;"
            c.execute(sql, params)
            rows = c.fetchall()
            
            students = []
            for r in rows:
                students.append({
                    "id": r[0],
                    "studentCode": r[1],
                    "docId": r[2],
                    "firstName": r[3],
                    "lastName": r[4],
                    "fullName": f"{r[3]} {r[4]}",
                    "grade": r[5],
                    "section": r[6],
                    "status": r[7],
                    "isScholarship": bool(r[15]),
                    "scholarshipPct": float(r[16]),
                    "scholarshipReason": r[17],
                    "guardian": {
                        "id": r[8],
                        "guardianCode": r[9],
                        "docId": r[10],
                        "fullName": r[11],
                        "phone": r[12],
                        "email": r[13],
                        "status": r[14]
                    } if r[8] else None
                })
            conn.close()
            return self.send_json({"students": students})

        # Get All Guardians List
        if path == "/api/students/guardians":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id, full_name, doc_id, COALESCE(guardian_code, 'N/A'), COALESCE(phone, '') FROM guardians ORDER BY full_name ASC;")
            rows = c.fetchall()
            guardians = [{"id": r[0], "fullName": r[1], "docId": r[2], "guardianCode": r[3], "phone": r[4]} for r in rows]
            conn.close()
            return self.send_json({"guardians": guardians})

        # SERVE FRONTEND INDEX HTML
        if path == "/" or path == "/index.html":
            html_path = os.path.join(os.path.dirname(__file__), "index.html")
            if os.path.exists(html_path):
                with open(html_path, "r", encoding="utf-8") as f:
                    return self.send_html(f.read())

        return self.send_json({"error": "Ruta no encontrada"}, 404)

    # ==========================================================================
    # HTTP POST ROUTES
    # ==========================================================================
    def do_POST(self):
        global CURRENT_EXCHANGE_RATE
        path = urllib.parse.urlparse(self.path).path
        body = self.read_body_json()

        # Auth Login
        if path == "/api/auth/login":
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("""
            SELECT u.id, u.username, u.email, u.full_name, u.password_hash
            FROM users u WHERE LOWER(u.username) = LOWER(?) AND u.is_active = 1;
            """, (username,))
            user_row = c.fetchone()

            if not user_row or user_row[4] != hash_pw(password):
                conn.close()
                return self.send_json({"error": "Credenciales inválidas", "message": "Usuario o contraseña incorrectos."}, 401)

            user_id = user_row[0]
            # Roles
            c.execute("SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?;", (user_id,))
            roles = [r[0] for r in c.fetchall()]

            # Permissions
            c.execute("""
            SELECT DISTINCT p.code FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = ?;
            """, (user_id,))
            perms = [r[0] for r in c.fetchall()]
            if "SUPERADMIN" in roles:
                perms.append("*")

            conn.close()

            user_payload = {
                "userId": user_id,
                "username": user_row[1],
                "email": user_row[2],
                "fullName": user_row[3],
                "roles": roles,
                "permissions": perms
            }

            token = generate_jwt(user_payload)
            return self.send_json({"token": token, "user": user_payload})

        # Process Payment Transaction (Cajera)
        if path == "/api/payments/transactions":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:create_payment"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:cashier:create_payment]"}, 403)

            debt_ids = body.get("selectedDebtIds", [])
            methods = body.get("methods", [])
            rate = body.get("exchangeRate", CURRENT_EXCHANGE_RATE)
            is_partial = body.get("isPartial", False)
            partial_amount_usd = float(body.get("partialAmountUSD", 0))

            if not debt_ids or not methods:
                return self.send_json({"error": "Validación fallida", "message": "Seleccione deudas y método de pago."}, 400)

            # Bloque atómico protegido contra concurrencia multi-cajera
            with PAYMENT_LOCK:
                conn = get_db_connection()
                c = conn.cursor()

                try:
                    q_marks = ",".join(["?"] * len(debt_ids))
                    c.execute(f"""
                    SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code, d.student_id
                    FROM student_debts d
                    JOIN fee_concepts fc ON d.fee_concept_id = fc.id
                    WHERE d.id IN ({q_marks}) AND d.status IN ('PENDING', 'PARTIAL');
                    """, debt_ids)
                    debt_rows = c.fetchall()

                    # Si alguna deuda seleccionada ya no existe o fue cobrada por otra cajera en el mismo instante
                    if len(debt_rows) != len(set(debt_ids)):
                        conn.close()
                        return self.send_json({
                            "error": "Conflicto de Concurrencia",
                            "message": "Una o más deudas seleccionadas acaban de ser procesadas por otra cajera o ya no están pendientes. Por favor recargue el panel del estudiante."
                        }, 409)

                    # Sort selected debts by strict hierarchy
                    debt_rows = sort_debts_by_hierarchy(debt_rows)

                    # Validate FIFO debt hierarchy per student
                    selected_set = set(r[0] for r in debt_rows)
                    student_ids = set(r[6] for r in debt_rows)

                    for st_id in student_ids:
                        c.execute("""
                        SELECT d.id, d.amount_usd, d.due_date, d.status, fc.name, fc.code
                        FROM student_debts d
                        JOIN fee_concepts fc ON d.fee_concept_id = fc.id
                        WHERE d.student_id = ? AND d.status IN ('PENDING', 'PARTIAL');
                        """, (st_id,))
                        all_st_debts = sort_debts_by_hierarchy(c.fetchall())
                        
                        seen_unselected = False
                        for sd in all_st_debts:
                            sd_id = sd[0]
                            sd_name = sd[4]
                            if sd_id in selected_set:
                                if seen_unselected:
                                    conn.close()
                                    return self.send_json({
                                        "error": "Error de Prelación de Cobro (FIFO)",
                                        "message": f"No puede saltar la Matrícula del año escolar en curso ni las mensualidades pendientes del período anterior ({sd_name}) antes de procesar pagos posteriores."
                                    }, 400)
                            else:
                                seen_unselected = True

                    total_debt_usd = sum(r[1] for r in debt_rows)

                    if is_partial and partial_amount_usd > 0 and partial_amount_usd < total_debt_usd:
                        total_usd = partial_amount_usd
                    else:
                        total_usd = total_debt_usd

                    total_local = total_usd * rate

                    # Fetch & update paper settings atómicamente
                    c.execute("SELECT key_name, value_text FROM system_settings WHERE key_name LIKE 'paper_%';")
                    paper_settings = dict(c.fetchall())
                    paper_curr = int(paper_settings.get("paper_current_number", "1000"))
                    paper_interval = max(1, int(paper_settings.get("paper_check_interval", "5")))
                    paper_count_since = int(paper_settings.get("paper_count_since_check", "0"))

                    assigned_paper_str = str(paper_curr)
                    next_paper_curr = paper_curr + 1
                    next_count_since = paper_count_since + 1
                    paper_check_required = (next_count_since >= paper_interval)

                    now_iso = datetime.now(timezone.utc).isoformat()
                    c.execute("""
                    INSERT INTO system_settings (key_name, value_text, updated_at)
                    VALUES ('paper_current_number', ?, ?)
                    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
                    """, (str(next_paper_curr), now_iso))

                    c.execute("""
                    INSERT INTO system_settings (key_name, value_text, updated_at)
                    VALUES ('paper_count_since_check', ?, ?)
                    ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
                    """, (str(next_count_since), now_iso))

                    # Generación atómica del correlativo de recibo (REC-YYYY-XXXXX)
                    cur_year = datetime.now().year
                    seq_key = f"RECEIPT_{cur_year}"
                    fallback_q = f"SELECT MAX(CAST(SUBSTR(receipt_number, 10) AS INTEGER)) FROM payments WHERE receipt_number LIKE 'REC-{cur_year}-%';"
                    receipt_seq = get_next_sequence_number(c, seq_key, fallback_query=fallback_q)
                    receipt_num = f"REC-{cur_year}-{str(receipt_seq).zfill(5)}"

                    payment_id = f"pay_{int(time.time() * 1000)}"
                    now_str = datetime.now(timezone.utc).isoformat()

                    c.execute("""
                    INSERT INTO payments (id, receipt_number, user_id, total_usd, exchange_rate, total_local, status, created_at, paper_number)
                    VALUES (?,?,?,?,?,?,'COMPLETED',?,?);
                    """, (payment_id, receipt_num, user["userId"], total_usd, rate, total_local, now_str, assigned_paper_str))

                    # Distribuir el abono / pago
                    remaining_to_apply = total_usd
                    for dr in debt_rows:
                        debt_id, current_amount = dr[0], dr[1]
                        if remaining_to_apply <= 0:
                            break
                        
                        pay_for_this_debt = min(remaining_to_apply, current_amount)
                        new_debt_balance = current_amount - pay_for_this_debt

                        if new_debt_balance <= 0.01:
                            new_status = 'PAID'
                            new_debt_balance = 0.0
                        else:
                            new_status = 'PARTIAL'

                        detail_id = f"pd_{int(time.time() * 1000)}_{debt_id}"
                        c.execute("INSERT INTO payment_details VALUES (?,?,?,?);", (detail_id, payment_id, debt_id, pay_for_this_debt))
                        c.execute("UPDATE student_debts SET amount_usd = ?, status = ? WHERE id = ?;", (new_debt_balance, new_status, debt_id))
                        
                        # Check if debt concept is Matrícula to save re-enrollment record
                        c.execute("""
                        SELECT fc.code, sd.student_id, s.grade, COALESCE(s.section, 'A')
                        FROM student_debts sd
                        JOIN fee_concepts fc ON sd.fee_concept_id = fc.id
                        JOIN students s ON sd.student_id = s.id
                        WHERE sd.id = ?;
                        """, (debt_id,))
                        debt_info = c.fetchone()
                        if debt_info:
                            concept_code_d, st_id_d, curr_g_d, curr_s_d = debt_info[0], debt_info[1], debt_info[2], debt_info[3]
                            if concept_code_d.startswith("MAT-") or "MATRICULA" in concept_code_d.upper() or "INSCRIPCION" in concept_code_d.upper():
                                re_enrollment_data = body.get("reEnrollmentData", {})
                                st_re_info = re_enrollment_data.get(st_id_d, {}) if isinstance(re_enrollment_data, dict) else {}
                                next_g = st_re_info.get("nextGrade") or suggest_next_grade(curr_g_d)
                                next_s = st_re_info.get("nextSection") or curr_s_d or "A"
                                prom_status = st_re_info.get("promotedStatus") or "PROMOTED"
                                sy = concept_code_d.replace("MAT-", "") if concept_code_d.startswith("MAT-") else "2027-2028"

                                re_record_id = f"re_{int(time.time() * 1000)}_{st_id_d}"
                                c.execute("""
                                INSERT INTO re_enrollment_records (id, student_id, school_year, payment_id, current_grade, next_grade, next_section, promoted_status, enrolled_at, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(id) DO UPDATE SET next_grade=excluded.next_grade, next_section=excluded.next_section, promoted_status=excluded.promoted_status;
                                """, (re_record_id, st_id_d, sy, payment_id, curr_g_d, next_g, next_s, prom_status, now_str, now_str))

                        remaining_to_apply -= pay_for_this_debt

                    # Standardize methods if dict or list
                    methods_list = []
                    if isinstance(methods, dict):
                        for k, v in methods.items():
                            methods_list.append({"method": k, "amount": float(v), "currency": "USD" if "USD" in k else "VES"})
                    elif isinstance(methods, list):
                        methods_list = methods

                    # Insert methods
                    for idx, m in enumerate(methods_list):
                        m_id = f"pm_{int(time.time() * 1000)}_{idx}"
                        m_type = m.get("method") if isinstance(m, dict) else str(m)
                        m_amount = float(m.get("amount", 0)) if isinstance(m, dict) else 0.0
                        m_curr = m.get("currency", "USD") if isinstance(m, dict) else "USD"
                        m_ref = m.get("reference") if isinstance(m, dict) else None
                        m_bank = m.get("bank") if isinstance(m, dict) else None

                        r_status = "PENDIENTE" if m_type in ["PAGO_MOVIL", "TRANSFER_VES"] else "AUTO"
                        c.execute("""
                        INSERT INTO payment_methods (id, payment_id, method, amount, currency, reference, bank, reconciliation_status)
                        VALUES (?,?,?,?,?,?,?,?);
                        """, (m_id, payment_id, m_type, m_amount, m_curr, m_ref, m_bank, r_status))

                    conn.commit()
                except Exception as err:
                    conn.rollback()
                    conn.close()
                    return self.send_json({"error": "Error al procesar el pago concurrentemente", "message": str(err)}, 500)

                conn.close()

            return self.send_json({
                "id": payment_id,
                "receiptNumber": receipt_num,
                "totalUSD": total_usd,
                "isPartial": is_partial,
                "paperNumber": assigned_paper_str,
                "paperCheckRequired": paper_check_required,
                "paperCurrentNumber": str(next_paper_curr)
            }, 201)

        # Advance Tuition (Generate Future Monthly Debts for Student(s))
        if path == "/api/payments/students/advance-tuition":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:create_payment") and not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta permiso de caja."}, 403)

            student_ids = body.get("studentIds") or []
            if not student_ids and body.get("studentId"):
                student_ids = [body.get("studentId")]

            months = body.get("months") or []
            if not student_ids:
                return self.send_json({"error": "Validación", "message": "Debe especificar al menos un estudiante."}, 400)
            if not months:
                return self.send_json({"error": "Validación", "message": "Debe seleccionar al menos un mes a adelantar."}, 400)

            created_debts = []
            skipped_count = 0

            with PAYMENT_LOCK:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()

                c.execute("SELECT grade_code, amount_usd FROM grade_tuition_rates;")
                grade_rates = {r[0]: float(r[1]) for r in c.fetchall()}
                default_rate = 80.0

                for sid in student_ids:
                    c.execute("""
                    SELECT id, first_name, last_name, grade,
                           COALESCE(is_scholarship, 0), COALESCE(scholarship_pct, 0)
                    FROM students WHERE id = ?;
                    """, (sid,))
                    st_row = c.fetchone()
                    if not st_row:
                        continue

                    s_id, s_fname, s_lname, s_grade, s_isch, s_sch_pct = st_row
                    s_grade = s_grade or ""
                    s_sch_pct = float(s_sch_pct or 0.0)

                    st_amount = default_rate
                    for g_code, g_amt in grade_rates.items():
                        if g_code.lower() in s_grade.lower() or s_grade.lower().startswith(g_code.lower()):
                            st_amount = g_amt
                            break

                    if s_isch and s_sch_pct > 0:
                        st_amount = round(st_amount * (1.0 - (s_sch_pct / 100.0)), 2)

                    for m_info in months:
                        m_year = int(m_info.get("year"))
                        m_num = int(m_info.get("month"))
                        month_name = MONTH_NAMES_ES.get(m_num, f"Mes {m_num}")
                        concept_code = f"MEN-{str(m_num).zfill(2)}-{m_year}"
                        concept_name = f"Mensualidad {month_name} {m_year}"
                        due_date = f"{m_year}-{str(m_num).zfill(2)}-01"

                        # 1. Ensure Fee Concept exists
                        c.execute("SELECT id FROM fee_concepts WHERE code = ?;", (concept_code,))
                        fc_row = c.fetchone()
                        if fc_row:
                            fc_id = fc_row[0]
                        else:
                            fc_id = f"fc_men_{m_year}_{str(m_num).zfill(2)}"
                            c.execute("""
                            INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
                            VALUES (?, ?, ?, ?, 1, 1)
                            ON CONFLICT(code) DO NOTHING;
                            """, (fc_id, concept_code, concept_name, st_amount))

                        # 2. Check if student already has this debt (avoid duplicate)
                        c.execute("""
                        SELECT id FROM student_debts
                        WHERE student_id = ? AND (fee_concept_id = ? OR due_date = ?);
                        """, (sid, fc_id, due_date))
                        existing_d = c.fetchone()
                        if existing_d:
                            skipped_count += 1
                            continue

                        # 3. Insert student_debts record with status 'PENDING'
                        debt_id = f"sd_adv_{m_num}_{sid}_{int(time.time()*1000)}"
                        c.execute("""
                        INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
                        VALUES (?, ?, ?, ?, ?, 'PENDING');
                        """, (debt_id, sid, fc_id, st_amount, due_date))

                        created_debts.append({
                            "id": debt_id,
                            "studentId": sid,
                            "studentName": f"{s_fname} {s_lname}".strip(),
                            "conceptName": concept_name,
                            "conceptCode": concept_code,
                            "dueDate": due_date,
                            "amountUSD": st_amount
                        })

                conn.commit()
                conn.close()

            return self.send_json({
                "success": True,
                "createdCount": len(created_debts),
                "skippedCount": skipped_count,
                "createdDebts": created_debts,
                "message": f"Se han generado exitosamente {len(created_debts)} mensualidades por adelantado."
            }, 201)

        # Delete Unpaid Pending Debt (e.g. if cashier added an advance by mistake)
        if path == "/api/payments/debts/delete-unpaid":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:create_payment") and not self.check_perm(user, "payments:cashier:search"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            debt_id = body.get("debtId")
            if not debt_id:
                return self.send_json({"error": "Validación", "message": "ID de deuda requerido."}, 400)

            with PAYMENT_LOCK:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT status FROM student_debts WHERE id = ?;", (debt_id,))
                d_row = c.fetchone()
                if not d_row:
                    conn.close()
                    return self.send_json({"error": "No encontrada", "message": "Deuda no encontrada."}, 404)

                if d_row[0] != 'PENDING':
                    conn.close()
                    return self.send_json({"error": "Operación Denegada", "message": "No se puede eliminar una deuda que ya tiene pagos o abonos."}, 400)

                c.execute("SELECT COUNT(*) FROM payment_details WHERE debt_id = ?;", (debt_id,))
                if c.fetchone()[0] > 0:
                    conn.close()
                    return self.send_json({"error": "Operación Denegada", "message": "La deuda ya posee detalles de pago vinculados."}, 400)

                c.execute("DELETE FROM student_debts WHERE id = ?;", (debt_id,))
                conn.commit()
                conn.close()

            return self.send_json({"success": True, "message": "Mensualidad pendiente removida exitosamente."})

        # Create New User (Superadmin Only)
        if path == "/api/admin/users":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and not self.check_perm(user, "core:users:manage")):
                return self.send_json({"error": "Acceso Denegado", "message": "Solo el SUPERADMIN puede crear usuarios."}, 403)

            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            full_name = body.get("fullName", "").strip()
            email = body.get("email", "").strip()
            role_id = body.get("roleId", "r_cajera").strip()

            if not username or len(username) < 3:
                return self.send_json({"error": "Validación", "message": "El nombre de usuario debe tener al menos 3 caracteres."}, 400)
            if not password or len(password) < 4:
                return self.send_json({"error": "Validación", "message": "La contraseña debe tener al menos 4 caracteres."}, 400)
            if not full_name:
                return self.send_json({"error": "Validación", "message": "El nombre completo es obligatorio."}, 400)
            if not email:
                email = f"{username.lower()}@cdnj.edu"

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?);", (username,))
            if c.fetchone():
                conn.close()
                return self.send_json({"error": "Conflicto", "message": f"El usuario '{username}' ya existe."}, 409)

            c.execute("SELECT id FROM roles WHERE id = ? OR name = ?;", (role_id, role_id))
            r_found = c.fetchone()
            if not r_found:
                conn.close()
                return self.send_json({"error": "Validación", "message": "Rol inválido especificado."}, 400)
            actual_role_id = r_found[0]

            new_user_id = f"u_{int(time.time() * 1000)}"
            pw_hash = hash_pw(password)
            now_str = datetime.now(timezone.utc).isoformat()

            c.execute("""
            INSERT INTO users (id, username, email, password_hash, full_name, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?);
            """, (new_user_id, username, email, pw_hash, full_name, now_str))

            c.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?);", (new_user_id, actual_role_id))
            conn.commit()
            conn.close()

            return self.send_json({
                "success": True,
                "message": f"Usuario '{username}' creado exitosamente con rol {actual_role_id}.",
                "userId": new_user_id
            }, 201)

        # Reset User Password (Superadmin Only)
        if path.startswith("/api/admin/users/") and path.endswith("/reset-password"):
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and not self.check_perm(user, "core:users:manage")):
                return self.send_json({"error": "Acceso Denegado", "message": "Solo el SUPERADMIN puede resetear contraseñas."}, 403)

            target_user_id = path.split("/")[4]
            new_password = body.get("newPassword", "").strip()
            if not new_password or len(new_password) < 4:
                return self.send_json({"error": "Validación", "message": "La nueva contraseña debe tener mínimo 4 caracteres."}, 400)

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT username FROM users WHERE id = ?;", (target_user_id,))
            target_row = c.fetchone()
            if not target_row:
                conn.close()
                return self.send_json({"error": "No encontrado", "message": "Usuario no encontrado."}, 404)

            target_username = target_row[0]
            new_pw_hash = hash_pw(new_password)
            c.execute("UPDATE users SET password_hash = ? WHERE id = ?;", (new_pw_hash, target_user_id))
            conn.commit()
            conn.close()

            return self.send_json({
                "success": True,
                "message": f"Contraseña actualizada exitosamente para el usuario '{target_username}'."
            })

        # Toggle User Active Status (Superadmin Only)
        if path.startswith("/api/admin/users/") and path.endswith("/toggle-status"):
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and not self.check_perm(user, "core:users:manage")):
                return self.send_json({"error": "Acceso Denegado", "message": "Solo el SUPERADMIN puede cambiar el estado de los usuarios."}, 403)

            target_user_id = path.split("/")[4]
            if user.get("userId") == target_user_id:
                return self.send_json({"error": "Operación Denegada", "message": "No puedes desactivar tu propia cuenta actual."}, 400)

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT username, is_active FROM users WHERE id = ?;", (target_user_id,))
            target_row = c.fetchone()
            if not target_row:
                conn.close()
                return self.send_json({"error": "No encontrado", "message": "Usuario no encontrado."}, 404)

            new_status = 0 if target_row[1] == 1 else 1
            c.execute("UPDATE users SET is_active = ? WHERE id = ?;", (new_status, target_user_id))
            conn.commit()
            conn.close()

            status_text = "activado" if new_status == 1 else "desactivado"
            return self.send_json({
                "success": True,
                "isActive": bool(new_status),
                "message": f"Usuario '{target_row[0]}' {status_text} exitosamente."
            })

        # Create Manual Database Backup (Superadmin Only)
        if path == "/api/admin/backups/create":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            result = create_database_backup(reason="MANUAL_SUPERADMIN")
            return self.send_json(result)

        # Restore Database Backup (Superadmin Only)
        if path == "/api/admin/backups/restore":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            filename = body.get("filename", "").strip()
            file_data_b64 = body.get("fileData", "").strip()

            target_restore_path = None

            if filename:
                if ".." in filename or "/" in filename:
                    return self.send_json({"error": "Nombre de archivo inválido"}, 400)
                target_restore_path = os.path.join(BACKUPS_DIR, filename)
                if not os.path.exists(target_restore_path):
                    return self.send_json({"error": "Archivo de respaldo no encontrado en el servidor."}, 404)
            elif file_data_b64:
                try:
                    raw_bytes = base64.b64decode(file_data_b64)
                    temp_path = os.path.join(BACKUPS_DIR, f"temp_upload_{int(time.time())}.db")
                    with open(temp_path, "wb") as f:
                        f.write(raw_bytes)
                    target_restore_path = temp_path
                except Exception as err:
                    return self.send_json({"error": "Error de decodificación de archivo", "message": str(err)}, 400)
            else:
                return self.send_json({"error": "Debe especificar un archivo de respaldo o subir un archivo .db"}, 400)

            # 1. Create safety backup before restoring
            safety_info = create_database_backup(reason="SAFETY_BEFORE_RESTORE")

            # 2. Perform online restore into main DB_FILE
            try:
                src_conn = sqlite3.connect(target_restore_path)
                main_conn = sqlite3.connect(DB_FILE)
                src_conn.backup(main_conn)
                main_conn.close()
                src_conn.close()

                # Re-run init_db to ensure schema integrity
                init_db()

                return self.send_json({
                    "success": True,
                    "message": "Base de datos restaurada exitosamente desde la copia seleccionada. Se generó un respaldo de seguridad previo.",
                    "safetyBackup": safety_info["filename"]
                })
            except Exception as restore_err:
                print("Error durante la restauración:", restore_err)
                return self.send_json({"error": "Error al restaurar la base de datos", "message": str(restore_err)}, 500)

        # Time Simulation Set Target Date (Superadmin Only)
        if path == "/api/admin/time-simulation/set":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            data = body or {}
            target_date_str = data.get("targetDate")
            days_to_add = int(data.get("daysToAdvance", 0))
            months_to_add = int(data.get("monthsToAdvance", 0))

            current_sys = get_current_system_date()

            if target_date_str:
                try:
                    target_dt = datetime.fromisoformat(target_date_str.replace("Z", ""))
                except Exception:
                    try:
                        target_dt = datetime.strptime(target_date_str, "%Y-%m-%d")
                    except Exception:
                        return self.send_json({"error": "Fecha inválida", "message": "El formato de fecha no es válido."}, 400)
            elif months_to_add > 0:
                new_m = current_sys.month + months_to_add
                new_y = current_sys.year + (new_m - 1) // 12
                new_m = (new_m - 1) % 12 + 1
                target_dt = datetime(new_y, new_m, 1, current_sys.hour, current_sys.minute, current_sys.second)
            elif days_to_add > 0:
                target_dt = current_sys + timedelta(days=days_to_add)
            else:
                return self.send_json({"error": "Parámetro faltante", "message": "Indique una fecha o días/meses a avanzar."}, 400)

            conn = sqlite3.connect(DB_FILE)
            result = advance_simulated_time(conn, target_dt)
            conn.close()

            return self.send_json({
                "success": True,
                "message": f"Tiempo del sistema avanzado a {format_es_datetime(target_dt)}",
                "simulation": result
            })

        # Time Simulation Reset to Real Time (Superadmin Only)
        if path == "/api/admin/time-simulation/reset":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not user or ("SUPERADMIN" not in user_roles and user.get("username") != "superadmin"):
                return self.send_json({"error": "Acceso Denegado", "message": "Esta opción solo está disponible para el SUPERADMIN."}, 403)

            conn = sqlite3.connect(DB_FILE)
            result = reset_simulated_time(conn)
            conn.close()

            return self.send_json(result)

        # Execute Bank Statement Reconciliation (Admin & Superadmin Only)
        if path == "/api/payments/reconcile":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:admin:view_history"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:admin:view_history]. La conciliación bancaria está reservada para Administradores."}, 403)

            bank_txs = body.get("bankTransactions", [])
            raw_text = body.get("rawText", "")

            # Parse raw text if bank_txs not directly provided as JSON
            if raw_text and not bank_txs:
                for line in raw_text.splitlines():
                    line = line.strip()
                    if not line: continue
                    # Find reference (explicit Ref keyword or 5-15 digit string)
                    ref_match = re.search(r'(?:ref|referencia|num|nro)?[\s:-]*(\d{5,15})', line, re.IGNORECASE)
                    # Find numbers that represent amounts
                    amt_tokens = re.findall(r'\b\d+(?:[\.,]\d+)?\b', line)
                    if ref_match and amt_tokens:
                        ref = ref_match.group(1)
                        # Pick the last amount token that is not equal to the reference
                        potential_amts = [t for t in amt_tokens if t != ref]
                        if potential_amts:
                            raw_amt = potential_amts[-1]
                            clean_amt = raw_amt.replace('.', '').replace(',', '.') if ',' in raw_amt else raw_amt
                            try:
                                amt_val = float(clean_amt)
                                bank_txs.append({"reference": ref, "amount": amt_val})
                            except Exception:
                                pass

            if not bank_txs:
                return self.send_json({"error": "Error de Validación", "message": "No se encontraron transacciones bancarias válidas en los datos proporcionados."}, 400)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # Get all pending or previously non-conciliated payment methods
            c.execute("""
            SELECT pm.id, pm.method, pm.amount, pm.currency, pm.reference, pm.payment_id
            FROM payment_methods pm
            JOIN payments p ON pm.payment_id = p.id
            WHERE pm.method IN ('PAGO_MOVIL', 'TRANSFER_VES') AND p.status = 'COMPLETED';
            """)
            pm_rows = c.fetchall()

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            reconciled_exact = 0
            reconciled_greater = 0
            unreconciled = 0

            for pm in pm_rows:
                pm_id = pm[0]
                pm_method = pm[1]
                pm_amount = float(pm[2])
                pm_ref = (pm[4] or "").strip()

                matched_bt = None
                for bt in bank_txs:
                    bt_ref = str(bt.get("reference", "")).strip()
                    if not bt_ref or not pm_ref:
                        continue
                    if bt_ref == pm_ref or bt_ref.endswith(pm_ref) or pm_ref.endswith(bt_ref) or (len(pm_ref) >= 5 and bt_ref.endswith(pm_ref[-5:])):
                        matched_bt = bt
                        break

                if matched_bt:
                    bt_amount = float(matched_bt.get("amount", 0))
                    # Compare cashier reported amount vs bank statement amount
                    if abs(pm_amount - bt_amount) < 0.05:
                        new_status = "CONCILIADO"
                        reconciled_exact += 1
                    elif pm_amount > bt_amount:
                        new_status = "CONCILIADO_MAYOR"  # Cashier reported amount > bank amount
                        reconciled_greater += 1
                    else:
                        new_status = "CONCILIADO"
                        reconciled_exact += 1

                    c.execute("""
                    UPDATE payment_methods
                    SET reconciliation_status = ?, bank_amount = ?, reconciled_at = ?
                    WHERE id = ?;
                    """, (new_status, bt_amount, now_str, pm_id))
                else:
                    new_status = "NO_CONCILIADO"
                    unreconciled += 1
                    c.execute("""
                    UPDATE payment_methods
                    SET reconciliation_status = ?
                    WHERE id = ?;
                    """, (new_status, pm_id))

            conn.commit()
            conn.close()

            return self.send_json({
                "success": True,
                "message": "Conciliación bancaria procesada exitosamente.",
                "summary": {
                    "exactMatches": reconciled_exact,
                    "greaterMatches": reconciled_greater,
                    "unreconciledMatches": unreconciled,
                    "totalProcessed": len(pm_rows)
                }
            })

        # Void Receipt Transaction (Admin & Cajera)
        if path.startswith("/api/payments/transactions/") and path.endswith("/void"):
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            if not self.check_perm(user, "payments:admin:void_receipt") and not self.check_perm(user, "payments:cashier:create_payment") and not self.check_perm(user, "payments:cashier:view_receipt") and "CAJERA" not in user_roles:
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso para anular recibos."}, 403)

            payment_id = path.split("/")[4]
            reason = body.get("reason", "").strip()

            if len(reason) < 5:
                return self.send_json({"error": "Validación fallida", "message": "Especifique motivo (mínimo 5 caracteres)."}, 400)

            with PAYMENT_LOCK:
                conn = get_db_connection()
                c = conn.cursor()
                try:
                    c.execute("SELECT status FROM payments WHERE id = ?;", (payment_id,))
                    row = c.fetchone()

                    if not row or row[0] == 'VOIDED':
                        conn.close()
                        return self.send_json({"error": "Error", "message": "El recibo no existe o ya fue anulado."}, 400)

                    now_str = datetime.now(timezone.utc).isoformat()
                    c.execute("""
                    UPDATE payments SET status = 'VOIDED', void_reason = ?, voided_by_id = ?, voided_at = ?
                    WHERE id = ?;
                    """, (reason, user["userId"], now_str, payment_id))

                    # Revert debts to PENDING and restore paid amount
                    c.execute("SELECT debt_id, amount_paid_usd FROM payment_details WHERE payment_id = ?;", (payment_id,))
                    details = c.fetchall()
                    for did, amt_paid in details:
                        c.execute("UPDATE student_debts SET amount_usd = amount_usd + ?, status = 'PENDING' WHERE id = ?;", (amt_paid, did))

                    # Delete or invalidate re-enrollment record if linked to this payment
                    c.execute("DELETE FROM re_enrollment_records WHERE payment_id = ?;", (payment_id,))

                    conn.commit()
                except Exception as err:
                    conn.rollback()
                    conn.close()
                    return self.send_json({"error": "Error al anular transacción", "message": str(err)}, 500)
                conn.close()

            return self.send_json({"message": "Recibo anulado exitosamente y deudas restablecidas."})

        # Toggle Re-Enrollment Module Active Status (Superadmin Only for 2027-2028 / 2028)
        if path == "/api/payments/re-enrollment/toggle":
            user = self.get_auth_user()
            user_roles = user.get("roles", []) if user else []
            school_year = str(body.get("schoolYear", "2027-2028")).strip()

            is_superadmin = user and ("SUPERADMIN" in user_roles or user.get("username") == "superadmin")

            if school_year != "2026-2027" and not is_superadmin:
                return self.send_json({
                    "error": "Acceso Denegado",
                    "message": "La configuración y activación de la mensualidad/matrícula 2027-2028 / 2028 solo está disponible para el SUPERADMIN."
                }, 403)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            enabled = bool(body.get("enabled", False)) if "enabled" in body else False
            if not is_superadmin:
                c.execute("SELECT value_text FROM system_settings WHERE key_name = 're_enrollment_active';")
                r_e = c.fetchone()
                enabled = (r_e[0] == '1') if r_e else False

            val_str = '1' if enabled else '0'

            if is_superadmin and "enabled" in body:
                c.execute("""
                INSERT INTO system_settings (key_name, value_text, updated_at)
                VALUES ('re_enrollment_active', ?, ?)
                ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
                """, (val_str, datetime.now().isoformat()))

            concept_code = f"MAT-{school_year}"

            # Update enrollment amount if provided
            new_amount = body.get("amountUSD")
            if new_amount is not None:
                new_amount = float(new_amount)
                if new_amount > 0:
                    c.execute("SELECT id FROM fee_concepts WHERE code = ?;", (concept_code,))
                    fc_row = c.fetchone()
                    if fc_row:
                        c.execute("UPDATE fee_concepts SET amount_usd = ? WHERE id = ?;", (new_amount, fc_row[0]))
                    else:
                        c.execute("INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active) VALUES (?, ?, ?, ?, 0, 1);",
                                  (f"fc_mat_{school_year.replace('-', '_')}", concept_code, f"Matrícula / Inscripción Año Escolar {school_year}", new_amount))

                    c.execute("""
                    UPDATE student_debts SET amount_usd = ?
                    WHERE fee_concept_id IN (SELECT id FROM fee_concepts WHERE code = ?) AND status = 'PENDING';
                    """, (new_amount, concept_code))

            c.execute("SELECT amount_usd FROM fee_concepts WHERE code = ?;", (concept_code,))
            amt_row = c.fetchone()
            curr_amt = amt_row[0] if amt_row else 120.0

            conn.commit()
            conn.close()

            state_label = f"ACTIVADO con tarifa de Matrícula en ${curr_amt:.2f} USD" if enabled else "DESACTIVADO (Oculto)"
            return self.send_json({
                "success": True,
                "message": f"Configuración {school_year} {state_label}.",
                "enabled": enabled,
                "amountUSD": curr_amt,
                "schoolYear": school_year
            })

        # Paper Control Settings Update (Admin Only)
        if path == "/api/payments/paper-control/settings":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates") and not self.check_perm(user, "payments:admin:view_history"):
                return self.send_json({"error": "Acceso Denegado", "message": "Permiso insuficiente para configurar hojas membretadas."}, 403)

            start_num = int(body.get("startNumber", 1000))
            end_num = int(body.get("endNumber", 2000))
            current_num = int(body.get("currentNumber", start_num))
            check_interval = max(1, int(body.get("checkInterval", 5)))

            if start_num < 1 or end_num < start_num:
                return self.send_json({"error": "Rango inválido", "message": "El número 'desde' debe ser mayor a 0 y 'hasta' mayor o igual a 'desde'."}, 400)

            if current_num < start_num or current_num > end_num + 1:
                return self.send_json({"error": "Número actual fuera de rango", "message": "El próximo número a imprimir debe estar dentro del rango configurado."}, 400)

            now_str = datetime.now(timezone.utc).isoformat()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            updates = [
                ("paper_start_number", str(start_num)),
                ("paper_end_number", str(end_num)),
                ("paper_current_number", str(current_num)),
                ("paper_check_interval", str(check_interval)),
                ("paper_count_since_check", "0")
            ]
            for k, v in updates:
                c.execute("""
                INSERT INTO system_settings (key_name, value_text, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
                """, (k, v, now_str))
            conn.commit()
            conn.close()

            return self.send_json({"success": True, "message": "Configuración de hojas membretadas actualizada correctamente."})

        # Paper Control Sync / Verification Response (Cashier)
        if path == "/api/payments/paper-control/sync":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)

            confirmed = body.get("confirmed", True)
            actual_paper = body.get("actualPaperNumber")
            reason_text = body.get("reason", "").strip()

            now_str = datetime.now(timezone.utc).isoformat()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            c.execute("SELECT value_text FROM system_settings WHERE key_name = 'paper_current_number';")
            row = c.fetchone()
            expected_num = int(row[0]) if row else 1000

            status_str = "MATCH" if confirmed else "DISCREPANCY"
            actual_num = expected_num if confirmed else (int(actual_paper) if actual_paper is not None else expected_num)

            if not reason_text:
                reason_text = "Verificación conforme (Sí)" if confirmed else "Inconsistencia / Salto de hoja reportado"

            # Insert Audit Log
            log_id = f"pvl_{int(time.time() * 1000)}"
            c.execute("""
            INSERT INTO paper_verification_logs (id, user_id, status, expected_paper, actual_paper, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """, (log_id, user["userId"], status_str, str(expected_num), str(actual_num), reason_text, now_str))

            if not confirmed and actual_paper is not None:
                c.execute("""
                INSERT INTO system_settings (key_name, value_text, updated_at)
                VALUES ('paper_current_number', ?, ?)
                ON CONFLICT(key_name) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at;
                """, (str(actual_num), now_str))

            c.execute("""
            INSERT INTO system_settings (key_name, value_text, updated_at)
            VALUES ('paper_count_since_check', '0', ?)
            ON CONFLICT(key_name) DO UPDATE SET value_text = '0', updated_at = excluded.updated_at;
            """, (now_str,))

            conn.commit()
            conn.close()

            return self.send_json({"success": True, "currentNumber": actual_num, "message": "Verificación de hoja membretada registrada con éxito en la bitácora."})

        # Update Tuition Rates by Grade / Group
        if path == "/api/payments/tuition-rates":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            mode = body.get("mode")  # "GLOBAL", "GROUP", or "GRADE"
            now_str = datetime.now().isoformat()

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            if mode == "GLOBAL":
                amount = float(body.get("globalAmountUSD", 50.0))
                c.execute("UPDATE grade_tuition_rates SET amount_usd = ?, updated_at = ?;", (amount, now_str))
                c.execute("""
                UPDATE student_debts
                SET amount_usd = ?
                WHERE status = 'PENDING'
                  AND fee_concept_id IN (SELECT id FROM fee_concepts WHERE is_recurring = 1 OR code LIKE 'MEN-%');
                """, (amount,))

            elif mode == "GROUP":
                group_amounts = body.get("groupAmountsUSD", {})
                for grp, amt in group_amounts.items():
                    amt_val = float(amt)
                    c.execute("UPDATE grade_tuition_rates SET amount_usd = ?, updated_at = ? WHERE group_name = ?;", (amt_val, now_str, grp))
                    c.execute("""
                    UPDATE student_debts
                    SET amount_usd = ?
                    WHERE status = 'PENDING'
                      AND fee_concept_id IN (SELECT id FROM fee_concepts WHERE is_recurring = 1 OR code LIKE 'MEN-%')
                      AND student_id IN (
                          SELECT s.id FROM students s
                          JOIN grade_tuition_rates gtr ON s.grade LIKE (gtr.grade_code || '%')
                          WHERE gtr.group_name = ?
                      );
                    """, (amt_val, grp))

            elif mode == "GRADE":
                grade_amounts = body.get("gradeAmountsUSD", {})
                for g_code, amt in grade_amounts.items():
                    amt_val = float(amt)
                    c.execute("UPDATE grade_tuition_rates SET amount_usd = ?, updated_at = ? WHERE grade_code = ?;", (amt_val, now_str, g_code))
                    c.execute("""
                    UPDATE student_debts
                    SET amount_usd = ?
                    WHERE status = 'PENDING'
                      AND fee_concept_id IN (SELECT id FROM fee_concepts WHERE is_recurring = 1 OR code LIKE 'MEN-%')
                      AND student_id IN (
                          SELECT id FROM students WHERE grade LIKE (? || '%')
                      );
                    """, (amt_val, g_code))

            conn.commit()
            conn.close()
            return self.send_json({"message": "Tarifas de mensualidad actualizadas exitosamente."})

        # Generate / Verify Monthly Tuition Debts for Active Students (Sep - Jul)
        if path == "/api/payments/tuition-rates/generate-monthly":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:config:manage_rates]"}, 403)

            target_year = body.get("year") or body.get("targetYear")
            target_month = body.get("month") or body.get("targetMonth")

            conn = sqlite3.connect(DB_FILE)
            result = generate_monthly_tuition_debts(conn, target_year, target_month)
            conn.close()

            status_code = 200 if result.get("success") else 400
            return self.send_json(result, status_code)

        # Broadcast Additional Charge (Custom Fee Concept & Student Debts) to Active Students
        if path == "/api/payments/fee-concepts/broadcast-charge":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:config:manage_rates]"}, 403)

            concept_name = (body.get("conceptName") or "").strip()
            amount_usd = float(body.get("amountUSD") or 0.0)
            target_grade = (body.get("targetGrade") or "ALL").strip()
            due_date = (body.get("dueDate") or "").strip()

            if not concept_name:
                return self.send_json({"error": "Error de Validación", "message": "El nombre del concepto es obligatorio."}, 400)
            if amount_usd <= 0:
                return self.send_json({"error": "Error de Validación", "message": "El monto en USD debe ser mayor a 0."}, 400)

            if not due_date:
                now = datetime.now()
                due_date = f"{now.year}-{str(now.month).zfill(2)}-28"

            ts = int(time.time() * 1000)
            concept_code = f"CUSTOM-{ts}"
            fee_concept_id = f"fc_custom_{ts}"

            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()

            # 1. Insert into fee_concepts
            cursor.execute("""
            INSERT INTO fee_concepts (id, code, name, amount_usd, is_recurring, is_active)
            VALUES (?, ?, ?, ?, 0, 1);
            """, (fee_concept_id, concept_code, concept_name, amount_usd))

            # 2. Get active students
            if target_grade == "ALL":
                cursor.execute("SELECT id, grade FROM students WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE';")
            else:
                cursor.execute("SELECT id, grade FROM students WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE' AND grade LIKE ?;", (f"%{target_grade}%",))

            active_students = cursor.fetchall()
            created_count = 0

            for idx, st in enumerate(active_students):
                student_id = st[0]
                debt_id = f"sd_custom_{ts}_{idx}_{student_id}"
                cursor.execute("""
                INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
                VALUES (?, ?, ?, ?, ?, 'PENDING');
                """, (debt_id, student_id, fee_concept_id, amount_usd, due_date))
                created_count += 1

            conn.commit()
            conn.close()

            return self.send_json({
                "success": True,
                "message": f"Cobro adicional '{concept_name}' (${amount_usd:.2f}) cargado exitosamente a {created_count} estudiantes.",
                "conceptCode": concept_code,
                "conceptName": concept_name,
                "amountUSD": amount_usd,
                "createdDebtsCount": created_count,
                "targetGrade": target_grade
            })

        # Update Exchange Rate
        if path == "/api/payments/rates":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:config:manage_rates"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            rate = float(body.get("exchangeRate", CURRENT_EXCHANGE_RATE))
            source = body.get("source", "MANUAL")
            CURRENT_EXCHANGE_RATE = rate

            today_str = datetime.now().strftime("%Y-%m-%d")
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
            INSERT INTO exchange_rate_history (id, date_str, rate, source, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date_str) DO UPDATE SET rate=excluded.rate, source=excluded.source, created_at=excluded.created_at;
            """, (f"rate_{today_str}", today_str, rate, source, datetime.now().isoformat()))
            conn.commit()
            conn.close()

            return self.send_json({"message": "Tasa de cambio actualizada con éxito.", "exchangeRate": CURRENT_EXCHANGE_RATE})

        # Create Cash Closing (Admin)
        if path == "/api/payments/cash-closing":
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:admin:close_box"):
                return self.send_json({"error": "Acceso Denegado", "message": "Falta el permiso [payments:admin:close_box]"}, 403)

            notes = body.get("notes", "Cierre de caja generado")
            cashier_id = body.get("cashierId", "ALL")

            with PAYMENT_LOCK:
                conn = get_db_connection()
                c = conn.cursor()

                sql = """
                SELECT pm.method, pm.amount, pm.currency
                FROM payment_methods pm
                JOIN payments p ON pm.payment_id = p.id
                WHERE p.status = 'COMPLETED'
                """
                params = []
                if cashier_id and cashier_id != "ALL":
                    sql += " AND p.user_id = ?"
                    params.append(cashier_id)

                c.execute(sql, params)
                rows = c.fetchall()

                cash_usd = sum(r[1] for r in rows if r[0] == 'CASH_USD')
                cash_ves = sum(r[1] for r in rows if r[0] == 'CASH_VES')
                dig_usd = sum(r[1] for r in rows if r[0] not in ('CASH_USD', 'CASH_VES') and r[2] == 'USD')
                dig_ves = sum(r[1] for r in rows if r[0] not in ('CASH_USD', 'CASH_VES') and r[2] == 'VES')
                grand_total_usd = cash_usd + (cash_ves / CURRENT_EXCHANGE_RATE) + dig_usd + (dig_ves / CURRENT_EXCHANGE_RATE)

                date_str = datetime.now().strftime('%Y-%m-%d')
                seq_key = f"CLOSING_{date_str}"
                fallback_q = f"SELECT COUNT(*) FROM cash_closings WHERE closing_number LIKE 'CLS-{date_str}-%';"
                closing_seq = get_next_sequence_number(c, seq_key, fallback_query=fallback_q)

                closing_num = f"CLS-{date_str}-{str(closing_seq).zfill(3)}"
                closing_id = f"cls_{int(time.time() * 1000)}"
                now_str = datetime.now(timezone.utc).isoformat()

                c.execute("""
                INSERT INTO cash_closings (id, closing_number, user_id, opened_at, closed_at, total_cash_usd, total_cash_local, total_digital_usd, total_digital_local, grand_total_usd, notes, cashier_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?);
                """, (closing_id, closing_num, user["userId"], now_str, now_str, cash_usd, cash_ves, dig_usd, dig_ves, grand_total_usd, notes, cashier_id))

                conn.commit()
                conn.close()

            return self.send_json({
                "success": True,
                "closingNumber": closing_num,
                "cashierId": cashier_id,
                "grandTotalUSD": round(grand_total_usd, 2)
            }, 201)
        # Send Email Receipt
        if path.startswith("/api/payments/receipts/") and path.endswith("/send-email"):
            user = self.get_auth_user()
            if not self.check_perm(user, "payments:cashier:view_receipt"):
                return self.send_json({"error": "Acceso Denegado"}, 403)

            receipt_id = path.split("/")[4]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT receipt_number FROM payments WHERE id = ?;", (receipt_id,))
            p_row = c.fetchone()
            if not p_row:
                conn.close()
                return self.send_json({"error": "Recibo no encontrado"}, 404)

            c.execute("""
            SELECT g.email, g.full_name FROM payment_details pd
            JOIN student_debts d ON pd.debt_id = d.id
            JOIN students s ON d.student_id = s.id
            JOIN student_guardians sg ON s.id = sg.student_id
            JOIN guardians g ON sg.guardian_id = g.id
            WHERE pd.payment_id = ? LIMIT 1;
            """, (receipt_id,))
            g_row = c.fetchone()
            conn.close()

            target_email = (g_row[0] if g_row and g_row[0] else "representante@gmail.com")
            target_name = (g_row[1] if g_row and g_row[1] else "Representante Legal")

            print(f"📧 [MOTOR CORREO] Enviando comprobante {p_row[0]} automáticamente a: {target_email} ({target_name})...")

            return self.send_json({
                "success": True,
                "email": target_email,
                "recipientName": target_name,
                "receiptNumber": p_row[0],
                "message": f"Comprobante digital {p_row[0]} enviado exitosamente a {target_email}"
            })

        # Create or Update Student & Guardian
        if path == "/api/students/save":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
                
            student_id = body.get("studentId")
            first_name = body.get("firstName", "").strip()
            last_name = body.get("lastName", "").strip()
            doc_id = body.get("docId", "").strip()
            grade = body.get("grade", "").strip()
            section = body.get("section", "A").strip()
            status = body.get("status", "ACTIVE").strip()

            is_scholarship = 1 if body.get("isScholarship") else 0
            scholarship_pct = float(body.get("scholarshipPct", 0) or 0)
            scholarship_reason = body.get("scholarshipReason", "").strip()
            
            guardian_data = body.get("guardian", {})
            guardian_id = body.get("guardianId")
            
            if not first_name or not grade:
                return self.send_json({"error": "Nombre del estudiante y Grado son obligatorios"}, 400)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            # Guardian creation or lookup
            if not guardian_id and guardian_data:
                g_doc_id = guardian_data.get("docId", "").strip()
                g_name = guardian_data.get("fullName", "").strip()
                if g_doc_id:
                    c.execute("SELECT id FROM guardians WHERE doc_id = ?", (g_doc_id,))
                    existing_g = c.fetchone()
                    if existing_g:
                        guardian_id = existing_g[0]
                        c.execute("""
                        UPDATE guardians SET full_name = ?, phone = ?, email = ?, address = ? WHERE id = ?
                        """, (g_name, guardian_data.get("phone", "").strip(), guardian_data.get("email", "").strip(), guardian_data.get("address", "").strip(), guardian_id))
                    else:
                        guardian_id = f"g_{uuid.uuid4().hex[:8]}"
                        g_code = generate_next_guardian_code(conn)
                        c.execute("""
                        INSERT INTO guardians (id, doc_id, full_name, email, phone, address, guardian_code, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE');
                        """, (guardian_id, g_doc_id, g_name, guardian_data.get("email", "").strip(), guardian_data.get("phone", "").strip(), guardian_data.get("address", "").strip(), g_code))
            
            if student_id:
                # Update
                c.execute("""
                UPDATE students
                SET first_name = ?, last_name = ?, doc_id = ?, grade = ?, section = ?, status = ?,
                    is_scholarship = ?, scholarship_pct = ?, scholarship_reason = ?
                WHERE id = ?;
                """, (first_name, last_name, doc_id, grade, section, status, is_scholarship, scholarship_pct, scholarship_reason, student_id))

                # Recalculate pending monthly tuition debts for this student based on scholarship rate
                c.execute("""
                SELECT d.id, fc.amount_usd
                FROM student_debts d
                JOIN fee_concepts fc ON d.fee_concept_id = fc.id
                WHERE d.student_id = ? AND d.status = 'PENDING' AND fc.is_recurring = 1;
                """, (student_id,))
                pending_debts = c.fetchall()
                for d_row in pending_debts:
                    d_id = d_row[0]
                    fc_base = float(d_row[1])
                    if is_scholarship and scholarship_pct > 0:
                        new_amt = round(fc_base * (1.0 - (scholarship_pct / 100.0)), 2)
                    else:
                        new_amt = fc_base
                    c.execute("UPDATE student_debts SET amount_usd = ? WHERE id = ?;", (new_amt, d_id))
            else:
                # Create new student with auto code
                student_id = f"s_{uuid.uuid4().hex[:8]}"
                s_code = generate_next_student_code(conn)
                c.execute("""
                INSERT INTO students (id, student_code, doc_id, first_name, last_name, grade, section, status, is_scholarship, scholarship_pct, scholarship_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (student_id, s_code, doc_id or None, first_name, last_name, grade, section, status, is_scholarship, scholarship_pct, scholarship_reason))

                # Create initial debt concept for student
                c.execute("SELECT id, amount_usd FROM fee_concepts WHERE is_recurring = 1 LIMIT 1;")
                fc = c.fetchone()
                if fc:
                    debt_id = f"d_{uuid.uuid4().hex[:8]}"
                    due_date = datetime.now().strftime("%Y-%m-%d")
                    init_amt = float(fc[1])
                    if is_scholarship and scholarship_pct > 0:
                        init_amt = round(init_amt * (1.0 - (scholarship_pct / 100.0)), 2)
                    c.execute("""
                    INSERT INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
                    VALUES (?, ?, ?, ?, ?, 'PENDING');
                    """, (debt_id, student_id, fc[0], init_amt, due_date))
                
            if guardian_id:
                c.execute("INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relationship, is_primary) VALUES (?, ?, 'Representante', 1);", (student_id, guardian_id))
                
            conn.commit()
            conn.close()
            return self.send_json({"success": True, "studentId": student_id, "message": "Estudiante guardado exitosamente"})

        # Change Student Status (Toggle ACTIVE / FROZEN / INACTIVE)
        if path == "/api/students/toggle-status":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
            student_id = body.get("studentId")
            new_status = body.get("status", "ACTIVE")
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("UPDATE students SET status = ? WHERE id = ?", (new_status, student_id))
            conn.commit()
            conn.close()
            return self.send_json({"success": True, "studentId": student_id, "status": new_status, "message": f"Estado actualizado a {new_status}"})

        # Soft Delete Student
        if path == "/api/students/delete":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
            student_id = body.get("studentId")
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("UPDATE students SET status = 'INACTIVE' WHERE id = ?", (student_id,))
            conn.commit()
            conn.close()
            return self.send_json({"success": True, "message": "Estudiante inactivado/eliminado correctamente"})

        # Batch Import Students & Representatives (CSV / Excel)
        if path == "/api/students/batch-import":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "No autorizado"}, 401)
                
            records = body.get("records", [])
            if not isinstance(records, list) or len(records) == 0:
                return self.send_json({"error": "No se recibieron registros válidos para importar"}, 400)
                
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            created_guardians = 0
            created_students = 0
            
            for rec in records:
                g_doc_id = str(rec.get("repDocId") or rec.get("cedula_representante") or rec.get("Cedula_Representante") or rec.get("cedula_rep") or rec.get("Cedula Rep") or "").strip()
                g_name = str(rec.get("repName") or rec.get("nombre_representante") or rec.get("Nombre_Representante") or rec.get("representante") or rec.get("Representante") or "").strip()
                g_phone = str(rec.get("repPhone") or rec.get("telefono") or rec.get("Telefono") or "").strip()
                g_email = str(rec.get("repEmail") or rec.get("correo") or rec.get("Correo") or "").strip()
                
                s_first_name = str(rec.get("studentFirstName") or rec.get("nombre_estudiante") or rec.get("Nombre_Estudiante") or rec.get("estudiante") or rec.get("Estudiante") or "").strip()
                s_last_name = str(rec.get("studentLastName") or rec.get("apellido_estudiante") or rec.get("Apellido_Estudiante") or "").strip()
                s_doc_id = str(rec.get("studentDocId") or rec.get("cedula_estudiante") or rec.get("Cedula_Estudiante") or "").strip()
                s_grade = str(rec.get("grade") or rec.get("grado") or rec.get("Grado") or "1ro Grado").strip()
                s_section = str(rec.get("section") or rec.get("seccion") or rec.get("Seccion") or "A").strip()
                
                is_sch = 1 if (rec.get("isScholarship") or rec.get("becado") or rec.get("Beca")) else 0
                sch_pct = float(rec.get("scholarshipPct") or rec.get("porcentaje_beca") or rec.get("Porcentaje_Beca") or rec.get("Beca_Pct") or 0)
                sch_reason = str(rec.get("scholarshipReason") or rec.get("motivo_beca") or rec.get("Motivo_Beca") or "").strip()

                if not s_first_name:
                    continue
                    
                guardian_id = None
                if g_doc_id or g_name:
                    if g_doc_id:
                        c.execute("SELECT id FROM guardians WHERE doc_id = ?", (g_doc_id,))
                        g_row = c.fetchone()
                        if g_row:
                            guardian_id = g_row[0]
                    if not guardian_id:
                        guardian_id = f"g_{uuid.uuid4().hex[:8]}"
                        g_code = generate_next_guardian_code(conn)
                        c.execute("""
                        INSERT INTO guardians (id, doc_id, full_name, email, phone, address, guardian_code, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE');
                        """, (guardian_id, g_doc_id or f"V-{uuid.uuid4().hex[:8]}", g_name or "Representante", g_email, g_phone, "", g_code))
                        created_guardians += 1
                        
                student_id = f"s_{uuid.uuid4().hex[:8]}"
                s_code = generate_next_student_code(conn)
                c.execute("""
                INSERT INTO students (id, student_code, doc_id, first_name, last_name, grade, section, status, is_scholarship, scholarship_pct, scholarship_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?);
                """, (student_id, s_code, s_doc_id or None, s_first_name, s_last_name, s_grade, s_section, is_sch, sch_pct, sch_reason))
                created_students += 1
                
                # Asignar paquete completo de deudas del año escolar:
                # 1. Matrícula / Inscripción escolar (ej. MAT-2026-2027)
                # 2. Mensualidades acumuladas desde Septiembre hasta el mes actual (ej. Sep y Oct), según grado y beca
                assign_school_year_debts_to_student(c, student_id, s_grade, is_sch, sch_pct)

                if guardian_id:
                    c.execute("INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relationship, is_primary) VALUES (?, ?, 'Representante', 1);", (student_id, guardian_id))
                    
            conn.commit()
            conn.close()
            return self.send_json({
                "success": True,
                "message": f"Carga masiva completada con éxito: {created_students} estudiantes y {created_guardians} representantes creados. Se asignó automáticamente la Matrícula del año escolar y las mensualidades acumuladas (Septiembre y Octubre).",
                "createdStudents": created_students,
                "createdGuardians": created_guardians
            })

        return self.send_json({"error": "Endpoint POST no encontrado"}, 404)

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

def run():
    init_db()
    # Start automated backup scheduler thread
    t = threading.Thread(target=backup_scheduler_worker, daemon=True)
    t.start()
    with ThreadedTCPServer(("", PORT), CDNJHandler) as httpd:
        print(f"🚀 CDNJ Server corriendo en http://localhost:{PORT} (Multi-hilo concurrente activado)")
        print("🔒 Acceso con autenticación obligatoria activo (Modo demo desactivado)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")

if __name__ == "__main__":
    run()
