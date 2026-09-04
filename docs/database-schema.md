# AgendaPX — Database Schema

Estado actual del esquema de base de datos de AgendaPX.

Este documento describe el modelo vigente de forma legible.

La fuente de verdad ejecutable se encuentra en:

`supabase/migrations/`

---

## Arquitectura de identidad

Supabase Auth administra autenticación.

AgendaPX mantiene los datos de aplicación y autorización en `public.users`.

La relación es 1:1:

auth.users.id
→ public.users.id

El rol y el tenant no se obtienen de `user_metadata`.

---

## Roles

### MASTER

Usuario administrativo de AgendaPX.

- No pertenece a un doctor.
- `doctor_id` debe ser `NULL`.
- Puede consultar todos los tenants.

### DOCTOR

Usuario perteneciente a un tenant.

- Debe tener un `doctor_id`.
- Sólo puede acceder al tenant que le corresponde.

---

## doctors

Representa un tenant de AgendaPX.

No representa exclusivamente a una persona física; representa la cuenta o consultorio operado dentro de AgendaPX.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| display_name | text | NOT NULL |
| status | doctor_status | NOT NULL, default ACTIVE |
| created_at | timestamptz | NOT NULL, default now() |

### doctor_status

- ACTIVE
- INACTIVE

---

## users

Perfil de aplicación asociado 1:1 con `auth.users`.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, FK → auth.users.id |
| doctor_id | uuid | FK → doctors.id, nullable |
| role | user_role | NOT NULL |
| full_name | text | NOT NULL |
| created_at | timestamptz | NOT NULL, default now() |

### user_role

- MASTER
- DOCTOR

### Restricción de tenant

MASTER:

`doctor_id IS NULL`

DOCTOR:

`doctor_id IS NOT NULL`

---

## Relaciones

auth.users
    │
    │ 1:1
    ▼
users
    │
    │ N:1
    ▼
doctors

Un doctor puede tener más de un usuario en el futuro.

---

## Row Level Security

RLS está habilitado en:

- doctors
- users

### doctors

MASTER:

Puede leer todos los doctores.

DOCTOR:

Sólo puede leer el doctor cuyo `id` coincide con su `doctor_id`.

### users

MASTER:

Puede leer todos los usuarios.

DOCTOR:

Sólo puede leer su propio registro.

---

## Data API

La opción:

`Automatically expose new tables`

está deshabilitada en Supabase.

Los permisos hacia `authenticated` deben otorgarse explícitamente mediante migraciones.

Actualmente:

- authenticated puede SELECT en doctors
- authenticated puede SELECT en users
- anon no tiene acceso

No existen todavía permisos de INSERT, UPDATE o DELETE.

---

## Authorization helpers

Las funciones internas de autorización viven en el schema no expuesto:

`private`

Funciones actuales:

- private.current_user_role()
- private.current_doctor_id()

Estas funciones son utilizadas exclusivamente para resolver autorización dentro de las políticas RLS.

---

## Historial

### foundation_identity_and_tenancy

Primera fundación multi-tenant de AgendaPX.

Incluye:

- roles MASTER y DOCTOR
- tenants doctors
- perfiles users
- relación con Supabase Auth
- aislamiento por doctor
- RLS
- permisos Data API mínimos