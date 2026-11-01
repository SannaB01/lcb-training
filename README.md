# LCB Training

Trainings-App für Hammerwurf: Kraft (1RM, % vom 1RM), Wurf (Bestweite pro Hammergewicht und Draht),
Allgemeine Tests, Bestwerte und Prognose der 7.26-kg-Weite.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Die ganze Oberfläche. Gleiche Datei für das claude.ai-Artifact und die Web-App. |
| `calc.js` | Kraft-Berechnungen (SPEC_Kraftaufbau-App §5) mit Testfällen |
| `hammer.js` | Prognose-Modelle (SPEC_Hammer-Prognose) mit Testfällen |
| `pwa/` | Nur für die Web-App: Supabase-Verbindung, Manifest, Offline-Cache |
| `supabase/schema.sql` | Datenbank-Tabelle und Zugriffsregeln (einmal im Supabase SQL Editor ausführen) |
| `build.ps1` | Erzeugt `docs/` (Icons aus `../Appbild1.png`, vollständiges HTML) |
| `docs/` | Veröffentlichte Web-App (GitHub Pages) – nicht von Hand bearbeiten |

## Speicher

- In claude.ai: claude-Datenbank des Artifacts.
- Als Web-App: Supabase mit Login. Änderungen werden zuerst auf dem Gerät gespeichert und übertragen, sobald Internet da ist.

## Neue Version veröffentlichen

```
powershell -ExecutionPolicy Bypass -File build.ps1
git add -A
git commit -m "Beschreibung"
git push
```

GitHub Pages ist nach etwa einer Minute aktuell. Auf dem iPhone die App einmal schliessen und neu öffnen.
