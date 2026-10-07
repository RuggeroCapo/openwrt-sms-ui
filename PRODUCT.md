# Product

## Register

product

## Users

Una sola persona (il proprietario del server Umbrel), da telefono e da desktop sulla rete di casa. Contesto tipico: aprire l'app per leggere al volo un SMS in arrivo (spesso un codice OTP) o inviarne uno, senza dover armeggiare con il router.

## Product Purpose

Interfaccia web per leggere, inviare ed eliminare gli SMS della SIM nel router, che viene interrogato via SSH con `mmcli`. Gira come app sul server Umbrel OS 2.0, dietro l'app proxy di Umbrel. Successo: un nuovo SMS compare da solo in pochi secondi e il codice si copia con un tocco.

## Brand Personality

Calma, premium, nativa di Umbrel. Voce sobria in italiano, frasi brevi, nessun gergo tecnico se non serve.

## Anti-references

Dashboard enterprise dense, neon e cyberpunk, look da webmail anni 2000, vetro decorativo su ogni elemento, griglie di card identiche.

## Design Principles

1. Le conversazioni prima di tutto: i messaggi sono raggruppati per numero, non elencati come righe di un database.
2. Il compito frequente a portata di pollice: leggere, copiare un codice, rispondere.
3. Lo stato del router sempre leggibile ma discreto (un punto colorato e una parola).
4. Azioni distruttive visibilmente distinte e confermate sul posto, senza modali.
5. La gerarchia deve reggere anche senza trasparenze o blur.

## Accessibility & Inclusion

WCAG AA per contrasto e focus visibile, navigazione da tastiera completa, `prefers-reduced-motion` rispettato, bersagli touch di almeno 44px, interfaccia in italiano.
