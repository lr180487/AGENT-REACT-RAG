# 05 — Guía de Colores & Paleta 2026

## Paleta Mejorada (v3 — 19 Oct 2026)

### Variables CSS (`:root` en `interfaz.html` / `index.html` / `nuevo-chat.html`)

```css
:root{
  /* Base — más cálida y luminosa */
  --bg: #f8f9ff;              /* antes #f3f5f9 — más aire, menos gris */
  --panel: #ffffff;
  --panel-2: #f8fafc;         /* antes #f1f4f8 — más suave */
  --border: #e2e8f0;        
  --border-strong: #cbd5e1;
  --muted: #64748b;
  --text: #0f172a;

  /* Marca — degradados vivos */
  --primary: #7c5cff;         /* indigo-violet mantiene identidad */
  --primary-2: #4f46e5;       /* más profundo */
  --primary-light: #eef2ff;   /* para hover/active claro */
  --accent: #06b6d4;          /* cyan para gradientes */
  --accent-light: #ecfeff;

  /* Semáforo */
  --success: #059669;         /* antes #10b981 — más contraste WCAG */
  --success-light: #d1fae5;
  --warning: #d97706;
  --warning-light: #fef3c7;
  --danger: #dc2626;
  --danger-light: #fee2e2;

  /* Efectos */
  --radius: 18px;             /* antes 16 — más amigable */
  --shadow: 0 8px 24px rgba(124,92,255,.08), 0 1px 4px rgba(15,23,42,.06);
  --shadow-lg: 0 20px 48px rgba(15,23,42,.12);
  --gradient-primary: linear-gradient(135deg, #7c5cff 0%, #6366f1 40%, #06b6d4 100%);
  --gradient-panel: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
}
```

### Reglas de Uso

| Elemento | Fondo | Borde | Texto |
|----------|-------|-------|-------|
| Header / Sidebar | `rgba(255,255,255,.92)` + blur 10px | `var(--border)` | `var(--text)` |
| Card / Panel | `var(--panel)` | `var(--border)` | `var(--text)` |
| Card hover | `white` | `rgba(124,92,255,.18)` | `var(--text)` |
| Botón primario | `var(--gradient-primary)` | — | `white` |
| Bubble user | `var(--gradient-primary)` | — | `white` |
| Bubble bot | `white` | `var(--border)` | `var(--text)` |
| Tag activo | `var(--success-light)` | `rgba(5,150,105,.18)` | `var(--success)` |
| Alarma / scrollBtn | `white` | `var(--border)` | `var(--primary)` |

### Accesibilidad

- Contraste AA: `text #0f172a` sobre `bg #f8f9ff` = 16.5:1
- `muted #64748b` sobre `panel #ffffff` = 6.2:1
- `success #059669` sobre `success-light #d1fae5` = 5.8:1

### Degradados Nuevos

- **Header glow:** `radial-gradient(700px 320px at 15% 0%, rgba(124,92,255,.07))`
- **Chat main:** `radial-gradient(600px 280px at 50% 0%, rgba(124,92,255,.05))`
- **Active chat item:** `linear-gradient(135deg, rgba(124,92,255,.08), rgba(6,182,214,.06))`

### Modo Oscuro (futuro)

Reservado: invertir `bg #0b1220`, `panel #151b2c`, `text #f1f5f9`. No activar aún — la base clara actual maximiza legibilidad diurna.

---

> Cambiar un color → editar `:root` en los 3 HTML + `docs/05_GUIA_COLORES.md` (esta guía). Los componentes heredan automáticamente.
