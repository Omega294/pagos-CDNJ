#!/usr/bin/env python3
import sqlite3
import random
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "dev.db")

MALE_NAMES = ["Carlos", "José", "Juan", "Luis", "Miguel", "Alejandro", "Diego", "Gabriel", "Andrés", "Francisco", "Pedro", "Manuel", "Antonio", "Rafael", "Jesús", "Daniel", "David", "Fernando", "Javier", "Jorge", "Ricardo", "Eduardo", "Roberto", "Enrique", "Gustavo"]
FEMALE_NAMES = ["María", "Ana", "Sofía", "Mariana", "Valentina", "Isabella", "Camila", "Victoria", "Lucía", "Andrea", "Carmen", "Elena", "Patricia", "Daniela", "Gabriela", "Natalia", "Paula", "Claudia", "Rosa", "Yessica", "Adriana", "Beatriz", "Verónica", "Laura", "Stephanie"]

LAST_NAMES = ["Mendoza", "Rivas", "Paredes", "González", "Rodríguez", "Martínez", "Hernández", "López", "Pérez", "García", "Sánchez", "Ramírez", "Torres", "Flores", "Díaz", "Vargas", "Castro", "Morales", "Ortiz", "Silva", "Ramos", "Romero", "Navarro", "Molina", "Delgado", "Alvarez", "Acosta", "Rojas", "Benítez", "Suárez"]

GRADES = ["1er Grado", "2do Grado", "3er Grado", "4to Grado", "5to Grado", "6to Grado", "1er Año", "2do Año", "3er Año", "4to Año", "5to Año"]
SECTIONS = ["A", "B", "C"]

def generate_300():
    print("🚀 Generando 300 Representantes y sus Representados (1 a 4 por representante)...")
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()

    # Asegurar columnas nuevas en guardians y students
    try:
        c.execute("ALTER TABLE guardians ADD COLUMN guardian_code TEXT;")
    except Exception: pass

    try:
        c.execute("ALTER TABLE guardians ADD COLUMN first_name TEXT;")
    except Exception: pass

    try:
        c.execute("ALTER TABLE guardians ADD COLUMN last_name TEXT;")
    except Exception: pass

    try:
        c.execute("ALTER TABLE students ADD COLUMN section TEXT DEFAULT 'A';")
    except Exception: pass

    conn.commit()

    # Obtener conceptos de cobro para asignar deudas
    c.execute("SELECT id, amount_usd FROM fee_concepts;")
    concepts = c.fetchall()

    student_counter = 1
    total_students = 0

    for i in range(1, 301):
        g_code = f"REP-{str(i).zfill(3)}"
        is_male = random.choice([True, False])
        fn = random.choice(MALE_NAMES) if is_male else random.choice(FEMALE_NAMES)
        ln1 = random.choice(LAST_NAMES)
        ln2 = random.choice(LAST_NAMES)
        full_ln = f"{ln1} {ln2}"
        full_name = f"{fn} {full_ln}"
        doc_id = f"V-{random.randint(11000000, 26000000)}"
        email = f"{fn.lower()[:3]}{ln1.lower()}{i}@gmail.com"
        phone = f"+58 4{random.choice(['14','24','12','16'])}-{random.randint(100,999)}{random.randint(10,99)}{random.randint(10,99)}"
        address = f"Urb. San José, Calle {random.randint(1,15)}, Casa #{random.randint(1,99)}"
        g_id = f"g_300_{i}"

        # Insertar Representante
        c.execute("""
        INSERT OR REPLACE INTO guardians (id, guardian_code, doc_id, full_name, first_name, last_name, email, phone, address)
        VALUES (?,?,?,?,?,?,?,?,?);
        """, (g_id, g_code, doc_id, full_name, fn, full_ln, email, phone, address))

        # Generar entre 1 y 4 Representados por Representante
        num_students = random.randint(1, 4)
        for s_idx in range(num_students):
            s_code = f"EST-2026-{str(student_counter).zfill(4)}"
            s_is_male = random.choice([True, False])
            s_fn = random.choice(MALE_NAMES) if s_is_male else random.choice(FEMALE_NAMES)
            s_ln = full_ln
            grade = random.choice(GRADES)
            section = random.choice(SECTIONS)
            
            # Cédula de identidad si es mayor o Cédula Escolar CE-
            if "Año" in grade or random.choice([True, False]):
                s_doc = f"V-{random.randint(31000000, 35000000)}"
            else:
                s_doc = f"CE-2026-{random.randint(10000000, 99999999)}"

            s_id = f"s_300_{student_counter}"

            c.execute("""
            INSERT OR REPLACE INTO students (id, student_code, doc_id, first_name, last_name, grade, section, status)
            VALUES (?,?,?,?,?,?,?, 'ACTIVE');
            """, (s_id, s_code, s_doc, s_fn, s_ln, f"{grade} {section}", section))

            c.execute("""
            INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relationship, is_primary)
            VALUES (?,?, 'Representante Legal', 1);
            """, (s_id, g_id))

            # Generar deudas para el representado
            if concepts:
                # 1 o 2 deudas por alumno
                num_debts = random.randint(1, 2)
                chosen_concepts = random.sample(concepts, k=min(num_debts, len(concepts)))
                for d_idx, concept in enumerate(chosen_concepts):
                    debt_id = f"d_300_{student_counter}_{d_idx}"
                    due_date = f"2026-09-{random.choice(['15','30'])}"
                    c.execute("""
                    INSERT OR REPLACE INTO student_debts (id, student_id, fee_concept_id, amount_usd, due_date, status)
                    VALUES (?,?,?,?,?,'PENDING');
                    """, (debt_id, s_id, concept[0], concept[1], due_date))

            student_counter += 1
            total_students += 1

    conn.commit()
    conn.close()
    print(f"✅ Se han creado con éxito 300 Representantes y {total_students} Representados con sus respectivas deudas y códigos únicos.")

if __name__ == "__main__":
    generate_300()
