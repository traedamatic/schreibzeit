# Quellen der Grundwortschatz-Listen

Zwei Datei-Schemata werden unterstützt:

1. **Reines Wortarray** (`["Apfel", "backen", …]`) — Bayern, NRW.
2. **Einträge mit kuratiertem Artikel** (`[{"word": "Apfel", "article": "der"},
   {"word": "sieben", "article": null}, …]`) — Berlin/Brandenburg. `article:
   null` bedeutet „bewusst kein Artikel" (kein Nomen) und überschreibt beim
   Import den Wörterbuch-Vorschlag; fehlerhafte Einträge werden übersprungen.

- **grundwortschatz_berlin_1bis4.json** – Grundwortschatz Berlin/Brandenburg
  (Jahrgangsstufen 1–4), 599 Wörter, mit redaktionell geprüften Artikeln
  (302 Nomen).
- **bayern-1-2.json / bayern-3-4.json** – aus dem bayerischen *LehrplanPLUS*
  („Ergänzende Informationen zum LehrplanPLUS – Grundwortschatz", Jgst. 1/2 bzw. 3/4),
  Staatsinstitut für Schulqualität und Bildungsforschung (ISB)/Bayerisches
  Kultusministerium. Nur die Wortlisten wurden extrahiert.
- **nrw.json** – *Grundwortschatz NRW* (Ministerium für Schule und Bildung des
  Landes Nordrhein-Westfalen), 533 Wörter (Spalte „Wort" extrahiert).

Die Rechte an den Originaldokumenten liegen bei den jeweiligen Ministerien/Instituten.
Hier werden nur die reinen Wortlisten zur Übungsauswahl verwendet. Weitere
Bundesländer (z. B. Hessen, Baden-Württemberg) lassen sich als zusätzliche
JSON-Dateien gleicher Struktur ergänzen.
